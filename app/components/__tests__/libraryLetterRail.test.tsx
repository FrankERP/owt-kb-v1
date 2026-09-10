/** @vitest-environment jsdom */
// The /biblioteca letter rail (F3): an index BAR — it shows which section is in
// view and it scrubs. The IntersectionObserver that feeds `active` lives in
// `LibraryIndex`; this file owns the rail's own two contracts.
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import LibraryLetterRail from "../LibraryLetterRail";

afterEach(cleanup);

const LETTERS = ["A", "B", "C", "D"];
const STEP = 16; // px per letter, the geometry the mock below pins

/** The rail's box, which jsdom never lays out: top 0, one 16 px band per letter. */
function mountRail(active = "", onJump = vi.fn()) {
  render(<LibraryLetterRail letters={LETTERS} active={active} onJump={onJump} />);
  const rail = screen.getByRole("navigation", { name: "Índice alfabético" });
  vi.spyOn(rail, "getBoundingClientRect").mockReturnValue({
    top: 0,
    bottom: LETTERS.length * STEP,
    height: LETTERS.length * STEP,
    left: 0,
    right: 12,
    width: 12,
    x: 0,
    y: 0,
    toJSON: () => ({}),
  });
  return { rail, onJump };
}

describe("LibraryLetterRail", () => {
  it("renders one labelled button per letter", () => {
    mountRail();
    expect(LETTERS.map((l) => screen.getByRole("button", { name: `Ir a la letra ${l}` }).textContent)).toEqual(LETTERS);
  });

  it("the active letter is the one carrying aria-current — the progress the rail exists to show", () => {
    mountRail("C");
    expect(screen.getByRole("button", { name: "Ir a la letra C" }).getAttribute("aria-current")).toBe("true");
    expect(screen.getByRole("button", { name: "Ir a la letra A" }).getAttribute("aria-current")).toBeNull();
  });

  it("a drag from the rail's top to its bottom jumps to the first letter, then the last", () => {
    const { rail, onJump } = mountRail();
    fireEvent.pointerDown(rail, { pointerId: 1, clientY: 2 });
    fireEvent.pointerMove(rail, { pointerId: 1, clientY: LETTERS.length * STEP - 2 });
    fireEvent.pointerUp(rail, { pointerId: 1 });

    expect(onJump.mock.calls.map((c) => c[0])).toEqual(["A", "D"]);
    // The tap that opens a scrub animates; everything after it is instant, so
    // the list tracks the finger rather than chasing it.
    expect(onJump.mock.calls.map((c) => c[1])).toEqual(["smooth", "auto"]);
  });

  it("dragging within one letter's band does not re-fire, and a finger past the end clamps", () => {
    const { rail, onJump } = mountRail();
    fireEvent.pointerDown(rail, { pointerId: 1, clientY: 2 });
    fireEvent.pointerMove(rail, { pointerId: 1, clientY: 6 });
    fireEvent.pointerMove(rail, { pointerId: 1, clientY: 9999 });
    fireEvent.pointerMove(rail, { pointerId: 1, clientY: -9999 });
    expect(onJump.mock.calls.map((c) => c[0])).toEqual(["A", "D", "A"]);
  });

  it("a pointer gesture never double-jumps through the click that follows it", () => {
    const { rail, onJump } = mountRail();
    const b = screen.getByRole("button", { name: "Ir a la letra A" });
    fireEvent.pointerDown(rail, { pointerId: 1, clientY: 2 });
    fireEvent.pointerUp(rail, { pointerId: 1 });
    fireEvent.click(b, { detail: 1 });
    expect(onJump).toHaveBeenCalledTimes(1);
  });

  it("a keyboard activation — a click with no pointer behind it — still jumps, smoothly", () => {
    const { onJump } = mountRail();
    fireEvent.click(screen.getByRole("button", { name: "Ir a la letra C" }));
    expect(onJump).toHaveBeenCalledWith("C", "smooth");
  });

  it("marks itself data-scrubbing only while a finger is down — the pill is the grip", () => {
    const { rail } = mountRail();
    expect(rail.hasAttribute("data-scrubbing")).toBe(false);
    fireEvent.pointerDown(rail, { pointerId: 1, clientY: 2 });
    expect(rail.getAttribute("data-scrubbing")).toBe("true");
    fireEvent.pointerUp(rail, { pointerId: 1 });
    expect(rail.hasAttribute("data-scrubbing")).toBe(false);
  });
});
