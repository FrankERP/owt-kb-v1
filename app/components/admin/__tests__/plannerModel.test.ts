// app/components/admin/__tests__/plannerModel.test.ts
//
// Every test here exists because a specific, verified failure was found in
// nine rounds of adversarial review of the plan this implements
// (docs/superpowers/plans/2026-07-29-planner-grid.md). They are the point of
// this file, not decoration — see the file header comment in `plannerModel.ts`
// for the six load-bearing facts they pin.
import { describe, expect, it, vi } from "vitest";

import type { SolveResponse } from "@/app/api/admin/solve/route";
import { computeParticipation } from "@/app/utils/computeParticipation";
import type { RankMember } from "../candidateRanking";
import {
  applySolveResponse as applySolveResponseModel,
  assignedForColumn,
  assertGridIdentity,
  buildColumns,
  buildRows,
  buildSolveRequest,
  cellsToDrafts as cellsToDraftsModel,
  cellsToParticipantRoles as cellsToParticipantRolesModel,
  createColumnId,
  hasTarget,
  historyEntryFromDrafts,
  historyForRequest,
  isSolvable,
  rowAppliesTo,
  mapUnfilledSeats,
  namelessSpecial,
  saturdayForWeek,
  seatDefForRow,
  solvableWindow,
  unaddressableDates,
  weekForColumn,
  weekendWeekIndexes,
  type DraftCard,
  type GridCell as ModelGridCell,
  type GridColumn as ModelGridColumn,
  type SolverConfig,
  type SolverHistoryEntry,
} from "../plannerModel";

type GridColumn = Omit<ModelGridColumn, "columnId"> & { columnId?: string };
type GridCell = {
  date: string;
  rowId: string;
  memberIds: string[];
  origin: ModelGridCell["origin"];
  overrides?: string[];
  overrideReasons?: Record<string, string>;
};

const normalizeColumns = (columns: GridColumn[]): ModelGridColumn[] =>
  columns.map((column) => ({
    ...column,
    columnId: column.columnId ?? createColumnId(column.type, column.date),
  }));

const normalizeCells = (cells: GridCell[], columns: ModelGridColumn[]): ModelGridCell[] =>
  cells.map((cell) => {
    const matches = columns.filter((column) => column.date === cell.date);
    if (matches.length !== 1) throw new Error(`ambiguous test cell date ${cell.date}`);
    return {
      columnId: matches[0].columnId,
      rowId: cell.rowId,
      occupants: cell.memberIds.map((memberId) => ({ memberId })),
      origin: cell.origin,
      overrides: cell.overrides,
      overrideReasons: cell.overrideReasons,
    };
  });

const cellsToDrafts = (
  cells: GridCell[] | ModelGridCell[],
  inputColumns: GridColumn[] | ModelGridColumn[],
  skipped: Set<string>,
  previous: DraftCard[],
  existing: Parameters<typeof cellsToDraftsModel>[4],
) => {
  const columns = normalizeColumns(inputColumns);
  const normalized = cells.map((cell) =>
    "columnId" in cell ? cell : normalizeCells([cell], columns)[0],
  );
  const skippedColumnIds = new Set(
    [...skipped].map((value) => columns.find((column) => column.date === value)?.columnId ?? value),
  );
  return cellsToDraftsModel(normalized, columns, skippedColumnIds, previous, existing);
};

const cellsToParticipantRoles = (
  cells: GridCell[] | ModelGridCell[],
  inputColumns: GridColumn[] | ModelGridColumn[],
  members: RankMember[],
) => {
  const columns = normalizeColumns(inputColumns);
  const normalized = cells.map((cell) =>
    "columnId" in cell ? cell : normalizeCells([cell], columns)[0],
  );
  return cellsToParticipantRolesModel(normalized, columns, members);
};

const applySolveResponse = (
  input: Omit<Parameters<typeof applySolveResponseModel>[0], "previousCells" | "columns"> & {
    previousCells: GridCell[];
    columns: GridColumn[];
  },
) => {
  const columns = normalizeColumns(input.columns);
  const result = applySolveResponseModel({
    ...input,
    columns,
    previousCells: normalizeCells(input.previousCells, columns),
  });
  const dateByColumnId = new Map(columns.map((column) => [column.columnId, column.date]));
  return {
    ...result,
    cells: result.cells.map((cell): GridCell => ({
      date: dateByColumnId.get(cell.columnId)!,
      rowId: cell.rowId,
      memberIds: cell.occupants.map((occupant) => occupant.memberId),
      origin: cell.origin,
      overrides: cell.overrides,
      overrideReasons: cell.overrideReasons,
    })),
  };
};

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

