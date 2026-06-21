import { ChangeEvent, DragEvent, FormEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  AlignCenter,
  ArrowLeft,
  ArrowRight,
  Check,
  CheckCircle2,
  ChevronDown,
  Clock3,
  Download,
  Film,
  FolderClock,
  HelpCircle,
  Info,
  LayoutDashboard,
  LoaderCircle,
  Menu,
  MessageSquareText,
  MoreHorizontal,
  Pause,
  Play,
  Plus,
  RefreshCw,
  RotateCcw,
  Scissors,
  Settings,
  Sparkles,
  Square,
  Subtitles,
  UploadCloud,
  WandSparkles,
  X,
  Zap,
} from "lucide-react";
import { api, type ApiProject, type ApiUser } from "./api";

type Screen = "home" | "analysis" | "results";
type Ratio = "9:16" | "1:1" | "16:9";
type Quality = "720p" | "1080p" | "4K";

type RenderConfig = {
  ratio: Ratio;
  quality: Quality;
  captionsEnabled: boolean;
  trackingEnabled: boolean;
};

type Clip = {
  id: number;
  title: string;
  description: string;
  reason: string;
  start: number;
  end: number;
  score: number;
  tag: string;
  tagTone: "pink" | "blue" | "green" | "amber";
  transcript: string;
  selected: boolean;
  accent: string;
  renderConfig: RenderConfig;
};

const initialClips: Clip[] = [
  {
    id: 1,
    title: "Błąd, który kosztował nas 3 miesiące",
    description: "Szczera historia o decyzji produktowej, która niemal zatrzymała rozwój firmy.",
    reason: "Mocny hook, konkretna liczba i wyraźna zmiana emocji w pierwszych 3 sekundach.",
    start: 142,
    end: 196,
    score: 94,
    tag: "Najwyższy potencjał",
    tagTone: "pink",
    transcript:
      "Największy błąd? Przez trzy miesiące budowaliśmy funkcję, której nikt nie potrzebował. Dopiero jedna rozmowa z klientem sprawiła, że wszystko stało się oczywiste.",
    selected: true,
    accent: "scene-purple",
    renderConfig: { ratio: "9:16", quality: "1080p", captionsEnabled: true, trackingEnabled: true },
  },
  {
    id: 2,
    title: "Jedno pytanie zmieniło całą strategię",
    description: "Krótki, samodzielny insight o słuchaniu klientów przed pisaniem kodu.",
    reason: "Kompletna myśl, naturalna puenta i wysoka wartość informacyjna bez dodatkowego kontekstu.",
    start: 418,
    end: 463,
    score: 91,
    tag: "Wartościowy insight",
    tagTone: "blue",
    transcript:
      "Zapytałem: za co naprawdę płacisz? Nie za więcej funkcji. Za spokój, że praca zostanie wykonana na czas. To jedno pytanie zmieniło naszą strategię.",
    selected: true,
    accent: "scene-blue",
    renderConfig: { ratio: "9:16", quality: "1080p", captionsEnabled: true, trackingEnabled: true },
  },
  {
    id: 3,
    title: "Moment, w którym pojawił się przełom",
    description: "Dynamiczna anegdota zakończona zaskakującym rezultatem.",
    reason: "Rosnące tempo wypowiedzi, reakcja rozmówcy i zaskoczenie tuż przed puentą.",
    start: 724,
    end: 785,
    score: 88,
    tag: "Silna emocja",
    tagTone: "amber",
    transcript:
      "I wtedy zobaczyliśmy pierwszy raport. Wynik był dwa razy lepszy, niż zakładaliśmy. W pokoju zapadła cisza, a potem wszyscy zaczęli się śmiać.",
    selected: false,
    accent: "scene-orange",
    renderConfig: { ratio: "9:16", quality: "1080p", captionsEnabled: true, trackingEnabled: true },
  },
  {
    id: 4,
    title: "Prosta zasada dobrego produktu",
    description: "Celna, zapamiętywalna zasada podana w mniej niż minutę.",
    reason: "Bardzo czytelny cytat, dobre tempo i forma idealna do udostępnienia.",
    start: 1041,
    end: 1083,
    score: 85,
    tag: "Cytat do udostępnienia",
    tagTone: "green",
    transcript:
      "Dobry produkt nie zmusza użytkownika, żeby nauczył się waszej logiki. To produkt powinien nauczyć się logiki użytkownika.",
    selected: false,
    accent: "scene-green",
    renderConfig: { ratio: "9:16", quality: "1080p", captionsEnabled: true, trackingEnabled: true },
  },
];

const analysisSteps = [
  { label: "Przesyłanie i przygotowanie pliku", detail: "Normalizacja obrazu i dźwięku" },
  { label: "Transkrypcja wypowiedzi", detail: "Rozpoznawanie mowy i podział na rozmówców" },
  { label: "Analiza emocji i dynamiki", detail: "Ton głosu, tempo, pauzy i reakcje" },
  { label: "Wykrywanie najlepszych momentów", detail: "Kontekst, kompletność i potencjał social media" },
];

const fmt = (seconds: number) => {
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  return `${mins}:${secs.toString().padStart(2, "0")}`;
};

const DEMO_DURATION = 30 * 60 + 34;
const MAX_FILE_SIZE = 5 * 1024 * 1024 * 1024;
const MAX_VIDEO_DURATION = 3 * 60 * 60;
const SUPPORTED_VIDEO_TYPES = new Set(["video/mp4", "video/quicktime", "video/webm"]);
const SUPPORTED_VIDEO_EXTENSIONS = /\.(mp4|mov|webm)$/i;

const cloneInitialClips = () => initialClips.map((clip) => ({ ...clip, renderConfig: { ...clip.renderConfig } }));

const clipsForDuration = (duration = DEMO_DURATION) => {
  if (!Number.isFinite(duration) || duration <= 0) return [];

  const scale = duration / DEMO_DURATION;
  return initialClips.map((clip) => {
    const start = Math.max(0, Math.min(Math.round(clip.start * scale), Math.max(0, duration - 5)));
    const end = Math.min(duration, Math.max(start + Math.min(5, duration), Math.round(clip.end * scale)));
    return { ...clip, start, end, renderConfig: { ...clip.renderConfig } };
  });
};

const validateVideoFile = (file: File) => {
  const supportedType = SUPPORTED_VIDEO_TYPES.has(file.type) || (!file.type && SUPPORTED_VIDEO_EXTENSIONS.test(file.name));
  if (!supportedType) return "Wybierz plik MP4, MOV lub WebM.";
  if (file.size > MAX_FILE_SIZE) return "Plik przekracza maksymalny rozmiar 5 GB.";
  return undefined;
};

