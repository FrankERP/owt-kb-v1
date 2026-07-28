// app/utils/assignmentEmail.ts
import { serverClient } from "@/sanity/lib/serverClient";
import { sendEmail } from "./email";
import { wantsNotification } from "./notifyPrefs";

export type ServiceType = "sunday_role" | "saturday_role" | "special_role";
export interface ServiceBody {
  leads?: string[]; bgvs?: string[]; chorus?: string[];
  instruments?: { instrument: string; personId: string }[];
  foh?: { role: string; personId: string }[];
}

const SERVICE_LABEL: Record<ServiceType, string> = {
  sunday_role: "Domingo", saturday_role: "Sábado", special_role: "Servicio especial",
};

// Same dark shell as notificationEmail.ts (spec §6 restyle). Duplicated here
// rather than imported: notificationEmail.ts already imports escapeHtml and
// appBaseUrl FROM this file, so importing back the other way would cycle.
const C = {
  blackout: "#010B17",
  console: "#071624",
  deck: "#0D2234",
  beam: "#12C8F4",
  frost: "#D7E7F6",
  steel: "#7F94A8",
} as const;

function td(inner: string, opts: { bg?: string; style?: string; align?: string } = {}): string {
  const bg = opts.bg ?? C.console;
  const align = opts.align ? ` align="${opts.align}"` : "";
  return `<td bgcolor="${bg}"${align} style="background:${bg};${opts.style ?? ""}">${inner}</td>`;
}

function tr(inner: string): string {
  return `<tr>${inner}</tr>`;
}

function shell(bodyRows: string): string {
  const link = `${appBaseUrl()}/me`;
  const eyebrow = tr(td(
    `<span style="font:700 11px system-ui,sans-serif;letter-spacing:.24em;color:${C.beam}">OASIS WORSHIP TEAM</span>`,
    { style: "padding:24px 24px 4px" },
  ));
  const footer = tr(td(
    `<p style="margin:0 0 6px;font:12px system-ui,sans-serif;color:${C.steel}">Recibes esto porque sirves en el equipo de alabanza de Oasis.</p>` +
    `<a href="${link}" style="font:12px system-ui,sans-serif;color:${C.beam};text-decoration:none">Ajustar mis avisos →</a>`,
    { style: `padding:16px 24px 24px;border-top:1px solid ${C.deck}` },
  ));
  return (
    `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" bgcolor="${C.blackout}" style="background:${C.blackout};margin:0;padding:0">` +
    tr(td(
      `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" bgcolor="${C.console}" style="max-width:600px;background:${C.console};border-collapse:collapse">` +
      eyebrow + bodyRows + footer +
      `</table>`,
      { align: "center", style: "padding:24px 12px" },
    )) +
    `</table>`
  );
}

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

// Whether a member wants assignment emails. Opt-out: unset/null/true → yes,
// only an explicit false → no. Mirrors push.ts optedIn semantics.
export function wantsEmail(pref: unknown): boolean {
  return pref !== false;
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
      `<a href="${link}" style="display:inline-block;background:${C.beam};color:${C.blackout};text-decoration:none;padding:10px 18px;border-radius:6px;font:700 13px system-ui,sans-serif">Ver servicio →</a>`,
      { style: "padding:0 24px 20px" },
    ));
  const html = shell(body);
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
  const table = `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" bgcolor="${C.deck}" style="background:${C.deck};border-collapse:collapse">${tr(headCell("Fecha") + headCell("Tu rol"))}${rows}</table>`;
  const body =
    tr(td(
      `<p style="margin:0 0 4px;font:14px system-ui,sans-serif;color:${C.frost}">Hola ${name},</p>` +
      `<p style="margin:0;font:14px system-ui,sans-serif;color:${C.frost}">Tienes <strong style="color:${C.beam}">${n}</strong> nuevas asignaciones:</p>`,
      { style: "padding:0 24px 12px" },
    )) +
    tr(td(table, { style: "padding:0 24px 20px" })) +
    tr(td(
      `<a href="${link}" style="display:inline-block;background:${C.beam};color:${C.blackout};text-decoration:none;padding:10px 18px;border-radius:6px;font:700 13px system-ui,sans-serif">Ver mis servicios →</a>`,
      { style: "padding:0 24px 20px" },
    ));
  const html = shell(body);
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
