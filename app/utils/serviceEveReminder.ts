// The «Sirves mañana» email (ADR-0080, addendum of 2026-11-19).
//
// Every evening (CDMX) the daily Vercel cron — `/api/cron/service-reminders`, 01:00 UTC = 19:00
// CDMX — already pushed «Sirves mañana. ¡Prepárate!» to whoever holds a seat on a published service
// tomorrow. Push reaches nobody (0 members had it on, 2026-11-19), so that reminder reached nobody.
// This module sends the same reminder by email: one email per person, naming each service of
// tomorrow they serve on, their seat(s), the hour and the setlist when it has songs.
//
// THE AUDIENCE is the push's, not wider: the five member-referencing seats of tomorrow's PUBLISHED
// roles (the same five `assignedMemberRefsQuery` covers), then each person passes the same gates as
// every assignment email — an email, app access (`disabled`), the allowlist, and the «Nuevas
// asignaciones» preference (`wantsNotification(…, "assigned")`). The Jóvenes meeting reminders
// already ride that preference (ADR-0089, addendum): a reminder of something you were assigned is
// part of «Nuevas asignaciones», and a sixth preference would need a schema field, a route and a
// form for a switch nobody asked for.
//
// Why the daily cron, no «already sent» marker and a day the cron misses is a reminder nobody gets:
// ADR-0080's reasons, unchanged.

import { operationalClient } from "@/sanity/lib/operationalClient";
import { SEND_CONCURRENCY, SEND_TIMEOUT_MS, sendEmail } from "./email";
import { appBaseUrl, escapeHtml, getAllowlist, isEmailAllowed, rolesForMember, type ServiceBody } from "./assignmentEmail";
import { C, td, tr, shell } from "./emailShell";
import { serviceIdentity, serviceLabel } from "./emailServiceLabel";
import { wantsNotification } from "./notifyPrefs";
import { pickUnique } from "./serviceReadSelect";
import { isServiceTime } from "./serviceTime";
import { WEEKEND_SERVICE_TIME } from "./calendarFeed";

/**
 * No wave of sends may END past this many milliseconds of the route (what the route spent before
 * this step, plus the step's own time, plus one send timeout) — the Jóvenes reminders' rule
 * (`REMINDER_STEP_DEADLINE_MS`), for the same reason: the liveness alarm runs after, and its own
 * email needs room inside the route's 60 s. What the deadline leaves unsent is logged, never
 * retried.
 */
export const EVE_STEP_DEADLINE_MS = 35_000;

/** One song of tomorrow's setlist, as the query reads it. */
export interface EveSongRow {
  title?: string | null;
  key?: string | null;
}

type RefRow = { _ref?: unknown } | null;
type SlotRow = { person?: { _ref?: unknown } | null; instrument?: unknown; role?: unknown } | null;

/** One published service of tomorrow, as `SERVICE_EVE_QUERY` reads it. */
export interface EveServiceRow {
  _id: string;
  _type: string;
  date: string;
  service_name?: unknown;
  time?: unknown;
  Lead?: RefRow[] | null;
  BGVs?: RefRow[] | null;
  Chorus?: RefRow[] | null;
  instruments?: SlotRow[] | null;
  foh_team?: SlotRow[] | null;
  /** A special's own songs. */
  songs?: EveSongRow[] | null;
  /** A weekend service's setlist documents for its week; more than one is ambiguous (none shown). */
  setlists?: Array<{ songs?: EveSongRow[] | null } | null> | null;
}

/**
 * Tomorrow's published services, all three role types. A weekend role stores its day as `week`, a
 * special as `date`. A weekend service's songs live in its paired setlist by `week`
 * (`featuredSongs` / `saturdarSongs` — the typo is the real type name, do not rename); a special's
 * on the role itself. The seats are read raw and turned into names in TypeScript.
 */
