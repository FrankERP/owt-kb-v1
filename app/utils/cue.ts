// The navbar cue: the next service a member has, as a label.
//
// NEUTRAL module — no hooks, no "use client", no import that pulls one in — so
// the API route (server) and `CueStrip` (client) share one implementation
// (ADR-0028). `daysUntil` is neutral for the same reason.
//
// This is the ONLY place the cue's label is built. It reuses `formatCountdown`
// rather than spelling "Hoy"/"Mañana" a second time — CLAUDE.md names
// `daysUntil.ts` as the one countdown, and a second one would be free to drift.

import { daysUntil, formatCountdown } from "./daysUntil";

export interface Cue {
  /** The service day, `YYYY-MM-DD` (a Sanity `date`). */
  dateKey: string;
  kind: "worship" | "kids";
  /** The full Spanish weekday, capitalised — the payload's readable form. */
  day?: string;
}

/** The date at LOCAL noon. A bare `new Date(iso)` is the previous day at UTC-6. */
const noon = (dateKey: string) => new Date(dateKey.slice(0, 10) + "T12:00:00");

/**
 * `"DOM 13 · EN 5 DÍAS"` — the weekday abbreviation, the day of the month, and
 * the countdown, all upper-case.
 *
 * The abbreviation comes from the DATE, not from the kind: a `special_role` lands
 * on a weekday and must say so ("MIÉ 16"). `es-MX` renders it with a trailing dot
 * in some ICU builds ("sáb.") and without in others, so the dot is stripped before
 * the three letters are taken — the accent is kept, because the app is Spanish.
 */
export function cueLabel(cue: Cue, today: string): string {
  const date = noon(cue.dateKey);
  const abbr = date
    .toLocaleDateString("es-MX", { weekday: "short" })
    .replace(/\.$/, "")
    .slice(0, 3)
    .toUpperCase();
  const countdown = formatCountdown(daysUntil(cue.dateKey, noon(today))).toUpperCase();
  return `${abbr} ${date.getDate()} · ${countdown}`;
}

/** The full Spanish weekday, capitalised: `"Sábado"`. */
function dayName(dateKey: string): string {
  const name = noon(dateKey).toLocaleDateString("es-MX", { weekday: "long" });
  return name.charAt(0).toUpperCase() + name.slice(1);
}

/**
 * The one cue a member sees when they belong to both ministries: the earlier
 * date wins, and a tie goes to worship — a member of both is a worship member
 * whose Sunday morning is the kids room, and the worship call is the earlier of
 * the two on the same day.
 *
 * Both arguments are `YYYY-MM-DD`, so a lexical comparison is a date comparison.
 */
export function pickCue(worshipNext: string | null, kidsNext: string | null): Cue | null {
  if (worshipNext && (!kidsNext || worshipNext <= kidsNext)) {
    return { dateKey: worshipNext, kind: "worship", day: dayName(worshipNext) };
  }
  if (kidsNext) return { dateKey: kidsNext, kind: "kids", day: dayName(kidsNext) };
  return null;
}
