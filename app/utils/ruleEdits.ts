// app/utils/ruleEdits.ts
//
// The solver rules edited BY PARTS from the chat (admin parity phase 4, slice R; ADR-0084).
//
// `applyRuleEdits` takes the freshly read rules, the chat's edits and the planner's roster, and answers
// the edited rules plus the lines Frank reads before he says «sí» — or a refusal in Spanish. It never
// writes; `solverConfigCommit.ts` does, through the panel's own serializer. `judgeRuleEdits` then judges
// the edited rules the way the v3 solver will (R9, R11) and keeps only the problems THIS edit adds.
//
// Why the server filters what the panel filters by construction (R5, R6, R12): the panel offers only
// `voz` members in its rule forms, only Tipo-fitting members in its pool checkboxes and only eleven
// patterns. The chat has no dropdown, so a name, a pool member or a pattern the panel could never produce
// would be saved, worded as a real rule, and then either stop every Auto (`no_tipo`, `unresolved`) or be
// silently ignored by the solver. Each check below uses the solver's own function, never a restatement.
//
// NEUTRAL: no I/O, no `server-only`, no "use client" (ADR-0028). Ids for new items come from the caller
// (`newId`), so the same edits on the same rules give the same document at check and at save (R8).

import { normalizeMinistries } from "@/app/ministries";
import {
  LEGACY_PATTERN_ALIASES,
  memberFitsPool,
  rolesOfPatternV3,
  type PersonRestriction,
  type RestrictionCap,
  type SolverConfig,
} from "@/app/components/admin/plannerModel";
import {
  CAP_OP_WORD,
  conflictSentence,
  isRulePattern,
  presenceSentence,
  restrictionText,
  sentenceText,
} from "@/app/components/admin/ruleCopy";
import { V3_RESOLVER_ISSUE, V3_RESOLVER_REFUSAL } from "@/app/components/admin/v3Copy";
import { pooledForRoleKey, resolveMonthEligibility, type EligibilityMember } from "./fairnessEligibility";
import { ROLE_KEYS, RECORD_LIMITS, type RoleKey } from "./fairnessVocabulary";
import { displayMemberName, rulePersonNamesMember } from "./memberRuleNames";
import { normalizeLabel } from "./normalizeLabel";
import { cadenceOutsideSundayPool, resolveRulePersonId } from "./sundayCadence";
import { exactCapOverlaps, parseSolverConfigWrite } from "./solverConfigWriteRequest";

// ── Wire ─────────────────────────────────────────────────────────────────────

export const RULE_DAYS = ["domingo", "sábado", "ambos"] as const;
export const RULE_SEATS = ["líder", "BGV", "coro", "líder o BGV", "todo"] as const;
export const RULE_LIMITS = ["exactamente", "al menos", "como máximo"] as const;
export const RULE_POOLS = ["líder domingo", "líder sábado", "soporte"] as const;

export type RuleDay = (typeof RULE_DAYS)[number];
export type RuleSeat = (typeof RULE_SEATS)[number];
export type RuleLimit = (typeof RULE_LIMITS)[number];
export type RulePool = (typeof RULE_POOLS)[number];
export interface WirePattern {
  day: RuleDay;
  seat: RuleSeat;
}

export type RuleEdit =
  | { op: "pool"; pool: RulePool; add?: string[]; remove?: string[] }
  | { op: "never"; person: string; pattern: WirePattern }
  | { op: "allowAgain"; person: string; pattern: WirePattern }
  | { op: "weekOff"; person: string; week: number; pattern: WirePattern }
  | { op: "weekOn"; person: string; week: number; pattern: WirePattern }
  | { op: "count"; person: string; pattern: WirePattern; limit: RuleLimit; value?: number; relative?: { minus: number } }
  | { op: "removeCount"; person: string; pattern: WirePattern; limit: RuleLimit }
  | { op: "cadence"; person: string; alternate: boolean }
  | { op: "balance"; person: string; exempt: boolean }
  | { op: "removePerson"; person: string }
  | { op: "notTogether"; a: string; b: string; pattern: WirePattern }
  | { op: "removeNotTogether"; a: string; b: string; pattern?: WirePattern }
  | { op: "together"; persons: string[]; pattern: WirePattern }
  | { op: "removeTogether"; persons: string[]; pattern?: WirePattern };

