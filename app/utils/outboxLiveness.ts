// app/utils/outboxLiveness.ts
//
// The liveness alarm (spec §3, "Liveness signal").
//
// WHY THIS EXISTS
// ---------------
// Layer 1 — the GitHub Actions schedule that curls `/api/cron/flush-notifications`
// every five minutes — is a genuine single point of failure. Layer 2 (the
// opportunistic sweep inside a committed write) structurally cannot flush the
// terminal edit of a working session, and the terminal edit is what every notice
// eventually is. So every notice that ships depends on that workflow or, failing
// it, the daily Vercel cron: the honest worst case when the workflow is broken,
// disabled or throttled is up to 24 hours.
//
// GitHub also disables scheduled workflows after 60 days of repository
// inactivity, and this repo is public, so that rule applies here. Combined with a
// once-daily check, the detection window for that failure is up to 48 hours —
// named in §3 as a known operational property, not a surprise.
//
// TWO PROPERTIES THAT LOOK LIKE DETAILS AND ARE NOT:
//
//   · The query counts BOTH statuses. A notice stuck mid-fan-out sits in
//     `sending`, not `pending` — reporting only `pending` would blind the alarm
//     to precisely the failure that spams the team.
//
//   · It EMAILS, it does not only log. This repo has no log drain, no
//     error-reporting integration and no alerting, and Vercel Hobby provides
//     none, so a `console.error` in a daily cron has no consumer. §11 designates
//     this signal as the mitigation for layer 1 being a single point of failure;
//     if it never reaches a person, that risk is simply unmitigated.
//
// Six hours is far outside any legitimate window — the hard ceiling on a notice
// is one hour (`NOTIFY_MAX_WINDOW_MINUTES`) — so this fires only when layer 1 has
// genuinely stopped.
//
// PREFERENCES: this is an operational alarm about a broken pipeline, not a
// service notification, and no `notifPrefs` toggle covers it. Nothing here reads
// `notifPrefs` at all, so the "every preference decision goes through
// `wantsNotification`" rule holds by not making one. The allowlist and
// `EMAIL_REDIRECT_TO` still apply, exactly as they do on every other send.

import "server-only";

import { operationalClient } from "@/sanity/lib/operationalClient";

import { appBaseUrl, escapeHtml, getAllowlist, isEmailAllowed } from "./assignmentEmail";
import { sendEmail } from "./email";
import { C, shell, td, tr } from "./emailShell";
// A generic "positive number, or the fallback" env parser whose name records its
// first caller; reused here rather than re-implemented (it already rejects `""`,
// non-numeric and non-positive values, and has its own tests).
import { parseMinutesEnv as parsePositiveEnv } from "./outboxNotice";

/** §9: the oldest outbox age that means layer 1 has stopped. */
export const STALE_ALERT_HOURS = parsePositiveEnv(process.env.NOTIFY_STALE_ALERT_HOURS, 6);

/**
 * BOTH statuses, in one round trip. `count` is the whole backlog and `oldest` is
 * the head of it; the alarm names both, because "one stuck notice" and "forty"
 * are very different mornings.
 */
export const STALE_OUTBOX_QUERY = `{
  "count": count(*[_type == "notificationOutbox" && status in ["pending","sending"]]),
  "oldest": *[_type == "notificationOutbox" && status in ["pending","sending"]] | order(firstQueuedAt asc)[0].firstQueuedAt
}`;

/** The alarm's audience. Admins are not paged for a broken pipeline; owners are. */
const SUPER_ADMIN_QUERY = `*[_type == "teamMembers" && role == "super-admin"]{ _id, email, alias, member_name }`;

export interface OutboxLiveness {
  /** Notices in `pending` or `sending`, after this run's sweep. */
  count: number;
  /** Age of the oldest, in hours; `0` when the outbox is empty. */
  oldestHours: number;
  /** Did it cross `NOTIFY_STALE_ALERT_HOURS` and page somebody? */
  alerted: boolean;
}

interface SuperAdmin {
  _id: string;
  email?: string;
  alias?: string;
  member_name?: string;
}

const round1 = (n: number): number => Math.round(n * 10) / 10;

