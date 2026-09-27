// scripts/__tests__/solverHistoryDiff.test.ts
//
// R11's classifier (spec `docs/superpowers/specs/2026-09-23-solver-history-derivation-design.md`,
// plan step 6): one fixture per arm, the precedence between rules and arms, per-cell
// attribution, month keys compared as numbers, the session gap and the latest-session rule.
//
// Every name here is fake. The repository is public.

import { describe, expect, it } from "vitest";

import type { SolverHistoryEntry, SolverHistoryTarget } from "@/app/utils/solverHistory";
import type { SolverHistoryResult } from "@/app/utils/solverHistoryTypes";

import {
  CLASS_VERDICT,
  EXPORT_CAPACITY,
  SESSION_GAP_MINUTES,
  classifyHistoryDiff,
  mergeBundles,
  neededTargets,
  parseBundle,
  parseDerivedResult,
  parseExport,
  type DiffCell,
  type HistoryDiffResult,
} from "../lib/solverHistoryDiff";
import {
  ANA,
  BETO,
  CARO,
  DANI,
  NOV,
  derivedFor,
  doc,
  entry,
  found,
  oow,
  type DocInput,
} from "./__fixtures__/solverHistoryDiffFixtures";

function classify(input: {
  target?: SolverHistoryTarget;
  primary: SolverHistoryEntry[];
  others?: SolverHistoryEntry[][];
  derived: SolverHistoryResult;
  sessionGapMinutes?: number;
}): HistoryDiffResult {
  return classifyHistoryDiff({
    target: input.target ?? NOV,
    primary: input.primary,
    others: input.others ?? [],
    derived: input.derived,
    sessionGapMinutes: input.sessionGapMinutes ?? SESSION_GAP_MINUTES,
  });
}

function cell(result: HistoryDiffResult, monthKey: string, member: string, roleKey: string): DiffCell {
  const matches = result.cells.filter((c) => c.month.key === monthKey && c.member === member && c.roleKey === roleKey);
  expect(matches, `exactly one cell ${monthKey} × ${member} × ${roleKey}`).toHaveLength(1);
  return matches[0];
}

function brief(c: DiffCell) {
  return { delta: c.delta, verdict: c.verdict, class: c.class };
}

// A plain unchanged, stamped Sunday on 4 October that the export also counted.
const BASE_OCT = doc({ roleId: "sun-1004", day: "2026-10-04", contributes: { [BETO]: { "Sun.BGV": 1 } } });

// ─── The constants the plan pins ─────────────────────────────────────────────

describe("pinned constants", () => {
  it("pins the session gap (D8) and the browser's history capacity", () => {
    expect(SESSION_GAP_MINUTES).toBe(60);
    expect(EXPORT_CAPACITY).toBe(6);
  });

  it("maps every class to exactly the verdict R11 gives it", () => {
    expect(CLASS_VERDICT).toEqual({
      duplicate_target: "bug",
      future: "explained",
      outside_window: "explained",
      evicted_or_deleted: "unverified",
      another_profile: "explained",
      deleted_by_hand_or_never_written: "unverified",
      raw_response_entry: "explained",
      rename_or_unknown_id: "explained",
      created_outside_create_mode_no_receipt: "explained",
      created_outside_create_mode_empty_seat: "explained",
      partial_month_overwrite: "explained",
      partial_month_overwrite_unverified: "unverified",
      changed_since_creation: "unverified",
      deleted_since_creation: "unverified",
      moved_out_of_month: "unverified",
      residual: "bug",
    });
  });
});

// ─── The domain ──────────────────────────────────────────────────────────────

describe("the domain", () => {
  it("finds no difference when the export counted exactly what is stored", () => {
    const result = classify({ primary: [entry(2026, 10, { [BETO]: { "Sun.BGV": 1 } })], derived: derivedFor(NOV, [BASE_OCT]) });
    expect(result.cells).toEqual([]);
    expect(result.blockers).toEqual([]);
  });

  it("a missing month with no derived documents produces no difference (absent equals empty)", () => {
    // August and September: no documents, and the export holds neither month.
    const result = classify({ primary: [entry(2026, 10, { [BETO]: { "Sun.BGV": 1 } })], derived: derivedFor(NOV, [BASE_OCT]) });
    expect(result.cells.filter((c) => c.month.key !== "2026-10")).toEqual([]);
    // An empty store (the export is `null`) against an empty window: nothing at all.
    expect(classify({ primary: parseExport("null"), derived: derivedFor(NOV, []) }).cells).toEqual([]);
    // An export entry with empty maps against a month with no documents: nothing either.
    expect(classify({ primary: [entry(2026, 9, {})], derived: derivedFor(NOV, []) }).cells).toEqual([]);
  });

  it("compares month keys as (year, month) numbers: 2026-10 is AFTER a 2026-9 target", () => {
    // Target September 2026 → window June, July, August. As strings, "2026-10" < "2026-9",
    // which would file October as a past month outside the window.
    const SEP = { year: 2026, month: 9 };
    const result = classify({
      target: SEP,
      primary: [entry(2026, 10, { [ANA]: { "Sun.Lead": 1 } }), entry(2026, 9, { [BETO]: { "Sun.BGV": 1 } })],
      derived: derivedFor(SEP, []),
    });
    expect(brief(cell(result, "2026-10", ANA, "Sun.Lead"))).toEqual({ delta: -1, verdict: "explained", class: "future" });
    expect(brief(cell(result, "2026-9", BETO, "Sun.BGV"))).toEqual({ delta: -1, verdict: "explained", class: "future" });
  });

  it("an export whose total disagrees with its own role counts is a difference no rule admits", () => {
    const result = classify({
      primary: [entry(2026, 10, { [BETO]: { "Sun.BGV": 1 } }, { [BETO]: 3 })],
      derived: derivedFor(NOV, [BASE_OCT]),
    });
    expect(result.cells).toHaveLength(1);
    expect(brief(cell(result, "2026-10", BETO, "total_counts"))).toEqual({ delta: -2, verdict: "bug", class: "residual" });
  });

  it("sorts cells by month, then member, then role key, whatever the input order", () => {
    const docs = [
      doc({ roleId: "u-2", day: "2026-10-11", receipt: { status: "unstamped" }, contributes: { [CARO]: { "Sun.Lead": 1 } } }),
      doc({ roleId: "u-1", day: "2026-09-06", receipt: { status: "unstamped" }, contributes: { [ANA]: { "Sun.Choir": 1, "Sun.BGV": 1 } } }),
    ];
    const primary = [entry(2026, 10, {}), entry(2026, 9, {})];
    const a = classify({ primary, derived: derivedFor(NOV, docs) });
    const b = classify({ primary: [...primary].reverse(), derived: derivedFor(NOV, [...docs].reverse()) });
    expect(a.cells.map((c) => `${c.month.key} ${c.member} ${c.roleKey}`)).toEqual([
      `2026-9 ${ANA} Sun.BGV`,
      `2026-9 ${ANA} Sun.Choir`,
      `2026-10 ${CARO} Sun.Lead`,
    ]);
    expect(JSON.stringify(b)).toBe(JSON.stringify(a));
  });
});

