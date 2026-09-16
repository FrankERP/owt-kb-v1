/** @vitest-environment jsdom */
// Autoscroll drives the WINDOW, not a transform: the frame loop's only effect is
// `window.scrollTo(0, y)`, so the assertions here are about the scroll spy and
// about the frames themselves. A JS loop that outlives its component is the
// failure mode worth pinning — hence the unmount case and the "no further frame"
// case at the end of the section.
import { act, cleanup, fireEvent, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import LyricsAutoscroll from "../LyricsAutoscroll";
import { haptic } from "@/app/utils/haptics";

vi.mock("@/app/utils/haptics", () => ({ haptic: vi.fn(() => Promise.resolve()) }));

// A controllable rAF queue: nothing runs until the test hands it a timestamp,
// so `dt` is exact rather than whatever the environment felt like.
let queue: Map<number, FrameRequestCallback>;
let nextHandle: number;
let cancelSpy: ReturnType<typeof vi.fn>;
let scrollSpy: ReturnType<typeof vi.fn>;
let rect: DOMRect;

function flush(now: number) {
  const pending = [...queue.entries()];
  queue.clear();
  act(() => {
    for (const [, cb] of pending) cb(now);
  });
}

function mountTarget(heightPx: number) {
  const el = document.createElement("section");
  el.id = "letra";
  Object.defineProperty(el, "offsetHeight", { value: heightPx, configurable: true });
  el.getBoundingClientRect = () => rect;
  document.body.appendChild(el);
  return el;
}

beforeEach(() => {
  queue = new Map();
  nextHandle = 0;
  cancelSpy = vi.fn((handle: number) => queue.delete(handle));
  scrollSpy = vi.fn();
  rect = { bottom: 5000 } as DOMRect;

  vi.stubGlobal("requestAnimationFrame", (cb: FrameRequestCallback) => {
    nextHandle += 1;
    queue.set(nextHandle, cb);
    return nextHandle;
  });
  vi.stubGlobal("cancelAnimationFrame", cancelSpy);
  Object.defineProperty(window, "scrollTo", { value: scrollSpy, writable: true, configurable: true });
  Object.defineProperty(window, "scrollY", { value: 0, writable: true, configurable: true });
  Object.defineProperty(window, "innerHeight", { value: 800, writable: true, configurable: true });
  vi.mocked(haptic).mockClear();
});

afterEach(() => {
  cleanup();
  document.body.innerHTML = "";
  vi.unstubAllGlobals();
});

// 2400 px over 40 lines at 120 bpm: 40 × 8 beats ÷ 120 bpm = 160 s → 15 px/s.
const SPEED_120 = 15;
// The same section with no bpm falls back to DEFAULT_BPM (80) → 240 s → 10 px/s.
const SPEED_DEFAULT = 10;

function start(bpm: number | null) {
  mountTarget(2400);
  const view = render(<LyricsAutoscroll targetId="letra" bpm={bpm} lines={40} />);
  const button = view.getByRole("button");
  expect(button.getAttribute("aria-pressed")).toBe("false");
  act(() => {
    fireEvent.click(button);
  });
  return { ...view, button };
}

describe("LyricsAutoscroll", () => {
  it("scrolls by speed × dt once the clock has a previous frame", () => {
    const { button } = start(120);

    expect(button.getAttribute("aria-pressed")).toBe("true");
    expect(haptic).toHaveBeenCalledTimes(1);

    // The first frame only seeds the clock — there is no previous timestamp to
    // subtract, so it must not leap by an arbitrary amount.
    flush(1000);
    expect(scrollSpy).toHaveBeenLastCalledWith(0, 0);

    flush(1040);
    expect(scrollSpy.mock.calls.at(-1)![1]).toBeCloseTo((SPEED_120 * 40) / 1000, 6);

    // A backgrounded tab hands back a huge gap; dt is clamped to 50 ms.
    flush(3040);
    expect(scrollSpy.mock.calls.at(-1)![1]).toBeCloseTo((SPEED_120 * (40 + 50)) / 1000, 6);
  });

  it("uses DEFAULT_BPM when the song carries no tempo", () => {
    start(null);

    flush(0);
    flush(40);
    expect(scrollSpy.mock.calls.at(-1)![1]).toBeCloseTo((SPEED_DEFAULT * 40) / 1000, 6);
  });

  it("stops scrolling on touchstart and resumes from the new position on touchend", () => {
    start(120);
    flush(0);
    flush(40);
    const beforePause = scrollSpy.mock.calls.length;

    act(() => {
      fireEvent.touchStart(window);
    });
    flush(200);
    flush(300);
    expect(scrollSpy.mock.calls.length).toBe(beforePause);

    // The finger left the page somewhere else entirely; resuming re-seeds from
    // where the user actually is, never from the stale internal offset.
    Object.defineProperty(window, "scrollY", { value: 900, writable: true, configurable: true });
    act(() => {
      fireEvent.touchEnd(window);
    });
    flush(400);
    expect(scrollSpy).toHaveBeenLastCalledWith(0, 900);
    flush(440);
    expect(scrollSpy.mock.calls.at(-1)![1]).toBeCloseTo(900 + (SPEED_120 * 40) / 1000, 6);
  });

  it("stops itself at the end of the section and asks for no further frame", () => {
    const { button } = start(120);
    flush(0);

    rect = { bottom: 700 } as DOMRect; // bottom <= innerHeight (800)
    flush(40);

    expect(button.getAttribute("aria-pressed")).toBe("false");
    expect(queue.size).toBe(0);

    const calls = scrollSpy.mock.calls.length;
    flush(80);
    expect(scrollSpy.mock.calls.length).toBe(calls);
  });

  it("resumes after a cancelled touch, which is what a promoted drag fires", () => {
    const { button } = start(120);
    flush(0);

    act(() => {
      fireEvent.touchStart(window);
    });
    const beforeCancel = scrollSpy.mock.calls.length;
    flush(40);
    expect(scrollSpy.mock.calls.length).toBe(beforeCancel);

    // The gesture was taken over by the scroller: `touchcancel`, never
    // `touchend`. Without it the pill would sit on «Detener» for good.
    act(() => {
      fireEvent.touchCancel(window);
    });
    flush(80);
    expect(scrollSpy.mock.calls.length).toBeGreaterThan(beforeCancel);
    expect(button.getAttribute("aria-pressed")).toBe("true");
  });

  it("follows momentum for the first frames after a resume", () => {
    start(120);
    flush(0);
    act(() => {
      fireEvent.touchStart(window);
    });
    act(() => {
      fireEvent.touchEnd(window);
    });

    // iOS keeps moving the page after the lift; the loop must take the page's
    // own position rather than drag it back to where the pause froze.
    Object.defineProperty(window, "scrollY", { value: 1200, writable: true, configurable: true });
    flush(40);
    expect(scrollSpy).toHaveBeenLastCalledWith(0, 1200);

    Object.defineProperty(window, "scrollY", { value: 1500, writable: true, configurable: true });
    flush(80);
    expect(scrollSpy.mock.calls.at(-1)![1]).toBeCloseTo(1500 + (SPEED_120 * 40) / 1000, 6);
  });

  it("waits for scrollend when the touch actually scrolled the page", () => {
    // jsdom reports `onscrollend`, so this is the path a modern browser takes:
    // the lift alone must NOT resume into the momentum.
    expect("onscrollend" in window).toBe(true);
    start(120);
    flush(0);

    act(() => {
      fireEvent.touchStart(window);
      fireEvent.scroll(window);
      fireEvent.touchEnd(window);
    });
    const beforeEnd = scrollSpy.mock.calls.length;
    flush(40);
    expect(scrollSpy.mock.calls.length).toBe(beforeEnd);

    act(() => {
      fireEvent(window, new Event("scrollend"));
    });
    flush(80);
    expect(scrollSpy.mock.calls.length).toBeGreaterThan(beforeEnd);
  });

  it("a wheel ends the run rather than leaving the pill reading «Detener»", () => {
    const { button } = start(120);
    flush(0);

    act(() => {
      fireEvent.wheel(window);
    });

    expect(button.getAttribute("aria-pressed")).toBe("false");
    expect(queue.size).toBe(0);
    const calls = scrollSpy.mock.calls.length;
    flush(40);
    expect(scrollSpy.mock.calls.length).toBe(calls);
  });

  it("removes every listener when it is toggled off", () => {
    const removeSpy = vi.spyOn(window, "removeEventListener");
    const { button } = start(120);
    flush(0);
    removeSpy.mockClear();

    act(() => {
      fireEvent.click(button);
    });

    expect(button.getAttribute("aria-pressed")).toBe("false");
    const removed = removeSpy.mock.calls.map(([type]) => type);
    for (const type of ["touchstart", "touchend", "touchcancel", "pointerdown", "pointerup", "pointercancel", "wheel"]) {
      expect(removed).toContain(type);
    }
    expect(cancelSpy).toHaveBeenCalled();
    expect(queue.size).toBe(0);
    removeSpy.mockRestore();
  });

  it("carries a 44 px touch target", () => {
    const { button } = start(120);
    expect(button.className).toContain("min-h-[44px]");
  });

  it("cancels the pending frame on unmount", () => {
    const { unmount } = start(120);
    flush(0);
    expect(queue.size).toBe(1);

    unmount();
    expect(cancelSpy).toHaveBeenCalled();
    expect(queue.size).toBe(0);
  });
});
