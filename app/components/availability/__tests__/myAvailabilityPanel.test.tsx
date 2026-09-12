/** @vitest-environment jsdom */
//
// The «Rango…» panel (F1, Frank's look): a special service mid-week needs more
// than the ten weekend rows can express. Rendered through the host, same reason
// as `weekendList.test.tsx` — the range write goes through the one
// `useAvailability` the panel shares with the list and the grid.

import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { installMotionTestEnv } from "@/app/components/ui/__tests__/motionTestSetup";
import { MotionProvider } from "@/app/components/ui/MotionProvider";
import MyAvailabilityPanel from "../MyAvailabilityPanel";

const toastMock = vi.fn();
vi.mock("@/app/components/ui/Toast", () => ({
  useToast: () => ({ toast: toastMock, dismiss: vi.fn() }),
}));
vi.mock("@/app/utils/haptics", () => ({ haptic: vi.fn() }));

installMotionTestEnv();
beforeAll(async () => { await import("@/app/components/ui/motionFeatures"); });

beforeEach(() => {
  // Wednesday 9 September 2026, same pin as weekendList.test.tsx.
  vi.useFakeTimers({ shouldAdvanceTime: true });
  vi.setSystemTime(new Date("2026-09-09T12:00:00-06:00"));
  vi.stubGlobal("fetch", vi.fn());
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

function renderPanel() {
  return render(
    <MotionProvider>
      <MyAvailabilityPanel initialRev="rev-1" initialDates={[]} initialNotes={[]} />
    </MotionProvider>,
  );
}

describe("MyAvailabilityPanel — Rango…", () => {
  it("opens the range panel, marks a span, and reflects it in the upcoming count", () => {
    renderPanel();

    const toggle = screen.getByRole("button", { name: "Rango…" });
    expect(toggle.getAttribute("aria-expanded")).toBe("false");
    fireEvent.click(toggle);
    expect(toggle.getAttribute("aria-expanded")).toBe("true");

    const range = document.getElementById("availability-range")!;
    const desde = within(range).getByLabelText("Desde") as HTMLInputElement;
    const hasta = within(range).getByLabelText("Hasta") as HTMLInputElement;
    // Both panels' children stay mounted (Collapse), so scope to this one —
    // «Repetir…» has its own «Marcar» button too.
    const marcar = within(range).getByRole("button", { name: "Marcar" }) as HTMLButtonElement;
    expect(marcar.disabled).toBe(true);

    fireEvent.change(desde, { target: { value: "2026-09-16" } });
    fireEvent.change(hasta, { target: { value: "2026-09-18" } });
    expect(marcar.disabled).toBe(false);

    fireEvent.click(marcar);

    expect(screen.getByText(/3 fechas marcadas como no disponible/)).toBeTruthy();
    expect(screen.getByText("Cambios sin guardar")).toBeTruthy();
    // The panel closes after applying, like «Marcar» does for the recurring series.
    expect(toggle.getAttribute("aria-expanded")).toBe("false");
  });

  it("keeps «Marcar» disabled for an all-past range", () => {
    renderPanel();

    const toggle = screen.getByRole("button", { name: "Rango…" });
    fireEvent.click(toggle);

    const range = document.getElementById("availability-range")!;
    const desde = within(range).getByLabelText("Desde") as HTMLInputElement;
    const hasta = within(range).getByLabelText("Hasta") as HTMLInputElement;
    const marcar = within(range).getByRole("button", { name: "Marcar" }) as HTMLButtonElement;

    // "Today" is pinned to 2026-09-09; both ends of the range are before it.
    fireEvent.change(desde, { target: { value: "2026-09-01" } });
    fireEvent.change(hasta, { target: { value: "2026-09-05" } });

    expect(marcar.disabled).toBe(true);
  });

  it("opening «Rango…» closes an open «Repetir…» panel and vice versa", () => {
    renderPanel();
    const recur = screen.getByRole("button", { name: "Repetir…" });
    const range = screen.getByRole("button", { name: "Rango…" });

    fireEvent.click(recur);
    expect(recur.getAttribute("aria-expanded")).toBe("true");

    fireEvent.click(range);
    expect(range.getAttribute("aria-expanded")).toBe("true");
    expect(recur.getAttribute("aria-expanded")).toBe("false");
  });
});
