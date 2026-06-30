// app/utils/assignmentEmail.ts
import { serverClient } from "@/sanity/lib/serverClient";
import { sendEmail } from "./email";

export type ServiceType = "sunday_role" | "saturday_role" | "special_role";
export interface ServiceBody {
  leads?: string[]; bgvs?: string[]; chorus?: string[];
  instruments?: { instrument: string; personId: string }[];
  foh?: { role: string; personId: string }[];
}

const SERVICE_LABEL: Record<ServiceType, string> = {
  sunday_role: "Domingo", saturday_role: "Sábado", special_role: "Servicio especial",
};

export function getAllowlist(): string[] {
  return (process.env.EMAIL_ALLOWLIST ?? "chikipuas@gmail.com")
    .split(",").map((s) => s.trim().toLowerCase()).filter(Boolean);
}

export function rolesForMember(id: string, b: ServiceBody): string[] {
  const roles: string[] = [];
  if ((b.leads ?? []).includes(id)) roles.push("Líder");
  if ((b.bgvs ?? []).includes(id)) roles.push("BGV");
  if ((b.chorus ?? []).includes(id)) roles.push("Coro");
  for (const i of b.instruments ?? []) if (i.personId === id) roles.push(i.instrument);
  for (const f of b.foh ?? []) if (f.personId === id) roles.push(f.role);
  return roles;
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c] as string));
}

// Absolute base URL for email links. NEXTAUTH_URL is the canonical app origin in
// this NextAuth app and is guaranteed set to the real domain in production (auth
// breaks otherwise), and to http://localhost:3000 in dev. Email links use it
// directly; if somehow unset, fall back to a relative path rather than a guess.
function appBaseUrl(): string {
  return (process.env.NEXTAUTH_URL?.trim() ?? "").replace(/\/$/, "");
}

export function buildAssignmentEmail(o: { name: string; roles: string[]; type: ServiceType; date: string }): { subject: string; html: string } {
  const svc = SERVICE_LABEL[o.type];
  const dateFmt = new Date(o.date + "T12:00:00").toLocaleDateString("es-MX", { day: "numeric", month: "short" });
  const rolesText = escapeHtml(o.roles.length ? o.roles.join(", ") : "el equipo");
  const name = escapeHtml(o.name || "equipo");
  const link = `${appBaseUrl()}/me`;
  const subject = `Asignación — ${svc} ${dateFmt}`;
  const html = `
    <div style="font-family:system-ui,sans-serif;max-width:480px;margin:0 auto;color:#0b1f33">
      <h2 style="color:#003572">Nueva asignación</h2>
      <p>Hola ${name},</p>
      <p>Estás asignado como <strong>${rolesText}</strong> el <strong>${svc} ${dateFmt}</strong>.</p>
      <p><a href="${link}" style="display:inline-block;background:#003572;color:#fff;text-decoration:none;padding:10px 18px;border-radius:8px">Ver servicio →</a></p>
      <p style="color:#6b7280;font-size:12px">Oasis Worship Team</p>
    </div>`.trim();
  return { subject, html };
}

export async function sendAssignmentEmails(
  memberIds: string[],
  service: { type: ServiceType; date: string; body: ServiceBody },
): Promise<void> {
  try {
    const ids = [...new Set(memberIds)].filter(Boolean);
    if (!ids.length) return;
    const allow = getAllowlist();
    const members = await serverClient.fetch<{ _id: string; member_name?: string; alias?: string; email?: string }[]>(
      `*[_type == "teamMembers" && _id in $ids]{ _id, member_name, alias, email }`,
      { ids },
    );
    for (const m of members) {
      const email = m.email?.trim().toLowerCase();
      if (!email || !allow.includes(email)) continue;
      const roles = rolesForMember(m._id, service.body);
      const { subject, html } = buildAssignmentEmail({ name: m.alias || m.member_name || "", roles, type: service.type, date: service.date });
      const res = await sendEmail({ to: email, subject, html });
      if (!res.ok) console.error(`[assignmentEmail] send failed for ${m._id}:`, res.error);
    }
  } catch (err) {
    console.error("[assignmentEmail] sendAssignmentEmails failed:", err);
  }
}