/** At most this many edits per call (§4). */
export const MAX_RULE_EDITS = 30;

/** The roster a rule edit resolves against: the planner's (`adminMembersQuery`), disabled included. */
export type RuleRosterMember = EligibilityMember;

/** An id for the `j`-th item edit `i` creates (R8). */
export type NewRuleId = (prefix: "r" | "c" | "p" | "cap" | "we", i: number, j: number) => string;

// ── Patterns (R12) ───────────────────────────────────────────────────────────

const DAY_CODE: Record<RuleDay, string> = { domingo: "Sun", "sábado": "Sat", ambos: "*" };
const SEAT_CODE: Record<RuleSeat, string> = { "líder": "Lead", BGV: "BGV", coro: "Choir", "líder o BGV": "LeadBGV", todo: "*" };

export const wirePatternCode = (p: WirePattern): string => `${DAY_CODE[p.day]}.${SEAT_CODE[p.seat]}`;
const canonical = (pattern: string) => LEGACY_PATTERN_ALIASES.get(pattern) ?? pattern;

type PatternUse = "exclusion" | "count";

/** The refusal for a day × seat the panel does not offer, with what to send instead (R12, §9.1). */
function patternHint(p: WirePattern, use: PatternUse): string {
  const what = `«${p.day}, ${p.seat}»`;
  if (p.seat === "líder o BGV") {
    return use === "exclusion"
      ? `${what} no es una opción del panel: envía dos, «${p.day}, líder» y «${p.day}, BGV».`
      : `${what} no es una opción del panel, que tampoco tiene esa combinación aquí: elige «${p.day}, todo» o un solo lugar.`;
  }
  if (p.seat === "coro" && p.day === "sábado") return `${what} no es una opción del panel: elige «sábado, todo» o «domingo, coro».`;
  if (p.seat === "coro" && p.day === "ambos") return `${what} no es una opción del panel: elige «domingo, coro», o «sábado, todo».`;
  return `${what} no es una opción del panel.`;
}

// ── Names (R5, R6) ───────────────────────────────────────────────────────────

const fold = (s: string) => s.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase().trim();

function worship(roster: readonly RuleRosterMember[]) {
  return roster.filter((m) => normalizeMinistries(m.ministries).includes("worship"));
}

/** How many leading letters two folded words share — «Gabi» and «Gaby» share three. */
function sharedStart(a: string, b: string): number {
  let i = 0;
  while (i < a.length && i < b.length && a[i] === b[i]) i++;
  return i;
}

/** Up to five worship names that start like `name` (accent- and case-folded). */
function closeNames(name: string, roster: readonly RuleRosterMember[]): string[] {
  const q = fold(name);
  const out = new Set<string>();
  for (const m of worship(roster)) {
    for (const n of [m.member_name ?? "", m.alias ?? ""]) {
      const f = fold(n);
      if (q && f && (f.startsWith(q) || q.startsWith(f) || f.split(/\s+/).some((w) => w.startsWith(q) || sharedStart(w, q) >= 3))) {
        out.add(displayMemberName(m));
      }
    }
  }
  return [...out].sort((a, b) => a.localeCompare(b, "es")).slice(0, 5);
}

class Refusal extends Error {}
const refuse = (message: string): never => {
  throw new Refusal(message);
};

function unresolvedMessage(name: string, roster: readonly RuleRosterMember[], matches: string[]): string {
  const byId = new Map(roster.map((m) => [m._id, m]));
  if (matches.length > 1) {
    const names = matches.map((id) => byId.get(id)).filter(Boolean).map((m) => displayMemberName(m as RuleRosterMember));
    return `«${name}» nombra a más de una persona de Alabanza (${names.join(", ")}): usa el nombre completo.`;
  }
  const close = closeNames(name, roster);
  return `«${name}» no nombra a nadie de Alabanza.${close.length ? ` ¿Quisiste decir: ${close.join(", ")}?` : ""}`;
}

