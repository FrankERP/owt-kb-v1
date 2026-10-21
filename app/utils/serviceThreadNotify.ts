// Telling a service's leads that an admin wrote about it from the service card
// (ADR-0064) — typically what the pastor shared, which they want BEFORE choosing
// songs.
//
// Push AND email, unlike an admin message on a proposal (push only). Push alone
// reached almost nobody: few members have it on (2026-10-13), so a pastor's
// message would sit unread until a lead happened to open the page. The email goes
// only to the service's Lead seat — one or two people per message — so it does
// not threaten the Gmail account's ~500 recipients a day (ADR-0025). Each lead's
// `emailProposals` preference and the allowlist still apply, and Preview mail
// goes to `EMAIL_REDIRECT_TO` like every other app email.
//
// Best-effort and never throws: the message is already stored.

import { operationalClient } from "@/sanity/lib/operationalClient";
import { sendPush } from "./push";
import { sendEmail } from "./email";
import { getAllowlist, isEmailAllowed, appBaseUrl, escapeHtml } from "./assignmentEmail";
import { wantsNotification } from "./notifyPrefs";
import { C, td, tr, shell } from "./emailShell";
import { serviceLabel, type ServiceIdentity } from "./emailServiceLabel";

/** The email, pure. `label` is `serviceLabel`'s plain text; everything is escaped here. */
export function buildServiceThreadEmail(o: {
  authorName: string;
  label: string;
  body: string;
  link: string;
  /** «Es el mensaje del pastor»: the admin relayed what the pastor sent. */
  pastor?: boolean;
}): { subject: string; html: string } {
  const author = escapeHtml(o.authorName || "Un admin");
  const label = escapeHtml(o.label);
  const subject = o.pastor
    ? `Mensaje del pastor para tu servicio — ${o.label}`
    : `Mensaje para tu servicio — ${o.label}`;
  const header = tr(td(
    `<span style="font:700 15px system-ui,sans-serif;color:${C.ink}">${o.pastor ? "Mensaje del pastor" : "Mensaje de los admins"}</span>`,
    { style: "padding:18px 24px 8px" },
  ));
  const intro = tr(td(
    o.pastor
      ? `<p style="margin:0;font:14px system-ui,sans-serif;color:${C.ink}"><strong style="color:${C.accent}">${author}</strong> compartió el mensaje del pastor para el servicio del <strong style="color:${C.ink}">${label}</strong>.</p>`
      : `<p style="margin:0;font:14px system-ui,sans-serif;color:${C.ink}"><strong style="color:${C.accent}">${author}</strong> escribió sobre el servicio del <strong style="color:${C.ink}">${label}</strong>.</p>`,
    { style: "padding:0 24px 14px" },
  ));
  const message = tr(td(
    `<p style="margin:0;white-space:pre-wrap;font:14px system-ui,sans-serif;color:${C.ink}">${escapeHtml(o.body)}</p>`,
    { style: "padding:0 24px 18px" },
  ));
  const cta = tr(td(
    `<a href="${o.link}" style="display:inline-block;background:${C.accent};color:${C.field};text-decoration:none;padding:10px 18px;border-radius:6px;font:700 13px system-ui,sans-serif">Ver la conversación →</a>`,
    { style: "padding:0 24px 20px" },
  ));
  // The footer's «Ajustar mis avisos» goes to `/me`, where the lead can turn this
  // mail off; the proposal page is only on the button.
  return { subject, html: shell(header + intro + message + cta, `${appBaseUrl()}/me`) };
}

/**
 * Push and email the service's leads, never the author. The caller passes the
 * Lead seat and the role identity read PRE-COMMIT, and skips this for an
 * unpublished service (its leads cannot open the page yet).
 */
export async function notifyLeadsAboutServiceMessage(o: {
  leadIds: string[];
  authorId: string | null;
  authorName: string;
  roleId: string;
  roleType: string;
  serviceDate: string;
  identity: ServiceIdentity;
  body: string;
  pastor?: boolean;
}): Promise<void> {
  const recipients = [...new Set(o.leadIds.filter((id) => id && id !== o.authorId))];
  if (!recipients.length) return;
  const path = `/me/propose/${encodeURIComponent(o.roleId)}`;
  // Date at local noon — never a bare `new Date(iso)`.
  const when = new Date(`${o.serviceDate.slice(0, 10)}T12:00:00`).toLocaleDateString("es-MX", {
    day: "numeric",
    month: "short",
  });

  // Each channel on its own: a push failure must not cost the email, and back.
  await Promise.allSettled([
    sendPush(recipients, "proposals", {
      title: o.pastor ? "Mensaje del pastor" : "Nuevo mensaje",
      body: o.pastor
        ? `Hay un mensaje del pastor para el servicio del ${when}.`
        : `Un admin escribió sobre el servicio del ${when}.`,
      path,
    }),
    emailLeads(recipients, o, path),
  ]).then((results) => {
    for (const r of results) {
      if (r.status === "rejected") console.error("[serviceThreadNotify] delivery failed:", r.reason);
    }
  });
}

async function emailLeads(
  leadIds: string[],
  o: { authorName: string; roleType: string; serviceDate: string; identity: ServiceIdentity; body: string; pastor?: boolean },
  path: string,
): Promise<void> {
  const members = await operationalClient.fetch<{ _id: string; email?: string; notifPrefs?: unknown }[]>(
    `*[_type == "teamMembers" && _id in $ids]{ _id, email, notifPrefs }`,
    { ids: leadIds },
  );
  const allow = getAllowlist();
  const redirectTo = process.env.EMAIL_REDIRECT_TO?.trim();
  const { subject, html } = buildServiceThreadEmail({
    authorName: o.authorName,
    label: serviceLabel({ date: o.serviceDate, roleType: o.roleType, ...o.identity }),
    body: o.body,
    link: `${appBaseUrl()}${path}`,
    pastor: o.pastor,
  });
  // Serial, like every other app sender (ADR-0013).
  for (const m of members ?? []) {
    const email = m.email?.trim().toLowerCase();
    if (!email || !isEmailAllowed(email, allow) || !wantsNotification(m.notifPrefs, "proposals")) continue;
    const to = redirectTo || email;
    const finalSubject = redirectTo ? `[→ ${email}] ${subject}` : subject;
    const res = await sendEmail({ to, subject: finalSubject, html });
    if (!res.ok) console.error(`[serviceThreadNotify] email send failed for ${m._id}:`, res.error);
  }
}
