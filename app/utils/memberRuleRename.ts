// A person's name and the solver rules that name them by TEXT (admin parity phase 4, slice M:
// docs/superpowers/plans/2026-11-05-owt-mcp-admin-parity-f4m-members.md, D6, D12, §7.1). Pure.
//
// Rules name people by display text (`rulePersonNamesMember`: `member_name` or alias, trimmed,
// case-insensitive), so a changed alias silently orphaned Vale's rule in 2026-10. This module answers,
// for one name or alias change:
//
//   · which rule person texts would STOP naming the person, and what to write instead: the reader's
//     own normalization of the new display name (`normalizeLabel(displayMemberName(after))`, §7.1),
//     which must name exactly the person and nobody else;
//   · the TARGETED set paths in the RAW stored rules document (`restrictions[_key=="k"].person`,
//     `conflicts[_key=="k"].personA/personB`, one presence item's `persons` array), each set only where
//     the raw value is exactly that text. Nothing else of the rules document is read back and
//     rewritten, so a value or field this bundle does not know survives (D6's rejected alternative);
//   · whether the renamed rules, read the way the reader reads them, would raise a parse issue the
//     STORED rules did not already have (an exact-cap overlap from two texts converging) — then
//     nothing is written;
//   · texts it leaves because they also name another member (ambiguous), and the D12 warning: a new
//     name or alias equal to a rule text that names nobody today («la regla … empezaría a aplicarle»).
//
// It never decides who may rename; the commit does (`memberCommit.ts`).

import type { ConflictRule, PresenceRule, PersonRestriction, SolverConfig } from "@/app/components/admin/plannerModel";
import { conflictSentence, presenceSentence, restrictionText, sentenceText } from "@/app/components/admin/ruleCopy";
import { normalizeLabel } from "./normalizeLabel";
import { displayMemberName, rulePersonNamesMember } from "./memberRuleNames";
import { parseSolverConfigWrite, solverConfigFromDocument } from "./solverConfigWriteRequest";

/** A name as the rule matcher takes it; a missing `member_name` reads as `""` (§7.8). */
export interface PersonNames {
  member_name: string;
  alias?: string;
}

export interface RosterRow {
  _id: string;
  member_name?: unknown;
  alias?: unknown;
}

export function namesOf(row: { member_name?: unknown; alias?: unknown }): PersonNames {
  return {
    member_name: typeof row.member_name === "string" ? row.member_name : "",
    ...(typeof row.alias === "string" ? { alias: row.alias } : {}),
  };
}

const key = (s: string | undefined) => (s ?? "").toLowerCase().trim();

/** Did the name or the alias change as the rule matcher sees them (trimmed, case-insensitive)? D13. */
export function namesChanged(before: PersonNames, after: PersonNames): boolean {
  return key(before.member_name) !== key(after.member_name) || key(before.alias) !== key(after.alias);
}

/**
 * D12: the first other member whose name or alias equals one of `texts` (as the rule matcher compares).
 * Only the texts that CHANGE are passed, so a legacy collision never locks an unrelated save (D13).
 */
export function nameTakenBy(roster: readonly RosterRow[], selfId: string | null, texts: readonly string[]): { text: string; other: RosterRow } | null {
  for (const text of texts) {
    if (!text.trim()) continue;
    for (const row of roster) {
      if (row._id === selfId) continue;
      if (rulePersonNamesMember(text, namesOf(row))) return { text: text.trim(), other: row };
    }
  }
  return null;
}

// ── Rule occurrences ─────────────────────────────────────────────────────────

type Occurrence =
  | { kind: "restriction"; rule: PersonRestriction; text: string }
  | { kind: "conflict"; rule: ConflictRule; side: "personA" | "personB"; text: string }
  | { kind: "presence"; rule: PresenceRule; text: string };

function occurrences(config: SolverConfig): Occurrence[] {
  const out: Occurrence[] = [];
  for (const r of config.restrictions) out.push({ kind: "restriction", rule: r, text: r.person });
  for (const c of config.conflicts) {
    out.push({ kind: "conflict", rule: c, side: "personA", text: c.personA });
    out.push({ kind: "conflict", rule: c, side: "personB", text: c.personB });
  }
  for (const p of config.presence) for (const text of p.persons) out.push({ kind: "presence", rule: p, text });
  return out;
}

