/** @vitest-environment jsdom */
//
// Where the note popover sits, and that it stays with its day.
//
// The bug: the popover is `position: fixed` at coordinates captured on click,
// with no listener for anything afterwards. Scroll, and it floats over an
// unrelated part of the page while still bound to the original date — so the
// member types a reason for the wrong day. On a phone that is the common path:
// the on-screen keyboard scrolls the page as they reach for the note field.
//
// The tempting one-line fix — close on scroll — is worse, and the last test
// here exists to stop it being reintroduced. That same keyboard fires scroll
// and resize, so the popover would disappear at the moment it opened.
//
// jsdom performs no layout, so every `getBoundingClientRect` is zero. The
// placement itself is therefore tested through the pure function, which takes
// the rect as an argument for exactly this reason.

import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { installMotionTestEnv } from "../ui/__tests__/motionTestSetup";
import { MotionProvider } from "../ui/MotionProvider";
import MyAvailabilityPanel from "../availability/MyAvailabilityPanel";
import NotePopover, { popoverPosition } from "../availability/NotePopover";

// R3: the popover lives in `availability/NotePopover` and the panel owns the one
// instance (it was shared by two surfaces then; F3 left only the grid). The
// behaviour below is unchanged — it is still opened from a day cell, and the grid
// is mounted open now, so there is no disclosure to click through first.
vi.mock("@/app/components/ui/Toast", () => ({
  useToast: () => ({ toast: vi.fn(), dismiss: vi.fn() }),
}));
vi.mock("@/app/utils/haptics", () => ({ haptic: vi.fn() }));

installMotionTestEnv();
// Warm the LazyMotion feature chunk (ADR-0031), precedent Menu.test.tsx.
beforeAll(async () => { await import("../ui/motionFeatures"); });

const VIEWPORT_W = 390; // iPhone-ish
const VIEWPORT_H = 844;

describe("popoverPosition", () => {
  it("sits just below a day with room under it", () => {
    const { y, above } = popoverPosition({ top: 200, bottom: 244, left: 40 }, VIEWPORT_W, VIEWPORT_H);
    expect(above).toBe(false);
    expect(y).toBe(250); // bottom + 6
  });

  it("flips above a day near the bottom, where it would otherwise be off-screen", () => {
    const { y, above } = popoverPosition({ top: 800, bottom: 844, left: 40 }, VIEWPORT_W, VIEWPORT_H);
    expect(above).toBe(true);
    expect(y).toBe(800 - 160 - 6);
  });

  it("keeps the popover on screen at both edges", () => {
    // Far right: clamped to the viewport width less the popover width.
    expect(popoverPosition({ top: 0, bottom: 44, left: 380 }, VIEWPORT_W, VIEWPORT_H).x).toBe(390 - 272);
    // Viewport narrower than the popover: the right clamp alone would go
    // negative and push it off the LEFT edge instead.
    expect(popoverPosition({ top: 0, bottom: 44, left: 10 }, 240, VIEWPORT_H).x).toBe(8);
  });

  it("never goes off the TOP when it flips above a day in a short viewport", () => {
    // A phone with the keyboard up: there is no room below, so it flips above —
    // and 160px above a day in the first row is a negative offset.
    const { y, above } = popoverPosition({ top: 40, bottom: 84, left: 40 }, VIEWPORT_W, 200);
    expect(above).toBe(true);
    expect(y).toBe(8);
  });

  it("tracks its day: the same cell after a scroll gives a new position", () => {
    const atRest = popoverPosition({ top: 400, bottom: 444, left: 40 }, VIEWPORT_W, VIEWPORT_H);
    const scrolledUp = popoverPosition({ top: 100, bottom: 144, left: 40 }, VIEWPORT_W, VIEWPORT_H);
    expect(scrolledUp.y).not.toBe(atRest.y);
  });
});

describe("MyAvailabilityPanel — the popover survives a scroll", () => {
  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    vi.setSystemTime(new Date("2026-09-15T12:00:00-06:00"));
    vi.stubGlobal("fetch", vi.fn());
  });
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  function openNoteOn(month: string, day: number) {
    render(
      <MotionProvider>
        <MyAvailabilityPanel initialRev="rev-1" initialDates={[]} initialNotes={[]} />
      </MotionProvider>,
    );
    const card = screen.getByText(month).closest("div")!;
    const cell = Array.from(card.querySelectorAll("button")).find(
      (b) => b.textContent?.trim() === String(day),
    );
    fireEvent.click(cell!);
  }

  const noteField = () => screen.queryByPlaceholderText(/razón/i);

  it("stays open — and keeps a half-typed reason — when the page scrolls", () => {
    openNoteOn("Octubre 2026", 4);
    expect(noteField()).not.toBeNull();

    fireEvent.change(noteField()!, { target: { value: "Viaje" } });
    act(() => {
      window.dispatchEvent(new Event("scroll"));
      window.dispatchEvent(new Event("resize"));
    });

    expect(noteField()).not.toBeNull();
    expect((noteField() as HTMLInputElement).value).toBe("Viaje");
  });
});

describe("NotePopover — a range popover edits every day at once", () => {
  afterEach(cleanup);

  function renderRange() {
    const setNote = vi.fn();
    const remove = vi.fn();
    const setPopover = vi.fn();
    render(
      <NotePopover
        popover={{ iso: "2026-09-12", isos: ["2026-09-12", "2026-09-13", "2026-09-14"], x: 0, y: 0, above: false }}
        setPopover={setPopover}
        anchorRef={{ current: null }}
        notes={new Map()}
        setNote={setNote}
        remove={remove}
      />,
    );
    return { setNote, remove, setPopover };
  }

  it("titles the popover with the range label", () => {
    renderRange();
    expect(screen.getByText("del 12 al 14 de septiembre")).not.toBeNull();
  });

  it("writes the same note to every day in the range", () => {
    const { setNote } = renderRange();
    fireEvent.change(screen.getByPlaceholderText(/razón/i), { target: { value: "viaje" } });
    expect(setNote).toHaveBeenCalledTimes(3);
    expect(setNote).toHaveBeenCalledWith("2026-09-12", "viaje");
    expect(setNote).toHaveBeenCalledWith("2026-09-13", "viaje");
    expect(setNote).toHaveBeenCalledWith("2026-09-14", "viaje");
  });

  it("removes every day in the range and closes", () => {
    const { remove, setPopover } = renderRange();
    fireEvent.click(screen.getByText("Quitar estas fechas"));
    expect(remove).toHaveBeenCalledTimes(3);
    expect(remove).toHaveBeenCalledWith("2026-09-12");
    expect(remove).toHaveBeenCalledWith("2026-09-13");
    expect(remove).toHaveBeenCalledWith("2026-09-14");
    expect(setPopover).toHaveBeenCalledWith(null);
  });
});
