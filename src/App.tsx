import { ChangeEvent, DragEvent, useEffect, useMemo, useRef, useState } from "react";
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

type Screen = "home" | "analysis" | "results";
type Ratio = "9:16" | "1:1" | "16:9";

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
}: {
  screen: Screen;
  onNavigate: (screen: Screen) => void;
}) {
  return (
    <aside className="sidebar">
      <Logo />
      <button className="new-project" onClick={() => onNavigate("home")}>
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
          <span className="nav-count">4</span>
        </button>
        <button>
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
        <div className="avatar">JK</div>
        <div>
          <strong>Jakub Kowalski</strong>
          <span>Plan Creator</span>
        </div>
        <MoreHorizontal size={18} />
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
}: {
  onFile: (file: File) => void;
  onDemo: () => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);

  const accept = (file?: File) => {
    if (file && file.type.startsWith("video/")) onFile(file);
  };

  const onDrop = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    setDragging(false);
    accept(event.dataTransfer.files[0]);
  };

  return (
    <main className="content">
      <Topbar title="Dzień dobry, Jakub 👋" subtitle="Zamień długie nagranie w klipy, które zatrzymują uwagę." />
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
            accept="video/mp4,video/quicktime,video/webm"
            onChange={(event: ChangeEvent<HTMLInputElement>) => accept(event.target.files?.[0])}
          />
          <div className="upload-icon">
            <UploadCloud size={30} />
          </div>
          <h3>Przeciągnij tutaj swój film</h3>
          <p>lub wybierz plik z komputera</p>
          <button className="primary-button" onClick={() => inputRef.current?.click()}>
            <UploadCloud size={17} />
            Wybierz plik
          </button>
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
          <button onClick={onDemo}>Zobacz wszystkie <ArrowRight size={15} /></button>
        </div>

        <div className="project-grid">
          <button className="project-card" onClick={onDemo}>
            <div className="project-thumb scene-purple">
              <span className="duration-badge">30:34</span>
              <div className="person person-one" />
              <div className="person person-two" />
              <div className="play-circle"><Play size={18} fill="currentColor" /></div>
            </div>
            <div className="project-info">
              <span className="status-ready"><Check size={12} /> Gotowe</span>
              <h4>Jak zbudować produkt, którego ludzie chcą</h4>
              <p>4 klipy · dzisiaj, 09:42</p>
            </div>
          </button>
          <button className="project-card muted-card" onClick={onDemo}>
            <div className="project-thumb scene-blue">
              <span className="duration-badge">52:18</span>
              <div className="abstract-mic" />
              <div className="play-circle"><Play size={18} fill="currentColor" /></div>
            </div>
            <div className="project-info">
              <span className="status-ready"><Check size={12} /> Gotowe</span>
              <h4>Podcast: przyszłość pracy z AI</h4>
              <p>7 klipów · 18 cze, 15:20</p>
            </div>
          </button>
          <button className="project-card muted-card" onClick={onDemo}>
            <div className="project-thumb scene-green">
              <span className="duration-badge">18:05</span>
              <div className="abstract-screen" />
              <div className="play-circle"><Play size={18} fill="currentColor" /></div>
            </div>
            <div className="project-info">
              <span className="status-ready"><Check size={12} /> Gotowe</span>
              <h4>Demo produktu — czerwiec 2026</h4>
              <p>3 klipy · 15 cze, 12:08</p>
            </div>
          </button>
        </div>
      </section>
    </main>
  );
}

function AnalysisScreen({
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
      setProgress((current) => {
        if (current >= 100) {
          window.clearInterval(timer);
          window.setTimeout(onComplete, 450);
          return 100;
        }
        return Math.min(100, current + (current < 55 ? 4 : 2));
      });
    }, 220);
    return () => window.clearInterval(timer);
  }, [onComplete]);

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