const readVideoDuration = (url: string) =>
  new Promise<number>((resolve, reject) => {
    const video = document.createElement("video");
    const timeout = window.setTimeout(() => {
      cleanup();
      reject(new Error("Nie udało się odczytać długości filmu."));
    }, 15000);

    const cleanup = () => {
      window.clearTimeout(timeout);
      video.removeAttribute("src");
      video.load();
    };

    video.preload = "metadata";
    video.onloadedmetadata = () => {
      const duration = video.duration;
      cleanup();
      if (!Number.isFinite(duration) || duration <= 0) reject(new Error("Film ma nieprawidłową długość."));
      else resolve(duration);
    };
    video.onerror = () => {
      cleanup();
      reject(new Error("Nie można odczytać tego pliku wideo."));
    };
    video.src = url;
  });

const FOCUSABLE_SELECTOR = [
  "button:not([disabled])",
  "[href]",
  "input:not([disabled])",
  "select:not([disabled])",
  "textarea:not([disabled])",
  "[tabindex]:not([tabindex='-1'])",
].join(",");

function useDialogFocus(onClose: () => void, escapeDisabled = false) {
  const dialogRef = useRef<HTMLDivElement>(null);
  const onCloseRef = useRef(onClose);
  const escapeDisabledRef = useRef(escapeDisabled);

  useEffect(() => {
    onCloseRef.current = onClose;
    escapeDisabledRef.current = escapeDisabled;
  }, [escapeDisabled, onClose]);

  useEffect(() => {
    const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const dialog = dialogRef.current;
    const firstFocusable = dialog?.querySelector<HTMLElement>(FOCUSABLE_SELECTOR);
    (firstFocusable ?? dialog)?.focus();

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !escapeDisabledRef.current) {
        event.preventDefault();
        onCloseRef.current();
        return;
      }
      if (event.key !== "Tab" || !dialog) return;

      const focusable = Array.from(dialog.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR));
      if (!focusable.length) {
        event.preventDefault();
        dialog.focus();
        return;
      }

      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      const activeElement = document.activeElement instanceof HTMLElement ? document.activeElement : null;
      if (!activeElement || !dialog.contains(activeElement) || !focusable.includes(activeElement)) {
        event.preventDefault();
        (event.shiftKey ? last : first).focus();
      } else if (event.shiftKey && activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };

    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      previousFocus?.focus();
    };
  }, []);

  return dialogRef;
}

export function AuthScreen({
  onAuthenticated,
}: {
  onAuthenticated: (user: ApiUser, token: string) => void;
}) {
  const [mode, setMode] = useState<"login" | "register">("login");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string>();
  const [submitting, setSubmitting] = useState(false);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setSubmitting(true);
    setError(undefined);
    try {
      const result = mode === "register"
        ? await api.register(name, email, password)
        : await api.login(email, password);
      onAuthenticated(result.user, result.token);
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "Nie udało się zalogować.");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <main className="auth-screen">
      <section className="auth-card">
        <Logo />
        <span className="eyebrow"><Sparkles size={14} /> CUTWISE WORKSPACE</span>
        <h1>{mode === "login" ? "Witaj ponownie" : "Utwórz konto"}</h1>
        <p>Zaloguj się, aby Twoje projekty i przesłane nagrania były zapisywane.</p>
        <form onSubmit={submit}>
          {mode === "register" && (
            <label>Imię<input value={name} onChange={(event) => setName(event.target.value)} autoComplete="name" required minLength={2} /></label>
          )}
          <label>E-mail<input type="email" value={email} onChange={(event) => setEmail(event.target.value)} autoComplete="email" required /></label>
          <label>Hasło<input type="password" value={password} onChange={(event) => setPassword(event.target.value)} autoComplete={mode === "login" ? "current-password" : "new-password"} required minLength={8} /></label>
          {error && <p className="auth-error" role="alert">{error}</p>}
          <button className="primary-button" type="submit" disabled={submitting}>
            {submitting && <LoaderCircle size={17} className="spin" />}
            {mode === "login" ? "Zaloguj się" : "Załóż konto"}
          </button>
        </form>
        <button className="text-button" onClick={() => {
          setMode(mode === "login" ? "register" : "login");
          setError(undefined);
        }}>
          {mode === "login" ? "Nie masz konta? Zarejestruj się" : "Masz już konto? Zaloguj się"}
        </button>
      </section>
    </main>
  );
}

function Logo() {
  return (
    <div className="logo-wrap">
      <div className="logo-mark">
        <Scissors size={18} strokeWidth={2.5} />
      </div>
      <span>cutwise</span>
    </div>
  );
}

function Sidebar({
  screen,
  onNavigate,
  onNewProject,
  clipCount,
  user,
  onLogout,
}: {
  screen: Screen;
  onNavigate: (screen: Screen) => void;
  onNewProject: () => void;
  clipCount: number;
  user: ApiUser;
  onLogout: () => void;
}) {
  return (
    <aside className="sidebar">
      <Logo />
      <button className="new-project" onClick={onNewProject}>
        <Plus size={17} />
        Nowy projekt
      </button>

      <nav className="side-nav">
        <span className="nav-label">PRZESTRZEŃ ROBOCZA</span>
        <button className={screen === "home" ? "active" : ""} onClick={() => onNavigate("home")}>
          <LayoutDashboard size={18} />
          Pulpit
        </button>
        <button className={screen === "results" ? "active" : ""} onClick={() => onNavigate("results")}>
          <Film size={18} />
          Moje klipy
          <span className="nav-count">{clipCount}</span>
        </button>
        <button onClick={() => onNavigate("home")}>
          <FolderClock size={18} />
          Projekty
        </button>
      </nav>

      <nav className="side-nav lower-nav">
        <span className="nav-label">KONTO</span>
        <button>
          <Settings size={18} />
          Ustawienia
        </button>
        <button>
          <HelpCircle size={18} />
          Pomoc
        </button>
      </nav>

      <div className="usage-card">
        <div className="usage-top">
          <span>Wykorzystanie planu</span>
          <strong>42%</strong>
        </div>
        <div className="usage-track">
          <span />
        </div>
        <p>126 z 300 min wykorzystane</p>
        <button>Ulepsz plan</button>
      </div>

      <div className="profile">
        <div className="avatar">{user.name.split(/\s+/).map((part) => part[0]).join("").slice(0, 2).toUpperCase()}</div>
        <div>
          <strong>{user.name}</strong>
          <span>{user.email}</span>
        </div>
        <button className="profile-logout" onClick={onLogout} aria-label="Wyloguj się" title="Wyloguj się"><X size={17} /></button>
      </div>
    </aside>
  );
}

function Topbar({ title, subtitle }: { title: string; subtitle?: string }) {
  return (
    <header className="topbar">
      <div>
        <h1>{title}</h1>
        {subtitle && <p>{subtitle}</p>}
      </div>
      <div className="top-actions">
        <button className="icon-button" aria-label="Wiadomości">
          <MessageSquareText size={19} />
          <span className="notification-dot" />
        </button>
        <div className="top-avatar">JK</div>
        <ChevronDown size={16} />
      </div>
    </header>
  );
}

