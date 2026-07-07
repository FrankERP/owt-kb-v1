// Pure month-arithmetic + link helpers for /schedule past-set browsing.
// Month values are "YYYY-MM" strings. Fully deterministic — no clock, no
// React/Sanity imports. Keep this a leaf module.

export const MONTH_NAMES_ES = [
  "Enero", "Febrero", "Marzo", "Abril", "Mayo", "Junio",
  "Julio", "Agosto", "Septiembre", "Octubre", "Noviembre", "Diciembre",
];

/** How many months the /schedule calendar shows at once (default and browse). */
export const WINDOW_MONTHS = 3;

/** Validate a raw ?m= value. Returns "YYYY-MM" if well-formed (month 01–12,
 *  year 2000–2100), else null. The year bound keeps absurd values (e.g.
 *  "0000-05") from reaching the query/label paths; the month picker is the
 *  only realistic entry point anyway. */
export function parseMonthParam(raw: string | undefined | null): string | null {
  if (!raw) return null;
  const match = /^(\d{4})-(\d{2})$/.exec(raw);
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  if (year < 2000 || year > 2100) return null;
  if (month < 1 || month > 12) return null;
  return raw;
}

/** Add n months (may be negative) to a "YYYY-MM"; returns "YYYY-MM". */
export function addMonths(ym: string, n: number): string {
  const [y, m] = ym.split("-").map(Number);
  const total = y * 12 + (m - 1) + n;
  const ny = Math.floor(total / 12);
  const nm = ((total % 12) + 12) % 12; // safe modulo, 0–11
  return `${String(ny).padStart(4, "0")}-${String(nm + 1).padStart(2, "0")}`;
}

/** First and last calendar day of the month, as "YYYY-MM-DD". */
export function monthBounds(ym: string): { from: string; to: string } {
  const [y, m] = ym.split("-").map(Number);
  const lastDay = new Date(Date.UTC(y, m, 0)).getUTCDate(); // UTC read only — TZ-stable
  return { from: `${ym}-01`, to: `${ym}-${String(lastDay).padStart(2, "0")}` };
}

/** Human label, e.g. "Julio 2026". */
export function monthLabel(ym: string): string {
  const [y, m] = ym.split("-").map(Number);
  return `${MONTH_NAMES_ES[m - 1]} ${y}`;
}

/** The `count` consecutive "YYYY-MM" months starting at `ym`. */
export function windowMonths(ym: string, count: number): string[] {
  return Array.from({ length: count }, (_, i) => addMonths(ym, i));
}

/** Fetch bounds spanning a `count`-month window: first day of `ym` → last day
 *  of the window's final month. */
export function windowBounds(ym: string, count: number): { from: string; to: string } {
  return { from: monthBounds(ym).from, to: monthBounds(addMonths(ym, count - 1)).to };
}

/** Label for a `count`-month window. One month → "Julio 2026"; same year →
 *  "Julio – Septiembre 2026"; crossing years → "Noviembre 2026 – Enero 2027". */
export function monthRangeLabel(ym: string, count: number): string {
  const end = addMonths(ym, count - 1);
  if (ym === end) return monthLabel(ym);
  const [sy, sm] = ym.split("-").map(Number);
  const [ey] = end.split("-").map(Number);
  if (sy === ey) return `${MONTH_NAMES_ES[sm - 1]} – ${monthLabel(end)}`;
  return `${monthLabel(ym)} – ${monthLabel(end)}`;
}

/** Link target for the schedule page. null → default (rolling) view. */
export function scheduleHref(ym: string | null): string {
  return ym ? `/schedule?m=${ym}` : "/schedule";
}
