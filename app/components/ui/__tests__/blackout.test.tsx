/** @vitest-environment jsdom */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

function stubMatchMedia(reduced: boolean) {
  const original = window.matchMedia;
  Object.defineProperty(window, "matchMedia", {
    writable: true,
    configurable: true,
    value: (query: string) => ({
      matches: reduced && query === "(prefers-reduced-motion: reduce)",
      media: query,
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
    }),
  });
  return original;
}

describe("blackout", () => {
  let originalMatchMedia: typeof window.matchMedia;

  beforeEach(() => {
    vi.useFakeTimers();
    originalMatchMedia = stubMatchMedia(false);
  });

  afterEach(() => {
    document.body.innerHTML = "";
    vi.useRealTimers();
    Object.defineProperty(window, "matchMedia", { writable: true, configurable: true, value: originalMatchMedia });
    vi.resetModules();
  });

  it("appends one overlay at opacity 0, then flips to opacity 1", async () => {
    const { blackout } = await import("../Blackout");
    blackout();
    const overlays = document.body.querySelectorAll("div[aria-hidden='true']");
    expect(overlays).toHaveLength(1);
    const el = overlays[0] as HTMLDivElement;
    expect(el.style.opacity).toBe("1");
    expect(el.style.position).toBe("fixed");
    expect(el.style.background).toBe("rgb(var(--surface-base-rgb))");
  });

  it("resolves on the fallback timer when no transitionend fires", async () => {
    const { blackout } = await import("../Blackout");
    const { done } = blackout();
    let resolved = false;
    done.then(() => { resolved = true; });
    await vi.advanceTimersByTimeAsync(399);
    expect(resolved).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    expect(resolved).toBe(true);
  });

  it("resolves early on a real transitionend", async () => {
    const { blackout } = await import("../Blackout");
    const { done } = blackout();
    let resolved = false;
    done.then(() => { resolved = true; });
    const el = document.body.querySelector("div[aria-hidden='true']") as HTMLDivElement;
    // jsdom's Event constructor has no `propertyName`; build the real event shape.
    const ev = document.createEvent("Event");
    ev.initEvent("transitionend", false, false);
    Object.defineProperty(ev, "propertyName", { value: "opacity" });
    Object.defineProperty(ev, "target", { value: el });
    el.dispatchEvent(ev);
    await Promise.resolve();
    expect(resolved).toBe(true);
  });

  it("is idempotent: a second call while one is live returns the same handle", async () => {
    const { blackout } = await import("../Blackout");
    const first = blackout();
    const second = blackout();
    expect(second).toBe(first);
    expect(document.body.querySelectorAll("div[aria-hidden='true']")).toHaveLength(1);
  });

  it("cancel() removes the overlay and clears the live handle", async () => {
    const { blackout } = await import("../Blackout");
    const first = blackout();
    first.cancel();
    expect(document.body.querySelectorAll("div[aria-hidden='true']")).toHaveLength(0);
    const second = blackout();
    expect(second).not.toBe(first);
    expect(document.body.querySelectorAll("div[aria-hidden='true']")).toHaveLength(1);
  });

  it("under prefers-reduced-motion, sets opacity 1 immediately and resolves on the next microtask", async () => {
    Object.defineProperty(window, "matchMedia", { writable: true, configurable: true, value: originalMatchMedia });
    stubMatchMedia(true);
    const { blackout } = await import("../Blackout");
    const { done } = blackout();
    const el = document.body.querySelector("div[aria-hidden='true']") as HTMLDivElement;
    expect(el.style.opacity).toBe("1");
    let resolved = false;
    done.then(() => { resolved = true; });
    await Promise.resolve();
    expect(resolved).toBe(true);
  });
});
