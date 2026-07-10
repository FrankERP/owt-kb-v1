import { describe, it, expect } from "vitest";
import { trapTabTarget } from "../focusTrap";

describe("trapTabTarget", () => {
  it("wraps Tab from the last item to the first", () => {
    expect(trapTabTarget(3, 2, false)).toBe(0);
  });

  it("wraps Shift+Tab from the first item to the last", () => {
    expect(trapTabTarget(3, 0, true)).toBe(2);
  });

  it("lets the browser handle Tab in the middle", () => {
    expect(trapTabTarget(3, 1, false)).toBeNull();
    expect(trapTabTarget(3, 1, true)).toBeNull();
  });

  it("does not wrap Tab when not on the last item", () => {
    expect(trapTabTarget(3, 0, false)).toBeNull();
  });

  it("keeps focus on the sole item when there is only one", () => {
    expect(trapTabTarget(1, 0, false)).toBe(0);
    expect(trapTabTarget(1, 0, true)).toBe(0);
  });

  it("returns null when there are no focusable items", () => {
    expect(trapTabTarget(0, -1, false)).toBeNull();
  });

  it("treats a not-found active element (index -1) as before the first", () => {
    // activeIndex -1 with Shift wraps to last; with Tab it is not the last, so null
    expect(trapTabTarget(3, -1, true)).toBe(2);
    expect(trapTabTarget(3, -1, false)).toBeNull();
  });
});
