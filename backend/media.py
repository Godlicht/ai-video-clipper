from __future__ import annotations

import asyncio
import json
import os
from dataclasses import dataclass
from pathlib import Path


@dataclass(frozen=True)
class MediaInfo:
    duration: float
    format_name: str
    has_video: bool


_probe_semaphore = asyncio.Semaphore(2)


def resolve_media_tool(tool: str, configured: str | None = None) -> str:
    if configured:
        return configured
    if os.name == "nt":
        local_app_data = os.environ.get("LOCALAPPDATA")
        if local_app_data:
            package_root = (
                Path(local_app_data)
                / "Microsoft"
                / "WinGet"
                / "Packages"
                / "Gyan.FFmpeg_Microsoft.Winget.Source_8wekyb3d8bbwe"
            )
            try:
                version_dir = next(path for path in package_root.iterdir() if path.name.startswith("ffmpeg-"))
                executable = version_dir / "bin" / f"{tool}.exe"
                if executable.exists():
                    return str(executable)
            except (OSError, StopIteration):
                pass
    return tool


async def probe_media(file_path: Path, ffprobe_path: str, timeout_seconds: float = 15) -> MediaInfo | None:
    process: asyncio.subprocess.Process | None = None
    try:
        async with asyncio.timeout(timeout_seconds):
            await _probe_semaphore.acquire()
            try:
                process = await asyncio.create_subprocess_exec(
                    ffprobe_path,
                    "-v",
                    "error",
                    "-show_entries",
                    "format=duration,format_name:stream=codec_type",
                    "-of",
                    "json",
                    str(file_path),
                    stdout=asyncio.subprocess.PIPE,
                    stderr=asyncio.subprocess.PIPE,
                )
                stdout, _stderr = await process.communicate()
            finally:
                _probe_semaphore.release()
    except TimeoutError:
        if process and process.returncode is None:
            process.kill()
            await process.wait()
        return None
    except asyncio.CancelledError:
        if process and process.returncode is None:
            process.kill()
            await process.wait()
        raise
    except OSError:
        return None

    if process is None or process.returncode != 0 or len(stdout) > 1_000_000:
        return None
    try:
        payload = json.loads(stdout)
        duration = float(payload.get("format", {}).get("duration", 0))
        format_name = str(payload.get("format", {}).get("format_name", ""))
        has_video = any(stream.get("codec_type") == "video" for stream in payload.get("streams", []))
    except (ValueError, TypeError, json.JSONDecodeError):
        return None
    if duration <= 0 or not has_video:
        return None
    return MediaInfo(duration=duration, format_name=format_name, has_video=has_video)


def format_matches_extension(extension: str, format_name: str) -> bool:
    formats = set(format_name.split(","))
    if extension == ".webm":
        return "webm" in formats
    return bool(formats.intersection({"mov", "mp4", "m4a", "3gp", "3g2", "mj2"}))
