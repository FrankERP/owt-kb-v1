// The proposal editor's replay (plan T2.3) and its one rule-input builder: each edit judged by the
// planner's own gate, C4 forceable and recorded rule by rule, the cross-check between gate and
// finder, and every refusal code. Pure: hand-built boards (`editorFixtures.ts`).
import { describe, expect, it } from "vitest";

import { V3_EDITOR_LINES as E } from "@/app/components/admin/v3Copy";
import { boardFindings, columnFindings, columnRuleInputs, serverEvaluateMove, serverJudgePick, type EditorBoard } from "../editorBoard";
import { CELL_LIMIT, MAX_EDITS, NOT_ELIGIBLE_SENTENCE, REPLAY_SENTENCES, replayEdits, seatedIds, type EditorEdit } from "../revise";
import { DRAFTS, MEMBERS, RULES, board, draft, rules } from "./editorFixtures";

const B = () => board(DRAFTS);
const replay = (edits: EditorEdit[], over: { config?: typeof RULES | null; b?: EditorBoard } = {}) =>
  replayEdits({ board: over.b ?? B(), edits, members: MEMBERS, config: over.config === undefined ? RULES : over.config });
const seat = (b: EditorBoard, service: string, row: string) =>
  b.cells.find((c) => c.columnId === b.columnIdOf.get(service) && c.rowId === row)?.occupants.map((o) => o.memberId) ?? [];

describe("columnRuleInputs — the one source of (column, config, spine)", () => {
  it("answers each weekend's own month spine, the trailing Saturday's and a second month's included", () => {
    const b = B();
    const of = (service: string) => columnRuleInputs(b, b.columnIdOf.get(service)!, RULES)!.sundayDates;
    expect(of("sun2")).toEqual(["2026-11-01", "2026-11-08", "2026-11-15", "2026-11-22", "2026-11-29"]);
    expect(of("dec2")).toEqual(["2026-12-06", "2026-12-13", "2026-12-20", "2026-12-27"]);
    expect(of("jul-trail")).toEqual(["2027-07-04", "2027-07-11", "2027-07-18", "2027-07-25"]);
    expect(of("special")).toEqual([]);
  });

  it("refuses a missing config, an unknown column, and a weekend with no spine", () => {
    const b = B();
    expect(columnRuleInputs(b, b.columnIdOf.get("sun2")!, null)).toBeNull();
    expect(columnRuleInputs(b, "create:sunday_role__2030-01-06", RULES)).toBeNull();
    // A weekend column whose date has no Sunday spine (a date outside any month the context knows).
    const odd = { ...b, columns: b.columns.map((c) => (c.columnId === b.columnIdOf.get("sun2") ? { ...c, date: "not-a-date" } : c)) };
    expect(columnRuleInputs(odd, b.columnIdOf.get("sun2")!, RULES)).toBeNull();
  });

  it("every gate and the finder answer null — never «clean» — when an input is missing", () => {
    const b = B();
    const columnId = b.columnIdOf.get("sun2")!;
    expect(serverJudgePick({ board: b, columnId, rowId: "lead", members: MEMBERS, config: null }, "m-bruno")).toBeNull();
    expect(serverEvaluateMove({
      board: b, members: MEMBERS, config: null,
      source: { columnId: b.columnIdOf.get("sun1")!, rowId: "lead", memberId: "m-ana" }, target: { columnId, rowId: "bgv" },
    })).toBeNull();
    expect(columnFindings(b, columnId, MEMBERS, null)).toBeNull();
    expect(boardFindings(b, MEMBERS, null)).toBeNull();
    // The replay turns it into `server_error`, never a stored seat.
    const out = replay([{ op: "place", service: "sun2", row: "lead", member: "m-bruno" }], { config: null });
    expect(out.ok).toBe(false);
    if (!out.ok) expect(out.refusal).toMatchObject({ index: 0, code: "server_error" });
  });
});