function HomeScreen({
  onFile,
  onDemo,
  user,
  projects,
  onOpenProject,
  onDeleteProject,
}: {
  onFile: (file: File) => Promise<string | undefined>;
  onDemo: () => void;
  user: ApiUser;
  projects: ApiProject[];
  onOpenProject: (project: ApiProject) => void;
  onDeleteProject: (project: ApiProject) => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);
  const [uploadError, setUploadError] = useState<string>();
  const [preparing, setPreparing] = useState(false);

  const accept = async (file?: File) => {
    if (!file || preparing) return;
    const validationError = validateVideoFile(file);
    if (validationError) {
      setUploadError(validationError);
      return;
    }

    setPreparing(true);
    setUploadError(undefined);
    const error = await onFile(file);
    setPreparing(false);
    setUploadError(error);
  };

  const onDrop = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    setDragging(false);
    accept(event.dataTransfer.files[0]);
  };

  return (
    <main className="content">
      <Topbar title={`Dzień dobry, ${user.name.split(" ")[0]} 👋`} subtitle="Zamień długie nagranie w klipy, które zatrzymują uwagę." />
      <section className="home-body">
        <div className="hero-copy">
          <span className="eyebrow"><Sparkles size={14} /> AI VIDEO CLIPPER</span>
          <h2>Jeden film.<br /><em>Najlepsze momenty</em> wybrane za Ciebie.</h2>
          <p>
            Wgraj nagranie, a Cutwise znajdzie najbardziej angażujące fragmenty,
            wyjaśni swój wybór i przygotuje klipy gotowe do publikacji.
          </p>
        </div>

        <div
          className={`upload-zone ${dragging ? "dragging" : ""}`}
          onDragOver={(event) => {
            event.preventDefault();
            setDragging(true);
          }}
          onDragLeave={() => setDragging(false)}
          onDrop={onDrop}
        >
          <input
            ref={inputRef}
            type="file"
            disabled={preparing}
            accept="video/mp4,video/quicktime,video/webm"
            onChange={(event: ChangeEvent<HTMLInputElement>) => accept(event.target.files?.[0])}
          />
          <div className="upload-icon">
            <UploadCloud size={30} />
          </div>
          <h3>Przeciągnij tutaj swój film</h3>
          <p>lub wybierz plik z komputera</p>
          <button className="primary-button" disabled={preparing} onClick={() => inputRef.current?.click()}>
            {preparing ? <LoaderCircle size={17} className="spin" /> : <UploadCloud size={17} />}
            {preparing ? "Sprawdzanie pliku…" : "Wybierz plik"}
          </button>
          {uploadError && <p className="upload-error" role="alert">{uploadError}</p>}
          <div className="upload-meta">
            <span>MP4, MOV, WebM</span>
            <i />
            <span>maks. 5 GB</span>
            <i />
            <span>do 3 godzin</span>
          </div>
        </div>

        <div className="trust-row">
          <div><CheckCircle2 size={17} /> Pliki szyfrowane</div>
          <div><CheckCircle2 size={17} /> Prywatne przetwarzanie</div>
          <div><CheckCircle2 size={17} /> Automatyczne usuwanie</div>
        </div>

        <div className="section-heading">
          <div>
            <h3>Ostatnie projekty</h3>
            <p>Wróć do swoich ostatnich nagrań.</p>
          </div>
          {!projects.length && <button onClick={onDemo}>Otwórz demo <ArrowRight size={15} /></button>}
        </div>

        <div className="project-grid">
          {projects.map((project, index) => (
            <article className="project-card" key={project.id}>
              <button className="project-open" onClick={() => onOpenProject(project)}>
                <div className={`project-thumb ${["scene-purple", "scene-blue", "scene-green"][index % 3]}`}>
                  <span className="duration-badge">{project.durationSeconds ? fmt(project.durationSeconds) : "—:—"}</span>
                  <div className="abstract-screen" />
                  <div className="play-circle"><Play size={18} fill="currentColor" /></div>
                </div>
                <div className="project-info">
                  <span className="status-ready"><Check size={12} /> {project.status === "uploaded" ? "Wgrano" : "Oczekuje na analizę"}</span>
                  <h4>{project.title}</h4>
                  <p>{(project.sizeBytes / 1024 / 1024).toFixed(1)} MB · {new Date(project.createdAt).toLocaleString("pl-PL")}</p>
                </div>
              </button>
              <button className="project-delete" onClick={() => onDeleteProject(project)} aria-label={`Usuń projekt ${project.title}`}><X size={15} /></button>
            </article>
          ))}
          {!projects.length && (
            <button className="project-card" onClick={onDemo}>
              <div className="project-thumb scene-purple">
                <span className="duration-badge">30:34</span>
                <div className="person person-one" />
                <div className="person person-two" />
                <div className="play-circle"><Play size={18} fill="currentColor" /></div>
              </div>
              <div className="project-info">
                <span className="status-ready"><Sparkles size={12} /> Demo</span>
                <h4>Zobacz przykładowy projekt Cutwise</h4>
                <p>4 demonstracyjne klipy</p>
              </div>
            </button>
          )}
        </div>
      </section>
    </main>
  );
}

export function AnalysisScreen({
  fileName,
  videoUrl,
  onComplete,
  onCancel,
}: {
  fileName: string;
  videoUrl?: string;
  onComplete: () => void;
  onCancel: () => void;
}) {
  const [progress, setProgress] = useState(8);

  useEffect(() => {
    const timer = window.setInterval(() => {
      setProgress((current) => Math.min(100, current + (current < 55 ? 4 : 2)));
    }, 220);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    if (progress < 100) return;
    const completionTimer = window.setTimeout(onComplete, 450);
    return () => window.clearTimeout(completionTimer);
  }, [onComplete, progress]);

  const activeStep = progress < 25 ? 0 : progress < 52 ? 1 : progress < 78 ? 2 : 3;

  return (
    <main className="content">
      <Topbar title="Analiza nagrania" subtitle="AI szuka momentów, których nie da się przewinąć." />
      <section className="analysis-body">
        <div className="analysis-card">
          <div className="analysis-preview">
            {videoUrl ? (
              <video src={videoUrl} muted />
            ) : (
              <>
                <div className="person person-one large" />
                <div className="person person-two large" />
                <div className="preview-caption">„Największy błąd? Budowaliśmy coś, czego nikt nie potrzebował.”</div>
              </>
            )}
            <div className="scanning-line" />
            <div className="ai-detect"><WandSparkles size={15} /> Analiza obrazu</div>
          </div>
          <div className="analysis-content">
            <span className="eyebrow"><LoaderCircle size={14} className="spin" /> ANALIZA W TOKU</span>
            <h2>Wydobywamy najlepsze momenty</h2>
            <p className="analysis-file"><Film size={16} /> {fileName}</p>
            <div className="progress-heading">
              <span>Postęp analizy</span>
              <strong>{progress}%</strong>
            </div>
            <div className="big-progress"><span style={{ width: `${progress}%` }} /></div>
            <div className="analysis-steps">
              {analysisSteps.map((step, index) => (
                <div key={step.label} className={index < activeStep ? "done" : index === activeStep ? "current" : ""}>
                  <div className="step-icon">
                    {index < activeStep ? <Check size={15} /> : index === activeStep ? <LoaderCircle size={15} className="spin" /> : <span>{index + 1}</span>}
                  </div>
                  <div>
                    <strong>{step.label}</strong>
                    <span>{step.detail}</span>
                  </div>
                </div>
              ))}
            </div>
            <div className="analysis-note">
              <Info size={17} />
              <p>Możesz bezpiecznie zamknąć tę kartę. Powiadomimy Cię, gdy klipy będą gotowe.</p>
            </div>
            <button className="text-button danger" onClick={onCancel}>Anuluj analizę</button>
          </div>
        </div>
      </section>
    </main>
  );
}