/** R5: a person an ADD names — exactly one worship member, with `voz`, whose stored text names only them. */
function personToAdd(name: string, roster: readonly RuleRosterMember[]): { member: RuleRosterMember; text: string } {
  const found = resolveRulePersonId(name, [...roster]);
  if (!found.ok) return refuse(unresolvedMessage(name, roster, found.matches));
  const member = roster.find((m) => m._id === found.id) as RuleRosterMember;
  const text = (normalizeLabel(displayMemberName(member)) ?? displayMemberName(member));
  if (!(member.memberType ?? []).includes("voz")) {
    return refuse(`${text} no canta en Alabanza (su Tipo no incluye Voz); las reglas solo aplican a quien canta. Cámbialo en Personas.`);
  }
  // §9.2: the text the rule will carry must name this member alone, or the solver reads it as ambiguous.
  const back = resolveRulePersonId(text, [...roster]);
  if (!back.ok || back.id !== member._id) {
    const others = (back.ok ? [back.id] : back.matches).filter((id) => id !== member._id);
    const other = roster.find((m) => m._id === others[0]);
    return refuse(
      `${name} se guardaría como «${text}», que también nombra a ${other ? other.member_name : "otra persona"}. Cambia su alias en Personas.`,
    );
  }
  return { member, text };
}

/**
 * A person a CHANGE or REMOVE names: the member the solver resolves, or — so an orphaned rule can be
 * taken out — a rule's exact stored text (trim, case-insensitive).
 */
type Target = { member: RuleRosterMember; text: string } | { member: null; text: string };

function personToChange(name: string, roster: readonly RuleRosterMember[], storedTexts: readonly string[]): Target {
  const found = resolveRulePersonId(name, [...roster]);
  if (found.ok) {
    const member = roster.find((m) => m._id === found.id) as RuleRosterMember;
    return { member, text: (normalizeLabel(displayMemberName(member)) ?? displayMemberName(member)) };
  }
  const lo = name.trim().toLowerCase();
  const stored = storedTexts.find((t) => t.trim().toLowerCase() === lo);
  if (stored !== undefined) return { member: null, text: stored };
  return refuse(unresolvedMessage(name, roster, found.matches));
}

const names = (t: Target, ruleText: string) =>
  t.member ? rulePersonNamesMember(ruleText, { member_name: t.member.member_name ?? "", alias: t.member.alias }) : ruleText.trim().toLowerCase() === t.text.trim().toLowerCase();

// ── Pool effects (R13) ───────────────────────────────────────────────────────

const POOL_FIELD: Record<RulePool, "sundayLeads" | "saturdayLeads" | "support"> = {
  "líder domingo": "sundayLeads",
  "líder sábado": "saturdayLeads",
  soporte: "support",
};
const POOL_LABEL: Record<"sundayLeads" | "saturdayLeads" | "support", string> = {
  sundayLeads: "Líder Domingo",
  saturdayLeads: "Líder Sábado",
  support: "Soporte",
};
const ROLE_WORD: Record<RoleKey, string> = {
  "Sun.Lead": "líder domingo",
  "Sat.Lead": "líder sábado",
  "Sun.BGV": "BGV domingo",
  "Sat.BGV": "BGV sábado",
  "Sun.Choir": "coro domingo",
  "Sat.Choir": "coro sábado",
};

const rolesIn = (m: RuleRosterMember, c: SolverConfig) => ROLE_KEYS.filter((k) => pooledForRoleKey(m, c, k));

/** Why a pool change moves nothing, with the edit that does what Frank likely means. */
function noEffectWhy(m: RuleRosterMember, field: keyof typeof POOL_LABEL, added: boolean, after: SolverConfig): string {
  const inSunday = after.sundayLeads.includes(m._id) && memberFitsPool(m, "sundayLeads");
  const inSaturday = after.saturdayLeads.includes(m._id) && memberFitsPool(m, "saturdayLeads");
  if (field === "saturdayLeads" && inSunday) {
    return added
      ? "ya está en Líder Domingo, que también dirige sábados"
      : "sigue en Líder Domingo, que también dirige sábados. Para que no dirija sábados: «nunca líder sábado»";
  }
  if (field === "support" && (inSunday || inSaturday)) {
    const pool = inSunday ? "Líder Domingo" : "Líder Sábado";
    return added ? `ya está en ${pool}, que también canta BGV y coro` : `sigue en ${pool}, que también canta BGV y coro`;
  }
  return "lo que puede hacer no cambia";
}

