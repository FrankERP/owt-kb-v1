// The admin email of the availability proposals (ADR-0080; plan §6): one per sweep that claimed
// events, «Propuestas» (person → replacement, seat, service) and «Sin reemplazo». Light palette
// (`emailShell.ts`), as every app email. Pure: the writer (`availabilityFixCommit.ts`) reads the
// names and sends it.

import { appBaseUrl, escapeHtml } from "./assignmentEmail";
import { C, shell, td, tr } from "./emailShell";

export interface ConflictEmailLine {
  person: string;
  service: string;
  published: boolean;
  /** One per seat: «Coro», «Bass»… with the proposed replacement, when there is one. */
  seats: Array<{ seat: string; to?: string }>;
  reason?: "no_candidate" | "song_lead" | "unchecked";
}

const REASON: Record<NonNullable<ConflictEmailLine["reason"]>, string> = {
  no_candidate: "nadie disponible pasa las reglas",
  song_lead: "dirige canciones en la noche de alabanza: revísalo a mano",
  unchecked: "no se pudo revisar (falta el registro del mes o el servicio no se puede editar)",
};

const state = (l: ConflictEmailLine) => (l.published ? "publicado" : "borrador");

function proposalItem(l: ConflictEmailLine): string {
  const seats = l.seats.map((s) => `${escapeHtml(s.seat)} → <strong style="color:${C.accent}">${escapeHtml(s.to ?? "")}</strong>`).join(", ");
  return `<li style="margin:0 0 8px"><strong>${escapeHtml(l.person)}</strong> no puede el ${escapeHtml(l.service)} (${state(l)}). Propuesta: ${seats}.</li>`;
}

function noneItem(l: ConflictEmailLine): string {
  const seats = l.seats.map((s) => escapeHtml(s.seat)).join(", ");
  const why = REASON[l.reason ?? "no_candidate"];
  return `<li style="margin:0 0 8px"><strong>${escapeHtml(l.person)}</strong> no puede el ${escapeHtml(l.service)} (${state(l)})${seats ? ` — ${seats}` : ""}: ${escapeHtml(why)}.</li>`;
}

function section(title: string, items: string[]): string {
  if (!items.length) return "";
  return tr(td(
    `<span style="display:block;font:700 10px system-ui,sans-serif;text-transform:uppercase;letter-spacing:.08em;color:${C.muted};padding-bottom:6px">${title}</span>` +
    `<ul style="margin:0;padding-left:18px;font:14px system-ui,sans-serif;color:${C.ink}">${items.join("")}</ul>`,
    { style: "padding:0 24px 18px" },
  ));
}

export function buildConflictEmail(lines: readonly ConflictEmailLine[]): { subject: string; html: string } {
  const link = `${appBaseUrl()}/admin?tab=availability`;
  const proposals = lines.filter((l) => l.seats.length > 0 && l.seats.every((s) => s.to) && !l.reason);
  const none = lines.filter((l) => !proposals.includes(l));
  const subject = `Conflictos de disponibilidad (${lines.length})`;
  const header = tr(td(
    `<span style="font:700 15px system-ui,sans-serif;color:${C.ink}">Conflictos de disponibilidad</span>`,
    { style: "padding:18px 24px 8px" },
  ));
  const intro = tr(td(
    `<p style="margin:0;font:14px system-ui,sans-serif;color:${C.ink}">Alguien marcó que no puede un día en que ya sirve. No cambié ningún servicio: revisa y aplica en la app.</p>`,
    { style: "padding:0 24px 18px" },
  ));
  const button = tr(td(
    `<a href="${link}" style="display:inline-block;background:${C.accent};color:${C.field};text-decoration:none;padding:10px 18px;border-radius:6px;font:700 13px system-ui,sans-serif">Revisar en la app →</a>`,
    { style: "padding:0 24px 20px" },
  ));
  const body = header + intro + section("Propuestas", proposals.map(proposalItem)) + section("Sin reemplazo", none.map(noneItem)) + button;
  return { subject, html: shell(body, `${appBaseUrl()}/me`) };
}
