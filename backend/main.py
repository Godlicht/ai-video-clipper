from __future__ import annotations

import asyncio
import logging
import sqlite3
from collections.abc import Awaitable, Callable
from datetime import UTC, datetime
from pathlib import Path
from uuid import uuid4

from fastapi import Depends, FastAPI, File, Form, HTTPException, Query, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from pydantic import BaseModel, EmailStr, Field

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
from .middleware import RequestSizeLimitMiddleware


logger = logging.getLogger("cutwise")
ALLOWED_MIME_TYPES = {"video/mp4", "video/quicktime", "video/webm"}
ALLOWED_EXTENSIONS = {".mp4", ".mov", ".webm"}


class RegisterRequest(BaseModel):
    name: str = Field(min_length=2, max_length=80)
    email: EmailStr
    password: str = Field(min_length=8, max_length=128)


class LoginRequest(BaseModel):
    email: EmailStr
    password: str = Field(min_length=8, max_length=128)


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


ProbeFunction = Callable[[Path, str], Awaitable[MediaInfo | None]]


def cleanup_pending_files(database: Database) -> None:
    with database.connection() as connection:
        rows = connection.execute("SELECT path FROM pending_file_deletions").fetchall()
    for row in rows:
        file_path = Path(row["path"])
        try:
            file_path.unlink(missing_ok=True)
        except OSError:
            logger.warning("Nie udało się jeszcze usunąć pliku %s", file_path)
            continue
        with database.connection() as connection:
            connection.execute("DELETE FROM pending_file_deletions WHERE path = ?", (str(file_path),))


def create_app(
    app_settings: Settings | None = None,
    database: Database | None = None,
    probe_function: ProbeFunction = probe_media,
) -> FastAPI:
    app_settings = (app_settings or default_settings).finalized()
    app_settings.upload_dir.mkdir(parents=True, exist_ok=True)
    app_settings.export_dir.mkdir(parents=True, exist_ok=True)
    database = database or Database(app_settings.database_path)
    cleanup_pending_files(database)
    current_user = auth_dependency(database, app_settings)
    ffprobe_path = resolve_media_tool("ffprobe", app_settings.ffprobe_path)

    app = FastAPI(title="Cutwise API", version="0.2.0")
    app.state.settings = app_settings
    app.state.database = database
    app.add_middleware(
        RequestSizeLimitMiddleware,
        max_bytes=app_settings.max_upload_bytes + 8 * 1024 * 1024,
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
        video: UploadFile = File(),
        title: str | None = Form(default=None),
        user: dict[str, str] = Depends(current_user),
    ) -> dict:
        original_name = Path(video.filename or "video").name
        extension = Path(original_name).suffix.lower()
        if video.content_type not in ALLOWED_MIME_TYPES or extension not in ALLOWED_EXTENSIONS:
            raise HTTPException(status_code=400, detail="Dozwolone są wyłącznie pliki MP4, MOV i WebM.")

        destination = app_settings.upload_dir / f"{uuid4()}{extension}"
        written = 0
        try:
            with destination.open("xb") as output:
                while chunk := await video.read(1024 * 1024):
                    written += len(chunk)
                    if written > app_settings.max_upload_bytes:
                        raise HTTPException(status_code=413, detail="Plik przekracza limit 5 GB.")
                    output.write(chunk)

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
            project_title = (title or Path(original_name).stem).strip()[:160] or "Nowy projekt"
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
                        video.content_type,
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
        finally:
            await video.close()
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
    def delete_project(
        project_id: str,
        user: dict[str, str] = Depends(current_user),
    ) -> None:
        with database.connection() as connection:
            row = connection.execute(
                "SELECT source_path FROM projects WHERE id = ? AND user_id = ?",
                (project_id, user["id"]),
            ).fetchone()
        if row is None:
            raise HTTPException(status_code=404, detail="Projekt nie istnieje.")

        source = Path(row["source_path"])
        quarantine = source.with_name(f"{source.name}.deleting-{uuid4()}")
        try:
            if source.exists():
                source.replace(quarantine)
            with database.connection() as connection:
                connection.execute(
                    "INSERT INTO pending_file_deletions (path, created_at) VALUES (?, ?)",
                    (str(quarantine), now_iso()),
                )
                connection.execute(
                    "DELETE FROM projects WHERE id = ? AND user_id = ?",
                    (project_id, user["id"]),
                )
        except Exception as exc:
            if quarantine.exists() and not source.exists():
                quarantine.replace(source)
            logger.exception("Nie udało się usunąć projektu")
            raise HTTPException(status_code=500, detail="Nie udało się usunąć projektu.") from exc
        cleanup_pending_files(database)

    return app


app = create_app()