// ─── Rule 1 ──────────────────────────────────────────────────────────────────

describe("rule 1 — a duplicate weekend target", () => {
  const dupA = doc({ roleId: "dup-a", day: "2026-10-18", excluded: "duplicate_target", contributes: {} });
  const dupB = doc({ roleId: "dup-b", day: "2026-10-18", excluded: "duplicate_target", contributes: {} });
  const DUP = [{ type: "sunday_role" as const, day: "2026-10-18", roleIds: ["dup-a", "dup-b"] }];

  it("blocks by itself, even with no differing cell", () => {
    const result = classify({
      primary: [entry(2026, 10, { [BETO]: { "Sun.BGV": 1 } })],
      derived: derivedFor(NOV, [BASE_OCT, dupA, dupB], [], DUP),
    });
    expect(result.cells).toEqual([]);
    expect(result.blockers).toEqual([
      { verdict: "bug", class: "duplicate_target", type: "sunday_role", day: "2026-10-18", roleIds: ["dup-a", "dup-b"] },
    ]);
  });

  it("makes every differing cell of its month a bug — before any later rule could explain it", () => {
    const unstamped = doc({ roleId: "u-1", day: "2026-10-11", receipt: { status: "unstamped" }, contributes: { [ANA]: { "Sun.Lead": 1 } } });
    const septUnstamped = doc({ roleId: "u-2", day: "2026-09-13", receipt: { status: "unstamped" }, contributes: { [CARO]: { "Sun.Lead": 1 } } });
    const result = classify({
      primary: [entry(2026, 10, { [BETO]: { "Sun.BGV": 1 }, [DANI]: { "Sun.Lead": 1 } }), entry(2026, 9, {})],
      derived: derivedFor(NOV, [BASE_OCT, dupA, dupB, unstamped, septUnstamped], [], DUP),
    });
    // 4a would explain Ana's cell; rule 1 comes first.
    expect(brief(cell(result, "2026-10", ANA, "Sun.Lead"))).toEqual({ delta: 1, verdict: "bug", class: "duplicate_target" });
    expect(brief(cell(result, "2026-10", DANI, "Sun.Lead"))).toEqual({ delta: -1, verdict: "bug", class: "duplicate_target" });
    // Another month of the same window is unaffected.
    expect(brief(cell(result, "2026-9", CARO, "Sun.Lead"))).toEqual({
      delta: 1,
      verdict: "explained",
      class: "created_outside_create_mode_no_receipt",
    });
  });
});

// ─── Rule 2 ──────────────────────────────────────────────────────────────────

describe("rule 2 — the month is on one side only", () => {
  const octUnstamped = doc({ roleId: "u-oct", day: "2026-10-11", receipt: { status: "unstamped" }, contributes: { [ANA]: { "Sun.Lead": 1 } } });

  it("2a: an export month equal to or after the target is future, explained", () => {
    const result = classify({
      primary: [entry(2026, 11, { [BETO]: { "Sun.BGV": 1 } }), entry(2026, 12, { [CARO]: { "Sat.Lead": 1 } })],
      derived: derivedFor(NOV, []),
    });
    expect(brief(cell(result, "2026-11", BETO, "Sun.BGV"))).toEqual({ delta: -1, verdict: "explained", class: "future" });
    expect(brief(cell(result, "2026-12", CARO, "Sat.Lead"))).toEqual({ delta: -1, verdict: "explained", class: "future" });
  });

  it("2b: an export month before the window is outside the window, explained", () => {
    const result = classify({ primary: [entry(2026, 7, { [ANA]: { "Sun.Lead": 2 } })], derived: derivedFor(NOV, []) });
    expect(brief(cell(result, "2026-7", ANA, "Sun.Lead"))).toEqual({ delta: -2, verdict: "explained", class: "outside_window" });
  });

  it("2c: an in-window month absent from a SIX-entry export is evicted or deleted, unverified", () => {
    const six = [3, 4, 5, 6, 7, 9].map((m) => entry(2026, m, {}));
    const result = classify({ primary: six, derived: derivedFor(NOV, [octUnstamped]) });
    expect(brief(cell(result, "2026-10", ANA, "Sun.Lead"))).toEqual({ delta: 1, verdict: "unverified", class: "evicted_or_deleted" });
  });

  it("2c comes before 2d: another export holding the month does not rescue a full one (the spec's arm order)", () => {
    const six = [3, 4, 5, 6, 7, 9].map((m) => entry(2026, m, {}));
    const result = classify({
      primary: six,
      others: [[entry(2026, 10, { [ANA]: { "Sun.Lead": 1 } })]],
      derived: derivedFor(NOV, [octUnstamped]),
    });
    expect(cell(result, "2026-10", ANA, "Sun.Lead").class).toBe("evicted_or_deleted");
  });

  it("2c counts six OR MORE entries as full: \"a full export cannot tell eviction from a chip removal\"", () => {
    const seven = [2, 3, 4, 5, 6, 7, 9].map((m) => entry(2026, m, {}));
    expect(cell(classify({ primary: seven, derived: derivedFor(NOV, [octUnstamped]) }), "2026-10", ANA, "Sun.Lead").class).toBe(
      "evicted_or_deleted",
    );
  });

  it("2d: an in-window month present in another export is another browser or profile, explained", () => {
    const result = classify({
      primary: [entry(2026, 9, {})],
      others: [[entry(2026, 10, { [ANA]: { "Sun.Lead": 1 } })]],
      derived: derivedFor(NOV, [octUnstamped]),
    });
    expect(brief(cell(result, "2026-10", ANA, "Sun.Lead"))).toEqual({ delta: 1, verdict: "explained", class: "another_profile" });
  });

  it("2e: an in-window month absent from a short export while the derived side has documents, unverified", () => {
    const result = classify({ primary: [entry(2026, 9, {})], derived: derivedFor(NOV, [octUnstamped]) });
    expect(brief(cell(result, "2026-10", ANA, "Sun.Lead"))).toEqual({
      delta: 1,
      verdict: "unverified",
      class: "deleted_by_hand_or_never_written",
    });
  });

  it("an empty store (a null export) is a short export: its window months fall to 2e", () => {
    const result = classify({ primary: parseExport(null), derived: derivedFor(NOV, [octUnstamped]) });
    expect(cell(result, "2026-10", ANA, "Sun.Lead").class).toBe("deleted_by_hand_or_never_written");
  });
});

