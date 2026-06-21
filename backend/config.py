from __future__ import annotations

import secrets
import warnings
from pathlib import Path

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8", extra="ignore")

    port: int = 8787
    jwt_secret: str | None = None
    database_path: Path = Path("./data/cutwise.sqlite")
    upload_dir: Path = Path("./uploads")
    export_dir: Path = Path("./exports")
    max_upload_bytes: int = 5 * 1024 * 1024 * 1024
    max_video_seconds: float = 3 * 60 * 60
    ffmpeg_path: str | None = None
    ffprobe_path: str | None = None
    openai_api_key: str | None = None
    openai_text_model: str = "gpt-4.1-mini"
    openai_transcription_model: str = "gpt-4o-mini-transcribe"

    def finalized(self) -> "Settings":
        if not self.jwt_secret:
            self.jwt_secret = secrets.token_urlsafe(48)
            warnings.warn(
                "JWT_SECRET nie jest ustawiony. Wygenerowano sekret tymczasowy; "
                "sesje wygasną po restarcie API.",
                stacklevel=2,
            )
        self.database_path = self.database_path.resolve()
        self.upload_dir = self.upload_dir.resolve()
        self.export_dir = self.export_dir.resolve()
        return self


settings = Settings().finalized()
