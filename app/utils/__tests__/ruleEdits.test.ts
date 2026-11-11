// Slice R (ADR-0084): the chat's rule edits, applied by parts and judged the way the v3 solver will.
// Every row of the plan's §4, the person and pool filters (R5, R6, §9.2), the pool effects (R13), the
// eleven patterns (R12) and the deterministic ids (R8).
import { describe, expect, it } from "vitest";

import type { PersonRestriction, SolverConfig } from "@/app/components/admin/plannerModel";
import { RULE_PATTERNS } from "@/app/components/admin/ruleCopy";
import { rolesOfPatternV3 } from "@/app/components/admin/plannerModel";
import {
  RULE_DAYS,
  RULE_SEATS,
  applyRuleEdits,
  judgeRuleEdits,
  wirePatternCode,
  type NewRuleId,
  type RuleEdit,
  type RuleRosterMember,
} from "../ruleEdits";

const m = (id: string, member_name: string, memberType: string[], extra: Partial<RuleRosterMember> = {}): RuleRosterMember => ({
  _id: id,
  member_name,
  memberType,
  ...extra,
});

const ROSTER: RuleRosterMember[] = [
  m("m-mkz", "Marco Kuri", ["voz", "sunday_lead", "saturday_lead"], { alias: "Mkz" }),
  m("m-gaby", "Gabriela Soto", ["voz", "support"], { alias: "Gaby" }),
  m("m-pau", "Paulina Ríos", ["voz", "support"], { alias: "Pau" }),
  m("m-tony", "Antonio Paz", ["voz", "support"], { alias: "Tony" }),
  m("m-sat", "Sara Lima", ["voz", "saturday_lead"]),
  m("m-drum", "Diego Bat", ["instrumento"]),
  m("m-notipo", "Prueba MCP", []),
  m("m-kids", "Karla Kids", ["voz", "support"], { ministries: ["kids"] }),
  m("m-vale", "Valeria Ruiz", ["voz", "support"], { alias: "Vale" }),
  m("m-vale2", "Vale", ["voz", "support"]),
];

const base = (over: Partial<SolverConfig> = {}): SolverConfig => ({
  sundayLeads: ["m-mkz"],
  saturdayLeads: [],
  support: ["m-gaby", "m-pau", "m-tony"],
  restrictions: [],
  conflicts: [],
  presence: [],
  ...over,
});

const card = (person: string, over: Partial<PersonRestriction> = {}): PersonRestriction => ({
  id: `r-${person}`,
  person,
  excludedPatterns: [],
  fairness: "none",
  fairnessSlack: 1,
  weekExclusions: [],
  caps: [],
  ...over,
});

const ids: NewRuleId = (prefix, i, j) => `${prefix}-${i}-${j}`;
const SUN = { day: "domingo", seat: "todo" } as const;
const SUN_LEAD = { day: "domingo", seat: "líder" } as const;
const SAT_LEAD = { day: "sábado", seat: "líder" } as const;

function ok(config: SolverConfig, edits: RuleEdit[]) {
  const r = applyRuleEdits(config, edits, ROSTER, ids);
  if (!r.ok) throw new Error(r.message);
  return r;
}
function refused(config: SolverConfig, edits: RuleEdit[]): string {
  const r = applyRuleEdits(config, edits, ROSTER, ids);
  if (r.ok) throw new Error("expected a refusal");
  return r.message;
}

