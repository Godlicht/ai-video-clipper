# Cutwise — specyfikacja produktu i plan MVP

## 1. Cel produktu

Cutwise zamienia długie nagrania — podcasty, webinary, wywiady, kursy i rozmowy — w krótkie, samodzielne klipy gotowe do publikacji. Produkt skraca czas ręcznego przeglądania materiału, wskazuje dlaczego dany fragment jest wartościowy i daje użytkownikowi kontrolę nad finalnym montażem.

Główny miernik wartości produktu: czas od uploadu do pobrania pierwszego zaakceptowanego klipu.

## 2. Główny przepływ użytkownika

1. Użytkownik zakłada projekt i przesyła MP4, MOV lub WebM.
2. Backend zapisuje oryginał w object storage i tworzy zadanie przetwarzania.
3. Worker normalizuje media, wydziela audio i generuje proxy do podglądu.
4. AI wykonuje transkrypcję, diarization, analizę audio oraz opcjonalną analizę obrazu.
5. Silnik segmentacji tworzy kandydatów klipów, ocenia ich jakość i usuwa nakładające się propozycje.
6. Użytkownik otrzymuje 3–10 rekomendacji z tytułem, opisem, zakresem czasu, oceną i uzasadnieniem.
7. Użytkownik akceptuje lub odrzuca klipy oraz koryguje początek i koniec.
8. Pipeline renderujący wycina fragment, dodaje transformacje i napisy, koduje MP4 oraz udostępnia podpisany link do pobrania.

Stany projektu: `draft → uploading → queued → transcribing → analyzing → ready → rendering → completed`, plus `failed` i `cancelled`.

## 3. Zakres MVP

### W MVP

- uwierzytelnienie i prywatny obszar użytkownika,
- multipart upload MP4/MOV/WebM do object storage,
- transkrypcja ze znacznikami czasu na poziomie słów,
- diarization rozmówców,
- analiza tekstu i podstawowych cech audio,
- wygenerowanie 3–10 propozycji,
- tytuł, opis, uzasadnienie, start/end i score dla każdej propozycji,
- podgląd klipu przez zakres czasowy oryginalnego proxy,
- akceptacja, odrzucenie i ręczna korekta zakresu,
- wycięcie MP4 przez FFmpeg,
- status renderowania i pobranie pliku,
- historia bieżącego projektu i obsługa błędów.

### Po MVP

- napisy stylizowane i edytor transkrypcji,
- automatyczne kadrowanie aktywnego rozmówcy,
- szablony 9:16, 1:1 i 16:9 z brandingiem,
- B-roll, emoji, intro/outro i muzyka,
- predykcyjny scoring viralowości uczony na danych publikacji,
- bezpośrednia publikacja do TikTok, YouTube Shorts i Instagram Reels,
- harmonogram publikacji oraz warianty A/B hooków,
- wspólne workspace'y, role i komentarze,
- limity planów, billing, faktury i kupony,
- wielojęzyczne napisy i dubbing,
- publiczne API i webhooki.

## 4. Proponowany stack

### Frontend

- React + TypeScript + Vite lub Next.js,
- TanStack Query do stanu serwerowego,
- Zustand do lokalnego stanu edytora,
- hls.js do podglądów HLS,
- WaveSurfer.js do waveform i synchronizacji czasu,
- tus-js-client lub multipart S3 do wznawianych uploadów.

### Backend

- FastAPI (Python) jako API domenowe i warstwa orkiestracji,
- PostgreSQL jako główna baza danych,
- Redis jako cache, rate limiter i broker kolejki,
- Celery/Dramatiq lub Temporal dla długich workflow,
- S3/R2/GCS jako object storage,
- FFmpeg/FFprobe w kontenerach workerów,
- WebSocket lub Server-Sent Events dla postępu.

### AI i media

