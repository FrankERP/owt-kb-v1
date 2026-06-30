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

// Whether a recipient may be emailed. `EMAIL_ALLOWLIST="*"` opens it to every
// member with a valid email (whole team); otherwise only listed addresses.
// Default (env unset) is Frank-only.
export function isEmailAllowed(email: string | undefined, allow: string[] = getAllowlist()): boolean {
  if (!email) return false;
  return allow.includes("*") || allow.includes(email);
}

export function assigneesOf(b: ServiceBody): string[] {
  return [
    ...(b.leads ?? []), ...(b.bgvs ?? []), ...(b.chorus ?? []),
    ...(b.instruments ?? []).map((i) => i.personId),
    ...(b.foh ?? []).map((f) => f.personId),
  ].filter(Boolean);
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

// Absolute base URL for email links (emails can't use relative paths).
// Priority: an explicit non-localhost NEXTAUTH_URL, else Vercel's auto-set
// VERCEL_PROJECT_PRODUCTION_URL (host only — prepend https), else the raw
// NEXTAUTH_URL (covers localhost in dev), else "" (relative, last resort).
// This app uses Auth.js URL auto-detection, so NEXTAUTH_URL may be unset in
// production — VERCEL_PROJECT_PRODUCTION_URL is always present on Vercel.
function appBaseUrl(): string {
  const explicit = process.env.NEXTAUTH_URL?.trim();
  if (explicit && !explicit.includes("localhost")) return explicit.replace(/\/$/, "");
  const vercel = process.env.VERCEL_PROJECT_PRODUCTION_URL?.trim();
  if (vercel) return `https://${vercel.replace(/^https?:\/\//, "").replace(/\/$/, "")}`;
  return (explicit ?? "").replace(/\/$/, "");
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

// One email summarizing several services for a single member. A 1-item list
// falls back to the normal single-service template, so members assigned to just
// one of the published services get the familiar email.
export function buildBatchAssignmentEmail(o: { name: string; items: { type: ServiceType; date: string; roles: string[] }[] }): { subject: string; html: string } {
  if (o.items.length === 1) {
    const it = o.items[0];
    return buildAssignmentEmail({ name: o.name, roles: it.roles, type: it.type, date: it.date });
  }
  const name = escapeHtml(o.name || "equipo");
  const link = `${appBaseUrl()}/me`;
  const n = o.items.length;
  const subject = `Nuevas asignaciones — ${n} servicios`;
  const rows = o.items.map((it) => {
    const svc = SERVICE_LABEL[it.type];
    const dateFmt = new Date(it.date + "T12:00:00").toLocaleDateString("es-MX", { day: "numeric", month: "short" });
    const rolesText = escapeHtml(it.roles.length ? it.roles.join(", ") : "el equipo");
    return `<li style="margin-bottom:6px"><strong>${svc} ${dateFmt}</strong> — ${rolesText}</li>`;
  }).join("");
  const html = `
    <div style="font-family:system-ui,sans-serif;max-width:480px;margin:0 auto;color:#0b1f33">
      <h2 style="color:#003572">Nuevas asignaciones</h2>
      <p>Hola ${name},</p>
      <p>Tienes <strong>${n}</strong> nuevas asignaciones:</p>
      <ul style="padding-left:18px">${rows}</ul>
      <p><a href="${link}" style="display:inline-block;background:#003572;color:#fff;text-decoration:none;padding:10px 18px;border-radius:8px">Ver mis servicios →</a></p>
      <p style="color:#6b7280;font-size:12px">Oasis Worship Team</p>
    </div>`.trim();
  return { subject, html };
}

// Batched send: collapses N services into ONE email per member (vs one email
// per service). Used when publishing several services at once. Same allowlist
// gating and EMAIL_REDIRECT_TO override as the single-service path.
export async function sendAssignmentEmailsBatch(
  services: { type: ServiceType; date: string; body: ServiceBody }[],
): Promise<void> {
  try {
    const byMember = new Map<string, { type: ServiceType; date: string; roles: string[] }[]>();
    for (const svc of services) {
      for (const id of new Set(assigneesOf(svc.body))) {
        const roles = rolesForMember(id, svc.body);
        if (!roles.length) continue;
        const arr = byMember.get(id) ?? [];
        arr.push({ type: svc.type, date: svc.date, roles });
        byMember.set(id, arr);
      }
    }
    const ids = [...byMember.keys()];
    if (!ids.length) return;
    const allow = getAllowlist();
    const members = await serverClient.fetch<{ _id: string; member_name?: string; alias?: string; email?: string }[]>(
      `*[_type == "teamMembers" && _id in $ids]{ _id, member_name, alias, email }`,
      { ids },
    );
    const redirectTo = process.env.EMAIL_REDIRECT_TO?.trim();
    for (const m of members) {
      const email = m.email?.trim().toLowerCase();
      if (!email || !isEmailAllowed(email, allow)) continue;
      const items = (byMember.get(m._id) ?? []).slice().sort((a, b) => a.date.localeCompare(b.date));
      if (!items.length) continue;
      const { subject, html } = buildBatchAssignmentEmail({ name: m.alias || m.member_name || "", items });
      const to = redirectTo || email;
      const finalSubject = redirectTo ? `[→ ${email}] ${subject}` : subject;
      const res = await sendEmail({ to, subject: finalSubject, html });
      if (!res.ok) console.error(`[assignmentEmail] batch send failed for ${m._id}:`, res.error);
    }
  } catch (err) {
    console.error("[assignmentEmail] sendAssignmentEmailsBatch failed:", err);
  }
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
    // Optional test override: when set, deliver every email to this address
    // instead of the real member (e.g. Resend test mode can only send to the
    // account's own inbox). The allowlist still gates WHICH members generate an
    // email; only the delivery target is rerouted. The original recipient is
    // shown in the subject so it's clear who the message was meant for.
    const redirectTo = process.env.EMAIL_REDIRECT_TO?.trim();
    for (const m of members) {
      const email = m.email?.trim().toLowerCase();
      if (!email || !isEmailAllowed(email, allow)) continue;
      const roles = rolesForMember(m._id, service.body);
      const { subject, html } = buildAssignmentEmail({ name: m.alias || m.member_name || "", roles, type: service.type, date: service.date });
      const to = redirectTo || email;
      const finalSubject = redirectTo ? `[→ ${email}] ${subject}` : subject;
      const res = await sendEmail({ to, subject: finalSubject, html });
      if (!res.ok) console.error(`[assignmentEmail] send failed for ${m._id}:`, res.error);
    }
  } catch (err) {
    console.error("[assignmentEmail] sendAssignmentEmails failed:", err);
  }
}