// ── Lines ────────────────────────────────────────────────────────────────────

function ruleLines(before: SolverConfig, after: SolverConfig): string[] {
  const lines: string[] = [];
  const afterR = new Map(after.restrictions.map((r) => [r.id, r]));
  const beforeIds = new Set(before.restrictions.map((r) => r.id));
  for (const r of before.restrictions) {
    const a = afterR.get(r.id);
    if (!a) lines.push(`Se quita: «${restrictionText(r)}»`);
    else if (restrictionText(a) !== restrictionText(r)) lines.push(`Regla: «${restrictionText(r)}» → «${restrictionText(a)}»`);
  }
  for (const r of after.restrictions) if (!beforeIds.has(r.id)) lines.push(`Nueva regla: «${restrictionText(r)}»`);
  const diff = <T extends { id: string }>(b: readonly T[], a: readonly T[], text: (x: T) => string) => {
    const aIds = new Set(a.map((x) => x.id));
    const bIds = new Set(b.map((x) => x.id));
    for (const x of b) if (!aIds.has(x.id)) lines.push(`Se quita: «${text(x)}»`);
    for (const x of a) if (!bIds.has(x.id)) lines.push(`Nueva regla: «${text(x)}»`);
  };
  diff(before.conflicts, after.conflicts, (c) => sentenceText(conflictSentence(c)));
  diff(before.presence, after.presence, (p) => sentenceText(presenceSentence(p)));
  return lines;
}

// ── Apply ────────────────────────────────────────────────────────────────────

export type ApplyRuleEditsResult =
  | {
      ok: true;
      config: SolverConfig;
      /** What Frank reads: pool lines with their effect (R13), then the rules before → after. */
      lines: string[];
      /** «Ya estaba así: …», one per edit that changes nothing. */
      noops: string[];
      /** Warnings that never block (empty card, «Mes por medio» outside Líder Domingo, bound months). */
      notes: string[];
    }
  | { ok: false; message: string };

const clone = (c: SolverConfig): SolverConfig => JSON.parse(JSON.stringify(c)) as SolverConfig;
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

/** The ONE card a person edit targets (§4): several → refused. */
function cardsOf(config: SolverConfig, t: Target): PersonRestriction[] {
  const cards = config.restrictions.filter((r) => names(t, r.person));
  if (cards.length > 1) refuse(`Dos reglas nombran a ${t.text}; únelas en /admin → Generar mes → Reglas.`);
  return cards;
}

/** The person's card, created when absent; `next` is the `j` of the next item this edit creates (R8). */
function cardToEdit(config: SolverConfig, t: { member: RuleRosterMember; text: string }, newId: NewRuleId, i: number): { card: PersonRestriction; next: number } {
  const [card] = cardsOf(config, t);
  if (card) return { card, next: 0 };
  // The panel's new-card defaults (`MonthGenerator.tsx`): «Holgura» 1, never written as on.
  const created: PersonRestriction = { id: newId("r", i, 0), person: t.text, excludedPatterns: [], fairness: "none", fairnessSlack: 1, weekExclusions: [], caps: [] };
  config.restrictions.push(created);
  return { card: created, next: 1 };
}

function existingCard(config: SolverConfig, t: Target): PersonRestriction {
  const [card] = cardsOf(config, t);
  if (!card) return refuse(`${t.text} no tiene reglas.`);
  return card;
}

function addPattern(p: WirePattern, use: PatternUse): string {
  const code = wirePatternCode(p);
  if (!isRulePattern(code)) refuse(patternHint(p, use));
  return code;
}

const LIMIT_OP: Record<RuleLimit, RestrictionCap["op"]> = { exactamente: "==", "al menos": ">=", "como máximo": "<=" };

function describe(e: RuleEdit): string {
  switch (e.op) {
    case "pool": return `la lista ${e.pool}`;
    case "notTogether":
    case "removeNotTogether": return `${e.a} y ${e.b}`;
    case "together":
    case "removeTogether": return e.persons.join(", ");
    default: return e.person;
  }
}

