import { fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import App from "./App";

const openDemoResults = async () => {
  const user = userEvent.setup();
  render(<App />);
  await user.click(screen.getByRole("button", { name: /Zobacz wszystkie/i }));
  return user;
};

describe("Cutwise prototype", () => {
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
    await user.click(screen.getAllByRole("button", { name: /Edytuj klip/i })[0]);

    const editor = screen.getByRole("dialog", { name: /Błąd, który kosztował/i });
    expect(within(editor).getByDisplayValue("2:22")).toBeInTheDocument();
    await user.click(within(editor).getAllByRole("button", { name: "+" })[0]);
    expect(within(editor).getByDisplayValue("2:23")).toBeInTheDocument();
    await user.click(within(editor).getByRole("button", { name: "Anuluj" }));

    await user.click(screen.getAllByRole("button", { name: /Edytuj klip/i })[0]);
    expect(screen.getByRole("dialog", { name: /Błąd, który kosztował/i })).toHaveTextContent("2:22");
  });

  it("filtr Wybrane pokazuje tylko aktualnie zaznaczone klipy", async () => {
    const user = await openDemoResults();
    await user.click(screen.getByRole("button", { name: /^Wybrane$/i }));

    expect(screen.getAllByRole("article")).toHaveLength(2);
  });
});
