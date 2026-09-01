import { describe, expect, it } from "vitest";
import {
  bothPriorMonthLeadVisibilities,
  priorCalendarMonth,
  priorMonthLeadVisibility,
} from "../leadPoolHistory";
import type { SolverConfig } from "../plannerModel";

const members = [
  { _id: "frank", member_name: "Frank", alias: "Frank" },
  { _id: "gaby", member_name: "Gaby" },
  { _id: "liu", member_name: "Liu" },
];

const emptyConfig = (): SolverConfig => ({
  sundayLeads: [],
  saturdayLeads: [],
  support: [],
  restrictions: [],
  conflicts: [],
  presence: [],
});

describe("priorCalendarMonth", () => {
  it("steps back one calendar month", () => {
    expect(priorCalendarMonth(2026, 2)).toEqual({ year: 2026, month: 1, key: "2026-1" });
    expect(priorCalendarMonth(2026, 1)).toEqual({ year: 2025, month: 12, key: "2025-12" });
  });
});

describe("priorMonthLeadVisibility", () => {
  it("lists Sunday pool members with zero Sun.Lead in the prior month entry", () => {
    const config: SolverConfig = {
      ...emptyConfig(),
      sundayLeads: ["frank", "gaby"],
    };
    const history = [
      {
        key: "2026-1",
        year: 2026,
        month: 1,
        total_counts: { Frank: 2, Gaby: 2 },
        role_counts: {
          Frank: { "Sun.Lead": 2 },
          Gaby: { "Sun.Lead": 0, "Sun.BGV": 2 },
        },
      },
    ];
    const info = priorMonthLeadVisibility({
      config,
      members,
      history,
      year: 2026,
      month: 2,
      role: "Sun.Lead",
    });
    expect(info.names).toEqual(["Gaby"]);
    expect(info.hasPriorMonthEntry).toBe(true);
  });

  it("excludes Saturday-only leads from the Sunday panel", () => {
    const config: SolverConfig = {
      ...emptyConfig(),
      sundayLeads: ["frank"],
      saturdayLeads: ["liu"],
    };
    const { sunday, saturday } = bothPriorMonthLeadVisibilities({
      config,
      members,
      history: [],
      year: 2026,
      month: 3,
    });
    expect(sunday.names).toEqual(["Frank"]);
    expect(saturday.names).toEqual(["Liu"]);
  });

  it("skips members excluded from lead by a standing restriction", () => {
    const config: SolverConfig = {
      ...emptyConfig(),
      sundayLeads: ["frank", "gaby"],
      restrictions: [
        {
          id: "r1",
          person: "gaby",
          excludedPatterns: ["Sun.Lead"],
          fairness: "none",
          fairnessSlack: 0,
          weekExclusions: [],
          caps: [],
        },
      ],
    };
    const info = priorMonthLeadVisibility({
      config,
      members,
      history: [],
      year: 2026,
      month: 2,
      role: "Sun.Lead",
    });
    expect(info.names).toEqual(["Frank"]);
  });
});
