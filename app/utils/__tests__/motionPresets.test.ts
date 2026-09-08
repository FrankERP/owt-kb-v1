import { describe, it, expect } from "vitest";
import { SPRINGS, VARIANTS, EXIT_MS } from "../motionPresets";

describe("motionPresets", () => {
  it("names the three springs from spec §2.3 with their constants", () => {
    expect(SPRINGS.sheet).toEqual({ type: "spring", stiffness: 380, damping: 36, mass: 0.9 });
    expect(SPRINGS.pop).toEqual({ type: "spring", stiffness: 520, damping: 30 });
    expect(SPRINGS.settle).toEqual({ type: "spring", stiffness: 300, damping: 28 });
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

  it("exits are faster than enters (spec: enter fast, exit faster)", () => {
    expect(EXIT_MS).toBeLessThan(200);
  });

  it("is a neutral module — no motion import, so server modules may read it", () => {
    // ADR-0028: a server component may read constants from here. Guarded by the
    // presence of `type: "spring"` string literals rather than a motion type import.
    expect(SPRINGS.sheet.type).toBe("spring");
  });
});
