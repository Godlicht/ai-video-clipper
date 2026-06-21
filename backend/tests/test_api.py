from __future__ import annotations

import asyncio
from concurrent.futures import CancelledError as FutureCancelledError
from pathlib import Path

import jwt
import pytest
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

    created = client.post(
        "/api/projects",
        headers=auth(token),
        data={"title": "Mój podcast"},
        files={"video": ("podcast.mp4", b"video-content", "video/mp4")},
    )
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


def test_projects_are_isolated_between_users(api):
    client, _database, _settings = api
    first = register(client, "first@example.com")
    second = register(client, "second@example.com")
    created = client.post(
        "/api/projects",
        headers=auth(first),
        files={"video": ("private.webm", b"video-content", "video/webm")},
    ).json()["project"]

    assert client.get(f"/api/projects/{created['id']}", headers=auth(second)).status_code == 404
    assert client.post(
        f"/api/projects/{created['id']}/media-access",
        headers=auth(second),
    ).status_code == 404


def test_rejects_unauthenticated_and_wrong_extension(api):
    client, _database, _settings = api
    unauthenticated = client.post(
        "/api/projects",
        files={"video": ("video.mp4", b"video", "video/mp4")},
    )
    assert unauthenticated.status_code == 401

    token = register(client)
    invalid = client.post(
        "/api/projects",
        headers=auth(token),
        files={"video": ("notes.txt", b"text", "text/plain")},
    )
    assert invalid.status_code == 400


def test_request_limit_rejects_before_endpoint_parses_upload(api):
    client, _database, settings = api
    oversized = b"x" * (settings.max_upload_bytes + 9 * 1024 * 1024)
    response = client.post(
        "/api/projects",
        files={"video": ("oversized.mp4", oversized, "video/mp4")},
    )
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
        response = client.post(
            "/api/projects",
            headers=auth(token),
            files={"video": ("fake.mp4", b"not-video", "video/mp4")},
        )
        assert response.status_code == 400
        assert list(settings.upload_dir.iterdir()) == []
    database.close()


def test_file_is_removed_when_database_insert_fails(api):
    client, database, settings = api
    token = register(client)
    with database.connection() as connection:
        connection.execute("DROP TABLE projects")

    response = client.post(
        "/api/projects",
        headers=auth(token),
        files={"video": ("valid.mp4", b"video", "video/mp4")},
    )
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
            client.post(
                "/api/projects",
                headers=auth(token),
                files={"video": ("cancelled.mp4", b"video", "video/mp4")},
            )
        assert list(settings.upload_dir.iterdir()) == []
    database.close()


def test_delete_uses_durable_cleanup_journal(api, monkeypatch):
    client, database, settings = api
    token = register(client)
    project = client.post(
        "/api/projects",
        headers=auth(token),
        files={"video": ("delete.mp4", b"video", "video/mp4")},
    ).json()["project"]

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
