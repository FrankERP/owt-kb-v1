// app/components/admin/__tests__/localFill.test.ts
//
// The greedy filler for specials — and, in `describe("the user's requirement")`
// below, the one assertion this whole feature exists for:
//
//   "I need some rules enforced in specials. Specially that exclude two people
//    from being together." / "It has to be hard because if it's soft in fairness
//    it will always choose people like Frank, Mkz or Gaby who tend to have 1 or 2
//    participations a month."
//
// So the acceptance fixture puts the forbidden pair at the BOTTOM of the load
// table — the exact situation the user described, where a soft rule loses — and
// asserts they are never both seated.
//
// Every fixture here is production-shaped in the respect that decides whether
// any of this works: **`alias` is never equal to `member_name`** (E11, fact 12,
// confirmed against production 2026-07-31 — all nine seeded rule names resolve,
// every one of them via alias). A fixture where the two coincided would pass
// against a resolver matching nothing.
//
// The calendar is MARCH 2026: it begins on a Sunday and holds five, so the
// weekday special sits where a naive `Math.ceil(day / 7)` week number disagrees
// with the real Sunday spine.
import { describe, expect, it } from "vitest";

import type { ParticipantRole } from "@/app/utils/computeParticipation";
import { rankCandidates, type RankedCandidate, type RankMember } from "../candidateRanking";
import { VOICE_SEATS } from "../seatModel";
import {
  buildRows,
  createColumnId,
  type GridCell,
  type GridColumn,
  type GridRow,
  type SolverConfig,
} from "../plannerModel";
import { fairnessByMemberId, fillColumn, orderByEffectiveLoad, AUTO_FILL_ROW_IDS } from "../localFill";

const LEAD = VOICE_SEATS[0];

// ─── Members: alias ≠ member_name for every single one ───────────────────────

const m = (
  id: string,
  member_name: string,
  alias: string,
  unavailableDates: string[] = [],
): RankMember => ({ _id: id, member_name, alias, memberType: ["voz"], unavailableDates });

/** Named by a seeded rule. */
const RULED: RankMember[] = [
  m("frank", "Francisco Rocha Ramírez", "Frank"),
  m("mkz", "Marcos Zamudio Ley", "Mkz"),
  m("gaby", "Gabriela Solís Herrera", "Gaby"),
  m("lucia", "María Lucía Estrada", "Lucía"),
  m("niza", "Nizarindani Cruz Ávila", "Niza"),
  m("hugo", "Hugo Alberto Peña", "Hugo"),
  m("jakey", "Jaqueline Ortega Mena", "Jakey"),
];

/** Named by NO rule — the neutral filler pool, so a test isolates one rule. */
const PLAIN: RankMember[] = [
  m("ana", "Ana Karen Villalobos", "Ana"),
  m("beto", "Alberto Ruiz Cano", "Beto"),
  m("carla", "Carla Méndez Soto", "Carla"),
  m("dora", "Dorotea Salas Nava", "Dora"),
  m("elsa", "Elsa Guzmán Ríos", "Elsa"),
  m("fina", "Josefina Torres Lugo", "Fina"),
  m("gina", "Georgina Ávalos Pardo", "Gina"),
  m("zoe", "Zoraida Peña Lima", "Zoe"),
];

/**
 * Members who COULD take an instrument or an FOH seat. They exist so the "these
 * rows are never touched" assertions can actually fail: with a `voz`-only pool,
 * `rankCandidates` returns nobody for those seats and a filler that wrongly
 * looped them would still leave the cells alone.
 */
const NON_VOICE: RankMember[] = [
  { _id: "bassist", member_name: "Rodrigo Lara Peña", alias: "Rodri", memberType: ["instrumento"] },
  { _id: "sound", member_name: "Ismael Cordero Vega", alias: "Isma", memberType: ["foh"] },
];

const ALL = [...RULED, ...PLAIN, ...NON_VOICE];

/** A copy of a fixture member with `unavailableDates` set. */
function unavailable(id: string, dates: string[]): RankMember {
  const found = ALL.find((x) => x._id === id);
  if (!found) throw new Error(`no fixture member ${id}`);
  return { ...found, unavailableDates: dates };
}

function pick(...ids: string[]): RankMember[] {
  return ids.map((id) => {
    const found = ALL.find((x) => x._id === id);
    if (!found) throw new Error(`no fixture member ${id}`);
    return found;
  });
}

// ─── The month, and the column under test ────────────────────────────────────