describe("C4 — the hard rules, for place AND move, forceable and recorded", () => {
  const cases: Array<{ name: string; kind: string; rule: string; place: EditorEdit; move: EditorEdit; clean: EditorEdit }> = [
    {
      name: "a role exclusion (Ana !in Sun.Lead)",
      kind: "exclusion",
      rule: "restriction[0].pattern[0]",
      place: { op: "place", service: "sun2", row: "lead", member: "m-ana" },
      move: { op: "move", from: { service: "sun1", row: "lead", member: "m-ana" }, to: { service: "sun2", row: "lead" } },
      // The same person into a seat the rule does not cover.
      clean: { op: "place", service: "sun2", row: "bgv", member: "m-ana" },
    },
    {
      name: "a week exclusion on the TRAILING Saturday (Carla, week 5)",
      kind: "week_exclusion",
      rule: "restriction[1].week[0]",
      place: { op: "place", service: "jul-trail", row: "lead", member: "m-carla" },
      move: { op: "move", from: { service: "jul-sat1", row: "lead", member: "m-carla" }, to: { service: "jul-trail", row: "lead" } },
      clean: { op: "place", service: "jul-sat1", row: "lead", member: "m-carla" },
    },
    {
      name: "a week exclusion on a SECOND month's Sunday (Bruno, week 2 of December)",
      kind: "week_exclusion",
      rule: "restriction[2].week[0]",
      place: { op: "place", service: "dec2", row: "lead", member: "m-bruno" },
      move: { op: "move", from: { service: "dec3", row: "lead", member: "m-bruno" }, to: { service: "dec2", row: "lead" } },
      clean: { op: "place", service: "dec3", row: "lead", member: "m-bruno" },
    },
    {
      name: "a pair (Ana !with Dani), Ana already on Nov 1",
      kind: "pair",
      rule: "conflict[0]",
      place: { op: "place", service: "sun1", row: "bgv", member: "m-dani" },
      move: { op: "move", from: { service: "sun2", row: "bgv", member: "m-dani" }, to: { service: "sun1", row: "bgv" } },
      clean: { op: "place", service: "sun2", row: "bgv", member: "m-dani" },
    },
  ];

  for (const c of cases) {
    const setup: EditorEdit[] = c.move.op === "move" && c.move.from.service !== "sun1" ? [{ op: "place", ...c.move.from }] : [];

    it(`${c.name}: place refuses with the gate's rules, by identity`, () => {
      const out = replay([c.place]);
      expect(out.ok).toBe(false);
      if (out.ok) return;
      expect(out.refusal.code).toBe("hard_rule");
      expect(out.refusal.prompt?.rules.map((r) => [r.kind, r.ruleId])).toEqual([[c.kind, c.rule]]);
    });

    it(`${c.name}: move refuses the same way`, () => {
      const out = replay([...setup, c.move]);
      expect(out.ok).toBe(false);
      if (out.ok) return;
      expect(out.refusal).toMatchObject({ index: setup.length, code: "hard_rule" });
      expect(out.refusal.prompt?.rules.map((r) => [r.kind, r.ruleId])).toEqual([[c.kind, c.rule]]);
    });

    it(`${c.name}: forced, the seat is taken and the rule recorded; the finder agrees`, () => {
      for (const edit of [c.place, c.move]) {
        const edits = edit === c.move ? [...setup, { ...edit, force: true }] : [{ ...edit, force: true }];
        const out = replay(edits as EditorEdit[]);
        expect(out.ok, JSON.stringify(edit)).toBe(true);
        if (!out.ok) continue;
        const forced = out.verdicts.at(-1)!.forced;
        expect(forced).toHaveLength(1);
        expect(forced[0].rules.map((r) => r.ruleId)).toEqual([c.rule]);
        const service = edit.op === "place" ? edit.service : (edit as Extract<EditorEdit, { op: "move" }>).to.service;
        const found = columnFindings(out.board, out.board.columnIdOf.get(service)!, MEMBERS, RULES)!;
        expect(found.some((f) => f.key.rule === c.rule)).toBe(true);
      }
    });

    it(`${c.name}: the control case is clean`, () => {
      const out = replay([c.clean]);
      expect(out.ok).toBe(true);
      if (out.ok) expect(out.verdicts[0].forced).toEqual([]);
    });

    it(`${c.name}: without the rules the same edit is clean (the case is not vacuous)`, () => {
      expect(replay([c.place], { config: rules() }).ok).toBe(true);
    });
  }

  it("one seat forced past TWO rules records both", () => {
    const two = rules({
      restrictions: [
        RULES.restrictions[0],
        { ...RULES.restrictions[0], id: "x-ana-2", excludedPatterns: ["*.Lead"] },
      ],
    });
    const out = replay([{ op: "place", service: "sun2", row: "lead", member: "m-ana", force: true }], { config: two });
    expect(out.ok).toBe(true);
    if (out.ok) expect(out.verdicts[0].forced[0].rules.map((r) => r.ruleId)).toEqual(["restriction[0].pattern[0]", "restriction[1].pattern[0]"]);
  });
});

