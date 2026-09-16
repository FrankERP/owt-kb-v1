/** @vitest-environment jsdom */
// The BPM pill taps a tempo. Two clocks, deliberately (R4 ruling 11): the RING is
// CSS — a keyframe animation whose period is the pill's own custom property, so it
// cannot drift against a React render — while the CLICK is a Web Audio metronome
// with a lookahead loop. What the timer assertions pin is that the loop belongs to
// the active state and to nothing else: none before the first tap, none after the
// second, none after unmount.
import { cleanup, fireEvent, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import TempoPill from "../TempoPill";
import { haptic } from "@/app/utils/haptics";

// The tap is a tap: one light haptic per TOGGLE. Mocked rather than left to the
// real module's `isNativeApp()` no-op, so "fires on every render" — the failure
// an inline `void haptic()` outside the handler would produce — is visible here.
vi.mock("@/app/utils/haptics", () => ({ haptic: vi.fn(() => Promise.resolve()) }));

// jsdom ships no Web Audio API, so the pill would ring silently and schedule
// nothing. The fake is the smallest context the scheduler touches.
class FakeAudioContext {
  currentTime = 0;
  state = "suspended";
  destination = {};
  resume = vi.fn(() => Promise.resolve());
  suspend = vi.fn(() => Promise.resolve());
  createOscillator() {
    return {
      type: "sine",
      frequency: { value: 0 },
      connect: vi.fn(),
      start: vi.fn(),
      stop: vi.fn(),
    };
  }
  createGain() {
    return {
      gain: { value: 0, setValueAtTime: vi.fn(), exponentialRampToValueAtTime: vi.fn() },
      connect: vi.fn(),
    };
  }
}

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

beforeEach(() => {
  vi.useFakeTimers();
  vi.mocked(haptic).mockClear();
  vi.stubGlobal("AudioContext", FakeAudioContext);
});

describe("TempoPill", () => {
  it("toggles the beat and carries its period as a custom property", () => {
    const { getByRole } = render(<TempoPill bpm={120} timeSig="4/4" />);
    const pill = getByRole("button") as HTMLButtonElement;

    expect(pill.textContent).toContain("120 BPM");
    expect(pill.getAttribute("aria-pressed")).toBe("false");
    // Absent, not "false": the ring rule keys on [data-active="true"], and an
    // idle pill carrying the attribute at all reads like a state that exists.
    expect(pill.dataset.active).toBeUndefined();
    expect(pill.style.getPropertyValue("--tempo-period")).toBe("500ms");
    expect(pill.getAttribute("aria-label")).toBe("Marcar tempo con clic, 120 BPM");

    expect(haptic).not.toHaveBeenCalled();

    fireEvent.click(pill);
    expect(pill.getAttribute("aria-pressed")).toBe("true");
    expect(pill.dataset.active).toBe("true");
    expect(pill.getAttribute("aria-label")).toBe("Detener el clic, 120 BPM");
    expect(haptic).toHaveBeenCalledTimes(1);
    expect(haptic).toHaveBeenLastCalledWith("light");

    fireEvent.click(pill);
    expect(pill.getAttribute("aria-pressed")).toBe("false");
    expect(pill.dataset.active).toBeUndefined();
    expect(haptic).toHaveBeenCalledTimes(2);
  });

  it("schedules the click loop only while active, and unmounts clean", () => {
    const { getByRole, unmount } = render(<TempoPill bpm={92} timeSig="4/4" />);
    const pill = getByRole("button");

    expect(vi.getTimerCount()).toBe(0);

    fireEvent.click(pill);
    expect(vi.getTimerCount()).toBeGreaterThan(0);

    fireEvent.click(pill);
    expect(vi.getTimerCount()).toBe(0);

    fireEvent.click(pill);
    expect(vi.getTimerCount()).toBeGreaterThan(0);
    unmount();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("drops the beat when the tempo changes underneath it", () => {
    const { getByRole, rerender } = render(<TempoPill bpm={92} timeSig="4/4" />);
    const pill = getByRole("button");

    fireEvent.click(pill);
    expect(pill.dataset.active).toBe("true");

    rerender(<TempoPill bpm={140} timeSig="4/4" />);
    expect(pill.dataset.active).toBeUndefined();
    expect(vi.getTimerCount()).toBe(0);
    expect(pill.style.getPropertyValue("--tempo-period")).toBe(`${60000 / 140}ms`);
  });

  it("goes quiet when its surface is dismissed under it", () => {
    // `SongSheet` passes `enabled={isOpen}`: a pill kept mounted behind a closed
    // sheet must not keep clicking (F2, ruling 16).
    const { getByRole, rerender } = render(<TempoPill bpm={120} timeSig="4/4" enabled />);
    const pill = getByRole("button");

    fireEvent.click(pill);
    expect(pill.getAttribute("aria-pressed")).toBe("true");
    expect(vi.getTimerCount()).toBeGreaterThan(0);

    rerender(<TempoPill bpm={120} timeSig="4/4" enabled={false} />);
    expect(pill.getAttribute("aria-pressed")).toBe("false");
    expect(pill.dataset.active).toBeUndefined();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("renders the sheet's chrome at size sm, the hero's at md", () => {
    const { getByRole, rerender } = render(<TempoPill bpm={120} timeSig="4/4" size="sm" />);
    const pill = getByRole("button");

    // Same ring, same 44px target, different skin.
    expect(pill.className).toContain("brand-tempo-pill");
    expect(pill.className).toContain("min-h-[44px]");
    expect(pill.className).toContain("rounded-full");
    expect(pill.className).toContain("border-ink-muted/15");
    expect(pill.className).toContain("text-ink-muted/70");
    expect(pill.className).toContain("aria-pressed:border-accent/60");
    expect(pill.className).not.toContain("brand-search-console");

    rerender(<TempoPill bpm={120} timeSig="4/4" />);
    expect(pill.className).toContain("brand-search-console");
    expect(pill.className).toContain("uppercase");
    expect(pill.className).not.toContain("rounded-full");
  });

  it("still rings where the Web Audio API does not exist", () => {
    vi.stubGlobal("AudioContext", undefined);
    const { getByRole } = render(<TempoPill bpm={120} timeSig="4/4" />);
    const pill = getByRole("button");

    fireEvent.click(pill);
    expect(pill.dataset.active).toBe("true");
    expect(vi.getTimerCount()).toBe(0);
  });
});
