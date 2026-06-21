import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { StrictMode } from "react";
import App, { AnalysisScreen, AuthScreen, VideoScene } from "./App";
import { api } from "./api";

const openDemoResults = async () => {
  const user = userEvent.setup();
  render(<App />);
  await user.click(screen.getByRole("button", { name: /Otwórz demo/i }));
  return user;
};

describe("Cutwise prototype", () => {
  it("rejestruje użytkownika z ekranu konta", async () => {
    const user = userEvent.setup();
    const onAuthenticated = vi.fn();
    vi.spyOn(api, "register").mockResolvedValue({
      user: { id: "user-1", name: "Jakub", email: "jakub@example.com" },
      token: "token-1",
    });
    render(<AuthScreen onAuthenticated={onAuthenticated} />);

    await user.click(screen.getByRole("button", { name: /Zarejestruj się/i }));
    await user.type(screen.getByLabelText("Imię"), "Jakub");
    await user.type(screen.getByLabelText("E-mail"), "jakub@example.com");
    await user.type(screen.getByLabelText("Hasło"), "bezpieczne-haslo");
    await user.click(screen.getByRole("button", { name: "Załóż konto" }));

    expect(api.register).toHaveBeenCalledWith("Jakub", "jakub@example.com", "bezpieczne-haslo");
    expect(onAuthenticated).toHaveBeenCalledWith(
      { id: "user-1", name: "Jakub", email: "jakub@example.com" },
      "token-1",
    );
  });

  it("czyści timer zakończenia analizy po odmontowaniu w StrictMode", () => {
    vi.useFakeTimers();
    const onComplete = vi.fn();
    const { unmount } = render(
      <StrictMode>
        <AnalysisScreen
          fileName="test.mp4"
          onComplete={onComplete}
          onCancel={() => undefined}
        />
      </StrictMode>,
    );

    act(() => vi.advanceTimersByTime(9000));
    expect(screen.getByText("100%")).toBeInTheDocument();
    unmount();
    act(() => vi.advanceTimersByTime(1000));
    expect(onComplete).not.toHaveBeenCalled();
    vi.useRealTimers();
  });

  it("synchronizuje element video z zakresem klipu i zatrzymuje go na końcu", async () => {
    const onPlaybackEnd = vi.fn();
    const playSpy = vi.spyOn(HTMLMediaElement.prototype, "play");
    const pauseSpy = vi.spyOn(HTMLMediaElement.prototype, "pause");
    const { container, rerender } = render(
      <VideoScene
        accent="scene-purple"
        videoUrl="blob:clip"
        playing={false}
        start={10}
        end={20}
        onPlaybackEnd={onPlaybackEnd}
      />,
    );
    const video = container.querySelector("video")!;
    Object.defineProperty(video, "duration", { configurable: true, value: 60 });
    Object.defineProperty(video, "readyState", { configurable: true, value: 1 });
    fireEvent.loadedMetadata(video);
    expect(video.currentTime).toBe(10);

    rerender(
      <VideoScene
        accent="scene-purple"
        videoUrl="blob:clip"
        playing
        start={15}
        end={20}
        onPlaybackEnd={onPlaybackEnd}
      />,
    );
    expect(video.currentTime).toBe(15);
    await waitFor(() => expect(playSpy).toHaveBeenCalled());

    video.currentTime = 20;
    fireEvent.timeUpdate(video);
    expect(pauseSpy).toHaveBeenCalled();
    expect(video.currentTime).toBe(15);
    expect(onPlaybackEnd).toHaveBeenCalledOnce();
  });

  it("ignoruje spóźnione odrzucenie poprzedniej próby odtwarzania", async () => {
    const onPlaybackEnd = vi.fn();
    let rejectFirstPlay!: (reason?: unknown) => void;
    let rejectSecondPlay!: (reason?: unknown) => void;
    const firstPlay = new Promise<void>((_, reject) => {
      rejectFirstPlay = reject;
    });
    const secondPlay = new Promise<void>((_, reject) => {
      rejectSecondPlay = reject;
    });
    vi.spyOn(HTMLMediaElement.prototype, "play")
      .mockImplementationOnce(() => firstPlay)
      .mockImplementationOnce(() => secondPlay);

    const { container, rerender } = render(
      <VideoScene accent="scene-purple" videoUrl="blob:clip" playing={false} onPlaybackEnd={onPlaybackEnd} />,
    );
    const video = container.querySelector("video")!;
    Object.defineProperty(video, "duration", { configurable: true, value: 60 });
    Object.defineProperty(video, "readyState", { configurable: true, value: 1 });

    rerender(<VideoScene accent="scene-purple" videoUrl="blob:clip" playing onPlaybackEnd={onPlaybackEnd} />);
    rerender(<VideoScene accent="scene-purple" videoUrl="blob:clip" playing={false} onPlaybackEnd={onPlaybackEnd} />);
    rerender(<VideoScene accent="scene-purple" videoUrl="blob:clip" playing onPlaybackEnd={onPlaybackEnd} />);

    await act(async () => rejectFirstPlay(new Error("stara próba")));
    expect(onPlaybackEnd).not.toHaveBeenCalled();

    await act(async () => rejectSecondPlay(new Error("aktualna próba")));
    expect(onPlaybackEnd).toHaveBeenCalledOnce();
  });

  it("odrzuca nieobsługiwany typ pliku z czytelnym komunikatem", () => {
    render(<App />);
    const input = document.querySelector<HTMLInputElement>('input[type="file"]');
    expect(input).not.toBeNull();

    fireEvent.change(input!, {
      target: { files: [new File(["not-video"], "notes.txt", { type: "text/plain" })] },
    });

    expect(screen.getByRole("alert")).toHaveTextContent("MP4, MOV lub WebM");
  });

  it("akceptuje wspierane rozszerzenie z ogólnym MIME", () => {
    render(<App />);
    const input = document.querySelector<HTMLInputElement>('input[type="file"]');
    expect(input).not.toBeNull();

    fireEvent.change(input!, {
      target: {
        files: [new File(["video"], "nagranie.webm", { type: "application/octet-stream" })],
      },
    });

    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("wnioskuje MIME z rozszerzenia, gdy przeglądarka go nie poda", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify({
      project: { id: "project-1" },
    }), { status: 201, headers: { "Content-Type": "application/json" } }));

    await api.createProject("token", new File(["video"], "film.mov", { type: "" }));

    const request = vi.mocked(fetch).mock.calls[0];
    const headers = new Headers((request[1] as RequestInit).headers);
    expect(headers.get("X-Mime-Type")).toBe("video/quicktime");
  });

  it("nadpisuje ogólny MIME typem wynikającym z rozszerzenia", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify({
      project: { id: "project-1" },
    }), { status: 201, headers: { "Content-Type": "application/json" } }));

    await api.createProject(
      "token",
      new File(["video"], "film.webm", { type: "application/octet-stream" }),
    );

    const request = vi.mocked(fetch).mock.calls[0];
    const headers = new Headers((request[1] as RequestInit).headers);
    expect(headers.get("X-Mime-Type")).toBe("video/webm");
  });

  it("otwiera eksport dla wszystkich zaznaczonych klipów", async () => {
    const user = await openDemoResults();

    await user.click(screen.getByRole("button", { name: /Eksportuj wybrane/i }));

    expect(screen.getByRole("dialog", { name: /Przygotuj 2 klipy/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Eksportuj 2 klipy/i })).toBeEnabled();
  });

  it("anulowanie edycji nie zapisuje roboczej zmiany zakresu", async () => {
    const user = await openDemoResults();
    const editButton = screen.getAllByRole("button", { name: /Edytuj klip/i })[0];
    editButton.focus();
    await user.click(editButton);

    const editor = screen.getByRole("dialog", { name: /Błąd, który kosztował/i });
    expect(within(editor).getByRole("button", { name: /Zamknij edytor/i })).toHaveFocus();
    expect(within(editor).getByDisplayValue("2:22")).toBeInTheDocument();
    await user.click(within(editor).getAllByRole("button", { name: "+" })[0]);
    expect(within(editor).getByDisplayValue("2:23")).toBeInTheDocument();
    await user.click(within(editor).getByRole("button", { name: "Anuluj" }));
    expect(editButton).toHaveFocus();

    await user.click(screen.getAllByRole("button", { name: /Edytuj klip/i })[0]);
    expect(screen.getByRole("dialog", { name: /Błąd, który kosztował/i })).toHaveTextContent("2:22");
  });

  it("zachowuje konfigurację renderu z edytora w eksporcie", async () => {
    const user = await openDemoResults();
    await user.click(screen.getAllByRole("button", { name: /Edytuj klip/i })[0]);

    const editor = screen.getByRole("dialog", { name: /Błąd, który kosztował/i });
    await user.click(within(editor).getByRole("button", { name: /^1:1/i }));
    await user.click(within(editor).getByRole("button", { name: /Przełącz automatyczne napisy/i }));
    await user.click(within(editor).getByRole("button", { name: /Zapisz i eksportuj/i }));

    const exportDialog = screen.getByRole("dialog", { name: /Przygotuj klip/i });
    expect(within(exportDialog).getByRole("button", { name: /^1:1/i })).toHaveClass("active");
  });

  it("zachowuje indywidualne formaty w eksporcie wielu klipów, dopóki użytkownik ich nie nadpisze", async () => {
    const user = await openDemoResults();
    await user.click(screen.getAllByRole("button", { name: /Edytuj klip/i })[1]);
    const editor = screen.getByRole("dialog", { name: /Jedno pytanie/i });
    await user.click(within(editor).getByRole("button", { name: /^1:1/i }));
    await user.click(within(editor).getByRole("button", { name: /Zapisz zmiany/i }));

    await user.click(screen.getByRole("button", { name: /Eksportuj wybrane/i }));
    const exportDialog = screen.getByRole("dialog", { name: /Przygotuj 2 klipy/i });
    expect(within(exportDialog).getByRole("button", { name: /^9:16/i })).not.toHaveClass("active");
    expect(within(exportDialog).getByRole("button", { name: /^1:1/i })).not.toHaveClass("active");

    await user.click(within(exportDialog).getByRole("button", { name: /^16:9/i }));
    expect(within(exportDialog).getByRole("button", { name: /^16:9/i })).toHaveClass("active");
  });

  it("utrzymuje fokus w modalu, gdy aktywny przycisk zostaje wyłączony", async () => {
    const user = await openDemoResults();
    await user.click(screen.getByRole("button", { name: /Eksportuj wybrane/i }));
    const exportDialog = screen.getByRole("dialog", { name: /Przygotuj 2 klipy/i });
    const exportButton = within(exportDialog).getByRole("button", { name: /Eksportuj 2 klipy/i });
    exportButton.focus();
    fireEvent.click(exportButton);
    fireEvent.keyDown(document, { key: "Tab" });

    expect(within(exportDialog).getByRole("button", { name: /Zamknij eksport/i })).toHaveFocus();
  });

  it("ignoruje zakończenie nieaktualnego uploadu po resecie projektu", async () => {
    const user = userEvent.setup();
    const nativeCreateElement = document.createElement.bind(document);
    let metadataVideo: HTMLVideoElement | undefined;
    vi.spyOn(document, "createElement").mockImplementation(((tagName: string, options?: ElementCreationOptions) => {
      const element = nativeCreateElement(tagName, options);
      if (tagName.toLowerCase() === "video") metadataVideo = element as HTMLVideoElement;
      return element;
    }) as typeof document.createElement);
    const revokeSpy = vi.spyOn(URL, "revokeObjectURL");

    render(<App />);
    const input = document.querySelector<HTMLInputElement>('input[type="file"]');
    fireEvent.change(input!, {
      target: { files: [new File(["video"], "pending.mp4", { type: "video/mp4" })] },
    });

    const newProjectButtons = screen.getAllByRole("button", { name: /Nowy projekt/i });
    await user.click(newProjectButtons[newProjectButtons.length - 1]);
    expect(metadataVideo).toBeDefined();
    Object.defineProperty(metadataVideo!, "duration", { configurable: true, value: 60 });
    metadataVideo!.onloadedmetadata?.(new Event("loadedmetadata"));

    await waitFor(() => {
      expect(screen.getByText("Dzień dobry, Jakub 👋")).toBeInTheDocument();
      expect(screen.queryByText("Analiza nagrania")).not.toBeInTheDocument();
      expect(revokeSpy).toHaveBeenCalledWith("blob:test");
    });
  });

  it("anuluje aktywny request uploadu po otwarciu demo", async () => {
    const user = userEvent.setup();
    const nativeCreateElement = document.createElement.bind(document);
    let metadataVideo: HTMLVideoElement | undefined;
    let uploadSignal: AbortSignal | undefined;
    vi.spyOn(document, "createElement").mockImplementation(((tagName: string, options?: ElementCreationOptions) => {
      const element = nativeCreateElement(tagName, options);
      if (tagName.toLowerCase() === "video") metadataVideo = element as HTMLVideoElement;
      return element;
    }) as typeof document.createElement);
    vi.spyOn(api, "createProject").mockImplementation((_token, _file, _title, signal) => {
      uploadSignal = signal;
      return new Promise(() => undefined);
    });

    render(<App />);
    const input = document.querySelector<HTMLInputElement>('input[type="file"]');
    fireEvent.change(input!, {
      target: { files: [new File(["video"], "pending.mp4", { type: "video/mp4" })] },
    });
    Object.defineProperty(metadataVideo!, "duration", { configurable: true, value: 60 });
    metadataVideo!.onloadedmetadata?.(new Event("loadedmetadata"));
    await waitFor(() => expect(api.createProject).toHaveBeenCalled());

    await user.click(screen.getByRole("button", { name: /Otwórz demo/i }));
    expect(uploadSignal?.aborted).toBe(true);
  });

  it("filtr Wybrane pokazuje tylko aktualnie zaznaczone klipy", async () => {
    const user = await openDemoResults();
    await user.click(screen.getByRole("button", { name: /^Wybrane$/i }));

    expect(screen.getAllByRole("article")).toHaveLength(2);
  });

  it("nie pozwala regenerować klipów w pustym projekcie", async () => {
    const user = userEvent.setup();
    render(<App />);
    const newProjectButtons = screen.getAllByRole("button", { name: /Nowy projekt/i });
    await user.click(newProjectButtons[newProjectButtons.length - 1]);
    const clipsButtons = screen.getAllByRole("button", { name: /Moje klipy/i });
    await user.click(clipsButtons[clipsButtons.length - 1]);

    expect(screen.getByRole("button", { name: /Generuj ponownie/i })).toBeDisabled();
    expect(screen.getByText("Nie masz jeszcze wybranych klipów.")).toBeInTheDocument();
  });
});
