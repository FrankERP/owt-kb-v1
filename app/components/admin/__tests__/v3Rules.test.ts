// Solver v3 C6 RQ-5 — per month, `==` rules and presence from the month SOURCE, `<=`/`>=` caps and
// pairs from the screen through IF2-16/IF2-17 only, names through C3's exactly-one resolver, every
// id minted. Rules are named by card label in lines and by kind + ordinal in tests (KH-1).
import { afterEach, describe, expect, it, vi } from "vitest";

const spies = vi.hoisted(() => ({ roles: vi.fn(), value: vi.fn() }));
vi.mock("../plannerModel", async (importOriginal) => {
  const real = await importOriginal<typeof import("../plannerModel")>();
  spies.roles.mockImplementation(real.rolesOfPatternV3);
  return { ...real, rolesOfPatternV3: (p: string) => spies.roles(p) };
});
vi.mock("../serviceRuleContext", async (importOriginal) => {
  const real = await importOriginal<typeof import("../serviceRuleContext")>();
  spies.value.mockImplementation(real.capValueForMonth);
  return { ...real, capValueForMonth: (c: never, m: string) => spies.value(c, m) };
});

import { collectV3Rules, emitV3Rules, mintInputOf, ruleReferences } from "../v3Rules";
import { mintRuleIds } from "../v3RuleIds";
import type { MonthSource } from "../v3MonthSources";
import { ALL_IN, MEMBERS, NAME_SHAPED, cap, config, ledgerResponse, restriction } from "./v3Fixtures";
import type { FairnessMonthBody } from "@/app/utils/fairnessVocabulary";

afterEach(() => { spies.roles.mockClear(); spies.value.mockClear(); });

type Person = FairnessMonthBody["people"][number];
const person = (memberId: string, over: Partial<Person> = {}): Person =>
  ({ memberId, roles: { ...ALL_IN }, exactRules: [], exempt: false, blocks: [], ...over });
const source = (month: string, over: Partial<FairnessMonthBody> = {}, state: MonthSource["state"] = "unrecorded"): MonthSource =>
  ({ month, state, rev: null, recordedAt: null, body: { month, people: [], presence: [], ...over } });

describe("caps from the screen (IF2-16, IF2-17)", () => {
  it("a relative cap resolves per month: a 5-Sunday and a 4-Sunday month", () => {
    const cfg = config({ restrictions: [restriction("r-ana", "Ana", { caps: [cap("c", "Sun.BGV", "<=", 0, { relative: true, relOffset: 2 })] })] });
    const out = collectV3Rules({ months: ["2026-11", "2026-12"], sources: [source("2026-11"), source("2026-12")], config: cfg, members: MEMBERS });
    if (!out.ok) throw new Error(out.lines.join());
    expect(out.rules.caps[0].values).toEqual([{ month: "2026-11", value: 3 }, { month: "2026-12", value: 2 }]);
  });

  it("every roles list comes from IF2-16 and every <=/>= value from IF2-17 — never for an == cap", () => {
    const cfg = config({ restrictions: [restriction("r-ana", "Ana", { caps: [cap("le", "Sun.*", "<=", 2), cap("eq", "Sun.Lead", "==", 2)] })] });
    const out = collectV3Rules({ months: ["2026-11"], sources: [source("2026-11")], config: cfg, members: MEMBERS });
    if (!out.ok) throw new Error(out.lines.join());
    expect(spies.roles).toHaveBeenCalledWith("Sun.*");
    expect(out.rules.caps[0].roles).toEqual(spies.roles.mock.results.find((r, i) => spies.roles.mock.calls[i][0] === "Sun.*")!.value);
    expect(spies.value.mock.calls.map(([c]) => (c as { op: string }).op)).toEqual(["<="]);
  });

  it.each([
    ["a fractional fixed value", cap("c", "Sun.Lead", "<=", 1.5), "no da un número entero de lugares en noviembre"],
    ["a fractional relOffset that is not clamped", cap("c", "Sun.Lead", "<=", 0, { relative: true, relOffset: 0.5 }), "no da un número entero de lugares en noviembre"],
    ["a non-finite value", cap("c", "Sun.Lead", ">=", Number.NaN), "no da un número entero de lugares en noviembre"],
    ["a fixed -1", cap("c", "Sun.Lead", ">=", -1), "pide un número negativo de lugares"],
  ])("IF2-17 ok:false (%s) refuses before the fetch, naming the card, never rounding", (_name, theCap, fragment) => {
    const cfg = config({ restrictions: [restriction("r-ana", "Ana", { caps: [theCap] })] });
    const out = collectV3Rules({ months: ["2026-11"], sources: [source("2026-11")], config: cfg, members: MEMBERS });
    expect(out.ok).toBe(false);
    if (!out.ok) {
      expect(out.lines).toHaveLength(1);
      expect(out.lines[0]).toMatch(/^No se puede correr Auto: «Ana · Sun\.Lead /);
      expect(out.lines[0]).toContain(fragment);
    }
  });

  it("a not_whole result in the SECOND month alone names only that month", () => {
    // Dec 2026 has 4 Sundays (4 − 4.5 clamps to 0, whole); Jan 2027 has 5 (5 − 4.5 = 0.5).
    const cfg = config({ restrictions: [restriction("r-ana", "Ana", { caps: [cap("c", "Sun.BGV", "<=", 0, { relative: true, relOffset: 4.5 })] })] });
    const out = collectV3Rules({ months: ["2026-12", "2027-01"], sources: [source("2026-12"), source("2027-01")], config: cfg, members: MEMBERS });
    expect(out).toEqual({ ok: false, lines: ["No se puede correr Auto: «Ana · Sun.BGV <= sem−4.5» no da un número entero de lugares en enero. Corrige su número."] });
  });

  it("a relative cap clamped to 0 is sent as 0 and noticed", () => {
    const cfg = config({ restrictions: [restriction("r-ana", "Ana", { caps: [cap("c", "Sun.BGV", "<=", 0, { relative: true, relOffset: 6 })] })] });
    const out = collectV3Rules({ months: ["2026-11"], sources: [source("2026-11")], config: cfg, members: MEMBERS });
    if (!out.ok) throw new Error(out.lines.join());
    expect(out.rules.caps[0].values).toEqual([{ month: "2026-11", value: 0 }]);
    expect(out.notices).toContain("Ana · Sun.BGV <= sem−6 queda en 0 en noviembre (tiene 5 domingos).");
  });

  it("an ambiguous name on a <= cap refuses — even when every horizon month is bound", () => {
    const twoAnas = [...MEMBERS, { _id: "m-ana-2", member_name: "Ana Ruiz", alias: "Ana", memberType: ["voz"] }];
    const cfg = config({ restrictions: [restriction("r-ana", "Ana", { caps: [cap("c", "Sun.BGV", "<=", 2)] })] });
    const out = collectV3Rules({ months: ["2026-11"], sources: [source("2026-11", {}, "bound")], config: cfg, members: twoAnas });
    expect(out).toEqual({ ok: false, lines: ["No se puede correr Auto: «Ana» en las reglas coincide con más de una persona. Corrige el nombre en la regla."] });
  });
});

