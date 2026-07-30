// app/components/admin/__tests__/plannerModel.test.ts
//
// Every test here exists because a specific, verified failure was found in
// nine rounds of adversarial review of the plan this implements
// (docs/superpowers/plans/2026-07-29-planner-grid.md). They are the point of
// this file, not decoration — see the file header comment in `plannerModel.ts`
// for the six load-bearing facts they pin.
import { describe, expect, it } from "vitest";

import type { SolveResponse } from "@/app/api/admin/solve/route";
import { computeParticipation } from "@/app/utils/computeParticipation";
import type { RankMember } from "../candidateRanking";
import {
  applySolveResponse,
  buildColumns,
  buildRows,
  buildSolveRequest,
  cellsToDrafts,
  cellsToParticipantRoles,
  historyEntryFromDrafts,
  historyForRequest,
  isSolvable,
  rowAppliesTo,
  mapUnfilledSeats,
  saturdayForWeek,
  seatDefForRow,
  solvableWindow,
  unaddressableDates,
  weekendWeekIndexes,
  type DraftCard,
  type GridCell,
  type GridColumn,
  type SolverConfig,
  type SolverHistoryEntry,
} from "../plannerModel";

// ─── Fixtures ─────────────────────────────────────────────────────────────────

// February 2026: Sundays 1/8/15/22, Saturdays 7/14/21/28 (all verified, not
// guessed — Feb 28 is a Saturday with NO Sunday of its own in-month).
const FEB_SUNDAYS = ["2026-02-01", "2026-02-08", "2026-02-15", "2026-02-22"];
const FEB_SATURDAYS = ["2026-02-07", "2026-02-14", "2026-02-21", "2026-02-28"];

// October 2026: Sundays 4/11/18/25. Oct 31 is a Saturday with no Sunday of its
// own in October (the following Sunday, Nov 1, is out of month) — D16's fixture.
const OCT_SUNDAYS = ["2026-10-04", "2026-10-11", "2026-10-18", "2026-10-25"];

const m = (id: string, name: string): RankMember => ({ _id: id, member_name: name });

const emptyConfig: SolverConfig = {
  sundayLeads: [],
  saturdayLeads: [],
  support: [],
  restrictions: [],
  conflicts: [],
  presence: [],
};

// ─── Shape ────────────────────────────────────────────────────────────────────

describe("Saturday has no Coro", () => {
  // The domain rule, confirmed by the team and matched by the data: 0 of 8
  // stored saturday_role documents carry a Chorus, against 19 of 19 Sundays.
  const coro = buildRows({ instrumentSeats: [], fohSeats: [] }).find((r) => r.id === "coro")!;
  const sunday: GridColumn = { date: "2026-08-09", type: "sunday_role" };
  const saturday: GridColumn = { date: "2026-08-08", type: "saturday_role" };

  it("does not apply the Coro row to a Saturday column", () => {
    expect(rowAppliesTo(coro, sunday)).toBe(true);
    expect(rowAppliesTo(coro, saturday)).toBe(false);
    expect(isSolvable(coro, saturday)).toBe(false);
  });

  it("writes an empty chorus for a Saturday even if a stray cell holds one", () => {
    // Belt and braces: a cell could survive a column-type change, so the write
    // is forced empty rather than trusting the grid to be clean.
    const cells: GridCell[] = [
      { date: "2026-08-08", rowId: "coro", memberIds: ["m1", "m2"], origin: "manual" },
      { date: "2026-08-08", rowId: "lead", memberIds: ["m3"], origin: "manual" },
    ];
    const drafts = cellsToDrafts(cells, [saturday], new Set(), [], []);
    expect(drafts).toHaveLength(1);
    expect(drafts[0].chorus).toEqual([]);
    expect(drafts[0].leads).toEqual(["m3"]);
  });

  it("still writes a Sunday chorus", () => {
    const cells: GridCell[] = [
      { date: "2026-08-09", rowId: "coro", memberIds: ["m1", "m2"], origin: "manual" },
    ];
    const drafts = cellsToDrafts(cells, [sunday], new Set(), [], []);
    expect(drafts[0].chorus).toEqual(["m1", "m2"]);
  });
});

describe("buildRows", () => {
  it("targets 2/3/3 for Lead/BGV/Coro and 1 for every instrument/FOH row", () => {
    const rows = buildRows();
    const byId = Object.fromEntries(rows.map((r) => [r.id, r]));
    expect(byId["lead"].target).toBe(2);
    expect(byId["bgv"].target).toBe(3);
    expect(byId["coro"].target).toBe(3);
    for (const r of rows) {
      if (r.category !== "voz") expect(r.target).toBe(1);
    }
  });

  it("seeds 3 voice + 5 instrument + 1 FOH = 9 rows from the defaults", () => {
    expect(buildRows()).toHaveLength(9);
  });

  it("a Coro row is present on Saturday columns, not omitted", () => {
    const rows = buildRows();
    const coro = rows.find((r) => r.id === "coro")!;
    expect(coro).toBeDefined();
    const satCol: GridColumn = { date: "2026-02-07", type: "saturday_role" };
    expect(isSolvable(coro, satCol)).toBe(false); // present, but non-solvable
  });
});

