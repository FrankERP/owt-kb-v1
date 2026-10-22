// app/components/admin/ruleCopy.ts
//
// The solver rules of «Generar mes» as SENTENCES (diseño para admins, bloque 2, 2026-10-22).
//
// The rules card used to show each clause in the solver's own notation — `!Sat.*`,
// `Sun.BGV <= sem−2`, `Ana ≠ Bruno en *.Lead`, `c/sem` — which is the DSL
// `restrictionToDs` emits, not a language an admin reads. This module is the ONE
// place that notation is turned into Spanish, for the rules card, its forms and the
// MCP's `get_solver_rules` answer alike, so a rule reads the same wherever an admin
// meets it. It is display only: nothing here changes what is stored or sent (the
// writer is `solverConfigWriteRequest.ts`, the v3 request `v3Rules.ts`, both untouched).
//
// Every helper also hands back the NOTATION it replaced (`RuleChip.notation`), because
// the solver's notices and the v3 rule table still name a rule the old way
// (`capCardLabel`: «Gaby · Sun.BGV <= sem−2»); the card shows it on hover and behind
// «Mostrar notación del solver», so what a notice names can still be found on screen.
//
// Pure: no React, no DOM. `ruleCopy.test.ts` pins every sentence.

import {
  capLabel,
  LEGACY_PATTERN_ALIASES,
  type ConflictRule,
  type PersonRestriction,
  type PresenceRule,
  type RestrictionCap,
  type WeekExclusion,
} from "./plannerModel";

/** The chip tones of the mock (`reglas.html`): refusal, count, pair, presence, cadence, stale — and `warn` for the card's own data notices. */
export type RuleTone = "no" | "num" | "pair" | "pres" | "cad" | "stale" | "warn";

export interface RuleChip {
  key: string;
  tone: RuleTone;
  /** The sentence. */
  text: string;
  /** What the chip said before — the solver's notation, as `capCardLabel` and the DSL spell it. */
  notation: string;
  /** `stale` only: why the chip is struck through. */
  note?: string;
}

/** A sentence in parts, so the card can dim the connective words («no coinciden como», «en»). */
export type RuleSentence = Array<{ text: string; dim?: boolean }>;

// ─── Patterns ────────────────────────────────────────────────────────────────

type Day = "Sun" | "Sat" | "*";
type Role = "Lead" | "BGV" | "Choir" | "LeadBGV" | "*";

const DAYS: Record<Exclude<Day, "*">, string> = { Sun: "domingo", Sat: "sábado" };
const DAY_PLURAL: Record<Exclude<Day, "*">, string> = { Sun: "Domingos", Sat: "Sábados" };

/** The role as a thing a person IS («líder», «BGV», «coro») — exclusions, weeks, caps. */
const ROLE_NOUN: Record<Exclude<Role, "*">, string> = {
  Lead: "líder", BGV: "BGV", Choir: "coro", LeadBGV: "líder o BGV",
};
/** The same, under a ban: both seats are refused, so `LeadBGV` reads «ni», never «o». */
const BANNED_NOUN: Record<Exclude<Role, "*">, string> = { ...ROLE_NOUN, LeadBGV: "líder ni BGV" };
/** The role as the SEAT's name («Lead», «BGV», «Coro») — conflicts and presence, as the mock reads. */
const SEAT_NAME: Record<Exclude<Role, "*">, string> = {
  Lead: "Lead", BGV: "BGV", Choir: "Coro", LeadBGV: "Lead o BGV",
};

function parsePattern(pattern: string): { day: Day; role: Role } | null {
  const p = LEGACY_PATTERN_ALIASES.get(pattern) ?? pattern;
  const dot = p.indexOf(".");
  if (dot === -1) return null;
  const day = p.slice(0, dot);
  const role = p.slice(dot + 1);
  if (day !== "Sun" && day !== "Sat" && day !== "*") return null;
  if (role !== "Lead" && role !== "BGV" && role !== "Choir" && role !== "LeadBGV" && role !== "*") return null;
  return { day, role };
}

const cap1 = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/**
 * The short label of a pattern for a picker («Líder en domingo», «Sábado (todo)»,
 * «Líder o BGV (ambos)») — the rule forms' `Select`s and pills.
 */
