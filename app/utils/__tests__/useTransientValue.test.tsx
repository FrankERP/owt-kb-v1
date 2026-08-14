/** @vitest-environment jsdom */
//
// The bug this hook exists to kill, pinned as a test.
//
// Eight sites had `setToast(msg); setTimeout(() => setToast(null), 3000)` with
// no handle on the timer, so a second toast inside the window inherited the
// first one's clock instead of starting its own. The case that actually costs
// something is success-then-error: the error is the message that flashes and
// disappears, and the toast is often the only signal that a mutation failed.

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render, cleanup, act, screen } from "@testing-library/react";

import { useTransientValue } from "../useTransientValue";

beforeEach(() => vi.useFakeTimers());
afterEach(() => {
  vi.useRealTimers();
  cleanup();
});

function Toaster({ ms = 3000 }: { ms?: number }) {
  const [toast, showToast] = useTransientValue<string | null>(null, ms);
  return (
    <div>
      <span data-testid="toast">{toast ?? "—"}</span>
      <button data-testid="a" onClick={() => showToast("guardado")}>a</button>
      <button data-testid="b" onClick={() => showToast("error al guardar")}>b</button>
    </div>
  );
}

const toast = () => screen.getByTestId("toast").textContent;
const click = (id: string) => act(() => { screen.getByTestId(id).click(); });
const advance = (ms: number) => act(() => { vi.advanceTimersByTime(ms); });

describe("useTransientValue", () => {
  it("shows the value and reverts to idle after the delay", () => {
    render(<Toaster />);
    expect(toast()).toBe("—");
    click("a");
    expect(toast()).toBe("guardado");
    advance(2999);
    expect(toast()).toBe("guardado");
    advance(1);
    expect(toast()).toBe("—");
  });

  it("gives a second value its OWN full window — the regression", () => {
    render(<Toaster />);
    click("a");
    advance(2900); // the old code's timer is 100ms from firing here
    click("b");
    advance(200); // …and would have cleared the error at this point
    expect(toast()).toBe("error al guardar");
    advance(2799);
    expect(toast()).toBe("error al guardar");
    advance(1);
    expect(toast()).toBe("—");
  });

  it("does not fire into an unmounted component", () => {
    const { unmount } = render(<Toaster />);
    click("a");
    unmount();
    // A leaked timer would call setValue on a gone component here.
    expect(() => advance(5000)).not.toThrow();
    expect(vi.getTimerCount()).toBe(0);
  });

  // `reset` exists for invalidation that is not time-based — AvailabilityCalendar
  // clears "Guardado ✓" the moment a date is edited. The point is that it CANCELS:
  // faking a reset by showing the idle value would arm another timer.
  it("reset returns to idle now and cancels the pending timer", () => {
    function Resettable() {
      const [toast, showToast, reset] = useTransientValue<string | null>(null, 3000);
      return (
        <div>
          <span data-testid="toast">{toast ?? "—"}</span>
          <button data-testid="a" onClick={() => showToast("guardado")}>a</button>
          <button data-testid="r" onClick={reset}>r</button>
        </div>
      );
    }
    render(<Resettable />);
    click("a");
    expect(toast()).toBe("guardado");
    click("r");
    expect(toast()).toBe("—");
    expect(vi.getTimerCount()).toBe(0);
    // And nothing fires later to re-clear a value shown after the reset.
    click("a");
    advance(2999);
    expect(toast()).toBe("guardado");
  });

  it("keeps `show` stable so it is safe in a dependency array", () => {
    const seen: Array<(next: string | null) => void> = [];
    function Probe() {
      const [, show] = useTransientValue<string | null>(null, 3000);
      const [, force] = useTransientValue<number>(0, 3000);
      seen.push(show);
      return <button data-testid="force" onClick={() => force(1)}>force</button>;
    }
    render(<Probe />);
    click("force");
    expect(seen.length).toBeGreaterThan(1);
    expect(new Set(seen).size).toBe(1);
  });
});
