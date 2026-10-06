// Solver v3 C3 §6.2 — the config version tripwire (T7).
//
// `POST /api/admin/solver-config` replaces the WHOLE document, and the reader
// keeps only the fields it knows. So a tab whose bundle predates a field — or an
// allowed VALUE — reads it away and its next «Guardar reglas» erases it for
// everyone. The route refuses any body whose `configVersion` is not
// `SOLVER_CONFIG_VERSION`; this file is what makes "bump it when the shape
// changes" a red test instead of a memory.
//
// THE RULE: never edit an existing entry of `SHAPES`. A change that adds a key
// at any level, or an accepted value to an enumerated field, adds a NEW entry
// under the next number and bumps `SOLVER_CONFIG_VERSION` in the same commit.
// Free-text fields (`person`, pattern labels) are read back verbatim by every
// version and are not enumerated.
import { describe, expect, it } from "vitest";

import {
  CAP_OPS,
  FAIRNESS_VALUES,
  SOLVER_CONFIG_VERSION,
  SUNDAY_CADENCE_VALUES,
  parseSolverConfigWrite,
  solverConfigFields,
} from "../solverConfigWriteRequest";
import type { SolverConfig } from "@/app/components/admin/plannerModel";

const SHAPES: Record<number, {
  keys: Record<"document" | "restriction" | "weekExclusion" | "cap" | "conflict" | "presence", string[]>;
  values: Record<"sundayCadence" | "fairness" | "capOp", string[]>;
}> = {
  2: {
    keys: {
      document: ["conflicts", "presence", "restrictions", "saturdayLeads", "sundayLeads", "support"],
      restriction: [
        "_key", "_type", "caps", "excludedPatterns", "fairness", "fairnessSlack", "id", "person",
        "sundayCadence", "weekExclusions",
      ],
      weekExclusion: ["_key", "_type", "id", "pattern", "week"],
      cap: ["_key", "_type", "id", "op", "pattern", "relOffset", "relative", "value"],
      conflict: ["_key", "_type", "id", "pattern", "personA", "personB"],
      presence: ["_key", "_type", "id", "pattern", "persons"],
    },
    values: {
      sundayCadence: ["alternate"],
      fairness: ["exempt", "none", "slack"],
      capOp: ["<=", "==", ">="],
    },
  },
};

/** A config carrying every optional field the type has, so every key is emitted. */
const EVERYTHING: SolverConfig = {
  sundayLeads: ["m-ana"],
  saturdayLeads: ["m-bruno"],
  support: ["m-carla"],
  restrictions: [{
    id: "r-1", person: "Ana", excludedPatterns: ["Sat.*"], fairness: "slack", fairnessSlack: 2,
    weekExclusions: [{ id: "w-1", week: 1, pattern: "*.*" }],
    caps: [{ id: "c-1", pattern: "Sun.BGV", op: "<=", value: 1, relative: true, relOffset: 2 }],
    sundayCadence: "alternate",
  }],
  conflicts: [{ id: "x-1", personA: "Ana", personB: "Bruno", pattern: "*.Lead" }],
  presence: [{ id: "p-1", persons: ["Bruno", "Carla"], pattern: "Sun.BGV" }],
};

const sortedKeys = (o: unknown) => Object.keys(o as Record<string, unknown>).sort();

function liveKeys() {
  const f = solverConfigFields(EVERYTHING);
  const r = (f.restrictions as Record<string, unknown>[])[0];
  return {
    document: sortedKeys(f),
    restriction: sortedKeys(r),
    weekExclusion: sortedKeys((r.weekExclusions as unknown[])[0]),
    cap: sortedKeys((r.caps as unknown[])[0]),
    conflict: sortedKeys((f.conflicts as unknown[])[0]),
    presence: sortedKeys((f.presence as unknown[])[0]),
  };
}

/** What the PARSER accepts, probed — not read off the constants it might bypass. */
function accepted(universe: unknown[], body: (v: unknown) => unknown): string[] {
  return universe.filter((v) => parseSolverConfigWrite(body(v)).ok).map(String).sort();
}
const withRestriction = (patch: Record<string, unknown>) => ({
  restrictions: [{ id: "r-1", person: "Ana", ...patch }],
});

describe("SOLVER_CONFIG_VERSION tripwire (C3 §6.2, T7)", () => {
  it("is the newest pinned shape", () => {
    expect(Math.max(...Object.keys(SHAPES).map(Number))).toBe(SOLVER_CONFIG_VERSION);
    expect(SOLVER_CONFIG_VERSION).toBe(2);
  });

  it("pins the exact key set `solverConfigFields` emits at every level", () => {
    expect(liveKeys()).toEqual(SHAPES[SOLVER_CONFIG_VERSION].keys);
  });

  it("pins the accepted values of every enumerated field — the constants AND the parser", () => {
    const pinned = SHAPES[SOLVER_CONFIG_VERSION].values;
    expect([...SUNDAY_CADENCE_VALUES].sort()).toEqual(pinned.sundayCadence);
    expect([...FAIRNESS_VALUES].sort()).toEqual(pinned.fairness);
    expect([...CAP_OPS].sort()).toEqual(pinned.capOp);

    expect(accepted(
      ["alternate", "normal", "Alternate", "none", "monthly", "every_other", "", null, true, 1],
      (v) => withRestriction({ sundayCadence: v }),
    )).toEqual(pinned.sundayCadence);
    expect(accepted(
      ["none", "exempt", "slack", "Exempt", "always", "median", ""],
      (v) => withRestriction({ fairness: v }),
    )).toEqual(pinned.fairness);
    expect(accepted(
      ["<=", ">=", "==", "!=", "<", ">", "=", "==="],
      (v) => withRestriction({ caps: [{ id: "c-1", pattern: "Sun.BGV", op: v, value: 1 }] }),
    )).toEqual(pinned.capOp);
  });
});
