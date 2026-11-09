// Display words for a Jóvenes meeting (ADR-0081). Pure and neutral: the page renders with it and
// the planner (`/jovenes/admin`) does too. Nothing here decides access — `kind` is display only (plan D3), and the
// reader (`ministryEventReads.ts`) has already decided who sees the event.

import { MINISTRIES } from "@/app/ministries";
import type { MinistryEventView } from "./ministryEventReads";

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

/** «sábado 14 de noviembre», pinned to local noon (a bare `new Date(iso)` flips the day). */
export function eventDayLabel(date: string): string {
  return new Date(date + "T12:00:00").toLocaleDateString("es-MX", { weekday: "long", day: "numeric", month: "long" });
}

/** The reader's own seats on this meeting, as words («Encargado», «Apoyo»). */
export function mySeats(e: Pick<MinistryEventView, "seats">): string[] {
  return e.seats.filter((s) => s.mine).map((s) => seatRoleLabel(s.role));
}

/** `YYYY-MM-DD` plus whole days, on the calendar (local noon, so no DST edge moves the day). */
export function addDaysIso(date: string, days: number): string {
  const d = new Date(date + "T12:00:00");
  d.setDate(d.getDate() + days);
  return d.toLocaleDateString("sv");
}
