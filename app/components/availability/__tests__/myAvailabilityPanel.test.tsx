/** @vitest-environment jsdom */
//
// The availability host's own shape (R3 F3): the calendar IS the page now
// (`/me/disponibilidad`), so the grid is no longer behind a «Ver calendario»
// disclosure and there is no second surface — the weekend pills and the
// Desde/Hasta fields retired with F3, leaving one way to mark a date.
//
// What is pinned here is exactly that: the grid is mounted on first render, the
// retired affordances are gone, and «Repetir…» — the host's one remaining
// disclosure — still toggles. The edits themselves go through the single
// `useAvailability` the host owns, which is why this renders the host rather
// than the grid (`availabilityCalendarConflict.test.tsx` pins the save).

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
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
  // Wednesday 9 September 2026 — the first visible page is Septiembre–Noviembre.
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

describe("MyAvailabilityPanel — one surface (R3 F3)", () => {
  it("renders the grid open, with no «Ver calendario» disclosure to find first", () => {
    renderPanel();
    expect(screen.queryByRole("button", { name: "Ver calendario" })).toBeNull();
    expect(screen.getByRole("button", { name: "Seleccionar fechas" })).toBeTruthy();
    expect(screen.getByText("Septiembre 2026")).toBeTruthy();
  });

  it("offers none of the retired range surfaces", () => {
    renderPanel();
    expect(screen.queryByRole("button", { name: "Rango…" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Rango por fechas" })).toBeNull();
    expect(screen.queryByLabelText("Desde")).toBeNull();
    expect(screen.queryByLabelText("Hasta")).toBeNull();
    // The weekend pills went with them: no VIE/SÁB/DOM toggles anywhere.
    expect(screen.queryByRole("button", { name: /^VIE$/ })).toBeNull();
    expect(screen.queryByRole("button", { name: /^SÁB$/ })).toBeNull();
    expect(screen.queryByRole("button", { name: /^DOM$/ })).toBeNull();
  });

  it("«Repetir…» is the host's one disclosure, and it still toggles", () => {
    renderPanel();
    const recur = screen.getByRole("button", { name: "Repetir…" });
    expect(recur.getAttribute("aria-expanded")).toBe("false");
    fireEvent.click(recur);
    expect(recur.getAttribute("aria-expanded")).toBe("true");
    fireEvent.click(recur);
    expect(recur.getAttribute("aria-expanded")).toBe("false");
  });

  it("counts the dates it was rendered with, and «Guardar» waits for an edit", () => {
    render(
      <MotionProvider>
        <MyAvailabilityPanel initialRev="rev-1" initialDates={["2026-09-20", "2026-10-04"]} initialNotes={[]} />
      </MotionProvider>,
    );
    expect(screen.getByText(/2 fechas marcadas como no disponible/)).toBeTruthy();
    expect((screen.getByRole("button", { name: "Guardar" }) as HTMLButtonElement).disabled).toBe(true);
  });
});
