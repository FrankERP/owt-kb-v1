// The ONE definition of a special service's `format` (spec
// 2026-09-22-worship-night-song-leads-design.md §3.1; ADR-0036 — a format flag
// on `special_role`, not a fourth role type). Neutral: no imports, so server
// writers and client components share it.
export const WORSHIP_NIGHT_FORMAT = "worship_night" as const;
export type ServiceFormat = typeof WORSHIP_NIGHT_FORMAT;

export function isWorshipNightFormat(v: unknown): v is ServiceFormat {
  return v === WORSHIP_NIGHT_FORMAT;
}

/** A role is a worship night iff its stored `format` says so. */
export function isWorshipNight(role: unknown): boolean {
  return !!role && typeof role === "object" && isWorshipNightFormat((role as { format?: unknown }).format);
}