export const SERVICE_EVE_QUERY = `*[_type in ["sunday_role", "saturday_role", "special_role"]
    && published != false && coalesce(date, week) == $day] {
  _id, _type, service_name, time,
  "date": coalesce(date, week),
  Lead, BGVs, Chorus, instruments, foh_team,
  "songs": select(_type == "special_role" => songs[]{ "title": song->title, "key": play_key }),
  "setlists": select(
    _type == "sunday_role" => *[_type == "featuredSongs" && week == ^.week]{ "songs": songs[]{ "title": song->title, "key": play_key } },
    _type == "saturday_role" => *[_type == "saturdarSongs" && week == ^.week]{ "songs": songs[]{ "title": song->title, "key": play_key } }
  )
}`;

/** The people the services name, read for the gates. */
export const EVE_PEOPLE_QUERY = `*[_type == "teamMembers" && _id in $ids]{
  _id, "name": coalesce(alias, member_name), email, disabled, notifPrefs
}`;

export interface EvePersonRow {
  _id: string;
  name?: string | null;
  email?: string | null;
  disabled?: boolean | null;
  notifPrefs?: unknown;
}

/** The five seats of a role as `rolesForMember` reads them. Malformed rows are dropped. */
export function seatBodyOf(row: EveServiceRow): Required<ServiceBody> {
  const refs = (arr: RefRow[] | null | undefined): string[] =>
    (arr ?? []).map((r) => r?._ref).filter((v): v is string => typeof v === "string" && v.length > 0);
  const slots = (arr: SlotRow[] | null | undefined, field: "instrument" | "role") =>
    (arr ?? []).flatMap((s) => {
      const personId = s?.person?._ref;
      const label = s?.[field];
      return typeof personId === "string" && personId && typeof label === "string" && label.trim()
        ? [{ label: label.trim(), personId }]
        : [];
    });
  return {
    leads: refs(row.Lead),
    bgvs: refs(row.BGVs),
    chorus: refs(row.Chorus),
    instruments: slots(row.instruments, "instrument").map((s) => ({ instrument: s.label, personId: s.personId })),
    foh: slots(row.foh_team, "role").map((s) => ({ role: s.label, personId: s.personId })),
  };
}

/** The hour a service starts: a special's own `time`, a weekend service the team's standing time. */
export function startTimeOf(row: Pick<EveServiceRow, "_type" | "time">): string | null {
  if (row._type === "special_role") return isServiceTime(row.time) ? row.time : null;
  if (row._type === "saturday_role") return WEEKEND_SERVICE_TIME.saturday;
  if (row._type === "sunday_role") return WEEKEND_SERVICE_TIME.sunday;
  return null;
}

/** Tomorrow's songs for one service: titled rows only; an ambiguous weekend setlist shows none. */
export function songsOf(row: EveServiceRow): Array<{ title: string; key: string | null }> {
  const raw = row._type === "special_role" ? row.songs : pickUnique(row.setlists ?? [])?.songs;
  return (raw ?? []).flatMap((s) => {
    const title = typeof s?.title === "string" ? s.title.trim() : "";
    if (!title) return [];
    const key = typeof s?.key === "string" && s.key.trim() ? s.key.trim() : null;
    return [{ title, key }];
  });
}

/** One service in one person's email. */
export interface EveItem {
  label: string;
  /** A weekend service's hour; a special's is already in its label. */
  time: string | null;
  roles: string[];
  songs: Array<{ title: string; key: string | null }>;
}

/** «Líder» · «Líder y BGV» · «Líder, BGV y Guitarra». */
function joinRoles(roles: string[]): string {
  if (roles.length <= 1) return roles[0] ?? "";
  return `${roles.slice(0, -1).join(", ")} y ${roles[roles.length - 1]}`;
}