/** A Wednesday. `Math.ceil(18 / 7)` = 3, and a special has NO week at all (E21). */
const SPECIAL: GridColumn = {
  columnId: createColumnId("special_role", "2026-03-18"),
  date: "2026-03-18",
  type: "special_role",
  serviceName: "Vigilia",
};
const SUNDAY: GridColumn = {
  columnId: createColumnId("sunday_role", "2026-03-15"),
  date: "2026-03-15",
  type: "sunday_role",
};

const ROWS: GridRow[] = buildRows();
const rowOf = (id: string) => {
  const found = ROWS.find((r) => r.id === id);
  if (!found) throw new Error(`no row ${id}`);
  return found;
};
const INSTRUMENT_ROW = ROWS.find((r) => r.category === "instrumento")!;
const FOH_ROW = ROWS.find((r) => r.category === "foh")!;

// ─── Load fixtures ───────────────────────────────────────────────────────────

const ymd = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

/** Sundays BEFORE the special, newest last. Local noon per the TZ invariant. */
function pastSundays(count: number): string[] {
  const out: string[] = [];
  const d = new Date("2026-03-15T12:00:00");
  for (let i = 0; i < count; i++) {
    out.unshift(ymd(d));
    d.setDate(d.getDate() - 7);
  }
  return out;
}

/**
 * A saved history window that gives each named member EXACTLY the load asked
 * for, and every other member load 0 (`computeParticipation` omits anyone with
 * no appearances, and `rankCandidates` reads a miss as 0).
 *
 * One past Sunday per unit of load, `chorus` seats only — the seat is irrelevant
 * to `total`, which is what the `voz` category reads, and using Coro keeps these
 * rows visibly distinct from anything the assertions look at.
 */
function windowWithLoads(loads: Record<string, number>): ParticipantRole[] {
  const max = Math.max(0, ...Object.values(loads));
  const dates = pastSundays(max);
  return dates.map((date, i) => ({
    _type: "sunday_role" as const,
    date,
    leads: [],
    bgvs: [],
    chorus: Object.entries(loads)
      .filter(([, n]) => n > i)
      .map(([id]) => ({ _id: id })),
    instruments: [],
    foh: [],
  }));
}

// ─── The rules: the six seeded restrictions and five seeded conflicts ────────
// (`MonthGenerator.tsx:130-173`)

const restriction = (over: Partial<SolverConfig["restrictions"][number]>) => ({
  id: "r",
  person: "",
  excludedPatterns: [] as string[],
  fairness: "none" as const,
  fairnessSlack: 1,
  weekExclusions: [],
  caps: [],
  ...over,
});

const SEEDED: SolverConfig = {
  sundayLeads: [],
  saturdayLeads: [],
  support: [],
  restrictions: [
    restriction({ id: "d-frank", person: "Frank", excludedPatterns: ["Sat.*", "Sun.BGV", "Sun.Choir"], fairness: "exempt" }),
    restriction({ id: "d-mkz", person: "Mkz", excludedPatterns: ["Sat.*", "Sun.BGV", "Sun.Choir"], fairness: "exempt" }),
    restriction({ id: "d-gaby", person: "Gaby", excludedPatterns: ["Sat.*", "Sun.Choir"], fairness: "slack", fairnessSlack: 1 }),
    restriction({ id: "d-lucia-week", person: "Lucía", weekExclusions: [{ id: "w", week: 3, pattern: "*.*" }] }),
    restriction({ id: "d-liu-week", person: "Liu", weekExclusions: [{ id: "w", week: 3, pattern: "*.*" }] }),
    restriction({ id: "d-marianne-week", person: "Marianne", weekExclusions: [{ id: "w", week: 1, pattern: "*.*" }] }),
  ],
  conflicts: [
    { id: "d-lucia-niza", personA: "Lucía", personB: "Niza", pattern: "*.LeadBGV" },
    { id: "d-hugo-lucia", personA: "Hugo", personB: "Lucía", pattern: "*.Lead" },
    { id: "d-niza-hugo", personA: "Niza", personB: "Hugo", pattern: "*.Lead" },
    { id: "d-jakey-hugo-bgv", personA: "Jakey", personB: "Hugo", pattern: "*.BGV" },
    { id: "d-jakey-hugo-lead", personA: "Jakey", personB: "Hugo", pattern: "*.Lead" },
  ],
  presence: [{ id: "d-hugo-jakey", persons: ["Hugo", "Jakey"], pattern: "Sun.BGV" }],
};

// ─── Call helpers ────────────────────────────────────────────────────────────

