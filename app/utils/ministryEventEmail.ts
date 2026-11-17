// The two emails a Jóvenes meeting sends (ADR-0089; plan
// `docs/superpowers/plans/2026-11-17-jovenes-meeting-parts.md` U5): «Te toca» to a person a write
// assigns, and the music request (or its withdrawal) to whoever arranges the worship team.
//
// Builders with no I/O of their own: names arrive resolved, everything is escaped here, and the palette is the shared
// LIGHT email shell (never `brand.css` — CLAUDE.md, «Email templates are LIGHT on purpose»).
// Who receives each one is decided in `ministryEventNotify.ts`, never here.

import { escapeHtml as esc } from "./assignmentEmail";
import { C, shell, td, tr } from "./emailShell";
import { dayWords } from "./jovenesEventView";
import { meetingPath } from "./jovenesPartView";
import { MUSIC_WORDS, PART_ASK, PLATICA_SEAT, partSpec, type PartId } from "./ministryParts";
import type { AssignedRole, MusicPart, NoticeMeeting } from "./ministryEventNotices";

/** The meeting's display fields, as the writer hands them over with a notice. */
export type EmailMeeting = NoticeMeeting;

const SHELL = {
  eyebrow: "JÓVENES · OASIS",
  reason: "Recibes esto porque sirves en Jóvenes de Oasis.",
} as const;

// Re-exported so the sender builds the link from the same place the screens do.
export { meetingPath };

/** «Pau» · «Pau y Mkz» · «Pau, Mkz y Lali». */
export function joinNames(names: readonly string[]): string {
  if (names.length <= 1) return names[0] ?? "";
  return `${names.slice(0, -1).join(", ")} y ${names[names.length - 1]}`;
}

/** «18:10 · llegada 17:30 · Oasis Tlalpan», or "" when the meeting has none of them. */
function meetingLine(m: EmailMeeting): string {
  return [m.title, m.time, m.arrival ? `llegada ${m.arrival}` : null, m.place].filter(Boolean).join(" · ");
}

const SEAT_WORDS: Record<string, { label: string; ask: string | null }> = {
  encargado: {
    label: "Encargado",
    ask: "Coordinas la reunión: revisa el programa y asigna quién tiene la oración y las dinámicas.",
  },
  apoyo: { label: "Apoyo", ask: "Apoyas a quien coordina la reunión; también puedes editar el programa." },
  [PLATICA_SEAT]: { label: "Plática", ask: PART_ASK.platica },
};

/** A role as the email names it, and what its holder is asked to do (or `null`: nothing to fill). */
export function roleWords(role: Pick<AssignedRole, "kind" | "id" | "label">): { label: string; ask: string | null; fills: boolean } {
  if (role.kind === "seat") {
    const known = Object.hasOwn(SEAT_WORDS, role.id) ? SEAT_WORDS[role.id] : null;
    return { label: known?.label ?? role.label, ask: known?.ask ?? null, fills: role.id === PLATICA_SEAT };
  }
  if (role.kind === "part") {
    const spec = partSpec(role.id);
    return { label: spec?.label ?? role.label, ask: spec ? PART_ASK[spec.id as PartId] : null, fills: !!spec };
  }
  return { label: role.label || "Programa", ask: null, fills: false };
}

const P = `margin:0;font:14px system-ui,sans-serif;color:${C.ink}`;

function cta(link: string, words: string): string {
  return tr(td(
    `<a href="${link}" style="display:inline-block;background:${C.accent};color:${C.field};text-decoration:none;padding:10px 18px;border-radius:6px;font:700 13px system-ui,sans-serif">${esc(words)}</a>`,
    { style: "padding:18px 24px 20px" },
  ));
}

/**
 * «Te toca»: one email per person per write, listing every role that write gave them. `link` is
 * the meeting's page (absolute). `moved`: the meeting was already announced on another date.
 */