describe("isSolvable", () => {
  const rows = buildRows();
  const byId = Object.fromEntries(rows.map((r) => [r.id, r]));
  const sunCol: GridColumn = { date: "2026-02-01", type: "sunday_role" };
  const satCol: GridColumn = { date: "2026-02-07", type: "saturday_role" };

  it("Lead and BGV are solvable on both column types", () => {
    expect(isSolvable(byId["lead"], sunCol)).toBe(true);
    expect(isSolvable(byId["lead"], satCol)).toBe(true);
    expect(isSolvable(byId["bgv"], sunCol)).toBe(true);
    expect(isSolvable(byId["bgv"], satCol)).toBe(true);
  });

  it("Coro is solvable on Sunday columns, not Saturday (no Sat.Choir, D11)", () => {
    expect(isSolvable(byId["coro"], sunCol)).toBe(true);
    expect(isSolvable(byId["coro"], satCol)).toBe(false);
  });

  it("every instrument and FOH row is non-solvable on both column types", () => {
    for (const r of rows) {
      if (r.category === "voz") continue;
      expect(isSolvable(r, sunCol)).toBe(false);
      expect(isSolvable(r, satCol)).toBe(false);
    }
  });
});

describe("seatDefForRow", () => {
  it("maps every row back to a SeatDef carrying the matching memberType", () => {
    const rows = buildRows();
    for (const row of rows) {
      const def = seatDefForRow(row);
      expect(def.category).toBe(row.category);
    }
  });
});

describe("cellsToDrafts — round-trip", () => {
  it("round-trips a Sunday with 2 Leads, 3 BGVs and 3 Coro through the five seat arrays unchanged", () => {
    const date = "2026-02-01";
    const cells: GridCell[] = [
      { date, rowId: "lead", memberIds: ["m1", "m2"], origin: "manual" },
      { date, rowId: "bgv", memberIds: ["m3", "m4", "m5"], origin: "manual" },
      { date, rowId: "coro", memberIds: ["m6", "m7", "m8"], origin: "manual" },
      { date, rowId: "instrumento:Drums", memberIds: ["m9", "m10"], origin: "manual" },
      { date, rowId: "foh:Console", memberIds: ["m11"], origin: "manual" },
    ];
    const columns: GridColumn[] = [{ date, type: "sunday_role" }];
    const [draft] = cellsToDrafts(cells, columns, new Set(), [], []);
    expect(draft.leads).toEqual(["m1", "m2"]);
    expect(draft.bgvs).toEqual(["m3", "m4", "m5"]);
    expect(draft.chorus).toEqual(["m6", "m7", "m8"]);
    expect(draft.instruments.map((s) => s.personId).sort()).toEqual(["m10", "m9"]);
    expect(draft.instruments.every((s) => s.instrument === "Drums")).toBe(true);
    expect(draft.foh).toEqual([{ id: expect.any(String), role: "Console", personId: "m11" }]);
  });

  it("round-trips ONE Drums row holding TWO members into TWO instruments[] slots, both instrument: Drums", () => {
    const date = "2026-02-01";
    const cells: GridCell[] = [{ date, rowId: "instrumento:Drums", memberIds: ["benji", "other"], origin: "manual" }];
    const columns: GridColumn[] = [{ date, type: "sunday_role" }];
    const [draft] = cellsToDrafts(cells, columns, new Set(), [], []);
    expect(draft.instruments).toHaveLength(2);
    expect(draft.instruments.every((s) => s.instrument === "Drums")).toBe(true);
    expect(draft.instruments.map((s) => s.personId).sort()).toEqual(["benji", "other"]);
  });
});

// ─── Column set — D9's safety property ───────────────────────────────────────

describe("the column set (D9)", () => {
  it("an all-empty grid over 9 columns yields 9 drafts, each with empty seat arrays", () => {
    // 5 Sundays + 4 Saturdays = 9 columns (August 2026's real shape).
    const sundayDates = ["2026-08-02", "2026-08-09", "2026-08-16", "2026-08-23", "2026-08-30"];
    const activeSatDates = ["2026-08-01", "2026-08-08", "2026-08-15", "2026-08-22"];
    const columns = buildColumns({ sundayDates, activeSatDates });
    expect(columns).toHaveLength(9);
    const drafts = cellsToDrafts([], columns, new Set(), [], []);
    expect(drafts).toHaveLength(9);
    for (const d of drafts) {
      expect(d.leads).toEqual([]);
      expect(d.bgvs).toEqual([]);
      expect(d.chorus).toEqual([]);
      expect(d.instruments).toEqual([]);
      expect(d.foh).toEqual([]);
    }
  });

  it("a skipped column yields a draft with skipped: true and is excluded by the create filter", () => {
    const columns: GridColumn[] = [
      { date: "2026-02-01", type: "sunday_role" },
      { date: "2026-02-08", type: "sunday_role" },
    ];
    const skippedDates = new Set(["2026-02-01"]);
    const drafts = cellsToDrafts([], columns, skippedDates, [], []);
    const skippedDraft = drafts.find((d) => d.date === "2026-02-01")!;
    const keptDraft = drafts.find((d) => d.date === "2026-02-08")!;
    expect(skippedDraft.skipped).toBe(true);
    expect(keptDraft.skipped).toBe(false);
    // `handleConfirm` filters on `!d.skipped` — this is the authority.
    const toCreate = drafts.filter((d) => !d.skipped);
    expect(toCreate.map((d) => d.date)).toEqual(["2026-02-08"]);
  });

  it("buildColumns({ includeSundays: false }) yields Saturday columns only", () => {
    const columns = buildColumns({ sundayDates: FEB_SUNDAYS, activeSatDates: FEB_SATURDAYS, includeSundays: false });
    expect(columns.every((c) => c.type === "saturday_role")).toBe(true);
    expect(columns.map((c) => c.date).sort()).toEqual([...FEB_SATURDAYS].sort());
  });

  it("cellsToDrafts with Sundays excluded yields ZERO sunday_role drafts, even though sundayDates is fully populated for the solve", () => {
    const columns = buildColumns({ sundayDates: FEB_SUNDAYS, activeSatDates: FEB_SATURDAYS, includeSundays: false });
    const drafts = cellsToDrafts([], columns, new Set(), [], []);
    expect(drafts.filter((d) => d._type === "sunday_role")).toHaveLength(0);
    expect(drafts.filter((d) => d._type === "saturday_role")).toHaveLength(FEB_SATURDAYS.length);
  });
});