function fill(over: {
  members: RankMember[];
  loads?: Record<string, number>;
  cells?: GridCell[];
  column?: GridColumn;
  columns?: GridColumn[];
  config?: SolverConfig;
}) {
  const column = over.column ?? SPECIAL;
  return fillColumn({
    column,
    columns: over.columns ?? [column],
    rows: ROWS,
    cells: over.cells ?? [],
    members: over.members,
    savedWindow: windowWithLoads(over.loads ?? {}),
    config: over.config ?? SEEDED,
  });
}

const idsIn = (cells: GridCell[], rowId: string, columnId = SPECIAL.columnId) =>
  cells
    .find((c) => c.columnId === columnId && c.rowId === rowId)
    ?.occupants.map((occupant) => occupant.memberId) ?? [];

/** The eligible pool `fillColumn` would order, built the way `fillColumn` builds it. */
function eligiblePool(members: RankMember[], loads: Record<string, number>): RankedCandidate[] {
  return rankCandidates({
    seat: LEAD,
    date: SPECIAL.date,
    members,
    windowRoles: windowWithLoads(loads),
    assigned: [],
    column: SPECIAL,
    config: SEEDED,
  }).filter((c) => c.eligible);
}

const orderedNames = (members: RankMember[], loads: Record<string, number>) =>
  orderByEffectiveLoad(eligiblePool(members, loads), fairnessByMemberId(SEEDED, members)).map(
    (c) => c.name,
  );

// ─── The fixture's own precondition ──────────────────────────────────────────

describe("the fixture", () => {
  it("gives every member an alias DIFFERENT from their member_name, and every rule names the alias", () => {
    for (const mm of ALL) {
      expect(mm.alias).toBeTruthy();
      expect(mm.alias).not.toBe(mm.member_name);
    }
    const named = [
      ...SEEDED.restrictions.map((r) => r.person),
      ...SEEDED.conflicts.flatMap((c) => [c.personA, c.personB]),
    ];
    for (const n of named) expect(ALL.some((mm) => mm.member_name === n)).toBe(false);
  });

  it("gives the ruled members the loads a test asks for and everyone else zero", () => {
    const pool = eligiblePool(pick("ana", "beto"), { ana: 3 });
    expect(pool.find((c) => c.id === "ana")!.load).toBe(3);
    expect(pool.find((c) => c.id === "beto")!.load).toBe(0);
  });
});

// ─── THE USER'S REQUIREMENT ──────────────────────────────────────────────────

describe("the user's requirement — the filler cannot emit a pair the rules forbid", () => {
  /**
   * Lucía and Niza are the seeded `*.LeadBGV` conflict and, here, THE TWO
   * LOWEST-LOAD CANDIDATES IN THE POOL — the situation the user described, in
   * which a fairness-shaped soft rule seats them both every single time.
   *
   * Lead's target is 2, so a filler that ranks once against a pre-fill snapshot
   * seats both of them: evaluated against an empty column each is individually
   * unblocked. Only re-evaluating as of each placement refuses the second.
   */
  const MEMBERS = pick("lucia", "niza", "ana", "beto", "carla", "dora", "elsa");
  const LOADS = { lucia: 0, niza: 0, ana: 3, beto: 4, carla: 5, dora: 6, elsa: 7 };

  it("puts the forbidden pair at the BOTTOM of the load table — otherwise this test proves nothing", () => {
    const pool = eligiblePool(MEMBERS, LOADS);
    expect(pool.slice(0, 2).map((c) => c.id).sort()).toEqual(["lucia", "niza"]);
    for (const c of pool.slice(2)) expect(c.load).toBeGreaterThan(0);
  });

  it("never seats both members of a forbidden pair, even when they are the two cheapest picks", () => {
    const out = fill({ members: MEMBERS, loads: LOADS });
    const seated = [...idsIn(out.cells, "lead"), ...idsIn(out.cells, "bgv")];
    expect(seated).toContain("lucia");
    expect(seated).not.toContain("niza");
  });

  it("still fills every seat — the rule costs the pair, not the roster", () => {
    const out = fill({ members: MEMBERS, loads: LOADS });
    expect(idsIn(out.cells, "lead")).toEqual(["lucia", "ana"]);
    expect(idsIn(out.cells, "bgv")).toEqual(["beto", "carla", "dora"]);
    expect(out.unfilled).toEqual([]);
  });

  it("blocks the partner in the OTHER row too — `*.LeadBGV` binds Lead and BGV of the same column", () => {
    // Lucía is seated in Lead by the first placement; Niza must then be refused
    // for BGV as well, not merely for the row Lucía occupies.
    const out = fill({ members: MEMBERS, loads: LOADS });
    expect(idsIn(out.cells, "bgv")).not.toContain("niza");
  });
});