describe("patterns (R12)", () => {
  it("maps the words to the solver's notation", () => {
    expect(wirePatternCode({ day: "domingo", seat: "líder" })).toBe("Sun.Lead");
    expect(wirePatternCode({ day: "ambos", seat: "líder o BGV" })).toBe("*.LeadBGV");
    expect(wirePatternCode({ day: "sábado", seat: "todo" })).toBe("Sat.*");
  });

  it("refuses every day × seat outside the panel's eleven, with a hint, and accepts the eleven", () => {
    for (const day of RULE_DAYS) {
      for (const seat of RULE_SEATS) {
        const code = wirePatternCode({ day, seat });
        const r = applyRuleEdits(base(), [{ op: "never", person: "Gaby", pattern: { day, seat } }], ROSTER, ids);
        if ((RULE_PATTERNS as readonly string[]).includes(code)) {
          expect(r.ok, code).toBe(true);
          expect(rolesOfPatternV3(code).length, code).toBeGreaterThan(0);
        } else {
          expect(r.ok, code).toBe(false);
          expect(r.ok ? "" : r.message, code).toMatch(/no es una opción del panel/);
        }
      }
    }
  });

  it("the hint for «líder o BGV» on one day depends on the edit", () => {
    expect(refused(base(), [{ op: "never", person: "Gaby", pattern: { day: "domingo", seat: "líder o BGV" } }])).toMatch(/envía dos/);
    expect(refused(base(), [{ op: "count", person: "Gaby", pattern: { day: "domingo", seat: "líder o BGV" }, limit: "como máximo", value: 2 }])).toMatch(/elige «domingo, todo»/);
    expect(refused(base(), [{ op: "never", person: "Gaby", pattern: { day: "sábado", seat: "coro" } }])).toMatch(/«domingo, coro»/);
    expect(refused(base(), [{ op: "never", person: "Gaby", pattern: { day: "ambos", seat: "coro" } }])).toMatch(/«domingo, coro», o «sábado, todo»/);
  });

  it("a remove may name a stored oddity the panel no longer offers", () => {
    const r = ok(base({ restrictions: [card("Gaby", { excludedPatterns: ["Sun.LeadBGV", "Sat.*"] })] }), [
      { op: "allowAgain", person: "Gaby", pattern: { day: "domingo", seat: "líder o BGV" } },
    ]);
    expect(r.config.restrictions[0].excludedPatterns).toEqual(["Sat.*"]);
  });

  it("matches a legacy alias as its canonical pattern", () => {
    const r = ok(base({ restrictions: [card("Gaby", { excludedPatterns: ["Lead.*"] })] }), [
      { op: "never", person: "Gaby", pattern: { day: "ambos", seat: "líder" } },
    ]);
    expect(r.config.restrictions[0].excludedPatterns).toEqual(["Lead.*"]);
    expect(r.noops).toHaveLength(1);
  });
});

describe("people (R5, §9.2)", () => {
  it("resolves by name or alias and stores the display name", () => {
    const r = ok(base(), [{ op: "never", person: "gabriela soto", pattern: SUN }]);
    expect(r.config.restrictions).toEqual([card("Gaby", { id: "r-0-0", excludedPatterns: ["Sun.*"] })]);
    expect(r.lines).toEqual(["Nueva regla: «Gaby: Nunca en domingo»"]);
  });

  it("refuses someone outside Alabanza as unresolved, with close names", () => {
    expect(refused(base(), [{ op: "never", person: "Karla Kids", pattern: SUN }])).toMatch(/no nombra a nadie de Alabanza/);
    expect(refused(base(), [{ op: "never", person: "Gabi", pattern: SUN }])).toMatch(/¿Quisiste decir: .*Gaby/);
  });

  it("refuses someone without voz (no Tipo included): that rule would stop Auto", () => {
    expect(refused(base(), [{ op: "never", person: "Diego Bat", pattern: SUN }])).toMatch(/no canta en Alabanza/);
    expect(refused(base(), [{ op: "count", person: "Prueba MCP", pattern: SUN, limit: "como máximo", value: 31 }])).toMatch(/no canta en Alabanza/);
  });

  it("refuses an ambiguous name, naming the people", () => {
    const roster = [...ROSTER, m("m-gaby2", "Gaby", ["voz", "support"])];
    const r = applyRuleEdits(base(), [{ op: "never", person: "Gaby", pattern: SUN }], roster, ids);
    expect(r.ok ? "" : r.message).toMatch(/más de una persona/);
  });

  it("refuses a name whose stored alias would also name someone else", () => {
    expect(refused(base(), [{ op: "never", person: "Valeria Ruiz", pattern: SUN }])).toMatch(/se guardaría como «Vale», que también nombra a Vale/);
  });

  it("a remove may name an orphaned rule's exact text", () => {
    const r = ok(base({ restrictions: [card("Ex Miembro", { excludedPatterns: ["Sat.*"] })] }), [{ op: "removePerson", person: "ex miembro" }]);
    expect(r.config.restrictions).toEqual([]);
    expect(r.lines).toEqual(["Se quita: «Ex Miembro: Nunca en sábado»"]);
  });

  it("refuses two cards for one member", () => {
    const config = base({ restrictions: [card("Gaby"), { ...card("Gabriela Soto"), id: "r-2" }] });
    expect(refused(config, [{ op: "never", person: "Gaby", pattern: SUN }])).toMatch(/Dos reglas nombran a Gaby/);
  });
});

