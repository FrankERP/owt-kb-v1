// ADR-0092 (C1 §4.2): the consented migration of rule people from names to member ids, and its
// `--to-names` rollback, over fixtures and a fake client. Fictitious people only (public repository).
import { describe, expect, it, vi } from "vitest";

import { parseRekeyArgs, planRekey, runRekey, type RekeyDeps } from "../lib/rekeySolverRulePeople";
import { solverConfigFields, type RulePeopleRosterMember } from "@/app/utils/solverConfigWriteRequest";
import type { SolverConfig } from "@/app/components/admin/plannerModel";

const ID = { ana: "An4Ru1zQ8mL2pT6vW0yX3b", bruno: "0b7c6d5e-4f3a-4b2c-9d1e-8f7a6b5c4d3e", kim: "Ki9Mk1Ds2Ff3Gg4Hh5Jj6K", twin: "Tw1Nn2Ii3Nn4Tt5Ww6Ii7N" };
const ROSTER: RulePeopleRosterMember[] = [
  { _id: ID.ana, member_name: "Ana Ruiz", alias: "Ana", ministries: ["worship"] },
  { _id: ID.bruno, member_name: "Bruno Díaz", alias: "Bruno" },
  { _id: ID.kim, member_name: "Kim Kids", alias: "Kim", ministries: ["kids"] },
];

const cap = (id: string) => ({ id, pattern: "Sun.Lead", op: "==" as const, value: 1, relative: false, relOffset: 0 });
function config(r: string[], c: Array<[string, string]> = [], p: string[][] = []): SolverConfig {
  return {
    sundayLeads: [ID.ana],
    saturdayLeads: [],
    support: [],
    restrictions: r.map((person, i) => ({ id: `r${i}`, person, excludedPatterns: ["Sat.*"], fairness: "none", fairnessSlack: 1, weekExclusions: [], caps: [] })),
    conflicts: c.map(([a, b], i) => ({ id: `c${i}`, personA: a, personB: b, pattern: "*.*" })),
    presence: p.map((persons, i) => ({ id: `p${i}`, persons, pattern: "Sun.BGV" })),
  };
}
const doc = (c: SolverConfig, ids = false): Record<string, unknown> => ({ _id: "solverConfig", _type: "solverConfig", _rev: "rev-1", ...solverConfigFields(c), ...(ids ? { personTokens: "id" } : {}) });
const NAMES = doc(config(["Ana", "bruno díaz"], [["Ana", "Bruno"]], [["Ana", "Bruno"]]));
const noIds = (lines: string[]) => expect(lines.join("\n")).not.toMatch(new RegExp(Object.values(ID).join("|")));

describe("planRekey — names → ids", () => {
  it("a clean conversion: names only in the output, the four checks pass, a fingerprint", () => {
    const plan = planRekey(NAMES, ROSTER, "id");
    expect(plan.kind).toBe("ready");
    expect(plan.lines).toContain("«Ana» → Ana Ruiz (Ana)");
    expect(plan.lines).toContain("«bruno díaz» → Bruno Díaz (Bruno)");
    expect(plan.lines).toContain("Se leerá distinto: «bruno díaz» → «Bruno» (misma persona).");
    expect(plan.lines.some((l) => /^fingerprint: [0-9a-f]{64}$/.test(l))).toBe(true);
    noIds(plan.lines);
  });

  it("an id document has nothing to convert", () => {
    expect(planRekey(doc(config([ID.ana]), true), ROSTER, "id").kind).toBe("nothing");
  });

  it("a text that names nobody, or two people, blocks the migration", () => {
    const plan = planRekey(doc(config(["Ana", "Nadie"])), ROSTER, "id");
    expect(plan.kind).toBe("refused");
    expect(plan.lines).toContain("UNRESOLVED: «Nadie»");
    const twin = [...ROSTER, { _id: ID.twin, member_name: "Ana Ruiz", alias: "Ana", ministries: ["worship"] }];
    expect(planRekey(NAMES, twin, "id").lines).toContain("AMBIGUOUS: «Ana» (coincide con 2 personas)");
  });

  it("a change outside the person fields (a value the reader would coerce) is refused by check 1", () => {
    const coerced = { ...NAMES, restrictions: [{ ...(NAMES.restrictions as Array<Record<string, unknown>>)[0], fairness: "mystery" }] };
    const plan = planRekey(coerced, ROSTER, "id");
    expect(plan.kind).toBe("refused");
    expect(plan.lines.some((l) => l.startsWith("CHECK FAILED 1"))).toBe(true);
  });

  it("two spellings of one member that would collapse are refused (an exact overlap, a shorter presence list)", () => {
    const c = config(["Ana", "ana ruiz"]);
    c.restrictions[0].caps = [cap("k0")];
    c.restrictions[1].caps = [cap("k1")];
    expect(planRekey(doc(c), ROSTER, "id")).toMatchObject({ kind: "refused" });
    const plan = planRekey(doc(config(["Ana"], [], [["Ana", "Ana Ruiz", "Bruno"]])), ROSTER, "id");
    expect(plan.kind).toBe("refused");
    expect(plan.lines.some((l) => l.startsWith("CHECK FAILED 4"))).toBe(true);
  });

  it("flags a label someone outside Alabanza also answers to", () => {
    const roster = [...ROSTER, { _id: "kids-ana", member_name: "Ana", ministries: ["kids"] }];
    expect(planRekey(NAMES, roster, "id").lines).toContain("Ojo: «Ana» también es el nombre de alguien fuera de Alabanza.");
  });
});

