// Pins the solver-engine constant's shipped value and its annotation (solver v3
// C1-R11, parent A1). C7 flipped the value to "v3" at cutover and changed THIS
// assertion in the same change; a flip back to "v2" changes it again (ADR-0054).
// C2 and C6 may add exports beside the constant: nothing here asserts about other
// exports.
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import { SOLVER_ENGINE } from "../solverEngine";

const SRC = readFileSync(
  path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "solverEngine.ts"),
  "utf8",
);

describe("SOLVER_ENGINE", () => {
  it('ships "v3" — the cutover flipped this constant, and this assertion, in the same change', () => {
    expect(SOLVER_ENGINE).toBe("v3");
  });

  it('is annotated with the whole "v2" | "v3" union, so a consumer\'s "v2" branch type-checks', () => {
    expect(SRC).toMatch(/export const SOLVER_ENGINE: "v2" \| "v3" = "v3";/);
  });

  it('is neutral: no "use client" directive and no imports (ADR-0028)', () => {
    expect(SRC).not.toMatch(/^\s*["']use client["']/m);
    expect(SRC).not.toMatch(/^\s*import\s/m);
  });
});