function buildStaleEmail(o: { count: number; oldestHours: number }): { subject: string; html: string } {
  const link = `${appBaseUrl()}/admin`;
  const hours = escapeHtml(String(round1(o.oldestHours)));
  const count = escapeHtml(String(o.count));
  const subject = "Alerta: los correos de notificación no están saliendo";
  const body =
    tr(
      td(`<span style="font:700 15px system-ui,sans-serif;color:${C.frost}">La cola de notificaciones está atascada</span>`, {
        style: "padding:18px 24px 8px",
      }),
    ) +
    tr(
      td(
        `<p style="margin:0;font:14px system-ui,sans-serif;color:${C.frost}">Hay <strong style="color:${C.beam}">${count}</strong> aviso(s) sin enviar. El más antiguo lleva <strong style="color:${C.beam}">${hours} h</strong> esperando.</p>`,
        { style: "padding:0 24px 12px" },
      ),
    ) +
    tr(
      td(
        `<p style="margin:0;font:13px system-ui,sans-serif;color:${C.frost}">Nada se envía cada 5 minutos, así que lo más probable es que el workflow <em>Flush notification outbox</em> de GitHub Actions esté detenido, deshabilitado o sin el secreto correcto. Revísalo en GitHub → Actions.</p>`,
        { style: "padding:0 24px 18px" },
      ),
    ) +
    tr(
      td(
        `<a href="${link}" style="display:inline-block;background:${C.beam};color:${C.blackout};text-decoration:none;padding:10px 18px;border-radius:6px;font:700 13px system-ui,sans-serif">Abrir el panel →</a>`,
        { style: "padding:0 24px 20px" },
      ),
    );
  return { subject, html: shell(body, link) };
}

async function emailSuperAdmins(o: { count: number; oldestHours: number }): Promise<void> {
  const admins = (await operationalClient.fetch<SuperAdmin[] | null>(SUPER_ADMIN_QUERY, {})) ?? [];
  if (!admins.length) {
    console.error(JSON.stringify({ event: "notify_outbox_stale_unreachable", reason: "no_super_admin" }));
    return;
  }
  const allow = getAllowlist();
  const redirectTo = process.env.EMAIL_REDIRECT_TO?.trim();
  const { subject, html } = buildStaleEmail(o);
  for (const admin of admins) {
    const email = admin.email?.trim().toLowerCase();
    if (!email || !isEmailAllowed(email, allow)) continue;
    const res = await sendEmail({
      to: redirectTo || email,
      subject: redirectTo ? `[→ ${email}] ${subject}` : subject,
      html,
    });
    if (!res.ok) {
      console.error(
        JSON.stringify({ event: "notify_outbox_stale_email_failed", memberId: admin._id, error: res.error }),
      );
    }
  }
}

/**
 * Measure the outbox and, past the threshold, say so loudly and to a person.
 *
 * Call it AFTER the sweep in the same request: what the sweep just consumed is
 * not a backlog, and measuring first would alarm on notices that are already
 * gone by the time the email lands.
 *
 * The age is a difference of INSTANTS (`firstQueuedAt` is a full ISO datetime),
 * never calendar arithmetic — the local-noon rule in this repo governs
 * `YYYY-MM-DD` service dates, which this is not.
 *
 * Best-effort like every other delivery here: it never throws, so a daily cron
 * can never fail because its alarm could not read or send.
 */
export async function reportOutboxLiveness(now: Date = new Date()): Promise<OutboxLiveness> {
  const idle: OutboxLiveness = { count: 0, oldestHours: 0, alerted: false };
  try {
    const row = await operationalClient.fetch<{ count?: number; oldest?: string | null } | null>(
      STALE_OUTBOX_QUERY,
      {},
    );
    const count = typeof row?.count === "number" ? row.count : 0;
    const oldest = typeof row?.oldest === "string" ? row.oldest : null;
    if (!count || !oldest) return idle;

    const ms = now.getTime() - Date.parse(oldest);
    if (!Number.isFinite(ms)) return { count, oldestHours: 0, alerted: false };
    const oldestHours = ms / 3_600_000;
    if (oldestHours < STALE_ALERT_HOURS) return { count, oldestHours, alerted: false };

    // One loud structured line — and then the part that actually reaches a human.
    console.error(
      JSON.stringify({
        event: "notify_outbox_stale",
        count,
        oldestHours: round1(oldestHours),
        thresholdHours: STALE_ALERT_HOURS,
        oldest,
      }),
    );
    await emailSuperAdmins({ count, oldestHours });
    return { count, oldestHours, alerted: true };
  } catch (err) {
    console.error(JSON.stringify({ event: "notify_outbox_liveness_failed" }), err);
    return idle;
  }
}
