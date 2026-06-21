from __future__ import annotations

import asyncio
import json
import logging
import shutil
import sqlite3
from collections.abc import Awaitable, Callable
from datetime import UTC, datetime
from pathlib import Path
from urllib.parse import unquote
from uuid import uuid4

from fastapi import Depends, FastAPI, Header, HTTPException, Query, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from pydantic import BaseModel, EmailStr, Field
from typing import Literal

from .auth import (
    auth_dependency,
    create_media_token,
    create_token,
    decode_media_token,
    hash_password,
    verify_password,
)
from .config import Settings, settings as default_settings
from .db import Database
from .media import MediaInfo, format_matches_extension, probe_media, resolve_media_tool
from .middleware import RequestSizeLimitMiddleware, RequestTooLarge
from .processing import generate_clip_candidates, render_clip


logger = logging.getLogger("cutwise")
CANONICAL_MIME_TYPES = {
    ".mp4": "video/mp4",
    ".mov": "video/quicktime",
    ".webm": "video/webm",
}


class RegisterRequest(BaseModel):
    name: str = Field(min_length=2, max_length=80)
    email: EmailStr
    password: str = Field(min_length=8, max_length=128)


class LoginRequest(BaseModel):
    email: EmailStr
    password: str = Field(min_length=8, max_length=128)


class RenderConfigRequest(BaseModel):
    ratio: Literal["9:16", "1:1", "16:9"] = "9:16"
    quality: Literal["720p", "1080p", "4K"] = "1080p"
    captionsEnabled: bool = False
    trackingEnabled: bool = False


class ClipPatchRequest(BaseModel):
    title: str | None = Field(default=None, min_length=1, max_length=160)
    startSeconds: float | None = Field(default=None, ge=0)
    endSeconds: float | None = Field(default=None, gt=0)
    selected: bool | None = None
    renderConfig: RenderConfigRequest | None = None


class ExportRequest(BaseModel):
    startSeconds: float = Field(ge=0)
    endSeconds: float = Field(gt=0)
    renderConfig: RenderConfigRequest


def now_iso() -> str:
    return datetime.now(UTC).isoformat()


def serialize_project(row: sqlite3.Row) -> dict:
    return {
        "id": row["id"],
        "title": row["title"],
        "status": row["status"],
        "sourceFilename": row["source_filename"],
        "mimeType": row["mime_type"],
        "sizeBytes": row["size_bytes"],
        "durationSeconds": row["duration_seconds"],
        "errorMessage": row["error_message"],
        "createdAt": row["created_at"],
        "updatedAt": row["updated_at"],
        "mediaUrl": f"/api/projects/{row['id']}/media",
    }


def serialize_clip(row: sqlite3.Row) -> dict:
    return {
        "id": row["id"],
        "projectId": row["project_id"],
        "title": row["title"],
        "description": row["description"],
        "reason": row["reason"],
        "start": row["start_seconds"],
        "end": row["end_seconds"],
        "score": row["score"],
        "transcript": row["transcript"],
        "selected": bool(row["selected"]),
        "renderConfig": json.loads(row["render_config"]),
    }


ProbeFunction = Callable[[Path, str], Awaitable[MediaInfo | None]]
RenderFunction = Callable[[str, Path, Path, float, float, str, str], Awaitable[None]]


def cleanup_pending_files(database: Database) -> None:
    with database.connection() as connection:
        rows = connection.execute(
            "SELECT project_id, source_path, quarantine_path FROM pending_file_deletions"
        ).fetchall()
    for row in rows:
        source = Path(row["source_path"])
        quarantine = Path(row["quarantine_path"])
        try:
            if source.exists() and not quarantine.exists():
                source.replace(quarantine)
            with database.connection() as connection:
                connection.execute("DELETE FROM projects WHERE id = ?", (row["project_id"],))
            quarantine.unlink(missing_ok=True)
        except OSError:
            logger.warning("Nie udało się jeszcze usunąć pliku %s", quarantine)
            continue
        with database.connection() as connection:
            connection.execute(
                "DELETE FROM pending_file_deletions WHERE project_id = ?",
                (row["project_id"],),
            )