function VideoScene({
  accent,
  ratio = "16:9",
  videoUrl,
  transcript,
  playing,
  onToggle,
}: {
  accent: string;
  ratio?: Ratio;
  videoUrl?: string;
  transcript?: string;
  playing?: boolean;
  onToggle?: () => void;
}) {
  return (
    <div className={`video-scene ${accent} ratio-${ratio.replace(":", "-")}`}>
      {videoUrl ? (
        <video src={videoUrl} />
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
}: {
  clip: Clip;
  videoUrl?: string;
  onEdit: () => void;
  onToggle: () => void;
  onExport: () => void;
}) {
  const [playing, setPlaying] = useState(false);
  return (
    <article className={`clip-card ${clip.selected ? "selected" : ""}`}>
      <button className="select-check" onClick={onToggle} aria-label="Wybierz klip">
        {clip.selected && <Check size={14} />}
      </button>
      <div className="clip-preview">
        <VideoScene accent={clip.accent} videoUrl={videoUrl} playing={playing} onToggle={() => setPlaying(!playing)} />
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
  onClipsChange,
  onHome,
}: {
  clips: Clip[];
  fileName: string;
  videoUrl?: string;
  onClipsChange: (clips: Clip[]) => void;
  onHome: () => void;
}) {
  const [editorClip, setEditorClip] = useState<Clip | null>(null);
  const [exportClip, setExportClip] = useState<Clip | null>(null);
  const selectedCount = clips.filter((clip) => clip.selected).length;

  const updateClip = (updated: Clip) => {
    onClipsChange(clips.map((clip) => clip.id === updated.id ? updated : clip));
    setEditorClip(updated);
  };

  return (
    <main className="content">
      <Topbar title="Twoje najlepsze momenty" subtitle="AI przeanalizowało nagranie i znalazło 4 fragmenty warte publikacji." />
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
            <p>30:34 min · Polski · 2 rozmówców</p>
          </div>
          <div className="summary-stats">
            <div><strong>4</strong><span>propozycje</span></div>
            <div><strong>3:22</strong><span>łącznie</span></div>
            <div><strong>89</strong><span>śr. AI score</span></div>
          </div>
          <button className="icon-button"><MoreHorizontal size={19} /></button>
        </div>

        <div className="results-toolbar">
          <div>
            <h2>Rekomendowane klipy</h2>
            <p>Wybierz fragmenty, które chcesz zachować lub dopracować.</p>
          </div>
          <div className="toolbar-actions">
            <button className="secondary-button"><RefreshCw size={15} /> Generuj ponownie</button>
            <button className="primary-button" disabled={!selectedCount} onClick={() => setExportClip(clips.find((c) => c.selected) ?? clips[0])}>
              Eksportuj wybrane <span>{selectedCount}</span>
            </button>
          </div>
        </div>

        <div className="filter-row">
          <button className="filter active">Wszystkie <span>4</span></button>
          <button className="filter">Najwyższy score</button>
          <button className="filter">Najkrótsze</button>
          <button className="filter"><SlidersIcon /> Filtry</button>
        </div>

        <div className="clips-list">
          {clips.map((clip) => (
            <ClipCard
              key={clip.id}
              clip={clip}
              videoUrl={videoUrl}
              onEdit={() => setEditorClip(clip)}
              onToggle={() => onClipsChange(clips.map((item) => item.id === clip.id ? { ...item, selected: !item.selected } : item))}
              onExport={() => setExportClip(clip)}
            />
          ))}
        </div>
      </section>

      {editorClip && (
        <EditorModal
          clip={editorClip}
          videoUrl={videoUrl}
          onChange={updateClip}
          onClose={() => setEditorClip(null)}
          onExport={() => {
            setExportClip(editorClip);
            setEditorClip(null);
          }}
        />
      )}
      {exportClip && <ExportModal clip={exportClip} onClose={() => setExportClip(null)} />}
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
  onChange,
  onClose,
  onExport,
}: {
  clip: Clip;
  videoUrl?: string;
  onChange: (clip: Clip) => void;
  onClose: () => void;
  onExport: () => void;
}) {
  const [playing, setPlaying] = useState(false);
  const duration = clip.end - clip.start;
  const waveform = useMemo(() => Array.from({ length: 90 }, (_, i) => 16 + ((i * 17 + clip.id * 23) % 46)), [clip.id]);

  const setStart = (value: number) => onChange({ ...clip, start: Math.min(value, clip.end - 5) });
  const setEnd = (value: number) => onChange({ ...clip, end: Math.max(value, clip.start + 5) });

  return (
    <div className="modal-backdrop">
      <div className="editor-modal">
        <header className="modal-header">
          <div>
            <span className="eyebrow"><Scissors size={14} /> EDYTOR KLIPU</span>
            <h2>{clip.title}</h2>
          </div>
          <button className="icon-button" onClick={onClose}><X size={20} /></button>
        </header>

        <div className="editor-workspace">
          <div className="editor-preview-wrap">
            <VideoScene
              accent={clip.accent}
              ratio="16:9"
              videoUrl={videoUrl}
              transcript={clip.transcript}
              playing={playing}
              onToggle={() => setPlaying(!playing)}
            />
            <div className="playback">
              <button onClick={() => setPlaying(!playing)}>{playing ? <Pause size={17} fill="currentColor" /> : <Play size={17} fill="currentColor" />}</button>
              <span>{fmt(clip.start + 8)} / {fmt(clip.end)}</span>
              <div className="playback-track"><span style={{ width: "22%" }} /></div>
              <button><Subtitles size={17} /></button>
              <button><Square size={16} /></button>
            </div>
          </div>
          <aside className="editor-settings">
            <div className="settings-section">
              <span className="settings-label">FORMAT KLIPU</span>
              <div className="ratio-options">
                <button className="active"><span className="portrait-shape" />9:16<small>Reels, TikTok</small></button>
                <button><span className="square-shape" />1:1<small>Instagram</small></button>
                <button><span className="wide-shape" />16:9<small>YouTube</small></button>
              </div>
            </div>
            <div className="settings-section">
              <div className="toggle-row">
                <div><Subtitles size={17} /><span><strong>Automatyczne napisy</strong><small>Dynamiczne wyróżnianie słów</small></span></div>
                <button className="toggle active"><span /></button>
              </div>
              <div className="toggle-row">
                <div><AlignCenter size={17} /><span><strong>Śledzenie twarzy</strong><small>Główna osoba w centrum</small></span></div>
                <button className="toggle active"><span /></button>
              </div>
            </div>
            <div className="settings-section transcript-section">
              <span className="settings-label">TRANSKRYPCJA</span>
              <p>{clip.transcript}</p>
              <button><WandSparkles size={14} /> Popraw tekst z AI</button>
            </div>
          </aside>
        </div>

        <div className="timeline-area">
          <div className="timeline-heading">
            <div>
              <strong>Zakres klipu</strong>
              <span>{fmt(clip.start)} — {fmt(clip.end)} · {fmt(duration)}</span>
            </div>
            <button><RotateCcw size={14} /> Przywróć</button>
          </div>
          <div className="timeline-ruler">
            {[0, 1, 2, 3, 4, 5].map((n) => <span key={n}>{fmt(Math.max(0, clip.start - 10 + n * 16))}</span>)}
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
            <label>Początek <div><button onClick={() => setStart(clip.start - 1)}>−</button><input type="text" value={fmt(clip.start)} readOnly /><button onClick={() => setStart(clip.start + 1)}>+</button></div></label>
            <label>Koniec <div><button onClick={() => setEnd(clip.end - 1)}>−</button><input type="text" value={fmt(clip.end)} readOnly /><button onClick={() => setEnd(clip.end + 1)}>+</button></div></label>
            <span className="duration-pill"><Clock3 size={14} /> Długość: {fmt(duration)}</span>
          </div>
        </div>

        <footer className="modal-footer">
          <button className="secondary-button" onClick={onClose}>Anuluj</button>
          <button className="primary-button" onClick={onExport}>Zapisz i eksportuj <ArrowRight size={16} /></button>
        </footer>
      </div>
    </div>
  );
}

function ExportModal({ clip, onClose }: { clip: Clip; onClose: () => void }) {
  const [ratio, setRatio] = useState<Ratio>("9:16");
  const [quality, setQuality] = useState("1080p");
  const [exporting, setExporting] = useState(false);
  const [done, setDone] = useState(false);

  const exportVideo = () => {
    setExporting(true);
    window.setTimeout(() => {
      setExporting(false);
      setDone(true);
    }, 1800);
  };

  const downloadManifest = () => {
    const payload = {
      title: clip.title,
      source_range: { start: clip.start, end: clip.end },
      ratio,
      quality,
      format: "MP4 / H.264",
      status: "ready_for_render_pipeline",
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `${clip.title.toLowerCase().replace(/[^a-z0-9]+/gi, "-")}-export.json`;
    anchor.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="modal-backdrop">
      <div className="export-modal">
        <header className="modal-header">
          <div><span className="eyebrow"><Download size={14} /> EKSPORT</span><h2>Przygotuj klip do publikacji</h2></div>
          <button className="icon-button" onClick={onClose}><X size={20} /></button>
        </header>
        {!done ? (
          <>
            <div className="export-content">
              <div className="export-preview">
                <VideoScene accent={clip.accent} ratio={ratio} transcript={clip.transcript} />
                <p>{clip.title}</p>
                <span>{fmt(clip.end - clip.start)} · MP4</span>
              </div>
              <div className="export-options">
                <label>Format obrazu</label>
                <div className="export-ratios">
                  {(["9:16", "1:1", "16:9"] as Ratio[]).map((item) => (
                    <button key={item} className={ratio === item ? "active" : ""} onClick={() => setRatio(item)}>
                      <span className={`shape shape-${item.replace(":", "-")}`} />
                      <strong>{item}</strong>
                      <small>{item === "9:16" ? "TikTok, Reels, Shorts" : item === "1:1" ? "Instagram Feed" : "YouTube, LinkedIn"}</small>
                    </button>
                  ))}
                </div>
                <label>Jakość wideo</label>
                <div className="quality-row">
                  {["720p", "1080p", "4K"].map((item) => <button key={item} className={quality === item ? "active" : ""} onClick={() => setQuality(item)}>{item}{item === "1080p" && <span>Polecane</span>}</button>)}
                </div>
                <div className="export-detail"><span>Format</span><strong>MP4 · H.264</strong></div>
                <div className="export-detail"><span>Szacowany rozmiar</span><strong>~ 42 MB</strong></div>
              </div>
            </div>
            <footer className="modal-footer">
              <button className="secondary-button" onClick={onClose}>Anuluj</button>
              <button className="primary-button" onClick={exportVideo} disabled={exporting}>
                {exporting ? <><LoaderCircle size={17} className="spin" /> Renderowanie…</> : <><Download size={17} /> Eksportuj klip</>}
              </button>
            </footer>
          </>
        ) : (
          <div className="export-success">
            <div className="success-mark"><Check size={34} /></div>
            <span className="eyebrow">KLIP GOTOWY</span>
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
  const [screen, setScreen] = useState<Screen>("home");
  const [clips, setClips] = useState(initialClips);
  const [fileName, setFileName] = useState("Jak zbudować produkt, którego ludzie chcą.mp4");
  const [videoUrl, setVideoUrl] = useState<string>();
  const [mobileMenu, setMobileMenu] = useState(false);

  useEffect(() => () => {
    if (videoUrl) URL.revokeObjectURL(videoUrl);
  }, [videoUrl]);

  const handleFile = (file: File) => {
    if (videoUrl) URL.revokeObjectURL(videoUrl);
    setFileName(file.name);
    setVideoUrl(URL.createObjectURL(file));
    setScreen("analysis");
  };

  const loadDemo = () => {
    setFileName("Jak zbudować produkt, którego ludzie chcą.mp4");
    setScreen("results");
  };

  return (
    <div className="app-shell">
      <button className="mobile-menu-button" onClick={() => setMobileMenu(!mobileMenu)}><Menu size={20} /></button>
      <div className={mobileMenu ? "sidebar-mobile open" : "sidebar-mobile"} onClick={() => setMobileMenu(false)}>
        <div onClick={(event) => event.stopPropagation()}>
          <Sidebar screen={screen} onNavigate={(next) => { setScreen(next); setMobileMenu(false); }} />
        </div>
      </div>
      <Sidebar screen={screen} onNavigate={setScreen} />
      {screen === "home" && <HomeScreen onFile={handleFile} onDemo={loadDemo} />}
      {screen === "analysis" && (
        <AnalysisScreen
          fileName={fileName}
          videoUrl={videoUrl}
          onComplete={() => setScreen("results")}
          onCancel={() => setScreen("home")}
        />
      )}
      {screen === "results" && (
        <ResultsScreen
          clips={clips}
          fileName={fileName}
          videoUrl={videoUrl}
          onClipsChange={setClips}
          onHome={() => setScreen("home")}
        />
      )}
    </div>
  );
}