describe("== rules and presence from the month source", () => {
  it("a bound month sends its record's count, a recorded-unbound month the screen's (via the resolver body)", () => {
    const cfg = config({ restrictions: [restriction("r-ana", "Ana", { caps: [cap("eq", "Sun.Lead", "==", 3)] })] });
    const bound = source("2026-11", { people: [person("m-ana", { exactRules: [{ roles: ["Sun.Lead"], count: 2 }] })] }, "bound");
    const fromScreen = source("2026-12", { people: [person("m-ana", { exactRules: [{ roles: ["Sun.Lead"], count: 3 }] })] }, "recorded_unbound");
    const out = collectV3Rules({ months: ["2026-11", "2026-12"], sources: [bound, fromScreen], config: cfg, members: MEMBERS });
    if (!out.ok) throw new Error(out.lines.join());
    expect(out.rules.exact.map((x) => [x.month, x.count, x.card])).toEqual([
      ["2026-11", 2, { ri: 0, ci: 0 }],
      ["2026-12", 3, { ri: 0, ci: 0 }],
    ]);
    expect(out.rules.caps).toEqual([]);
  });

  it("presence is month-scoped from each source: two months with different members are two objects, one id, no refusal", () => {
    const nov = source("2026-11", { presence: [{ ruleKey: "d-carla-dani", roles: ["Sun.BGV"], members: ["m-carla", "m-dani"], exclusive: false }] });
    const dec = source("2026-12", { presence: [{ ruleKey: "d-carla-dani", roles: ["Sun.BGV"], members: ["m-carla", "m-bruno"], exclusive: true }] });
    const out = collectV3Rules({ months: ["2026-11", "2026-12"], sources: [nov, dec], config: NAME_SHAPED, members: MEMBERS });
    if (!out.ok) throw new Error(out.lines.join());
    const ids = mintRuleIds(NAME_SHAPED, mintInputOf(out.rules, []));
    const presence = emitV3Rules(out.rules, ids).filter((r) => r.kind === "presence");
    expect(presence).toEqual([
      { kind: "presence", id: "r1", persons: ["m-carla", "m-dani"], roles: ["Sun.BGV"], exclusive: false, month: "2026-11" },
      { kind: "presence", id: "r1", persons: ["m-carla", "m-bruno"], roles: ["Sun.BGV"], exclusive: true, month: "2026-12" },
    ]);
  });

  it("pairs come from the screen once, horizon-wide (no month), names resolved exactly once", () => {
    const out = collectV3Rules({ months: ["2026-11", "2026-12"], sources: [source("2026-11"), source("2026-12")], config: NAME_SHAPED, members: MEMBERS });
    if (!out.ok) throw new Error(out.lines.join());
    const rules = emitV3Rules(out.rules, mintRuleIds(NAME_SHAPED, mintInputOf(out.rules, [])));
    const pairs = rules.filter((r) => r.kind === "pair");
    expect(pairs).toHaveLength(1);
    expect(pairs[0]).toEqual({ kind: "pair", id: "p1", persons: ["m-ana", "m-bruno"], roles: ["Sun.Lead", "Sat.Lead", "Sun.BGV", "Sat.BGV", "Sun.Choir", "Sat.Choir"] });
    expect(rules.some((r) => r.id === "mandatory_lead")).toBe(false);
  });
});