// ─── Rule 3 ──────────────────────────────────────────────────────────────────

describe("rule 3 — the export's entry for the month", () => {
  it("3a: zero-count rows explain every cell of the month — even one a changed document would make unverified", () => {
    const changed = doc({ roleId: "sun-1011", day: "2026-10-11", unchangedAs: null, contributes: { [CARO]: { "Sun.BGV": 1 } } });
    const result = classify({
      primary: [entry(2026, 10, { [ANA]: { "Sun.Lead": 1, "Sun.BGV": 0 }, [BETO]: { "Sun.BGV": 2 } })],
      derived: derivedFor(NOV, [doc({ roleId: "sun-1004", day: "2026-10-04", contributes: { [ANA]: { "Sun.Lead": 1 } } }), changed]),
    });
    expect(brief(cell(result, "2026-10", CARO, "Sun.BGV"))).toEqual({ delta: 1, verdict: "explained", class: "raw_response_entry" });
    expect(brief(cell(result, "2026-10", BETO, "Sun.BGV"))).toEqual({ delta: -2, verdict: "explained", class: "raw_response_entry" });
    expect(result.cells).toHaveLength(2);
  });

  it("3b rename: a name no current member carries maps to the ONE current name carrying exactly its counts", () => {
    const result = classify({
      primary: [entry(2026, 10, { "Ana Vieja": { "Sun.Lead": 1 } })],
      derived: derivedFor(NOV, [doc({ roleId: "sun-1004", day: "2026-10-04", contributes: { [ANA]: { "Sun.Lead": 1 } } })]),
    });
    expect(result.renames).toEqual([{ month: "2026-10", exportKey: "Ana Vieja", name: ANA, arm: "rename" }]);
    // The export's own key is the difference, explained; the comparison under the current name then agrees.
    expect(result.cells).toHaveLength(1);
    const c = cell(result, "2026-10", "Ana Vieja", "Sun.Lead");
    expect(brief(c)).toEqual({ delta: -1, verdict: "explained", class: "rename_or_unknown_id" });
    expect(c.mappedTo).toBe(ANA);
  });

  it("3b raw id: a key that is a current member's _id maps to that member; what still differs goes on to rule 4", () => {
    // The only document is unchanged and recorded in the export's one session, so the
    // remaining difference under the current name is admitted by no rule.
    const result = classify({
      primary: [entry(2026, 10, { "m-beto": { "Sun.BGV": 2 } })],
      derived: derivedFor(NOV, [BASE_OCT]),
    });
    expect(result.renames).toEqual([{ month: "2026-10", exportKey: "m-beto", name: BETO, arm: "raw_id" }]);
    expect(brief(cell(result, "2026-10", "m-beto", "Sun.BGV"))).toEqual({ delta: -2, verdict: "explained", class: "rename_or_unknown_id" });
    expect(brief(cell(result, "2026-10", BETO, "Sun.BGV"))).toEqual({ delta: -1, verdict: "bug", class: "residual" });
  });

  it("3b does not map when two current names carry exactly the counts — the label alone admits nothing", () => {
    const docs = [
      doc({ roleId: "sun-1004", day: "2026-10-04", contributes: { [ANA]: { "Sun.Lead": 1 } } }),
      doc({ roleId: "sun-1011", day: "2026-10-11", contributes: { [CARO]: { "Sun.Lead": 1 } } }),
    ];
    const result = classify({ primary: [entry(2026, 10, { "Ana Vieja": { "Sun.Lead": 1 } })], derived: derivedFor(NOV, docs) });
    expect(result.renames).toEqual([]);
    expect(cell(result, "2026-10", "Ana Vieja", "Sun.Lead").verdict).toBe("bug");
    expect(cell(result, "2026-10", ANA, "Sun.Lead").verdict).toBe("bug");
    expect(cell(result, "2026-10", CARO, "Sun.Lead").verdict).toBe("bug");
  });

  it("3b does not map when the counts differ", () => {
    const result = classify({
      primary: [entry(2026, 10, { "Ana Vieja": { "Sun.Lead": 2 } })],
      derived: derivedFor(NOV, [doc({ roleId: "sun-1004", day: "2026-10-04", contributes: { [ANA]: { "Sun.Lead": 1 } } })]),
    });
    expect(result.renames).toEqual([]);
    expect(brief(cell(result, "2026-10", "Ana Vieja", "Sun.Lead"))).toEqual({ delta: -2, verdict: "bug", class: "residual" });
  });

  it("3b does not map an id no current member carries unless a name carries exactly its counts", () => {
    // A deleted member's raw id: the derivation dropped the dangling seat, and no name carries it.
    const result = classify({
      primary: [entry(2026, 10, { "m-borrado": { "Sun.BGV": 1 } })],
      derived: derivedFor(NOV, [doc({ roleId: "sun-1004", day: "2026-10-04", contributes: { [ANA]: { "Sun.Lead": 1 } } })]),
    });
    expect(result.renames).toEqual([]);
    expect(brief(cell(result, "2026-10", "m-borrado", "Sun.BGV"))).toEqual({ delta: -1, verdict: "bug", class: "residual" });
  });

  it("3b does not map onto a current name the export already holds", () => {
    // Ana's derived counts equal "Ana Vieja"'s, but the export also counts Ana under her own
    // name: a rename moves everything, so this is not one.
    const result = classify({
      primary: [entry(2026, 10, { "Ana Vieja": { "Sun.Lead": 1 }, [ANA]: { "Sun.BGV": 1 } })],
      derived: derivedFor(NOV, [doc({ roleId: "sun-1004", day: "2026-10-04", contributes: { [ANA]: { "Sun.Lead": 1 } } })]),
    });
    expect(result.renames).toEqual([]);
    expect(cell(result, "2026-10", "Ana Vieja", "Sun.Lead").verdict).toBe("bug");
  });
});

// ─── Rule 4 ──────────────────────────────────────────────────────────────────