- Whisper/WhisperX lub zarządzane API ASR do transkrypcji,
- pyannote lub dostawca ASR z diarization,
- LLM z wymuszonym JSON Schema do segmentacji, tytułów i uzasadnień,
- librosa/Praat do energii, pitch, tempa i pauz,
- WebRTC VAD do aktywności mowy,
- opcjonalnie PySceneDetect do cięć scen,
- opcjonalnie MediaPipe/RetinaFace + tracking do wykrywania twarzy,
- CLIP lub model vision-language do opisu scen wyłącznie jako sygnał pomocniczy.

### Infrastruktura

- kontenery Docker, osobne pule CPU i GPU,
- Kubernetes/ECS/Cloud Run Jobs zależnie od skali,
- CDN dla proxy i eksportów,
- OpenTelemetry + Sentry + metryki Prometheus/Grafana,
- szyfrowanie storage, podpisane URL-e, automatyczna retencja danych.

## 5. Architektura logiczna

```text
Web App
  │
  ├── API / Auth / Billing
  │     ├── PostgreSQL
  │     ├── Redis
  │     └── Object Storage
  │
  └── Processing Orchestrator
        ├── Ingest Worker: FFprobe, proxy, audio extraction
        ├── ASR Worker: transcript, words, speakers
        ├── Analysis Worker: text + audio + vision features
        ├── Ranking Worker: candidates, scoring, deduplication
        └── Render Worker: trim, crop, subtitles, encode
```

API nie powinno trzymać otwartego requestu przez czas analizy. Każdy etap jest idempotentnym zadaniem, zapisuje wynik i emituje postęp. Orkiestrator wznawia workflow po awarii.

## 6. Model danych

### `users`

- `id`, `email`, `name`, `created_at`
- `plan_id`, `minutes_used`, `billing_customer_id`

### `workspaces`

- `id`, `name`, `owner_id`, `created_at`

### `projects`

- `id`, `workspace_id`, `user_id`
- `title`, `status`, `language`
- `source_asset_id`, `duration_ms`, `error_code`
- `analysis_version`, `created_at`, `updated_at`

### `media_assets`

- `id`, `project_id`, `kind` (`source`, `proxy`, `audio`, `export`)
- `storage_key`, `mime_type`, `size_bytes`
- `width`, `height`, `duration_ms`, `checksum`
- `created_at`, `expires_at`

### `transcripts`

- `id`, `project_id`, `provider`, `language`, `full_text`
- `model_version`, `confidence`, `created_at`

### `transcript_segments`

- `id`, `transcript_id`, `speaker_id`
- `start_ms`, `end_ms`, `text`, `confidence`
- `words_json`

### `analysis_features`

- `id`, `project_id`, `window_start_ms`, `window_end_ms`
- `energy`, `pitch_delta`, `speech_rate`, `pause_score`
- `emotion_json`, `scene_change_score`, `face_count`
- `text_embedding`, `raw_json`

### `clip_candidates`

- `id`, `project_id`, `start_ms`, `end_ms`
- `title`, `description`, `reason`
- `status` (`suggested`, `accepted`, `rejected`, `rendered`)
- `information_score`, `emotion_score`, `surprise_score`
- `pace_score`, `completeness_score`, `social_score`
- `standalone_score`, `technical_score`, `total_score`
- `analysis_payload`, `created_at`, `updated_at`

### `exports`

- `id`, `clip_id`, `status`
- `aspect_ratio`, `width`, `height`, `preset`
- `captions_enabled`, `auto_crop_enabled`
- `asset_id`, `render_config`, `error_code`
- `created_at`, `completed_at`

## 7. API

### Projekty i upload

- `POST /v1/projects` — utworzenie projektu.
- `POST /v1/projects/{id}/uploads` — utworzenie multipart uploadu i podpisanych URL-i.
- `POST /v1/projects/{id}/uploads/complete` — potwierdzenie uploadu i start analizy.
- `GET /v1/projects/{id}` — stan projektu, metadane i postęp.
- `GET /v1/projects` — historia i paginacja.
- `DELETE /v1/projects/{id}` — usunięcie projektu i zaplanowanie czyszczenia storage.
- `GET /v1/projects/{id}/events` — SSE z postępem.

