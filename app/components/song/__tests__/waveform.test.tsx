/** @vitest-environment jsdom */
import { cleanup, fireEvent, render } from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import Waveform from "../Waveform";

beforeAll(() => {
  // jsdom has no canvas; the component must survive a null context.
  HTMLCanvasElement.prototype.getContext = vi.fn(() => null) as unknown as typeof HTMLCanvasElement.prototype.getContext;
});
afterEach(cleanup);

const peaks = Array.from({ length: 600 }, (_, i) => (i % 2 ? 255 : 0));

describe("Waveform", () => {
  it("renders an accessible image and seeks by click fraction", () => {
    const onSeek = vi.fn();
    const { getByRole } = render(<Waveform peaks={peaks} active={[[0, 10]]} duration={100} progress={0.25} label="Onda EG 1" onSeek={onSeek} />);
    const btn = getByRole("button", { name: "Onda EG 1" });
    Object.defineProperty(btn, "getBoundingClientRect", { value: () => ({ left: 0, width: 200, top: 0, height: 40, right: 200, bottom: 40 }) });
    fireEvent.click(btn, { clientX: 50 });
    expect(onSeek).toHaveBeenCalledWith(0.25);
  });

  it("seeks 5 % with the arrow keys, clamped to 0..1", () => {
    const onSeek = vi.fn();
    const { getByRole } = render(<Waveform peaks={peaks} duration={100} progress={0.98} label="Onda" onSeek={onSeek} />);
    const btn = getByRole("button", { name: "Onda" });
    fireEvent.keyDown(btn, { key: "ArrowRight" });
    expect(onSeek).toHaveBeenLastCalledWith(1);
    fireEvent.keyDown(btn, { key: "ArrowLeft" });
    expect(onSeek).toHaveBeenLastCalledWith(0.93);
  });

  it("is a plain image without onSeek", () => {
    const { queryByRole, getByRole } = render(<Waveform peaks={peaks} duration={0} progress={0} label="Onda" />);
    expect(queryByRole("button")).toBeNull();
    expect(getByRole("img", { name: "Onda" })).toBeTruthy();
  });
});
