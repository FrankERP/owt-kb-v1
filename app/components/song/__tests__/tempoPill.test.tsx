/** @vitest-environment jsdom */
// The BPM pill taps a tempo. The beat is CSS-clocked — a keyframe animation
// whose period is the pill's own custom property — so the assertion that
// matters as much as the aria state is that nothing schedules a timer: a
// JS-driven metronome would keep running past unmount and drift under load.
import { cleanup, fireEvent, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import TempoPill from "../TempoPill";
import { haptic } from "@/app/utils/haptics";

// The tap is a tap: one light haptic per TOGGLE. Mocked rather than left to the
// real module's `isNativeApp()` no-op, so "fires on every render" — the failure
// an inline `void haptic()` outside the handler would produce — is visible here.
vi.mock("@/app/utils/haptics", () => ({ haptic: vi.fn(() => Promise.resolve()) }));

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

beforeEach(() => {
  vi.useFakeTimers();
  vi.mocked(haptic).mockClear();
});

describe("TempoPill", () => {
  it("toggles the beat and carries its period as a custom property", () => {
    const { getByRole } = render(<TempoPill bpm={120} />);
    const pill = getByRole("button") as HTMLButtonElement;

    expect(pill.textContent).toContain("120 BPM");
    expect(pill.getAttribute("aria-pressed")).toBe("false");
    // Absent, not "false": the ring rule keys on [data-active="true"], and an
    // idle pill carrying the attribute at all reads like a state that exists.
    expect(pill.dataset.active).toBeUndefined();
    expect(pill.style.getPropertyValue("--tempo-period")).toBe("500ms");
    expect(pill.getAttribute("aria-label")).toBe("Marcar tempo, 120 BPM");

    expect(haptic).not.toHaveBeenCalled();

    fireEvent.click(pill);
    expect(pill.getAttribute("aria-pressed")).toBe("true");
    expect(pill.dataset.active).toBe("true");
    expect(pill.getAttribute("aria-label")).toBe("Detener tempo, 120 BPM");
    expect(haptic).toHaveBeenCalledTimes(1);
    expect(haptic).toHaveBeenLastCalledWith("light");

    fireEvent.click(pill);
    expect(pill.getAttribute("aria-pressed")).toBe("false");
    expect(pill.dataset.active).toBeUndefined();
    expect(haptic).toHaveBeenCalledTimes(2);
  });

  it("schedules no timer, beating or not, and unmounts clean", () => {
    const { getByRole, unmount } = render(<TempoPill bpm={92} />);
    const pill = getByRole("button");

    expect(vi.getTimerCount()).toBe(0);
    fireEvent.click(pill);
    expect(vi.getTimerCount()).toBe(0);

    unmount();
    expect(vi.getTimerCount()).toBe(0);
  });
});
