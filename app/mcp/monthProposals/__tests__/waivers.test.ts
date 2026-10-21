// The editor's whole-board rule invariant (plan T2.2, A4): what is the solver's, what appeared on
// its own, what was waived before, what this call must confirm, and what a save stores. Pure.
import { describe, expect, it } from "vitest";

import { boardFindings, type EditorBoard } from "../editorBoard";
import { replayEdits, type EditorEdit } from "../revise";
import { confirmVerdict, everyFindingExplained, judgeBoard, type BoardJudgement } from "../waivers";
import type { FindingKey, Waiver } from "../proposalDocument";
import { DRAFTS, MEMBERS, RULES, board, draft, rules } from "./editorFixtures";
import { restriction } from "@/app/components/admin/__tests__/v3Fixtures";

type Config = typeof RULES;

function judged(edits: EditorEdit[], opts: { base?: EditorBoard; config?: Config; baseline?: FindingKey[] | null; inherited?: Waiver[] } = {}): BoardJudgement {
  const base = opts.base ?? board(DRAFTS);
  const config = opts.config ?? RULES;
  const out = replayEdits({ board: base, edits, members: MEMBERS, config });
  if (!out.ok) throw new Error(`replay refused: ${out.refusal.code} at ${out.refusal.index}`);
  return judgeBoard({
    board: out.board,
    findings: boardFindings(out.board, MEMBERS, config)!,
    baseFindings: boardFindings(base, MEMBERS, config)!,
    baseline: opts.baseline === undefined ? null : opts.baseline,
    inherited: opts.inherited ?? [],
    forced: out.verdicts.flatMap((v) => v.forced),
  });
}

const rulesOf = (xs: ReadonlyArray<{ key: FindingKey }>) => xs.map((x) => `${x.key.service}:${x.key.row}:${x.key.rule}:${x.key.members.join("+")}`);
const ANA_SUN1 = "sun1:lead:restriction[0].pattern[0]:m-ana";
const ANA_SUN2 = "sun2:lead:restriction[0].pattern[0]:m-ana";
const FORCE_ANA_SUN2: EditorEdit = { op: "place", service: "sun2", row: "lead", member: "m-ana", force: true };