### Analiza i klipy

- `POST /v1/projects/{id}/analysis` — ponowienie lub analiza z nową konfiguracją.
- `GET /v1/projects/{id}/transcript` — transkrypcja z segmentami.
- `GET /v1/projects/{id}/clips` — lista rekomendacji.
- `PATCH /v1/clips/{id}` — zmiana statusu, start/end, tytułu i tekstu.
- `POST /v1/projects/{id}/clips/regenerate` — nowe propozycje z preferencjami.

### Eksport

- `POST /v1/clips/{id}/exports` — konfiguracja i start renderu.
- `GET /v1/exports/{id}` — postęp i błędy.
- `GET /v1/exports/{id}/download` — krótko ważny podpisany URL.
- `POST /v1/exports/{id}/publish` — docelowe integracje społecznościowe.

Każda operacja startująca zadanie przyjmuje `Idempotency-Key`. Zewnętrzne integracje i zakończenie renderu mogą emitować webhooki.

## 8. Pipeline analizy

### 8.1 Ingest

1. Sprawdzenie MIME, rozmiaru, długości, kodeka i integralności.
2. Wygenerowanie proxy 720p, audio mono 16 kHz PCM i miniatur.
3. Normalizacja timestampów oraz zapis metadanych FFprobe.

### 8.2 Transkrypcja

1. Voice Activity Detection usuwa długą ciszę.
2. ASR zwraca słowa z timestampami i confidence.
3. Diarization przypisuje rozmówców.
4. Rekonstrukcja zdań zachowuje pauzy, przerwania i reakcje.

### 8.3 Cechy w oknach czasowych

Materiał jest analizowany w oknach 5–15 sekund z nakładaniem:

- tekst: encje, twierdzenia, liczby, pytania, konflikty, puenty, zmiana tematu;
- audio: RMS/energia, tempo mowy, pitch, nagłe zmiany, śmiech, cisza;
- obraz: cięcia scen, ruch, twarze, aktywny rozmówca, reakcje;
- struktura: granice zdań, koniec wątku, zależność od wcześniejszego kontekstu.

### 8.4 Generowanie kandydatów

- Punkty startowe: mocne zdanie, pytanie, zmiana energii, początek anegdoty.
- Punkty końcowe: puenta, odpowiedź, spadek energii, granica zdania lub sceny.
- Długość domyślna 20–75 sekund.
- LLM proponuje zakresy wyłącznie na podstawie istniejących timestampów.
- Reguły deterministyczne docinają granice do pełnych słów i zdań.

### 8.5 Punktowanie

Każdy wymiar ma wartość 0–100:

- wartość informacyjna: 20%,
- emocjonalność: 15%,
- zaskoczenie/nowość: 12%,
- tempo i dynamika: 10%,
- kompletność wypowiedzi: 15%,
- potencjał social media: 13%,
- czytelność bez szerszego kontekstu: 10%,
- jakość techniczna audio/wideo: 5%.

Wzór bazowy:

```text
total =
  0.20 * information +
  0.15 * emotion +
  0.12 * surprise +
  0.10 * pace +
  0.15 * completeness +
  0.13 * social +
  0.10 * standalone +
  0.05 * technical
```

Kary:

- `−10 do −35` za konieczność wcześniejszego kontekstu,
- `−5 do −20` za urwany początek lub puentę,
- `−5 do −25` za słabą jakość audio,
- `−5 do −15` za zbyt wolne pierwsze 3 sekundy,
- odrzucenie przy naruszeniu polityki treści lub braku praw do przetwarzania.

Bonusy:

- `+3 do +8` za liczby, kontrast lub obietnicę w hooku,
- `+3 do +7` za naturalną reakcję lub śmiech,
- `+2 do +6` za mocną, krótką puentę.