export function applyRuleEdits(
  stored: SolverConfig,
  edits: readonly RuleEdit[],
  roster: readonly RuleRosterMember[],
  newId: NewRuleId,
): ApplyRuleEditsResult {
  try {
    if (edits.length === 0) refuse("No hay cambios que revisar.");
    if (edits.length > MAX_RULE_EDITS) refuse(`Como máximo ${MAX_RULE_EDITS} cambios a la vez.`);
    const config = clone(stored);
    const noops: string[] = [];
    const notes: string[] = [];
    const touched: Array<{ field: keyof typeof POOL_LABEL; member: RuleRosterMember; added: boolean }> = [];
    const storedTexts = () => [
      ...config.restrictions.map((r) => r.person),
      ...config.conflicts.flatMap((c) => [c.personA, c.personB]),
      ...config.presence.flatMap((p) => p.persons),
    ];

    edits.forEach((e, i) => {
      const before = clone(config);
      switch (e.op) {
        case "pool": {
          const field = POOL_FIELD[e.pool];
          const addedHere = new Set<string>();
          for (const name of e.add ?? []) {
            const found = resolveRulePersonId(name, [...roster]);
            if (!found.ok) refuse(unresolvedMessage(name, roster, found.matches));
            const m = roster.find((x) => x._id === (found as { id: string }).id) as RuleRosterMember;
            if (!memberFitsPool(m, field)) {
              refuse(`${displayMemberName(m)} no tiene el Tipo de ${POOL_LABEL[field]} (Voz y ${POOL_LABEL[field]}); cámbialo en Personas.`);
            }
            addedHere.add(m._id);
            if (config[field].includes(m._id)) noops.push(`Ya estaba así: ${displayMemberName(m)} ya está en ${POOL_LABEL[field]}.`);
            else {
              config[field].push(m._id);
              touched.push({ field, member: m, added: true });
            }
          }
          for (const name of e.remove ?? []) {
            // R6: a remove takes anyone IN the pool, matched among the pool's own members first. The
            // roster is worship members only, so someone who has left Alabanza is not in it; the solver
            // ignores their stale id (it keeps worship members), so leaving it is harmless.
            const inPool = roster.filter((x) => config[field].includes(x._id) && [x.member_name, x.alias].some((n) => n && fold(n) === fold(name)));
            let m: RuleRosterMember;
            if (inPool.length === 1) m = inPool[0]!;
            else {
              const found = resolveRulePersonId(name, [...roster]);
              if (!found.ok) refuse(unresolvedMessage(name, roster, found.matches));
              m = roster.find((x) => x._id === (found as { id: string }).id) as RuleRosterMember;
            }
            if (addedHere.has(m._id)) refuse(`${displayMemberName(m)} aparece para agregar y para quitar en ${POOL_LABEL[field]}: elige una.`);
            if (!config[field].includes(m._id)) noops.push(`Ya estaba así: ${displayMemberName(m)} no está en ${POOL_LABEL[field]}.`);
            else {
              config[field] = config[field].filter((id) => id !== m._id);
              touched.push({ field, member: m, added: false });
            }
          }
          if (!(e.add ?? []).length && !(e.remove ?? []).length) refuse(`La lista ${e.pool}: di a quién agregar o quitar.`);
          return;
        }
        case "never": {
          const p = addPattern(e.pattern, "exclusion");
          const { card } = cardToEdit(config, personToAdd(e.person, roster), newId, i);
          if (card.excludedPatterns.some((x) => canonical(x) === p)) break;
          card.excludedPatterns.push(p);
          break;
        }
        case "allowAgain": {
          const p = wirePatternCode(e.pattern);
          const card = existingCard(config, personToChange(e.person, roster, storedTexts()));
          card.excludedPatterns = card.excludedPatterns.filter((x) => canonical(x) !== p);
          break;
        }
        case "weekOff": {
          if (!Number.isInteger(e.week) || e.week < 1 || e.week > 5) refuse("La semana va de 1 a 5.");
          const p = addPattern(e.pattern, "exclusion");
          const { card, next } = cardToEdit(config, personToAdd(e.person, roster), newId, i);
          if (card.weekExclusions.some((w) => w.week === e.week && canonical(w.pattern) === p)) break;
          card.weekExclusions.push({ id: newId("we", i, next), week: e.week, pattern: p });
          break;
        }
        case "weekOn": {
          const p = wirePatternCode(e.pattern);
          const card = existingCard(config, personToChange(e.person, roster, storedTexts()));
          card.weekExclusions = card.weekExclusions.filter((w) => !(w.week === e.week && canonical(w.pattern) === p));
          break;
        }
        case "count": {
          const p = addPattern(e.pattern, "count");
          const relative = e.relative !== undefined;
          if (relative === (e.value !== undefined)) refuse("Un conteo lleva un número (value) o «los domingos del mes menos N» (relative), no los dos.");
          if (relative && !(Number.isInteger(e.relative?.minus) && (e.relative?.minus as number) >= 0 && (e.relative?.minus as number) <= 5)) {
            refuse("«Menos N» va de 0 a 5, en números enteros.");
          }
          if (!relative && !(Number.isInteger(e.value) && (e.value as number) >= 0 && (e.value as number) <= 31)) {
            refuse("El número va de 0 a 31, entero.");
          }
          const op = LIMIT_OP[e.limit];
          const { card, next } = cardToEdit(config, personToAdd(e.person, roster), newId, i);
          const matching = card.caps.filter((c) => canonical(c.pattern) === p && c.op === op);
          if (matching.length > 1) refuse(`${card.person} tiene varias reglas «${CAP_OP_WORD[op]}» iguales; únelas en /admin → Reglas.`);
          // The field this count does not use is stored as the panel's new-cap default (§4).
          const values = relative ? { value: 2, relative: true, relOffset: e.relative?.minus as number } : { value: e.value as number, relative: false, relOffset: 2 };
          if (matching.length === 1) Object.assign(matching[0], values);
          else card.caps.push({ id: newId("cap", i, next), pattern: p, op, ...values });
          break;
        }
        case "removeCount": {
          const p = wirePatternCode(e.pattern);
          const op = LIMIT_OP[e.limit];
          const card = existingCard(config, personToChange(e.person, roster, storedTexts()));
          const matching = card.caps.filter((c) => canonical(c.pattern) === p && c.op === op);
          if (matching.length === 0) refuse(`${card.person} no tiene esa regla de «${CAP_OP_WORD[op]}».`);
          if (matching.length > 1) refuse(`${card.person} tiene varias reglas «${CAP_OP_WORD[op]}» iguales; quítalas en /admin → Reglas.`);
          card.caps = card.caps.filter((c) => c !== matching[0]);
          break;
        }
        case "cadence": {
          if (e.alternate) {
            const { card } = cardToEdit(config, personToAdd(e.person, roster), newId, i);
            card.sundayCadence = "alternate";
          } else {
            const card = existingCard(config, personToChange(e.person, roster, storedTexts()));
            delete card.sundayCadence;
          }
          break;
        }
        case "balance": {
          if (e.exempt) {
            const { card } = cardToEdit(config, personToAdd(e.person, roster), newId, i);
            card.fairness = "exempt";
          } else {
            // A CHANGE (§9): no `voz` needed, so a card whose person lost it can still be un-exempted.
            const card = existingCard(config, personToChange(e.person, roster, storedTexts()));
            card.fairness = "none";
          }
          break;
        }
        case "removePerson": {
          const card = existingCard(config, personToChange(e.person, roster, storedTexts()));
          config.restrictions = config.restrictions.filter((r) => r !== card);
          break;
        }
        case "notTogether": {
          const p = addPattern(e.pattern, "count");
          const a = personToAdd(e.a, roster);
          const b = personToAdd(e.b, roster);
          if (a.member._id === b.member._id) refuse(`${e.a} y ${e.b} son la misma persona.`);
          const exists = config.conflicts.some(
            (c) => canonical(c.pattern) === p && ((names(a, c.personA) && names(b, c.personB)) || (names(a, c.personB) && names(b, c.personA))),
          );
          if (!exists) config.conflicts.push({ id: newId("c", i, 0), personA: a.text, personB: b.text, pattern: p });
          break;
        }
        case "removeNotTogether": {
          const a = personToChange(e.a, roster, storedTexts());
          const b = personToChange(e.b, roster, storedTexts());
          const p = e.pattern ? wirePatternCode(e.pattern) : null;
          const matching = config.conflicts.filter(
            (c) => (p === null || canonical(c.pattern) === p) && ((names(a, c.personA) && names(b, c.personB)) || (names(a, c.personB) && names(b, c.personA))),
          );
          if (matching.length === 0) refuse(`No hay una regla «no coinciden» de ${a.text} y ${b.text}${p ? " en ese lugar" : ""}.`);
          if (matching.length > 1) refuse(`${a.text} y ${b.text} tienen varias reglas «no coinciden»: di en qué lugar (pattern).`);
          config.conflicts = config.conflicts.filter((c) => c !== matching[0]);
          break;
        }
        case "together": {
          const { presenceMembersMin: lo, presenceMembersMax: hi } = RECORD_LIMITS;
          if (e.persons.length < lo || e.persons.length > hi) refuse(`Un grupo «cada semana» lleva de ${lo} a ${hi} personas.`);
          const p = addPattern(e.pattern, "count");
          const people = e.persons.map((n) => personToAdd(n, roster));
          if (new Set(people.map((x) => x.member._id)).size !== people.length) refuse("Una persona aparece dos veces en el grupo.");
          const exists = config.presence.some(
            (r) => canonical(r.pattern) === p && r.persons.length === people.length && people.every((x) => r.persons.some((t) => names(x, t))),
          );
          if (!exists) config.presence.push({ id: newId("p", i, 0), persons: people.map((x) => x.text), pattern: p });
          break;
        }
        case "removeTogether": {
          const people = e.persons.map((n) => personToChange(n, roster, storedTexts()));
          const keys = people.map((x) => x.member?._id ?? `text:${x.text.trim().toLowerCase()}`);
          if (new Set(keys).size !== keys.length) refuse("Una persona aparece dos veces en el grupo.");
          const p = e.pattern ? wirePatternCode(e.pattern) : null;
          const matching = config.presence.filter(
            (r) => (p === null || canonical(r.pattern) === p) && r.persons.length === people.length && people.every((x) => r.persons.some((t) => names(x, t))),
          );
          if (matching.length === 0) refuse(`No hay un grupo «cada semana» con exactamente esas personas${p ? " en ese lugar" : ""}.`);
          if (matching.length > 1) refuse("Hay varios grupos con esas personas: di en qué lugar (pattern).");
          config.presence = config.presence.filter((r) => r !== matching[0]);
          break;
        }
      }
      if (same(before, config)) noops.push(`Ya estaba así: ${describe(e)}.`);
    });

    // R13 — each pool change with what the person can do after, the whole call applied.
    const poolLines: string[] = [];
    for (const t of touched) {
      const b = rolesIn(t.member, stored);
      const a = rolesIn(t.member, config);
      const gained = a.filter((k) => !b.includes(k)).map((k) => ROLE_WORD[k]);
      const lost = b.filter((k) => !a.includes(k)).map((k) => ROLE_WORD[k]);
      const effect = gained.length || lost.length
        ? [gained.length ? `empieza a poder: ${gained.join(", ")}` : "", lost.length ? `deja de poder: ${lost.join(", ")}` : ""].filter(Boolean).join("; ")
        : `no cambia nada: ${noEffectWhy(t.member, t.field, t.added, config)}`;
      poolLines.push(`${POOL_LABEL[t.field]}: ${t.added ? "+" : "−"} ${displayMemberName(t.member)} (${effect})`);
    }

    // Never-blocking notes.
    for (const r of config.restrictions) {
      const was = stored.restrictions.find((x) => x.id === r.id);
      const empty = !r.excludedPatterns.length && !r.weekExclusions.length && !r.caps.length && r.fairness === "none" && !r.sundayCadence;
      if (empty && !same(was, r)) notes.push(`La regla de ${r.person} queda sin cláusulas; si ya no sirve, quítala con removePerson.`);
    }
    const outside = new Set(cadenceOutsideSundayPool(stored, [...roster]).map((x) => x.id));
    for (const x of cadenceOutsideSundayPool(config, [...roster])) {
      if (!outside.has(x.id)) notes.push(`${x.name} tiene «Mes por medio» pero no está en Líder Domingo: no hace nada hasta que dirija domingos.`);
    }
    const flagsMoved = config.restrictions.some((r) => {
      const was = stored.restrictions.find((x) => x.id === r.id);
      return (was?.fairness === "exempt") !== (r.fairness === "exempt") || (was?.sundayCadence ?? null) !== (r.sundayCadence ?? null);
    }) || stored.restrictions.some((r) => !config.restrictions.some((x) => x.id === r.id) && (r.fairness === "exempt" || r.sundayCadence));
    if (flagsMoved) {
      notes.push(
        "Si un mes ya tiene su registro de equidad guardado, ese mes conserva «Fuera del balance» y «Mes por medio» como estaban: " +
          "generar juntos ese mes y uno nuevo pedirá que coincidan; genera el mes nuevo solo.",
      );
    }

    return { ok: true, config, lines: [...poolLines, ...ruleLines(stored, config)], noops, notes };
  } catch (err) {
    if (err instanceof Refusal) return { ok: false, message: err.message };
    throw err;
  }
}