describe("judgeBoard", () => {
  it("the solve's own breach is its baseline: a solver warning, nothing to confirm, nothing stored", () => {
    const j = judged([]);
    expect(rulesOf(j.solver)).toEqual([ANA_SUN1]);
    expect(rulesOf(j.baseline.map((key) => ({ key })))).toEqual([ANA_SUN1]);
    expect(j.diff).toEqual([]);
    expect(j.waivers).toEqual([]);
  });

  it("a forced seat is the diff and becomes a waiver", () => {
    const j = judged([FORCE_ANA_SUN2]);
    expect(rulesOf(j.diff)).toEqual([ANA_SUN2]);
    expect(rulesOf(j.waivers)).toEqual([ANA_SUN2]);
    expect(rulesOf(j.solver)).toEqual([ANA_SUN1]);
  });

  it("A4: re-forcing the solver's own breach stores a waiver though the diff is empty", () => {
    const j = judged([
      { op: "clear", service: "sun1", row: "lead", member: "m-ana" },
      { op: "place", service: "sun1", row: "lead", member: "m-ana", force: true },
    ]);
    expect(j.diff).toEqual([]);
    expect(rulesOf(j.waivers)).toEqual([ANA_SUN1]);
  });

  it("a kept waiver needs no confirming again, and survives an unrelated edit elsewhere", () => {
    const first = judged([FORCE_ANA_SUN2]);
    const base = board(DRAFTS.map((d) => (d.draft.localId === "sun2" ? draft("sun2", "sunday_role", "2026-11-08", { leads: ["m-ana"] }) : d)));
    const j = judged([{ op: "place", service: "dec3", row: "bgv", member: "m-dani" }], { base, baseline: first.baseline, inherited: first.waivers });
    expect(j.diff).toEqual([]);
    expect(rulesOf(j.waivers)).toEqual([ANA_SUN2]);
    expect(j.dropped).toEqual([]);
  });

  it("a waiver is dropped when its seat no longer holds its member", () => {
    const first = judged([FORCE_ANA_SUN2]);
    const base = board(DRAFTS.map((d) => (d.draft.localId === "sun2" ? draft("sun2", "sunday_role", "2026-11-08", { leads: ["m-ana"] }) : d)));
    const j = judged([{ op: "clear", service: "sun2", row: "lead", member: "m-ana" }], { base, baseline: first.baseline, inherited: first.waivers });
    expect(rulesOf(j.dropped)).toEqual([ANA_SUN2]);
    expect(j.waivers).toEqual([]);
  });

  it("a rename makes the rule resolve to nobody: the waiver is kept dormant, and covers it again when reverted", () => {
    const first = judged([FORCE_ANA_SUN2]);
    const base = board(DRAFTS.map((d) => (d.draft.localId === "sun2" ? draft("sun2", "sunday_role", "2026-11-08", { leads: ["m-ana"] }) : d)));
    const renamed = rules({ restrictions: [restriction("x-ana", "Anita", { excludedPatterns: ["Sun.Lead"] })] });
    const dormant = judged([], { base, config: renamed, baseline: first.baseline, inherited: first.waivers });
    expect(rulesOf(dormant.dormant)).toEqual([ANA_SUN2]);
    expect(rulesOf(dormant.waivers)).toEqual([ANA_SUN2]);
    const back = judged([], { base, config: RULES, baseline: first.baseline, inherited: dormant.waivers });
    expect(back.diff).toEqual([]);
    expect(back.dormant).toEqual([]);
    expect(rulesOf(back.waivers)).toEqual([ANA_SUN2]);
  });

  it("a breach on the base board outside the baseline «appeared»: a warning, never in the diff", () => {
    // A v2 base whose baseline is empty (the rule was renamed back after the solve).
    const j = judged([], { baseline: [] });
    expect(rulesOf(j.appeared)).toEqual([ANA_SUN1]);
    expect(j.diff).toEqual([]);
    expect(j.solver).toEqual([]);
  });

  it("two forced seats with a pair rule between them: ONE pair finding, one waiver, in one call or across two", () => {
    const pair = rules({ conflicts: [{ id: "c", personA: "Bruno", personB: "Dani", pattern: "*.*" }] });
    const edits: EditorEdit[] = [
      { op: "place", service: "dec3", row: "lead", member: "m-bruno" },
      { op: "place", service: "dec3", row: "bgv", member: "m-dani", force: true },
    ];
    const once = judged(edits, { config: pair });
    expect(once.diff.map((f) => f.key)).toEqual([{ kind: "pair", rule: "conflict[0]", service: "dec3", row: null, members: ["m-bruno", "m-dani"] }]);
    expect(once.waivers).toHaveLength(1);
    const base = board(DRAFTS.map((d) => (d.draft.localId === "dec3" ? draft("dec3", "sunday_role", "2026-12-20", { leads: ["m-bruno"], bgvs: ["m-dani"] }) : d)));
    const later = judged([{ op: "move", from: { service: "dec3", row: "bgv", member: "m-dani" }, to: { service: "dec3", row: "coro" }, force: true }], {
      base, config: pair, baseline: once.baseline, inherited: once.waivers,
    });
    expect(later.diff).toEqual([]);
    expect(later.waivers).toHaveLength(1);
  });

  it("a waived pair exchanged inside its column stays covered; across columns the old one drops and the new pair is a diff", () => {
    const pair = rules({ conflicts: [{ id: "c", personA: "Bruno", personB: "Dani", pattern: "*.*" }] });
    const first = judged([
      { op: "place", service: "dec3", row: "lead", member: "m-bruno" },
      { op: "place", service: "dec3", row: "bgv", member: "m-dani", force: true },
    ], { config: pair });
    const base = board(DRAFTS.map((d) => {
      if (d.draft.localId === "dec3") return draft("dec3", "sunday_role", "2026-12-20", { leads: ["m-bruno"], bgvs: ["m-dani"] });
      if (d.draft.localId === "sun2") return draft("sun2", "sunday_role", "2026-11-08", { leads: ["m-bruno"], bgvs: ["m-carla"] });
      return d;
    }));
    const inside = judged([{ op: "exchange", a: { service: "dec3", row: "lead", member: "m-bruno" }, b: { service: "dec3", row: "bgv", member: "m-dani" } }], {
      base, config: pair, baseline: first.baseline, inherited: first.waivers,
    });
    expect(inside.diff).toEqual([]);
    expect(inside.waivers).toHaveLength(1);
    // Across columns: Dani (Dec 20) trades with Carla (Nov 8), where Bruno also leads. The old pair
    // drops with its seat; the new one is the gate's C4, and forced it is this call's diff.
    const across: EditorEdit = { op: "exchange", a: { service: "dec3", row: "bgv", member: "m-dani" }, b: { service: "sun2", row: "bgv", member: "m-carla" } };
    const unforced = replayEdits({ board: base, edits: [across], members: MEMBERS, config: pair });
    expect(unforced.ok).toBe(false);
    if (!unforced.ok) expect(unforced.refusal.code).toBe("hard_rule");
    const forced = judged([{ ...across, force: true } as EditorEdit], { base, config: pair, baseline: first.baseline, inherited: first.waivers });
    expect(forced.dropped).toHaveLength(1);
    expect(forced.diff.map((f) => [f.key.kind, f.key.service])).toEqual([["pair", "sun2"]]);
    expect(forced.waivers.map((w) => w.key.service)).toEqual(["sun2"]);
  });

  it("two rules with identical wording stay two findings", () => {
    const twins = rules({
      restrictions: [
        restriction("x-ana-1", "Ana", { excludedPatterns: ["Sun.Lead"] }),
        restriction("x-ana-2", "Ana", { excludedPatterns: ["Sun.Lead"] }),
      ],
    });
    const j = judged([{ op: "place", service: "sun2", row: "lead", member: "m-ana", force: true }], { config: twins });
    expect(j.diff.map((f) => f.key.rule)).toEqual(["restriction[0].pattern[0]", "restriction[1].pattern[0]"]);
    expect(new Set(j.diff.map((f) => f.sentence)).size).toBe(1);
    expect(j.waivers).toHaveLength(2);
  });

  it("Ana and Beto each excluded from Lead plus a pair on Lead, both forced into one Lead: three findings, three waivers", () => {
    const three = rules({
      restrictions: [
        restriction("x-ana", "Ana", { excludedPatterns: ["*.Lead"] }),
        restriction("x-bruno", "Bruno", { excludedPatterns: ["*.Lead"] }),
      ],
      conflicts: [{ id: "c", personA: "Ana", personB: "Bruno", pattern: "*.Lead" }],
    });
    const j = judged([
      { op: "place", service: "dec3", row: "lead", member: "m-ana", force: true },
      { op: "place", service: "dec3", row: "lead", member: "m-bruno", force: true },
    ], { config: three });
    expect(j.diff.map((f) => f.key.kind).sort()).toEqual(["exclusion", "exclusion", "pair"]);
    expect(j.waivers).toHaveLength(3);
  });
});

