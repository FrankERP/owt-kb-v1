// app/utils/assignmentEmail.ts
import { serverClient } from "@/sanity/lib/serverClient";
import { sendEmail } from "./email";
import { wantsNotification } from "./notifyPrefs";
import { C, td, tr, shell } from "./emailShell";

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
  // Default is the whole team ("*"): the Resend test-mode era that needed a
  // Frank-only gate is over (SMTP via contacto@oasis.mx is live). Set
  // EMAIL_ALLOWLIST to a comma-separated list to narrow delivery again.
  return (process.env.EMAIL_ALLOWLIST ?? "*")
    .split(",").map((s) => s.trim().toLowerCase()).filter(Boolean);
}

// Whether a recipient may be emailed. `EMAIL_ALLOWLIST="*"` opens it to every
// member with a valid email (whole team); otherwise only listed addresses.
// Default (env unset) is the whole team; per-member opt-out still applies.
export function isEmailAllowed(email: string | undefined, allow: string[] = getAllowlist()): boolean {
  if (!email) return false;
  return allow.includes("*") || allow.includes(email);
}

// NOTE: there is no `wantsEmail` here any more. It resolved the legacy
// `notifPrefs.email` field alone and lost its last caller when `proposalNotify`
// moved to `wantsNotification`. `wantsNotification` (app/utils/notifyPrefs.ts) is
// the ONE preference resolver every sender goes through; a second, weaker one
// sitting next to it is how "nothing reads `notifPrefs` fields directly" quietly
// stops being true.

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

export function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c] as string));
}

// Absolute base URL for email links (emails can't use relative paths).
// Priority: an explicit non-localhost NEXTAUTH_URL, else Vercel's auto-set
// VERCEL_PROJECT_PRODUCTION_URL (host only — prepend https), else the raw
// NEXTAUTH_URL (covers localhost in dev), else "" (relative, last resort).
// This app uses Auth.js URL auto-detection, so NEXTAUTH_URL may be unset in
// production — VERCEL_PROJECT_PRODUCTION_URL is always present on Vercel.
export function appBaseUrl(): string {
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
  const body =
    tr(td(
      `<p style="margin:0 0 4px;font:14px system-ui,sans-serif;color:${C.frost}">Hola ${name},</p>` +
      `<p style="margin:0;font:14px system-ui,sans-serif;color:${C.frost}">Sirves como <strong style="color:${C.beam}">${rolesText}</strong> el <strong style="color:${C.frost}">${svc} ${dateFmt}</strong>.</p>`,
      { style: "padding:0 24px 18px" },
    )) +
    tr(td(
      `<a href="${link}" style="display:inline-block;background:${C.beam} !important;color:${C.blackout};text-decoration:none;padding:10px 18px;border-radius:6px;font:700 13px system-ui,sans-serif">Ver servicio →</a>`,
      { style: "padding:0 24px 20px" },
    ));
  const html = shell(body, link);
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
  const headCell = (text: string) => td(
    `<span style="font:700 10px system-ui,sans-serif;text-transform:uppercase;letter-spacing:.08em;color:${C.steel}">${text}</span>`,
    { bg: C.deck, style: `padding:8px 8px;border-bottom:1px solid ${C.blackout}` },
  );
  const rows = o.items.map((it) => {
    const svc = SERVICE_LABEL[it.type];
    const dateFmt = new Date(it.date + "T12:00:00").toLocaleDateString("es-MX", { day: "numeric", month: "short" });
    const rolesText = escapeHtml(it.roles.length ? it.roles.join(", ") : "el equipo");
    return tr(
      td(`<span style="color:${C.frost};font:13px system-ui,sans-serif">${svc} ${dateFmt}</span>`, { style: "padding:8px 8px" }) +
      td(`<strong style="color:${C.beam};font:13px system-ui,sans-serif">${rolesText}</strong>`, { style: "padding:8px 8px" }),
    );
  }).join("");
  const table = `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" bgcolor="${C.deck}" style="background:${C.deck} !important;border-collapse:collapse">${tr(headCell("Fecha") + headCell("Tu rol"))}${rows}</table>`;
  const body =
    tr(td(
      `<p style="margin:0 0 4px;font:14px system-ui,sans-serif;color:${C.frost}">Hola ${name},</p>` +
      `<p style="margin:0;font:14px system-ui,sans-serif;color:${C.frost}">Tienes <strong style="color:${C.beam}">${n}</strong> nuevas asignaciones:</p>`,
      { style: "padding:0 24px 12px" },
    )) +
    tr(td(table, { style: "padding:0 24px 20px" })) +
    tr(td(
      `<a href="${link}" style="display:inline-block;background:${C.beam} !important;color:${C.blackout};text-decoration:none;padding:10px 18px;border-radius:6px;font:700 13px system-ui,sans-serif">Ver mis servicios →</a>`,
      { style: "padding:0 24px 20px" },
    ));
  const html = shell(body, link);
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
    const members = await serverClient.fetch<{ _id: string; member_name?: string; alias?: string; email?: string; notifPrefs?: unknown }[]>(
      `*[_type == "teamMembers" && _id in $ids]{ _id, member_name, alias, email, notifPrefs }`,
      { ids },
    );
    const redirectTo = process.env.EMAIL_REDIRECT_TO?.trim();
    for (const m of members) {
      const email = m.email?.trim().toLowerCase();
      if (!email || !isEmailAllowed(email, allow) || !wantsNotification(m.notifPrefs, "assigned")) continue;
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

/**
 * Single-service send. NO PRODUCTION CALLER since the notification outbox
 * absorbed the immediate assignment email (spec §7): `notifyRoleAssignments`
 * lost this leg, and publishing uses the batched path above. It is kept as the
 * single-service transport the A3 delivery-firewall contract tests exercise
 * (`deliveryFirewallTransports.test.ts`), and as the shape a future
 * single-service send would reuse rather than reinvent.
 */
export async function sendAssignmentEmails(
  memberIds: string[],
  service: { type: ServiceType; date: string; body: ServiceBody },
): Promise<void> {
  try {
    const ids = [...new Set(memberIds)].filter(Boolean);
    if (!ids.length) return;
    const allow = getAllowlist();
    const members = await serverClient.fetch<{ _id: string; member_name?: string; alias?: string; email?: string; notifPrefs?: unknown }[]>(
      `*[_type == "teamMembers" && _id in $ids]{ _id, member_name, alias, email, notifPrefs }`,
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
      if (!email || !isEmailAllowed(email, allow) || !wantsNotification(m.notifPrefs, "assigned")) continue;
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
