// app/components/admin/plannerCalendar.ts
//
// The month picker's pure date helpers and its two refusals, moved verbatim out of
// `MonthCalendar.tsx` (a "use client" module) so a server caller — the MCP month
// planner (`app/utils/v3MonthPlan.ts`) — refuses a special or a weekend with the
// very same predicate and Spanish line the picker shows. `MonthCalendar` imports
// and re-exports every name here, so its callers and tests are unchanged.
//
// Neutral: no React, no "use client", nothing that reads a session or the network.

import { draftTargetKey } from "./plannerModel";

export interface CalendarSpecial {
  date: string;
  name: string;
  /** The composer's «Cuenta para equidad» (solver v3 C1 §6.3); the planner passes it, the list names it. */
  countsForFairness?: boolean;
}

/** The subset of a Sanity role this picker reads (fact: `date` may be a datetime). */
export interface CalendarExistingRole {
  _type: string;
  date: string;
  service_name?: string;
}

const pad = (n: number) => String(n).padStart(2, "0");

/**
 * Local noon, never a bare `new Date(iso)` — a bare parse is UTC and day-flips
 * in America/Mexico_City, which here would put days in the wrong calendar cell.
 */
export const noon = (iso: string) => new Date(iso.slice(0, 10) + "T12:00:00");

/** Every `YYYY-MM-DD` in the month, in order. */
export function monthDays(year: number, month: number): string[] {
  const count = new Date(year, month, 0).getDate();
  return Array.from({ length: count }, (_, i) => `${year}-${pad(month)}-${pad(i + 1)}`);
}

export function dayOfWeek(iso: string): number {
  return noon(iso).getDay();
}

/** "12 de agosto" — every user-facing refusal names the date this way. */
export function longDate(iso: string): string {
  return noon(iso).toLocaleDateString("es-MX", { day: "numeric", month: "long" });
}

export const weekendNoun = (iso: string) => (dayOfWeek(iso) === 0 ? "domingo" : "sábado");

/**
 * Why this date may not receive a special — or `null` when it may.
 *
 * Pure and exported so the refusals can be pinned directly, and so the same
 * predicate answers both the message and the decision (a second, drifting copy
 * of the condition is exactly how a "silent drop" gets reintroduced).
 *
 * Order is fixed for determinism, not significance:
 *  1. **E3** — the date already generates a weekend column. One column per date
 *     of any kind; a *deselected* weekend date is fine and falls through.
 *  2. **P2, this session** — this dialog already CREATED a `special_role` on
 *     that date (`createdTargets`). Ahead of the two checks below because
 *     neither can see it: the special may have been removed from `specials`
 *     (that is exactly the "Quitar → rename → Agregar" walk), and
 *     `existingRoles` is refreshed asynchronously by `onCreated()` — so on the
 *     path that matters both are empty and the date looks free. This is also
 *     the more precise message when `specials` DOES still hold it: "quítalo de
 *     la lista para cambiarlo" is a lie once the document exists.
 *  3. this month's own picks already hold a special on that date.
 *  4. **P2** — a `special_role` already exists in Sanity on that date. The
 *     generator's preflight for a special is name-BLIND (`special_role:<date>`),
 *     so a second special on the same date is refused at the picker rather than
 *     drafted against an observation that cannot tell the two apart. A second
 *     set on a stored date is created from stored mode's composer, which is
 *     name-aware; this flow drafts one special per date on purpose (E19).
 *
 * Never keyed off a draft's `exists`: that means "this column once matched a
 * Sanity document", which survives a rename and cannot distinguish this
 * session's own creations from documents that predate it (see
 * `MonthGenerator`'s `createdTargets` doc comment). `type__date` — through the
 * shared `draftTargetKey`, never a hand-rolled template — is the only key both
 * surfaces can agree on.
 */
export function refuseSpecialOn(input: {
  date: string;
  weekendSelected: boolean;
  specials: CalendarSpecial[];
  existingRoles: CalendarExistingRole[];
  /** Optional so every existing caller and test is unaffected. */
  createdTargets?: ReadonlySet<string>;
}): string | null {
  const { date, weekendSelected, specials, existingRoles, createdTargets } = input;
  if (weekendSelected) {
    return `El ${longDate(date)} ya genera un servicio de ${weekendNoun(date)}. Quítalo del calendario antes de crear un servicio especial en esa fecha.`;
  }
  if (createdTargets?.has(draftTargetKey("special_role", date))) {
    // Second sentence is `PlannerGrid`'s own wording for this exact state, to
    // the letter — the two surfaces must not describe one fact two ways.
    return `El ${longDate(date)} ya tiene un servicio especial. Ya lo creaste en esta sesión.`;
  }
  const already = specials.find((s) => s.date === date);
  if (already) {
    return `El ${longDate(date)} ya tiene un servicio especial en este mes: «${already.name}». Quítalo de la lista para cambiarlo.`;
  }
  const stored = existingRoles.find(
    (r) => r._type === "special_role" && r.date.slice(0, 10) === date,
  );
  if (stored) {
    const name = stored.service_name?.trim();
    return `El ${longDate(date)} ya tiene un servicio especial guardado${name ? `: «${name}»` : ""}. Para agregar otro set ese día usa «+ Nuevo servicio» en los servicios guardados.`;
  }
  return null;
}

/**
 * Why this weekend date may not be selected — the OTHER ordering of E3. Adding
 * the special first and then re-selecting its Saturday must refuse just as
 * loudly as the reverse; `buildColumns`' weekend-wins dedupe would otherwise
 * drop the special with only a `console.warn` the admin never sees.
 */
export function refuseWeekendOn(input: { date: string; specials: CalendarSpecial[] }): string | null {
  const special = input.specials.find((s) => s.date === input.date);
  if (!special) return null;
  return `El ${longDate(input.date)} ya tiene un servicio especial («${special.name}»). Quítalo antes de activar ese ${weekendNoun(input.date)}.`;
}
