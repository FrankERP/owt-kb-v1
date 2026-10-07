// Solver v3 C2 FX-1 … FX-5 — the golden fixture (`fixtures/fairness/golden.json`,
// IF2-29), asserted by this vitest suite and by C5's Python (`gcf_v3/tests/test_golden.py`).
// Expected values are hand-computed and frozen in the file; this suite never regenerates
// them. It asserts every `ledger` and `cadence` case and schema-checks `plan` cases (C5's).
//
// What a `ledger` case asserts here (the file's `$comment` states the same):
//   · `window`: each window month and whether it is recorded;
//   · `months`: per listed month, every member with a line and every such line's
//     {share, received, balance} — exactly. A month outside the target's window (the
//     cumulative case) is checked by re-running the ledger with the target one month
//     after it, since a month's figures depend only on its own record and services;
//   · `windowTotals`: every member's window lines, exactly;
//   · `setAsides`: every set-aside of the window's months, exactly;
//   · `notes`: each listed note is emitted (others may be too);
//   · and, for every case, that the EXACT balances sum to 0 per (service, role key)
//     and per (presence rule, service) (FX-3).
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import { cadenceStates, computeFairnessLedger, fairnessLedgerExactSums, type LedgerInput } from "../fairnessLedger";
import { shiftMonth, type Figures, type LineKey, type Note, type RoleKey, type SetAsideReason } from "../fairnessVocabulary";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const FIXTURE = JSON.parse(readFileSync(path.join(REPO_ROOT, "fixtures/fairness/golden.json"), "utf8")) as {
  $comment: string;
  schemaVersion: number;
  units: string;
  sign: string;
  cases: GoldenCase[];
};

type Triple = { share: number; received: number; balance: number };
type LedgerExpected = {
  window: Array<{ month: string; recorded: boolean }>;
  months: Record<string, Record<string, Partial<Record<LineKey, Triple>>>>;
  windowTotals: Record<string, Partial<Record<LineKey, Triple>>>;
  setAsides: Array<{ serviceId: string; roleKey: RoleKey; memberId: string; reason: SetAsideReason }>;
  notes: Array<{ month: string; memberId: string; note: Note }>;
};
type GoldenCase = { id: string; description: string; covers: string[] } & (
  | { kind: "ledger"; input: LedgerInput; expected: LedgerExpected }
  | { kind: "cadence"; input: Parameters<typeof cadenceStates>[0]; expected: ReturnType<typeof cadenceStates> }
  | { kind: "plan"; input: unknown; expected: unknown }
);

const KINDS = new Set(["ledger", "cadence", "plan"]);
/** FX-5: the spec's fictitious people only. */
const FICTITIOUS = /^m-(alma|bruno|carmen|diego|elena|fausto|greta|ivan|julia)$/;

/** FX-4's required coverage, by the tag each case declares in `covers`. */
const REQUIRED_COVERAGE = [
  "uneven-division",
  "unavailable-record",
  "unavailable-live",
  "unrecorded-month",
  "not-in-record",
  "role-out",
  "outside-population",
  "exact",
  "exact-clamped",
  "exact-seat-population",
  "cadence-set-aside",
  "cadence-no-sunday-saturday",
  "presence-both-available",
  "presence-one-available",
  "presence-exclusive",
  "presence-non-exclusive",
  "presence-broken-exclusive",
  "presence-seat-order",
  "floor-by-date",
  "floor-by-role",
  "floor-by-time",
  "floor-cancelled-exact",
  "floor-cancelled-cadence",
  "exact-under-presence",
  "floor-outside-population",
  "special-sunday",
  "special-friday",
  "uncounted-special",
  "legacy-default",
  "drafts-count",
  "duplicate-target",
  "target-and-later-ignored",
  "cumulative-span",
  "exempt",
  "second-seat-two-roles",
  "second-seat-repeated",
  "exact-half",
  "cadence-on",
  "led-previous-month",
  "not-eligible-then-on",
  "no-available-sunday",
  "assumed-led-previous-month",
  "off-then-on",
  "pinned-sunday-counts",
];

const triple = (f: Figures): Triple => ({ share: f.share, received: f.received, balance: f.balance });
const triples = (lines: Partial<Record<LineKey, Figures>>) =>
  Object.fromEntries(Object.entries(lines).map(([line, f]) => [line, triple(f as Figures)]));

/** Every member's lines for `month`, members with none left out, re-targeting outside the window. */
function monthLines(input: LedgerInput, month: string): Record<string, Partial<Record<LineKey, Triple>>> {
  let out = computeFairnessLedger(input);
  if (!out.window.some((w) => w.month === month)) out = computeFairnessLedger({ ...input, target: shiftMonth(month, 1) });
  const result: Record<string, Partial<Record<LineKey, Triple>>> = {};
  for (const p of out.people) {
    const m = p.months.find((x) => x.month === month)!;
    if (Object.keys(m.lines).length > 0) result[p.memberId] = triples(m.lines);
  }
  return result;
}