describe("person edits (§4)", () => {
  const withGaby = (over: Partial<PersonRestriction> = {}) => base({ restrictions: [card("Gaby", over)] });

  it("never / allowAgain", () => {
    expect(ok(withGaby(), [{ op: "never", person: "Gaby", pattern: SAT_LEAD }]).lines).toEqual([
      "Regla: «Gaby: sin cláusulas» → «Gaby: No líder en sábado»",
    ]);
    expect(ok(withGaby({ excludedPatterns: ["Sat.Lead"] }), [{ op: "allowAgain", person: "Gaby", pattern: SAT_LEAD }]).config.restrictions[0].excludedPatterns).toEqual([]);
    expect(ok(withGaby(), [{ op: "allowAgain", person: "Gaby", pattern: SAT_LEAD }]).noops).toEqual(["Ya estaba así: Gaby."]);
  });

  it("weekOff / weekOn, with ids from the edit's position", () => {
    const r = ok(base(), [{ op: "weekOff", person: "Gaby", week: 3, pattern: { day: "ambos", seat: "todo" } }]);
    expect(r.config.restrictions[0]).toMatchObject({ id: "r-0-0", weekExclusions: [{ id: "we-0-1", week: 3, pattern: "*.*" }] });
    const off = ok(withGaby({ weekExclusions: [{ id: "w1", week: 3, pattern: "*.*" }] }), [{ op: "weekOn", person: "Gaby", week: 3, pattern: { day: "ambos", seat: "todo" } }]);
    expect(off.config.restrictions[0].weekExclusions).toEqual([]);
    expect(refused(base(), [{ op: "weekOff", person: "Gaby", week: 6, pattern: SUN }])).toMatch(/de 1 a 5/);
  });

  it("count adds, replaces the one cap with that pattern and limit, and stores the panel's default for the unused field", () => {
    const added = ok(withGaby(), [{ op: "count", person: "Gaby", pattern: SUN, limit: "al menos", value: 3 }]);
    expect(added.config.restrictions[0].caps).toEqual([{ id: "cap-0-0", pattern: "Sun.*", op: ">=", value: 3, relative: false, relOffset: 2 }]);
    const rel = ok(withGaby(), [{ op: "count", person: "Gaby", pattern: SUN, limit: "como máximo", relative: { minus: 1 } }]);
    expect(rel.config.restrictions[0].caps[0]).toMatchObject({ value: 2, relative: true, relOffset: 1 });
    const replaced = ok(withGaby({ caps: [{ id: "c1", pattern: "Sun.*", op: ">=", value: 2, relative: false, relOffset: 2 }] }), [
      { op: "count", person: "Gaby", pattern: SUN, limit: "al menos", value: 3 },
    ]);
    expect(replaced.config.restrictions[0].caps).toEqual([{ id: "c1", pattern: "Sun.*", op: ">=", value: 3, relative: false, relOffset: 2 }]);
    expect(replaced.lines).toEqual(["Regla: «Gaby: Domingos: al menos 2 al mes» → «Gaby: Domingos: al menos 3 al mes»"]);
  });

  it("count refuses several matching caps, a fraction, and value with relative", () => {
    const two = withGaby({ caps: [
      { id: "c1", pattern: "Sun.*", op: "<=", value: 2, relative: false, relOffset: 2 },
      { id: "c2", pattern: "Sun.*", op: "<=", value: 3, relative: false, relOffset: 2 },
    ] });
    expect(refused(two, [{ op: "count", person: "Gaby", pattern: SUN, limit: "como máximo", value: 1 }])).toMatch(/varias reglas/);
    expect(refused(base(), [{ op: "count", person: "Gaby", pattern: SUN, limit: "al menos", value: 2.5 }])).toMatch(/entero/);
    expect(refused(base(), [{ op: "count", person: "Gaby", pattern: SUN, limit: "al menos", value: 2, relative: { minus: 1 } }])).toMatch(/no los dos/);
  });

  it("removeCount removes the one cap, refuses none", () => {
    const r = ok(withGaby({ caps: [{ id: "c1", pattern: "Sun.*", op: ">=", value: 2, relative: false, relOffset: 2 }] }), [
      { op: "removeCount", person: "Gaby", pattern: SUN, limit: "al menos" },
    ]);
    expect(r.config.restrictions[0].caps).toEqual([]);
    expect(r.notes.some((n) => /queda sin cláusulas/.test(n))).toBe(true);
    expect(refused(withGaby(), [{ op: "removeCount", person: "Gaby", pattern: SUN, limit: "al menos" }])).toMatch(/no tiene esa regla/);
  });

  it("cadence and balance", () => {
    const c = ok(base(), [{ op: "cadence", person: "Mkz", alternate: true }]);
    expect(c.config.restrictions[0].sundayCadence).toBe("alternate");
    const off = ok(base({ restrictions: [card("Mkz", { sundayCadence: "alternate" })] }), [{ op: "cadence", person: "Mkz", alternate: false }]);
    expect(off.config.restrictions[0].sundayCadence).toBeUndefined();
    const ex = ok(withGaby(), [{ op: "balance", person: "Gaby", exempt: true }]);
    expect(ex.config.restrictions[0].fairness).toBe("exempt");
    expect(ex.notes.some((n) => /registro de equidad/.test(n))).toBe(true);
    const slack = ok(withGaby({ fairness: "slack", fairnessSlack: 2 }), [{ op: "balance", person: "Gaby", exempt: false }]);
    expect(slack.config.restrictions[0].fairness).toBe("none");
  });

  it("balance exempt:false is a change: a card whose person lost voz can still be un-exempted", () => {
    const r = ok(base({ restrictions: [card("Diego Bat", { fairness: "exempt" })] }), [{ op: "balance", person: "Diego Bat", exempt: false }]);
    expect(r.config.restrictions[0].fairness).toBe("none");
  });

  it("removePerson removes only that card; refuses a person without one", () => {
    const r = ok(base({ restrictions: [card("Gaby"), card("Pau")] }), [{ op: "removePerson", person: "Gaby" }]);
    expect(r.config.restrictions.map((x) => x.person)).toEqual(["Pau"]);
    expect(refused(base(), [{ op: "removePerson", person: "Gaby" }])).toMatch(/no tiene reglas/);
  });

  it("«Mes por medio» outside Líder Domingo is a note, never a refusal", () => {
    const r = ok(base(), [{ op: "cadence", person: "Gaby", alternate: true }]);
    expect(r.notes.some((n) => /no está en Líder Domingo/.test(n))).toBe(true);
  });
});