describe("rule 4a — created outside create mode", () => {
  it("no receipt: an unstamped document explains the seats it contributes, on its own line", () => {
    const result = classify({
      primary: [entry(2026, 10, { [BETO]: { "Sun.BGV": 1 } })],
      derived: derivedFor(NOV, [
        BASE_OCT,
        doc({ roleId: "u-1", day: "2026-10-11", receipt: { status: "unstamped" }, contributes: { [ANA]: { "Sun.Lead": 1 } } }),
      ]),
    });
    expect(brief(cell(result, "2026-10", ANA, "Sun.Lead"))).toEqual({
      delta: 1,
      verdict: "explained",
      class: "created_outside_create_mode_no_receipt",
    });
    expect(result.totals.byClass.created_outside_create_mode_no_receipt).toEqual({ cells: 1, units: 1 });
  });

  it("a stamped document whose receipt is missing is NOT the no-receipt arm (and, unverifiable, is a bug)", () => {
    for (const unchangedAs of ["published", null] as const) {
      const result = classify({
        primary: [entry(2026, 10, { [BETO]: { "Sun.BGV": 1 } })],
        derived: derivedFor(NOV, [
          BASE_OCT,
          doc({
            roleId: "s-1",
            day: "2026-10-11",
            receipt: { status: "not_found", receiptId: "rc-missing" },
            unchangedAs,
            contributes: { [ANA]: { "Sun.Lead": 1 } },
          }),
        ]),
      });
      expect(brief(cell(result, "2026-10", ANA, "Sun.Lead"))).toEqual({ delta: 1, verdict: "bug", class: "residual" });
    }
  });

  it("empty seat: a document created by «+ Nuevo servicio» explains what was filled in later", () => {
    const result = classify({
      primary: [entry(2026, 10, { [BETO]: { "Sun.BGV": 1 } })],
      derived: derivedFor(NOV, [
        BASE_OCT,
        doc({
          roleId: "e-1",
          day: "2026-10-11",
          emptySeatCreate: true,
          unchangedAs: null,
          createdAt: "2026-09-30T10:00:00.000Z",
          contributes: { [ANA]: { "Sun.Lead": 1 } },
        }),
      ]),
    });
    expect(brief(cell(result, "2026-10", ANA, "Sun.Lead"))).toEqual({
      delta: 1,
      verdict: "explained",
      class: "created_outside_create_mode_empty_seat",
    });
    // Empty-seat creates are left out of the sessions: the only session is BASE_OCT's.
    const october = result.sessions.find((s) => s.month === "2026-10")!;
    expect(october.groups.map((g) => g.receipts.map((r) => r.roleId))).toEqual([["sun-1004"]]);
  });
});

describe("rule 4b — the partial-month overwrite and its sessions", () => {
  // Session 1: 4 October. Session 2 (later): 11 and 18 October. The export is session 2.
  const d1 = (createdAt = "2026-09-20T08:00:00.000Z") =>
    doc({ roleId: "sun-1004", day: "2026-10-04", createdAt, contributes: { [ANA]: { "Sun.Lead": 1 } } });
  const d2 = doc({ roleId: "sun-1011", day: "2026-10-11", createdAt: "2026-09-20T09:01:00.000Z", contributes: { [BETO]: { "Sun.BGV": 1 } } });
  const d3 = (over: Partial<DocInput> = {}) =>
    doc({ roleId: "sun-1018", day: "2026-10-18", createdAt: "2026-09-20T09:30:00.000Z", contributes: { [CARO]: { "Sun.Choir": 1 } }, ...over });
  const latestExport = entry(2026, 10, { [BETO]: { "Sun.BGV": 1 }, [CARO]: { "Sun.Choir": 1 } });

  it("explains an earlier-session document when the export equals the unchanged latest session exactly", () => {
    const result = classify({ primary: [latestExport], derived: derivedFor(NOV, [d1(), d2, d3()]) });
    expect(brief(cell(result, "2026-10", ANA, "Sun.Lead"))).toEqual({ delta: 1, verdict: "explained", class: "partial_month_overwrite" });
    const october = result.sessions.find((s) => s.month === "2026-10")!;
    expect(october.groups.map((g) => g.receipts.map((r) => r.roleId))).toEqual([["sun-1004"], ["sun-1011", "sun-1018"]]);
    expect(october.latest).toBe("explained");
  });

  it("the session gap: 60 minutes stays one session, 61 splits it", () => {
    // d2 is created at 09:01. A d1 at 08:01 is exactly 60 minutes earlier: one session,
    // so d1 is IN the latest session, the export is not that session, and nothing admits it.
    const sixty = classify({ primary: [latestExport], derived: derivedFor(NOV, [d1("2026-09-20T08:01:00.000Z"), d2, d3()]) });
    expect(sixty.sessions.find((s) => s.month === "2026-10")!.groups).toHaveLength(1);
    expect(brief(cell(sixty, "2026-10", ANA, "Sun.Lead"))).toEqual({ delta: 1, verdict: "bug", class: "residual" });
    // At 08:00, 61 minutes: two sessions, and the overwrite is explained.
    const sixtyOne = classify({ primary: [latestExport], derived: derivedFor(NOV, [d1("2026-09-20T08:00:00.000Z"), d2, d3()]) });
    expect(sixtyOne.sessions.find((s) => s.month === "2026-10")!.groups).toHaveLength(2);
    expect(cell(sixtyOne, "2026-10", ANA, "Sun.Lead").class).toBe("partial_month_overwrite");
  });

  it("a changed latest-session document turns the earlier-session documents unverified", () => {
    // d3 has since been swapped: Dani now sits where Caro was created.
    const result = classify({
      primary: [latestExport],
      derived: derivedFor(NOV, [d1(), d2, d3({ unchangedAs: null, contributes: { [DANI]: { "Sun.Choir": 1 } } })]),
    });
    expect(brief(cell(result, "2026-10", ANA, "Sun.Lead"))).toEqual({
      delta: 1,
      verdict: "unverified",
      class: "partial_month_overwrite_unverified",
    });
    expect(result.sessions.find((s) => s.month === "2026-10")!.latest).toBe("unverified");
    // d3 itself is in the latest session: it is simply changed.
    expect(brief(cell(result, "2026-10", DANI, "Sun.Choir"))).toEqual({ delta: 1, verdict: "unverified", class: "changed_since_creation" });
    expect(brief(cell(result, "2026-10", CARO, "Sun.Choir"))).toEqual({ delta: -1, verdict: "unverified", class: "changed_since_creation" });
  });

  it("is not admitted when the export does not equal the latest session, even though every document is unchanged", () => {
    const result = classify({ primary: [entry(2026, 10, { [BETO]: { "Sun.BGV": 1 } })], derived: derivedFor(NOV, [d1(), d2, d3()]) });
    expect(result.sessions.find((s) => s.month === "2026-10")!.latest).toBe("not_admitted");
    expect(cell(result, "2026-10", ANA, "Sun.Lead").verdict).toBe("bug");
    expect(cell(result, "2026-10", CARO, "Sun.Choir").verdict).toBe("bug");
  });

  it("a DELETED latest-session document is not a changed one: the earlier session is admitted by nothing", () => {
    // In R11's vocabulary "changed" is a fingerprint mismatch (4c); deletion is its own arm (4d).
    const deleted = oow({
      receiptId: "rc-gone",
      targetDay: "2026-10-25",
      createdAt: "2026-09-20T09:45:00.000Z",
      state: "role_deleted",
      roleFound: false,
    });
    const result = classify({
      primary: [entry(2026, 10, { [BETO]: { "Sun.BGV": 1 }, [CARO]: { "Sun.Choir": 1 }, [DANI]: { "Sun.Lead": 1 } })],
      derived: derivedFor(NOV, [d1(), d2, d3()], [deleted]),
    });
    expect(result.sessions.find((s) => s.month === "2026-10")!.latest).toBe("not_admitted");
    expect(brief(cell(result, "2026-10", ANA, "Sun.Lead"))).toEqual({ delta: 1, verdict: "bug", class: "residual" });
    expect(brief(cell(result, "2026-10", DANI, "Sun.Lead"))).toEqual({ delta: -1, verdict: "unverified", class: "deleted_since_creation" });
  });

  it("a receipt with no createdAt leaves the month's sessions undetermined, so 4b admits nothing there", () => {
    const result = classify({ primary: [latestExport], derived: derivedFor(NOV, [d1(), d2, d3({ createdAt: null, receipt: found("sun-1018", "2026-10-18", null) })]) });
    expect(result.sessions.find((s) => s.month === "2026-10")!.latest).toBe("undetermined");
    expect(cell(result, "2026-10", ANA, "Sun.Lead").verdict).toBe("bug");
  });

  it("a stamped document of the month whose receipt is missing leaves the sessions undetermined too", () => {
    // Its receipt could have been the latest one; without it the grouping cannot be trusted.
    const stray = doc({ roleId: "sun-1025", day: "2026-10-25", receipt: { status: "not_found", receiptId: "rc-lost" }, contributes: {} });
    const result = classify({ primary: [latestExport], derived: derivedFor(NOV, [d1(), d2, d3(), stray]) });
    expect(result.sessions.find((s) => s.month === "2026-10")!.latest).toBe("undetermined");
    expect(cell(result, "2026-10", ANA, "Sun.Lead").verdict).toBe("bug");
  });

  it("a latest-session document MOVED out of the window has changed (its date is hashed): earlier ones are unverified", () => {
    const movedOut = oow({
      receiptId: "rc-moved",
      targetDay: "2026-10-25",
      createdAt: "2026-09-20T09:45:00.000Z",
      roleFound: true,
      roleCurrentDay: "2026-12-06",
    });
    const result = classify({ primary: [latestExport], derived: derivedFor(NOV, [d1(), d2, d3()], [movedOut]) });
    expect(result.sessions.find((s) => s.month === "2026-10")!.latest).toBe("unverified");
    expect(cell(result, "2026-10", ANA, "Sun.Lead").class).toBe("partial_month_overwrite_unverified");
  });
});