export function patternLabel(pattern: string): string {
  const p = parsePattern(pattern);
  if (!p) return pattern;
  if (p.role === "*") return p.day === "*" ? "Ambos servicios" : `${cap1(DAYS[p.day])} (todo)`;
  const noun = cap1(ROLE_NOUN[p.role]);
  return p.day === "*" ? `${noun} (ambos)` : `${noun} en ${DAYS[p.day]}`;
}

/** The tighter form for a pill row («Sábado», «BGV dom», «Líder o BGV»). */
export function patternPill(pattern: string): string {
  const p = parsePattern(pattern);
  if (!p) return pattern;
  if (p.role === "*") return p.day === "*" ? "Ambos" : cap1(DAYS[p.day]);
  const noun = cap1(ROLE_NOUN[p.role]);
  return p.day === "*" ? noun : `${noun} ${DAYS[p.day].slice(0, 3)}`;
}

// ─── Person restrictions ─────────────────────────────────────────────────────

/** `!Sat.*` → «Nunca en sábado»; `!Sun.BGV` → «No BGV en domingo»; `!*.LeadBGV` → «Nunca líder ni BGV». */
export function exclusionSentence(pattern: string): string {
  const p = parsePattern(pattern);
  if (!p) return `Nunca ${pattern}`;
  if (p.role === "*") return p.day === "*" ? "Nunca en fin de semana" : `Nunca en ${DAYS[p.day]}`;
  if (p.day === "*") return p.role === "LeadBGV" ? "Nunca líder ni BGV" : `Nunca ${ROLE_NOUN[p.role]}`;
  return `No ${BANNED_NOUN[p.role]} en ${DAYS[p.day]}`;
}

/** `sem.3 *.*` → «Semana 3 libre»; `sem.2 Sun.BGV` → «Semana 2: sin BGV en domingo». */
export function weekSentence(we: WeekExclusion): string {
  const p = parsePattern(we.pattern);
  if (!p) return `Semana ${we.week}: sin ${we.pattern}`;
  if (p.role === "*") return p.day === "*" ? `Semana ${we.week} libre` : `Semana ${we.week}: sin ${DAYS[p.day]}`;
  if (p.day === "*") return `Semana ${we.week}: sin ${BANNED_NOUN[p.role]}`;
  return `Semana ${we.week}: sin ${BANNED_NOUN[p.role]} en ${DAYS[p.day]}`;
}

/** The subject of a count («Líder en domingo», «Domingos», «Servicios»). */
export function capSubject(pattern: string): string {
  const p = parsePattern(pattern);
  if (!p) return pattern;
  if (p.role === "*") return p.day === "*" ? "Servicios" : DAY_PLURAL[p.day];
  const noun = cap1(ROLE_NOUN[p.role]);
  return p.day === "*" ? `${noun} (sábado o domingo)` : `${noun} en ${DAYS[p.day]}`;
}

export const CAP_OP_WORD: Record<RestrictionCap["op"], string> = {
  "==": "exactamente",
  ">=": "al menos",
  "<=": "como máximo",
};

/**
 * `Sun.Lead == 2` → «Líder en domingo: exactamente 2 al mes»;
 * `Sun.BGV <= sem−2` → «BGV en domingo: como máximo los domingos del mes menos 2»
 * (a relative cap resolves against the month's Sunday count, `capValueForMonth`).
 */
export function capSentence(cap: RestrictionCap): string {
  const head = `${capSubject(cap.pattern)}: ${CAP_OP_WORD[cap.op]}`;
  if (!cap.relative) return `${head} ${cap.value} al mes`;
  return cap.relOffset === 0
    ? `${head} tantos como domingos tiene el mes`
    : `${head} los domingos del mes menos ${cap.relOffset}`;
}

export const EXEMPT_SENTENCE = "Fuera del balance total";
export const CADENCE_SENTENCE = "Mes por medio";
/** Beside a struck-through «Holgura N»: what the clause still does (`localFill.ts`) and what it no longer does. */
export const SLACK_STALE_NOTE = "el solver la ignora; solo pesa al llenar especiales";
export const SLACK_ZERO_NOTE = "sin efecto";

