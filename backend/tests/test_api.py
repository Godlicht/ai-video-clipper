from __future__ import annotations

import asyncio
import gc
import sqlite3
from concurrent.futures import CancelledError as FutureCancelledError
from pathlib import Path
from urllib.parse import quote

import jwt
import pytest
import httpx
from fastapi.testclient import TestClient

from backend.config import Settings
from backend.db import Database
from backend.main import cleanup_pending_exports, cleanup_pending_files, create_app
from backend.media import MediaInfo


@pytest.fixture
def api(tmp_path: Path):
    settings = Settings(
        jwt_secret="test-secret-with-enough-entropy-" * 2,
        database_path=Path(":memory:"),
        upload_dir=tmp_path / "uploads",
        export_dir=tmp_path / "exports",
        max_upload_bytes=1024 * 1024,
    ).finalized()
    database = Database(":memory:")

    async def valid_probe(file_path: Path, _ffprobe_path: str) -> MediaInfo:
        format_name = "matroska,webm" if file_path.suffix == ".webm" else "mov,mp4,m4a,3gp,3g2,mj2"
        return MediaInfo(duration=60, format_name=format_name, has_video=True)

    app = create_app(settings, database, valid_probe)
    with TestClient(app) as client:
        yield client, database, settings
    database.close()


def register(client: TestClient, email: str = "jakub@example.com") -> str:
    response = client.post(
        "/api/auth/register",
        json={"name": "Jakub", "email": email, "password": "bezpieczne-haslo"},
    )
    assert response.status_code == 201
    return response.json()["token"]