/** The email, pure. Every stored text is escaped here. */
export function buildServiceEveEmail(o: {
  name: string;
  items: EveItem[];
  link: string;
  settingsLink: string;
}): { subject: string; html: string } {
  const subject = o.items.length === 1
    ? `Sirves mañana — ${o.items[0].label}`
    : `Sirves mañana — ${o.items.length} servicios`;
  const first = (o.name || "").trim().split(/\s+/)[0] ?? "";
  const greeting = first ? `Hola, ${escapeHtml(first)}.` : "Hola.";

  const header = tr(td(
    `<span style="font:700 15px system-ui,sans-serif;color:${C.ink}">Sirves mañana</span>`,
    { style: "padding:18px 24px 8px" },
  ));
  const intro = tr(td(
    `<p style="margin:0;font:14px system-ui,sans-serif;color:${C.ink}">${greeting} Este es tu recordatorio para mañana.</p>`,
    { style: "padding:0 24px 14px" },
  ));
  const blocks = o.items.map((it) => {
    const when = escapeHtml(it.label) + (it.time ? ` · ${escapeHtml(it.time)}` : "");
    const songs = it.songs.length
      ? `<p style="margin:12px 0 6px;font:700 12px system-ui,sans-serif;letter-spacing:.08em;color:${C.muted}">SETLIST</p>` +
        `<ol style="margin:0;padding:0 0 0 20px;font:14px system-ui,sans-serif;color:${C.ink}">` +
        it.songs.map((s) =>
          `<li style="margin:0 0 4px">${escapeHtml(s.title)}` +
          (s.key ? ` <span style="color:${C.muted}">· ${escapeHtml(s.key)}</span>` : "") +
          `</li>`,
        ).join("") +
        `</ol>`
      : `<p style="margin:12px 0 0;font:14px system-ui,sans-serif;color:${C.muted}">Todavía no hay canciones en el setlist.</p>`;
    return tr(td(
      `<p style="margin:0 0 4px;font:700 14px system-ui,sans-serif;color:${C.ink}">${when}</p>` +
      `<p style="margin:0;font:14px system-ui,sans-serif;color:${C.ink}">Sirves como <strong style="color:${C.accent}">${escapeHtml(joinRoles(it.roles))}</strong>.</p>` +
      songs,
      { bg: C.surface, style: "padding:14px 24px" },
    ));
  }).join(tr(td("", { style: "padding:4px 0" })));
  const anySongs = o.items.some((it) => it.songs.length > 0);
  const cta = tr(td(
    `<a href="${o.link}" style="display:inline-block;background:${C.accent};color:${C.field};text-decoration:none;padding:10px 18px;border-radius:6px;font:700 13px system-ui,sans-serif">${anySongs ? "Ensayar el setlist →" : "Ver el servicio →"}</a>`,
    { style: "padding:18px 24px 20px" },
  ));
  return { subject, html: shell(header + intro + blocks + cta, o.settingsLink) };
}

/** One email to send, derived purely from the rows. */
export interface PlannedEveEmail {
  memberId: string;
  email: string;
  subject: string;
  html: string;
}

/** Every member id seated on the rows, first-seen order. */
export function eveMemberIds(rows: readonly EveServiceRow[]): string[] {
  const out = new Set<string>();
  for (const row of rows) {
    const b = seatBodyOf(row);
    for (const id of [...b.leads, ...b.bgvs, ...b.chorus, ...b.instruments.map((i) => i.personId), ...b.foh.map((f) => f.personId)]) {
      out.add(id);
    }
  }
  return [...out];
}

/**
 * Rows + people → the emails. A person without a usable email, without app access, outside the
 * allowlist or with «Nuevas asignaciones» off is left out. A person on two services tomorrow gets
 * ONE email naming both, in start-time order.
 */
