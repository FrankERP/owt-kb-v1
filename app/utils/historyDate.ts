// The long Spanish day of a song's history row — «11 de octubre de 2026» —
// spelled ONCE for the song page and the song sheet (ADR-0070's Biblioteca
// pass), so the two surfaces can never disagree on locale or form. Neutral.
const HISTORY_DATE = new Intl.DateTimeFormat("es-ES", { year: "numeric", month: "long", day: "numeric" });

/** `week` is a Sanity `date` (YYYY-MM-DD), pinned to local noon so the day never flips in UTC. */
export function formatHistoryDate(week: string): string {
  return HISTORY_DATE.format(new Date(week.slice(0, 10) + "T12:00:00"));
}
