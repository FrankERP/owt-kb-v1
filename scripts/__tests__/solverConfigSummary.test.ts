// The seed script's dry-run summary and REFUSING diff (solver v3 C3 §6.9, T12).
//
// Two properties. «Mes por medio» is visible, so a difference in cadence shows up
// in the output a human reviews. And the output names no rule by its raw key
// and no person by name (parent A41): seed-era ids embed first names, and script
// stdout is an output that can leave a private file. Rules are identified by
// kind and 1-based ordinal — the order the rule panel lists them in.
import { describe, expect, it } from "vitest";

import { solverConfigSummaryLines } from "../lib/solverConfigSummary";
import type { SolverConfig } from "@/app/components/admin/plannerModel";

// Name-shaped keys on purpose: production's seed-era ids look like this.
const CONFIG: SolverConfig = {
  sundayLeads: ["m-ana"],
  saturdayLeads: ["m-bruno", "m-carla"],
  support: [],
  restrictions: [
    {
      id: "d-ana", person: "Ana", excludedPatterns: ["Sat.*"], fairness: "exempt", fairnessSlack: 1,
      weekExclusions: [{ id: "d-ana-w", week: 2, pattern: "*.*" }],
      caps: [{ id: "d-ana-c", pattern: "Sun.Lead", op: "<=", value: 0, relative: true, relOffset: 2 }],
      sundayCadence: "alternate",
    },
    { id: "d-bruno", person: "Bruno", excludedPatterns: [], fairness: "none", fairnessSlack: 1, weekExclusions: [], caps: [] },
  ],
  conflicts: [{ id: "d-ana-bruno", personA: "Ana", personB: "Bruno", pattern: "*.Lead" }],
  presence: [{ id: "d-bruno-carla", persons: ["Bruno", "Carla"], pattern: "Sun.BGV" }],
};

describe("solverConfigSummaryLines (C3 T12)", () => {
  it("prints every rule by kind and ordinal, with «Mes por medio» where it is set", () => {
    expect(solverConfigSummaryLines("Would create:", CONFIG)).toEqual([
      "Would create:",
      "  pools: 1 dom · 2 sáb · 0 apoyo",
      "  restricción 1 · !in Sat.* · !in week 2 *.* · Sun.Lead <= 0 (rel 2) · fairness:exempt · Mes por medio",
      "  restricción 2 · (sin cláusulas)",
      "  conflicto 1 · !with on *.Lead",
      "  presencia 1 · any_of(2 personas) on Sun.BGV",
    ]);
  });

  it("never prints a raw key or a person's name (parent A41)", () => {
    const text = solverConfigSummaryLines("x", CONFIG).join("\n");
    for (const secret of ["d-ana", "d-bruno", "Ana", "Bruno", "Carla", "m-ana"]) {
      expect(text, secret).not.toContain(secret);
    }
  });
});
