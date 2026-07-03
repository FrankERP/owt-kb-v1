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
import { serverClient } from "@/sanity/lib/serverClient";
import { sendPush } from "./push";
import { sendEmail } from "./email";
import { getAllowlist, isEmailAllowed, wantsEmail, appBaseUrl, escapeHtml } from "./assignmentEmail";

const SERVICE_LABEL: Record<string, string> = {
  sunday: "Domingo",
  saturday: "Sábado",
  special: "Especial",
};

export function buildProposalEmail(o: { leadName: string; serviceType: string; serviceDate: string }): { subject: string; html: string } {
  const svc = SERVICE_LABEL[o.serviceType] ?? "Servicio";
  const dateFmt = new Date(o.serviceDate + "T12:00:00").toLocaleDateString("es-MX", { day: "numeric", month: "short" });
  const lead = escapeHtml(o.leadName || "Un líder");
  const link = `${appBaseUrl()}/admin`;
  const subject = `Nueva propuesta — ${svc} ${dateFmt}`;
  const html = `
    <div style="font-family:system-ui,sans-serif;max-width:480px;margin:0 auto;color:#0b1f33">
      <h2 style="color:#003572">Nueva propuesta de setlist</h2>
      <p><strong>${lead}</strong> envió una propuesta para el <strong>${svc} ${dateFmt}</strong> y está lista para tu revisión.</p>
      <p><a href="${link}" style="display:inline-block;background:#003572;color:#fff;text-decoration:none;padding:10px 18px;border-radius:8px">Revisar propuesta →</a></p>
      <p style="color:#6b7280;font-size:12px">Oasis Worship Team</p>
    </div>`.trim();
  return { subject, html };
}

async function emailAdmins(
  adminIds: string[],
  o: { leadName: string; serviceType: string; serviceDate: string },
): Promise<void> {
  if (!adminIds.length) return;
  const allow = getAllowlist();
  const admins = await serverClient.fetch<{ _id: string; email?: string; emailPref?: boolean | null }[]>(
    `*[_type == "teamMembers" && _id in $ids]{ _id, email, "emailPref": notifPrefs.email }`,
    { ids: adminIds },
  );
  const redirectTo = process.env.EMAIL_REDIRECT_TO?.trim();
  const { subject, html } = buildProposalEmail(o);
  for (const m of admins) {
    const email = m.email?.trim().toLowerCase();
    if (!email || !isEmailAllowed(email, allow) || !wantsEmail(m.emailPref)) continue;
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
  serviceType: "sunday" | "saturday" | "special";
  serviceDate: string;
}): Promise<void> {
  const { leadId, roleId, serviceType, serviceDate } = opts;
  try {
    const data = await serverClient.fetch<{
      admins: string[] | null;
      coLeads: string[] | null;
      lead: { alias?: string; member_name?: string } | null;
    }>(
      `{
        "admins": *[_type == "teamMembers" && role in ["super-admin","admin"]]._id,
        "coLeads": *[_id == $roleId][0].Lead[]._ref,
        "lead": *[_id == $leadId][0]{ alias, member_name }
      }`,
      { roleId, leadId },
    );
    const admins = data.admins ?? [];
    const coLeads = (data.coLeads ?? []).filter((id) => id && id !== leadId);
    const leadName = data.lead?.alias || data.lead?.member_name || "Un líder";

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

    // 3) Admins — email (inert without SMTP/Resend + allowlist)
    await emailAdmins(admins, { leadName, serviceType, serviceDate });
  } catch (err) {
    console.error("[proposalNotify] notifyProposalSubmitted failed:", err);
  }
}
