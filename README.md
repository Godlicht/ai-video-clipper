# Cutwise — AI Video Clipper

Cutwise jest rozwijanym lokalnym MVP aplikacji do zamiany długich nagrań w krótkie klipy. Repozytorium zawiera frontend React oraz backend Python/FastAPI z trwałą bazą SQLite.

## Aktualnie działa

- rejestracja i logowanie z hasłami przechowywanymi jako bezpieczne hashe,
- sesje JWT i prywatne projekty izolowane między użytkownikami,
- trwały upload plików MP4, MOV i WebM,
- historia projektów zapisywana w SQLite,
- strumieniowanie nagrań z historii przez krótkotrwałe podpisane adresy URL i HTTP Range,
- odczyt długości filmu przez FFprobe,
- trwałe propozycje klipów generowane dla każdego nagrania,
- edytor zakresu klipu i ustawienia renderu zapisywane w SQLite,
- rzeczywiste renderowanie i pobieranie MP4 przez FFmpeg,
- automatyczne testy frontendu i API.

Bez klucza zewnętrznego aplikacja używa lokalnej analizy bazowej, która rozkłada
propozycje w przebiegu nagrania. Transkrypcja i semantyczne wybieranie momentów
przez modele AI pozostają kolejnym etapem jakościowym; upload, edycja i eksport
działają lokalnie bez usług zewnętrznych.

## Wymagania

- Node.js 20+,
- Python 3.13+,
- FFmpeg i FFprobe dostępne w `PATH` albo wskazane przez `FFMPEG_PATH` i `FFPROBE_PATH`.

Na Windows backend automatycznie wykrywa również instalację `Gyan.FFmpeg` wykonaną przez WinGet.

## Uruchomienie

```bash
npm install
python -m venv .venv
.venv\Scripts\python -m pip install -r requirements.txt
copy .env.example .env
npm run dev
```

Frontend: `http://127.0.0.1:5173`

API: `http://127.0.0.1:8787`

Podczas developmentu Vite przekazuje `/api` do backendu.

## Komendy jakości

```bash
npm test
npm run test:server
npm run lint
npm run build
```

## Dane lokalne

- baza: `data/cutwise.sqlite`,
- źródłowe nagrania: `uploads/`,
- wyrenderowane klipy: `exports/`.

Katalogi te są ignorowane przez Git. Pełna architektura docelowego produktu znajduje się w [docs/PRODUCT_SPEC.md](docs/PRODUCT_SPEC.md).