function ruleLine(o: Pick<Occurrence, "kind" | "rule">): string {
  if (o.kind === "restriction") return restrictionText(o.rule as PersonRestriction);
  if (o.kind === "conflict") return sentenceText(conflictSentence(o.rule as ConflictRule));
  return sentenceText(presenceSentence(o.rule as PresenceRule));
}

const namesSomeone = (text: string, roster: readonly PersonNames[]) => roster.some((m) => rulePersonNamesMember(text, m));

/**
 * D12: the rules whose person text names nobody in `roster` today and would name `after` — a person
 * created or renamed onto an orphaned rule silently inherits it (the Vale incident in reverse).
 * `roster` is everyone as stored (the renamed person with their OLD names), so a text that names them
 * today is never reported here; it is D6's.
 */
export function orphanRuleWarnings(rulesDoc: unknown, roster: readonly PersonNames[], after: readonly PersonNames[]): string[] {
  if (!rulesDoc) return [];
  const config = solverConfigFromDocument(rulesDoc);
  const out: string[] = [];
  for (const o of occurrences(config)) {
    if (namesSomeone(o.text, roster)) continue;
    if (!after.some((a) => rulePersonNamesMember(o.text, a))) continue;
    const line = `Ojo: la regla «${ruleLine(o)}» hoy no nombra a nadie y empezaría a aplicarle.`;
    if (!out.includes(line)) out.push(line);
  }
  return out;
}

/** The parse issues a config raises, as the rules POST would see them. */
function issuesOf(config: SolverConfig): string[] {
  const parsed = parseSolverConfigWrite(config);
  return parsed.ok ? [] : parsed.issues;
}

export type RenamePlan =
  | {
      ok: true;
      /** Set paths for the rules document's targeted patch; empty = nothing to write there. */
      sets: Record<string, unknown>;
      /** «Regla: «antes» → «después»», one per rule item that moves. */
      lines: string[];
      /** Rule texts left as they are because they also name another member. */
      ambiguous: string[];
      renamed: number;
    }
  | { ok: false; reason: "keyless" | "raw_mismatch" | "target" | "new_issue"; message: string };

