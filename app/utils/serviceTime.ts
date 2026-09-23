/**
 * The ONE validator and comparator for a special service's `time` — a display
 * and sort string ("HH:mm", 24-hour, zero-padded, America/Mexico_City by
 * convention). It is NEVER combined with the service `date` into a `Date`:
 * the CDMX invariant lives on the date alone, and nothing in the app asks
 * "is this set over" from the clock time.
 *
 * Neutral module (no React, no client-only imports) so Server Components and
 * the write path share it.
 *
 * GROQ ordering: the member reads use order(date asc, time asc) and rely on the
 * Content Lake placing a missing time AFTER present ones on the same day,
 * matching compareServiceTime. Verified read-only against the production
 * dataset on 2026-09-22 (featuredSongs ordered by team_notes asc: the 10
 * documents WITH the field came first, the 217 without came last); if it ever
 * disagrees, sort in JS with compareServiceTime instead.
 */
export const SERVICE_TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;

export function isServiceTime(v: unknown): v is string {
  return typeof v === "string" && SERVICE_TIME_RE.test(v);
}

/** Ascending by clock time; an absent time sorts AFTER every present one. */
export function compareServiceTime(a?: string | null, b?: string | null): number {
  const aa = isServiceTime(a) ? a : null;
  const bb = isServiceTime(b) ? b : null;
  if (aa === bb) return 0;
  if (aa === null) return 1;
  if (bb === null) return -1;
  return aa < bb ? -1 : 1;
}