Po scoringu stosowany jest weighted interval scheduling lub greedy NMS, aby ograniczyć nakładanie klipów i zapewnić różnorodność tematów. Finalny ranking powinien uwzględniać także diversity reranking, nie tylko najwyższy score.

## 9. Renderowanie klipu

Przykładowy render bez reframe:

```bash
ffmpeg -ss START -i input.mp4 -t DURATION \
  -c:v libx264 -preset medium -crf 20 \
  -c:a aac -b:a 160k -movflags +faststart output.mp4
```

Dla precyzyjnego cięcia wymagany jest re-encode. Szybki `-c copy` może ciąć tylko na keyframe i nadaje się co najwyżej do proxy.

Pipeline produkcyjny:

1. odczyt źródła z lokalnego dysku workera,
2. trim według zaakceptowanych timestampów,
3. crop/pad do docelowego ratio,
4. opcjonalne śledzenie twarzy i wygładzenie trajektorii kadru,
5. render ASS/SRT jako warstwa napisów,
6. loudness normalization do ok. −14 LUFS dla social,
7. kodowanie H.264/AAC, `faststart`, walidacja przez FFprobe,
8. upload eksportu, aktualizacja statusu i link podpisany.

## 10. Bezpieczeństwo i skalowanie SaaS

- Upload bezpośrednio do storage; API nie pośredniczy w gigabajtowych plikach.
- Izolowane workery uruchamiają FFmpeg z limitami CPU, RAM i czasu.
- Walidacja plików nie ufa rozszerzeniu ani `Content-Type`.
- Podpisane URL-e z krótkim TTL oraz osobne prefiksy storage per workspace.
- Szyfrowanie w tranzycie i spoczynku; automatyczna retencja np. 30 dni.
- Limit minut i równoległych zadań per plan.
- Backpressure kolejki, retry z exponential backoff i dead-letter queue.
- Dedykowany hash pliku pozwala wznowić lub zidentyfikować duplikat.
- Wersjonowanie promptów, modeli i wag scoringu dla reprodukowalności.
- Pełny audit log dla dostępu, eksportów i publikacji.

## 11. Plan implementacji MVP

### Etap 1 — fundament, 1 tydzień

- monorepo, CI, auth, PostgreSQL, storage, podstawowy model projektu,
- ekran uploadu, multipart upload, walidacja FFprobe,
- telemetry i obsługa błędów.

### Etap 2 — transkrypcja, 1–2 tygodnie

- kolejka zadań, ekstrakcja audio, integracja ASR,
- diarization, zapis segmentów, SSE postępu,
- ekran analizy.

### Etap 3 — rekomendacje, 1–2 tygodnie

- cechy audio, segmentacja tekstowa i LLM ze schema validation,
- scoring, deduplikacja, tytuły i uzasadnienia,
- ekran wyników oraz retry.

### Etap 4 — edycja i render, 1–2 tygodnie

- podgląd proxy, waveform, edycja start/end,
- worker FFmpeg, status renderu, podpisany download,
- testy jakości i limity planu.

### Etap 5 — gotowość beta, 1 tydzień

- billing, retencja danych, monitoring i alerty,
- E2E najważniejszego przepływu,
- testy większych plików, awarii i wznawiania uploadu.

Realistyczny czas dla małego zespołu: 6–8 tygodni do prywatnej bety. Pierwsza wersja powinna ograniczyć liczbę formatów eksportu i nie wykonywać automatycznego cropu; ważniejsze są trafność rekomendacji, niezawodny upload i poprawny render.

## 12. Metryki produktu

- odsetek projektów z co najmniej jednym pobranym klipem,
- acceptance rate rekomendacji,
- średnia korekta początku i końca przez użytkownika,
- czas upload → rekomendacje oraz rekomendacje → download,
- koszt AI i renderu na minutę źródła,
- failure rate per etap pipeline,
- liczba ponownych generacji,
- retencja tygodniowa twórców i liczba projektów na użytkownika.
