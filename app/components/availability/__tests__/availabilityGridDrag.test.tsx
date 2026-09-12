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
  // The release opens the popover from an EFFECT, not a frame callback: the
  // anchor cell only exists once the page turn has committed. `fireEvent` already
  // flushes effects, so nothing has to be stubbed or advanced here.
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
    // It is an OVERLAY inside the last visible tile, not a fourth tile below the
    // row: its host is the one that still carries Noviembre's own days.
    expect(tile.className).toContain("absolute");
    expect(tile.parentElement!.querySelector('[data-iso="2026-11-30"]')).not.toBeNull();

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

    // The note still belongs to the range's first day, but it is ANCHORED to the
    // first day still on screen — September unmounted with the page turn, and a
    // detached node would position the popover from a zero rect.
    const [iso, anchor, isos] = openNoteMock.mock.calls[0] as [string, HTMLElement, string[]];
    expect(iso).toBe("2026-09-12");
    expect(anchor).toBe(cell("2026-12-01"));
    expect(anchor.getAttribute("data-iso")).toBe("2026-12-01");
    expect(isos[0]).toBe("2026-09-12");
    expect(isos[isos.length - 1]).toBe("2026-12-01");
  });

  it("once reached, the shadow STAYS solid so its own days can be selected", () => {
    // The overlay's cells end above its host tile's bottom edge (padding and
    // border), so the band where the distance is zero sits below every day it
    // offers. Solidity therefore latches: touch the bottom once, then move back
    // up into December.
    const months = renderGrid();
    enterMode();

    over(cell("2026-09-12"));
    fireEvent.pointerDown(months, { ...DOWN, clientX: 10, clientY: 200 });
    over(cell("2026-11-30"));
    fireEvent.pointerMove(months, { ...MOVE, clientX: 10, clientY: TILE_BOTTOM });
    expect(document.querySelector("[data-shadow]")!.getAttribute("data-solid")).toBe("true");

    // 40px back up the tile — un-latched this would fade to 0.67 and stop
    // resolving, which is exactly the position a finger reaches December from.
    over(cell("2026-12-03"));
    fireEvent.pointerMove(months, { ...MOVE, clientX: 10, clientY: TILE_BOTTOM - 40 });
    expect(document.querySelector("[data-shadow]")!.getAttribute("data-solid")).toBe("true");
    expect(cell("2026-12-03").className).toContain("ring-availability-strong/50");

    fireEvent.pointerUp(months, { pointerId: 1, clientX: 10, clientY: TILE_BOTTOM - 40 });
    expect(applyRangeMock.mock.calls).toEqual([["2026-09-12", "2026-12-03", true]]);
  });

  it("the shadow is inert while it fades and takes the pointer only once solid", () => {
    // While fading it lies over the host's own lower rows: if it ate the pointer
    // there, every move would resolve nothing and the release would commit a
    // stale end — the wrong range, silently.
    const months = renderGrid();
    enterMode();

    over(cell("2026-09-12"));
    fireEvent.pointerDown(months, { ...DOWN, clientX: 10, clientY: 200 });
    over(cell("2026-09-13"));
    fireEvent.pointerMove(months, { ...MOVE, clientX: 10, clientY: TILE_BOTTOM - 60 });
    expect(document.querySelector("[data-shadow]")!.className).toContain("pointer-events-none");

    over(cell("2026-09-14"));
    fireEvent.pointerMove(months, { ...MOVE, clientX: 10, clientY: TILE_BOTTOM });
    expect(document.querySelector("[data-shadow]")!.className).not.toContain("pointer-events-none");
  });

  it("a release with no intermediate move still commits the day under the finger", () => {
    // `pointermove` is continuous and `pointerup` discrete: React may not have
    // committed the last move when the release runs, so the handler reads the
    // live drag from a ref and re-resolves the end from the release's own point.
    const months = renderGrid();
    enterMode();

    over(cell("2026-09-12"));
    fireEvent.pointerDown(months, { ...DOWN, clientX: 10, clientY: 200 });
    over(cell("2026-09-16"));
    fireEvent.pointerUp(months, { pointerId: 1, clientX: 10, clientY: 200 });

    expect(applyRangeMock.mock.calls).toEqual([["2026-09-12", "2026-09-16", true]]);
  });

  it("a second finger neither moves the anchor nor commits the range", () => {
    const months = renderGrid();
    enterMode();

    over(cell("2026-09-12"));
    fireEvent.pointerDown(months, { ...DOWN, clientX: 10, clientY: 200 });
    over(cell("2026-09-14"));
    fireEvent.pointerMove(months, { ...MOVE, clientX: 10, clientY: 200 });

    // A second touch: non-primary, its own id. Its down must not re-anchor, its
    // move must not drag, and its lift must not commit anything.
    over(cell("2026-09-20"));
    fireEvent.pointerDown(months, { pointerId: 2, isPrimary: false, button: 0, clientX: 80, clientY: 200 });
    fireEvent.pointerMove(months, { pointerId: 2, buttons: 1, clientX: 80, clientY: 200 });
    fireEvent.pointerUp(months, { pointerId: 2, clientX: 80, clientY: 200 });

    expect(applyRangeMock).not.toHaveBeenCalled();
    expect(openNoteMock).not.toHaveBeenCalled();
    expect(cell("2026-09-20").className).not.toContain("ring-availability-strong/50");

    // The original finger still owns the drag it started.
    over(cell("2026-09-14"));
    fireEvent.pointerUp(months, { pointerId: 1, clientX: 10, clientY: 200 });
    expect(applyRangeMock.mock.calls).toEqual([["2026-09-12", "2026-09-14", true]]);
  });

  it("offers no date fields — F3 retired them, the drag is the only range", () => {
    renderGrid();
    expect(screen.queryByRole("button", { name: "Rango por fechas" })).toBeNull();
    expect(screen.queryByLabelText("Desde")).toBeNull();
    expect(screen.queryByLabelText("Hasta")).toBeNull();
  });

  it("a lost pointerup does not carry the latch into the next drag", () => {
    // A pointerup may be lost (or misfired elsewhere), leaving the latch solid.
    // The next pointerdown MUST reset it, or the second drag inherits the latched
    // state and appears solid even though the finger is far from the bottom edge.
    // This guards the `solidRef.current = false` in `onPointerDown`.
    const months = renderGrid();
    enterMode();

    // First drag: reach the bottom and latch solid.
    over(cell("2026-09-12"));
    fireEvent.pointerDown(months, { ...DOWN, clientX: 10, clientY: 200 });
    over(cell("2026-11-30"));
    fireEvent.pointerMove(months, { ...MOVE, clientX: 10, clientY: TILE_BOTTOM });
    expect(document.querySelector("[data-shadow]")!.getAttribute("data-solid")).toBe("true");

    // NO pointerup or pointerCancel — simulate a lost release event.
    // The latch is still active in the component's ref.

    // Second drag: same pointerId, isPrimary, but on the 13th (different day).
    over(cell("2026-09-13"));
    fireEvent.pointerDown(months, { ...DOWN, clientX: 10, clientY: 200 });
    // Move far from the bottom: 40px up the tile.
    over(cell("2026-09-13"));
    fireEvent.pointerMove(months, { ...MOVE, clientX: 10, clientY: TILE_BOTTOM - 40 });

    // The overlay should exist but NOT be solid. If the latch was not reset
    // in onPointerDown, it would still be solid from the lost first drag.
    const tile = document.querySelector("[data-shadow]");
    expect(tile).not.toBeNull();
    expect(tile!.getAttribute("data-solid")).toBe("false");
  });

  it("paging mid-drag ends the drag without committing", () => {
    // A click on «Siguiente» while dragging must cancel the gesture, reset the
    // drag state, and reset the latch. If a move event arrives after paging
    // before a new down, the latch must not persist from the old drag.
    // This guards the `solidRef.current = false` in `goTo`.
    const months = renderGrid();
    enterMode();

    // Drag to the bottom and latch solid on page 0.
    over(cell("2026-09-12"));
    fireEvent.pointerDown(months, { ...DOWN, clientX: 10, clientY: 200 });
    over(cell("2026-11-30"));
    fireEvent.pointerMove(months, { ...MOVE, clientX: 10, clientY: TILE_BOTTOM });
    expect(document.querySelector("[data-shadow]")!.getAttribute("data-solid")).toBe("true");

    // Page to page 1. goTo must reset dragRef, solidRef, and shadow.
    const nextButton = screen.getByRole("button", { name: /Siguiente/ });
    fireEvent.click(nextButton);

    // The shadow is gone and the page advanced.
    expect(document.querySelector("[data-shadow]")).toBeNull();
    expect(screen.getByText("Diciembre 2026 – Febrero 2027")).toBeTruthy();

    // Simulate an edge case: a move event arrives on the new page without
    // a new down. This tests that the latch was reset in goTo, not relying
    // on onPointerDown to reset it.
    over(cell("2027-01-15"));
    fireEvent.pointerMove(months, { ...MOVE, clientX: 10, clientY: TILE_BOTTOM - 40 });

    // The shadow should NOT be solid. If the latch wasn't reset in goTo,
    // it would still be true even though we're far from the bottom.
    // Since dragRef.current is null, this move doesn't update the drag,
    // but it still renders the shadow. The shadow opacity is based on solidRef.
    const tile = document.querySelector("[data-shadow]");
    if (tile) {
      expect(tile.getAttribute("data-solid")).toBe("false");
    }

    // A pointerUp also must not commit anything.
    fireEvent.pointerUp(months, { pointerId: 1 });
    expect(applyRangeMock).not.toHaveBeenCalled();
    expect(openNoteMock).not.toHaveBeenCalled();
  });
});