const bySetAside = (a: LedgerExpected["setAsides"][number], b: LedgerExpected["setAsides"][number]) =>
  `${a.serviceId}|${a.roleKey}|${a.memberId}|${a.reason}` < `${b.serviceId}|${b.roleKey}|${b.memberId}|${b.reason}` ? -1 : 1;

describe("the golden fixture's schema (C2 IF2-29, FX-2, FX-5)", () => {
  it("has exactly IF2-29's top-level shape, plus FX-5's header", () => {
    expect(Object.keys(FIXTURE).sort()).toEqual(["$comment", "cases", "schemaVersion", "sign", "units"]);
    expect(FIXTURE).toMatchObject({ schemaVersion: 1, units: "hundredths", sign: "positive_owed" });
    expect(FIXTURE.$comment).toMatch(/FICTITIOUS/);
  });

  it("gives every case a unique kebab-case id, a known kind, a description, coverage, input and expected", () => {
    const ids = FIXTURE.cases.map((c) => c.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const c of FIXTURE.cases) {
      expect(c.id, c.id).toMatch(/^[a-z0-9]+(-[a-z0-9]+)*$/);
      expect(KINDS.has(c.kind), `${c.id}: unknown kind ${c.kind}`).toBe(true);
      expect(c.description.length, c.id).toBeGreaterThan(20);
      expect(c.covers.length, c.id).toBeGreaterThan(0);
      expect(c, c.id).toHaveProperty("input");
      expect(c, c.id).toHaveProperty("expected");
    }
  });

  it("covers every FX-4 requirement", () => {
    const covered = new Set(FIXTURE.cases.flatMap((c) => c.covers));
    expect(REQUIRED_COVERAGE.filter((tag) => !covered.has(tag))).toEqual([]);
  });

  it("names only the spec's fictitious people (FX-5)", () => {
    const ids = JSON.stringify(FIXTURE).match(/"m-[^"]*"/g) ?? [];
    for (const id of ids) expect(id.slice(1, -1)).toMatch(FICTITIOUS);
  });
});

describe("the golden fixture's ledger cases (FX-3)", () => {
  const cases = FIXTURE.cases.filter((c): c is Extract<GoldenCase, { kind: "ledger" }> => c.kind === "ledger");

  it("holds a real set of ledger cases", () => {
    expect(cases.length).toBeGreaterThanOrEqual(20);
  });

  describe.each(cases.map((c) => [c.id, c] as const))("%s", (_id, c) => {
    const out = computeFairnessLedger(c.input);

    it("matches the window", () => {
      expect(out.window.map((w) => ({ month: w.month, recorded: w.record !== null }))).toEqual(c.expected.window);
    });

    it("matches every listed month, every member, every line", () => {
      const months = new Set([...out.window.map((w) => w.month), ...Object.keys(c.expected.months)]);
      for (const month of months) expect(monthLines(c.input, month), month).toEqual(c.expected.months[month] ?? {});
    });

    it("matches the window totals", () => {
      const actual: Record<string, unknown> = {};
      for (const p of out.people) if (Object.keys(p.window).length > 0) actual[p.memberId] = triples(p.window);
      expect(actual).toEqual(c.expected.windowTotals);
    });

    it("matches every set-aside of the window", () => {
      const actual = out.people.flatMap((p) =>
        p.months.flatMap((m) => m.setAsides.map((x) => ({ serviceId: x.serviceId, roleKey: x.roleKey, memberId: p.memberId, reason: x.reason }))),
      );
      expect(actual.sort(bySetAside)).toEqual([...c.expected.setAsides].sort(bySetAside));
    });

    it("emits every listed note", () => {
      for (const { month, memberId, note } of c.expected.notes) {
        const notes = out.people.find((p) => p.memberId === memberId)?.months.find((m) => m.month === month)?.notes ?? [];
        expect(notes, `${memberId} ${month}`).toContainEqual(note);
      }
    });

    it("sums to exactly zero per (service, role key) and per (rule, service)", () => {
      for (const s of fairnessLedgerExactSums(c.input)) expect(s.numerator, `${s.month} ${s.serviceId} ${s.key}`).toBe("0");
    });
  });
});

describe("the golden fixture's cadence cases (CAD-1; TypeScript only, A18)", () => {
  const cases = FIXTURE.cases.filter((c): c is Extract<GoldenCase, { kind: "cadence" }> => c.kind === "cadence");

  it.each(cases.map((c) => [c.id, c] as const))("%s", (_id, c) => {
    expect(cadenceStates(c.input)).toEqual(c.expected);
  });
});