// ─── Saturday mapping — adjacency, not position (fact 10) ────────────────────

describe("Saturday↔week mapping", () => {
  it("February 2026, all Saturdays selected: weekendWeekIndexes -> [2,3,4], saturdayForWeek(2) -> 2026-02-07, unaddressableDates -> [2026-02-28]", () => {
    expect(weekendWeekIndexes(FEB_SUNDAYS, FEB_SATURDAYS)).toEqual([2, 3, 4]);
    expect(saturdayForWeek(2, FEB_SUNDAYS)).toBe("2026-02-07"); // NOT 2026-02-14 (positional)
    expect(unaddressableDates(FEB_SUNDAYS, FEB_SATURDAYS)).toEqual(["2026-02-28"]);
  });

  it("activeSatDates supplied out of order gives the same result as sorted input", () => {
    const shuffled = [FEB_SATURDAYS[2], FEB_SATURDAYS[0], FEB_SATURDAYS[3], FEB_SATURDAYS[1]];
    expect(weekendWeekIndexes(FEB_SUNDAYS, shuffled)).toEqual(weekendWeekIndexes(FEB_SUNDAYS, FEB_SATURDAYS));
    expect(unaddressableDates(FEB_SUNDAYS, shuffled)).toEqual(unaddressableDates(FEB_SUNDAYS, FEB_SATURDAYS));
  });

  it("October 2026, only Oct 31 selected: weekendWeekIndexes -> [] (D16 — no positional fallback)", () => {
    expect(weekendWeekIndexes(OCT_SUNDAYS, ["2026-10-31"])).toEqual([]);
    expect(unaddressableDates(OCT_SUNDAYS, ["2026-10-31"])).toEqual(["2026-10-31"]);
  });

  it("the three functions agree: October's deselected-Saturday shape produces no draft", () => {
    const activeSatDates = ["2026-10-31"];
    const weekIdx = weekendWeekIndexes(OCT_SUNDAYS, activeSatDates);
    expect(weekIdx).toEqual([]);
    // Without D16 the fallback would assign week 1, whose Saturday resolves
    // in-month (2026-10-03) — a Saturday the admin never selected.
    const fallbackWeek1Saturday = saturdayForWeek(1, OCT_SUNDAYS);
    expect(fallbackWeek1Saturday).toBe("2026-10-03");
    // The column set (D9) is built from activeSatDates, not from that fallback,
    // so the deselected date never becomes a column and never becomes a draft.
    const columns = buildColumns({ sundayDates: OCT_SUNDAYS, activeSatDates });
    expect(columns.some((c) => c.date === fallbackWeek1Saturday)).toBe(false);
    const drafts = cellsToDrafts([], columns, new Set(), [], []);
    expect(drafts.some((d) => d.date === fallbackWeek1Saturday)).toBe(false);
    expect(drafts.map((d) => d.date)).toContain("2026-10-31");
  });

  it("saturdayForWeek returns null (not a crash) for an out-of-range week number", () => {
    // Unreachable via a real solve today because `weeks === sundayDates.length`,
    // but `mapUnfilledSeats` calls this with a solver-supplied week number —
    // `sundayDates[n-1]` is `undefined` for n=0 or n > sundayDates.length, and
    // `.slice` on `undefined` used to throw.
    expect(saturdayForWeek(0, FEB_SUNDAYS)).toBeNull();
    expect(saturdayForWeek(FEB_SUNDAYS.length + 1, FEB_SUNDAYS)).toBeNull();
  });
});

// ─── solvableWindow — defensive assert (D8) ──────────────────────────────────

describe("solvableWindow", () => {
  it("is solvable for a calendar month's 4 or 5 Sundays", () => {
    expect(solvableWindow(FEB_SUNDAYS).solvable).toBe(true);
    expect(solvableWindow(FEB_SUNDAYS).weeks).toBe(4);
  });

  it("flags an out-of-range window (defensive only — unreachable via a calendar month)", () => {
    expect(solvableWindow(["2026-02-01", "2026-02-08"]).solvable).toBe(false);
  });
});

// ─── Request construction (fact 14) ──────────────────────────────────────────