describe("week exclusions (RQ-5): a month solved from the screen without that week is noticed, never refused", () => {
  it("week 5 in December 2026 (4 Sundays, no trailing Saturday) — and not in October (its 31st is week 5)", () => {
    const cfg = config({ restrictions: [restriction("r-ana", "Ana", { weekExclusions: [{ id: "w", week: 5, pattern: "Sat.*" }] })] });
    const dec = collectV3Rules({ months: ["2026-12"], sources: [source("2026-12")], config: cfg, members: MEMBERS });
    const oct = collectV3Rules({ months: ["2026-10"], sources: [source("2026-10")], config: cfg, members: MEMBERS });
    const bound = collectV3Rules({ months: ["2026-12"], sources: [source("2026-12", {}, "bound")], config: cfg, members: MEMBERS });
    expect(dec.ok && dec.notices).toEqual(["Ana · sem.5 Sat.* no aplica en diciembre: ese mes no tiene semana 5."]);
    expect(oct.ok && oct.notices).toEqual([]);
    expect(bound.ok && bound.notices).toEqual([]);
  });
});

describe("labels and KH-3 entries", () => {
  it("a matched exact item takes its card's label and ordinal; an unmatched one says «regla fija registrada» and its facts", () => {
    const cfg = config({ restrictions: [restriction("r-ana", "Ana", { caps: [cap("eq", "Sun.Lead", "==", 2)] })] });
    const nov = source("2026-11", { people: [
      person("m-ana", { exactRules: [{ roles: ["Sun.Lead"], count: 2 }] }),
      person("m-bruno", { exactRules: [{ roles: ["Sat.Lead"], count: 1 }] }),
    ] }, "bound");
    const out = collectV3Rules({ months: ["2026-11"], sources: [nov], config: cfg, members: MEMBERS });
    if (!out.ok) throw new Error(out.lines.join());
    const ids = mintRuleIds(cfg, mintInputOf(out.rules, []));
    const { labels, table } = ruleReferences(out.rules, ids, cfg, ledgerResponse(["2026-11"]), []);
    expect(labels.get("c1")).toBe("Ana · Sun.Lead == 2");
    expect(labels.get("x1")).toBe("regla fija registrada de noviembre");
    expect(table).toEqual([
      { wire: "c1", kind: "count", ordinal: "restrictions[0].caps[0]" },
      { wire: "x1", kind: "count", ordinal: "sin tarjeta, 2026-11 m-bruno Sat.Lead" },
    ]);
  });

  it("a presence id with no card, and a carried-only P: key, read «regla de presencia registrada» with their GET index", () => {
    const nov = source("2026-11", { presence: [{ ruleKey: "d-deleted", roles: ["Sun.BGV"], members: ["m-carla", "m-dani"], exclusive: false }] }, "bound");
    const out = collectV3Rules({ months: ["2026-11"], sources: [nov], config: NAME_SHAPED, members: MEMBERS });
    if (!out.ok) throw new Error(out.lines.join());
    const carried = ["d-carla-dani", "d-old"];
    const ids = mintRuleIds(NAME_SHAPED, mintInputOf(out.rules, carried));
    const ledger = ledgerResponse(["2026-11"]);
    const { labels, table } = ruleReferences(out.rules, ids, NAME_SHAPED, ledger, carried);
    expect(labels.get(ids.presence("d-deleted"))).toBe("regla de presencia registrada");
    expect(labels.get(ids.presence("d-carla-dani"))).toBe("Carla, Dani en Sun.BGV c/sem");
    expect(table.filter((e) => e.wire.startsWith("P:")).map((e) => e.wire).sort()).toEqual(
      [`P:${ids.presence("d-carla-dani")}`, `P:${ids.presence("d-old")}`].sort(),
    );
    expect(table.find((e) => e.wire === `P:${ids.presence("d-carla-dani")}`)?.ordinal).toBe("presence[0]");
  });
});