describe("pairs and groups (§4, §9.3)", () => {
  it("notTogether adds once (order-free), refuses one member twice", () => {
    const r = ok(base(), [{ op: "notTogether", a: "Pau", b: "Tony", pattern: SUN }]);
    expect(r.config.conflicts).toEqual([{ id: "c-0-0", personA: "Pau", personB: "Tony", pattern: "Sun.*" }]);
    expect(r.lines).toEqual(["Nueva regla: «Pau y Tony no coinciden en domingo»"]);
    const again = ok(r.config, [{ op: "notTogether", a: "Tony", b: "Pau", pattern: SUN }]);
    expect(again.config.conflicts).toHaveLength(1);
    expect(again.noops).toHaveLength(1);
    expect(refused(base(), [{ op: "notTogether", a: "Pau", b: "Paulina Ríos", pattern: SUN }])).toMatch(/misma persona/);
  });

  it("removeNotTogether removes the one pair; without a pattern, several are refused", () => {
    const config = base({ conflicts: [
      { id: "c1", personA: "Pau", personB: "Tony", pattern: "Sun.*" },
      { id: "c2", personA: "Tony", personB: "Pau", pattern: "Sat.*" },
    ] });
    expect(ok(config, [{ op: "removeNotTogether", a: "Pau", b: "Tony", pattern: SUN }]).config.conflicts.map((c) => c.id)).toEqual(["c2"]);
    expect(refused(config, [{ op: "removeNotTogether", a: "Pau", b: "Tony" }])).toMatch(/varias reglas/);
  });

  it("together adds a group of 2–12, never a duplicate; removeTogether matches set-equal persons", () => {
    const r = ok(base(), [{ op: "together", persons: ["Pau", "Tony"], pattern: { day: "domingo", seat: "BGV" } }]);
    expect(r.config.presence).toEqual([{ id: "p-0-0", persons: ["Pau", "Tony"], pattern: "Sun.BGV" }]);
    expect(ok(r.config, [{ op: "together", persons: ["Tony", "Pau"], pattern: { day: "domingo", seat: "BGV" } }]).config.presence).toHaveLength(1);
    expect(ok(r.config, [{ op: "removeTogether", persons: ["Tony", "Pau"] }]).config.presence).toEqual([]);
    expect(refused(base(), [{ op: "together", persons: ["Pau"], pattern: SUN }])).toMatch(/de 2 a 12/);
    expect(refused(base(), [{ op: "together", persons: ["Pau", "Paulina Ríos"], pattern: SUN }])).toMatch(/dos veces/);
  });

  it("removeTogether refuses a repeated person rather than matching a group it does not describe", () => {
    const stored = base({ presence: [{ id: "p1", persons: ["Pau", "Tony"], pattern: "Sun.*" }] });
    expect(refused(stored, [{ op: "removeTogether", persons: ["Pau", "Pau"] }])).toMatch(/dos veces/);
    expect(refused(stored, [{ op: "removeTogether", persons: ["Pau", "Paulina Ríos"] }])).toMatch(/dos veces/);
  });
});

