// app/utils/emailServiceLabel.ts
// How the outbox email and the publish email name a special service. A weekend
// service is its date («Sábado 3 oct»); a special also carries its own name and
// time («Sábado 3 oct · CAMP - Set 2 · 09:00»), the way the app's day cards show
// it. Without the name and time, two specials on the same day read as identical
// lines in the inbox — a camp's four Saturday sets all came out as «Setlist
// listo — Sábado 3 oct». Neutral module: plain text out, so every caller escapes
// it for HTML (`service_name` is typed by an admin).
//
// The proposal emails do not name a special yet: `proposalNotify.ts` builds its
// own label, and the outbox «Mensajes de la propuesta» line reaches
// `serviceLabel` with no role type, so it shows only the date.

import { isServiceTime } from "./serviceTime";

/** The fallback a special shows when its name cannot be read (a deleted role). */
export const SPECIAL_SERVICE_FALLBACK = "Servicio especial";

/** A special's own name and time, as they ride from the role document to the email. */
export interface ServiceIdentity {
  serviceName?: string;
  serviceTime?: string;
}

/**
 * Reads a role's `service_name`/`time` for the email. Keys are only present
 * when the stored value is a usable string, so a weekend role (which has
 * neither) yields `{}` and leaves every shape it is spread into unchanged.
 */
export function serviceIdentity(role: { service_name?: unknown; time?: unknown } | null | undefined): ServiceIdentity {
  const out: ServiceIdentity = {};
  // Whitespace collapsed: the name becomes a subject line, which must stay one line.
  const name = typeof role?.service_name === "string" ? role.service_name.replace(/\s+/g, " ").trim() : "";
  if (name) out.serviceName = name;
  const time = role?.time;
  if (isServiceTime(time)) out.serviceTime = time;
  return out;
}

// Render at local noon per CLAUDE.md — a bare `new Date(iso)` flips the day in
// America/Mexico_City. Parts are picked individually (not the raw formatted
// string) so the result is stable regardless of locale literals ("de", ",").
export function formatServiceDate(iso: string): string {
  const d = new Date(`${iso.slice(0, 10)}T12:00:00`);
  // `formatToParts` THROWS on an invalid date, and one throw inside the publish
  // batch's loop would cost every member after it their email. Callers validate
  // dates first; this is the floor under them, not a path anyone should reach.
  if (Number.isNaN(d.getTime())) return iso;
  const parts = new Intl.DateTimeFormat("es-MX", { weekday: "long", day: "numeric", month: "short" }).formatToParts(d);
  const part = (type: string) => parts.find((p) => p.type === type)?.value ?? "";
  const text = `${part("weekday")} ${part("day")} ${part("month").replace(/\.$/, "")}`;
  return text.charAt(0).toUpperCase() + text.slice(1);
}

/**
 * «Sábado 3 oct» for a weekend service; «Sábado 3 oct · CAMP - Set 2 · 09:00»
 * for a special. The date leads so every header in one email lines up on it.
 * A special with no readable name still says it is a special rather than
 * passing for a weekend service; an absent or malformed time is left out.
 */
export function serviceLabel(s: { date: string; roleType?: string | null } & ServiceIdentity): string {
  const date = formatServiceDate(s.date);
  if (s.roleType !== "special_role") return date;
  const name = s.serviceName?.replace(/\s+/g, " ").trim() || SPECIAL_SERVICE_FALLBACK;
  // An empty segment is dropped, never joined: an unreadable date (see
  // `formatServiceDate`) must not leave a header starting with « · ».
  return [date, name, isServiceTime(s.serviceTime) ? s.serviceTime : ""].filter(Boolean).join(" · ");
}
