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
});
