// The emails a Jóvenes meeting sends (ADR-0089; plan
// `docs/superpowers/plans/2026-11-17-jovenes-meeting-parts.md` U5): «Te toca» to a person a write
// assigns, the music request (or its withdrawal) to whoever arranges the worship team, and the
// reminder two weeks and one week ahead to whoever still owes something (the ADR's addendum).
//
// Builders with no I/O of their own: names arrive resolved, everything is escaped here, and the palette is the shared
// LIGHT email shell (never `brand.css` — CLAUDE.md, «Email templates are LIGHT on purpose»).
// Who receives each one is decided in `ministryEventNotify.ts` (a write's emails) and in
// `ministryEventReminder.ts` (the reminders), never here.

import { escapeHtml as esc } from "./assignmentEmail";
import { C, shell, td, tr } from "./emailShell";
import { dayWords } from "./jovenesEventView";
import { joinNames, meetingPath, type PartGap } from "./jovenesPartView";
import { MUSIC_WORDS, PART_ASK, PLATICA_SEAT, partSpec, type PartId } from "./ministryParts";
import type { AssignedRole, MusicPart, NoticeMeeting } from "./ministryEventNotices";

/** The meeting's display fields, as the writer hands them over with a notice. */
export type EmailMeeting = NoticeMeeting;

const SHELL = {
  eyebrow: "JÓVENES · OASIS",
  reason: "Recibes esto porque sirves en Jóvenes de Oasis.",
} as const;

// Re-exported so the sender builds the link, and joins names, from the same place the screens do.
export { joinNames, meetingPath };

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

/** What a part still lacks, as the reminder says it. Oración's note is optional: it has no line. */
const GAP_WORDS: Record<PartId, Partial<Record<PartGap, string>>> = {
  oracion: { music: "Di si quieres música de un track o que toque alguien de alabanza." },
  dinamica1: { note: "Escribe una breve descripción de la dinámica (máximo 300 caracteres) y, si te apoyará algún joven del grupo, su nombre." },
  dinamica2: { note: "Escribe una breve descripción de la dinámica (máximo 300 caracteres) y, si te apoyará algún joven del grupo, su nombre." },
  platica: {
    note: "Escribe tu tema.",
    music: "Di si al final quieres música de un track o una canción con el grupo de alabanza.",
  },
};

const AHEAD: Record<14 | 7, string> = { 14: "Faltan dos semanas", 7: "Falta una semana" };

/**
 * The reminder, two weeks and one week before a meeting: one email per person per meeting.
 * `fill`: the parts of theirs that still lack something, and what. `assign`: the parts with nobody
 * yet, said only to who coordinates the meeting. At least one of the two is non-empty (the
 * planner sends nothing otherwise). `link` is the meeting's page (absolute).
 */
export function buildPartReminderEmail(o: {
  name: string;
  meeting: EmailMeeting;
  days: 14 | 7;
  fill: Array<{ part: PartId; gaps: readonly PartGap[]; partnerNames: string[] }>;
  assign: readonly PartId[];
  link: string;
  settingsLink: string;
}): { subject: string; html: string } {
  const when = dayWords(o.meeting.date);
  const labelOf = (id: PartId) => partSpec(id)?.label ?? id;
  const fillLabels = joinNames(o.fill.map((f) => labelOf(f.part)));
  const assignLabels = joinNames(o.assign.map(labelOf));
  // Constants plus a date, like every subject here (`docs/NOTIFICATIONS.md`).
  const subject = o.fill.length
    ? `Recordatorio: falta llenar ${fillLabels} — ${when}`
    : `Recordatorio: falta asignar ${assignLabels} — ${when}`;
  const first = (o.name || "").trim().split(/\s+/)[0] ?? "";
  const greeting = first ? `Hola, ${esc(first)}.` : "Hola.";
  const line = meetingLine(o.meeting);

  const header = tr(td(
    `<span style="font:700 15px system-ui,sans-serif;color:${C.ink}">${AHEAD[o.days]} para la reunión</span>`,
    { style: "padding:18px 24px 8px" },
  ));
  const owes = o.fill.length
    ? ` Todavía falta llenar <strong style="color:${C.accent}">${esc(fillLabels)}</strong>.`
    : "";
  const intro = tr(td(
    `<p style="${P};margin:0 0 6px">${greeting} ${AHEAD[o.days]} para la reunión del <strong style="color:${C.ink}">${esc(when)}</strong>.${owes}</p>` +
    (line ? `<p style="margin:0;font:13px system-ui,sans-serif;color:${C.muted}">${esc(line)}</p>` : ""),
    { style: "padding:0 24px 14px" },
  ));
  const fill = o.fill
    .map((f) => {
      const partners = f.partnerNames.length ? ` <span style="color:${C.muted}">(junto con ${esc(joinNames(f.partnerNames))})</span>` : "";
      const asks = f.gaps.map((g) => GAP_WORDS[f.part][g]).filter((w): w is string => !!w);
      return tr(td(
        `<p style="margin:0 0 4px;font:700 12px system-ui,sans-serif;letter-spacing:.08em;color:${C.muted}">${esc(labelOf(f.part).toUpperCase())}${partners}</p>` +
        asks.map((w) => `<p style="${P}">${esc(w)}</p>`).join(""),
        { bg: C.surface, style: `padding:12px 24px;border-top:1px solid ${C.panel}` },
      ));
    })
    .join("");
  const assign = o.assign.length
    ? tr(td(
      `<p style="margin:0 0 4px;font:700 12px system-ui,sans-serif;letter-spacing:.08em;color:${C.muted}">SIN RESPONSABLE</p>` +
      `<p style="${P}"><strong style="color:${C.ink}">${esc(assignLabels)}</strong> todavía no ${o.assign.length === 1 ? "tiene" : "tienen"} a nadie. Coordinas la reunión: asigna a alguien en el programa.</p>`,
      { bg: C.surface, style: `padding:12px 24px;border-top:1px solid ${C.panel}` },
    ))
    : "";
  return {
    subject,
    html: shell(header + intro + fill + assign + cta(o.link, o.fill.length ? "Llenar mi parte →" : "Ver la reunión →"), o.settingsLink, SHELL),
  };
}