describe("pools (R6, R13)", () => {
  it("Frank's example: removing Mkz from Líder Sábado while he is in Líder Domingo changes nothing, and says so", () => {
    const r = ok(base({ saturdayLeads: ["m-mkz"] }), [{ op: "pool", pool: "líder sábado", remove: ["Mkz"] }]);
    expect(r.config.saturdayLeads).toEqual([]);
    expect(r.lines).toEqual([
      "Líder Sábado: − Mkz (no cambia nada: sigue en Líder Domingo, que también dirige sábados. Para que no dirija sábados: «nunca líder sábado»)",
    ]);
  });

  it("removing from both lead pools says what he stops doing", () => {
    const r = ok(base({ saturdayLeads: ["m-mkz"] }), [
      { op: "pool", pool: "líder sábado", remove: ["Mkz"] },
      { op: "pool", pool: "líder domingo", remove: ["Mkz"] },
    ]);
    expect(r.lines[0]).toBe(
      "Líder Sábado: − Mkz (deja de poder: líder domingo, líder sábado, BGV domingo, BGV sábado, coro domingo, coro sábado)",
    );
  });

  it("adding someone in a lead pool to Soporte changes nothing", () => {
    const roster = ROSTER.map((x) => (x._id === "m-mkz" ? { ...x, memberType: [...(x.memberType ?? []), "support"] } : x));
    const r = applyRuleEdits(base(), [{ op: "pool", pool: "soporte", add: ["Mkz"] }], roster, ids);
    expect(r.ok && r.lines).toEqual(["Soporte: + Mkz (no cambia nada: ya está en Líder Domingo, que también canta BGV y coro)"]);
  });

  it("an add says what the person starts doing", () => {
    const r = ok(base(), [{ op: "pool", pool: "líder sábado", add: ["Sara Lima"] }]);
    expect(r.lines).toEqual(["Líder Sábado: + Sara Lima (empieza a poder: líder sábado, BGV sábado, BGV domingo, coro domingo, coro sábado)".replace(
      "líder sábado, BGV sábado, BGV domingo, coro domingo, coro sábado", "líder sábado, BGV domingo, BGV sábado, coro domingo, coro sábado")]);
  });

  it("refuses an off-Tipo add; a stale off-Tipo tick can still be removed", () => {
    expect(refused(base(), [{ op: "pool", pool: "líder domingo", add: ["Gaby"] }])).toMatch(/no tiene el Tipo de Líder Domingo/);
    const r = ok(base({ sundayLeads: ["m-mkz", "m-gaby"] }), [{ op: "pool", pool: "líder domingo", remove: ["Gaby"] }]);
    expect(r.config.sundayLeads).toEqual(["m-mkz"]);
  });

  it("a remove takes anyone in the pool, someone who has left Alabanza included", () => {
    const r = ok(base({ support: ["m-gaby", "m-kids"] }), [{ op: "pool", pool: "soporte", remove: ["Karla Kids"] }]);
    expect(r.config.support).toEqual(["m-gaby"]);
    expect(r.lines[0]).toMatch(/^Soporte: − Karla Kids/);
    expect(refused(base(), [{ op: "pool", pool: "soporte", remove: ["Karla Kids"] }])).toMatch(/no nombra a nadie de Alabanza/);
  });

  it("refuses adding and removing the same person in one pool edit", () => {
    expect(refused(base(), [{ op: "pool", pool: "soporte", add: ["Tony"], remove: ["Antonio Paz"] }])).toMatch(/agregar y para quitar/);
  });

  it("«ya estaba así» for an add already there or a remove not there", () => {
    const r = ok(base(), [{ op: "pool", pool: "soporte", add: ["Gaby"], remove: ["Sara Lima"] }]);
    expect(r.lines).toEqual([]);
    expect(r.noops).toEqual(["Ya estaba así: Gaby ya está en Soporte.", "Ya estaba así: Sara Lima no está en Soporte."]);
  });
});