const SAFE_KEY = /^[^"\\]+$/;

function refuse(reason: Exclude<RenamePlan, { ok: true }>["reason"], message: string): RenamePlan {
  return { ok: false, reason, message };
}

/** The raw stored item whose reader id is `id`, with a key a path can address exactly once. */
function rawItem(rawArray: unknown, id: string): { key: string; item: Record<string, unknown> } | null {
  const items = Array.isArray(rawArray) ? rawArray.filter((i): i is Record<string, unknown> => typeof i === "object" && i !== null && !Array.isArray(i)) : [];
  const matches = items.filter((i) => (normalizeLabel(i.id) ?? normalizeLabel(i._key)) === id);
  if (matches.length !== 1) return null;
  const k = matches[0]._key;
  if (typeof k !== "string" || !k || !SAFE_KEY.test(k)) return null;
  if (items.filter((i) => i._key === k).length !== 1) return null;
  return { key: k, item: matches[0] };
}

/**
 * D6 for one person whose name or alias changes. `roster` is every member as stored (the person with
 * their OLD names, under `selfId`); `rulesDoc` the raw stored rules document, or null (none exists).
 */
export function planRuleRename(input: {
  rulesDoc: unknown;
  roster: readonly RosterRow[];
  selfId: string;
  before: PersonNames;
  after: PersonNames;
}): RenamePlan {
  const empty: RenamePlan = { ok: true, sets: {}, lines: [], ambiguous: [], renamed: 0 };
  if (!input.rulesDoc || !namesChanged(input.before, input.after)) return empty;
  const raw = input.rulesDoc as Record<string, unknown>;
  const config = solverConfigFromDocument(raw);
  const others = input.roster.filter((r) => r._id !== input.selfId).map(namesOf);

  const toRename = new Set<string>();
  const ambiguous: string[] = [];
  for (const o of occurrences(config)) {
    if (!rulePersonNamesMember(o.text, input.before) || rulePersonNamesMember(o.text, input.after)) continue;
    if (namesSomeone(o.text, others)) {
      if (!ambiguous.includes(o.text)) ambiguous.push(o.text);
      continue;
    }
    toRename.add(o.text);
  }
  if (toRename.size === 0) return { ...empty, ambiguous } as RenamePlan;

  const newText = normalizeLabel(displayMemberName(input.after));
  if (newText === null || !rulePersonNamesMember(newText, input.after) || namesSomeone(newText, others)) {
    return refuse("target", "El nombre nuevo no nombraría solo a esta persona en las reglas; revisa que nadie más se llame así.");
  }
  const rename = (t: string) => (toRename.has(t) ? newText : t);

  const sets: Record<string, unknown> = {};
  const lines: string[] = [];
  let failure = null as RenamePlan | null; // `as`: set inside the loops below, so no narrowing to null
  const renamedConfig: SolverConfig = {
    ...config,
    restrictions: config.restrictions.map((r) => ({ ...r, person: rename(r.person) })),
    conflicts: config.conflicts.map((c) => ({ ...c, personA: rename(c.personA), personB: rename(c.personB) })),
    presence: config.presence.map((p) => ({ ...p, persons: p.persons.map(rename) })),
  };

  const keyless = "Una regla que nombra a esta persona no tiene clave en el documento de reglas; arréglala en Studio antes de cambiar el nombre.";
  const mismatch = "Una regla que nombra a esta persona está escrita distinto a como se lee (espacios de más); arréglala en /admin → Reglas antes de cambiar el nombre.";

  config.restrictions.forEach((r, i) => {
    if (!toRename.has(r.person)) return;
    const found = rawItem(raw.restrictions, r.id);
    if (!found) { failure ??= refuse("keyless", keyless); return; }
    if (found.item.person !== r.person) { failure ??= refuse("raw_mismatch", mismatch); return; }
    sets[`restrictions[_key=="${found.key}"].person`] = newText;
    lines.push(`Regla: «${restrictionText(r)}» → «${restrictionText(renamedConfig.restrictions[i])}»`);
  });
  config.conflicts.forEach((c, i) => {
    const sides = (["personA", "personB"] as const).filter((s) => toRename.has(c[s]));
    if (!sides.length) return;
    const found = rawItem(raw.conflicts, c.id);
    if (!found) { failure ??= refuse("keyless", keyless); return; }
    for (const side of sides) {
      if (found.item[side] !== c[side]) { failure ??= refuse("raw_mismatch", mismatch); return; }
      sets[`conflicts[_key=="${found.key}"].${side}`] = newText;
    }
    lines.push(`Regla: «${sentenceText(conflictSentence(c))}» → «${sentenceText(conflictSentence(renamedConfig.conflicts[i]))}»`);
  });
  config.presence.forEach((p, i) => {
    if (!p.persons.some((t) => toRename.has(t))) return;
    const found = rawItem(raw.presence, p.id);
    if (!found || !Array.isArray(found.item.persons)) { failure ??= refuse("keyless", keyless); return; }
    const next: unknown[] = [];
    for (const el of found.item.persons as unknown[]) {
      const read = normalizeLabel(el);
      if (read !== null && toRename.has(read)) {
        if (el !== read) { failure ??= refuse("raw_mismatch", mismatch); return; }
        next.push(newText);
      } else next.push(el);
    }
    sets[`presence[_key=="${found.key}"].persons`] = next;
    lines.push(`Regla: «${sentenceText(presenceSentence(p))}» → «${sentenceText(presenceSentence(renamedConfig.presence[i]))}»`);
  });
  if (failure) return failure;

  // Validation only, in memory: a rename may not raise an issue the stored rules did not have.
  const known = new Set(issuesOf(config));
  if (issuesOf(renamedConfig).some((issue) => !known.has(issue))) {
    return refuse(
      "new_issue",
      "Con el nombre nuevo, dos reglas de esta persona chocarían (por ejemplo, dos «exactamente» en el mismo lugar). Arregla las reglas en /admin → Generar mes → Reglas y vuelve a intentarlo.",
    );
  }
  return { ok: true, sets, lines, ambiguous, renamed: lines.length };
}

/** The note for texts D6 left because they also name someone else. */
export function ambiguousRuleNote(texts: readonly string[]): string | null {
  return texts.length
    ? `Ojo: ${texts.map((t) => `«${t}»`).join(", ")} en las reglas también nombra a otra persona; esas reglas no se cambiaron.`
    : null;
}
