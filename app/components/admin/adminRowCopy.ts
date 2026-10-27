// The Spanish copy of the Control Room's hairline rows (ADR-0070, the Admin pass
// PR B): pure functions, so the wording is table-testable without a DOM.
//
// Dates arrive as Sanity `YYYY-MM-DD` and are rendered at LOCAL NOON — never a
// bare `new Date(iso)`, which lands the day before in America/Mexico_City.

const MONTH_LONG = new Intl.DateTimeFormat("es-MX", { month: "long" });
const MONTH_SHORT = new Intl.DateTimeFormat("es-MX", { month: "short" });

const atNoon = (iso: string) => new Date(`${iso.slice(0, 10)}T12:00:00`);

/** «1» + «nov»: the display-face day block of a Propuestas row. */
export function dayBlock(iso: string): { day: string; month: string } {
  const d = atNoon(iso);
  return { day: String(d.getDate()), month: MONTH_SHORT.format(d).replace(/\.$/, "") };
}

/** Joins «a, b y c» the way Spanish reads a short list. */
export function joinEs(parts: string[]): string {
  if (parts.length <= 1) return parts.join("");
  return `${parts.slice(0, -1).join(", ")} y ${parts[parts.length - 1]}`;
}

/**
 * «20, 21 y 22 de noviembre» — one run per month, months joined with «;» and
 * the year named only when it is not `currentYear`. Input order is kept
 * within a month; months follow their first appearance after the sort the
 * caller applied.
 */
export function formatDateRun(isos: string[], currentYear: number): string {
  const months = new Map<string, { days: string[]; label: string }>();
  for (const iso of isos) {
    const d = atNoon(iso);
    const key = iso.slice(0, 7);
    const year = d.getFullYear();
    const label = year === currentYear ? MONTH_LONG.format(d) : `${MONTH_LONG.format(d)} de ${year}`;
    const entry = months.get(key) ?? { days: [], label };
    entry.days.push(String(d.getDate()));
    months.set(key, entry);
  }
  return [...months.values()].map((m) => `${joinEs(m.days)} de ${m.label}`).join("; ");
}

/** The one Spanish word of a proposal's status on its row. */
export const PROPOSAL_STATUS_WORD: Record<"draft" | "pending" | "approved" | "changes_requested", string> = {
  draft: "Borrador",
  pending: "Pendiente",
  approved: "Aprobada",
  changes_requested: "Cambios solicitados",
};

/**
 * «con Hugo · 4 canciones»: the middle of the 14 px line under a proposal
 * row's title. The row renders «Propuesta de» + the lead's name and the status
 * word around it as their own nodes (a name is what an admin reads for).
 */
export function proposalSublineMiddle(p: { songCount: number; coContributors: string[] }): string {
  const parts: string[] = [];
  if (p.coContributors.length > 0) parts.push(`con ${joinEs(p.coContributors)}`);
  parts.push(`${p.songCount} ${p.songCount === 1 ? "canción" : "canciones"}`);
  return parts.join(" · ");
}