describe("stable grid identity", () => {
  it("builds exact target-bound create column ids", () => {
    const [column] = buildColumns({ sundayDates: ["2026-02-01"], activeSatDates: [] });
    expect(column.columnId).toBe("create:sunday_role__2026-02-01");
  });

  it("keeps two same-date columns and their rosters independent", () => {
    const columns: ModelGridColumn[] = [
      { columnId: "role-a", date: "2026-02-11", type: "special_role", serviceName: "Vigilia" },
      { columnId: "role-b", date: "2026-02-11", type: "special_role", serviceName: "Retiro" },
    ];
    const cells: ModelGridCell[] = [
      { columnId: "role-a", rowId: "lead", occupants: [{ memberId: "m1" }], origin: "manual" },
      { columnId: "role-b", rowId: "lead", occupants: [{ memberId: "m2" }], origin: "manual" },
    ];
    const roles = cellsToParticipantRolesModel(cells, columns, [m("m1", "Uno"), m("m2", "Dos")]);
    expect(roles[0].leads?.map((person) => person._id)).toEqual(["m1"]);
    expect(roles[1].leads?.map((person) => person._id)).toEqual(["m2"]);
    expect(assignedForColumn(cells, buildRows(), "role-a").map((seat) => seat.memberId)).toEqual(["m1"]);
  });

  it("keeps cells attached when only a column's calendar date changes", () => {
    const cells: ModelGridCell[] = [
      { columnId: "role-a", rowId: "lead", occupants: [{ memberId: "m1" }], origin: "manual" },
    ];
    const [role] = cellsToParticipantRolesModel(
      cells,
      [{ columnId: "role-a", date: "2026-03-04", type: "special_role", serviceName: "Vigilia" }],
      [m("m1", "Uno")],
    );
    expect(role.date).toBe("2026-03-04");
    expect(role.leads?.map((person) => person._id)).toEqual(["m1"]);
  });

  it("fails closed on missing, duplicate, or detached identity", () => {
    expect(() =>
      assertGridIdentity([
        { columnId: "same", date: "2026-02-01", type: "sunday_role" },
        { columnId: "same", date: "2026-02-08", type: "sunday_role" },
      ]),
    ).toThrow(/Duplicate grid columnId/);
    expect(() =>
      assertGridIdentity(
        [{ columnId: "known", date: "2026-02-01", type: "sunday_role" }],
        [{ columnId: "missing", rowId: "lead", occupants: [], origin: "empty" }],
      ),
    ).toThrow(/unknown columnId/);
  });

  it("keeps create POST meaning independent of stored occupant item keys", () => {
    const columns = buildColumns({ sundayDates: ["2026-02-01"], activeSatDates: [] });
    const [draft] = cellsToDraftsModel(
      [{ columnId: columns[0].columnId, rowId: "lead", occupants: [{ memberId: "m1", itemKey: "stored-key" }], origin: "manual" }],
      columns,
      new Set(),
      [],
      [],
    );
    expect(draft.leads).toEqual(["m1"]);
    expect(JSON.stringify(draft)).not.toContain("stored-key");
  });

  it("preserves the complete create draft boundary after the occupant migration", () => {
    const columns = buildColumns({ sundayDates: ["2026-02-01"], activeSatDates: [] });
    const columnId = columns[0].columnId;
    const previous: DraftCard[] = [{
      localId: "draft-1",
      creationRequestId: "request-1",
      _type: "sunday_role",
      date: "2026-02-01",
      exists: false,
      isExisting: false,
      skipped: false,
      leads: [],
      bgvs: [],
      chorus: [],
      instruments: [],
      foh: [],
    }];
    const [draft] = cellsToDraftsModel(
      [
        { columnId, rowId: "lead", occupants: [{ memberId: "lead-1" }], origin: "manual" },
        { columnId, rowId: "bgv", occupants: [{ memberId: "bgv-1" }], origin: "manual" },
        { columnId, rowId: "coro", occupants: [{ memberId: "coro-1" }], origin: "manual" },
        { columnId, rowId: "instrumento:Bass", occupants: [{ memberId: "bass-1" }], origin: "manual" },
        { columnId, rowId: "foh:Console", occupants: [{ memberId: "foh-1" }], origin: "manual" },
      ],
      columns,
      new Set(),
      previous,
      [],
    );
    expect(draft).toEqual({
      ...previous[0],
      leads: ["lead-1"],
      bgvs: ["bgv-1"],
      chorus: ["coro-1"],
      instruments: [{ id: "instrumento:Bass#0", instrument: "Bass", personId: "bass-1" }],
      foh: [{ id: "foh:Console#0", role: "Console", personId: "foh-1" }],
    });
  });
});

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

  // These two used to pass `includeSundays: false` alongside a FULLY populated
  // `sundayDates`. That flag is gone (Task 5 fix pass, Finding 4): it was the
  // retired Domingos checkbox's mechanism, no production caller passed it, and
  // its permissive `true` default meant a future caller could re-open the
  // pre-E21 leak with no type error. Since Task 5, "no Sundays" is expressed
  // the way `MonthGenerator` expresses it — an EMPTY selection reaching
  // `buildColumns` while `sundayDatesFull` still reaches `buildSolveRequest`.
  // Both halves of THAT split are pinned at the component level, where both
  // values exist, by `MonthGenerator.create.test.tsx`'s D9 test (no Sunday
  // column, no `sunday_role` POSTed) and its Oct-31 test (the request is still
  // built over the full spine). What stays here is the pure contract: a Sunday
  // column exists for exactly the dates handed in.

  it("buildColumns yields Saturday columns only when the Sunday selection is empty", () => {
    const columns = buildColumns({ sundayDates: [], activeSatDates: FEB_SATURDAYS });
    expect(columns.every((c) => c.type === "saturday_role")).toBe(true);
    expect(columns.map((c) => c.date).sort()).toEqual([...FEB_SATURDAYS].sort());
  });

  it("buildColumns yields a Sunday column for exactly the selected dates — no more, no fewer", () => {
    const selection = [FEB_SUNDAYS[0], FEB_SUNDAYS[2]];
    const columns = buildColumns({ sundayDates: selection, activeSatDates: [] });
    expect(columns.map((c) => c.date)).toEqual(selection);
    expect(columns.every((c) => c.type === "sunday_role")).toBe(true);
    // The withheld Sundays produce nothing at all — this is the guarantee the
    // removed `includeSundays` flag could have been used to bypass.
    expect(columns.map((c) => c.date)).not.toContain(FEB_SUNDAYS[1]);
    expect(columns.map((c) => c.date)).not.toContain(FEB_SUNDAYS[3]);
  });

  it("cellsToDrafts with Sundays excluded yields ZERO sunday_role drafts", () => {
    const columns = buildColumns({ sundayDates: [], activeSatDates: FEB_SATURDAYS });
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

  it("a rule naming a member absent from `members` still injects the raw name into support AND keeps that raw name in the rule text — resolveToMemberName's fallback (plannerModel.ts:307-313) is what both `support` injection (:414-417) and allRulesToDs/restrictionToDs (:341/:326) resolve through, so they can never disagree about an unknown DSL person", () => {
    const config: SolverConfig = {
      ...emptyConfig,
      sundayLeads: ["frank"],
      restrictions: [
        {
          id: "r1", person: "Ghost Member", excludedPatterns: ["Sat.*"],
          fairness: "none", fairnessSlack: 0, weekExclusions: [], caps: [],
        },
      ],
    };
    const result = buildSolveRequest({
      config, members, sundayDates: FEB_SUNDAYS, activeSatDates: [],
      historyEntries: [], year: 2026, month: 2,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("unreachable");
    expect(result.request.support).toContain("Ghost Member");
    expect(result.request.dsl_rules).toContain("Ghost Member !in Sat.*");
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

// ─── Week spine over a 5-Sunday month (E21) ──────────────────────────────────
//
// Every existing fixture above (FEB/OCT) has exactly 4 Sundays. A week-number
// computation that happens to work only because it silently assumes a
// 4-week month (e.g. wraps modulo 4) would pass every test above and still
// misplace the 5th week. August 2026 has 5 Sundays — pin the THIRD one
// specifically, both on the request side (buildSolveRequest's own `i + 1`
// loop) and the response side (weekForColumn, exercised through
// applySolveResponse since it is module-private, plannerModel.ts:460).
describe("Week spine over a 5-Sunday month (E21)", () => {
  const AUG_SUNDAYS = ["2026-08-02", "2026-08-09", "2026-08-16", "2026-08-23", "2026-08-30"];
  const THIRD_SUNDAY = "2026-08-16";
  const FOURTH_SUNDAY = "2026-08-23";
  const FIFTH_SUNDAY = "2026-08-30";

  it("buildSolveRequest emits '!in week 3 Sun.*' for a pool member unavailable on the third Sunday", () => {
    const config: SolverConfig = { ...emptyConfig, sundayLeads: ["frank"] };
    const members: RankMember[] = [{ ...m("frank", "Frank"), unavailableDates: [THIRD_SUNDAY] }];
    const result = buildSolveRequest({
      config, members, sundayDates: AUG_SUNDAYS, activeSatDates: [],
      historyEntries: [], year: 2026, month: 8,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("unreachable");
    expect(result.request.dsl_rules).toContain("Frank !in week 3 Sun.*");
  });

  // A week formula that wraps modulo 4 (e.g. `(i % 4) + 1`) coincides with
  // `i + 1` at the third Sunday (i=2 either way) but diverges at the fifth
  // (i=4 gives week 1 under a mod-4 wrap, vs. the correct week 5) — this is
  // the case the test above cannot catch on its own.
  it("buildSolveRequest emits '!in week 5 Sun.*' for a pool member unavailable on the fifth Sunday", () => {
    const config: SolverConfig = { ...emptyConfig, sundayLeads: ["frank"] };
    const members: RankMember[] = [{ ...m("frank", "Frank"), unavailableDates: [FIFTH_SUNDAY] }];
    const result = buildSolveRequest({
      config, members, sundayDates: AUG_SUNDAYS, activeSatDates: [],
      historyEntries: [], year: 2026, month: 8,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("unreachable");
    expect(result.request.dsl_rules).toContain("Frank !in week 5 Sun.*");
  });

  it("applySolveResponse maps schedule week 3's Sunday data onto the third Sunday's date, never the fourth", () => {
    const rows = buildRows();
    const members: RankMember[] = [m("m1", "Frank")];
    const columns: GridColumn[] = AUG_SUNDAYS.map((date) => ({ date, type: "sunday_role" as const }));
    const resp: SolveResponse = {
      ok: true,
      schedule: { "3": { Sunday: { Lead: ["Frank"], BGV: [], Choir: [] } } },
    };
    const result = applySolveResponse({
      response: resp, previousCells: [], columns, rows,
      sundayDates: AUG_SUNDAYS, activeSatDates: [], members,
    });
    const onThird = result.cells.find((c) => c.rowId === "lead" && c.date === THIRD_SUNDAY);
    const onFourth = result.cells.find((c) => c.rowId === "lead" && c.date === FOURTH_SUNDAY);
    expect(onThird).toBeTruthy();
    expect(onThird!.memberIds).toEqual(["m1"]);
    expect(onFourth).toBeUndefined();
  });

  // Response-side counterpart of the mod-4 wrap check above: week 5's roster
  // must land on the fifth Sunday's column, not get folded back onto the
  // first (which is what `(i % 4) + 1` would do for i=4).
  it("applySolveResponse maps schedule week 5's Sunday data onto the fifth Sunday's date, never the first", () => {
    const rows = buildRows();
    const members: RankMember[] = [m("m1", "Frank")];
    const columns: GridColumn[] = AUG_SUNDAYS.map((date) => ({ date, type: "sunday_role" as const }));
    const resp: SolveResponse = {
      ok: true,
      schedule: { "5": { Sunday: { Lead: ["Frank"], BGV: [], Choir: [] } } },
    };
    const result = applySolveResponse({
      response: resp, previousCells: [], columns, rows,
      sundayDates: AUG_SUNDAYS, activeSatDates: [], members,
    });
    const onFifth = result.cells.find((c) => c.rowId === "lead" && c.date === FIFTH_SUNDAY);
    const onFirst = result.cells.find((c) => c.rowId === "lead" && c.date === AUG_SUNDAYS[0]);
    expect(onFifth).toBeTruthy();
    expect(onFifth!.memberIds).toEqual(["m1"]);
    expect(onFirst).toBeUndefined();
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
  // The 4th argument is the SELECTED Sundays. Passing `FEB_SUNDAYS` twice is
  // the explicit "all of them" these three pre-existing cases always meant.
  it("places a Sunday seat on its row and date", () => {
    const out = mapUnfilledSeats(["W2 Sunday Sun.Choir #2"], FEB_SUNDAYS, FEB_SATURDAYS, FEB_SUNDAYS);
    expect(out).toEqual([{ columnId: createColumnId("sunday_role", "2026-02-08"), rowId: "coro" }]);
  });

  it("places a Saturday seat on its row and adjacent date", () => {
    const out = mapUnfilledSeats(["W2 Saturday Sat.BGV #1"], FEB_SUNDAYS, FEB_SATURDAYS, FEB_SUNDAYS);
    expect(out).toEqual([{ columnId: createColumnId("saturday_role", "2026-02-07"), rowId: "bgv" }]);
  });

  it("drops a Saturday seat whose resolved date is not in the selected column set", () => {
    const out = mapUnfilledSeats(["W2 Saturday Sat.BGV #1"], FEB_SUNDAYS, [], FEB_SUNDAYS); // no Saturdays selected
    expect(out).toEqual([]);
  });

  // Work item 7: the Sunday branch resolved unconditionally while Saturday
  // already filtered. Deleting the `selectedSun.has(...)` guard turns both of
  // these green-to-red — nothing else in the suite notices.
  it("drops a Sunday seat whose week resolves to a DESELECTED Sunday", () => {
    const selected = FEB_SUNDAYS.filter((d) => d !== "2026-02-08");
    const out = mapUnfilledSeats(["W2 Sunday Sun.Choir #2"], FEB_SUNDAYS, FEB_SATURDAYS, selected);
    expect(out).toEqual([]);
  });

  // The dangerous shape of the same bug: a deselected Sunday that now carries a
  // weekday special. Without the filter, week 2's unfilled Lead renders on a
  // `special_role` column the solver was never asked about.
  it("still resolves the week POSITIONALLY over the full spine — only the render is filtered", () => {
    const selected = FEB_SUNDAYS.filter((d) => d !== "2026-02-01");
    const out = mapUnfilledSeats(
      ["W1 Sunday Sun.Lead #1", "W2 Sunday Sun.Lead #1"],
      FEB_SUNDAYS,
      [],
      selected,
    );
    expect(out).toEqual([{ columnId: createColumnId("sunday_role", "2026-02-08"), rowId: "lead" }]);
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

  it("keys draft identity by (type, date), not date alone — the collision-key split (E19) must keep distinguishing them", () => {
    // Today `type` and `date` are the only two axes `cellsToDrafts` keys on
    // (`${_type}__${date}`). A future collision-key split (adding a third
    // service type sharing a date with these two) must not collapse this
    // back to a date-only key — this pins that a sunday_role and a
    // saturday_role column sharing a date already get, and keep, independent
    // identities.
    const sharedDateColumns: GridColumn[] = [
      { date: "2026-02-07", type: "sunday_role" },
      { date: "2026-02-07", type: "saturday_role" },
    ];
    const first = cellsToDrafts([], sharedDateColumns, new Set(), [], []);
    const firstSunday = first.find((d) => d._type === "sunday_role")!;
    const firstSaturday = first.find((d) => d._type === "saturday_role")!;
    expect(firstSunday.localId).not.toBe(firstSaturday.localId);
    expect(firstSunday.creationRequestId).not.toBe(firstSaturday.creationRequestId);

    const second = cellsToDrafts([], sharedDateColumns, new Set(), first, []);
    const secondSunday = second.find((d) => d._type === "sunday_role")!;
    const secondSaturday = second.find((d) => d._type === "saturday_role")!;
    expect(secondSunday.localId).toBe(firstSunday.localId);
    expect(secondSunday.creationRequestId).toBe(firstSunday.creationRequestId);
    expect(secondSaturday.localId).toBe(firstSaturday.localId);
    expect(secondSaturday.creationRequestId).toBe(firstSaturday.creationRequestId);
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
    isExisting: false,
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

  it("a full weekend (Sunday + its adjacent Saturday) produces Sun.Lead/Sat.Lead/Sun.Choir together — the CURRENT baseline (E9/E20) Task 6 must leave untouched while adding the special exclusion", () => {
    const drafts = [
      draft({ _type: "sunday_role", date: "2026-02-08", leads: ["m1"], chorus: ["m3"] }),
      draft({ _type: "saturday_role", date: "2026-02-07", leads: ["m1"] }),
    ];
    const entry = historyEntryFromDrafts(drafts, members, 2026, 2);
    expect(entry?.role_counts).toEqual({
      Frank: { "Sun.Lead": 1, "Sat.Lead": 1 },
      Liu: { "Sun.Choir": 1 },
    });
    expect(entry?.total_counts).toEqual({ Frank: 2, Liu: 1 });
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
    // handleConfirm owns that decision — a session-scoped union of "created
    // this batch" and "created by an earlier confirm this session" (tracked
    // in a ref, never derived from `d.exists`, so a retried partial batch
    // self-corrects without ever crediting a pre-session service), never a
    // raw, unfiltered `drafts` array — and this pin exists so a future change
    // can't silently start relying on this function to guard against a
    // skipped/failed draft slipping through instead.
    const skippedButPassedIn = draft({ date: "2026-02-01", leads: ["m1"], skipped: true });
    const entry = historyEntryFromDrafts([skippedButPassedIn], members, 2026, 2);
    expect(entry?.total_counts).toEqual({ Frank: 1 });
  });
});

// ─── Specials (Task 2 — the widened `ColumnType`) ─────────────────────────────
//
// The type change itself is nearly inert (fact 6): every weekend/special
// distinction that mattered was an `===` comparison that kept compiling and
// silently took the Sunday-or-Saturday path. Each test below pins one of those
// sites, and each was proved to discriminate by inverting the behaviour and
// watching it fail before being restored.

describe("a special column HAS a Coro row (E18)", () => {
  const rows = buildRows();
  const coro = rows.find((r) => r.id === "coro")!;
  const special: GridColumn = { date: "2026-02-11", type: "special_role", serviceName: "Vigilia" };
  const saturday: GridColumn = { date: "2026-02-07", type: "saturday_role" };

  it("applies the Coro row to a special, unlike a Saturday", () => {
    expect(rowAppliesTo(coro, special)).toBe(true);
    expect(rowAppliesTo(coro, saturday)).toBe(false);
  });

  it("writes the Coro occupants of a special straight through to `chorus`", () => {
    const cells: GridCell[] = [
      { date: "2026-02-11", rowId: "coro", memberIds: ["m1", "m2"], origin: "manual" },
      { date: "2026-02-11", rowId: "lead", memberIds: ["m3"], origin: "manual" },
    ];
    const drafts = cellsToDrafts(cells, [special], new Set(), [], []);
    expect(drafts).toHaveLength(1);
    expect(drafts[0]._type).toBe("special_role");
    expect(drafts[0].chorus).toEqual(["m1", "m2"]);
    expect(drafts[0].leads).toEqual(["m3"]);
  });

  it("keeps `rowAppliesTo` and the write in step for every column type — a row the grid never showed never reaches Sanity", () => {
    // E18's standing requirement, checked as a property rather than as three
    // separate hand-written expectations: whatever `rowAppliesTo` says about the
    // Coro row on a column type, `cellsToDrafts` must write exactly that.
    const columns: GridColumn[] = [
      { date: "2026-02-01", type: "sunday_role" },
      { date: "2026-02-07", type: "saturday_role" },
      { date: "2026-02-11", type: "special_role", serviceName: "Vigilia" },
    ];
    const cells: GridCell[] = columns.map((c) => ({
      date: c.date,
      rowId: "coro",
      memberIds: ["m1"],
      origin: "manual" as const,
    }));
    const drafts = cellsToDrafts(cells, columns, new Set(), [], []);
    for (const column of columns) {
      const written = drafts.find((d) => d.date === column.date)!.chorus;
      expect(written, `${column.type} chorus`).toEqual(rowAppliesTo(coro, column) ? ["m1"] : []);
    }
  });

  it("carries `service_name` from the column onto the draft, and never onto a weekend draft", () => {
    const columns: GridColumn[] = [
      { date: "2026-02-11", type: "special_role", serviceName: "Vigilia de Oración" },
      { date: "2026-02-01", type: "sunday_role" },
    ];
    const drafts = cellsToDrafts([], columns, new Set(), [], []);
    expect(drafts.find((d) => d._type === "special_role")!.service_name).toBe("Vigilia de Oración");
    // `in`, not `toBeUndefined()`: the key must be ABSENT, not present-and-undefined.
    // `toBeUndefined()` passes either way, so it could not fail an unconditional spread.
    expect("service_name" in drafts.find((d) => d._type === "sunday_role")!).toBe(false);
  });
});

describe("a special is never solvable, but keeps its target cap (E4/E5, P5)", () => {
  const rows = buildRows();
  const byId = Object.fromEntries(rows.map((r) => [r.id, r]));
  const special: GridColumn = { date: "2026-02-11", type: "special_role", serviceName: "Vigilia" };
  const sunday: GridColumn = { date: "2026-02-01", type: "sunday_role" };

  it("isSolvable is false for every row on a special column", () => {
    for (const row of rows) expect(isSolvable(row, special), row.id).toBe(false);
    // …while the same rows are still solvable on a Sunday, so the assertion
    // above is about the COLUMN, not about the rows being unsolvable anyway.
    expect(isSolvable(byId["lead"], sunday)).toBe(true);
    expect(isSolvable(byId["coro"], sunday)).toBe(true);
  });

  it("hasTarget still holds on a special's voice rows — the D7 cap and the amber +N survive", () => {
    expect(hasTarget(byId["lead"], special)).toBe(true);
    expect(hasTarget(byId["bgv"], special)).toBe(true);
    expect(hasTarget(byId["coro"], special)).toBe(true);
  });

  it("hasTarget agrees with isSolvable on every weekend cell — the split changes nothing there", () => {
    const weekend: GridColumn[] = [
      { date: "2026-02-01", type: "sunday_role" },
      { date: "2026-02-07", type: "saturday_role" },
    ];
    for (const column of weekend) {
      for (const row of rows) {
        expect(hasTarget(row, column), `${column.type}/${row.id}`).toBe(isSolvable(row, column));
      }
    }
  });

  it("hasTarget is false for instrument and FOH rows on a special — they still render every occupant", () => {
    for (const row of rows) {
      if (row.category !== "voz") expect(hasTarget(row, special), row.id).toBe(false);
    }
  });
});

describe("weekForColumn returns null for a special (E4)", () => {
  // 2026-02-07 is the Saturday ADJACENT to Sunday 2026-02-08 (week 2). E3 lets a
  // deselected Saturday become a special, so this exact date is reachable — and
  // it is precisely the date that used to fall into the Saturday branch and get
  // that weekend's roster written into it.
  const asSaturday: GridColumn = { date: "2026-02-07", type: "saturday_role" };
  const asSpecial: GridColumn = { date: "2026-02-07", type: "special_role", serviceName: "Vigilia" };

  it("the identical date resolves to week 2 as a Saturday and to null as a special", () => {
    expect(weekForColumn(asSaturday, FEB_SUNDAYS)).toBe(2);
    expect(weekForColumn(asSpecial, FEB_SUNDAYS)).toBeNull();
  });

  it("applySolveResponse writes NOTHING onto a special column, while the same response fills the real Saturday", () => {
    const rows = buildRows({ instrumentSeats: [], fohSeats: [] });
    const response: SolveResponse = {
      status: "ok",
      schedule: { "2": { Saturday: { Lead: ["Frank"], BGV: ["Gaby"] } } },
    } as unknown as SolveResponse;
    const members: RankMember[] = [m("m1", "Frank"), m("m2", "Gaby")];

    const filled = applySolveResponse({
      response,
      previousCells: [],
      columns: [asSaturday],
      rows,
      sundayDates: FEB_SUNDAYS,
      activeSatDates: ["2026-02-07"],
      members,
    });
    expect(filled.cells.map((c) => c.rowId).sort()).toEqual(["bgv", "lead"]);

    const asSpecialResult = applySolveResponse({
      response,
      previousCells: [],
      columns: [asSpecial],
      rows,
      sundayDates: FEB_SUNDAYS,
      activeSatDates: ["2026-02-07"],
      members,
    });
    expect(asSpecialResult.cells).toEqual([]);
  });
});

describe("a special contributes nothing to fairness history (E9/E20)", () => {
  const members: RankMember[] = [m("m1", "Frank"), m("m2", "Gaby")];
  const specialDraft: DraftCard = {
    localId: "l1",
    creationRequestId: "r1",
    _type: "special_role",
    date: "2026-02-11",
    service_name: "Vigilia",
    exists: false,
    isExisting: false,
    skipped: false,
    leads: ["m1"],
    bgvs: ["m2"],
    chorus: ["m1", "m2"],
    instruments: [],
    foh: [],
  };

  it("a special-only batch writes an entry with EMPTY counts — no Sun.*/Sat.* keys are invented", () => {
    const entry = historyEntryFromDrafts([specialDraft], members, 2026, 2)!;
    expect(entry.role_counts).toEqual({});
    expect(entry.total_counts).toEqual({});
  });

  it("all three seat arrays are guarded, not just chorus — the special's PEOPLE appear nowhere in the entry", () => {
    // Asserted on the PERSON keys, not on the role-key strings: deleting the
    // `leads`/`bgvs` guards bumps under the literal key `"null"`, which contains
    // none of "Lead"/"BGV"/"Choir" — so a `not.toContain` on the serialized
    // counts would pass through exactly the mutation this test names.
    expect(specialDraft.leads.length + specialDraft.bgvs.length + specialDraft.chorus.length).toBe(4);
    const entry = historyEntryFromDrafts([specialDraft], members, 2026, 2)!;
    expect(Object.keys(entry.role_counts)).toEqual([]);
    expect(Object.keys(entry.total_counts)).toEqual([]);
  });

  it("a Sunday in the same batch is unaffected — only the special's seats vanish", () => {
    const sundayDraft: DraftCard = {
      ...specialDraft,
      localId: "l2",
      creationRequestId: "r2",
      _type: "sunday_role",
      date: "2026-02-01",
      service_name: undefined,
    };
    const entry = historyEntryFromDrafts([specialDraft, sundayDraft], members, 2026, 2)!;
    expect(entry.role_counts).toEqual({
      Frank: { "Sun.Lead": 1, "Sun.Choir": 1 },
      Gaby: { "Sun.BGV": 1, "Sun.Choir": 1 },
    });
    expect(entry.total_counts).toEqual({ Frank: 2, Gaby: 2 });
  });
});

describe("two keys, not one: identity vs collision (E17/E19)", () => {
  const columnNamed = (name: string): GridColumn => ({
    date: "2026-02-11",
    type: "special_role",
    serviceName: name,
  });

  it("renaming a special preserves localId, creationRequestId and exists — identity is NEVER name-bearing", () => {
    // If identity carried the name, the rename would miss `prevByKey`, re-mint
    // both ids and reset `exists` — and `handleConfirm` would post a SECOND
    // special_role on the same date, orphaning the first in silence.
    const first = cellsToDrafts([], [columnNamed("Vigilia")], new Set(), [], []);
    const created = first.map((d): DraftCard => ({ ...d, exists: true }));
    const renamed = cellsToDrafts([], [columnNamed("Noche de Alabanza")], new Set(), created, []);
    expect(renamed[0].localId).toBe(first[0].localId);
    expect(renamed[0].creationRequestId).toBe(first[0].creationRequestId);
    expect(renamed[0].exists).toBe(true);
    expect(renamed[0].service_name).toBe("Noche de Alabanza");
  });

  it("an existing SAME-named special on the date collides; a differently-named one does not", () => {
    const stored = [{ _type: "special_role", date: "2026-02-11", service_name: "Vigilia" }];

    const same = cellsToDrafts([], [columnNamed("Vigilia")], new Set(), [], stored);
    expect(same[0].exists).toBe(true);
    expect(same[0].skipped).toBe(true);

    const different = cellsToDrafts([], [columnNamed("Noche de Alabanza")], new Set(), [], stored);
    expect(different[0].exists).toBe(false);
    expect(different[0].skipped).toBe(false);
  });

  it("two names differing only in CASE do NOT collide — the server's identity is case-sensitive", () => {
    // `normalizeLabel`'s own contract: "Case and accents are meaningful."
    // A `.toLowerCase()` here would claim a collision the server does not see,
    // and the two definitions would silently diverge.
    const stored = [{ _type: "special_role", date: "2026-02-11", service_name: "Vigilia" }];
    const lower = cellsToDrafts([], [columnNamed("vigilia")], new Set(), [], stored);
    expect(lower[0].exists).toBe(false);
    expect(lower[0].skipped).toBe(false);
  });

  it("two names differing only in accents do NOT collide either", () => {
    const stored = [{ _type: "special_role", date: "2026-02-11", service_name: "Oración" }];
    const unaccented = cellsToDrafts([], [columnNamed("Oracion")], new Set(), [], stored);
    expect(unaccented[0].exists).toBe(false);
  });

  it("names differing ONLY in whitespace DO collide — NFC + trim + collapse, exactly as the server normalizes", () => {
    const stored = [{ _type: "special_role", date: "2026-02-11", service_name: "  Vigilia   de  Oración " }];
    const collapsed = cellsToDrafts([], [columnNamed("Vigilia de Oración")], new Set(), [], stored);
    expect(collapsed[0].exists).toBe(true);
  });

  it("a stored special does NOT mark a weekend column on the same date as existing, and vice versa", () => {
    const storedSpecial = [{ _type: "special_role", date: "2026-02-01", service_name: "Vigilia" }];
    const sunday = cellsToDrafts([], [{ date: "2026-02-01", type: "sunday_role" }], new Set(), [], storedSpecial);
    expect(sunday[0].exists).toBe(false);

    const storedSunday = [{ _type: "sunday_role", date: "2026-02-01" }];
    const special = cellsToDrafts(
      [],
      [{ date: "2026-02-01", type: "special_role", serviceName: "Vigilia" }],
      new Set(),
      [],
      storedSunday,
    );
    expect(special[0].exists).toBe(false);
  });

  it("a weekend collision key still ignores a stray service_name — a weekend role stores none", () => {
    const stored = [{ _type: "sunday_role", date: "2026-02-01", service_name: "ruido" }];
    const drafts = cellsToDrafts([], [{ date: "2026-02-01", type: "sunday_role" }], new Set(), [], stored);
    expect(drafts[0].exists).toBe(true);
  });

  it("`exists` SURVIVES a rename and `isExisting` does not — they answer different questions", () => {
    // The trap Task 6's create-gate must not walk into. After a rename,
    // `exists` still says "this column once matched a document" while
    // `isExisting` correctly says "nothing with THIS name is stored". A gate
    // that read `exists` here would refuse a legitimately-new special;
    // `PlannerGrid`'s "ya existe" reason must read `isExisting` for the same
    // reason, or it would tell the admin a document exists that does not.
    const stored = [{ _type: "special_role", date: "2026-02-11", service_name: "Vigilia" }];
    const first = cellsToDrafts([], [columnNamed("Vigilia")], new Set(), [], stored);
    expect(first[0].exists).toBe(true);
    expect(first[0].isExisting).toBe(true);

    const renamed = cellsToDrafts([], [columnNamed("Bautizos")], new Set(), first, stored);
    expect(renamed[0].exists).toBe(true); // memory of the collision
    expect(renamed[0].isExisting).toBe(false); // no document holds THIS name
    expect(renamed[0].skipped).toBe(false); // so it is postable again
  });
});

describe("namelessSpecial — work item 9's client-side refusal", () => {
  const special = (service_name?: string): Pick<DraftCard, "_type" | "service_name"> => ({
    _type: "special_role",
    service_name,
  });

  it("a special with no name at all is nameless", () => {
    expect(namelessSpecial(special(undefined))).toBe(true);
    expect(namelessSpecial(special(""))).toBe(true);
  });

  it("a whitespace-only name is nameless — normalized exactly as the server does", () => {
    // `canonicalizeCreatePayload` runs the same `normalizeLabel`, so these are
    // precisely the payloads that come back `400 invalid_request` with issue
    // "service_name". A bare `.trim()` here would agree on these two but could
    // drift from the server on anything the shared normalizer changes.
    expect(namelessSpecial(special("   "))).toBe(true);
    expect(namelessSpecial(special(" \t\n"))).toBe(true);
  });

  it("a real name is not nameless, even one that only normalization tidies", () => {
    expect(namelessSpecial(special("Vigilia"))).toBe(false);
    expect(namelessSpecial(special("  Vigilia   de  Oración "))).toBe(false);
  });

  it("a weekend draft is NEVER nameless — it stores no service_name to begin with", () => {
    expect(namelessSpecial({ _type: "sunday_role", service_name: undefined })).toBe(false);
    expect(namelessSpecial({ _type: "saturday_role", service_name: "   " })).toBe(false);
  });
});

describe("buildColumns dedupes by date, weekend-first (E3, work item 13)", () => {
  it("drops a special that collides with a Sunday, keeping the Sunday", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const cols = buildColumns({
      sundayDates: ["2026-02-08"],
      activeSatDates: [],
      specials: [{ date: "2026-02-08", name: "Vigilia" }],
    });
    expect(cols).toEqual([
      { columnId: createColumnId("sunday_role", "2026-02-08"), date: "2026-02-08", type: "sunday_role" },
    ]);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0][0]).toContain("2026-02-08");
    warn.mockRestore();
  });

  it("drops a special that collides with a Saturday, keeping the Saturday", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const cols = buildColumns({
      sundayDates: [],
      activeSatDates: ["2026-02-07"],
      specials: [{ date: "2026-02-07", name: "Vigilia" }],
    });
    expect(cols).toEqual([
      { columnId: createColumnId("saturday_role", "2026-02-07"), date: "2026-02-07", type: "saturday_role" },
    ]);
    warn.mockRestore();
  });

  it("keeps a special on a DESELECTED Saturday — the deselected date holds no weekend column to lose to", () => {
    const cols = buildColumns({
      sundayDates: ["2026-02-08"],
      activeSatDates: [],
      specials: [{ date: "2026-02-07", name: "Vigilia" }],
    });
    expect(cols).toEqual([
      { columnId: createColumnId("special_role", "2026-02-07"), date: "2026-02-07", type: "special_role", serviceName: "Vigilia" },
      { columnId: createColumnId("sunday_role", "2026-02-08"), date: "2026-02-08", type: "sunday_role" },
    ]);
  });

  it("drops the SECOND of two specials on one date — one column per date, of any kind", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const cols = buildColumns({
      sundayDates: [],
      activeSatDates: [],
      specials: [
        { date: "2026-02-11", name: "Vigilia" },
        { date: "2026-02-11", name: "Noche de Alabanza" },
      ],
    });
    expect(cols).toHaveLength(1);
    expect(cols[0].serviceName).toBe("Vigilia");
    expect(warn).toHaveBeenCalledTimes(1);
    warn.mockRestore();
  });

  it("threads each special's name onto its column, sorted into the weekend columns by date", () => {
    const cols = buildColumns({
      sundayDates: FEB_SUNDAYS,
      activeSatDates: ["2026-02-07"],
      specials: [{ date: "2026-02-11", name: "Vigilia" }],
    });
    expect(cols.map((c) => `${c.date}:${c.type}`)).toEqual([
      "2026-02-01:sunday_role",
      "2026-02-07:saturday_role",
      "2026-02-08:sunday_role",
      "2026-02-11:special_role",
      "2026-02-15:sunday_role",
      "2026-02-22:sunday_role",
    ]);
    expect(cols.find((c) => c.type === "special_role")!.serviceName).toBe("Vigilia");
  });

  it("omitting `specials` leaves the weekend-only output byte-for-byte what it was before the third input existed", () => {
    // A GOLDEN list, not a comparison of the same call to itself: `specials = []`
    // is the default, so comparing the two forms could only ever fail if the
    // default were deleted. February 2026, all four Saturdays selected — Feb 28
    // is a Saturday with no Sunday of its own in-month, and still gets a column.
    expect(buildColumns({ sundayDates: FEB_SUNDAYS, activeSatDates: FEB_SATURDAYS })).toEqual([
      { columnId: createColumnId("sunday_role", "2026-02-01"), date: "2026-02-01", type: "sunday_role" },
      { columnId: createColumnId("saturday_role", "2026-02-07"), date: "2026-02-07", type: "saturday_role" },
      { columnId: createColumnId("sunday_role", "2026-02-08"), date: "2026-02-08", type: "sunday_role" },
      { columnId: createColumnId("saturday_role", "2026-02-14"), date: "2026-02-14", type: "saturday_role" },
      { columnId: createColumnId("sunday_role", "2026-02-15"), date: "2026-02-15", type: "sunday_role" },
      { columnId: createColumnId("saturday_role", "2026-02-21"), date: "2026-02-21", type: "saturday_role" },
      { columnId: createColumnId("sunday_role", "2026-02-22"), date: "2026-02-22", type: "sunday_role" },
      { columnId: createColumnId("saturday_role", "2026-02-28"), date: "2026-02-28", type: "saturday_role" },
    ]);
  });
});

describe("cellsToParticipantRoles agrees with the write path about Coro", () => {
  const members: RankMember[] = [m("m1", "Frank"), m("m2", "Gaby")];
  const staleCoro: GridCell[] = [{ date: "2026-02-07", rowId: "coro", memberIds: ["m1"], origin: "manual" }];

  it("a stale Saturday `coro` cell no longer counts toward in-grid load — a LIVE change for Saturday, not only for specials", () => {
    // `cellsByDate` is keyed by date alone, so a `coro` cell can survive a
    // column-type switch. The write path has always zeroed it (`chorus: []`);
    // this call used to forward it unguarded, so the ranker counted a seat that
    // would never exist.
    const [role] = cellsToParticipantRoles(
      staleCoro,
      [{ date: "2026-02-07", type: "saturday_role" }],
      members,
    );
    expect(role.chorus).toEqual([]);
    const [written] = cellsToDrafts(staleCoro, [{ date: "2026-02-07", type: "saturday_role" }], new Set(), [], []);
    expect(written.chorus).toEqual([]);
  });

  it("a special's Coro DOES count — it is a real seat there (E18)", () => {
    const cells: GridCell[] = [{ date: "2026-02-11", rowId: "coro", memberIds: ["m1"], origin: "manual" }];
    const [role] = cellsToParticipantRoles(
      cells,
      [{ date: "2026-02-11", type: "special_role", serviceName: "Vigilia" }],
      members,
    );
    expect(role.chorus.map((p) => p._id)).toEqual(["m1"]);
    expect(role._type).toBe("special_role");
  });

  it("a Sunday's Coro is untouched by the alignment", () => {
    const cells: GridCell[] = [{ date: "2026-02-01", rowId: "coro", memberIds: ["m1", "m2"], origin: "manual" }];
    const [role] = cellsToParticipantRoles(cells, [{ date: "2026-02-01", type: "sunday_role" }], members);
    expect(role.chorus.map((p) => p._id)).toEqual(["m1", "m2"]);
  });
});