export function VideoScene({
  accent,
  ratio = "16:9",
  videoUrl,
  transcript,
  playing,
  onToggle,
  start = 0,
  end,
  onPlaybackEnd,
  onProgress,
}: {
  accent: string;
  ratio?: Ratio;
  videoUrl?: string;
  transcript?: string;
  playing?: boolean;
  onToggle?: () => void;
  start?: number;
  end?: number;
  onPlaybackEnd?: () => void;
  onProgress?: (currentTime: number) => void;
}) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const onPlaybackEndRef = useRef(onPlaybackEnd);
  const onProgressRef = useRef(onProgress);
  const playbackGenerationRef = useRef(0);

  useEffect(() => {
    onPlaybackEndRef.current = onPlaybackEnd;
    onProgressRef.current = onProgress;
  }, [onPlaybackEnd, onProgress]);

  useEffect(() => {
    const video = videoRef.current;
    if (!video || video.readyState < 1) return;
    const safeStart = Math.min(start, Math.max(0, video.duration - 0.1));
    video.currentTime = safeStart;
    onProgressRef.current?.(safeStart);
  }, [end, start, videoUrl]);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    const playbackGeneration = ++playbackGenerationRef.current;

    if (!playing) {
      video.pause();
      return;
    }

    const safeEnd = Math.min(end ?? video.duration, video.duration || end || Number.POSITIVE_INFINITY);
    if (video.currentTime < start || video.currentTime >= safeEnd) video.currentTime = start;
    void video.play().catch(() => {
      if (playbackGeneration === playbackGenerationRef.current) onPlaybackEndRef.current?.();
    });
  }, [end, playing, start, videoUrl]);

  const keepInsideRange = () => {
    const video = videoRef.current;
    if (!video) return;
    onProgressRef.current?.(video.currentTime);
    if (end === undefined || video.currentTime < end) return;
    video.pause();
    video.currentTime = start;
    onProgressRef.current?.(start);
    onPlaybackEndRef.current?.();
  };

  return (
    <div className={`video-scene ${accent} ratio-${ratio.replace(":", "-")}`}>
      {videoUrl ? (
        <video
          ref={videoRef}
          src={videoUrl}
          preload="metadata"
          onLoadedMetadata={(event) => {
            event.currentTarget.currentTime = Math.min(start, Math.max(0, event.currentTarget.duration - 0.1));
          }}
          onTimeUpdate={keepInsideRange}
          onEnded={() => onPlaybackEndRef.current?.()}
        />
      ) : (
        <>
          <div className="studio-light" />
          <div className="person person-one" />
          <div className="person person-two" />
        </>
      )}
      {transcript && <div className="scene-caption">{transcript.split(".")[0]}.</div>}
      {onToggle && (
        <button className="play-circle large-play" onClick={onToggle}>
          {playing ? <Pause size={20} fill="currentColor" /> : <Play size={20} fill="currentColor" />}
        </button>
      )}
    </div>
  );
}

function ScoreRing({ score }: { score: number }) {
  return (
    <div className="score-ring" style={{ "--score": `${score * 3.6}deg` } as React.CSSProperties}>
      <div><strong>{score}</strong><span>/100</span></div>
    </div>
  );
}

function ClipCard({
  clip,
  videoUrl,
  onEdit,
  onToggle,
  onExport,
  playing,
  onTogglePlayback,
  onPlaybackEnd,
}: {
  clip: Clip;
  videoUrl?: string;
  onEdit: () => void;
  onToggle: () => void;
  onExport: () => void;
  playing: boolean;
  onTogglePlayback: () => void;
  onPlaybackEnd: () => void;
}) {
  return (
    <article className={`clip-card ${clip.selected ? "selected" : ""}`}>
      <button className="select-check" onClick={onToggle} aria-label="Wybierz klip">
        {clip.selected && <Check size={14} />}
      </button>
      <div className="clip-preview">
        <VideoScene
          accent={clip.accent}
          videoUrl={videoUrl}
          playing={playing}
          start={clip.start}
          end={clip.end}
          onToggle={onTogglePlayback}
          onPlaybackEnd={onPlaybackEnd}
        />
        <span className="clip-time"><Clock3 size={12} /> {fmt(clip.end - clip.start)}</span>
      </div>
      <div className="clip-main">
        <div className="clip-tag-row">
          <span className={`clip-tag ${clip.tagTone}`}><Sparkles size={12} /> {clip.tag}</span>
          <span className="time-range">{fmt(clip.start)} — {fmt(clip.end)}</span>
        </div>
        <h3>{clip.title}</h3>
        <p>{clip.description}</p>
        <div className="reason-box">
          <Zap size={16} />
          <div><strong>Dlaczego ten moment?</strong><span>{clip.reason}</span></div>
        </div>
        <div className="clip-actions">
          <button className="secondary-button" onClick={onEdit}><Scissors size={15} /> Edytuj klip</button>
          <button className="download-button" onClick={onExport}><Download size={15} /> Eksportuj</button>
        </div>
      </div>
      <div className="clip-score">
        <ScoreRing score={clip.score} />
        <span>AI score</span>
      </div>
    </article>
  );
}