describe("rule 4c–4e — changed, deleted, moved", () => {
  it("4c: a changed document explains what it contributes (derived higher), unverified", () => {
    const result = classify({
      primary: [entry(2026, 10, { [BETO]: { "Sun.BGV": 1 } })],
      derived: derivedFor(NOV, [BASE_OCT, doc({ roleId: "sun-1011", day: "2026-10-11", unchangedAs: null, contributes: { [ANA]: { "Sun.Lead": 1 } } })]),
    });
    expect(brief(cell(result, "2026-10", ANA, "Sun.Lead"))).toEqual({ delta: 1, verdict: "unverified", class: "changed_since_creation" });
  });

  it("per-cell attribution: a changed SATURDAY document cannot explain a Sun.* cell; a changed Sunday one can", () => {
    const exportOct = entry(2026, 10, { [BETO]: { "Sun.BGV": 1 }, [ANA]: { "Sun.Lead": 1 } });
    const sat = doc({ roleId: "sat-1003", type: "saturday_role", day: "2026-10-03", unchangedAs: null, contributes: {} });
    const saturdayOnly = classify({ primary: [exportOct], derived: derivedFor(NOV, [BASE_OCT, sat]) });
    expect(brief(cell(saturdayOnly, "2026-10", ANA, "Sun.Lead"))).toEqual({ delta: -1, verdict: "bug", class: "residual" });

    const sun = doc({ roleId: "sun-1011", day: "2026-10-11", unchangedAs: null, contributes: {} });
    const withSunday = classify({ primary: [exportOct], derived: derivedFor(NOV, [BASE_OCT, sat, sun]) });
    const c = cell(withSunday, "2026-10", ANA, "Sun.Lead");
    expect(brief(c)).toEqual({ delta: -1, verdict: "unverified", class: "changed_since_creation" });
    expect(c.parts[0].evidence).toEqual(["role:sun-1011"]);
  });

  it("per-cell attribution: a derived-higher cell is explained only by documents seating that member in that role", () => {
    // The unstamped document seats Ana as Lead; it cannot explain Caro's Lead.
    const result = classify({
      primary: [entry(2026, 10, { [BETO]: { "Sun.BGV": 1 } })],
      derived: derivedFor(NOV, [
        doc({ roleId: "sun-1004", day: "2026-10-04", contributes: { [BETO]: { "Sun.BGV": 1 }, [CARO]: { "Sun.Lead": 1 } } }),
        doc({ roleId: "u-1", day: "2026-10-11", receipt: { status: "unstamped" }, contributes: { [ANA]: { "Sun.Lead": 1 } } }),
      ]),
    });
    expect(cell(result, "2026-10", ANA, "Sun.Lead").class).toBe("created_outside_create_mode_no_receipt");
    expect(brief(cell(result, "2026-10", CARO, "Sun.Lead"))).toEqual({ delta: 1, verdict: "bug", class: "residual" });
  });

  it("flags an export-higher cell whose |Δ| exceeds the documents admitting it — no cap is invented", () => {
    const sun = doc({ roleId: "sun-1011", day: "2026-10-11", unchangedAs: null, contributes: {} });
    const many = classify({
      primary: [entry(2026, 10, { [BETO]: { "Sun.BGV": 1 }, [ANA]: { "Sun.Lead": 3 } })],
      derived: derivedFor(NOV, [BASE_OCT, sun]),
    });
    const c = cell(many, "2026-10", ANA, "Sun.Lead");
    expect(brief(c)).toEqual({ delta: -3, verdict: "unverified", class: "changed_since_creation" });
    expect(c.parts).toEqual([
      { class: "changed_since_creation", amount: 3, evidence: ["role:sun-1011", "⚠ |Δ| exceeds admitting documents"] },
    ]);
    // Two deletions admitting two seats: within the count, so no flag.
    const two = classify({
      primary: [entry(2026, 10, { [BETO]: { "Sun.BGV": 1 }, [ANA]: { "Sun.Lead": 2 } })],
      derived: derivedFor(NOV, [BASE_OCT], [
        oow({ receiptId: "rc-d1", targetDay: "2026-10-18", state: "role_deleted" }),
        oow({ receiptId: "rc-d2", targetDay: "2026-10-25", state: "role_deleted" }),
      ]),
    });
    expect(cell(two, "2026-10", ANA, "Sun.Lead").parts[0].evidence).toEqual(["receipt:rc-d1", "receipt:rc-d2"]);
  });

  it("4d: a role_deleted receipt of the matching type in the month explains an export-higher cell, unverified", () => {
    const exportOct = entry(2026, 10, { [BETO]: { "Sun.BGV": 1 }, [ANA]: { "Sun.Lead": 1 } });
    const deleted = oow({ receiptId: "rc-del", targetDay: "2026-10-25", state: "role_deleted", roleFound: false });
    const result = classify({ primary: [exportOct], derived: derivedFor(NOV, [BASE_OCT], [deleted]) });
    expect(brief(cell(result, "2026-10", ANA, "Sun.Lead"))).toEqual({ delta: -1, verdict: "unverified", class: "deleted_since_creation" });
    // A Saturday deletion does not explain a Sunday cell.
    const satDeleted = oow({ receiptId: "rc-del", type: "saturday_role", targetDay: "2026-10-24", state: "role_deleted", roleFound: false });
    expect(cell(classify({ primary: [exportOct], derived: derivedFor(NOV, [BASE_OCT], [satDeleted]) }), "2026-10", ANA, "Sun.Lead").class).toBe(
      "residual",
    );
  });

  it("4d reads the receipt's state: a committed receipt whose role is missing was deleted out of band, a bug", () => {
    const exportOct = entry(2026, 10, { [BETO]: { "Sun.BGV": 1 }, [ANA]: { "Sun.Lead": 1 } });
    const vanished = oow({ receiptId: "rc-x", targetDay: "2026-10-25", state: "committed", roleFound: false });
    const result = classify({ primary: [exportOct], derived: derivedFor(NOV, [BASE_OCT], [vanished]) });
    expect(brief(cell(result, "2026-10", ANA, "Sun.Lead"))).toEqual({ delta: -1, verdict: "bug", class: "residual" });
  });

  it("4e: a receipt in the month whose role now lives outside the window explains an export-higher cell, unverified", () => {
    const exportOct = entry(2026, 10, { [BETO]: { "Sun.BGV": 1 }, [ANA]: { "Sun.Lead": 1 } });
    const moved = oow({ receiptId: "rc-mv", targetDay: "2026-10-25", roleFound: true, roleCurrentDay: "2026-12-06" });
    const result = classify({ primary: [exportOct], derived: derivedFor(NOV, [BASE_OCT], [moved]) });
    expect(brief(cell(result, "2026-10", ANA, "Sun.Lead"))).toEqual({ delta: -1, verdict: "unverified", class: "moved_out_of_month" });
  });

  it("4c: a changed document MOVED INTO the month was not created there, so it cannot explain an export-higher cell", () => {
    const exportOct = entry(2026, 10, { [BETO]: { "Sun.BGV": 1 }, [ANA]: { "Sun.Lead": 1 } });
    const movedIn = doc({ roleId: "sun-in", day: "2026-10-11", receipt: found("sun-in", "2026-09-13"), unchangedAs: null, contributes: {} });
    const result = classify({ primary: [exportOct], derived: derivedFor(NOV, [BASE_OCT, movedIn]) });
    expect(brief(cell(result, "2026-10", ANA, "Sun.Lead"))).toEqual({ delta: -1, verdict: "bug", class: "residual" });
  });

  it("4e never counts a race artifact: an out-of-window receipt whose role's day is INSIDE the window", () => {
    const exportOct = entry(2026, 10, { [BETO]: { "Sun.BGV": 1 }, [ANA]: { "Sun.Lead": 1 } });
    const race = oow({ receiptId: "rc-race", targetDay: "2026-10-25", roleFound: true, roleCurrentDay: "2026-09-13" });
    const result = classify({ primary: [exportOct], derived: derivedFor(NOV, [BASE_OCT], [race]) });
    expect(brief(cell(result, "2026-10", ANA, "Sun.Lead"))).toEqual({ delta: -1, verdict: "bug", class: "residual" });
  });

  it("a document moved between window months: moved out of the first (4e), changed in the second (4c)", () => {
    const moved = doc({
      roleId: "sun-mv",
      day: "2026-10-11",
      receipt: found("sun-mv", "2026-09-13"),
      unchangedAs: null,
      contributes: { [CARO]: { "Sun.Lead": 1 } },
    });
    const result = classify({
      primary: [entry(2026, 9, { [CARO]: { "Sun.Lead": 1 } }), entry(2026, 10, { [BETO]: { "Sun.BGV": 1 } })],
      derived: derivedFor(NOV, [BASE_OCT, moved]),
    });
    expect(brief(cell(result, "2026-9", CARO, "Sun.Lead"))).toEqual({ delta: -1, verdict: "unverified", class: "moved_out_of_month" });
    expect(brief(cell(result, "2026-10", CARO, "Sun.Lead"))).toEqual({ delta: 1, verdict: "unverified", class: "changed_since_creation" });
    // Its receipt belongs to September's sessions, where it was created.
    expect(result.sessions.find((s) => s.month === "2026-9")!.groups.flatMap((g) => g.receipts.map((r) => r.roleId))).toEqual(["sun-mv"]);
  });
});