// ── Judgement (R9, R11) ──────────────────────────────────────────────────────

/** Two absolute counts of one card no month can satisfy together (R9). Keys compare across configs. */
function contradictions(config: SolverConfig): Map<string, string> {
  const out = new Map<string, string>();
  for (const r of config.restrictions) {
    for (const a of r.caps) {
      for (const b of r.caps) {
        if (a === b || a.relative || b.relative) continue;
        const ra = rolesOfPatternV3(a.pattern);
        const rb = rolesOfPatternV3(b.pattern);
        if (!ra.length || !ra.every((k) => rb.includes(k))) continue;
        const min = a.op === ">=" || a.op === "==" ? a.value : null;
        const max = b.op === "<=" || b.op === "==" ? b.value : null;
        if (min === null || max === null || min <= max) continue;
        const key = `${r.person}|${a.pattern}${a.op}${a.value}|${b.pattern}${b.op}${b.value}`;
        out.set(key, `${r.person}: «${CAP_OP_WORD[a.op]} ${a.value}» y «${CAP_OP_WORD[b.op]} ${b.value}» no se pueden cumplir juntas en ningún mes.`);
      }
    }
  }
  return out;
}

function eligibilityProblems(config: SolverConfig, roster: readonly RuleRosterMember[], month: string): Map<string, string> {
  const out = new Map<string, string>();
  const res = resolveMonthEligibility({ month, config, members: [...roster] });
  if (res.ok) return out;
  for (const r of res.refusals) out.set(`r|${r.person}|${r.reason}`, V3_RESOLVER_REFUSAL[r.reason](r.person, month, null));
  for (const i of res.issues) out.set(`i|${i.code}|${i.ruleKey ?? ""}`, V3_RESOLVER_ISSUE[i.code]);
  return out;
}