describe("the other refusals, by code", () => {
  const refused = (edits: EditorEdit[], b?: EditorBoard) => {
    const out = replay(edits, { b });
    if (out.ok) throw new Error("expected a refusal");
    return out.refusal;
  };

  it("R1/I5: an unknown id and a kids-only id get the ONE collapsed sentence; a worship member the planner's", () => {
    expect(refused([{ op: "place", service: "sun2", row: "lead", member: "m-nobody" }])).toMatchObject({ code: "member_not_eligible", sentence: NOT_ELIGIBLE_SENTENCE });
    // Tomás (no Tipo «voz») on Lead: C3 with the planner's own words.
    const c3 = refused([{ op: "place", service: "sun2", row: "lead", member: "m-tomas" }]);
    expect(c3.code).toBe("member_not_eligible");
    expect(c3.sentence).not.toBe(NOT_ELIGIBLE_SENTENCE);
    expect(c3.sentence).toMatch(/requiere tipo/);
  });

  it("C2: a same-category double is never forceable", () => {
    const r = refused([{ op: "place", service: "sun1", row: "bgv", member: "m-ana", force: true }]);
    expect(r.code).toBe("same_category_double");
  });

  it("R5 already in the cell, R6 not in the cell, unknown service / row, R9 row not on the column, R10 not created, same seat", () => {
    expect(refused([{ op: "place", service: "sun1", row: "lead", member: "m-ana" }]).code).toBe("already_in_cell");
    expect(refused([{ op: "clear", service: "sun2", row: "lead", member: "m-ana" }]).code).toBe("member_not_in_cell");
    expect(refused([{ op: "place", service: "nope", row: "lead", member: "m-ana" }]).code).toBe("unknown_service");
    expect(refused([{ op: "place", service: "sun2", row: "piano", member: "m-ana" }]).code).toBe("unknown_row");
    expect(refused([{ op: "place", service: "sat2", row: "coro", member: "m-dani" }]).code).toBe("row_not_on_column");
    expect(refused([{ op: "place", service: "sat-done", row: "bgv", member: "m-dani" }]).code).toBe("column_not_created");
    expect(refused([{ op: "clear", service: "sat-done", row: "bgv", member: "m-dani" }]).code).toBe("column_not_created");
    expect(refused([{ op: "move", from: { service: "sun1", row: "lead", member: "m-ana" }, to: { service: "sat-done", row: "bgv" } }]).code).toBe("column_not_created");
    expect(refused([{ op: "move", from: { service: "sun1", row: "lead", member: "m-ana" }, to: { service: "sun1", row: "lead" } }]).code).toBe("same_seat");
    expect(refused([{ op: "exchange", a: { service: "sun1", row: "lead", member: "m-ana" }, b: { service: "sun1", row: "lead", member: "m-ana" } }]).code).toBe("same_seat");
  });

  it("R14: a cell holds at most four times the largest target", () => {
    expect(CELL_LIMIT).toBe(12);
    const people = Array.from({ length: CELL_LIMIT }, (_, i) => ({ _id: `m-v${i}`, member_name: `Voz ${i}`, memberType: ["voz"] }));
    const crowded = board(DRAFTS.map((d) => (d.draft.localId === "sun2" ? draft("sun2", "sunday_role", "2026-11-08", { chorus: people.map((p) => p._id) }) : d)));
    const out = replayEdits({ board: crowded, edits: [{ op: "place", service: "sun2", row: "coro", member: "m-dani" }], members: [...MEMBERS, ...people], config: RULES });
    expect(out.ok).toBe(false);
    if (!out.ok) expect(out.refusal).toMatchObject({ code: "cell_limit", sentence: REPLAY_SENTENCES.cell_limit });
  });

  it("too many edits refuses before judging any", () => {
    const edits = Array.from({ length: MAX_EDITS + 1 }, () => ({ op: "clear", service: "sun2", row: "lead", member: "m-ana" }) as EditorEdit);
    expect(refused(edits)).toMatchObject({ index: MAX_EDITS, code: "too_many_edits", sentence: E.tooManyEdits(MAX_EDITS) });
  });

  it("the first refusal stops the replay and the board is the one before it", () => {
    const out = replay([
      { op: "place", service: "sun2", row: "bgv", member: "m-dani" },
      { op: "place", service: "sun2", row: "lead", member: "m-ana" },
      { op: "place", service: "sun2", row: "coro", member: "m-carla" },
    ]);
    expect(out.ok).toBe(false);
    if (out.ok) return;
    expect(out.refusal.index).toBe(1);
    expect(seat(out.board, "sun2", "bgv")).toEqual(["m-dani"]);
    expect(seat(out.board, "sun2", "coro")).toEqual([]);
  });
});