def create_app(
    app_settings: Settings | None = None,
    database: Database | None = None,
    probe_function: ProbeFunction = probe_media,
    render_function: RenderFunction = render_clip,
) -> FastAPI:
    app_settings = (app_settings or default_settings).finalized()
    app_settings.upload_dir.mkdir(parents=True, exist_ok=True)
    app_settings.export_dir.mkdir(parents=True, exist_ok=True)
    database = database or Database(app_settings.database_path)
    cleanup_pending_files(database)
    current_user = auth_dependency(database, app_settings)
    ffprobe_path = resolve_media_tool("ffprobe", app_settings.ffprobe_path)
    ffmpeg_path = resolve_media_tool("ffmpeg", app_settings.ffmpeg_path)
    project_locks: dict[str, asyncio.Lock] = {}

    def project_lock(project_id: str) -> asyncio.Lock:
        return project_locks.setdefault(project_id, asyncio.Lock())

    app = FastAPI(title="Cutwise API", version="0.2.0")
    app.state.settings = app_settings
    app.state.database = database
    app.add_middleware(
        RequestSizeLimitMiddleware,
        max_bytes=app_settings.max_upload_bytes,
    )
    app.add_middleware(
        CORSMiddleware,
        allow_origins=["http://127.0.0.1:5173", "http://localhost:5173"],
        allow_credentials=False,
        allow_methods=["*"],
        allow_headers=["*"],
    )

    @app.get("/api/health")
    def health() -> dict:
        return {"status": "ok", "database": "ready", "backend": "python"}

    @app.post("/api/auth/register", status_code=201)
    def register(payload: RegisterRequest) -> dict:
        user = {
            "id": str(uuid4()),
            "email": str(payload.email).strip().lower(),
            "name": payload.name.strip(),
        }
        try:
            with database.connection() as connection:
                connection.execute(
                    """
                    INSERT INTO users (id, email, name, password_hash, created_at)
                    VALUES (?, ?, ?, ?, ?)
                    """,
                    (user["id"], user["email"], user["name"], hash_password(payload.password), now_iso()),
                )
        except sqlite3.IntegrityError as exc:
            raise HTTPException(status_code=409, detail="Konto z tym adresem e-mail już istnieje.") from exc
        return {"user": user, "token": create_token(user, app_settings)}

    @app.post("/api/auth/login")
    def login(payload: LoginRequest) -> dict:
        email = str(payload.email).strip().lower()
        with database.connection() as connection:
            row = connection.execute(
                "SELECT id, email, name, password_hash FROM users WHERE email = ?",
                (email,),
            ).fetchone()
        if row is None or not verify_password(payload.password, row["password_hash"]):
            raise HTTPException(status_code=401, detail="Nieprawidłowy e-mail lub hasło.")
        user = {"id": row["id"], "email": row["email"], "name": row["name"]}
        return {"user": user, "token": create_token(user, app_settings)}

    @app.get("/api/auth/me")
    def me(user: dict[str, str] = Depends(current_user)) -> dict:
        return {"user": user}

    @app.get("/api/projects")
    def list_projects(user: dict[str, str] = Depends(current_user)) -> dict:
        with database.connection() as connection:
            rows = connection.execute(
                """
                SELECT id, title, status, source_filename, mime_type, size_bytes,
                       duration_seconds, error_message, created_at, updated_at
                FROM projects WHERE user_id = ? ORDER BY created_at DESC
                """,
                (user["id"],),
            ).fetchall()
        return {"projects": [serialize_project(row) for row in rows]}

    @app.get("/api/projects/{project_id}")
    def get_project(project_id: str, user: dict[str, str] = Depends(current_user)) -> dict:
        with database.connection() as connection:
            row = connection.execute(
                """
                SELECT id, title, status, source_filename, mime_type, size_bytes,
                       duration_seconds, error_message, created_at, updated_at
                FROM projects WHERE id = ? AND user_id = ?
                """,
                (project_id, user["id"]),
            ).fetchone()
        if row is None:
            raise HTTPException(status_code=404, detail="Projekt nie istnieje.")
        return {"project": serialize_project(row)}

    @app.post("/api/projects", status_code=201)
    async def create_project(
        request: Request,
        x_filename: str = Header(),
        x_project_title: str | None = Header(default=None),
        user: dict[str, str] = Depends(current_user),
    ) -> dict:
        original_name = Path(unquote(x_filename)).name
        extension = Path(original_name).suffix.lower()
        canonical_mime_type = CANONICAL_MIME_TYPES.get(extension)
        if canonical_mime_type is None:
            raise HTTPException(status_code=400, detail="Dozwolone są wyłącznie pliki MP4, MOV i WebM.")

        destination = app_settings.upload_dir / f"{uuid4()}{extension}"
        written = 0
        try:
            with destination.open("xb") as output:
                async for chunk in request.stream():
                    written += len(chunk)
                    if written > app_settings.max_upload_bytes:
                        raise HTTPException(status_code=413, detail="Plik przekracza limit 5 GB.")
                    output.write(chunk)
            if written == 0:
                raise HTTPException(status_code=400, detail="Przesłany plik jest pusty.")

            media = await probe_function(destination, ffprobe_path)
            if (
                media is None
                or not media.has_video
                or not format_matches_extension(extension, media.format_name)
            ):
                raise HTTPException(
                    status_code=400,
                    detail="Plik nie jest prawidłowym nagraniem MP4, MOV ani WebM.",
                )
            if media.duration > app_settings.max_video_seconds:
                raise HTTPException(status_code=400, detail="Film przekracza maksymalną długość 3 godzin.")

            project_id = str(uuid4())
            timestamp = now_iso()
            decoded_title = unquote(x_project_title) if x_project_title else None
            project_title = (decoded_title or Path(original_name).stem).strip()[:160] or "Nowy projekt"
            with database.connection() as connection:
                connection.execute(
                    """
                    INSERT INTO projects (
                      id, user_id, title, status, source_filename, source_path, mime_type,
                      size_bytes, duration_seconds, created_at, updated_at
                    ) VALUES (?, ?, ?, 'uploaded', ?, ?, ?, ?, ?, ?, ?)
                    """,
                    (
                        project_id,
                        user["id"],
                        project_title,
                        original_name,
                        str(destination),
                        canonical_mime_type,
                        written,
                        media.duration,
                        timestamp,
                        timestamp,
                    ),
                )
                row = connection.execute(
                    """
                    SELECT id, title, status, source_filename, mime_type, size_bytes,
                           duration_seconds, error_message, created_at, updated_at
                    FROM projects WHERE id = ?
                    """,
                    (project_id,),
                ).fetchone()
        except RequestTooLarge:
            destination.unlink(missing_ok=True)
            raise
        except asyncio.CancelledError:
            destination.unlink(missing_ok=True)
            raise
        except HTTPException:
            destination.unlink(missing_ok=True)
            raise
        except Exception as exc:
            destination.unlink(missing_ok=True)
            logger.exception("Nie udało się zapisać projektu")
            raise HTTPException(status_code=500, detail="Nieoczekiwany błąd serwera.") from exc
        return {"project": serialize_project(row)}

    @app.post("/api/projects/{project_id}/media-access")
    def project_media_access(
        project_id: str,
        user: dict[str, str] = Depends(current_user),
    ) -> dict:
        with database.connection() as connection:
            exists = connection.execute(
                "SELECT 1 FROM projects WHERE id = ? AND user_id = ?",
                (project_id, user["id"]),
            ).fetchone()
        if exists is None:
            raise HTTPException(status_code=404, detail="Projekt nie istnieje.")
        media_token = create_media_token(user["id"], project_id, app_settings)
        return {"url": f"/api/projects/{project_id}/media?token={media_token}"}

    @app.post("/api/projects/{project_id}/analysis")
    async def analyze_project(
        project_id: str,
        user: dict[str, str] = Depends(current_user),
    ) -> dict:
        lock = project_lock(project_id)
        if lock.locked():
            raise HTTPException(status_code=409, detail="Projekt jest obecnie renderowany.")
        async with lock:
            with database.connection() as connection:
                project = connection.execute(
                    "SELECT duration_seconds FROM projects WHERE id = ? AND user_id = ?",
                    (project_id, user["id"]),
                ).fetchone()
            if project is None:
                raise HTTPException(status_code=404, detail="Projekt nie istnieje.")

            candidates = generate_clip_candidates(float(project["duration_seconds"] or 0))
            timestamp = now_iso()
            with database.connection() as connection:
                connection.execute("DELETE FROM clips WHERE project_id = ?", (project_id,))
                for candidate in candidates:
                    connection.execute(
                        """
                        INSERT INTO clips (
                          id, project_id, title, description, reason, start_seconds,
                          end_seconds, score, transcript, selected, render_config, created_at
                        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, '', 0, ?, ?)
                        """,
                        (
                            str(uuid4()),
                            project_id,
                            candidate.title,
                            candidate.description,
                            candidate.reason,
                            candidate.start,
                            candidate.end,
                            candidate.score,
                            json.dumps(
                                {
                                    "ratio": "9:16",
                                    "quality": "1080p",
                                    "captionsEnabled": False,
                                    "trackingEnabled": False,
                                }
                            ),
                            timestamp,
                        ),
                    )
                connection.execute(
                    "UPDATE projects SET status = 'ready', error_message = NULL, updated_at = ? WHERE id = ?",
                    (timestamp, project_id),
                )
                rows = connection.execute(
                    "SELECT * FROM clips WHERE project_id = ? ORDER BY start_seconds",
                    (project_id,),
                ).fetchall()
        return {"clips": [serialize_clip(row) for row in rows]}

    @app.get("/api/projects/{project_id}/clips")
    def list_clips(
        project_id: str,
        user: dict[str, str] = Depends(current_user),
    ) -> dict:
        with database.connection() as connection:
            project = connection.execute(
                "SELECT 1 FROM projects WHERE id = ? AND user_id = ?",
                (project_id, user["id"]),
            ).fetchone()
            rows = connection.execute(
                "SELECT * FROM clips WHERE project_id = ? ORDER BY start_seconds",
                (project_id,),
            ).fetchall()
        if project is None:
            raise HTTPException(status_code=404, detail="Projekt nie istnieje.")
        return {"clips": [serialize_clip(row) for row in rows]}

    @app.patch("/api/clips/{clip_id}")
    def update_clip(
        clip_id: str,
        payload: ClipPatchRequest,
        user: dict[str, str] = Depends(current_user),
    ) -> dict:
        with database.connection() as connection:
            row = connection.execute(
                """
                SELECT clips.*, projects.duration_seconds
                FROM clips JOIN projects ON projects.id = clips.project_id
                WHERE clips.id = ? AND projects.user_id = ?
                """,
                (clip_id, user["id"]),
            ).fetchone()
        if row is None:
            raise HTTPException(status_code=404, detail="Klip nie istnieje.")

        start = payload.startSeconds if payload.startSeconds is not None else row["start_seconds"]
        end = payload.endSeconds if payload.endSeconds is not None else row["end_seconds"]
        if end <= start or end > float(row["duration_seconds"]):
            raise HTTPException(status_code=400, detail="Zakres klipu jest nieprawidłowy.")
        render_config = (
            payload.renderConfig.model_dump()
            if payload.renderConfig is not None
            else json.loads(row["render_config"])
        )
        with database.connection() as connection:
            connection.execute(
                """
                UPDATE clips SET title = ?, start_seconds = ?, end_seconds = ?,
                  selected = ?, render_config = ? WHERE id = ?
                """,
                (
                    payload.title or row["title"],
                    start,
                    end,
                    int(payload.selected if payload.selected is not None else bool(row["selected"])),
                    json.dumps(render_config),
                    clip_id,
                ),
            )
            updated = connection.execute("SELECT * FROM clips WHERE id = ?", (clip_id,)).fetchone()
        return {"clip": serialize_clip(updated)}

    @app.post("/api/clips/{clip_id}/exports", status_code=201)
    async def create_export(
        clip_id: str,
        payload: ExportRequest,
        user: dict[str, str] = Depends(current_user),
    ) -> dict:
        with database.connection() as connection:
            owner = connection.execute(
                """
                SELECT clips.project_id
                FROM clips JOIN projects ON projects.id = clips.project_id
                WHERE clips.id = ? AND projects.user_id = ?
                """,
                (clip_id, user["id"]),
            ).fetchone()
        if owner is None:
            raise HTTPException(status_code=404, detail="Klip nie istnieje.")

        async with project_lock(owner["project_id"]):
            with database.connection() as connection:
                row = connection.execute(
                    """
                    SELECT clips.project_id, projects.source_path, projects.duration_seconds
                    FROM clips JOIN projects ON projects.id = clips.project_id
                    WHERE clips.id = ? AND projects.user_id = ?
                    """,
                    (clip_id, user["id"]),
                ).fetchone()
            if row is None:
                raise HTTPException(status_code=404, detail="Klip nie istnieje.")
            if payload.endSeconds <= payload.startSeconds or payload.endSeconds > float(row["duration_seconds"]):
                raise HTTPException(status_code=400, detail="Zakres eksportu jest nieprawidłowy.")

            export_id = str(uuid4())
            timestamp = now_iso()
            output = app_settings.export_dir / row["project_id"] / f"{export_id}.mp4"
            render_config = payload.renderConfig.model_dump()
            with database.connection() as connection:
                connection.execute(
                    """
                    INSERT INTO exports (
                      id, project_id, clip_id, status, output_path, render_config, created_at
                    ) VALUES (?, ?, ?, 'rendering', ?, ?, ?)
                    """,
                    (export_id, row["project_id"], clip_id, str(output), json.dumps(render_config), timestamp),
                )
            try:
                await render_function(
                    ffmpeg_path,
                    Path(row["source_path"]),
                    output,
                    payload.startSeconds,
                    payload.endSeconds,
                    render_config["ratio"],
                    render_config["quality"],
                )
            except asyncio.CancelledError:
                with database.connection() as connection:
                    connection.execute(
                        "UPDATE exports SET status = 'failed', error_message = ? WHERE id = ?",
                        ("Renderowanie zostało przerwane.", export_id),
                    )
                raise
            except Exception as exc:
                output.unlink(missing_ok=True)
                with database.connection() as connection:
                    connection.execute(
                        "UPDATE exports SET status = 'failed', error_message = ? WHERE id = ?",
                        (str(exc)[-1000:], export_id),
                    )
                logger.exception("Nie udało się wyrenderować klipu")
                raise HTTPException(status_code=500, detail="Nie udało się wyrenderować klipu.") from exc
            with database.connection() as connection:
                completed = connection.execute(
                    "UPDATE exports SET status = 'completed', completed_at = ? WHERE id = ?",
                    (now_iso(), export_id),
                )
            if completed.rowcount != 1 or not output.is_file():
                output.unlink(missing_ok=True)
                raise HTTPException(status_code=409, detail="Projekt zmienił się podczas renderowania.")
        return {
            "export": {
                "id": export_id,
                "status": "completed",
                "downloadUrl": f"/api/exports/{export_id}/download",
            }
        }

    @app.get("/api/exports/{export_id}/download")
    def download_export(
        export_id: str,
        user: dict[str, str] = Depends(current_user),
    ) -> FileResponse:
        with database.connection() as connection:
            row = connection.execute(
                """
                SELECT exports.output_path
                FROM exports JOIN projects ON projects.id = exports.project_id
                WHERE exports.id = ? AND projects.user_id = ? AND exports.status = 'completed'
                """,
                (export_id, user["id"]),
            ).fetchone()
        if row is None or not Path(row["output_path"]).is_file():
            raise HTTPException(status_code=404, detail="Eksport nie istnieje.")
        return FileResponse(
            row["output_path"],
            media_type="video/mp4",
            filename=f"cutwise-{export_id}.mp4",
        )

    @app.get("/api/projects/{project_id}/media")
    def project_media(
        project_id: str,
        token: str = Query(),
    ) -> FileResponse:
        user_id = decode_media_token(token, project_id, app_settings)
        with database.connection() as connection:
            row = connection.execute(
                """
                SELECT source_path, source_filename, mime_type
                FROM projects WHERE id = ? AND user_id = ?
                """,
                (project_id, user_id),
            ).fetchone()
        if row is None or not Path(row["source_path"]).is_file():
            raise HTTPException(status_code=404, detail="Plik projektu nie istnieje.")
        return FileResponse(
            row["source_path"],
            media_type=row["mime_type"],
            filename=row["source_filename"],
            content_disposition_type="inline",
        )

    @app.delete("/api/projects/{project_id}", status_code=204)
    async def delete_project(
        project_id: str,
        user: dict[str, str] = Depends(current_user),
    ) -> None:
        lock = project_lock(project_id)
        if lock.locked():
            raise HTTPException(status_code=409, detail="Poczekaj na zakończenie renderowania.")
        async with lock:
            with database.connection() as connection:
                row = connection.execute(
                    "SELECT source_path FROM projects WHERE id = ? AND user_id = ?",
                    (project_id, user["id"]),
                ).fetchone()
            if row is None:
                return

            source = Path(row["source_path"])
            quarantine = source.with_name(f"{source.name}.deleting-{uuid4()}")
            owns_journal = False
            try:
                with database.connection() as connection:
                    claim = connection.execute(
                        """
                        INSERT OR IGNORE INTO pending_file_deletions (
                          project_id, source_path, quarantine_path, created_at
                        ) VALUES (?, ?, ?, ?)
                        """,
                        (project_id, str(source), str(quarantine), now_iso()),
                    )
                    owns_journal = claim.rowcount == 1
                if not owns_journal:
                    return
                if source.exists():
                    source.replace(quarantine)
                with database.connection() as connection:
                    connection.execute(
                        "DELETE FROM projects WHERE id = ? AND user_id = ?",
                        (project_id, user["id"]),
                    )
            except Exception as exc:
                if quarantine.exists() and not source.exists():
                    quarantine.replace(source)
                if owns_journal:
                    with database.connection() as connection:
                        connection.execute(
                            "DELETE FROM pending_file_deletions WHERE project_id = ?",
                            (project_id,),
                        )
                logger.exception("Nie udało się usunąć projektu")
                raise HTTPException(status_code=500, detail="Nie udało się usunąć projektu.") from exc
            cleanup_pending_files(database)
            shutil.rmtree(app_settings.export_dir / project_id, ignore_errors=True)

    return app


app = create_app()
