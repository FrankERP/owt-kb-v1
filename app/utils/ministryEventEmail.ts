// The emails a Jóvenes meeting sends (ADR-0089; plan
// `docs/superpowers/plans/2026-11-17-jovenes-meeting-parts.md` U5): «Te toca» to a person a write
// assigns, the music request (or its withdrawal) to whoever arranges the worship team, and the
// reminder two weeks and one week ahead to whoever still owes something (the ADR's addendum); and
// for a group's classes, the change of someone's classes and the reminder before one (the
// addendum of 2026-11-25).
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
import type { ClassChange, ClassLine } from "./ministryLessonNotices";
import { MINISTRIES } from "@/app/ministries";

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

// ── A group's classes (ADR-0089, addendum of 2026-11-25) ────────────────────

/** A group's name as the emails say it: the registry's constant, never typed text. */
export function groupWords(group: string): string {
  return MINISTRIES.jovenes.groups.find((g) => g.id === group)?.name ?? "tu grupo";
}

/** «domingo 29 de noviembre · 11:40 · Oasis Tepepan». */
function classWhen(c: ClassLine): string {
  return [dayWords(c.date), c.time, c.place].filter(Boolean).join(" · ");
}

const CHANGE_TAG: Record<ClassChange["kind"], string> = { added: "TE TOCA", changed: "CAMBIÓ", removed: "YA NO TE TOCA" };

function changeRow(c: ClassChange): string {
  const line = c.kind === "removed" ? c.was : c.now;
  const head =
    `<p style="margin:0 0 4px;font:700 12px system-ui,sans-serif;letter-spacing:.08em;color:${c.kind === "removed" ? C.muted : C.accent}">${CHANGE_TAG[c.kind]}</p>` +
    `<p style="${P}"><strong style="color:${C.ink}">${esc(line.label)}</strong> <span style="color:${C.muted}">· ${esc(line.series)}</span></p>`;
  let detail = `<p style="${P}${c.kind === "removed" ? `;color:${C.muted};text-decoration:line-through` : ""}">${esc(classWhen(line))}</p>`;
  if (c.kind === "changed") {
    const before: string[] = [];
    if (c.was.label !== c.now.label) before.push(c.was.label);
    if (c.was.date !== c.now.date || c.was.time !== c.now.time || c.was.place !== c.now.place) before.push(classWhen(c.was));
    if (before.length) detail += `<p style="margin:4px 0 0;font:13px system-ui,sans-serif;color:${C.muted}">Antes: ${esc(before.join(" · "))}</p>`;
  }
  return tr(td(head + detail, { bg: C.surface, style: `padding:12px 24px;border-top:1px solid ${C.panel}` }));
}

/**
 * A change to someone's classes: one email per person per write, listing every class of theirs
 * the write gave them, moved or took away. `link`: the page of their first class still on, else
 * the calendar (absolute). The subject is constants plus a date or a group name
 * (`docs/NOTIFICATIONS.md`): a class's title is typed text, so only the body names it.
 */
export function buildClassChangeEmail(o: {
  name: string;
  group: string;
  changes: readonly ClassChange[];
  link: string;
  settingsLink: string;
}): { subject: string; html: string } {
  const group = groupWords(o.group);
  const only = o.changes.length === 1 ? o.changes[0] : null;
  const subject =
    only?.kind === "added"
      ? `Te toca dar la clase — ${dayWords(only.now.date)}`
      : only?.kind === "removed"
        ? `Ya no te toca dar la clase — ${dayWords(only.was.date)}`
        : `Cambió tu rol de clases — ${group}`;
  const first = (o.name || "").trim().split(/\s+/)[0] ?? "";
  const greeting = first ? `Hola, ${esc(first)}.` : "Hola.";
  const header = tr(td(
    `<span style="font:700 15px system-ui,sans-serif;color:${C.ink}">${only?.kind === "added" ? "Te toca dar la clase" : "Cambió tu rol de clases"}</span>`,
    { style: "padding:18px 24px 8px" },
  ));
  const intro = tr(td(
    `<p style="${P}">${greeting} ${only?.kind === "added" ? "Te asignaron una clase" : "Hubo cambios en tus clases"} de <strong style="color:${C.ink}">${esc(group)}</strong>:</p>`,
    { style: "padding:0 24px 14px" },
  ));
  const on = o.changes.some((c) => c.kind !== "removed");
  return {
    subject,
    html: shell(header + intro + o.changes.map(changeRow).join("") + cta(o.link, on ? "Ver mi clase →" : "Ver el calendario →"), o.settingsLink, SHELL),
  };
}

const CLASS_AHEAD: Record<7 | 2, string> = { 7: "Falta una semana para tu clase", 2: "Faltan dos días para tu clase" };

/**
 * The reminder before a class, to whoever gives it: a week and two days ahead (the addendum).
 * `notes`: the class's own notes («Cierre libro»), typed by whoever planned it, shown as text.
 */
export function buildClassReminderEmail(o: {
  name: string;
  line: ClassLine;
  notes: string | null;
  days: 7 | 2;
  partnerNames: string[];
  link: string;
  settingsLink: string;
}): { subject: string; html: string } {
  const when = dayWords(o.line.date);
  const subject = `${CLASS_AHEAD[o.days]} — ${when}`;
  const first = (o.name || "").trim().split(/\s+/)[0] ?? "";
  const greeting = first ? `Hola, ${esc(first)}.` : "Hola.";
  const header = tr(td(`<span style="font:700 15px system-ui,sans-serif;color:${C.ink}">${CLASS_AHEAD[o.days]}</span>`, { style: "padding:18px 24px 8px" }));
  const partners = o.partnerNames.length ? ` junto con ${esc(joinNames(o.partnerNames))}` : "";
  const intro = tr(td(
    `<p style="${P};margin:0 0 6px">${greeting} Te toca dar <strong style="color:${C.accent}">${esc(o.line.label)}</strong> de «${esc(o.line.series)}» en <strong style="color:${C.ink}">${esc(groupWords(o.line.group))}</strong>${partners}.</p>` +
    `<p style="margin:0;font:13px system-ui,sans-serif;color:${C.muted}">${esc(classWhen(o.line))}</p>`,
    { style: "padding:0 24px 14px" },
  ));
  const notes = o.notes?.trim()
    ? tr(td(
      `<p style="margin:0 0 6px;font:700 12px system-ui,sans-serif;letter-spacing:.08em;color:${C.muted}">NOTAS</p>` +
      `<p style="${P};white-space:pre-wrap">${esc(o.notes.trim())}</p>`,
      { bg: C.surface, style: "padding:14px 24px" },
    ))
    : "";
  return { subject, html: shell(header + intro + notes + cta(o.link, "Ver mi clase →"), o.settingsLink, SHELL) };
}
