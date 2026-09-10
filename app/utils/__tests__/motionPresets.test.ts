import { describe, it, expect } from "vitest";
import { SHEET_DISMISS, SPRINGS, VARIANTS, EXIT_MS } from "../motionPresets";

describe("motionPresets", () => {
  it("names the three springs from spec §2.3 with their constants", () => {
    expect(SPRINGS.sheet).toEqual({ type: "spring", stiffness: 380, damping: 36, mass: 0.9 });
    expect(SPRINGS.pop).toEqual({ type: "spring", stiffness: 520, damping: 30 });
    expect(SPRINGS.settle).toEqual({ type: "spring", stiffness: 300, damping: 28 });
  });

  it("has the drop variant used by badge pops (spec: enter fast, exit faster)", () => {
    expect(VARIANTS.drop).toEqual({
      initial: { opacity: 0, y: -8 },
      animate: { opacity: 1, y: 0 },
      exit: { opacity: 0, y: -8 },
    });
  });

  it("every variant animates only opacity and transform-family keys", () => {
    const allowed = new Set(["opacity", "y", "x", "scale"]);
    for (const [name, v] of Object.entries(VARIANTS)) {
      for (const phase of ["initial", "animate", "exit"] as const) {
        for (const key of Object.keys(v[phase])) {
          expect(allowed.has(key), `${name}.${phase}.${key}`).toBe(true);
        }
      }
    }
  });

  it("pins the sheet dismissal thresholds (spec §19.4)", () => {
    // px and px/ms. Both arms are an OR in CueDialog, so loosening either one here
    // would let a stray scroll close a sheet. 150 px is Frank's call from dev on
    // 2026-09-09 ("almost twice" the original 80).
    expect(SHEET_DISMISS).toEqual({ distance: 150, velocity: 0.5 });
  });

  it("exits are faster than enters (spec: enter fast, exit faster)", () => {
    expect(EXIT_MS).toBeLessThan(200);
  });

  it("is a neutral module — no motion import, so server modules may read it", () => {
    // ADR-0028: a server component may read constants from here. Guarded by the
    // presence of `type: "spring"` string literals rather than a motion type import.
    expect(SPRINGS.sheet.type).toBe("spring");
  });
});
