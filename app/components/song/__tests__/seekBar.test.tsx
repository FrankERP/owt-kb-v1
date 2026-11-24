/** @vitest-environment jsdom */
// The full-band mix's seek control: the slot `Waveform` takes on an isolated row,
// for a mix that carries no envelope. Same seek by click and by ←/→.
import { cleanup, fireEvent, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import SeekBar from "../SeekBar";

afterEach(() => cleanup());

describe("SeekBar", () => {
  it("is an image when it cannot seek, a button when it can", () => {
    const still = render(<SeekBar progress={0.5} label="Posición Full" />);
    expect(still.getByRole("img", { name: "Posición Full" })).toBeTruthy();
    expect(still.queryByRole("button")).toBeNull();
    cleanup();
    const live = render(<SeekBar progress={0.5} label="Posición Full" onSeek={() => {}} />);
    expect(live.getByRole("button", { name: "Posición Full" })).toBeTruthy();
  });

  it("draws the played fill and the playhead only once playback has started", () => {
    const idle = render(<SeekBar progress={0} label="p" />);
    expect(idle.container.querySelectorAll(".bg-accent")).toHaveLength(0);
    cleanup();
    const playing = render(<SeekBar progress={0.25} label="p" />);
    const fills = playing.container.querySelectorAll(".bg-accent");
    expect(fills).toHaveLength(2);
    expect((fills[0] as HTMLElement).style.width).toBe("25%");
    expect((fills[1] as HTMLElement).style.left).toBe("25%");
  });

  it("seeks by click position and by 5 % steps on the arrow keys, clamped", () => {
    const onSeek = vi.fn();
    const { getByRole } = render(<SeekBar progress={0.98} label="p" onSeek={onSeek} />);
    const bar = getByRole("button");
    bar.getBoundingClientRect = () => ({ left: 100, width: 200, top: 0, height: 40, right: 300, bottom: 40, x: 100, y: 0, toJSON: () => ({}) });
    fireEvent.click(bar, { clientX: 150, detail: 1 });
    expect(onSeek).toHaveBeenLastCalledWith(0.25);
    fireEvent.keyDown(bar, { key: "ArrowRight" });
    expect(onSeek).toHaveBeenLastCalledWith(1);
    fireEvent.keyDown(bar, { key: "ArrowLeft" });
    expect(onSeek).toHaveBeenLastCalledWith(0.93);
    // A keyboard "click" (Enter/Space, detail 0) must not jump to the start.
    onSeek.mockClear();
    fireEvent.click(bar, { clientX: 100, detail: 0 });
    expect(onSeek).not.toHaveBeenCalled();
  });
});
