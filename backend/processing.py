from __future__ import annotations

import asyncio
import math
from dataclasses import dataclass
from pathlib import Path


@dataclass(frozen=True)
class ClipCandidate:
    title: str
    description: str
    reason: str
    start: float
    end: float
    score: int


def generate_clip_candidates(duration: float) -> list[ClipCandidate]:
    if duration <= 0:
        return []

    count = min(4, max(1, math.ceil(duration / 90)))
    clip_length = min(60.0, max(8.0, duration / max(1.0, count * 1.6)))
    candidates: list[ClipCandidate] = []
    for index in range(count):
        center = duration * (index + 1) / (count + 1)
        start = max(0.0, min(duration - clip_length, center - clip_length / 2))
        end = min(duration, start + clip_length)
        candidates.append(
            ClipCandidate(
                title=f"Najciekawszy moment {index + 1}",
                description="Samodzielny fragment wybrany równomiernie z przebiegu nagrania.",
                reason="Dobry punkt startowy do szybkiego przejrzenia i dopracowania klipu.",
                start=round(start, 3),
                end=round(end, 3),
                score=max(70, 88 - index * 4),
            )
        )
    return candidates


def output_dimensions(ratio: str, quality: str) -> tuple[int, int]:
    base = {"720p": 720, "1080p": 1080, "4K": 2160}[quality]
    if ratio == "9:16":
        return base, round(base * 16 / 9)
    if ratio == "1:1":
        return base, base
    return round(base * 16 / 9), base


_render_semaphore = asyncio.Semaphore(1)


async def render_clip(
    ffmpeg_path: str,
    source: Path,
    output: Path,
    start: float,
    end: float,
    ratio: str,
    quality: str,
    timeout_seconds: float = 600,
) -> None:
    width, height = output_dimensions(ratio, quality)
    duration = end - start
    output.parent.mkdir(parents=True, exist_ok=True)
    process: asyncio.subprocess.Process | None = None
    async with _render_semaphore:
        try:
            process = await asyncio.create_subprocess_exec(
                ffmpeg_path,
                "-y",
                "-ss",
                f"{start:.3f}",
                "-i",
                str(source),
                "-t",
                f"{duration:.3f}",
                "-vf",
                (
                    f"scale={width}:{height}:force_original_aspect_ratio=decrease,"
                    f"pad={width}:{height}:(ow-iw)/2:(oh-ih)/2:black"
                ),
                "-c:v",
                "libx264",
                "-preset",
                "veryfast",
                "-crf",
                "22",
                "-c:a",
                "aac",
                "-b:a",
                "160k",
                "-movflags",
                "+faststart",
                str(output),
                stdout=asyncio.subprocess.DEVNULL,
                stderr=asyncio.subprocess.PIPE,
            )
            _stdout, stderr = await asyncio.wait_for(process.communicate(), timeout=timeout_seconds)
        except (TimeoutError, asyncio.CancelledError):
            if process and process.returncode is None:
                process.kill()
                await process.wait()
            output.unlink(missing_ok=True)
            raise
        if process.returncode != 0:
            output.unlink(missing_ok=True)
            message = stderr.decode("utf-8", errors="replace")[-2000:]
            raise RuntimeError(f"FFmpeg nie wyrenderował klipu: {message}")
