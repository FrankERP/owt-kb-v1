/** @vitest-environment jsdom */
//
// Drag-select in the twelve-month grid (R3 F2): «Seleccionar fechas», drag
// across the days you will miss, release, write one «Razón».
//
// The grid is rendered DIRECTLY here with a stub `Availability`, unlike
// `weekendList.test.tsx`: what is under test is the gesture, and the hook's own
// contract (the revision, the dirty fingerprint, the save) is pinned in
// `useAvailability.test.tsx` and `availabilityCalendarConflict.test.tsx`. A real
// hook here would only hide which call the gesture actually made.
//
// jsdom has neither layout nor pointer capture, so both are stubbed: every
// `getBoundingClientRect` answers one fixed box (the shadow's distance
// arithmetic reads the last visible tile's bottom), and `elementFromPoint` is
// pointed at the intended cell before each event — that is the only thing the
// grid can ask once the pointer is captured by the container.

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { installMotionTestEnv } from "@/app/components/ui/__tests__/motionTestSetup";
import { MotionProvider } from "@/app/components/ui/MotionProvider";
import AvailabilityGrid from "../AvailabilityGrid";
import type { Availability } from "../useAvailability";

const hapticMock = vi.fn();
vi.mock("@/app/utils/haptics", () => ({ haptic: (k: string) => hapticMock(k) }));

installMotionTestEnv();
// Warm the LazyMotion feature chunk (ADR-0031), precedent Menu.test.tsx.
beforeAll(async () => { await import("@/app/components/ui/motionFeatures"); });

/** The one box jsdom gets to report: the tile bottom the shadow measures from. */
const TILE_BOTTOM = 500;

const markMock       = vi.fn();
const applyRangeMock = vi.fn();
const openNoteMock   = vi.fn();
const closeNoteMock  = vi.fn();

function stubState(): Availability {
  return {
    dates: new Set<string>(),
    notes: new Map<string, string>(),
    todayIso: "2026-09-09",
    upcomingCount: 0,
    mark: markMock,
    remove: vi.fn(),
    toggle: vi.fn(),
    setNote: vi.fn(),
    applyRecurring: vi.fn(),
    applyRange: applyRangeMock,
    save: vi.fn(),
    saving: false,
    saved: false,
    dirty: false,
    saveError: null,
    conflict: null,
  };
}

beforeEach(() => {
  // Wednesday 9 September 2026 — page 0 is Septiembre, Octubre, Noviembre 2026.
  vi.useFakeTimers({ shouldAdvanceTime: true });
  vi.setSystemTime(new Date("2026-09-09T12:00:00-06:00"));
  markMock.mockReset();
  applyRangeMock.mockReset();
  openNoteMock.mockReset();
  closeNoteMock.mockReset();
  hapticMock.mockReset();
  // The release opens the popover on the next frame, once paging has mounted
  // the anchor cell. Run it inline so the assertion does not need a flush.
  vi.stubGlobal("requestAnimationFrame", (cb: FrameRequestCallback) => { cb(0); return 0; });
  vi.spyOn(Element.prototype, "getBoundingClientRect").mockReturnValue({
    top: 100, bottom: TILE_BOTTOM, height: 400, left: 0, right: 300, width: 300, x: 0, y: 100,
    toJSON: () => ({}),
  });
  (HTMLElement.prototype as unknown as { setPointerCapture: unknown }).setPointerCapture = vi.fn();
  (HTMLElement.prototype as unknown as { releasePointerCapture: unknown }).releasePointerCapture = vi.fn();
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  vi.useRealTimers();
});

function renderGrid() {
  render(
    <MotionProvider>
      <AvailabilityGrid
        state={stubState()}
        openNote={openNoteMock}
        closeNote={closeNoteMock}
      />
    </MotionProvider>,
  );
  return document.getElementById("availability-months")!;
}

/** The day cell for an iso, anywhere in the mounted grid (shadow tile included). */
function cell(iso: string): HTMLElement {
  const found = document.querySelectorAll<HTMLElement>(`[data-iso="${iso}"]`);
  if (!found.length) throw new Error(`no cell for ${iso}`);
  return found[found.length - 1];
}