describe("precedence inside a cell", () => {
  const unstamped = doc({ roleId: "u-1", day: "2026-10-11", receipt: { status: "unstamped" }, contributes: { [ANA]: { "Sun.Lead": 1 } } });
  const changed = doc({ roleId: "sun-1018", day: "2026-10-18", unchangedAs: null, contributes: { [ANA]: { "Sun.Lead": 1 } } });

  it("a cell two arms could explain gets the first arm", () => {
    const result = classify({
      primary: [entry(2026, 10, { [BETO]: { "Sun.BGV": 1 }, [ANA]: { "Sun.Lead": 1 } })],
      derived: derivedFor(NOV, [BASE_OCT, changed, unstamped]),
    });
    const c = cell(result, "2026-10", ANA, "Sun.Lead");
    expect(brief(c)).toEqual({ delta: 1, verdict: "explained", class: "created_outside_create_mode_no_receipt" });
    expect(c.parts).toEqual([{ class: "created_outside_create_mode_no_receipt", amount: 1, evidence: ["role:u-1"] }]);
  });

  it("a cell split across arms takes the worst verdict, and keeps every part", () => {
    const result = classify({
      primary: [entry(2026, 10, { [BETO]: { "Sun.BGV": 1 } })],
      derived: derivedFor(NOV, [BASE_OCT, changed, unstamped]),
    });
    const c = cell(result, "2026-10", ANA, "Sun.Lead");
    expect(brief(c)).toEqual({ delta: 2, verdict: "unverified", class: "changed_since_creation" });
    expect(c.parts.map((p) => [p.class, p.amount])).toEqual([
      ["created_outside_create_mode_no_receipt", 1],
      ["changed_since_creation", 1],
    ]);
  });
});

