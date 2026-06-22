from __future__ import annotations

import asyncio
import hashlib
import math
import tempfile
from dataclasses import dataclass
from pathlib import Path

from openai import OpenAI


@dataclass(frozen=True)
class ClipCandidate:
    title: str
    description: str
    reason: str
    start: float
    end: float
    score: int


def _overlap_ratio(start: float, end: float, ranges: list[tuple[float, float]]) -> float:
    length = max(0.001, end - start)
    overlap = sum(max(0.0, min(end, other_end) - max(start, other_start)) for other_start, other_end in ranges)
    return min(1.0, overlap / length)


def _prompt_profile(prompt: str) -> tuple[str, str, int]:
    normalized = prompt.casefold()
    profiles = [
        (("zabaw", "śmies", "humor", "funny"), "Zabawny moment", "Priorytet: humor, reakcje i lekka puenta.", 4),
        (("kontrowers", "spór", "mocna opin", "controvers"), "Mocna opinia", "Priorytet: wyrazista lub kontrowersyjna wypowiedź.", 8),
        (("cytat", "quote", "najmocniejsz"), "Mocny cytat", "Priorytet: samodzielny, zapamiętywalny cytat.", 12),
        (("dynamic", "energia", "tempo", "action"), "Dynamiczny fragment", "Priorytet: szybkie tempo i wysoka energia.", 16),
        (("social", "reels", "tiktok", "shorts", "viral"), "Moment do social mediów", "Priorytet: szybki hook i kompletna puenta.", 20),
    ]
    for keywords, title, reason, offset in profiles:
        if any(keyword in normalized for keyword in keywords):
            return title, reason, offset
    if prompt.strip():
        return "Moment zgodny z promptem", f"Wybrano pod kątem: {prompt.strip()[:180]}", 24
    return "Najciekawszy moment", "Samodzielny fragment z wyraźnym początkiem i zakończeniem.", 0


def generate_clip_candidates(
    duration: float,
    prompt: str = "",
    min_length: float = 20.0,
    max_length: float = 90.0,
    excluded_ranges: list[tuple[float, float]] | None = None,
) -> list[ClipCandidate]:
    if duration <= 0:
        return []

    excluded_ranges = excluded_ranges or []
    min_length = max(8.0, min(float(min_length), duration))
    max_length = max(min_length, min(float(max_length), duration))
    count = min(8, max(1, math.ceil(duration / 75)))
    base_length = min(max_length, max(min_length, duration / max(1.0, count * 1.35)))
    title_prefix, reason, prompt_offset = _prompt_profile(prompt)
    prompt_seed = int(hashlib.sha256(prompt.strip().encode("utf-8")).hexdigest()[:8], 16) if prompt.strip() else 0

    step = max(5.0, min_length / 3)
    starts = [
        min(max(0.0, duration - min_length), index * step)
        for index in range(max(1, math.ceil(duration / step)))
    ]
    ranked_windows: list[tuple[float, float, float]] = []
    for index, start in enumerate(starts):
        variation = (((index + prompt_seed) % 5) - 2) * min(8.0, max(1.0, base_length * 0.08))
        clip_length = min(max_length, max(min_length, base_length + variation))
        end = min(duration, start + clip_length)
        start = max(0.0, end - clip_length)
        prior_overlap = _overlap_ratio(start, end, excluded_ranges)
        edge_bonus = min(start, max(0.0, duration - end)) / max(duration, 1.0)
        prompt_rotation = ((index * 37 + prompt_offset + prompt_seed) % 101) / 1000
        ranked_windows.append((prior_overlap - edge_bonus - prompt_rotation, start, end))

    ranked_windows.sort()
    candidates: list[ClipCandidate] = []
    selected_ranges: list[tuple[float, float]] = []
    for _rank, start, end in ranked_windows:
        if len(candidates) >= count:
            break
        if _overlap_ratio(start, end, selected_ranges) > 0.28:
            continue
        index = len(candidates)
        selected_ranges.append((start, end))
        candidates.append(
            ClipCandidate(
                title=f"{title_prefix} {index + 1}",
                description="Nowa propozycja z możliwie nieużywanej części nagrania, gotowa do dopracowania.",
                reason=reason,
                start=round(start, 3),
                end=round(end, 3),
                score=max(70, 92 - index * 3 - round(_overlap_ratio(start, end, excluded_ranges) * 18)),
            )
        )
    return candidates