// ─── Availability (P8) ───────────────────────────────────────────────────────

describe("availability", () => {
  it("does not seat an UNAVAILABLE member with the lowest load ahead of available ones", () => {
    const members = [
      unavailable("ana", [SPECIAL.date]),
      ...pick("beto", "carla", "dora", "elsa", "fina"),
    ];
    const out = fill({
      members,
      loads: { ana: 0, beto: 5, carla: 6, dora: 7, elsa: 8, fina: 9 },
    });
    const seated = [...idsIn(out.cells, "lead"), ...idsIn(out.cells, "bgv")];
    expect(seated).not.toContain("ana");
    // And the seats are full, so "not seated" is a refusal, not a short pool.
    expect(idsIn(out.cells, "lead")).toEqual(["beto", "carla"]);
    expect(idsIn(out.cells, "bgv")).toEqual(["dora", "elsa", "fina"]);
  });
});

// ─── Double duty and in-cell duplicates ──────────────────────────────────────

describe("one person, one seat", () => {
  it("never seats the same person in both Lead and BGV of one column", () => {
    const out = fill({ members: pick("ana", "beto"), loads: { ana: 1, beto: 2 } });
    expect(idsIn(out.cells, "lead")).toEqual(["ana", "beto"]);
    expect(idsIn(out.cells, "bgv")).toEqual([]);
    const seated = [...idsIn(out.cells, "lead"), ...idsIn(out.cells, "bgv")];
    expect(new Set(seated).size).toBe(seated.length);
  });

  it("never repeats a memberId WITHIN one cell — a duplicate `_ref` would reach Sanity", () => {
    // One candidate, Lead's target is 2: the member just seated is still
    // `eligible` for the cell being filled (the picker's own self-exemption),
    // and `canonicalRefs` keeps genuine duplicates.
    const out = fill({ members: pick("ana"), loads: { ana: 1 } });
    const lead = idsIn(out.cells, "lead");
    expect(lead).toEqual(["ana"]);
    expect(new Set(lead).size).toBe(lead.length);
  });
});

// ─── Which rows get filled (P5, D5, O3) ──────────────────────────────────────

describe("which rows the filler touches", () => {
  it("fills Lead and BGV, and nothing else", () => {
    expect([...AUTO_FILL_ROW_IDS]).toEqual(["lead", "bgv"]);
  });

  it("leaves a special's CORO cell byte-identical — Coro is never auto-filled (O3)", () => {
    // SEVEN voice candidates for five Lead+BGV seats, so two are left over and
    // a filler that included Coro would top this cell up to its target of 3.
    const coro: GridCell = {
      columnId: SPECIAL.columnId,
      rowId: "coro",
      occupants: [{ memberId: "zoe" }],
      origin: "manual",
    };
    const out = fill({
      members: pick("ana", "beto", "carla", "dora", "elsa", "fina", "gina"),
      cells: [coro],
    });
    expect(out.cells.find((c) => c.rowId === "coro")).toBe(coro);
    expect(rowOf("coro").target).toBe(3); // the row exists and has a target — it is simply not filled
  });

  it("creates no Coro cell at all when the column starts without one", () => {
    const out = fill({ members: pick("ana", "beto", "carla", "dora", "elsa", "fina", "gina") });
    expect(out.cells.some((c) => c.rowId === "coro")).toBe(false);
    expect(out.unfilled.some((u) => u.rowId === "coro")).toBe(false);
  });

  it("leaves INSTRUMENT and FOH cells byte-identical — D5 keeps them manual", () => {
    // The pool carries an `instrumento` member and an `foh` member, so a filler
    // that looped `rowAppliesTo` would have someone to seat in both.
    const bass: GridCell = {
      columnId: SPECIAL.columnId,
      rowId: INSTRUMENT_ROW.id,
      occupants: [],
      origin: "empty",
    };
    const foh: GridCell = {
      columnId: SPECIAL.columnId,
      rowId: FOH_ROW.id,
      occupants: [],
      origin: "empty",
    };
    const out = fill({
      members: [...pick("ana", "beto", "carla", "dora", "elsa"), ...NON_VOICE],
      cells: [bass, foh],
    });
    expect(out.cells.find((c) => c.rowId === INSTRUMENT_ROW.id)).toBe(bass);
    expect(out.cells.find((c) => c.rowId === FOH_ROW.id)).toBe(foh);
    // No instrument or FOH row was newly created either.
    const touched = out.cells.filter((c) => c.origin === "auto").map((c) => c.rowId);
    expect(touched.sort()).toEqual(["bgv", "lead"]);
    expect(out.unfilled.every((u) => u.rowId === "lead" || u.rowId === "bgv")).toBe(true);
  });
});

