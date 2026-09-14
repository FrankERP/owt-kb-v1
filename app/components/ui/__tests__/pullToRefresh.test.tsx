/** @vitest-environment jsdom */
// Pull-to-refresh (spec §12.8, decision L). The properties that matter are the
// ones where this component could quietly take the phone's scrolling away from
// it: it must arm ONLY where the tab bar is (a phone) and it must call
// preventDefault ONLY on a downward pull already at the top of the page —
// anywhere else the native scroll has to be untouched. The rail itself is a
// sibling `fixed` element, so nothing here ever translates `<main>`.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render } from "@testing-library/react";
import { act } from "react";

import { CueDialogProvider } from "../CueDialogProvider";
import { MotionProvider } from "../MotionProvider";
import CueDialog from "../CueDialog";

const refresh = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh }) }));

const haptic = vi.fn();
vi.mock("@/app/utils/haptics", () => ({ haptic: (kind?: string) => haptic(kind) }));

import PullToRefresh from "../PullToRefresh";

function stubMatchMedia(coarse: boolean, reduced = false) {
  Object.defineProperty(window, "matchMedia", {
    writable: true,
    configurable: true,
    value: (query: string) => ({
      matches: query.includes("pointer: coarse")
        ? coarse
        : query.includes("prefers-reduced-motion")
          ? reduced
          : false,
      media: query,
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
    }),
  });
}

function setScrollY(y: number) {
  Object.defineProperty(window, "scrollY", { writable: true, configurable: true, value: y });
}

/** jsdom has no constructible TouchEvent; the component only reads `touches`. */
function touchEvent(type: string, y: number, fingers = 1, x = 0) {
  const event = new Event(type, { bubbles: true, cancelable: true });
  Object.defineProperty(event, "touches", {
    value: Array.from({ length: fingers }, () => ({ clientY: y, clientX: x })),
  });
  return event;
}

function fire(type: string, y: number, fingers = 1, x = 0) {
  const event = touchEvent(type, y, fingers, x);
  act(() => {
    window.dispatchEvent(event);
  });
  return event;
}

/** Same event, dispatched on a node so the listener sees a real `target`. */
function fireOn(target: Element, type: string, y: number) {
  const event = touchEvent(type, y);
  act(() => {
    target.dispatchEvent(event);
  });
  return event;
}

const rail = () => document.querySelector<HTMLElement>("[data-pull-rail]");
const railHeightPx = () => Number.parseFloat(rail()?.style.height ?? "0");

function mount(children?: React.ReactNode) {
  return render(
    <MotionProvider>
      <CueDialogProvider>
        <PullToRefresh />
        {children}
      </CueDialogProvider>
    </MotionProvider>,
  );
}

