/** @vitest-environment jsdom */
import { cleanup, render } from "@testing-library/react";
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

    const fill = getByRole("slider").firstElementChild as HTMLElement;
    expect(fill.style.transform).toBe("scaleX(0.5)");
    expect(fill.style.width).toBe("");
  });
});