// ─── Leaving a seat empty (step 5) ───────────────────────────────────────────

describe("an empty seat is a correct output", () => {
  it("leaves the seat empty and REPORTS it, one entry per missing seat, rather than seating a blocked candidate", () => {
    const out = fill({ members: pick("ana", "beto"), loads: { ana: 1, beto: 2 } });
    // Lead took both; every BGV candidate is now blocked by double duty.
    expect(out.unfilled).toEqual([
      { columnId: SPECIAL.columnId, rowId: "bgv" },
      { columnId: SPECIAL.columnId, rowId: "bgv" },
      { columnId: SPECIAL.columnId, rowId: "bgv" },
    ]);
    expect(out.cells.some((c) => c.rowId === "bgv")).toBe(false);
  });

  it("reports the remaining seats of a PARTIALLY filled row", () => {
    const out = fill({ members: pick("ana") });
    expect(out.unfilled.filter((u) => u.rowId === "lead")).toHaveLength(1);
    expect(out.unfilled.filter((u) => u.rowId === "bgv")).toHaveLength(3);
  });
});

// ─── Fairness ordering (P7b) ─────────────────────────────────────────────────

describe("effectiveLoad", () => {
  it("puts an EXEMPT member at the median: behind a candidate at median − 1, ahead of one at median + 1", () => {
    // Non-exempt eligible loads are 2, 3, 4 -> median 3. Frank is exempt with
    // load 0. Nothing is asserted about Beto, who HOLDS the median: that is a
    // tie by construction and would be decided by fixture names.
    const members = pick("frank", "ana", "beto", "carla");
    const order = orderedNames(members, { frank: 0, ana: 2, beto: 3, carla: 4 });
    expect(order.indexOf("Ana")).toBeLessThan(order.indexOf("Frank"));
    expect(order.indexOf("Frank")).toBeLessThan(order.indexOf("Carla"));
  });

  it("does not bury an exempt member — an earlier draft used +∞, which is burial", () => {
    const members = pick("frank", "ana", "beto", "carla");
    const order = orderedNames(members, { frank: 0, ana: 2, beto: 3, carla: 4 });
    expect(order[order.length - 1]).not.toBe("Frank");
  });

  it("falls back to the RAW load when every eligible candidate is exempt (no median exists)", () => {
    // Frank and Mkz are both exempt, so the non-exempt set is empty. A `NaN`
    // key here would make the comparator non-transitive.
    const order = orderedNames(pick("frank", "mkz"), { frank: 5, mkz: 2 });
    expect(order).toEqual(["Mkz", "Frank"]);
  });

  it("counts a SLACK member's RAW load toward the median, not `load + N`", () => {
    // Non-exempt eligible loads raw: Ana 1, Gaby 5, Carla 9 -> median 5, so
    // Frank (exempt, load 7) sorts at 5 and lands ahead of Gaby's 5 + 1 = 6.
    // Inflating Gaby to 8 for the median would move Frank to 8 and put him
    // BEHIND Gaby.
    const members = pick("frank", "gaby", "ana", "carla");
    const order = orderedNames(members, { frank: 7, gaby: 5, ana: 1, carla: 9 });
    expect(order).toEqual(["Ana", "Frank", "Gaby", "Carla"]);
  });

  it("moves a SLACK member one position back without touching her rendered `load`", () => {
    // Gaby and Zoe both carry load 2, and `rankCandidates` puts Gaby first
    // ("Gaby" < "Zoe"). `slack 1` makes Gaby's ordering key 3 and hands the
    // position to Zoe — the offset must move the POSITION and never the field,
    // which two shipped surfaces render.
    const members = pick("gaby", "zoe", "ana");
    const loads = { gaby: 2, zoe: 2, ana: 1 };
    const raw = eligiblePool(members, loads);
    expect(raw.map((c) => c.name)).toEqual(["Ana", "Gaby", "Zoe"]);
    expect(orderedNames(members, loads)).toEqual(["Ana", "Zoe", "Gaby"]);
    // The rendered field is untouched.
    expect(raw.find((c) => c.id === "gaby")!.load).toBe(2);
    const ordered = orderByEffectiveLoad(raw, fairnessByMemberId(SEEDED, members));
    expect(ordered.find((c) => c.id === "gaby")!.load).toBe(2);
  });

  it("takes the LOWER of the two middles, never the upper", () => {
    // Non-exempt eligible loads 2, 3, 4, 5 — an EVEN pool, which is the only
    // shape the two middles disagree on and the common one on a real roster.
    // Lower middle 3, upper middle 4. Frank is exempt at raw load 9, so his
    // incoming index is LAST and the assertion below cannot be satisfied by a
    // tiebreak: at the lower middle his key of 3 beats Carla's 4 outright,
    // while at the upper middle he ties Carla and loses on index. The lower is
    // what the brief specifies and what keeps the result a load a real
    // candidate actually carries.
    const members = pick("frank", "ana", "beto", "carla", "dora");
    const order = orderedNames(members, { frank: 9, ana: 2, beto: 3, carla: 4, dora: 5 });
    expect(order).toEqual(["Ana", "Beto", "Frank", "Carla", "Dora"]);
  });

  it("orders a plain pool by raw load, ascending", () => {
    expect(orderedNames(pick("ana", "beto", "carla"), { ana: 9, beto: 1, carla: 5 })).toEqual([
      "Beto",
      "Carla",
      "Ana",
    ]);
  });
});