export type RuleEditsVerdict =
  | { ok: true; /** Problems the stored rules already had: shown, never blocking. */ existing: string[] }
  | { ok: false; message: string };

/**
 * The edited rules judged as the rules POST (R9) and the v3 solver (R11) will judge them; only what the
 * edit ADDS blocks. `month` is the next CDMX month: the verdict does not depend on it.
 */
export function judgeRuleEdits(stored: SolverConfig, edited: SolverConfig, roster: readonly RuleRosterMember[], month: string): RuleEditsVerdict {
  const parsed = parseSolverConfigWrite(edited);
  if (!parsed.ok) {
    const overlap = exactCapOverlaps(edited)[0];
    return {
      ok: false,
      message: overlap
        ? `${overlap.person} quedaría con dos números «exactamente» para el mismo lugar; deja uno solo.`
        : "Con estos cambios las reglas no serían válidas; revisa los cambios.",
    };
  }
  const before = contradictions(stored);
  const after = contradictions(edited);
  const newContradictions = [...after].filter(([k]) => !before.has(k)).map(([, v]) => v);
  if (newContradictions.length) return { ok: false, message: [...new Set(newContradictions)].join(" ") };

  const was = eligibilityProblems(stored, roster, month);
  const now = eligibilityProblems(edited, roster, month);
  const added = [...now].filter(([k]) => !was.has(k)).map(([, v]) => v);
  if (added.length) return { ok: false, message: `Con estos cambios Auto dejaría de poder correr. ${[...new Set(added)].join(" ")}` };
  return { ok: true, existing: [...new Set([...was.values(), ...before.values()])] };
}
