/** @vitest-environment jsdom */
import { cleanup, fireEvent, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import AudioTransport from "../AudioTransport";

afterEach(cleanup);

describe("AudioTransport", () => {
  it("scales the progress fill instead of resizing its width", () => {
    const { getByRole } = render(
      <AudioTransport
        track={{ url: "https://cdn.test/one.mp3", title: "Guía", songTitle: "Sólo en Jesús", songSlug: "solo-en-jesus" }}
        isPlaying={false}
        currentTime={30}
        duration={60}
        progress={0.5}
        onToggle={vi.fn()}
        onSeek={vi.fn()}
        onClose={vi.fn()}
      />,
    );

    const fill = getByRole("slider").querySelector("[data-progress-fill]") as HTMLElement;
    expect(fill.style.transform).toBe("scaleX(0.5)");
    expect(fill.style.width).toBe("");
  });

  it("calls onToggle once when the play/pause button is clicked", () => {
    const onToggle = vi.fn();
    const { getByRole } = render(
      <AudioTransport
        track={{ url: "https://cdn.test/one.mp3", title: "Guía", songTitle: "Sólo en Jesús", songSlug: "solo-en-jesus" }}
        isPlaying={false}
        currentTime={30}
        duration={60}
        progress={0.5}
        onToggle={onToggle}
        onSeek={vi.fn()}
        onClose={vi.fn()}
      />,
    );

    fireEvent.click(getByRole("button", { name: /reproducir/i }));
    expect(onToggle).toHaveBeenCalledTimes(1);
  });

  it("shows the run's position and skip buttons only inside a run", () => {
    const onSkip = vi.fn();
    const props = {
      track: { url: "/api/audio/a/k", title: "Banda completa", songTitle: "Nadie", songSlug: "nadie" },
      isPlaying: true, currentTime: 0, duration: 60, progress: 0,
      onToggle: vi.fn(), onSeek: vi.fn(), onClose: vi.fn(),
    };
    const { getByRole, queryByRole, getByText, rerender } = render(<AudioTransport {...props} />);
    expect(queryByRole("button", { name: /Siguiente canción/i })).toBeNull();

    rerender(<AudioTransport {...props} queue={{ index: 1, total: 3 }} onSkip={onSkip} />);
    expect(getByText("2/3")).toBeTruthy();
    expect(getByText("Canción 2 de 3").className).toContain("sr-only");
    fireEvent.click(getByRole("button", { name: /Siguiente canción/i }));
    fireEvent.click(getByRole("button", { name: /Canción anterior/i }));
    expect(onSkip.mock.calls).toEqual([[1], [-1]]);

    rerender(<AudioTransport {...props} queue={{ index: 2, total: 3 }} onSkip={onSkip} />);
    expect((getByRole("button", { name: /Siguiente canción/i }) as HTMLButtonElement).disabled).toBe(true);
  });
});
