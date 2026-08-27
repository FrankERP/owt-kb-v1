// app/utils/proposalNotify.ts
//
// Fan-out when a lead submits a setlist proposal for review (status → pending):
//   1. Push to admins        — "hay una propuesta por revisar"
//   2. Push to co-lead(s)     — the OTHER Lead(s) on the same service, so they
//                               learn a proposal was pushed (the app previously
//                               gave co-leads no signal at all).
//   3. Email to admins        — allowlist-gated + opt-out aware; no-ops entirely
//                               until SMTP/Resend env is set (same as assignment
//                               emails), so it's inert in dev.
// Every step is best-effort and swallowed: a failed notification must never fail
// the proposal write that triggered it.
import { operationalClient, rawIntegrityClient } from "@/sanity/lib/operationalClient";
import { canonicalRoleByIdQuery, rawRoleDraftForBaseQuery } from "./serviceReadQueries";
import { validateRole } from "./serviceReadModel";
import { canonicalLeadRefs, pickUnique } from "./serviceReadSelect";
import { sendPush } from "./push";
import { sendEmail } from "./email";
import { getAllowlist, isEmailAllowed, appBaseUrl, escapeHtml } from "./assignmentEmail";
import { wantsNotification } from "./notifyPrefs";
import { SUBMITTED_NOTIFY_QUERY, type SubmittedNotifyRow } from "./proposalNotifyQueries";
import { C, td, tr, shell } from "./emailShell";
import { songRowsFrom, type OutboxSongRow } from "./outboxNotice";
import { buildSetlistTable } from "./setlistDiff";
import { renderSetlistTable } from "./notificationEmail";

const SERVICE_LABEL: Record<string, string> = {
  sunday: "Domingo",
  saturday: "Sábado",
  special: "Especial",
};

// Restyled onto the shared dark shell (spec §6: "proposalNotify.ts's 'nueva
// propuesta' admin email is restyled with them, for consistency"). Same shell
// as assignmentEmail.ts/notificationEmail.ts, imported from emailShell.ts.
export function buildProposalEmail(o: {
  leadName: string;
  serviceType: string;
  serviceDate: string;
  songs?: OutboxSongRow[];
  titles?: Map<string, string>;
  notes?: string;
}): { subject: string; html: string } {
  const svc = SERVICE_LABEL[o.serviceType] ?? "Servicio";
  const dateFmt = new Date(o.serviceDate + "T12:00:00").toLocaleDateString("es-MX", { day: "numeric", month: "short" });
  const lead = escapeHtml(o.leadName || "Un líder");
  const link = `${appBaseUrl()}/admin`;
  const subject = `Nueva propuesta — ${svc} ${dateFmt}`;
  const header = tr(td(
    `<span style="font:700 15px system-ui,sans-serif;color:${C.ink}">Nueva propuesta de setlist</span>`,
    { style: "padding:18px 24px 8px" },
  ));
  const intro = tr(td(
    `<p style="margin:0;font:14px system-ui,sans-serif;color:${C.ink}"><strong style="color:${C.accent}">${lead}</strong> envió una propuesta para el <strong style="color:${C.ink}">${svc} ${dateFmt}</strong> y está lista para tu revisión.</p>`,
    { style: "padding:0 24px 18px" },
  ));
  const songs = o.songs ?? [];
  const table = songs.length
    ? tr(td(renderSetlistTable(buildSetlistTable([], songs), o.titles ?? new Map(), false), { style: "padding:0 24px 18px" }))
    : "";
  const notes = (o.notes ?? "").trim();
  const notesBlock = notes
    ? tr(td(
      `<span style="display:block;font:700 10px system-ui,sans-serif;text-transform:uppercase;letter-spacing:.08em;color:${C.muted};padding-bottom:6px">Notas del líder</span>` +
      `<p style="margin:0;white-space:pre-wrap;font:14px system-ui,sans-serif;color:${C.ink}">${escapeHtml(notes)}</p>`,
      { style: "padding:0 24px 18px" },
    ))
    : "";
  const body = header + intro + table + notesBlock +
    tr(td(
      `<a href="${link}" style="display:inline-block;background:${C.accent};color:${C.field};text-decoration:none;padding:10px 18px;border-radius:6px;font:700 13px system-ui,sans-serif">Revisar propuesta →</a>`,
      { style: "padding:0 24px 20px" },
    ));
  const html = shell(body, link);
  return { subject, html };
}

