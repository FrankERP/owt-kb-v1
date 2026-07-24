// Small pure, server-safe selection helpers used by the A1 read migration to
// consume the canonical read contract without arbitrary `[0]` selection. No
// Sanity client, no I/O — deterministic over already-fetched arrays, so every
// fail-closed rule is exhaustively unit-testable.

import { isValidServiceDate } from "./serviceReadModel";

function isObj(v: unknown): v is Record<string, unknown> {
  return !!v && typeof v === "object";
}

function nonEmptyString(v: unknown): v is string {
  return typeof v === "string" && v.length > 0;
}

/**
 * Fail-closed single-target selection: return the one document only when the
 * canonical group holds exactly one. Zero (none) or more than one (ambiguous
 * duplicate) both collapse to `null` — never an arbitrary pick from a group and
 * never a leaked overlay (the caller reads through the published perspective, so
 * `drafts.*` are already excluded upstream).
 */
export function pickUnique<T>(docs: T[] | null | undefined): T | null {
  if (!Array.isArray(docs) || docs.length !== 1) return null;
  return docs[0];
}

/**
 * Safe calendar-day key for a stored service date. Sanity stores service dates as
 * `date` (`YYYY-MM-DD`), but a malformed or missing value must never reach
 * `.slice()`, `new Date(...)`, or a `localeCompare` sort — it returns null and the
 * record is dropped from rendering as an integrity issue instead of crashing the
 * page. Accepts a datetime prefix (`YYYY-MM-DDT…`) for legacy rows.
 */
export function serviceDayKey(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const day = value.slice(0, 10);
  return isValidServiceDate(day) ? day : null;
}

/**
 * Fail-closed index of single-target documents by key. A key claimed by more than
 * one document is ambiguous and is omitted entirely — never a last-write-wins or
 * arbitrary pick. Rows with no resolvable key are dropped. First-occurrence order
 * of surviving keys is preserved.
 */
export function indexUniqueByKey<T>(
  rows: T[] | null | undefined,
  keyOf: (row: T) => string | null,
): Map<string, T> {
  const out = new Map<string, T>();
  if (!Array.isArray(rows)) return out;
  const counts = new Map<string, number>();
  const order: string[] = [];
  const first = new Map<string, T>();
  for (const row of rows) {
    let key: string | null = null;
    try {
      key = keyOf(row);
    } catch {
      key = null;
    }
    if (!key) continue;
    const seen = counts.get(key) ?? 0;
    counts.set(key, seen + 1);
    if (seen === 0) {
      first.set(key, row);
      order.push(key);
    }
  }
  for (const key of order) {
    if (counts.get(key) === 1) out.set(key, first.get(key)!);
  }
  return out;
}

/**
 * Collapse play-history rows to one canonical row per service target so an
 * ambiguous (duplicate-target) or draft-overlaid group never creates false or
 * double-counted play history. Rows whose target key is null are dropped; a
 * target that maps to more than one row is ambiguous and contributes NO rows
 * (fail closed). First-occurrence order of surviving targets is preserved.
 */
export function canonicalizePlayHistory<T>(
  rows: T[] | null | undefined,
  targetKeyOf: (row: T) => string | null,
): T[] {
  if (!Array.isArray(rows)) return [];
  const order: string[] = [];
  const byKey = new Map<string, T[]>();
  for (const row of rows) {
    let key: string | null = null;
    try {
      key = targetKeyOf(row);
    } catch {
      key = null;
    }
    if (!key) continue;
    const list = byKey.get(key);
    if (list) {
      list.push(row);
    } else {
      byKey.set(key, [row]);
      order.push(key);
    }
  }
  const out: T[] = [];
  for (const key of order) {
    const list = byKey.get(key)!;
    if (list.length === 1) out.push(list[0]);
  }
  return out;
}

/**
 * Target key for a play-history row (a `featuredSongs` / `saturdarSongs` setlist
 * doc, or a `special_role` carrying songs). Weekend setlists group by
 * `type:week`; a special role is its own target (its id). Returns null when the
 * row cannot be canonically targeted (so it is excluded, never guessed).
 */
export function playHistoryTargetKey(row: unknown): string | null {
  if (!isObj(row)) return null;
  const type = row._type;
  if (type === "featuredSongs" || type === "saturdarSongs") {
    return nonEmptyString(row.week) ? `${type}:${row.week}` : null;
  }
  if (type === "special_role") {
    return nonEmptyString(row._id) ? row._id : null;
  }
  return null;
}

/**
 * Lead reference ids from a canonical role projection (`Lead[]{ _ref }`). Only
 * meaningful after the role has passed {@link validateRole}; reads defensively
 * and de-duplicates so a notification target list is never arbitrary.
 */
export function canonicalLeadRefs(role: unknown): string[] {
  if (!isObj(role) || !Array.isArray(role.Lead)) return [];
  const out: string[] = [];
  for (const item of role.Lead) {
    if (isObj(item) && nonEmptyString(item._ref)) out.push(item._ref);
  }
  return [...new Set(out)];
}