describe("PullToRefresh", () => {
  beforeEach(() => {
    refresh.mockClear();
    haptic.mockClear();
    stubMatchMedia(true);
    setScrollY(0);
    document.documentElement.classList.add("has-bottom-nav");
  });

  afterEach(() => {
    cleanup();
    document.documentElement.classList.remove("has-bottom-nav");
    vi.useRealTimers();
  });

  it("grows the rail on a downward pull at the top and claims the gesture", () => {
    mount();
    fire("touchstart", 100);
    const move = fire("touchmove", 180);
    expect(move.defaultPrevented).toBe(true);
    expect(railHeightPx()).toBeGreaterThan(0);
  });

  it("refreshes once past the threshold, with a haptic", () => {
    // Exactly one refresh per pull: the listener effect must not re-run
    // mid-gesture on a new `useRouter()` identity (it reads `routerRef`), or the
    // travel would be dropped before `touchend` and the pull would do nothing.
    mount();
    fire("touchstart", 100);
    fire("touchmove", 180);
    fire("touchend", 180);
    expect(refresh).toHaveBeenCalledTimes(1);
    expect(haptic).toHaveBeenCalledWith("medium");
  });

  it("does not refresh a pull that never reached the threshold", () => {
    mount();
    fire("touchstart", 100);
    fire("touchmove", 140);
    fire("touchend", 140);
    expect(refresh).not.toHaveBeenCalled();
    expect(railHeightPx()).toBe(0);
  });

  it("is inert once the page is scrolled — the native scroll is untouched", () => {
    mount();
    setScrollY(50);
    fire("touchstart", 100);
    const move = fire("touchmove", 180);
    expect(move.defaultPrevented).toBe(false);
    expect(railHeightPx()).toBe(0);
    fire("touchend", 180);
    expect(refresh).not.toHaveBeenCalled();
  });

  it("ignores a second finger — a pinch is not a pull", () => {
    mount();
    fire("touchstart", 100, 2);
    const move = fire("touchmove", 180, 2);
    expect(move.defaultPrevented).toBe(false);
    fire("touchend", 180);
    expect(refresh).not.toHaveBeenCalled();
  });

  it("registers no touch listeners at all without the tab bar's class (desktop, and the phone before hydration)", () => {
    document.documentElement.classList.remove("has-bottom-nav");
    const spy = vi.spyOn(window, "addEventListener");
    mount();
    const touchTypes = spy.mock.calls.map(([type]) => type).filter(type => String(type).startsWith("touch"));
    expect(touchTypes).toEqual([]);
    spy.mockRestore();
  });

  it("attaches the non-passive touchmove only once a touch starts at the top", () => {
    const spy = vi.spyOn(window, "addEventListener");
    mount();
    expect(spy.mock.calls.some(([type]) => type === "touchmove")).toBe(false);
    fire("touchstart", 100);
    const move = spy.mock.calls.find(([type]) => type === "touchmove");
    expect(move?.[2]).toEqual({ passive: false });
    spy.mockRestore();
  });

  it("registers no touch listeners on a fine pointer even with the class", () => {
    stubMatchMedia(false);
    const spy = vi.spyOn(window, "addEventListener");
    mount();
    expect(spy.mock.calls.some(([type]) => type === "touchmove")).toBe(false);
    spy.mockRestore();
  });

  it("arms when the tab bar publishes its class after hydration", async () => {
    document.documentElement.classList.remove("has-bottom-nav");
    mount();
    await act(async () => {
      document.documentElement.classList.add("has-bottom-nav");
      // MutationObserver callbacks are microtasks.
      await Promise.resolve();
    });
    fire("touchstart", 100);
    const move = fire("touchmove", 180);
    expect(move.defaultPrevented).toBe(true);
  });

  it("is inert while a dialog is open", () => {
    mount(
      <CueDialog open title="Más" label="Más" onDismiss={() => {}}>
        <p>contenido</p>
      </CueDialog>,
    );
    fire("touchstart", 100);
    const move = fire("touchmove", 180);
    expect(move.defaultPrevented).toBe(false);
    fire("touchend", 180);
    expect(refresh).not.toHaveBeenCalled();
  });

  it("ignores a horizontal swipe — the axis is locked on the first move past the slop", () => {
    mount();
    fire("touchstart", 100, 1, 0);
    const move = fire("touchmove", 120, 1, 80);
    expect(move.defaultPrevented).toBe(false);
    expect(railHeightPx()).toBe(0);
    // One-shot: the rest of the gesture stays the swipe's, however vertical it turns.
    const later = fire("touchmove", 220, 1, 80);
    expect(later.defaultPrevented).toBe(false);
    fire("touchend", 220);
    expect(refresh).not.toHaveBeenCalled();
  });

  it("arms nothing for a touch that starts inside [data-pull-ignore]", () => {
    mount(
      <div data-pull-ignore="">
        <button type="button">dentro</button>
      </div>,
    );
    const inside = document.querySelector("button")!;
    fireOn(inside, "touchstart", 100);
    const move = fire("touchmove", 180);
    expect(move.defaultPrevented).toBe(false);
    expect(railHeightPx()).toBe(0);
    fire("touchend", 180);
    expect(refresh).not.toHaveBeenCalled();
  });

  it("refreshes once even when a second pull lands before the floor has passed", () => {
    mount();
    fire("touchstart", 100);
    fire("touchmove", 180);
    fire("touchend", 180);
    fire("touchstart", 100);
    const move = fire("touchmove", 180);
    fire("touchend", 180);
    expect(move.defaultPrevented).toBe(false);
    expect(refresh).toHaveBeenCalledTimes(1);
    expect(haptic).toHaveBeenCalledTimes(1);
  });

  it("never claims an upward drag from the top", () => {
    mount();
    fire("touchstart", 200);
    const move = fire("touchmove", 120);
    expect(move.defaultPrevented).toBe(false);
    expect(railHeightPx()).toBe(0);
    fire("touchend", 120);
    expect(refresh).not.toHaveBeenCalled();
  });

  it("keeps pulling through the iOS rubber band, where scrollY goes negative", () => {
    mount();
    fire("touchstart", 100);
    setScrollY(-30);
    const move = fire("touchmove", 180);
    expect(move.defaultPrevented).toBe(true);
    expect(railHeightPx()).toBeGreaterThan(0);
  });

  it("touchcancel drops the pull without refreshing", () => {
    mount();
    fire("touchstart", 100);
    fire("touchmove", 180);
    expect(railHeightPx()).toBeGreaterThan(0);
    fire("touchcancel", 180);
    expect(railHeightPx()).toBe(0);
    expect(refresh).not.toHaveBeenCalled();
  });

  it("holds the refreshing rail for at least 600 ms, then collapses", async () => {
    vi.useFakeTimers();
    mount();
    fire("touchstart", 100);
    fire("touchmove", 180);
    fire("touchend", 180);
    expect(rail()?.dataset.pullRail).toBe("refreshing");
    await act(async () => {
      await vi.advanceTimersByTimeAsync(599);
    });
    expect(rail()?.dataset.pullRail).toBe("refreshing");
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2);
    });
    expect(rail()?.dataset.pullRail).not.toBe("refreshing");
  });
});