// ─── Fairness THROUGH the fill (P7b, wired) ──────────────────────────────────

describe("fairness reaches the seats", () => {
  /**
   * The assertions above all call `orderByEffectiveLoad` directly. That proves
   * the comparator and nothing about `fillColumn`, which is what the user
   * actually gets: strip the `fairnessByMemberId` call out of `fillColumn` and
   * every one of them stays green while the filler seats by RAW load — and
   * seating by raw load is verbatim the failure the user described, "it will
   * always choose people like Frank, Mkz or Gaby who tend to have 1 or 2
   * participations a month".
   *
   * The exempt case is asserted against `median − 1` and `median + 1`, never
   * against the median-holder: an exempt member TIES the holder by construction,
   * so a seat assertion there would decay into a fixture-name assertion. Neither
   * neighbour ties.
   */
  it("does not seat an EXEMPT member ahead of a candidate at median − 1, and still seats her ahead of median + 1", () => {
    // Non-exempt eligible loads 2, 3, 4 → median 3. Frank is exempt at load 0,
    // so raw load would seat him FIRST; the median puts him behind Ana (2) and
    // ahead of Carla (4) — Lead's two seats, then BGV's.
    const members = pick("frank", "ana", "beto", "carla");
    const out = fill({ members, loads: { frank: 0, ana: 2, beto: 3, carla: 4 } });
    expect(idsIn(out.cells, "lead")).toEqual(["ana", "frank"]);
    expect(idsIn(out.cells, "bgv")).toEqual(["beto", "carla"]);
  });

  it("moves a SLACK member behind the tie she would otherwise win, in the seats and not just the comparator", () => {
    // Gaby and Zoe both carry load 2 and `rankCandidates` puts Gaby first
    // ("Gaby" < "Zoe"). `slack 1` hands Lead's second seat to Zoe and drops Gaby
    // to BGV. Without the fairness map Gaby takes the Lead seat.
    const members = pick("gaby", "zoe", "ana");
    const out = fill({ members, loads: { gaby: 2, zoe: 2, ana: 1 } });
    expect(idsIn(out.cells, "lead")).toEqual(["ana", "zoe"]);
    expect(idsIn(out.cells, "bgv")).toEqual(["gaby"]);
  });
});