/** Point `elementFromPoint` at a cell — the grid's only way to read the finger. */
function over(el: Element) {
  document.elementFromPoint = () => el;
}

const enterMode = () => fireEvent.click(screen.getByRole("button", { name: "Seleccionar fechas" }));

const DOWN = { pointerId: 1, isPrimary: true, button: 0 } as const;
const MOVE = { pointerId: 1, buttons: 1 } as const;

describe("AvailabilityGrid — drag-select", () => {
  it("outside the mode a cell click still marks the day and opens its single-day note", () => {
    renderGrid();
    const target = cell("2026-09-12");
    fireEvent.click(target);

    expect(markMock).toHaveBeenCalledWith("2026-09-12");
    expect(openNoteMock.mock.calls).toEqual([["2026-09-12", target]]);
  });

  it("a drag commits the whole range once and opens ONE note for it", () => {
    const months = renderGrid();
    enterMode();

    over(cell("2026-09-12"));
    fireEvent.pointerDown(months, { ...DOWN, clientX: 10, clientY: 200 });
    over(cell("2026-09-15"));
    fireEvent.pointerMove(months, { ...MOVE, clientX: 10, clientY: 200 });

    // The preview is on every day of the range before anything is committed.
    for (const iso of ["2026-09-12", "2026-09-13", "2026-09-14", "2026-09-15"]) {
      expect(cell(iso).className).toContain("ring-availability-strong/50");
    }
    expect(applyRangeMock).not.toHaveBeenCalled();

    fireEvent.pointerUp(months, { pointerId: 1 });

    expect(applyRangeMock.mock.calls).toEqual([["2026-09-12", "2026-09-15", true]]);
    expect(openNoteMock.mock.calls).toEqual([[
      "2026-09-12",
      cell("2026-09-12"),
      ["2026-09-12", "2026-09-13", "2026-09-14", "2026-09-15"],
    ]]);
    // The cell's own click must not double-mark behind the gesture.
    expect(markMock).not.toHaveBeenCalled();
  });

  it("a backwards drag commits the same ascending range", () => {
    const months = renderGrid();
    enterMode();

    over(cell("2026-09-15"));
    fireEvent.pointerDown(months, { ...DOWN, clientX: 10, clientY: 200 });
    over(cell("2026-09-12"));
    fireEvent.pointerMove(months, { ...MOVE, clientX: 10, clientY: 200 });
    fireEvent.pointerUp(months, { pointerId: 1 });

    expect(applyRangeMock.mock.calls).toEqual([["2026-09-12", "2026-09-15", true]]);
    expect(openNoteMock.mock.calls[0][0]).toBe("2026-09-12");
  });

  it("a cancelled drag commits nothing", () => {
    const months = renderGrid();
    enterMode();

    over(cell("2026-09-12"));
    fireEvent.pointerDown(months, { ...DOWN, clientX: 10, clientY: 200 });
    over(cell("2026-09-15"));
    fireEvent.pointerMove(months, { ...MOVE, clientX: 10, clientY: 200 });
    fireEvent.pointerCancel(months, { pointerId: 1 });

    expect(applyRangeMock).not.toHaveBeenCalled();
    expect(openNoteMock).not.toHaveBeenCalled();
    expect(cell("2026-09-13").className).not.toContain("ring-availability-strong/50");
  });

  it("Escape during a drag cancels it", () => {
    const months = renderGrid();
    enterMode();

    over(cell("2026-09-12"));
    fireEvent.pointerDown(months, { ...DOWN, clientX: 10, clientY: 200 });
    over(cell("2026-09-15"));
    fireEvent.pointerMove(months, { ...MOVE, clientX: 10, clientY: 200 });
    fireEvent.keyDown(window, { key: "Escape" });

    expect(cell("2026-09-13").className).not.toContain("ring-availability-strong/50");
    fireEvent.pointerUp(months, { pointerId: 1 });
    expect(applyRangeMock).not.toHaveBeenCalled();
  });

  it("«Listo» leaves the mode and gives the page its scrolling back", () => {
    const months = renderGrid();
    expect(months.style.touchAction).toBe("");

    enterMode();
    const done = screen.getByRole("button", { name: "Listo" });
    expect(done.getAttribute("aria-pressed")).toBe("true");
    expect(months.style.touchAction).toBe("none");

    fireEvent.click(done);
    expect(months.style.touchAction).toBe("");
    expect(screen.getByRole("button", { name: "Seleccionar fechas" }).getAttribute("aria-pressed")).toBe("false");
    expect(closeNoteMock).toHaveBeenCalled();
  });

  it("the next month's shadow only exists while the finger nears the page edge, and solidifies there", () => {
    const months = renderGrid();
    enterMode();

    over(cell("2026-09-12"));
    fireEvent.pointerDown(months, { ...DOWN, clientX: 10, clientY: 200 });
    expect(document.querySelector("[data-shadow]")).toBeNull();

    // 60px above the last visible tile's bottom — half of `shadowOpacity`'s reach.
    over(cell("2026-09-13"));
    fireEvent.pointerMove(months, { ...MOVE, clientX: 10, clientY: TILE_BOTTOM - 60 });
    const tile = document.querySelector("[data-shadow]")!;
    expect(tile.getAttribute("data-shadow")).toBe("true");
    expect(tile.getAttribute("data-solid")).toBe("false");
    expect(tile.getAttribute("aria-hidden")).toBe("true");
    expect(tile.textContent).toContain("Diciembre");

    over(cell("2026-09-14"));
    fireEvent.pointerMove(months, { ...MOVE, clientX: 10, clientY: TILE_BOTTOM });
    expect(document.querySelector("[data-shadow]")!.getAttribute("data-solid")).toBe("true");
  });

  it("a drag that ends in the solid shadow month commits into it and pages forward", () => {
    const months = renderGrid();
    enterMode();

    over(cell("2026-09-12"));
    fireEvent.pointerDown(months, { ...DOWN, clientX: 10, clientY: 200 });
    // Reach the bottom of the last visible tile: the shadow goes solid and mounts.
    over(cell("2026-11-30"));
    fireEvent.pointerMove(months, { ...MOVE, clientX: 10, clientY: TILE_BOTTOM });
    // Now the December cells exist and resolve, because the shadow is solid.
    over(cell("2026-12-01"));
    fireEvent.pointerMove(months, { ...MOVE, clientX: 10, clientY: TILE_BOTTOM });
    fireEvent.pointerUp(months, { pointerId: 1 });

    expect(applyRangeMock.mock.calls).toEqual([["2026-09-12", "2026-12-01", true]]);
    expect(screen.getByText("Diciembre 2026 – Febrero 2027")).toBeTruthy();
    expect(document.querySelector("[data-shadow]")).toBeNull();
  });

  it("the date fields live inside the grid and mark a span through the hook", () => {
    renderGrid();
    const toggle = screen.getByRole("button", { name: "Rango por fechas" });
    expect(toggle.getAttribute("aria-expanded")).toBe("false");
    fireEvent.click(toggle);
    expect(toggle.getAttribute("aria-expanded")).toBe("true");

    const desde  = screen.getByLabelText("Desde") as HTMLInputElement;
    const hasta  = screen.getByLabelText("Hasta") as HTMLInputElement;
    const marcar = screen.getByRole("button", { name: "Marcar" }) as HTMLButtonElement;
    expect(marcar.disabled).toBe(true);

    fireEvent.change(desde, { target: { value: "2026-09-16" } });
    fireEvent.change(hasta, { target: { value: "2026-09-18" } });
    expect(marcar.disabled).toBe(false);
    fireEvent.click(marcar);

    expect(applyRangeMock.mock.calls).toEqual([["2026-09-16", "2026-09-18", true]]);
    expect(toggle.getAttribute("aria-expanded")).toBe("false");
  });
});