describe("buildSolveRequest", () => {
  const members: RankMember[] = [
    m("frank", "Frank"),
    m("gaby", "Gaby"),
    m("mkz", "Mkz"),
    m("outsider", "Outsider"),
  ];

  it("injects every DSL-named person absent from all pools into support, and never duplicates a person already IN a pool (exactly one pool each)", () => {
    const config: SolverConfig = {
      ...emptyConfig,
      sundayLeads: ["frank"],
      restrictions: [
        {
          id: "r1", person: "Mkz", excludedPatterns: ["Sat.*"],
          fairness: "none", fairnessSlack: 1, weekExclusions: [], caps: [],
        },
        // Frank is already a sunday_leads pool member — DSL-naming him too
        // must NOT also inject him into support (the other direction of
        // "every DSL-named person appears in exactly one pool").
        {
          id: "r2", person: "Frank", excludedPatterns: ["Sat.*"],
          fairness: "none", fairnessSlack: 1, weekExclusions: [], caps: [],
        },
      ],
    };
    const result = buildSolveRequest({
      config, members, sundayDates: FEB_SUNDAYS, activeSatDates: [],
      historyEntries: [], year: 2026, month: 2,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("unreachable");
    expect(result.request.support).toContain("Mkz");
    expect(result.request.support).not.toContain("Frank");
    expect(result.request.sunday_leads).toEqual(["Frank"]);
  });

  it("a pool member unavailable on a Sunday in the window yields !in week N Sun.*; unavailable on the adjacent Saturday yields Sat.*", () => {
    const config: SolverConfig = {
      ...emptyConfig,
      sundayLeads: ["frank"],
      support: ["gaby"],
    };
    const membersWithAvailability: RankMember[] = [
      { ...m("frank", "Frank"), unavailableDates: ["2026-02-08"] }, // week 2 Sunday
      { ...m("gaby", "Gaby"), unavailableDates: ["2026-02-07"] },   // week 2's Saturday
    ];
    const result = buildSolveRequest({
      config, members: membersWithAvailability, sundayDates: FEB_SUNDAYS, activeSatDates: FEB_SATURDAYS,
      historyEntries: [], year: 2026, month: 2,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("unreachable");
    expect(result.request.dsl_rules).toContain("Frank !in week 2 Sun.*");
    expect(result.request.dsl_rules).toContain("Gaby !in week 2 Sat.*");
  });

  it("a non-pool member's unavailability yields no rule (fact 15 — the rules loop allPoolIds)", () => {
    const config: SolverConfig = { ...emptyConfig, sundayLeads: ["frank"] };
    const membersWithOutsider: RankMember[] = [
      m("frank", "Frank"),
      { ...m("outsider", "Outsider"), unavailableDates: ["2026-02-08"] },
    ];
    const result = buildSolveRequest({
      config, members: membersWithOutsider, sundayDates: FEB_SUNDAYS, activeSatDates: [],
      historyEntries: [], year: 2026, month: 2,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("unreachable");
    expect(result.request.dsl_rules.some((r) => r.startsWith("Outsider"))).toBe(false);
  });

  it("pools are mutually exclusive: a person in both sundayLeads and saturdayLeads appears only under sunday_leads", () => {
    const config: SolverConfig = {
      ...emptyConfig,
      sundayLeads: ["frank"],
      saturdayLeads: ["frank", "gaby"],
    };
    const result = buildSolveRequest({
      config, members, sundayDates: FEB_SUNDAYS, activeSatDates: [],
      historyEntries: [], year: 2026, month: 2,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("unreachable");
    expect(result.request.sunday_leads).toEqual(["Frank"]);
    expect(result.request.saturday_leads).toEqual(["Gaby"]);
  });

  it("refuses with the Spanish reason when no Sunday leads are selected — and returns no request at all", () => {
    const config: SolverConfig = { ...emptyConfig };
    const result = buildSolveRequest({
      config, members, sundayDates: FEB_SUNDAYS, activeSatDates: [],
      historyEntries: [], year: 2026, month: 2,
    });
    expect(result).toEqual({ ok: false, reason: "Debes seleccionar al menos un líder de domingo." });
  });

  it("returns a literal typed SolveRequest carrying weekends_with_saturday verbatim", () => {
    const config: SolverConfig = { ...emptyConfig, sundayLeads: ["frank"] };
    const result = buildSolveRequest({
      config, members, sundayDates: FEB_SUNDAYS, activeSatDates: FEB_SATURDAYS,
      historyEntries: [], year: 2026, month: 2,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("unreachable");
    expect(result.request.weekends_with_saturday).toEqual([2, 3, 4]);
    expect(Object.prototype.hasOwnProperty.call(result.request, "weekends_with_saturday")).toBe(true);
  });

  it("historyForRequest excludes the window's own ${year}-${month} entry, keeping only priors, sorted oldest-first so newest is last (weight 10, fact 9)", () => {
    // Deliberately out of order: 2026-1 (newer) appears BEFORE 2025-12
    // (older) in the input. If historyForRequest merely filtered and sliced
    // without sorting, it would hand this back newest-first — which would
    // hand the solver's heaviest weight to the OLDER entry.
    const entries: SolverHistoryEntry[] = [
      { key: "2026-1", year: 2026, month: 1, total_counts: { a: 1 }, role_counts: {} },
      { key: "2025-12", year: 2025, month: 12, total_counts: { a: 2 }, role_counts: {} },
      { key: "2026-2", year: 2026, month: 2, total_counts: { a: 99 }, role_counts: {} }, // this month's own run
    ];
    expect(historyForRequest(entries, 2026, 2).map((h) => h.key)).toEqual(["2025-12", "2026-1"]);

    const config: SolverConfig = { ...emptyConfig, sundayLeads: ["frank"] };
    const result = buildSolveRequest({
      config, members, sundayDates: FEB_SUNDAYS, activeSatDates: [],
      historyEntries: entries, year: 2026, month: 2,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("unreachable");
    expect(result.request.history).toEqual([
      { total_counts: { a: 2 }, role_counts: {} },
      { total_counts: { a: 1 }, role_counts: {} },
    ]);
  });
});

// ─── Response mapping ─────────────────────────────────────────────────────────

describe("applySolveResponse", () => {
  const rows = buildRows();
  const members: RankMember[] = [m("m1", "Frank"), m("m2", "Gaby"), m("m3", "Liu")];

  function response(over: Partial<SolveResponse> = {}): SolveResponse {
    return { ok: true, ...over };
  }

  it("writes only solvable rows, and only on columns present in the column set", () => {
    const columns: GridColumn[] = [{ date: "2026-02-01", type: "sunday_role" }]; // Saturday column intentionally excluded
    const resp = response({
      schedule: {
        "1": {
          Sunday: { Lead: ["Frank"], BGV: ["Gaby"], Choir: ["Liu"] },
          // Cast to smuggle in a Choir key on Saturday too. NOTE: because the
          // Saturday column itself is excluded from `columns` in this test,
          // this only shows that a column outside the column set is skipped
          // entirely (D9) — it does NOT exercise isSolvable's (row, column)
          // gate, since the Saturday branch never runs at all here. The
          // dedicated "Saturday path" test below is what pins that gate.
          Saturday: { Lead: ["Frank"], BGV: ["Gaby"], Choir: ["Liu"] } as unknown as { Lead: string[]; BGV: string[] },
        },
      },
    });
    const result = applySolveResponse({
      response: resp, previousCells: [], columns, rows,
      sundayDates: FEB_SUNDAYS, activeSatDates: FEB_SATURDAYS, members,
    });
    expect(result.cells.some((c) => c.rowId === "lead" && c.date === "2026-02-07")).toBe(false);
    expect(result.cells.find((c) => c.rowId === "lead" && c.date === "2026-02-01")).toBeTruthy();
  });

  it("every written cell carries origin: auto", () => {
    const columns: GridColumn[] = [{ date: "2026-02-01", type: "sunday_role" }];
    const resp = response({ schedule: { "1": { Sunday: { Lead: ["Frank"], BGV: ["Gaby"], Choir: ["Liu"] } } } });
    const result = applySolveResponse({
      response: resp, previousCells: [], columns, rows,
      sundayDates: FEB_SUNDAYS, activeSatDates: [], members,
    });
    expect(result.cells.every((c) => c.origin === "auto")).toBe(true);
  });

  it("instrument and FOH cells survive byte-for-byte; only voice cells change", () => {
    const date = "2026-02-01";
    const previousCells: GridCell[] = [
      { date, rowId: "instrumento:Drums", memberIds: ["p1", "p2"], origin: "manual" },
      { date, rowId: "foh:Console", memberIds: ["p3"], origin: "manual" },
      { date, rowId: "lead", memberIds: ["stale"], origin: "manual" },
    ];
    const columns: GridColumn[] = [{ date, type: "sunday_role" }];
    const resp = response({ schedule: { "1": { Sunday: { Lead: ["Frank"], BGV: ["Gaby"], Choir: ["Liu"] } } } });
    const result = applySolveResponse({
      response: resp, previousCells, columns, rows,
      sundayDates: FEB_SUNDAYS, activeSatDates: [], members,
    });
    const drums = result.cells.find((c) => c.rowId === "instrumento:Drums")!;
    const console_ = result.cells.find((c) => c.rowId === "foh:Console")!;
    expect(drums).toEqual({ date, rowId: "instrumento:Drums", memberIds: ["p1", "p2"], origin: "manual" });
    expect(console_).toEqual({ date, rowId: "foh:Console", memberIds: ["p3"], origin: "manual" });
    const lead = result.cells.find((c) => c.rowId === "lead")!;
    expect(lead.memberIds).toEqual(["m1"]);
    expect(lead.origin).toBe("auto");
  });

  it("an unmatched name leaves the cell empty and appears in unresolvedNames", () => {
    const columns: GridColumn[] = [{ date: "2026-02-01", type: "sunday_role" }];
    const resp = response({ schedule: { "1": { Sunday: { Lead: ["Nadie Conocido"], BGV: [], Choir: [] } } } });
    const result = applySolveResponse({
      response: resp, previousCells: [], columns, rows,
      sundayDates: FEB_SUNDAYS, activeSatDates: [], members,
    });
    const lead = result.cells.find((c) => c.rowId === "lead")!;
    expect(lead.memberIds).toEqual([]);
    expect(result.unresolvedNames).toContain("Nadie Conocido");
  });

  // `applySolveResponse` used to also carry a `counts` field (D19: total_counts
  // recomputed from role_counts filtered to the created service types) and
  // `handleAuto` persisted THAT to fairness history the instant a solve
  // returned. That was the 2026-07-30 defect: it recorded what the solver
  // PROPOSED, not what got created, so an abandoned Auto run still poisoned
  // next month's solve. `counts` had no other consumer, so it was removed
  // outright rather than left dead — `historyEntryFromDrafts` below replaces
  // it, fed only the drafts a create batch actually committed, and keeps the
  // same "total_counts is the per-person sum of role_counts" rule (D19) that
  // these two tests used to pin here.

  it("Saturday Lead/BGV land on the adjacent column via week-adjacency, and a smuggled Sat.Choir produces no cell (D11's per-cell gate)", () => {
    // 2026-02-07 is week 2's Saturday (adjacent to Sunday 2026-02-08) — see
    // the "Saturday↔week mapping" describe block above. This is the ONLY
    // test in the suite that feeds a saturday_role column together with
    // schedule[N].Saturday data: replacing weekForColumn's Saturday branch
    // with `if (false)` left all other 39 tests green.
    const columns: GridColumn[] = [{ date: "2026-02-07", type: "saturday_role" }];
    const resp = response({
      schedule: {
        "2": {
          // No sunday_role column is in `columns` for this test, so Sunday
          // data is present (required on the wire type) but irrelevant here.
          Sunday: { Lead: [], BGV: [], Choir: [] },
          Saturday: {
            Lead: ["Frank"],
            BGV: ["Gaby"],
            // Cast to smuggle a Choir key into a Saturday payload — the
            // solver never actually sends `Sat.Choir` (fact 2). Unlike the
            // "writes only solvable rows" test above, the Saturday column
            // IS present in `columns` here, so this genuinely exercises
            // isSolvable's (row, column) gate (D11), not mere column-set
            // exclusion.
            Choir: ["Liu"],
          } as unknown as { Lead: string[]; BGV: string[] },
        },
      },
    });
    const result = applySolveResponse({
      response: resp, previousCells: [], columns, rows,
      sundayDates: FEB_SUNDAYS, activeSatDates: FEB_SATURDAYS, members,
    });
    const leadCell = result.cells.find((c) => c.rowId === "lead" && c.date === "2026-02-07");
    const bgvCell = result.cells.find((c) => c.rowId === "bgv" && c.date === "2026-02-07");
    expect(leadCell).toBeTruthy();
    expect(leadCell!.memberIds).toEqual(["m1"]);
    expect(leadCell!.origin).toBe("auto");
    expect(bgvCell).toBeTruthy();
    expect(bgvCell!.memberIds).toEqual(["m2"]);
    expect(bgvCell!.origin).toBe("auto");
    expect(result.cells.some((c) => c.rowId === "coro" && c.date === "2026-02-07")).toBe(false);
  });
});

describe("mapUnfilledSeats", () => {
  it("places a Sunday seat on its row and date", () => {
    const out = mapUnfilledSeats(["W2 Sunday Sun.Choir #2"], FEB_SUNDAYS, FEB_SATURDAYS);
    expect(out).toEqual([{ date: "2026-02-08", rowId: "coro" }]);
  });

  it("places a Saturday seat on its row and adjacent date", () => {
    const out = mapUnfilledSeats(["W2 Saturday Sat.BGV #1"], FEB_SUNDAYS, FEB_SATURDAYS);
    expect(out).toEqual([{ date: "2026-02-07", rowId: "bgv" }]);
  });

  it("drops a Saturday seat whose resolved date is not in the selected column set", () => {
    const out = mapUnfilledSeats(["W2 Saturday Sat.BGV #1"], FEB_SUNDAYS, []); // no Saturdays selected
    expect(out).toEqual([]);
  });
});

// ─── Stability ────────────────────────────────────────────────────────────────

describe("cellsToDrafts — stability", () => {
  const columns: GridColumn[] = [{ date: "2026-02-01", type: "sunday_role" }];

  it("seeds skipped from existingRoles exactly as buildEmptyDrafts does", () => {
    const drafts = cellsToDrafts([], columns, new Set(), [], [{ _type: "sunday_role", date: "2026-02-01" }]);
    expect(drafts[0].skipped).toBe(true);
    expect(drafts[0].exists).toBe(true);
  });

  it("a pre-session existing date's seats stay EMPTY even when the grid holds cells for it (a whole-month Auto solve, or a leftover manual edit) — MonthGenerator's history recompute relies on this to safely include `exists` drafts wholesale", () => {
    // `columns` covers the whole month unconditionally (D9), so a solve or a
    // manual edit CAN populate cells for a date that already had a service
    // before this session — `existingRoles` carries no member data at all, so
    // nothing upstream guarantees the grid stays empty for it. cellsToDrafts
    // itself must be the one that zeroes it.
    const cells: GridCell[] = [
      { date: "2026-02-01", rowId: "lead", memberIds: ["m1"], origin: "auto" },
      { date: "2026-02-01", rowId: "bgv", memberIds: ["m2"], origin: "auto" },
      { date: "2026-02-01", rowId: "coro", memberIds: ["m3"], origin: "auto" },
      { date: "2026-02-01", rowId: "instrumento:Batería", memberIds: ["m4"], origin: "auto" },
      { date: "2026-02-01", rowId: "foh:Sonido", memberIds: ["m5"], origin: "auto" },
    ];
    const [draft] = cellsToDrafts(cells, columns, new Set(), [], [{ _type: "sunday_role", date: "2026-02-01" }]);
    expect(draft.exists).toBe(true);
    expect(draft.leads).toEqual([]);
    expect(draft.bgvs).toEqual([]);
    expect(draft.chorus).toEqual([]);
    expect(draft.instruments).toEqual([]);
    expect(draft.foh).toEqual([]);
  });

  it("preserves localId, creationRequestId, exists and skipped across repeated calls for the same date and type", () => {
    // Non-empty on BOTH calls: with an empty Set on both sides, both results
    // are trivially `false` and the last assertion below can never detect a
    // lost skip. Under D18, `skippedDates` — not `previous` — is the single
    // authority on `skipped`: if the SECOND call's Set omitted this date,
    // `skipped` would flip back to `false` even though `first[0].skipped`
    // was `true`. A skip recorded only on the previous draft, and not also
    // re-supplied via skippedDates, is deliberately NOT preserved — Task 4
    // must keep re-passing the live skippedDates Set on every call, not rely
    // on the previous draft to remember a skip for it.
    const skippedDates = new Set(["2026-02-01"]);
    const first = cellsToDrafts([], columns, skippedDates, [], []);
    const second = cellsToDrafts([], columns, skippedDates, first, []);
    expect(first[0].skipped).toBe(true);
    expect(second[0].localId).toBe(first[0].localId);
    expect(second[0].creationRequestId).toBe(first[0].creationRequestId);
    expect(second[0].exists).toBe(first[0].exists);
    expect(second[0].skipped).toBe(first[0].skipped);
  });

  it("a fresh Auto run (previous: []) mints new ids; an ordinary re-render (previous: prior result) does not", () => {
    const run1 = cellsToDrafts([], columns, new Set(), [], []);
    const run2 = cellsToDrafts([], columns, new Set(), [], []); // simulate a second, independent Auto run
    expect(run2[0].localId).not.toBe(run1[0].localId);
    expect(run2[0].creationRequestId).not.toBe(run1[0].creationRequestId);

    const rerender = cellsToDrafts([], columns, new Set(), run1, []);
    expect(rerender[0].localId).toBe(run1[0].localId);
    expect(rerender[0].creationRequestId).toBe(run1[0].creationRequestId);
  });

  it("a lost exists (existingRoles not yet refreshed) is recovered from previous", () => {
    const created = cellsToDrafts([], columns, new Set(), [], []).map((d): DraftCard => ({ ...d, exists: true }));
    const rerender = cellsToDrafts([], columns, new Set(), created, []); // existingRoles hasn't caught up yet
    expect(rerender[0].exists).toBe(true);
  });
});

// ─── cellsToParticipantRoles — D12's conversion ──────────────────────────────
//
// `rankCandidates` takes `ParticipantRole[]`, whose seats hold member OBJECTS
// (`computeParticipation.ts:2-10`); `GridCell.memberIds` holds strings. This
// is the mapping D12's union needs, owned here so `PlannerGrid` (Task 3) does
// not hand-roll it.
describe("cellsToParticipantRoles", () => {
  const members: RankMember[] = [
    m("m1", "Frank"),
    m("m2", "Gaby"),
    m("m3", "Liu"),
    { ...m("m4", "Samo"), alias: "Sam" },
  ];

  it("round-trips one column's five seat categories into ParticipantRole member objects", () => {
    const date = "2026-02-01";
    const cells: GridCell[] = [
      { date, rowId: "lead", memberIds: ["m1"], origin: "manual" },
      { date, rowId: "bgv", memberIds: ["m2"], origin: "manual" },
      { date, rowId: "coro", memberIds: ["m3"], origin: "manual" },
      { date, rowId: "instrumento:Drums", memberIds: ["m4"], origin: "manual" },
      { date, rowId: "foh:Console", memberIds: ["m1"], origin: "manual" },
    ];
    const columns: GridColumn[] = [{ date, type: "sunday_role" }];
    const [role] = cellsToParticipantRoles(cells, columns, members);
    expect(role._type).toBe("sunday_role");
    expect(role.date).toBe(date);
    expect(role.leads).toEqual([{ _id: "m1", member_name: "Frank", alias: undefined }]);
    expect(role.bgvs).toEqual([{ _id: "m2", member_name: "Gaby", alias: undefined }]);
    expect(role.chorus).toEqual([{ _id: "m3", member_name: "Liu", alias: undefined }]);
    expect(role.instruments).toEqual([
      { person: { _id: "m4", member_name: "Samo", alias: "Sam" } },
    ]);
    expect(role.foh).toEqual([{ person: { _id: "m1", member_name: "Frank", alias: undefined } }]);
  });

  it("one draft per column regardless of occupancy, mirroring cellsToDrafts", () => {
    const columns: GridColumn[] = [
      { date: "2026-02-01", type: "sunday_role" },
      { date: "2026-02-07", type: "saturday_role" },
    ];
    const roles = cellsToParticipantRoles([], columns, members);
    expect(roles).toHaveLength(2);
    for (const role of roles) {
      expect(role.leads).toEqual([]);
      expect(role.bgvs).toEqual([]);
      expect(role.chorus).toEqual([]);
      expect(role.instruments).toEqual([]);
      expect(role.foh).toEqual([]);
    }
  });

  it("an unknown member id (not in `members`) still round-trips as a bare _id", () => {
    const date = "2026-02-01";
    const cells: GridCell[] = [{ date, rowId: "lead", memberIds: ["ghost"], origin: "manual" }];
    const columns: GridColumn[] = [{ date, type: "sunday_role" }];
    const [role] = cellsToParticipantRoles(cells, columns, members);
    expect(role.leads).toEqual([{ _id: "ghost" }]);
  });

  it("one Drums cell with two members becomes two separate instrument slots (D3, matching cellsToDrafts)", () => {
    const date = "2026-02-01";
    const cells: GridCell[] = [
      { date, rowId: "instrumento:Drums", memberIds: ["m1", "m2"], origin: "manual" },
    ];
    const columns: GridColumn[] = [{ date, type: "sunday_role" }];
    const [role] = cellsToParticipantRoles(cells, columns, members);
    expect(role.instruments).toHaveLength(2);
  });

  it("feeds computeParticipation without throwing and produces a sane total", () => {
    // The whole point of this conversion: rankCandidates' load signal is
    // computeParticipation(windowRoles) — this is the integration check that
    // the shape this function returns is actually consumable by it.
    const cells: GridCell[] = [
      { date: "2026-02-01", rowId: "lead", memberIds: ["m1"], origin: "manual" },
      { date: "2026-02-08", rowId: "lead", memberIds: ["m1"], origin: "auto" },
    ];
    const columns: GridColumn[] = [
      { date: "2026-02-01", type: "sunday_role" },
      { date: "2026-02-08", type: "sunday_role" },
    ];
    const roles = cellsToParticipantRoles(cells, columns, members);
    const participation = computeParticipation(roles);
    const frank = participation.find((p) => p.id === "m1");
    expect(frank?.sunLead).toBe(2);
  });
});

describe("historyEntryFromDrafts", () => {
  const members: RankMember[] = [m("m1", "Frank"), m("m2", "Gaby"), m("m3", "Liu")];

  const draft = (overrides: Partial<DraftCard>): DraftCard => ({
    localId: overrides.localId ?? `local-${Math.random()}`,
    creationRequestId: overrides.creationRequestId ?? `req-${Math.random()}`,
    _type: "sunday_role",
    date: "2026-02-01",
    exists: false,
    skipped: false,
    leads: [],
    bgvs: [],
    chorus: [],
    instruments: [],
    foh: [],
    ...overrides,
  });

  it("returns null when nothing was created — the abandoned-run case writes nothing", () => {
    expect(historyEntryFromDrafts([], members, 2026, 2)).toBeNull();
  });

  it("a Sunday draft's leads/bgvs/chorus become Sun.Lead/Sun.BGV/Sun.Choir, keyed by member NAME", () => {
    const drafts = [draft({ date: "2026-02-01", leads: ["m1"], bgvs: ["m2"], chorus: ["m3"] })];
    const entry = historyEntryFromDrafts(drafts, members, 2026, 2);
    expect(entry).toEqual({
      key: "2026-2",
      year: 2026,
      month: 2,
      total_counts: { Frank: 1, Gaby: 1, Liu: 1 },
      role_counts: {
        Frank: { "Sun.Lead": 1 },
        Gaby: { "Sun.BGV": 1 },
        Liu: { "Sun.Choir": 1 },
      },
    });
  });

  it("a Saturday draft's leads/bgvs become Sat.Lead/Sat.BGV — and Sat.Choir is never emitted, even if `chorus` somehow carries a name", () => {
    const drafts = [
      draft({
        _type: "saturday_role",
        date: "2026-02-07",
        leads: ["m1"],
        bgvs: ["m2"],
        chorus: ["m3"], // shouldn't happen (cellsToDrafts zeroes it) — defend anyway
      }),
    ];
    const entry = historyEntryFromDrafts(drafts, members, 2026, 2);
    expect(entry?.role_counts).toEqual({
      Frank: { "Sat.Lead": 1 },
      Gaby: { "Sat.BGV": 1 },
    });
    expect(entry?.role_counts.Liu).toBeUndefined();
    expect(Object.values(entry?.role_counts ?? {}).some((counts) => "Sat.Choir" in counts)).toBe(false);
    expect(entry?.total_counts).toEqual({ Frank: 1, Gaby: 1 });
  });

  it("total_counts is the per-person sum of role_counts across multiple dates and roles", () => {
    const drafts = [
      draft({ date: "2026-02-01", leads: ["m1"], bgvs: ["m2"] }),
      draft({ date: "2026-02-08", leads: ["m1"], chorus: ["m2"] }),
      draft({ _type: "saturday_role", date: "2026-02-07", bgvs: ["m1"] }),
    ];
    const entry = historyEntryFromDrafts(drafts, members, 2026, 2);
    expect(entry?.role_counts.Frank).toEqual({ "Sun.Lead": 2, "Sat.BGV": 1 });
    expect(entry?.role_counts.Gaby).toEqual({ "Sun.BGV": 1, "Sun.Choir": 1 });
    expect(entry?.total_counts).toEqual({ Frank: 3, Gaby: 2 });
  });

  it("a member id absent from `members` falls back to the raw id, matching buildSolveRequest's own idToName fallback", () => {
    const drafts = [draft({ leads: ["ghost-id"] })];
    const entry = historyEntryFromDrafts(drafts, members, 2026, 2);
    expect(entry?.role_counts["ghost-id"]).toEqual({ "Sun.Lead": 1 });
  });

  it("a month assigned entirely by hand (no Auto run at all) still records an entry — the function only reads seat contents, never an 'origin' flag", () => {
    const drafts = [draft({ date: "2026-02-01", leads: ["m1"] })];
    const entry = historyEntryFromDrafts(drafts, members, 2026, 2);
    expect(entry?.total_counts).toEqual({ Frank: 1 });
  });

  it("the caller is responsible for excluding skipped/failed drafts — a caller that (incorrectly) includes a skipped one still counts it, proving MonthGenerator's own filter is what does the excluding", () => {
    // Deliberate: this function trusts its input and never filters on
    // `skipped`/`exists` itself (see the docstring above). MonthGenerator's
    // handleConfirm owns that decision — today a union of "created this
    // batch" and "already exists" (self-correcting a retried partial batch),
    // never a raw, unfiltered `drafts` array — and this pin exists so a
    // future change can't silently start relying on this function to guard
    // against a skipped/failed draft slipping through instead.
    const skippedButPassedIn = draft({ date: "2026-02-01", leads: ["m1"], skipped: true });
    const entry = historyEntryFromDrafts([skippedButPassedIn], members, 2026, 2);
    expect(entry?.total_counts).toEqual({ Frank: 1 });
  });
});