async def transcribe_clip(
    ffmpeg_path: str,
    source: Path,
    start: float,
    end: float,
    api_key: str,
    model: str,
    prompt: str = "",
) -> str:
    with tempfile.TemporaryDirectory(prefix="cutwise-transcript-") as temp_dir:
        audio_path = Path(temp_dir) / "clip.mp3"
        process = await asyncio.create_subprocess_exec(
            ffmpeg_path,
            "-y",
            "-ss",
            f"{start:.3f}",
            "-i",
            str(source),
            "-t",
            f"{end - start:.3f}",
            "-vn",
            "-ac",
            "1",
            "-ar",
            "16000",
            "-b:a",
            "48k",
            str(audio_path),
            stdout=asyncio.subprocess.DEVNULL,
            stderr=asyncio.subprocess.PIPE,
        )
        _stdout, stderr = await asyncio.wait_for(process.communicate(), timeout=180)
        if process.returncode != 0:
            message = stderr.decode("utf-8", errors="replace")[-1000:]
            raise RuntimeError(f"Nie udało się przygotować audio do transkrypcji: {message}")

        def request_transcription() -> str:
            client = OpenAI(api_key=api_key)
            with audio_path.open("rb") as audio_file:
                response = client.audio.transcriptions.create(
                    model=model,
                    file=audio_file,
                    response_format="text",
                    prompt=prompt[:400] or None,
                )
            return response if isinstance(response, str) else response.text

        return (await asyncio.to_thread(request_transcription)).strip()


def output_dimensions(ratio: str, quality: str) -> tuple[int, int]:
    base = {"720p": 720, "1080p": 1080, "4K": 2160}[quality]
    if ratio == "9:16":
        return base, round(base * 16 / 9)
    if ratio == "1:1":
        return base, base
    return round(base * 16 / 9), base


def _srt_time(value: float) -> str:
    milliseconds = max(0, round(value * 1000))
    hours, milliseconds = divmod(milliseconds, 3_600_000)
    minutes, milliseconds = divmod(milliseconds, 60_000)
    seconds, milliseconds = divmod(milliseconds, 1000)
    return f"{hours:02}:{minutes:02}:{seconds:02},{milliseconds:03}"


_render_semaphore = asyncio.Semaphore(1)


async def render_clip(
    ffmpeg_path: str,
    source: Path,
    output: Path,
    start: float,
    end: float,
    ratio: str,
    quality: str,
    captions_enabled: bool = False,
    transcript: str = "",
    timeout_seconds: float = 600,
) -> None:
    width, height = output_dimensions(ratio, quality)
    duration = end - start
    output.parent.mkdir(parents=True, exist_ok=True)
    subtitle_path = output.with_suffix(".srt")
    video_filter = (
        f"scale={width}:{height}:force_original_aspect_ratio=decrease,"
        f"pad={width}:{height}:(ow-iw)/2:(oh-ih)/2:black"
    )
    if captions_enabled and transcript.strip():
        words = transcript.strip().split()
        chunks = [" ".join(words[index:index + 9]) for index in range(0, len(words), 9)]
        chunk_duration = duration / max(1, len(chunks))
        subtitle_path.write_text(
            "\n\n".join(
                f"{index + 1}\n{_srt_time(index * chunk_duration)} --> "
                f"{_srt_time(min(duration, (index + 1) * chunk_duration))}\n{text}"
                for index, text in enumerate(chunks)
            ),
            encoding="utf-8",
        )
        escaped_subtitle_path = str(subtitle_path.resolve()).replace("\\", "/").replace(":", r"\:")
        video_filter += (
            f",subtitles='{escaped_subtitle_path}':"
            "force_style='Alignment=2,MarginV=60,FontSize=20,Outline=2,Shadow=1'"
        )

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
                video_filter,
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
            subtitle_path.unlink(missing_ok=True)
            raise
        if process.returncode != 0:
            output.unlink(missing_ok=True)
            subtitle_path.unlink(missing_ok=True)
            message = stderr.decode("utf-8", errors="replace")[-2000:]
            raise RuntimeError(f"FFmpeg nie wyrenderował klipu: {message}")
        subtitle_path.unlink(missing_ok=True)