describe("confirmVerdict and the safety net", () => {
  it("no confirms: ok only with an empty diff; confirms must equal the diff as a set", () => {
    const j = judged([FORCE_ANA_SUN2]);
    expect(confirmVerdict([], null)).toEqual({ kind: "ok" });
    expect(confirmVerdict(j.diff, null).kind).toBe("unconfirmed");
    expect(confirmVerdict(j.diff, j.diff.map((f) => f.key))).toEqual({ kind: "ok" });
    expect(confirmVerdict(j.diff, [])).toMatchObject({ kind: "stale" });
    expect(confirmVerdict([], j.diff.map((f) => f.key))).toMatchObject({ kind: "stale" });
    const other = { ...j.diff[0].key, service: "dec3" };
    expect(confirmVerdict(j.diff, [other])).toMatchObject({ kind: "stale", diff: j.diff });
  });

  it("every finding explained by construction; a planted unwaived finding is caught", () => {
    const j = judged([FORCE_ANA_SUN2]);
    const base = boardFindings(board(DRAFTS), MEMBERS, RULES)!;
    expect(everyFindingExplained(j, base)).toBe(true);
    const planted = { key: { kind: "exclusion" as const, rule: "restriction[9].pattern[0]", service: "dec2", row: "lead", members: ["m-dani"] }, sentence: "x" };
    expect(everyFindingExplained({ ...j, findings: [...j.findings, planted] }, base)).toBe(false);
    // Dropping the stored waiver (a construction bug) is caught too.
    expect(everyFindingExplained({ ...j, waivers: [] }, base)).toBe(false);
  });
});
