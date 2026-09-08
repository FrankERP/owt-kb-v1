import { describe, expect, it } from "vitest";
import {
  bothPriorMonthLeadVisibilities,
  priorCalendarMonth,
  priorMonthLeadVisibility,
} from "../leadPoolHistory";
import type { SolverConfig } from "../plannerModel";

// Tipo is load-bearing now: this panel filters the stored pool ticks by live
// eligibility, the same rule `buildSolveRequest` applies (ADR-0029). A fixture
// without it would be a member nobody can schedule.
const members = [
  { _id: "frank", member_name: "Frank", alias: "Frank", memberType: ["voz", "sunday_lead", "saturday_lead"] },
  { _id: "gaby", member_name: "Gaby", memberType: ["voz", "sunday_lead"] },
  { _id: "liu", member_name: "Liu", memberType: ["voz", "saturday_lead"] },
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

  // The stored pools are ticks made in the past. `buildSolveRequest` drops the
  // ones live Tipo no longer supports and `poolTipoMismatch` surfaces them for
  // removal (ADR-0029); this read did neither, so it could present someone who
  // can no longer be assigned at all as an available lead — the opposite of
  // what the panel is for.
  it("drops a ticked member whose Tipo no longer supports the pool", () => {
    const config: SolverConfig = { ...emptyConfig(), sundayLeads: ["frank", "gaby"] };
    const cleared = members.map((m) => (m._id === "gaby" ? { ...m, memberType: [] } : m));

    const info = priorMonthLeadVisibility({
      config, members: cleared, history: [], year: 2026, month: 2, role: "Sun.Lead",
    });
    expect(info.names).toEqual(["Frank"]);
  });

  it("keeps a Saturday lead whose Sunday tick went stale, rather than losing them to both columns", () => {
    // The Saturday branch dedupes against the Sunday pool. Deduping against the
    // RAW ticks dropped this member from Sunday for Tipo and from Saturday for
    // the tick — absent from both, while the solver had them in its Saturday
    // pool. `buildSolveRequest` dedupes against the filtered pool; so does this.
    const config: SolverConfig = {
      ...emptyConfig(),
      sundayLeads: ["frank", "liu"],   // liu's Sunday tick is stale
      saturdayLeads: ["frank", "liu"], // liu IS a valid Saturday lead
    };

    const sat = priorMonthLeadVisibility({
      config, members, history: [], year: 2026, month: 2, role: "Sat.Lead",
    });
    expect(sat.names).toContain("Liu");

    const sun = priorMonthLeadVisibility({
      config, members, history: [], year: 2026, month: 2, role: "Sun.Lead",
    });
    expect(sun.names).not.toContain("Liu");
  });

  it("drops one who kept `voz` but lost the pool's subtype", () => {
    // Narrower than an empty Tipo, and the case a coarse "has any Tipo" check
    // would wave through: still a singer, no longer a Sunday lead.
    const config: SolverConfig = { ...emptyConfig(), sundayLeads: ["frank", "gaby"] };
    const demoted = members.map((m) => (m._id === "gaby" ? { ...m, memberType: ["voz"] } : m));

    const info = priorMonthLeadVisibility({
      config, members: demoted, history: [], year: 2026, month: 2, role: "Sun.Lead",
    });
    expect(info.names).toEqual(["Frank"]);
  });
});