// ─── Rule 5 ──────────────────────────────────────────────────────────────────

describe("rule 5 — the residual", () => {
  it("an unchanged document recorded in the export's own session that the export did not count is a bug", () => {
    const result = classify({
      primary: [entry(2026, 10, { [BETO]: { "Sun.BGV": 1 } })],
      derived: derivedFor(NOV, [doc({ roleId: "sun-1004", day: "2026-10-04", contributes: { [BETO]: { "Sun.BGV": 1 }, [ANA]: { "Sun.Lead": 1 } } })]),
    });
    const c = cell(result, "2026-10", ANA, "Sun.Lead");
    expect(brief(c)).toEqual({ delta: 1, verdict: "bug", class: "residual" });
    expect(c.parts).toEqual([{ class: "residual", amount: 1, evidence: ["unexplained by role:sun-1004"] }]);
  });

  it("a difference traced to a special's seats is a bug: no weekend document can carry it", () => {
    // The export counted Caro as a Sunday Lead from a special; the derivation never counts specials.
    const result = classify({
      primary: [entry(2026, 10, { [BETO]: { "Sun.BGV": 1 }, [CARO]: { "Sun.Lead": 1 } })],
      derived: derivedFor(NOV, [BASE_OCT]),
    });
    expect(brief(cell(result, "2026-10", CARO, "Sun.Lead"))).toEqual({ delta: -1, verdict: "bug", class: "residual" });
  });

});

// ─── Totals ──────────────────────────────────────────────────────────────────

describe("totals", () => {
  it("counts cells by verdict and by deciding class, units by every part, and blockers apart", () => {
    const changed = doc({ roleId: "sun-1018", day: "2026-10-18", unchangedAs: null, contributes: { [ANA]: { "Sun.Lead": 1 } } });
    const unstamped = doc({ roleId: "u-1", day: "2026-10-11", receipt: { status: "unstamped" }, contributes: { [ANA]: { "Sun.Lead": 1 } } });
    const result = classify({
      primary: [entry(2026, 10, { [BETO]: { "Sun.BGV": 1 }, [CARO]: { "Sat.Lead": 1 } }), entry(2026, 12, { [DANI]: { "Sat.BGV": 1 } })],
      derived: derivedFor(NOV, [BASE_OCT, changed, unstamped]),
    });
    expect(result.totals.cells).toEqual({ explained: 1, unverified: 1, bug: 1 });
    expect(result.totals.byClass).toEqual({
      future: { cells: 1, units: 1 },
      created_outside_create_mode_no_receipt: { cells: 0, units: 1 },
      changed_since_creation: { cells: 1, units: 1 },
      residual: { cells: 1, units: 1 },
    });
    expect(result.totals.blockers).toBe(0);
    expect(result.control).toEqual({ withReceipt: 2, unchanged: 1 });
  });

  it("states D7's mix: which publication value reproduced each unchanged document's stamp", () => {
    const result = classify({
      primary: [entry(2026, 10, { [BETO]: { "Sun.BGV": 1 } })],
      derived: derivedFor(NOV, [
        BASE_OCT,
        doc({ roleId: "sun-1011", day: "2026-10-11", unchangedAs: "draft" }),
        doc({ roleId: "sun-1018", day: "2026-10-18", unchangedAs: "draft" }),
        doc({ roleId: "sun-1025", day: "2026-10-25", unchangedAs: null }),
        // Unchanged only by its own stamp, its receipt missing: not in the control, not in the mix.
        doc({ roleId: "sat-1003", type: "saturday_role", day: "2026-10-03", receipt: { status: "not_found", receiptId: "rc-x" } }),
      ]),
    });
    expect(result.control).toEqual({ withReceipt: 4, unchanged: 3 });
    expect(result.unchangedMix).toEqual({ published: 1, draft: 2 });
  });
});

// ─── Parsing ─────────────────────────────────────────────────────────────────

