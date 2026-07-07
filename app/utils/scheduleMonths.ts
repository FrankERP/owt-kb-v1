// Pure month-arithmetic + link helpers for /schedule past-set browsing.
// Month values are "YYYY-MM" strings. Fully deterministic — no clock, no
// React/Sanity imports. Keep this a leaf module.

export const MONTH_NAMES_ES = [
  "Enero", "Febrero", "Marzo", "Abril", "Mayo", "Junio",
  "Julio", "Agosto", "Septiembre", "Octubre", "Noviembre", "Diciembre",
];

/** Validate a raw ?m= value. Returns "YYYY-MM" if well-formed (month 01–12), else null. */
export function parseMonthParam(raw: string | undefined | null): string | null {
  if (!raw) return null;
  const match = /^(\d{4})-(\d{2})$/.exec(raw);
  if (!match) return null;
  const month = Number(match[2]);
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

/** Link target for the schedule page. null → default (rolling) view. */
export function scheduleHref(ym: string | null): string {
  return ym ? `/schedule?m=${ym}` : "/schedule";
}