describe("fairnessByMemberId", () => {
  it("resolves rule names through the ALIAS, which is the only form the rules use", () => {
    const map = fairnessByMemberId(SEEDED, ALL);
    expect(map.get("frank")).toEqual({ kind: "exempt" });
    expect(map.get("gaby")).toEqual({ kind: "slack", n: 1 });
    expect(map.get("lucia")).toBeUndefined(); // fairness "none"
  });

  it("keeps the FIRST match when two restrictions name one person", () => {
    const config: SolverConfig = {
      ...SEEDED,
      restrictions: [
        restriction({ id: "a", person: "Ana", fairness: "exempt" }),
        restriction({ id: "b", person: "Ana", fairness: "slack", fairnessSlack: 3 }),
      ],
    };
    expect(fairnessByMemberId(config, ALL).get("ana")).toEqual({ kind: "exempt" });
  });

  it("ignores `slack` with a non-positive offset — `restrictionToDs` emits nothing for it either", () => {
    const config: SolverConfig = {
      ...SEEDED,
      restrictions: [restriction({ id: "a", person: "Ana", fairness: "slack", fairnessSlack: 0 })],
    };
    expect(fairnessByMemberId(config, ALL).get("ana")).toBeUndefined();
  });

  it("contributes nothing for a rule naming nobody", () => {
    const config: SolverConfig = {
      ...SEEDED,
      restrictions: [restriction({ id: "a", person: "Fantasma", fairness: "exempt" })],
    };
    expect(fairnessByMemberId(config, ALL).size).toBe(0);
  });

  it("is empty without a config — no rules, no fairness terms", () => {
    expect(fairnessByMemberId(undefined, ALL).size).toBe(0);
  });
});

// ─── Idempotence, determinism, and what it refuses to touch ──────────────────

describe("the fill itself", () => {
  const MEMBERS = pick("ana", "beto", "carla", "dora", "elsa");

  it("returns a NON-special column untouched — the weekend grid belongs to CP-SAT", () => {
    const cells: GridCell[] = [];
    const out = fillColumn({
      column: SUNDAY,
      columns: [SUNDAY],
      rows: ROWS,
      cells,
      members: MEMBERS,
      savedWindow: [],
      config: SEEDED,
    });
    expect(out.cells).toBe(cells);
    expect(out.unfilled).toEqual([]);
  });

  it("is deterministic — the same inputs give the same seats", () => {
    const a = fill({ members: MEMBERS, loads: { ana: 1, beto: 2, carla: 3, dora: 4, elsa: 5 } });
    const b = fill({ members: MEMBERS, loads: { ana: 1, beto: 2, carla: 3, dora: 4, elsa: 5 } });
    expect(a.cells).toEqual(b.cells);
    expect(a.unfilled).toEqual(b.unfilled);
  });

  it("is idempotent — a second run over a filled column changes nothing at all", () => {
    const first = fill({ members: MEMBERS });
    const second = fill({ members: MEMBERS, cells: first.cells });
    expect(second.cells).toBe(first.cells);
    expect(second.unfilled).toEqual([]);
  });

  it("tops a manual cell up instead of rebuilding it — the manual pick keeps its place", () => {
    const manual: GridCell = {
      columnId: SPECIAL.columnId,
      rowId: "lead",
      occupants: [{ memberId: "elsa" }],
      origin: "manual",
    };
    const out = fill({
      members: MEMBERS,
      loads: { ana: 0, beto: 1, carla: 2, dora: 3, elsa: 9 },
      cells: [manual],
    });
    expect(idsIn(out.cells, "lead")[0]).toBe("elsa");
    expect(idsIn(out.cells, "lead")).toHaveLength(2);
  });

  it("marks what it writes `origin: \"auto\"`", () => {
    const out = fill({ members: MEMBERS });
    expect(out.cells.find((c) => c.rowId === "lead")!.origin).toBe("auto");
  });

  it("enforces nothing without a config, and still fills", () => {
    // The forbidden pair, with the rules absent: proof the refusal above comes
    // from the config and not from some incidental property of the fixture.
    const members = pick("lucia", "niza");
    const out = fillColumn({
      column: SPECIAL,
      columns: [SPECIAL],
      rows: ROWS,
      cells: [],
      members,
      savedWindow: [],
    });
    expect(idsIn(out.cells, "lead").sort()).toEqual(["lucia", "niza"]);
  });

  it("moves load between two specials of one month, so the second does not re-pick the first's people", () => {
    // The reason `columns` is a REQUIRED input: the in-grid half of `load` is
    // `cellsToParticipantRoles(cells, columns, members)`, which iterates columns.
    const second: GridColumn = {
      columnId: createColumnId("special_role", "2026-03-25"),
      date: "2026-03-25",
      type: "special_role",
      serviceName: "Bautizos",
    };
    const columns = [SPECIAL, second];
    const members = pick("ana", "beto", "carla", "dora", "elsa", "fina", "zoe");
    const first = fillColumn({
      column: SPECIAL,
      columns,
      rows: ROWS,
      cells: [],
      members,
      savedWindow: [],
      config: SEEDED,
    });
    const out = fillColumn({
      column: second,
      columns,
      rows: ROWS,
      cells: first.cells,
      members,
      savedWindow: [],
      config: SEEDED,
    });
    const firstSeats = [...idsIn(out.cells, "lead"), ...idsIn(out.cells, "bgv")];
    const secondSeats = [
      ...idsIn(out.cells, "lead", second.columnId),
      ...idsIn(out.cells, "bgv", second.columnId),
    ];
    expect(firstSeats).toHaveLength(5);
    expect(secondSeats).toHaveLength(5);
    // Seven candidates, five seats each: the two who sat out the first special
    // must lead the second, which only happens if the first special's seats
    // counted as load.
    expect(secondSeats.slice(0, 2).sort()).toEqual(
      members.map((mm) => mm._id).filter((id) => !firstSeats.includes(id)).sort(),
    );
  });
});