describe("each edit kind", () => {
  it("place, clear, move and exchange change exactly their seats", () => {
    const out = replay([
      { op: "place", service: "sun2", row: "bgv", member: "m-dani" },
      { op: "move", from: { service: "sun2", row: "bgv", member: "m-dani" }, to: { service: "sun2", row: "coro" } },
      { op: "place", service: "dec3", row: "lead", member: "m-bruno" },
      { op: "clear", service: "sun1", row: "lead", member: "m-ana" },
    ]);
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    expect(seat(out.board, "sun2", "coro")).toEqual(["m-dani"]);
    expect(seat(out.board, "sun2", "bgv")).toEqual([]);
    expect(seat(out.board, "dec3", "lead")).toEqual(["m-bruno"]);
    expect(seat(out.board, "sun1", "lead")).toEqual([]);
    expect(out.verdicts.map((v) => v.op)).toEqual(["place", "move", "place", "clear"]);
    expect(out.verdicts[0].placed).toEqual([{ service: "sun2", row: "bgv", member: "m-dani", unavailable: false }]);

    const swapped = replay([
      { op: "place", service: "dec3", row: "lead", member: "m-bruno" },
      { op: "exchange", a: { service: "sun1", row: "lead", member: "m-ana" }, b: { service: "dec3", row: "lead", member: "m-bruno" }, force: true },
    ]);
    expect(swapped.ok).toBe(true);
    if (!swapped.ok) return;
    expect(seat(swapped.board, "sun1", "lead")).toEqual(["m-bruno"]);
    expect(seat(swapped.board, "dec3", "lead")).toEqual(["m-ana"]);
    // Ana onto Dec 20's Lead was forced past her exclusion; Bruno onto Nov 1 was clean.
    expect(swapped.verdicts[1].forced.map((f) => [f.seat.service, f.rules.map((r) => r.ruleId)])).toEqual([["dec3", ["restriction[0].pattern[0]"]]]);
    // Not forced, the same exchange is a C4 refusal of the whole unit.
    const unforced = replay([
      { op: "place", service: "dec3", row: "lead", member: "m-bruno" },
      { op: "exchange", a: { service: "sun1", row: "lead", member: "m-ana" }, b: { service: "dec3", row: "lead", member: "m-bruno" } },
    ]);
    expect(unforced.ok).toBe(false);
    if (!unforced.ok) {
      expect(unforced.refusal).toMatchObject({ index: 1, code: "hard_rule" });
      expect(seat(unforced.board, "sun1", "lead")).toEqual(["m-ana"]);
    }
  });

  it("an exchange inside a column where the pair rule binds the two: judged without either, no spurious C4", () => {
    // Bruno and Dani may not coincide, yet both sit on Nov 1 (the solver's doing); they trade seats.
    const pairRules = rules({ conflicts: [{ id: "c", personA: "Bruno", personB: "Dani", pattern: "*.*" }] });
    const both = board(DRAFTS.map((d) => (d.draft.localId === "sun1" ? draft("sun1", "sunday_role", "2026-11-01", { leads: ["m-bruno"], bgvs: ["m-dani"] }) : d)));
    const traded = replayEdits({
      board: both,
      edits: [{ op: "exchange", a: { service: "sun1", row: "lead", member: "m-bruno" }, b: { service: "sun1", row: "bgv", member: "m-dani" } }],
      members: MEMBERS,
      config: pairRules,
    });
    expect(traded.ok).toBe(true);
    if (!traded.ok) return;
    expect(traded.verdicts[0].forced).toEqual([]);
    expect(seat(traded.board, "sun1", "lead")).toEqual(["m-dani"]);
    expect(seat(traded.board, "sun1", "bgv")).toEqual(["m-bruno"]);
    // The same two as two separate moves: the first lands next to the other and is a C4.
    const asMoves = replayEdits({
      board: both,
      edits: [{ op: "move", from: { service: "sun1", row: "lead", member: "m-bruno" }, to: { service: "sun1", row: "coro" } }],
      members: MEMBERS,
      config: pairRules,
    });
    expect(asMoves.ok).toBe(false);
    if (!asMoves.ok) expect(asMoves.refusal.code).toBe("hard_rule");
  });

  it("the unavailable badge is reported, never a refusal", () => {
    const away = MEMBERS.map((m) => (m._id === "m-dani" ? { ...m, unavailableDates: ["2026-11-08"] } : m));
    const out = replayEdits({ board: B(), edits: [{ op: "place", service: "sun2", row: "bgv", member: "m-dani" }], members: away, config: RULES });
    expect(out.ok).toBe(true);
    if (out.ok) expect(out.verdicts[0].placed[0].unavailable).toBe(true);
  });

  it("seatedIds lists every seated member once", () => {
    expect(seatedIds(B().cells)).toEqual(["m-ana"]);
  });
});
