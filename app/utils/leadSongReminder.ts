// The weekly «te toca escoger las canciones» reminder (ADR-0080).
//
// Every Sunday evening (CDMX) the daily Vercel cron — `/api/cron/service-reminders`,
// 01:00 UTC = 19:00 CDMX — emails the Lead seat of each published service of the
// coming week that has no songs yet, with a button to the lead's proposal page.
// The cron is the only caller; this module holds the pure rules (which week, which
// services, what the email says) and the one I/O function the route awaits.
//
// Why piggyback on that cron instead of an exact hour, why there is no
// "already sent" marker and why no opt-out switch: ADR-0080.

import { operationalClient } from "@/sanity/lib/operationalClient";
import { sendEmail, SEND_TIMEOUT_MS } from "./email";
import { sendPush } from "./push";
import { getAllowlist, isEmailAllowed, appBaseUrl, escapeHtml } from "./assignmentEmail";
import { C, td, tr, shell } from "./emailShell";
import { serviceIdentity, serviceLabel } from "./emailServiceLabel";
import { pastorMessageBodyOf } from "./serviceThread";
import { SWEEP_DEADLINE_MS, type SweepOptions } from "./outboxSweep";
import { wantsNotification } from "./notifyPrefs";

export const TIMEZONE = "America/Mexico_City";

/**
 * Which role types the Sunday run covers. "week" = every published service from
 * Monday to the next Sunday (a Saturday service hears six days ahead, a special
 * whatever day it falls on); "sunday" = only the next Sunday's `sunday_role`.
 */
export type LeadReminderScope = "week" | "sunday";
export const LEAD_REMINDER_SCOPE: LeadReminderScope = "week";

const SCOPE_TYPES: Record<LeadReminderScope, readonly string[]> = {
  week: ["sunday_role", "saturday_role", "special_role"],
  sunday: ["sunday_role"],
};