def auth(token: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {token}"}


def upload(
    client: TestClient,
    token: str | None,
    filename: str,
    content: bytes,
    mime_type: str,
    title: str | None = None,
):
    headers = {
        "X-Filename": quote(filename),
        "X-Mime-Type": mime_type,
        **(auth(token) if token else {}),
    }
    if title:
        headers["X-Project-Title"] = quote(title)
    return client.post("/api/projects", headers=headers, content=content)


def test_register_login_and_profile(api):
    client, _database, _settings = api
    token = register(client)

    login = client.post(
        "/api/auth/login",
        json={"email": "JAKUB@example.com", "password": "bezpieczne-haslo"},
    )
    assert login.status_code == 200

    profile = client.get("/api/auth/me", headers=auth(token))
    assert profile.status_code == 200
    assert profile.json()["user"] == {
        "id": profile.json()["user"]["id"],
        "name": "Jakub",
        "email": "jakub@example.com",
    }


def test_duplicate_account_and_bad_login(api):
    client, _database, _settings = api
    register(client)
    duplicate = client.post(
        "/api/auth/register",
        json={"name": "Drugi", "email": "jakub@example.com", "password": "inne-haslo"},
    )
    assert duplicate.status_code == 409
    bad_login = client.post(
        "/api/auth/login",
        json={"email": "jakub@example.com", "password": "zle-haslo"},
    )
    assert bad_login.status_code == 401


def test_forged_token_for_missing_user_is_rejected(api):
    client, _database, settings = api
    token = jwt.encode(
        {"sub": "missing-user", "email": "ghost@example.com", "name": "Ghost", "iss": "cutwise"},
        settings.jwt_secret,
        algorithm="HS256",
    )
    assert client.get("/api/auth/me", headers=auth(token)).status_code == 401


def test_media_token_cannot_be_used_as_session(api):
    client, _database, _settings = api
    token = register(client)
    project = upload(client, token, "private.mp4", b"video", "video/mp4").json()["project"]
    media_access = client.post(
        f"/api/projects/{project['id']}/media-access",
        headers=auth(token),
    )
    media_token = media_access.json()["url"].split("token=", 1)[1]

    assert client.get("/api/projects", headers=auth(media_token)).status_code == 401
    assert client.delete(
        f"/api/projects/{project['id']}",
        headers=auth(media_token),
    ).status_code == 401


def test_upload_list_media_and_delete_project(api):
    client, _database, settings = api
    token = register(client)

    created = upload(client, token, "podcast.mp4", b"video-content", "video/mp4", "Mój podcast")
    assert created.status_code == 201
    project = created.json()["project"]
    assert project["status"] == "uploaded"
    assert project["durationSeconds"] == 60
    assert len(list(settings.upload_dir.iterdir())) == 1

    projects = client.get("/api/projects", headers=auth(token))
    assert projects.status_code == 200
    assert len(projects.json()["projects"]) == 1

    media_access = client.post(
        f"/api/projects/{project['id']}/media-access",
        headers=auth(token),
    )
    assert media_access.status_code == 200
    media = client.get(media_access.json()["url"])
    assert media.status_code == 200
    assert media.content == b"video-content"
    ranged_media = client.get(media_access.json()["url"], headers={"Range": "bytes=0-4"})
    assert ranged_media.status_code == 206
    assert ranged_media.content == b"video"
    assert client.get(f"/api/projects/{project['id']}/media?token=invalid").status_code == 401

    deleted = client.delete(f"/api/projects/{project['id']}", headers=auth(token))
    assert deleted.status_code == 204
    assert list(settings.upload_dir.iterdir()) == []


def test_upload_canonicalizes_generic_or_mismatched_mime(api):
    client, _database, _settings = api
    token = register(client)

    mov = upload(client, token, "recording.mov", b"video", "application/octet-stream")
    assert mov.status_code == 201
    assert mov.json()["project"]["mimeType"] == "video/quicktime"

    webm = upload(client, token, "recording.webm", b"video", "video/mp4")
    assert webm.status_code == 201
    assert webm.json()["project"]["mimeType"] == "video/webm"


def test_analysis_persists_clips_and_allows_updates(api):
    client, _database, _settings = api
    token = register(client)
    project = upload(client, token, "analysis.mp4", b"video", "video/mp4").json()["project"]

    analyzed = client.post(f"/api/projects/{project['id']}/analysis", headers=auth(token))
    assert analyzed.status_code == 200
    clips = analyzed.json()["clips"]
    assert clips
    assert clips[0]["projectId"] == project["id"]

    listed = client.get(f"/api/projects/{project['id']}/clips", headers=auth(token))
    assert listed.status_code == 200
    assert listed.json()["clips"] == clips

    updated = client.patch(
        f"/api/clips/{clips[0]['id']}",
        headers=auth(token),
        json={
            "title": "Poprawiony klip",
            "startSeconds": 1,
            "endSeconds": 12,
            "selected": True,
            "renderConfig": {
                "ratio": "1:1",
                "quality": "720p",
                "captionsEnabled": False,
                "trackingEnabled": False,
            },
        },
    )
    assert updated.status_code == 200
    assert updated.json()["clip"]["title"] == "Poprawiony klip"
    assert updated.json()["clip"]["selected"] is True
    assert updated.json()["clip"]["renderConfig"]["ratio"] == "1:1"


def test_reanalysis_uses_prompt_length_preferences_and_new_ranges(api):
    client, _database, _settings = api
    token = register(client)
    project = upload(client, token, "regenerate.mp4", b"video", "video/mp4").json()["project"]

    first = client.post(
        f"/api/projects/{project['id']}/analysis",
        headers=auth(token),
        json={"prompt": "najmocniejsze cytaty", "minClipSeconds": 20, "maxClipSeconds": 45},
    ).json()["clips"]
    second = client.post(
        f"/api/projects/{project['id']}/analysis",
        headers=auth(token),
        json={"prompt": "najmocniejsze cytaty", "minClipSeconds": 20, "maxClipSeconds": 45},
    ).json()["clips"]

    assert first[0]["title"].startswith("Mocny cytat")
    assert 20 <= first[0]["end"] - first[0]["start"] <= 45
    assert (first[0]["start"], first[0]["end"]) != (second[0]["start"], second[0]["end"])


def test_export_renders_and_downloads_private_mp4(tmp_path: Path):
    settings = Settings(
        jwt_secret="test-secret-with-enough-entropy-" * 2,
        database_path=Path(":memory:"),
        upload_dir=tmp_path / "uploads",
        export_dir=tmp_path / "exports",
    ).finalized()
    database = Database(":memory:")

    async def valid_probe(_file_path: Path, _ffprobe_path: str) -> MediaInfo:
        return MediaInfo(duration=60, format_name="mov,mp4,m4a,3gp,3g2,mj2", has_video=True)

    async def fake_render(
        _ffmpeg: str,
        _source: Path,
        output: Path,
        _start: float,
        _end: float,
        _ratio: str,
        _quality: str,
    ) -> None:
        output.parent.mkdir(parents=True, exist_ok=True)
        output.write_bytes(b"rendered-mp4")

    app = create_app(settings, database, valid_probe, fake_render)
    with TestClient(app) as client:
        token = register(client)
        other_token = register(client, "other@example.com")
        project = upload(client, token, "export.mp4", b"video", "video/mp4").json()["project"]
        clip = client.post(
            f"/api/projects/{project['id']}/analysis",
            headers=auth(token),
        ).json()["clips"][0]
        exported = client.post(
            f"/api/clips/{clip['id']}/exports",
            headers=auth(token),
            json={
                "startSeconds": clip["start"],
                "endSeconds": clip["end"],
                "renderConfig": clip["renderConfig"],
            },
        )
        assert exported.status_code == 201
        download_url = exported.json()["export"]["downloadUrl"]
        assert client.get(download_url, headers=auth(other_token)).status_code == 404
        downloaded = client.get(download_url, headers=auth(token))
        assert downloaded.status_code == 200
        assert downloaded.content == b"rendered-mp4"
    database.close()


def test_render_blocks_delete_and_reanalysis_until_completed(tmp_path: Path):
    settings = Settings(
        jwt_secret="test-secret-with-enough-entropy-" * 2,
        database_path=Path(":memory:"),
        upload_dir=tmp_path / "uploads",
        export_dir=tmp_path / "exports",
    ).finalized()
    database = Database(":memory:")
    render_started = asyncio.Event()
    release_render = asyncio.Event()

    async def valid_probe(_file_path: Path, _ffprobe_path: str) -> MediaInfo:
        return MediaInfo(duration=60, format_name="mov,mp4,m4a,3gp,3g2,mj2", has_video=True)

    async def slow_render(
        _ffmpeg: str,
        _source: Path,
        output: Path,
        _start: float,
        _end: float,
        _ratio: str,
        _quality: str,
    ) -> None:
        render_started.set()
        await release_render.wait()
        output.parent.mkdir(parents=True, exist_ok=True)
        output.write_bytes(b"rendered")

    app = create_app(settings, database, valid_probe, slow_render)
    with TestClient(app) as client:
        token = register(client)
        project = upload(client, token, "race.mp4", b"video", "video/mp4").json()["project"]
        clip = client.post(
            f"/api/projects/{project['id']}/analysis",
            headers=auth(token),
        ).json()["clips"][0]

        async def scenario():
            transport = httpx.ASGITransport(app=app)
            async with httpx.AsyncClient(transport=transport, base_url="http://test") as async_client:
                export_task = asyncio.create_task(async_client.post(
                    f"/api/clips/{clip['id']}/exports",
                    headers=auth(token),
                    json={
                        "startSeconds": clip["start"],
                        "endSeconds": clip["end"],
                        "renderConfig": clip["renderConfig"],
                    },
                ))
                await render_started.wait()
                deleted = await async_client.delete(
                    f"/api/projects/{project['id']}",
                    headers=auth(token),
                )
                analyzed = await async_client.post(
                    f"/api/projects/{project['id']}/analysis",
                    headers=auth(token),
                )
                release_render.set()
                exported = await export_task
                downloaded = await async_client.get(
                    exported.json()["export"]["downloadUrl"],
                    headers=auth(token),
                )
                return deleted, analyzed, exported, downloaded

        deleted, analyzed, exported, downloaded = asyncio.run(scenario())
        assert deleted.status_code == 409
        assert analyzed.status_code == 409
        assert exported.status_code == 201
        assert downloaded.status_code == 200
        assert downloaded.content == b"rendered"
    database.close()


def test_unexpected_renderer_error_marks_export_failed(tmp_path: Path, monkeypatch):
    settings = Settings(
        jwt_secret="test-secret-with-enough-entropy-" * 2,
        database_path=Path(":memory:"),
        upload_dir=tmp_path / "uploads",
        export_dir=tmp_path / "exports",
    ).finalized()
    database = Database(":memory:")

    async def valid_probe(_file_path: Path, _ffprobe_path: str) -> MediaInfo:
        return MediaInfo(duration=60, format_name="mov,mp4,m4a,3gp,3g2,mj2", has_video=True)

    async def broken_render(
        _ffmpeg: str,
        _source: Path,
        output: Path,
        _start: float,
        _end: float,
        _ratio: str,
        _quality: str,
    ) -> None:
        output.parent.mkdir(parents=True, exist_ok=True)
        output.write_bytes(b"partial")
        raise ValueError("unexpected")

    app = create_app(settings, database, valid_probe, broken_render)
    original_unlink = Path.unlink

    def fail_partial_cleanup(path: Path, *args, **kwargs):
        if path.name.endswith(".mp4") and path.parent.parent == settings.export_dir:
            raise PermissionError("locked")
        return original_unlink(path, *args, **kwargs)

    monkeypatch.setattr(Path, "unlink", fail_partial_cleanup)
    with TestClient(app) as client:
        token = register(client)
        project = upload(client, token, "broken.mp4", b"video", "video/mp4").json()["project"]
        clip = client.post(
            f"/api/projects/{project['id']}/analysis",
            headers=auth(token),
        ).json()["clips"][0]
        response = client.post(
            f"/api/clips/{clip['id']}/exports",
            headers=auth(token),
            json={
                "startSeconds": clip["start"],
                "endSeconds": clip["end"],
                "renderConfig": clip["renderConfig"],
            },
        )
        assert response.status_code == 500
        with database.connection() as connection:
            export = connection.execute("SELECT status, error_message FROM exports").fetchone()
            pending = connection.execute("SELECT path FROM pending_export_deletions").fetchone()
        assert export["status"] == "failed"
        assert "unexpected" in export["error_message"]
        assert pending is not None

    monkeypatch.setattr(Path, "unlink", original_unlink)
    cleanup_pending_exports(database)
    with database.connection() as connection:
        assert connection.execute("SELECT COUNT(*) FROM pending_export_deletions").fetchone()[0] == 0
    assert not Path(pending["path"]).exists()
    database.close()


def test_project_locks_do_not_accumulate_for_missing_ids(api):
    client, _database, _settings = api
    token = register(client)
    for index in range(100):
        response = client.post(f"/api/projects/missing-{index}/analysis", headers=auth(token))
        assert response.status_code == 404
    gc.collect()
    assert len(client.app.state.project_locks) == 0


def test_projects_are_isolated_between_users(api):
    client, _database, _settings = api
    first = register(client, "first@example.com")
    second = register(client, "second@example.com")
    created = upload(client, first, "private.webm", b"video-content", "video/webm").json()["project"]

    assert client.get(f"/api/projects/{created['id']}", headers=auth(second)).status_code == 404
    assert client.post(
        f"/api/projects/{created['id']}/media-access",
        headers=auth(second),
    ).status_code == 404


def test_rejects_unauthenticated_and_wrong_extension(api):
    client, _database, _settings = api
    unauthenticated = upload(client, None, "video.mp4", b"video", "video/mp4")
    assert unauthenticated.status_code == 401

    token = register(client)
    invalid = upload(client, token, "notes.txt", b"text", "text/plain")
    assert invalid.status_code == 400


def test_request_limit_rejects_before_endpoint_parses_upload(api):
    client, _database, settings = api
    oversized = b"x" * (settings.max_upload_bytes + 9 * 1024 * 1024)
    response = upload(client, None, "oversized.mp4", oversized, "video/mp4")
    assert response.status_code == 413
    assert list(settings.upload_dir.iterdir()) == []


def test_chunked_request_limit_returns_413_and_cleans_destination(api):
    client, _database, settings = api
    token = register(client)

    async def scenario():
        async def chunks():
            yield b"x" * 700_000
            yield b"y" * 700_000

        transport = httpx.ASGITransport(app=client.app)
        async with httpx.AsyncClient(transport=transport, base_url="http://test") as async_client:
            return await async_client.post(
                "/api/projects",
                headers={
                    **auth(token),
                    "X-Filename": "chunked.mp4",
                    "X-Mime-Type": "video/mp4",
                },
                content=chunks(),
            )

    response = asyncio.run(scenario())
    assert response.status_code == 413
    assert list(settings.upload_dir.iterdir()) == []


def test_invalid_media_is_removed(tmp_path: Path):
    settings = Settings(
        jwt_secret="test-secret-with-enough-entropy-" * 2,
        database_path=Path(":memory:"),
        upload_dir=tmp_path / "uploads",
        export_dir=tmp_path / "exports",
    ).finalized()
    database = Database(":memory:")

    async def reject_probe(_file_path: Path, _ffprobe_path: str):
        return None

    with TestClient(create_app(settings, database, reject_probe)) as client:
        token = register(client)
        response = upload(client, token, "fake.mp4", b"not-video", "video/mp4")
        assert response.status_code == 400
        assert list(settings.upload_dir.iterdir()) == []
    database.close()


def test_file_is_removed_when_database_insert_fails(api):
    client, database, settings = api
    token = register(client)
    with database.connection() as connection:
        connection.execute("DROP TABLE projects")

    response = upload(client, token, "valid.mp4", b"video", "video/mp4")
    assert response.status_code == 500
    assert list(settings.upload_dir.iterdir()) == []


def test_cancelled_upload_removes_destination(tmp_path: Path):
    settings = Settings(
        jwt_secret="test-secret-with-enough-entropy-" * 2,
        database_path=Path(":memory:"),
        upload_dir=tmp_path / "uploads",
        export_dir=tmp_path / "exports",
    ).finalized()
    database = Database(":memory:")

    async def cancelled_probe(_file_path: Path, _ffprobe_path: str):
        raise asyncio.CancelledError

    with TestClient(create_app(settings, database, cancelled_probe), raise_server_exceptions=True) as client:
        token = register(client)
        with pytest.raises((asyncio.CancelledError, FutureCancelledError)):
            upload(client, token, "cancelled.mp4", b"video", "video/mp4")
        assert list(settings.upload_dir.iterdir()) == []
    database.close()


def test_delete_uses_durable_cleanup_journal(api, monkeypatch):
    client, database, settings = api
    token = register(client)
    project = upload(client, token, "delete.mp4", b"video", "video/mp4").json()["project"]

    original_unlink = Path.unlink

    def fail_quarantine_once(path: Path, *args, **kwargs):
        if ".deleting-" in path.name:
            raise OSError("locked")
        return original_unlink(path, *args, **kwargs)

    monkeypatch.setattr(Path, "unlink", fail_quarantine_once)
    response = client.delete(f"/api/projects/{project['id']}", headers=auth(token))
    assert response.status_code == 204
    with database.connection() as connection:
        assert connection.execute("SELECT COUNT(*) FROM projects").fetchone()[0] == 0
        assert connection.execute("SELECT COUNT(*) FROM pending_file_deletions").fetchone()[0] == 1

    monkeypatch.setattr(Path, "unlink", original_unlink)
    cleanup_pending_files(database)
    with database.connection() as connection:
        assert connection.execute("SELECT COUNT(*) FROM pending_file_deletions").fetchone()[0] == 0
    assert list(settings.upload_dir.iterdir()) == []


def test_cleanup_recovers_crash_before_quarantine_rename(api):
    client, database, settings = api
    token = register(client)
    project = upload(client, token, "crash.mp4", b"video", "video/mp4").json()["project"]
    source = next(settings.upload_dir.iterdir())
    quarantine = source.with_name(f"{source.name}.deleting-crash")

    with database.connection() as connection:
        connection.execute(
            """
            INSERT INTO pending_file_deletions (
              project_id, source_path, quarantine_path, created_at
            ) VALUES (?, ?, ?, ?)
            """,
            (project["id"], str(source), str(quarantine), "2026-01-01T00:00:00+00:00"),
        )

    cleanup_pending_files(database)
    with database.connection() as connection:
        assert connection.execute("SELECT COUNT(*) FROM projects").fetchone()[0] == 0
        assert connection.execute("SELECT COUNT(*) FROM pending_file_deletions").fetchone()[0] == 0
    assert not source.exists()
    assert not quarantine.exists()


def test_second_delete_does_not_remove_existing_cleanup_claim(api):
    client, database, settings = api
    token = register(client)
    project = upload(client, token, "claimed.mp4", b"video", "video/mp4").json()["project"]
    source = next(settings.upload_dir.iterdir())
    quarantine = source.with_name(f"{source.name}.deleting-owner")

    with database.connection() as connection:
        connection.execute(
            """
            INSERT INTO pending_file_deletions (
              project_id, source_path, quarantine_path, created_at
            ) VALUES (?, ?, ?, ?)
            """,
            (project["id"], str(source), str(quarantine), "2026-01-01T00:00:00+00:00"),
        )

    response = client.delete(f"/api/projects/{project['id']}", headers=auth(token))
    assert response.status_code == 204
    with database.connection() as connection:
        journal = connection.execute(
            "SELECT source_path, quarantine_path FROM pending_file_deletions WHERE project_id = ?",
            (project["id"],),
        ).fetchone()
        assert journal is not None
        assert journal["source_path"] == str(source)
        assert journal["quarantine_path"] == str(quarantine)
        assert connection.execute(
            "SELECT COUNT(*) FROM projects WHERE id = ?",
            (project["id"],),
        ).fetchone()[0] == 1
    assert source.exists()
    assert not quarantine.exists()


def test_legacy_cleanup_migration_keeps_work_for_retry(tmp_path: Path):
    database_path = tmp_path / "legacy.sqlite3"
    pending_file = tmp_path / "legacy-upload.mp4"
    pending_file.write_bytes(b"video")

    connection = sqlite3.connect(database_path)
    connection.execute(
        "CREATE TABLE pending_file_deletions (path TEXT PRIMARY KEY, created_at TEXT NOT NULL)"
    )
    connection.execute(
        "INSERT INTO pending_file_deletions (path, created_at) VALUES (?, ?)",
        (str(pending_file), "2026-01-01T00:00:00+00:00"),
    )
    connection.commit()
    connection.close()

    database = Database(database_path)
    with database.connection() as migrated:
        row = migrated.execute(
            "SELECT project_id, source_path, quarantine_path FROM pending_file_deletions"
        ).fetchone()
    assert row is not None
    assert row["project_id"].startswith("legacy-")
    assert row["source_path"] == str(pending_file)
    assert row["quarantine_path"] == str(pending_file)
    assert pending_file.exists()

    cleanup_pending_files(database)
    with database.connection() as cleaned:
        assert cleaned.execute("SELECT COUNT(*) FROM pending_file_deletions").fetchone()[0] == 0
    assert not pending_file.exists()