describe("parseExport", () => {
  const good = [entry(2026, 9, { [ANA]: { "Sun.Lead": 1, "Sun.BGV": 0 } })];

  it("reads the stored string, a parsed array, a double-encoded string, and null as an empty store", () => {
    expect(parseExport(JSON.stringify(good))).toEqual(good);
    expect(parseExport(good)).toEqual(good);
    expect(parseExport(JSON.stringify(JSON.stringify(good)))).toEqual(good);
    expect(parseExport(null)).toEqual([]);
    expect(parseExport(" null \n")).toEqual([]);
    // Zeros are kept: they are rule 3a's signature.
    expect(parseExport(JSON.stringify(good))[0].role_counts[ANA]["Sun.BGV"]).toBe(0);
  });

  it("never echoes the export's text in an error — the JSON parser quotes it, and it can be a name", () => {
    for (const raw of [`[{"key":"2026-9", ${ANA}}]`, `[${ANA}]`, JSON.stringify(`[${ANA}]`)]) {
      expect(() => parseExport(raw, "export-x.json")).toThrow(/export-x\.json: not JSON/);
      let message = "";
      try {
        parseExport(raw, "export-x.json");
      } catch (e) {
        message = e instanceof Error ? e.message : String(e);
      }
      expect(message).not.toContain("Ana");
    }
  });

  it("never echoes an entry's field values either: a malformed key or year could be a name", () => {
    const base = { key: "2026-9", year: 2026, month: 9, total_counts: {}, role_counts: {} };
    for (const bad of [{ ...base, key: ANA }, { ...base, year: ANA }, { ...base, month: ANA }]) {
      let message = "";
      try {
        parseExport(JSON.stringify([bad]), "export-x.json");
      } catch (e) {
        message = e instanceof Error ? e.message : String(e);
      }
      expect(message).toMatch(/export-x\.json\[0\]/);
      expect(message).not.toContain("Ana");
    }
  });

  it("keeps a __proto__ name as an ordinary key", () => {
    const parsed = parseExport('[{"key":"2026-9","year":2026,"month":9,"total_counts":{"__proto__":1},"role_counts":{"__proto__":{"Sun.Lead":1}}}]');
    expect(Object.keys(parsed[0].total_counts)).toEqual(["__proto__"]);
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
  });

  it.each([
    ["", /empty/],
    ["{", /not JSON/],
    ['{"a":1}', /array/],
    ["[1]", /\[0\].*object/],
    ['[{"key":"2026-09","year":2026,"month":9,"total_counts":{},"role_counts":{}}]', /\[0\].*key/],
    ['[{"key":"2026-13","year":2026,"month":13,"total_counts":{},"role_counts":{}}]', /\[0\].*month/],
    ['[{"key":"2026-9","year":2026,"month":9,"total_counts":{"A":-1},"role_counts":{}}]', /\[0\].*total_counts/],
    ['[{"key":"2026-9","year":2026,"month":9,"total_counts":{"A":1.5},"role_counts":{}}]', /\[0\].*total_counts/],
    ['[{"key":"2026-9","year":2026,"month":9,"total_counts":{},"role_counts":{"A":3}}]', /\[0\].*role_counts/],
    ['[{"key":"2026-9","year":2026,"month":9,"total_counts":{}}]', /\[0\].*role_counts/],
    [
      '[{"key":"2026-9","year":2026,"month":9,"total_counts":{},"role_counts":{}},{"key":"2026-9","year":2026,"month":9,"total_counts":{},"role_counts":{}}]',
      /2026-9.*twice/,
    ],
  ])("refuses a malformed export %j with a clear message", (raw, message) => {
    expect(() => parseExport(raw, "export-x.json")).toThrow(message);
    expect(() => parseExport(raw, "export-x.json")).toThrow(/export-x\.json/);
  });
});

describe("parseDerivedResult and bundles", () => {
  const good = derivedFor(NOV, [BASE_OCT]);

  it("accepts the builder's evidence result and refuses one without evidence", () => {
    expect(parseDerivedResult(JSON.parse(JSON.stringify(good)), NOV, "t")).toEqual(good);
    const { evidence: _omit, ...bare } = good;
    void _omit;
    expect(() => parseDerivedResult(bare, NOV, "t")).toThrow(/evidence/);
  });

  it("refuses entries that are not the target's window, or that disagree with the documents' contributes", () => {
    expect(() => parseDerivedResult(good, { year: 2026, month: 12 }, "t")).toThrow(/window/);
    const skewed = JSON.parse(JSON.stringify(good)) as SolverHistoryResult;
    skewed.entries[2].role_counts[BETO]["Sun.BGV"] = 2;
    skewed.entries[2].total_counts[BETO] = 2;
    expect(() => parseDerivedResult(skewed, NOV, "t")).toThrow(/contributes/);
  });

  const bundleJson = (derived: Record<string, unknown>, exportRaw: string | null = JSON.stringify([entry(2026, 9, {})])) => ({
    origin: "https://owt-backstage.vercel.app",
    takenAt: "2026-10-01T12:00:00.000Z",
    exportRaw,
    derived,
  });

  it("parses a bundle: its export, its NEXT (the snippet's first target), and which targets are usable", () => {
    const b = parseBundle(
      bundleJson({
        "2026-11": { status: 200, body: good },
        "2026-10": { status: 500, body: { error: "history_unavailable" } },
        "2026-12": { status: 200, body: { ...good, evidence: undefined } },
      }),
      "bundle-a.json",
    );
    expect(b.next).toBe("2026-11");
    expect(b.exportEntries).toHaveLength(1);
    expect([...b.targets.keys()]).toEqual(["2026-11", "2026-10", "2026-12"]);
    expect(b.targets.get("2026-11")).toMatchObject({ usable: true });
    expect(b.targets.get("2026-10")).toEqual({ usable: false, reason: "HTTP 500" });
    expect(b.targets.get("2026-12")).toEqual({ usable: false, reason: "no evidence (captured without evidence=1, or not as super-admin)" });
  });

  it("needs NEXT plus m+1 for every export month, across a year end", () => {
    expect(neededTargets([entry(2026, 12, {}), entry(2026, 9, {})], ["2026-11"])).toEqual(["2026-10", "2026-11", "2027-01"]);
    expect(neededTargets([], ["2026-11"])).toEqual(["2026-11"]);
  });

  it("merges bundles by target, and refuses two captures of one target that disagree", () => {
    const a = parseBundle(bundleJson({ "2026-11": { status: 200, body: good } }), "a.json");
    const same = parseBundle(bundleJson({ "2026-11": { status: 200, body: JSON.parse(JSON.stringify(good)) } }), "b.json");
    expect(mergeBundles([a, same]).get("2026-11")).toMatchObject({ usable: true, from: ["a.json", "b.json"] });

    const edited = derivedFor(NOV, [BASE_OCT, doc({ roleId: "u-9", day: "2026-10-25", receipt: { status: "unstamped" }, contributes: {} })]);
    const c = parseBundle(bundleJson({ "2026-11": { status: 200, body: edited } }), "c.json");
    expect(() => mergeBundles([a, c])).toThrow(/2026-11.*a\.json.*c\.json/);

    const failed = parseBundle(bundleJson({ "2026-11": { status: 500, body: {} } }), "d.json");
    expect(mergeBundles([failed, a]).get("2026-11")).toMatchObject({ usable: true, from: ["a.json"] });
  });
});