export function buildAssignedEmail(o: {
  name: string;
  meeting: EmailMeeting;
  roles: Array<Pick<AssignedRole, "kind" | "id" | "label"> & { partnerNames: string[] }>;
  moved: boolean;
  link: string;
  settingsLink: string;
}): { subject: string; html: string } {
  const when = dayWords(o.meeting.date);
  const words = o.roles.map((r) => ({ ...roleWords(r), partnerNames: r.partnerNames }));
  const labels = joinNames(words.map((w) => w.label));
  // A subject is constants plus a date (`docs/NOTIFICATIONS.md`): a free line's label is text
  // somebody typed, so the subject says «Programa» for it and the body names it.
  const fixed = o.roles.map((r, i) => (r.kind === "line" ? "Programa" : words[i].label));
  const subjectLabels = joinNames([...new Set(fixed)]);
  const subject = o.moved ? `Cambió de fecha: ${subjectLabels} — ${when}` : `Te toca: ${subjectLabels} — ${when}`;
  const first = (o.name || "").trim().split(/\s+/)[0] ?? "";
  const greeting = first ? `Hola, ${esc(first)}.` : "Hola.";
  const line = meetingLine(o.meeting);

  const header = tr(td(
    `<span style="font:700 15px system-ui,sans-serif;color:${C.ink}">${o.moved ? "La reunión cambió de fecha" : "Te toca en Jóvenes"}</span>`,
    { style: "padding:18px 24px 8px" },
  ));
  const intro = tr(td(
    `<p style="${P};margin:0 0 6px">${greeting} Te toca <strong style="color:${C.accent}">${esc(labels)}</strong> el <strong style="color:${C.ink}">${esc(when)}</strong>.</p>` +
    (line ? `<p style="margin:0;font:13px system-ui,sans-serif;color:${C.muted}">${esc(line)}</p>` : ""),
    { style: "padding:0 24px 14px" },
  ));
  const asks = words
    .filter((w) => w.ask || w.partnerNames.length > 0)
    .map((w) => {
      const partners = w.partnerNames.length ? ` <span style="color:${C.muted}">(junto con ${esc(joinNames(w.partnerNames))})</span>` : "";
      return tr(td(
        `<p style="margin:0 0 4px;font:700 12px system-ui,sans-serif;letter-spacing:.08em;color:${C.muted}">${esc(w.label.toUpperCase())}${partners}</p>` +
        (w.ask ? `<p style="${P}">${esc(w.ask)}</p>` : ""),
        { bg: C.surface, style: `padding:12px 24px;border-top:1px solid ${C.panel}` },
      ));
    })
    .join("");
  const fills = words.some((w) => w.fills);
  return {
    subject,
    html: shell(header + intro + asks + cta(o.link, fills ? "Llenar mi parte →" : "Ver la reunión →"), o.settingsLink, SHELL),
  };
}

const MUSIC_SENTENCE: Record<MusicPart, { asks: string; withdrawn: string }> = {
  oracion: {
    asks: "pide que alguien de alabanza toque durante la",
    withdrawn: "ya no pide a alguien de alabanza.",
  },
  platica: {
    asks: "pide una canción con el grupo de alabanza al final de la",
    withdrawn: "ya no pide una canción con el grupo de alabanza.",
  },
};

/**
 * The music request, or its withdrawal, to whoever arranges the worship team (Frank: «Eso se me
 * notifica a mí y yo me encargo de eso»). `who`: the part's responsables by name (may be empty).
 */
export function buildMusicEmail(o: {
  meeting: EmailMeeting;
  part: MusicPart;
  asks: boolean;
  note: string | null;
  who: string[];
  link: string;
  settingsLink: string;
}): { subject: string; html: string } {
  const when = dayWords(o.meeting.date);
  const label = partSpec(o.part)?.label ?? o.part;
  const clock = o.meeting.time ? ` (${o.meeting.time})` : "";
  const who = o.who.length ? joinNames(o.who) : "Quien tiene esta parte";
  const subject = `${o.asks ? "Piden música de alabanza" : "Ya no piden música de alabanza"} — ${label}, ${when}`;
  const s = MUSIC_SENTENCE[o.part];

  const header = tr(td(
    `<span style="font:700 15px system-ui,sans-serif;color:${C.ink}">${o.asks ? "Piden música de alabanza" : "Ya no hace falta música de alabanza"}</span>`,
    { style: "padding:18px 24px 8px" },
  ));
  const sentence = o.asks
    ? `<strong style="color:${C.accent}">${esc(who)}</strong> ${s.asks} <strong style="color:${C.ink}">${esc(label)}</strong> del <strong style="color:${C.ink}">${esc(when)}</strong>${esc(clock)}.`
    : `La <strong style="color:${C.ink}">${esc(label)}</strong> del <strong style="color:${C.ink}">${esc(when)}</strong>${esc(clock)} ${s.withdrawn}`;
  const intro = tr(td(
    `<p style="${P};margin:0 0 6px">${sentence}</p>` +
    (o.asks ? `<p style="margin:0;font:13px system-ui,sans-serif;color:${C.muted}">Eligió «${esc(MUSIC_WORDS[o.part].alabanza.option)}». No dice quién: eso lo decides tú.</p>` : ""),
    { style: "padding:0 24px 14px" },
  ));
  const note = o.asks && o.note?.trim()
    ? tr(td(
      `<p style="margin:0 0 6px;font:700 12px system-ui,sans-serif;letter-spacing:.08em;color:${C.muted}">SU NOTA</p>` +
      `<p style="${P};white-space:pre-wrap">${esc(o.note.trim())}</p>`,
      { bg: C.surface, style: "padding:14px 24px" },
    ))
    : "";
  return { subject, html: shell(header + intro + note + cta(o.link, "Ver la reunión →"), o.settingsLink, SHELL) };
}