describe("planRekey — ids → names (--to-names)", () => {
  it("writes every id as its label: a gone, an outside-Alabanza and a repeated person never come back as an id", () => {
    const twin = { _id: ID.twin, member_name: "Bruno Díaz", alias: "Bruno", ministries: ["worship"] };
    const ids = doc(config([ID.ana, "Gone00000000000000000001"], [[ID.bruno, ID.kim]], [[ID.ana, ID.twin]]), true);
    const plan = planRekey(ids, [...ROSTER, twin], "names");
    expect(plan.kind).toBe("ready");
    expect(plan.lines).toEqual(expect.arrayContaining([
      "«Ana»",
      "«persona que ya no está en Alabanza»",
      "«Bruno (persona repetida)»",
      "«Kim (fuera de Alabanza)»",
      "«Bruno (persona repetida) (2)»",
    ]));
    noIds(plan.lines);
  });

  it("a names document has nothing to convert back", () => {
    expect(planRekey(NAMES, ROSTER, "names").kind).toBe("nothing");
  });
});

function fakeDeps(stored: Record<string, unknown>, roster = ROSTER) {
  const out: string[] = [];
  const err: string[] = [];
  const sets: Array<Record<string, unknown>> = [];
  const unsets: unknown[] = [];
  const backups: string[] = [];
  const chain = {
    ifRevisionId: () => chain,
    set: (v: Record<string, unknown>) => (sets.push(v), chain),
    unset: (v: unknown) => (unsets.push(v), chain),
    commit: vi.fn(async () => ({})),
  };
  const deps: RekeyDeps = {
    client: {
      fetch: vi.fn(async (q: string) => (q.includes("teamMembers") ? roster : stored)),
      patch: () => chain,
    } as never,
    target: "proj · test",
    now: () => new Date("2026-11-24T18:00:00.000Z"),
    backup: (name, text) => (backups.push(text), `/tmp/${name}`),
    out: (l) => out.push(l),
    err: (l) => err.push(l),
  };
  return { deps, out, err, sets, unsets, backups };
}

describe("runRekey", () => {
  it("the dry run writes nothing; --apply with its fingerprint snapshots, then writes ids and the marker", async () => {
    const dry = fakeDeps(NAMES);
    expect(await runRekey([], dry.deps)).toBe(0);
    expect(dry.sets).toEqual([]);
    const fp = dry.out.find((l) => l.startsWith("fingerprint: "))!.slice(13);

    const run = fakeDeps(NAMES);
    expect(await runRekey(["--apply", "--fingerprint", fp], run.deps)).toBe(0);
    expect(run.backups).toHaveLength(1);
    expect(JSON.parse(run.backups[0])).toEqual(NAMES);
    expect(run.sets[0].personTokens).toBe("id");
    expect((run.sets[0].restrictions as Array<{ person: string }>).map((r) => r.person)).toEqual([ID.ana, ID.bruno]);
    expect(run.unsets).toEqual([]);
    noIds([...run.out, ...run.err]);

    // The re-run: nothing to convert.
    const written = { ...NAMES, ...run.sets[0] };
    const again = fakeDeps(written);
    expect(await runRekey([], again.deps)).toBe(0);
    expect(again.out).toContain("Las reglas ya guardan a las personas por id: 0 por convertir.");
  });

  it("refuses an apply whose fingerprint does not match, writing nothing", async () => {
    const run = fakeDeps(NAMES);
    expect(await runRekey(["--apply", "--fingerprint", "0".repeat(64)], run.deps)).toBe(1);
    expect(run.sets).toEqual([]);
    expect(run.backups).toEqual([]);
  });

  it("--to-names --apply writes names and unsets the marker", async () => {
    const ids = doc(config([ID.ana]), true);
    const dry = fakeDeps(ids);
    await runRekey(["--to-names"], dry.deps);
    const fp = dry.out.find((l) => l.startsWith("fingerprint: "))!.slice(13);
    const run = fakeDeps(ids);
    expect(await runRekey(["--to-names", "--apply", "--fingerprint", fp], run.deps)).toBe(0);
    expect((run.sets[0].restrictions as Array<{ person: string }>)[0].person).toBe("Ana");
    expect(run.sets[0].personTokens).toBeUndefined();
    expect(run.unsets).toEqual([["personTokens"]]);
  });

  it("parses its arguments strictly", () => {
    expect(parseRekeyArgs([])).toEqual({ direction: "id", apply: false, fingerprint: null });
    expect(parseRekeyArgs(["--apply"])).toBeNull();
    expect(parseRekeyArgs(["--fingerprint", "a".repeat(64)])).toBeNull();
    expect(parseRekeyArgs(["--apply", "--fingerprint", "xyz"])).toBeNull();
    expect(parseRekeyArgs(["--to-names", "--apply", "--fingerprint", "a".repeat(64)])).toEqual({ direction: "names", apply: true, fingerprint: "a".repeat(64) });
    expect(parseRekeyArgs(["--force"])).toBeNull();
  });
});
