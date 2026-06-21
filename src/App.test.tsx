import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import App, { VideoScene } from "./App";

const openDemoResults = async () => {
  const user = userEvent.setup();
  render(<App />);
  await user.click(screen.getByRole("button", { name: /Zobacz wszystkie/i }));
  return user;
};

describe("Cutwise prototype", () => {
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

  it("odrzuca nieobsługiwany typ pliku z czytelnym komunikatem", () => {
    render(<App />);
    const input = document.querySelector<HTMLInputElement>('input[type="file"]');
    expect(input).not.toBeNull();

    fireEvent.change(input!, {
      target: { files: [new File(["not-video"], "notes.txt", { type: "text/plain" })] },
    });

    expect(screen.getByRole("alert")).toHaveTextContent("MP4, MOV lub WebM");
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

  it("filtr Wybrane pokazuje tylko aktualnie zaznaczone klipy", async () => {
    const user = await openDemoResults();
    await user.click(screen.getByRole("button", { name: /^Wybrane$/i }));

    expect(screen.getAllByRole("article")).toHaveLength(2);
  });
});