// ─── P10: the asymmetry ──────────────────────────────────────────────────────
//
// A HUMAN may set a hard rule aside for one pick, explicitly, and the exception
// is recorded on the cell (`GridCell.overrides`) and rendered forever after.
// The AUTOMATION may not — and that asymmetry is the user's requirement, not an
// implementation detail: what they rejected was the solver quietly preferring
// the people a rule protects, never a person making a deliberate exception.
//
// So the filler must have NO PATH to an override. It neither writes one nor
// reads one, and these tests fail the moment it grows either.

describe("the filler never overrides a rule", () => {
  /**
   * Lucía and Niza are the seeded `*.LeadBGV` conflict AND the two lowest-load
   * candidates — the exact pull toward seating them both. Lead's target is 2.
   */
  const MEMBERS = pick("lucia", "niza", "ana", "beto", "carla", "dora", "elsa");
  const LOADS = { lucia: 0, niza: 0, ana: 3, beto: 4, carla: 5, dora: 6, elsa: 7 };

  it("emits no `overrides` on any cell it touches, having really filled them", () => {
    const out = fill({ members: MEMBERS, loads: LOADS });
    // The filler ran: Lead and BGV are at target, so "no overrides" is not
    // vacuously true because nothing was seated.
    expect(idsIn(out.cells, "lead")).toHaveLength(rowOf("lead").target!);
    expect(idsIn(out.cells, "bgv")).toHaveLength(rowOf("bgv").target!);
    for (const cell of out.cells) expect(cell.overrides ?? []).toEqual([]);
    // And it refused the pair rather than overriding its way past them.
    const voices = [...idsIn(out.cells, "lead"), ...idsIn(out.cells, "bgv")];
    expect(voices.includes("lucia") && voices.includes("niza")).toBe(false);
  });

  it("leaves a HUMAN's override untouched on a cell it TOPS UP, and never adds itself", () => {
    // Lucía was overridden onto Lead, deliberately, and Lead's target is 2 — so
    // the filler really does rewrite this cell rather than skipping it (which is
    // what made an earlier version of this test unable to fail). It must neither
    // drop the record — the marker would vanish and E13 would re-flag a
    // sanctioned seat on the next render — nor add one of its own.
    const seeded: GridCell[] = [
      {
        columnId: SPECIAL.columnId,
        rowId: "lead",
        occupants: [{ memberId: "lucia" }],
        origin: "manual",
        overrides: ["lucia"],
      },
    ];
    const out = fill({ members: MEMBERS, loads: LOADS, cells: seeded });
    const lead = out.cells.find((c) => c.rowId === "lead" && c.columnId === SPECIAL.columnId);
    expect(lead?.occupants).toHaveLength(2);
    expect(lead?.occupants[0].memberId).toBe("lucia");
    expect(lead?.overrides).toEqual(["lucia"]);
    // BGV was filled around it, and carries no override of its own.
    expect(idsIn(out.cells, "bgv")).toHaveLength(rowOf("bgv").target!);
    expect(out.cells.find((c) => c.rowId === "bgv")?.overrides ?? []).toEqual([]);
  });

  it("does not treat an existing override as permission to seat that pair elsewhere", () => {
    // Niza is overridden onto Lead. BGV is still being filled, and the same
    // `*.LeadBGV` conflict still refuses Lucía there — an override is per pick,
    // never a standing exemption the filler can lean on.
    const seeded: GridCell[] = [
      {
        columnId: SPECIAL.columnId,
        rowId: "lead",
        occupants: [{ memberId: "niza" }],
        origin: "manual",
        overrides: ["niza"],
      },
    ];
    const out = fill({ members: MEMBERS, loads: LOADS, cells: seeded });
    expect(idsIn(out.cells, "bgv")).not.toContain("lucia");
  });
});
