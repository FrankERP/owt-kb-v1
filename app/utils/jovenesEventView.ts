// Display words for a Jóvenes meeting (ADR-0081). Pure and neutral: the page renders with it and
// the planner (`/jovenes/admin`) does too. Nothing here decides access — `kind` is display only (plan D3), and the
// reader (`ministryEventReads.ts`) has already decided who sees the event.

import { MINISTRIES } from "@/app/ministries";
import type { MinistryEventView } from "./ministryEventReads";
import { plural } from "./plural";

export const EVENT_KIND_LABEL: Record<string, string> = {
  saturday: "Sábado de Jóvenes",
  ministry: "Reunión de Jóvenes",
  group: "Reunión de grupo",
  joint: "Junta de grupos",
};

export const SEAT_ROLE_LABEL: Record<string, string> = {
  encargado: "Encargado",
  apoyo: "Apoyo",
  comparte: "Comparte",
};

/** Own keys only: a stored `"toString"` or `"constructor"` must not reach `Object.prototype`. */
function own(table: Record<string, string>, key: string | null | undefined): string | undefined {
  return key != null && Object.hasOwn(table, key) ? table[key] : undefined;
}

const GROUP_NAME = new Map<string, string>(MINISTRIES.jovenes.groups.map((g) => [g.id, g.name]));

/** The meeting's heading: its title, else its kind, else a plain word. */
export function eventHeading(e: Pick<MinistryEventView, "title" | "kind">): string {
  return e.title ?? own(EVENT_KIND_LABEL, e.kind) ?? "Reunión";
}

/**
 * The meeting's own name where a DATE already heads it (the list on `/jovenes`, a Calendario
 * row): its title, else its kind. `null` for the plain Saturday meeting, which the date already
 * names («Sábado 14 de noviembre») under a page or a row that already says «Jóvenes».
 */
export function eventName(e: Pick<MinistryEventView, "title" | "kind">): string | null {
  if (e.title) return e.title;
  return e.kind === "saturday" ? null : eventHeading(e);
}

/** The line under a meeting's date: its name (when it has one), the clock, the arrival, who it is for. */
export function eventLine(e: Pick<MinistryEventView, "title" | "kind" | "time" | "arrival" | "audience">): string {
  return [eventName(e), e.time, e.arrival ? `llegada ${e.arrival}` : null, audienceLabel(e.audience)]
    .filter(Boolean)
    .join(" · ");
}

/** Who the meeting is for, in words. An unknown group id shows as itself, never as nothing. */
export function audienceLabel(audience: MinistryEventView["audience"]): string {
  if (!audience) return "Sin audiencia";
  if (audience.kind === "ministry") return "Todo Jóvenes";
  if (audience.groups.length === 0) return "Sin grupos";
  return audience.groups.map((g) => GROUP_NAME.get(g) ?? g).join(" · ");
}

export function seatRoleLabel(role: string | null): string {
  return own(SEAT_ROLE_LABEL, role) ?? role ?? "Lugar";
}

/** «sábado, 14 de noviembre» as the locale writes it, pinned to local noon (a bare `new Date(iso)` flips the day). */
export function eventDayLabel(date: string): string {
  return new Date(date + "T12:00:00").toLocaleDateString("es-MX", { weekday: "long", day: "numeric", month: "long" });
}

/**
 * «sábado 14 de noviembre»: the date inside a sentence, built from the parts so the locale's
 * comma never lands mid-phrase. Lowercase on purpose; a heading capitalises its first letter with
 * `dayTitle` (`agenda.ts`), never with CSS `capitalize`, which also raises «De».
 */
export function dayWords(date: string): string {
  const part = (type: Intl.DateTimeFormatPartTypes) =>
    new Intl.DateTimeFormat("es-MX", { weekday: "long", day: "numeric", month: "long" })
      .formatToParts(new Date(`${date}T12:00:00`))
      .find((p) => p.type === type)?.value ?? "";
  return `${part("weekday")} ${part("day")} de ${part("month")}`;
}

/**
 * The lede of `/jovenes`: how many meetings are coming, and the first one that is the reader's.
 * Two parts because the page sets the second in ink (the bit that is about YOU).
 */
export function meetingsLede(rows: ReadonlyArray<{ date: string; mine: boolean }>): { count: string; mine: string | null } {
  const next = rows.find((r) => r.mine);
  return {
    count: plural(rows.length, "reunión por venir", "reuniones por venir"),
    mine: next ? `te toca el ${dayWords(next.date)}` : null,
  };
}

/** `YYYY-MM-DD` plus whole days, on the calendar (local noon, so no DST edge moves the day). */
export function addDaysIso(date: string, days: number): string {
  const d = new Date(date + "T12:00:00");
  d.setDate(d.getDate() + days);
  return d.toLocaleDateString("sv");
}