function ResultsScreen({
  clips,
  fileName,
  videoUrl,
  videoDuration,
  onClipsChange,
  onHome,
  onRegenerate,
}: {
  clips: Clip[];
  fileName: string;
  videoUrl?: string;
  videoDuration: number;
  onClipsChange: (clips: Clip[]) => void;
  onHome: () => void;
  onRegenerate: () => void;
}) {
  const [editorClip, setEditorClip] = useState<Clip | null>(null);
  const [exportClips, setExportClips] = useState<Clip[] | null>(null);
  const [clipView, setClipView] = useState<"all" | "score" | "short" | "selected">("all");
  const [activePlaybackId, setActivePlaybackId] = useState<number | null>(null);
  const selectedCount = clips.filter((clip) => clip.selected).length;
  const totalClipDuration = clips.reduce((total, clip) => total + clip.end - clip.start, 0);
  const averageScore = Math.round(clips.reduce((total, clip) => total + clip.score, 0) / Math.max(1, clips.length));

  const visibleClips = useMemo(() => {
    if (clipView === "score") return [...clips].sort((a, b) => b.score - a.score);
    if (clipView === "short") return [...clips].sort((a, b) => (a.end - a.start) - (b.end - b.start));
    if (clipView === "selected") return clips.filter((clip) => clip.selected);
    return clips;
  }, [clipView, clips]);

  useEffect(() => {
    if (activePlaybackId !== null && !visibleClips.some((clip) => clip.id === activePlaybackId)) {
      setActivePlaybackId(null);
    }
  }, [activePlaybackId, visibleClips]);

  const openEditor = (clip: Clip) => {
    setActivePlaybackId(null);
    setEditorClip(clip);
  };

  const openExport = (nextClips: Clip[]) => {
    setActivePlaybackId(null);
    setExportClips(nextClips);
  };

  return (
    <main className="content">
      <Topbar title="Twoje najlepsze momenty" subtitle={`Analiza znalazła ${clips.length} fragmenty warte publikacji.`} />
      <section className="results-body">
        <div className="project-summary">
          <button className="back-button" onClick={onHome}><ArrowLeft size={16} /></button>
          <div className="summary-thumb scene-purple">
            <div className="person person-one" />
            <div className="person person-two" />
          </div>
          <div className="summary-copy">
            <span className="status-ready"><Check size={12} /> Analiza zakończona</span>
            <h2>{fileName.replace(/\.[^.]+$/, "")}</h2>
            <p>{fmt(videoDuration)} min · Polski · wersja demonstracyjna</p>
          </div>
          <div className="summary-stats">
            <div><strong>{clips.length}</strong><span>propozycje</span></div>
            <div><strong>{fmt(totalClipDuration)}</strong><span>łącznie</span></div>
            <div><strong>{averageScore}</strong><span>śr. AI score</span></div>
          </div>
          <button className="icon-button" aria-label="Więcej opcji" disabled title="Dodatkowe opcje pojawią się w kolejnej wersji"><MoreHorizontal size={19} /></button>
        </div>

        <div className="results-toolbar">
          <div>
            <h2>Rekomendowane klipy</h2>
            <p>Wybierz fragmenty, które chcesz zachować lub dopracować.</p>
          </div>
          <div className="toolbar-actions">
            <button className="secondary-button" onClick={onRegenerate} disabled={!clips.length || videoDuration <= 0}><RefreshCw size={15} /> Generuj ponownie</button>
            <button className="primary-button" disabled={!selectedCount} onClick={() => openExport(clips.filter((clip) => clip.selected))}>
              Eksportuj wybrane <span>{selectedCount}</span>
            </button>
          </div>
        </div>

        <div className="filter-row">
          <button className={`filter ${clipView === "all" ? "active" : ""}`} onClick={() => setClipView("all")}>Wszystkie <span>{clips.length}</span></button>
          <button className={`filter ${clipView === "score" ? "active" : ""}`} onClick={() => setClipView("score")}>Najwyższy score</button>
          <button className={`filter ${clipView === "short" ? "active" : ""}`} onClick={() => setClipView("short")}>Najkrótsze</button>
          <button className={`filter ${clipView === "selected" ? "active" : ""}`} onClick={() => setClipView("selected")}><SlidersIcon /> Wybrane</button>
        </div>

        <div className="clips-list">
          {visibleClips.map((clip) => (
            <ClipCard
              key={clip.id}
              clip={clip}
              videoUrl={videoUrl}
              playing={activePlaybackId === clip.id}
              onTogglePlayback={() => setActivePlaybackId((current) => current === clip.id ? null : clip.id)}
              onPlaybackEnd={() => setActivePlaybackId((current) => current === clip.id ? null : current)}
              onEdit={() => openEditor(clip)}
              onToggle={() => onClipsChange(clips.map((item) => item.id === clip.id ? { ...item, selected: !item.selected } : item))}
              onExport={() => openExport([clip])}
            />
          ))}
          {!visibleClips.length && <p className="empty-clips">Nie masz jeszcze wybranych klipów.</p>}
        </div>
      </section>

      {editorClip && (
        <EditorModal
          clip={editorClip}
          videoUrl={videoUrl}
          maxDuration={videoDuration}
          onClose={() => setEditorClip(null)}
          onSave={(updated, exportAfterSave) => {
            onClipsChange(clips.map((clip) => clip.id === updated.id ? updated : clip));
            setEditorClip(null);
            if (exportAfterSave) openExport([updated]);
          }}
        />
      )}
      {exportClips && (
        <ExportModal
          clips={exportClips}
          videoUrl={videoUrl}
          onClose={() => setExportClips(null)}
          onConfigsChange={(updatedClips) => {
            const updates = new Map(updatedClips.map((clip) => [clip.id, clip]));
            onClipsChange(clips.map((clip) => updates.get(clip.id) ?? clip));
          }}
        />
      )}
    </main>
  );
}

function SlidersIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M4 21v-7M4 10V3M12 21v-9M12 8V3M20 21v-5M20 12V3M1 14h6M9 8h6M17 16h6" />
    </svg>
  );
}