/** Every clause of a person restriction, as chips, in the card's order. */
export function restrictionChips(r: PersonRestriction): RuleChip[] {
  const chips: RuleChip[] = [];
  // Keyed by position: the writer does not de-duplicate `excludedPatterns`, and a hand-edited
  // document may repeat one (`["Sat.*", "Sat.*"]`); two children under one key would not reconcile.
  r.excludedPatterns.forEach((p, i) => chips.push({ key: `x:${i}:${p}`, tone: "no", text: exclusionSentence(p), notation: `!${p}` }));
  for (const we of r.weekExclusions) chips.push({ key: `w:${we.id}`, tone: "no", text: weekSentence(we), notation: `sem.${we.week} ${we.pattern}` });
  for (const c of r.caps) chips.push({ key: `c:${c.id}`, tone: "num", text: capSentence(c), notation: capLabel(c) });
  if (r.fairness === "exempt") chips.push({ key: "f:exempt", tone: "cad", text: EXEMPT_SENTENCE, notation: "fairness_exempt" });
  if (r.fairness === "slack") {
    chips.push({
      key: "f:slack",
      tone: "stale",
      text: `Holgura ${r.fairnessSlack}`,
      notation: `fairness_slack ${r.fairnessSlack}`,
      note: r.fairnessSlack > 0 ? SLACK_STALE_NOTE : SLACK_ZERO_NOTE,
    });
  }
  if (r.sundayCadence === "alternate") chips.push({ key: "cadence", tone: "cad", text: CADENCE_SENTENCE, notation: "sundayCadence: alternate" });
  return chips;
}

// ─── Conflicts and presence ──────────────────────────────────────────────────

const joinOr = (names: readonly string[]) =>
  names.length <= 1 ? names.join("") : `${names.slice(0, -1).join(", ")} o ${names[names.length - 1]}`;

/**
 * `Lucía ≠ Niza en *.LeadBGV` → «Lucía y Niza · no coinciden como · Lead o BGV · en ningún servicio»;
 * `Hugo ≠ Lucía en Sun.*` → «Hugo y Lucía · no coinciden · en domingo».
 */
export function conflictSentence(c: ConflictRule): RuleSentence {
  const persons = { text: `${c.personA} y ${c.personB}` };
  const p = parsePattern(c.pattern);
  if (!p) return [persons, { text: "no coinciden en", dim: true }, { text: c.pattern }];
  if (p.role === "*") {
    return p.day === "*"
      ? [persons, { text: "no coinciden", dim: true }, { text: "en ningún servicio" }]
      : [persons, { text: "no coinciden", dim: true }, { text: `en ${DAYS[p.day]}` }];
  }
  const seat = p.role === "LeadBGV" ? "Lead ni BGV" : SEAT_NAME[p.role];
  return p.day === "*"
    ? [persons, { text: "no coinciden como", dim: true }, { text: seat }, { text: "en ningún servicio", dim: true }]
    : [persons, { text: "no coinciden como", dim: true }, { text: `${seat} en ${DAYS[p.day]}` }];
}

/** `Hugo, Jakey en Sun.BGV c/sem` → «Hugo o Jakey · en · BGV de domingo · cada semana». */
export function presenceSentence(r: PresenceRule): RuleSentence {
  const persons = { text: joinOr(r.persons) };
  const tail = { text: "cada semana", dim: true };
  const p = parsePattern(r.pattern);
  if (!p) return [persons, { text: "en", dim: true }, { text: r.pattern }, tail];
  if (p.role === "*") {
    return [persons, { text: "en", dim: true }, { text: p.day === "*" ? "sábado o domingo" : DAYS[p.day] }, tail];
  }
  const seat = SEAT_NAME[p.role];
  return [persons, { text: "en", dim: true }, { text: p.day === "*" ? `${seat} (sábado o domingo)` : `${seat} de ${DAYS[p.day]}` }, tail];
}

export const sentenceText = (s: RuleSentence) => s.map((part) => part.text).join(" ");

/** The notation each card shows behind «Mostrar notación del solver» — `conflictCardLabel`/`presenceCardLabel`'s shape. */
export const conflictNotation = (c: ConflictRule) => `${c.personA} ≠ ${c.personB} en ${c.pattern}`;
export const presenceNotation = (r: PresenceRule) => `${r.persons.join(", ")} en ${r.pattern} c/sem`;