export function planServiceEveEmails(
  rows: readonly EveServiceRow[],
  people: readonly EvePersonRow[],
  env: { baseUrl: string; allow: string[] },
): PlannedEveEmail[] {
  const byId = new Map(people.filter((p) => p && typeof p._id === "string").map((p) => [p._id, p]));
  const ordered = [...rows].sort((a, b) => (startTimeOf(a) ?? "99:99").localeCompare(startTimeOf(b) ?? "99:99"));
  const items = new Map<string, EveItem[]>();
  for (const row of ordered) {
    const body = seatBodyOf(row);
    const item = {
      label: serviceLabel({ date: row.date, roleType: row._type, ...serviceIdentity(row) }),
      time: row._type === "special_role" ? null : startTimeOf(row),
      songs: songsOf(row),
    };
    for (const id of eveMemberIds([row])) {
      const roles = [...new Set(rolesForMember(id, body))];
      if (!roles.length) continue;
      items.set(id, [...(items.get(id) ?? []), { ...item, roles }]);
    }
  }
  const out: PlannedEveEmail[] = [];
  for (const [memberId, list] of items) {
    const person = byId.get(memberId);
    const email = person?.email?.trim().toLowerCase();
    if (!person || !email || person.disabled === true || !isEmailAllowed(email, env.allow)) continue;
    if (!wantsNotification(person.notifPrefs, "assigned")) continue;
    const { subject, html } = buildServiceEveEmail({
      name: person.name ?? "",
      items: list,
      link: `${env.baseUrl}/`,
      settingsLink: `${env.baseUrl}/me/ajustes`,
    });
    out.push({ memberId, email, subject, html });
  }
  return out;
}

export interface ServiceEveReport {
  services?: number;
  planned?: number;
  emailed?: number;
  failed?: number;
  /** Planned but never started: the step ran out of the route's time. */
  skipped?: number;
  elapsedMs?: number;
  error?: string;
}

/**
 * The route's one call, every day, for `day` (tomorrow in CDMX, the same day the push uses). Never
 * throws: the daily cron's other reminders, sweep and alarms must run whatever happens here.
 * `spentMs`: what the route already spent, so the last wave ends by `EVE_STEP_DEADLINE_MS`.
 */
export async function sendServiceEveReminders(day: string, opts: { spentMs?: number } = {}): Promise<ServiceEveReport> {
  const started = Date.now();
  const spent = Math.max(0, opts.spentMs ?? 0);
  try {
    const rows = (await operationalClient.fetch<EveServiceRow[] | null>(SERVICE_EVE_QUERY, { day })) ?? [];
    const ids = eveMemberIds(rows);
    const people = ids.length
      ? (await operationalClient.fetch<EvePersonRow[] | null>(EVE_PEOPLE_QUERY, { ids })) ?? []
      : [];
    const planned = planServiceEveEmails(rows, people, { baseUrl: appBaseUrl(), allow: getAllowlist() });
    // Preview mail goes to one address (docs/SECRETS.md), like every other app email.
    const redirectTo = process.env.EMAIL_REDIRECT_TO?.trim();
    // In waves as wide as the transport's pool, so no send starts its timeout queued behind
    // another; and no wave starts once one more timeout would outlast the step's deadline.
    const results: PromiseSettledResult<{ ok: boolean; error?: string }>[] = [];
    for (let i = 0; i < planned.length; i += SEND_CONCURRENCY) {
      if (spent + (Date.now() - started) + SEND_TIMEOUT_MS > EVE_STEP_DEADLINE_MS) break;
      const wave = planned.slice(i, i + SEND_CONCURRENCY).map((p) =>
        sendEmail({
          to: redirectTo || p.email,
          subject: redirectTo ? `[→ ${p.email}] ${p.subject}` : p.subject,
          html: p.html,
        }),
      );
      results.push(...(await Promise.allSettled(wave)));
    }
    let emailed = 0;
    results.forEach((r, i) => {
      if (r.status === "fulfilled" && r.value.ok) emailed++;
      else {
        const reason = r.status === "fulfilled" ? r.value.error : String(r.reason);
        console.error(JSON.stringify({ event: "service_eve_send_failed", member: planned[i].memberId, reason }));
      }
    });
    const skipped = planned.length - results.length;
    if (skipped > 0) console.error(JSON.stringify({ event: "service_eve_skipped", skipped }));
    const report: ServiceEveReport = {
      services: rows.length,
      planned: planned.length,
      emailed,
      failed: results.length - emailed,
      skipped,
      elapsedMs: Date.now() - started,
    };
    console.log(JSON.stringify({ event: "service_eve_run", day, ...report }));
    return report;
  } catch (err) {
    console.error(JSON.stringify({ event: "service_eve_failed" }), err);
    return { error: "service_eve_failed", elapsedMs: Date.now() - started };
  }
}