function EditorModal({
  clip,
  videoUrl,
  maxDuration,
  onClose,
  onSave,
}: {
  clip: Clip;
  videoUrl?: string;
  maxDuration: number;
  onClose: () => void;
  onSave: (clip: Clip, exportAfterSave: boolean) => void;
}) {
  const [draftClip, setDraftClip] = useState({ ...clip, renderConfig: { ...clip.renderConfig } });
  const [playing, setPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(clip.start);
  const duration = draftClip.end - draftClip.start;
  const waveform = useMemo(() => Array.from({ length: 90 }, (_, i) => 16 + ((i * 17 + clip.id * 23) % 46)), [clip.id]);
  const progress = Math.max(0, Math.min(100, ((currentTime - draftClip.start) / Math.max(1, duration)) * 100));
  const minClipLength = Math.min(5, maxDuration);
  const { ratio, captionsEnabled, trackingEnabled } = draftClip.renderConfig;
  const dialogRef = useDialogFocus(onClose);

  const setStart = (value: number) => {
    const nextStart = Math.max(0, Math.min(value, draftClip.end - minClipLength));
    setDraftClip({ ...draftClip, start: nextStart });
    setCurrentTime(nextStart);
  };
  const setEnd = (value: number) => {
    const nextEnd = Math.min(maxDuration, Math.max(value, draftClip.start + minClipLength));
    setDraftClip({ ...draftClip, end: nextEnd });
  };
  const updateRenderConfig = (patch: Partial<RenderConfig>) => {
    setDraftClip({ ...draftClip, renderConfig: { ...draftClip.renderConfig, ...patch } });
  };

  return (
    <div className="modal-backdrop">
      <div ref={dialogRef} className="editor-modal" role="dialog" aria-modal="true" aria-labelledby="editor-title" tabIndex={-1}>
        <header className="modal-header">
          <div>
            <span className="eyebrow"><Scissors size={14} /> EDYTOR KLIPU</span>
            <h2 id="editor-title">{draftClip.title}</h2>
          </div>
          <button className="icon-button" onClick={onClose} aria-label="Zamknij edytor"><X size={20} /></button>
        </header>

        <div className="editor-workspace">
          <div className="editor-preview-wrap">
            <VideoScene
              accent={draftClip.accent}
              ratio={ratio}
              videoUrl={videoUrl}
              transcript={captionsEnabled ? draftClip.transcript : undefined}
              playing={playing}
              start={draftClip.start}
              end={draftClip.end}
              onToggle={() => setPlaying(!playing)}
              onPlaybackEnd={() => setPlaying(false)}
              onProgress={setCurrentTime}
            />
            <div className="playback">
              <button onClick={() => setPlaying(!playing)} aria-label={playing ? "Wstrzymaj podgląd" : "Odtwórz podgląd"}>{playing ? <Pause size={17} fill="currentColor" /> : <Play size={17} fill="currentColor" />}</button>
              <span>{fmt(currentTime)} / {fmt(draftClip.end)}</span>
              <div className="playback-track"><span style={{ width: `${progress}%` }} /></div>
              <button onClick={() => updateRenderConfig({ captionsEnabled: !captionsEnabled })} aria-label="Przełącz napisy" className={captionsEnabled ? "active" : ""}><Subtitles size={17} /></button>
              <button disabled title="Tryb pełnoekranowy pojawi się w kolejnej wersji" aria-label="Tryb pełnoekranowy niedostępny"><Square size={16} /></button>
            </div>
          </div>
          <aside className="editor-settings">
            <div className="settings-section">
              <span className="settings-label">FORMAT KLIPU</span>
              <div className="ratio-options">
                <button className={ratio === "9:16" ? "active" : ""} onClick={() => updateRenderConfig({ ratio: "9:16" })}><span className="portrait-shape" />9:16<small>Reels, TikTok</small></button>
                <button className={ratio === "1:1" ? "active" : ""} onClick={() => updateRenderConfig({ ratio: "1:1" })}><span className="square-shape" />1:1<small>Instagram</small></button>
                <button className={ratio === "16:9" ? "active" : ""} onClick={() => updateRenderConfig({ ratio: "16:9" })}><span className="wide-shape" />16:9<small>YouTube</small></button>
              </div>
            </div>
            <div className="settings-section">
              <div className="toggle-row">
                <div><Subtitles size={17} /><span><strong>Automatyczne napisy</strong><small>Dynamiczne wyróżnianie słów</small></span></div>
                <button className={`toggle ${captionsEnabled ? "active" : ""}`} onClick={() => updateRenderConfig({ captionsEnabled: !captionsEnabled })} aria-label="Przełącz automatyczne napisy"><span /></button>
              </div>
              <div className="toggle-row">
                <div><AlignCenter size={17} /><span><strong>Śledzenie twarzy</strong><small>Główna osoba w centrum</small></span></div>
                <button className={`toggle ${trackingEnabled ? "active" : ""}`} onClick={() => updateRenderConfig({ trackingEnabled: !trackingEnabled })} aria-label="Przełącz śledzenie twarzy"><span /></button>
              </div>
            </div>
            <div className="settings-section transcript-section">
              <span className="settings-label">TRANSKRYPCJA</span>
              <p>{draftClip.transcript}</p>
              <button disabled title="Wymaga podłączenia usługi AI"><WandSparkles size={14} /> Popraw tekst z AI</button>
            </div>
          </aside>
        </div>

        <div className="timeline-area">
          <div className="timeline-heading">
            <div>
              <strong>Zakres klipu</strong>
              <span>{fmt(draftClip.start)} — {fmt(draftClip.end)} · {fmt(duration)}</span>
            </div>
            <button onClick={() => {
              setDraftClip({ ...clip, renderConfig: { ...clip.renderConfig } });
              setCurrentTime(clip.start);
              setPlaying(false);
            }}><RotateCcw size={14} /> Przywróć</button>
          </div>
          <div className="timeline-ruler">
            {[0, 1, 2, 3, 4, 5].map((n) => <span key={n}>{fmt(Math.max(0, draftClip.start - 10 + n * 16))}</span>)}
          </div>
          <div className="waveform">
            {waveform.map((height, index) => <i key={index} style={{ height: `${height}%` }} />)}
            <div className="trim-overlay left" style={{ width: "8%" }} />
            <div className="trim-overlay right" style={{ width: "7%" }} />
            <div className="trim-handle start"><span /></div>
            <div className="trim-handle end"><span /></div>
            <div className="playhead"><span /></div>
          </div>
          <div className="range-inputs">
            <label>Początek <div><button onClick={() => setStart(draftClip.start - 1)}>−</button><input type="text" value={fmt(draftClip.start)} readOnly /><button onClick={() => setStart(draftClip.start + 1)}>+</button></div></label>
            <label>Koniec <div><button onClick={() => setEnd(draftClip.end - 1)}>−</button><input type="text" value={fmt(draftClip.end)} readOnly /><button onClick={() => setEnd(draftClip.end + 1)}>+</button></div></label>
            <span className="duration-pill"><Clock3 size={14} /> Długość: {fmt(duration)}</span>
          </div>
        </div>

        <footer className="modal-footer">
          <button className="secondary-button" onClick={onClose}>Anuluj</button>
          <button className="secondary-button" onClick={() => onSave(draftClip, false)}>Zapisz zmiany</button>
          <button className="primary-button" onClick={() => onSave(draftClip, true)}>Zapisz i eksportuj <ArrowRight size={16} /></button>
        </footer>
      </div>
    </div>
  );
}

function ExportModal({
  clips,
  videoUrl,
  onClose,
  onConfigsChange,
}: {
  clips: Clip[];
  videoUrl?: string;
  onClose: () => void;
  onConfigsChange: (clips: Clip[]) => void;
}) {
  const [configuredClips, setConfiguredClips] = useState(() =>
    clips.map((clip) => ({ ...clip, renderConfig: { ...clip.renderConfig } })),
  );
  const [exporting, setExporting] = useState(false);
  const [done, setDone] = useState(false);
  const exportTimerRef = useRef<number | undefined>(undefined);
  const dialogRef = useDialogFocus(onClose, exporting);
  const firstClip = configuredClips[0];
  const commonRatio = configuredClips.every((clip) => clip.renderConfig.ratio === firstClip.renderConfig.ratio)
    ? firstClip.renderConfig.ratio
    : undefined;
  const commonQuality = configuredClips.every((clip) => clip.renderConfig.quality === firstClip.renderConfig.quality)
    ? firstClip.renderConfig.quality
    : undefined;

  useEffect(() => () => {
    if (exportTimerRef.current) window.clearTimeout(exportTimerRef.current);
  }, []);

  useEffect(() => {
    if (!done) return;
    dialogRef.current?.querySelector<HTMLElement>(FOCUSABLE_SELECTOR)?.focus();
  }, [dialogRef, done]);

  const exportVideo = () => {
    onConfigsChange(configuredClips);
    setExporting(true);
    exportTimerRef.current = window.setTimeout(() => {
      setExporting(false);
      setDone(true);
    }, 1800);
  };

  const downloadManifest = () => {
    const payload = {
      format: "MP4 / H.264",
      status: "ready_for_render_pipeline",
      clips: configuredClips.map((clip) => ({
        id: clip.id,
        title: clip.title,
        source_range: { start: clip.start, end: clip.end },
        render_config: {
          ratio: clip.renderConfig.ratio,
          quality: clip.renderConfig.quality,
          captions_enabled: clip.renderConfig.captionsEnabled,
          tracking_enabled: clip.renderConfig.trackingEnabled,
        },
      })),
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = configuredClips.length === 1
      ? `${firstClip.title.toLowerCase().replace(/[^a-z0-9]+/gi, "-")}-export.json`
      : `cutwise-${configuredClips.length}-clips-export.json`;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 0);
  };

  return (
    <div className="modal-backdrop">
      <div ref={dialogRef} className="export-modal" role="dialog" aria-modal="true" aria-labelledby="export-title" tabIndex={-1}>
        <header className="modal-header">
          <div><span className="eyebrow"><Download size={14} /> EKSPORT</span><h2 id="export-title">Przygotuj {configuredClips.length === 1 ? "klip" : `${configuredClips.length} klipy`} do publikacji</h2></div>
          <button className="icon-button" onClick={onClose} aria-label="Zamknij eksport"><X size={20} /></button>
        </header>
        {!done ? (
          <>
            <div className="export-content">
              <div className="export-preview">
                <VideoScene
                  accent={firstClip.accent}
                  ratio={firstClip.renderConfig.ratio}
                  videoUrl={videoUrl}
                  transcript={firstClip.renderConfig.captionsEnabled ? firstClip.transcript : undefined}
                  start={firstClip.start}
                  end={firstClip.end}
                />
                <p>{firstClip.title}</p>
                <span>{configuredClips.length === 1 ? fmt(firstClip.end - firstClip.start) : `${configuredClips.length} pliki`} · MP4</span>
              </div>
              <div className="export-options">
                <label>Format obrazu{configuredClips.length > 1 ? " · zmiana obejmie wszystkie klipy" : ""}</label>
                <div className="export-ratios">
                  {(["9:16", "1:1", "16:9"] as Ratio[]).map((item) => (
                    <button
                      key={item}
                      className={commonRatio === item ? "active" : ""}
                      onClick={() => setConfiguredClips(configuredClips.map((clip) => ({
                        ...clip,
                        renderConfig: { ...clip.renderConfig, ratio: item },
                      })))}
                    >
                      <span className={`shape shape-${item.replace(":", "-")}`} />
                      <strong>{item}</strong>
                      <small>{item === "9:16" ? "TikTok, Reels, Shorts" : item === "1:1" ? "Instagram Feed" : "YouTube, LinkedIn"}</small>
                    </button>
                  ))}
                </div>
                <label>Jakość wideo</label>
                <div className="quality-row">
                  {(["720p", "1080p", "4K"] as Quality[]).map((item) => (
                    <button
                      key={item}
                      className={commonQuality === item ? "active" : ""}
                      onClick={() => setConfiguredClips(configuredClips.map((clip) => ({
                        ...clip,
                        renderConfig: { ...clip.renderConfig, quality: item },
                      })))}
                    >
                      {item}{item === "1080p" && <span>Polecane</span>}
                    </button>
                  ))}
                </div>
                <div className="export-detail"><span>Format</span><strong>MP4 · H.264</strong></div>
                <div className="export-detail"><span>Szacowany rozmiar</span><strong>~ {42 * configuredClips.length} MB</strong></div>
              </div>
            </div>
            <footer className="modal-footer">
              <button className="secondary-button" onClick={onClose}>Anuluj</button>
              <button className="primary-button" onClick={exportVideo} disabled={exporting}>
                {exporting ? <><LoaderCircle size={17} className="spin" /> Renderowanie…</> : <><Download size={17} /> Eksportuj {configuredClips.length === 1 ? "klip" : `${configuredClips.length} klipy`}</>}
              </button>
            </footer>
          </>
        ) : (
          <div className="export-success">
            <div className="success-mark"><Check size={34} /></div>
            <span className="eyebrow">{configuredClips.length === 1 ? "KLIP GOTOWY" : "KLIPY GOTOWE"}</span>
            <h2>Świetnie wygląda!</h2>
            <p>W produkcyjnej wersji wyrenderowany plik MP4 będzie gotowy do pobrania. Ten prototyp pobiera manifest eksportu.</p>
            <button className="primary-button" onClick={downloadManifest}><Download size={17} /> Pobierz manifest</button>
            <button className="text-button" onClick={onClose}>Wróć do klipów</button>
          </div>
        )}
      </div>
    </div>
  );
}

export default function App() {
  const testMode = import.meta.env.MODE === "test";
  const [user, setUser] = useState<ApiUser | null>(
    testMode ? { id: "test-user", name: "Jakub", email: "test@example.com" } : null,
  );
  const [token, setToken] = useState(() => testMode ? "test-token" : localStorage.getItem("cutwise_token"));
  const [authLoading, setAuthLoading] = useState(!testMode && Boolean(token));
  const [projects, setProjects] = useState<ApiProject[]>([]);
  const [screen, setScreen] = useState<Screen>("home");
  const [clips, setClips] = useState(cloneInitialClips);
  const [fileName, setFileName] = useState("Jak zbudować produkt, którego ludzie chcą.mp4");
  const [videoUrl, setVideoUrl] = useState<string>();
  const [videoDuration, setVideoDuration] = useState(DEMO_DURATION);
  const [mobileMenu, setMobileMenu] = useState(false);
  const uploadGenerationRef = useRef(0);
  const uploadAbortRef = useRef<AbortController | null>(null);

  const loadProjects = useCallback(async (activeToken: string) => {
    const response = await api.listProjects(activeToken);
    setProjects(response.projects);
  }, []);

  useEffect(() => {
    if (!token || testMode) return;
    let active = true;
    Promise.all([api.me(token), api.listProjects(token)])
      .then(([profile, projectList]) => {
        if (!active) return;
        setUser(profile.user);
        setProjects(projectList.projects);
      })
      .catch(() => {
        if (!active) return;
        localStorage.removeItem("cutwise_token");
        setToken(null);
        setUser(null);
      })
      .finally(() => {
        if (active) setAuthLoading(false);
      });
    return () => { active = false; };
  }, [testMode, token]);

  useEffect(() => () => {
    if (videoUrl) URL.revokeObjectURL(videoUrl);
  }, [videoUrl]);

  const handleAuthenticated = (nextUser: ApiUser, nextToken: string) => {
    localStorage.setItem("cutwise_token", nextToken);
    setToken(nextToken);
    setUser(nextUser);
    setAuthLoading(false);
    void loadProjects(nextToken).catch(() => setProjects([]));
  };

  const logout = () => {
    localStorage.removeItem("cutwise_token");
    setToken(null);
    setUser(null);
    setProjects([]);
    resetProject();
  };

  const handleFile = async (file: File) => {
    const validationError = validateVideoFile(file);
    if (validationError) return validationError;

    const uploadGeneration = ++uploadGenerationRef.current;
    const nextVideoUrl = URL.createObjectURL(file);
    let duration: number;
    try {
      duration = await readVideoDuration(nextVideoUrl);
    } catch (error) {
      URL.revokeObjectURL(nextVideoUrl);
      if (uploadGeneration !== uploadGenerationRef.current) return undefined;
      return error instanceof Error ? error.message : "Nie udało się przygotować filmu.";
    }

    if (uploadGeneration !== uploadGenerationRef.current) {
      URL.revokeObjectURL(nextVideoUrl);
      return undefined;
    }

    if (duration > MAX_VIDEO_DURATION) {
      URL.revokeObjectURL(nextVideoUrl);
      return "Film przekracza maksymalną długość 3 godzin.";
    }

    if (!token) {
      URL.revokeObjectURL(nextVideoUrl);
      return "Zaloguj się ponownie przed wysłaniem projektu.";
    }
    const activeToken = token;
    const uploadController = new AbortController();
    uploadAbortRef.current?.abort();
    uploadAbortRef.current = uploadController;

    let persistedProject: ApiProject;
    try {
      const response = await api.createProject(activeToken, file, undefined, uploadController.signal);
      persistedProject = response.project;
    } catch (error) {
      URL.revokeObjectURL(nextVideoUrl);
      if (error instanceof DOMException && error.name === "AbortError") return undefined;
      return error instanceof Error ? error.message : "Nie udało się zapisać projektu.";
    } finally {
      if (uploadAbortRef.current === uploadController) uploadAbortRef.current = null;
    }

    if (uploadGeneration !== uploadGenerationRef.current) {
      URL.revokeObjectURL(nextVideoUrl);
      void api.deleteProject(activeToken, persistedProject.id).catch(() => {
        void loadProjects(activeToken).catch(() => undefined);
      });
      return undefined;
    }

    setProjects((current) => [persistedProject, ...current.filter((project) => project.id !== persistedProject.id)]);
    setFileName(file.name);
    setVideoDuration(duration);
    setClips(clipsForDuration(duration));
    setVideoUrl(nextVideoUrl);
    setScreen("analysis");
    return undefined;
  };

  const loadDemo = () => {
    uploadGenerationRef.current += 1;
    setVideoUrl(undefined);
    setVideoDuration(DEMO_DURATION);
    setClips(cloneInitialClips());
    setFileName("Jak zbudować produkt, którego ludzie chcą.mp4");
    setScreen("results");
  };

  const resetProject = () => {
    uploadGenerationRef.current += 1;
    uploadAbortRef.current?.abort();
    uploadAbortRef.current = null;
    setVideoUrl(undefined);
    setVideoDuration(0);
    setClips([]);
    setFileName("Nowy projekt.mp4");
    setMobileMenu(false);
    setScreen("home");
  };

  const openProject = async (project: ApiProject) => {
    if (!token) return;
    try {
      const media = await api.getProjectMediaUrl(token, project.id);
      const nextVideoUrl = media.url;
      const duration = project.durationSeconds ?? await readVideoDuration(nextVideoUrl);
      setFileName(project.sourceFilename);
      setVideoDuration(duration);
      setClips(clipsForDuration(duration));
      setVideoUrl(nextVideoUrl);
      setScreen("results");
    } catch (error) {
      window.alert(error instanceof Error ? error.message : "Nie udało się otworzyć projektu.");
    }
  };

  const deleteProject = async (project: ApiProject) => {
    if (!token || !window.confirm(`Usunąć projekt „${project.title}”?`)) return;
    try {
      await api.deleteProject(token, project.id);
      setProjects((current) => current.filter((item) => item.id !== project.id));
    } catch (error) {
      window.alert(error instanceof Error ? error.message : "Nie udało się usunąć projektu.");
    }
  };

  if (authLoading) {
    return <main className="auth-screen"><LoaderCircle size={34} className="spin" /></main>;
  }

  if (!user || !token) {
    return <AuthScreen onAuthenticated={handleAuthenticated} />;
  }

  return (
    <div className="app-shell">
      <button className="mobile-menu-button" onClick={() => setMobileMenu(!mobileMenu)} aria-label="Otwórz menu"><Menu size={20} /></button>
      <div className={mobileMenu ? "sidebar-mobile open" : "sidebar-mobile"} onClick={() => setMobileMenu(false)}>
        <div onClick={(event) => event.stopPropagation()}>
          <Sidebar screen={screen} clipCount={clips.length} user={user} onLogout={logout} onNavigate={(next) => { setScreen(next); setMobileMenu(false); }} onNewProject={resetProject} />
        </div>
      </div>
      <Sidebar screen={screen} clipCount={clips.length} user={user} onLogout={logout} onNavigate={setScreen} onNewProject={resetProject} />
      {screen === "home" && (
        <HomeScreen
          onFile={handleFile}
          onDemo={loadDemo}
          user={user}
          projects={projects}
          onOpenProject={openProject}
          onDeleteProject={deleteProject}
        />
      )}
      {screen === "analysis" && (
        <AnalysisScreen
          fileName={fileName}
          videoUrl={videoUrl}
          onComplete={() => setScreen("results")}
          onCancel={resetProject}
        />
      )}
      {screen === "results" && (
        <ResultsScreen
          clips={clips}
          fileName={fileName}
          videoUrl={videoUrl}
          videoDuration={videoDuration}
          onClipsChange={setClips}
          onHome={() => setScreen("home")}
          onRegenerate={() => {
            if (videoDuration > 0 && clips.length) setClips(clipsForDuration(videoDuration));
          }}
        />
      )}
    </div>
  );
}