async function emailAdmins(
  adminIds: string[],
  o: {
    leadName: string;
    serviceType: string;
    serviceDate: string;
    songs: OutboxSongRow[];
    titles: Map<string, string>;
    notes: string;
  },
): Promise<void> {
  if (!adminIds.length) return;
  const allow = getAllowlist();
  const admins = await operationalClient.fetch<{ _id: string; email?: string; notifPrefs?: unknown }[]>(
    `*[_type == "teamMembers" && _id in $ids]{ _id, email, notifPrefs }`,
    { ids: adminIds },
  );
  const redirectTo = process.env.EMAIL_REDIRECT_TO?.trim();
  const { subject, html } = buildProposalEmail(o);
  for (const m of admins) {
    const email = m.email?.trim().toLowerCase();
    if (!email || !isEmailAllowed(email, allow) || !wantsNotification(m.notifPrefs, "proposals")) continue;
    const to = redirectTo || email;
    const finalSubject = redirectTo ? `[→ ${email}] ${subject}` : subject;
    const res = await sendEmail({ to, subject: finalSubject, html });
    if (!res.ok) console.error(`[proposalNotify] email send failed for ${m._id}:`, res.error);
  }
}

/**
 * Notify admins + co-lead(s) that a proposal was submitted for review.
 * Best-effort; never throws. Await it so the email actually sends before a
 * serverless function freezes, but a failure here won't reject the caller.
 */
export async function notifyProposalSubmitted(opts: {
  leadId: string;
  roleId: string;
  proposalId: string;
  serviceType: "sunday" | "saturday" | "special";
  serviceDate: string;
}): Promise<void> {
  const { leadId, roleId, proposalId, serviceType, serviceDate } = opts;
  try {
    // Resolve the service role through the canonical (published-perspective)
    // contract, never `raw`/`[0]`. Fail closed — send NOTHING — when the role
    // identity is missing, ambiguous, structurally invalid, or draft-conflicted
    // (a published base plus a `drafts.` overlay), so a notification can never
    // fan out to co-leads read off an untrusted or overlaid role.
    const roleQ = canonicalRoleByIdQuery(roleId);
    const draftQ = rawRoleDraftForBaseQuery(roleId);
    const [canonicalRoles, rawRoleDrafts] = await Promise.all([
      operationalClient.fetch<unknown[]>(roleQ.query, roleQ.params),
      rawIntegrityClient.fetch<unknown[]>(draftQ.query, draftQ.params),
    ]);

    const role = pickUnique(canonicalRoles); // none/duplicate -> null (fail closed)
    if (!role) return;
    if (!validateRole(role).groupable) return; // invalid identity -> fail closed
    if (Array.isArray(rawRoleDrafts) && rawRoleDrafts.length > 0) return; // draft conflict

    const data = await operationalClient.fetch<SubmittedNotifyRow>(
      SUBMITTED_NOTIFY_QUERY,
      { leadId, proposalId },
    );
    const admins = data.admins ?? [];
    const coLeads = canonicalLeadRefs(role).filter((id) => id && id !== leadId);
    const leadName = data.lead?.alias || data.lead?.member_name || "Un líder";
    const songs = songRowsFrom(data.proposal?.songs);
    // The LAST element of an ALREADY-FILTERED array — not a second `kind` filter
    // and not a GROQ negative index. `LEAD_NOTE_MESSAGES` did the filtering, and
    // re-filtering here is what would silently match nothing if the projection
    // were ever narrowed to `{body}`.
    //
    // The newest LEAD note, deliberately, on a thread whose newest message is
    // routinely an admin's change request: `notifyProposalSubmitted` fires on
    // every save committed `pending`, so a resubmit from `changes_requested` is
    // the routine path, and mailing admins their own change-request text back
    // under a heading that says "Notas del líder" is what taking the last
    // message would do.
    const leadMessages = Array.isArray(data.proposal?.leadMessages)
      ? data.proposal.leadMessages
      : [];
    const newest = leadMessages[leadMessages.length - 1];
    const notes = typeof newest?.body === "string" ? newest.body : "";

    // 1) Admins — push
    if (admins.length) {
      void sendPush(admins, "proposals", {
        title: "Nueva propuesta",
        body: "Hay una propuesta de setlist por revisar.",
        path: "/admin",
      });
    }

    // 2) Co-lead(s) on the same service — push
    if (coLeads.length) {
      void sendPush(coLeads, "proposals", {
        title: "Propuesta de setlist",
        body: `${leadName} envió una propuesta para este servicio.`,
        path: `/me/propose/${roleId}`,
      });
    }

    // Titles are email-only. Fetch them after push so a titles timeout cannot
    // swallow the notify once the audience is already known. `renderSetlistTable`
    // already falls back to the song ref when a title is missing.
    const titles = new Map<string, string>();
    const refs = [...new Set(songs.map((s) => s.ref).filter(Boolean))];
    if (refs.length) {
      try {
        const rows = await operationalClient.fetch<{ _id: string; title?: string }[] | null>(
          `*[_type == "post" && _id in $ids]{ _id, title }`,
          { ids: refs },
        );
        for (const row of rows ?? []) if (row?._id && row.title) titles.set(row._id, row.title);
      } catch (err) {
        console.error("[proposalNotify] song titles fetch failed:", err);
      }
    }

    // 3) Admins — email (inert without SMTP/Resend + allowlist)
    await emailAdmins(admins, { leadName, serviceType, serviceDate, songs, titles, notes });
  } catch (err) {
    console.error("[proposalNotify] notifyProposalSubmitted failed:", err);
  }
}
