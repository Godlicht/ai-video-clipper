from __future__ import annotations

from datetime import UTC, datetime, timedelta
import jwt
from fastapi import Depends, HTTPException
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from pwdlib import PasswordHash

from .config import Settings
from .db import Database


password_hash = PasswordHash.recommended()
bearer = HTTPBearer(auto_error=False)


def hash_password(password: str) -> str:
    return password_hash.hash(password)


def verify_password(password: str, hashed: str) -> bool:
    return password_hash.verify(password, hashed)


def create_token(user: dict[str, str], settings: Settings) -> str:
    now = datetime.now(UTC)
    payload = {
        "sub": user["id"],
        "email": user["email"],
        "name": user["name"],
        "scope": "session",
        "iss": "cutwise",
        "iat": now,
        "exp": now + timedelta(days=7),
    }
    return jwt.encode(payload, settings.jwt_secret, algorithm="HS256")


def create_media_token(user_id: str, project_id: str, settings: Settings) -> str:
    now = datetime.now(UTC)
    return jwt.encode(
        {
            "sub": user_id,
            "project_id": project_id,
            "scope": "project_media",
            "iss": "cutwise",
            "iat": now,
            "exp": now + timedelta(hours=4),
        },
        settings.jwt_secret,
        algorithm="HS256",
    )


def decode_media_token(token: str, project_id: str, settings: Settings) -> str:
    try:
        payload = jwt.decode(token, settings.jwt_secret, algorithms=["HS256"], issuer="cutwise")
    except jwt.PyJWTError as exc:
        raise HTTPException(status_code=401, detail="Link do nagrania wygasł.") from exc
    if payload.get("scope") != "project_media" or payload.get("project_id") != project_id:
        raise HTTPException(status_code=403, detail="Link nie uprawnia do tego nagrania.")
    user_id = payload.get("sub")
    if not isinstance(user_id, str):
        raise HTTPException(status_code=401, detail="Nieprawidłowy link do nagrania.")
    return user_id


def auth_dependency(database: Database, settings: Settings):
    def current_user(
        credentials: HTTPAuthorizationCredentials | None = Depends(bearer),
    ) -> dict[str, str]:
        if credentials is None:
            raise HTTPException(status_code=401, detail="Brak tokenu autoryzacyjnego.")
        try:
            payload = jwt.decode(
                credentials.credentials,
                settings.jwt_secret,
                algorithms=["HS256"],
                issuer="cutwise",
            )
        except jwt.PyJWTError as exc:
            raise HTTPException(status_code=401, detail="Sesja wygasła lub token jest nieprawidłowy.") from exc

        if payload.get("scope") != "session":
            raise HTTPException(status_code=401, detail="Token nie uprawnia do korzystania z API.")
        user_id = payload.get("sub")
        with database.connection() as connection:
            row = connection.execute(
                "SELECT id, email, name FROM users WHERE id = ?",
                (user_id,),
            ).fetchone()
        if row is None:
            raise HTTPException(status_code=401, detail="Konto powiązane z sesją nie istnieje.")
        return dict(row)

    return current_user
