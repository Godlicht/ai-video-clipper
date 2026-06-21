from __future__ import annotations

import asyncio
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
from backend.main import cleanup_pending_files, create_app
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