/** Adds whole days to a `YYYY-MM-DD` calendar date (UTC arithmetic: no DST drift). */
export function addDays(iso: string, days: number): string {
  const d = new Date(`${iso.slice(0, 10)}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** 0 = Sunday … 6 = Saturday, for a `YYYY-MM-DD` calendar date. */
export function weekdayOf(iso: string): number {
  return new Date(`${iso.slice(0, 10)}T12:00:00Z`).getUTCDay();
}

/**
 * The service dates the run covers, or `null` when today (a CDMX calendar date)
 * is not a Sunday. Monday through the next Sunday, both inclusive: today's own
 * services are never in it (they already happened by 19:00).
 */
export function leadReminderWindow(
  todayCdmx: string,
  scope: LeadReminderScope = LEAD_REMINDER_SCOPE,
): { from: string; to: string; types: readonly string[] } | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(todayCdmx) || weekdayOf(todayCdmx) !== 0) return null;
  const to = addDays(todayCdmx, 7);
  return { from: scope === "sunday" ? to : addDays(todayCdmx, 1), to, types: SCOPE_TYPES[scope] };
}

/**
 * What the lead still has to do, or `null` when there is nothing to remind:
 * the setlist already has songs, or the proposal was sent (`pending`) or approved.
 *
 * - `choose`  — nothing started (no proposal, or an empty draft).
 * - `draft`   — a draft with songs that was never sent to the admins.
 * - `changes` — the admins asked for changes and it was not sent back.
 */
export type ReminderState = "choose" | "draft" | "changes";

export function reminderStateOf(row: {
  setlistSongs: number;
  proposal: { status?: string | null; songCount?: number | null } | null;
}): ReminderState | null {
  if (row.setlistSongs > 0) return null;
  const status = row.proposal?.status ?? null;
  if (status === "pending" || status === "approved") return null;
  if (status === "changes_requested") return "changes";
  if (status === "draft" && (row.proposal?.songCount ?? 0) > 0) return "draft";
  return "choose";
}

const ASK: Record<ReminderState, { subject: string; line: string; cta: string }> = {
  choose: {
    subject: "Te toca dirigir",
    line: "Aún no hay canciones para este servicio. Escoge el setlist y envíalo a los admins para que lo aprueben.",
    cta: "Escoger canciones →",
  },
  draft: {
    subject: "Tu propuesta no se ha enviado",
    line: "Empezaste una propuesta pero no se ha enviado. Revísala y envíala a los admins para que la aprueben.",
    cta: "Terminar mi propuesta →",
  },
  changes: {
    subject: "Tu propuesta tiene cambios pedidos",
    line: "Los admins pidieron cambios a tu propuesta. Revisa sus mensajes y vuelve a enviarla.",
    cta: "Ver los cambios →",
  },
};

/** «Pau» · «Pau y Mkz» · «Pau, Mkz y Lali». */
function joinNames(names: string[]): string {
  if (names.length <= 1) return names[0] ?? "";
  return `${names.slice(0, -1).join(", ")} y ${names[names.length - 1]}`;
}

/** The email, pure. `label` is `serviceLabel`'s plain text; everything is escaped here. */
export function buildLeadSongReminderEmail(o: {
  name: string;
  label: string;
  state: ReminderState;
  coLeads: string[];
  pastorMessage?: string | null;
  link: string;
}): { subject: string; html: string } {
  const ask = ASK[o.state];
  const subject = `${ask.subject} — ${o.label}`;
  const first = (o.name || "").trim().split(/\s+/)[0] ?? "";
  const greeting = first ? `Hola, ${escapeHtml(first)}.` : "Hola.";
  const co = o.coLeads.length
    ? ` junto con <strong style="color:${C.ink}">${escapeHtml(joinNames(o.coLeads))}</strong>`
    : "";

  const header = tr(td(
    `<span style="font:700 15px system-ui,sans-serif;color:${C.ink}">${escapeHtml(ask.subject)}</span>`,
    { style: "padding:18px 24px 8px" },
  ));
  const intro = tr(td(
    `<p style="margin:0 0 10px;font:14px system-ui,sans-serif;color:${C.ink}">${greeting} Diriges el servicio del <strong style="color:${C.accent}">${escapeHtml(o.label)}</strong>${co}.</p>` +
    `<p style="margin:0;font:14px system-ui,sans-serif;color:${C.ink}">${escapeHtml(ask.line)}</p>`,
    { style: "padding:0 24px 14px" },
  ));
  const pastor = o.pastorMessage?.trim()
    ? tr(td(
      `<p style="margin:0 0 6px;font:700 12px system-ui,sans-serif;letter-spacing:.08em;color:${C.muted}">MENSAJE DEL PASTOR</p>` +
      `<p style="margin:0;white-space:pre-wrap;font:14px system-ui,sans-serif;color:${C.ink}">${escapeHtml(o.pastorMessage.trim())}</p>`,
      { bg: C.surface, style: "padding:14px 24px" },
    ))
    : "";
  const cta = tr(td(
    `<a href="${o.link}" style="display:inline-block;background:${C.accent};color:${C.field};text-decoration:none;padding:10px 18px;border-radius:6px;font:700 13px system-ui,sans-serif">${escapeHtml(ask.cta)}</a>`,
    { style: "padding:18px 24px 20px" },
  ));
  return { subject, html: shell(header + intro + pastor + cta, `${appBaseUrl()}/me`) };
}

/** One service of the window, as `LEAD_REMINDER_QUERY` reads it. */
export interface LeadReminderRow {
  _id: string;
  _type: string;
  date: string;
  service_name?: unknown;
  time?: unknown;
  leads?: Array<{
    _id: string;
    name?: string | null;
    email?: string | null;
    disabled?: boolean | null;
    notifPrefs?: unknown;
  } | null> | null;
  setlistSongs?: number | null;
  proposal?: { status?: string | null; songCount?: number | null } | null;
  pastorMessage?: string | null;
}

/**
 * Published services in the window with someone in Lead. A weekend service's
 * songs live in its paired setlist (`featuredSongs` / `saturdarSongs` — the typo
 * is the real type name) by `week`; a special's on the role itself. The proposal
 * is the same one the propose page loads (`order(_createdAt asc)[0]`).
 */
export const LEAD_REMINDER_QUERY = `*[_type in $types && published != false
    && coalesce(date, week) >= $from && coalesce(date, week) <= $to && count(Lead) > 0]
  | order(coalesce(date, week) asc) {
  _id, _type, service_name, time,
  "date": coalesce(date, week),
  "leads": Lead[]->{ _id, "name": coalesce(alias, member_name), email, disabled, notifPrefs },
  "setlistSongs": select(
    _type == "sunday_role" => count(*[_type == "featuredSongs" && week == ^.week && count(songs) > 0]),
    _type == "saturday_role" => count(*[_type == "saturdarSongs" && week == ^.week && count(songs) > 0]),
    coalesce(count(songs), 0)
  ),
  "proposal": *[_type == "setlistProposal" && service_ref._ref == ^._id] | order(_createdAt asc)[0]{
    status, "songCount": count(songs)
  },
  "pastorMessage": ${pastorMessageBodyOf("^._id")}
}`;

/** One email to send, derived purely from the rows. */
export interface PlannedReminder {
  memberId: string;
  email: string;
  roleId: string;
  subject: string;
  html: string;
}

/**
 * Rows → the emails to send. A lead without a usable email, outside the
 * allowlist or without app access (`disabled`) is left out: the button would
 * lead nowhere. So is a lead whose «Propuestas» email preference resolves off
 * (`wantsNotification`, the same gate `serviceThreadNotify` puts on the same
 * Lead seat — it also honours the legacy all-email opt-out). Co-leads are named
 * in each other's email.
 */
export function planLeadReminders(
  rows: LeadReminderRow[],
  opts: { baseUrl: string; allow: string[] },
): PlannedReminder[] {
  const out: PlannedReminder[] = [];
  for (const row of rows) {
    const state = reminderStateOf({ setlistSongs: row.setlistSongs ?? 0, proposal: row.proposal ?? null });
    if (!state) continue;
    const leads = (row.leads ?? []).filter((l): l is NonNullable<typeof l> => !!l?._id);
    const label = serviceLabel({ date: row.date, roleType: row._type, ...serviceIdentity(row) });
    const link = `${opts.baseUrl}/me/propose/${encodeURIComponent(row._id)}`;
    const seen = new Set<string>();
    for (const lead of leads) {
      if (seen.has(lead._id)) continue;
      seen.add(lead._id);
      const email = lead.email?.trim().toLowerCase();
      if (!email || lead.disabled === true || !isEmailAllowed(email, opts.allow)) continue;
      if (!wantsNotification(lead.notifPrefs, "proposals")) continue;
      const coLeads = [...new Set(
        leads.filter((l) => l._id !== lead._id).map((l) => (l.name ?? "").trim()).filter(Boolean),
      )];
      const { subject, html } = buildLeadSongReminderEmail({
        name: lead.name ?? "",
        label,
        state,
        coLeads,
        pastorMessage: row.pastorMessage,
        link,
      });
      out.push({ memberId: lead._id, email, roleId: row._id, subject, html });
    }
  }
  return out;
}

/**
 * Who gets the push, and with which title: every lead with app access of a
 * service that needs a reminder, whether or not their email went out (push has
 * its own preference, applied by `sendPush`). A lead of two such services gets
 * one push, titled by the first (the rows come date-ordered).
 */
export function pushTargetsOf(rows: LeadReminderRow[]): Map<string, string> {
  const out = new Map<string, string>();
  for (const row of rows) {
    const state = reminderStateOf({ setlistSongs: row.setlistSongs ?? 0, proposal: row.proposal ?? null });
    if (!state) continue;
    for (const lead of row.leads ?? []) {
      if (!lead?._id || lead.disabled === true || out.has(lead._id)) continue;
      out.set(lead._id, ASK[state].subject);
    }
  }
  return out;
}

export interface LeadReminderReport {
  ran: boolean;
  services?: number;
  planned?: number;
  emailed?: number;
  failed?: number;
  elapsedMs?: number;
  error?: string;
}

/**
 * The route's one call. Not a Sunday in CDMX → `{ ran: false }` with no read.
 * Never throws: the daily cron's sweep and alarms must run whatever happens here.
 *
 * Sends run in PARALLEL (the SMTP pool is `SEND_CONCURRENCY` wide), so the whole
 * step is bounded by one `SEND_TIMEOUT_MS` plus the read, however many leads the
 * week has — the route derates the sweep by `elapsedMs` afterwards.
 */
export async function sendLeadSongReminders(now: Date = new Date()): Promise<LeadReminderReport> {
  const started = Date.now();
  const today = now.toLocaleDateString("sv", { timeZone: TIMEZONE });
  const window = leadReminderWindow(today);
  if (!window) return { ran: false };
  try {
    const rows = await operationalClient.fetch<LeadReminderRow[] | null>(LEAD_REMINDER_QUERY, {
      types: [...window.types],
      from: window.from,
      to: window.to,
    });
    const planned = planLeadReminders(rows ?? [], { baseUrl: appBaseUrl(), allow: getAllowlist() });
    // Preview mail goes to one address (docs/SECRETS.md), like every other app email.
    const redirectTo = process.env.EMAIL_REDIRECT_TO?.trim();
    const results = await Promise.allSettled(
      planned.map((p) =>
        sendEmail({
          to: redirectTo || p.email,
          subject: redirectTo ? `[→ ${p.email}] ${p.subject}` : p.subject,
          html: p.html,
        }),
      ),
    );
    let emailed = 0;
    results.forEach((r, i) => {
      if (r.status === "fulfilled" && r.value.ok) emailed++;
      else {
        const reason = r.status === "fulfilled" ? r.value.error : String(r.reason);
        console.error(JSON.stringify({ event: "lead_reminder_send_failed", member: planned[i].memberId, role: planned[i].roleId, reason }));
      }
    });
    // Push as well, best-effort: almost nobody has it on (2026-10), but it costs nothing.
    const byTitle = new Map<string, string[]>();
    for (const [memberId, title] of pushTargetsOf(rows ?? [])) {
      byTitle.set(title, [...(byTitle.get(title) ?? []), memberId]);
    }
    await Promise.allSettled(
      [...byTitle].map(([title, ids]) =>
        sendPush(ids, "reminders", { title, body: "Revisa las canciones de tu próximo servicio.", path: "/me" }),
      ),
    ).then((rs) => rs.forEach((r) => {
      if (r.status === "rejected") console.error("[leadSongReminder] push failed:", r.reason);
    }));
    const report: LeadReminderReport = {
      ran: true,
      services: (rows ?? []).length,
      planned: planned.length,
      emailed,
      failed: planned.length - emailed,
      elapsedMs: Date.now() - started,
    };
    console.log(JSON.stringify({ event: "lead_reminder_run", from: window.from, to: window.to, ...report }));
    return report;
  } catch (err) {
    console.error(JSON.stringify({ event: "lead_reminder_failed" }), err);
    return { ran: true, error: "lead_reminder_failed", elapsedMs: Date.now() - started };
  }
}

/**
 * The daily sweep's options after the reminders spent `elapsedMs` of the route's
 * `maxDuration` — the same reason layer 2 derates (`SweepOptions.sweepDeadlineMs`):
 * that clock runs from the top of the SWEEP, so it cannot see time the host route
 * already spent. Only the deadline: `sendBudgetMs` is measured from the start of
 * stage 7 and is unaffected. Lossless: a notice the shorter deadline does not reach
 * is re-pended for layer 1, never consumed.
 *
 * `{}` (the defaults) when nothing ran. `null` = SKIP the sweep: with less than one
 * send timeout plus the read phase left, stage 7 could not reliably admit a send
 * (its check is `elapsed + SEND_TIMEOUT_MS > deadline`), so the sweep would mostly
 * claim and re-pend. Layer 1 drains the outbox every five minutes anyway.
 */
export const MIN_SWEEP_DEADLINE_MS = SEND_TIMEOUT_MS + 5_000;

export function sweepOptionsAfterReminders(
  elapsedMs: number | undefined,
): Pick<SweepOptions, "sweepDeadlineMs"> | null {
  if (!elapsedMs || elapsedMs <= 0) return {};
  const remaining = SWEEP_DEADLINE_MS - elapsedMs;
  return remaining < MIN_SWEEP_DEADLINE_MS ? null : { sweepDeadlineMs: remaining };
}