describe("R8 — the same edits on the same rules build the same document", () => {
  it("is a pure function of (stored, edits, ids)", () => {
    const edits: RuleEdit[] = [
      { op: "count", person: "Gaby", pattern: SUN, limit: "al menos", value: 3 },
      { op: "notTogether", a: "Pau", b: "Tony", pattern: SUN },
    ];
    expect(ok(base(), edits).config).toEqual(ok(base(), edits).config);
    expect(applyRuleEdits(base(), [], ROSTER, ids)).toEqual({ ok: false, message: "No hay cambios que revisar." });
  });
});

describe("judgeRuleEdits (R9, R11)", () => {
  const MONTH = "2026-12";
  const judge = (stored: SolverConfig, edits: RuleEdit[]) => judgeRuleEdits(stored, ok(stored, edits).config, ROSTER, MONTH);
  const cap = (pattern: string, op: "<=" | ">=" | "==", value: number) => ({ id: `c-${pattern}${op}${value}`, pattern, op, value, relative: false, relOffset: 2 });

  it("refuses a minimum above a maximum the edit adds, including «exactamente» and a subset pattern", () => {
    const g = (caps: ReturnType<typeof cap>[]) => base({ restrictions: [card("Gaby", { caps })] });
    expect(judge(g([cap("Sun.*", "<=", 2)]), [{ op: "count", person: "Gaby", pattern: SUN, limit: "al menos", value: 3 }]).ok).toBe(false);
    expect(judge(g([cap("Sun.*", "==", 2)]), [{ op: "count", person: "Gaby", pattern: SUN, limit: "al menos", value: 3 }]).ok).toBe(false);
    expect(judge(g([cap("Sun.*", "<=", 2)]), [{ op: "count", person: "Gaby", pattern: SUN_LEAD, limit: "al menos", value: 3 }]).ok).toBe(false);
    expect(judge(g([cap("Sun.*", "<=", 4)]), [{ op: "count", person: "Gaby", pattern: SUN_LEAD, limit: "al menos", value: 3 }]).ok).toBe(true);
  });

  it("a contradiction already stored is only noted, and an unrelated edit still goes through", () => {
    const stored = base({ restrictions: [card("Gaby", { caps: [cap("Sun.*", "<=", 2), cap("Sun.*", ">=", 3)] })] });
    const v = judge(stored, [{ op: "never", person: "Pau", pattern: SUN }]);
    expect(v.ok).toBe(true);
    expect(v.ok && v.existing.some((e) => /no se pueden cumplir juntas/.test(e))).toBe(true);
  });

  it("refuses two «exactamente» for one role (the parser's overlap)", () => {
    const stored = base({ restrictions: [card("Gaby", { caps: [cap("Sun.*", "==", 2)] })] });
    const v = judge(stored, [{ op: "count", person: "Gaby", pattern: { day: "domingo", seat: "BGV" }, limit: "exactamente", value: 1 }]);
    expect(v).toMatchObject({ ok: false, message: expect.stringMatching(/dos números «exactamente»/) });
  });

  it("refuses «Mes por medio» plus an exact Sunday-lead count as a NEW solver problem", () => {
    const stored = base({ restrictions: [card("Mkz", { caps: [cap("Sun.Lead", "==", 1)] })] });
    const v = judge(stored, [{ op: "cadence", person: "Mkz", alternate: true }]);
    expect(v).toMatchObject({ ok: false, message: expect.stringMatching(/Auto dejaría de poder correr.*Mes por medio/) });
  });

  it("refuses a 21st presence group", () => {
    const presence = Array.from({ length: 20 }, (_, i) => ({ id: `g${i}`, persons: ["Pau", "Tony"], pattern: i % 2 ? "Sun.*" : "Sat.*" }));
    const stored = base({ presence });
    const v = judge(stored, [{ op: "together", persons: ["Gaby", "Pau"], pattern: SUN }]);
    expect(v.ok).toBe(false);
  });

  it("a solver problem the stored rules already have is noted, not blocking", () => {
    const stored = base({ restrictions: [card("Nadie Existe", { excludedPatterns: ["Sat.*"] })] });
    const v = judge(stored, [{ op: "never", person: "Gaby", pattern: SUN }]);
    expect(v.ok).toBe(true);
    expect(v.ok && v.existing.some((e) => /Nadie Existe/.test(e))).toBe(true);
  });
});
