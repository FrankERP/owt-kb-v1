// app/utils/notificationEmail.ts
// Renders the debounced-outbox email (spec §6): one email per recipient
// covering everything that changed for them since the last flush. No
// generated prose — the header states what and when, the table carries the
// rest. Dark table-and-inline-style shell shared with the assignment emails.

import { escapeHtml, appBaseUrl } from "./assignmentEmail";
import { C, td, tr, shell } from "./emailShell";
import type { Line, LineKind } from "./outboxClassify";
import { buildSetlistTable, type TableRow } from "./setlistDiff";

export const SUBJECT: Record<LineKind, string> = {
  assigned: "Nueva asignación",
  removed: "Ya no participas",
  roleChanged: "Tu rol cambió",
  setlistReady: "Setlist listo",
  setlistChanged: "El setlist cambió",
  // "Mensajes de la propuesta", not "Notas del líder": the thread carries admin
  // replies now, and the body can be several messages joined rather than one
  // note. SUBJECT feeds BOTH the subject line and the in-body header via
  // `headerLine`, so this one constant is two visible strings.
  leadNotes: "Mensajes de la propuesta",
};

// Render at local noon per CLAUDE.md — a bare `new Date(iso)` flips the day in
// America/Mexico_City. Parts are picked individually (not the raw formatted
// string) so the result is stable regardless of locale literals ("de", ",").
function formatDate(iso: string): string {
  const d = new Date(`${iso.slice(0, 10)}T12:00:00`);
  const parts = new Intl.DateTimeFormat("es-MX", { weekday: "long", day: "numeric", month: "short" }).formatToParts(d);
  const part = (type: string) => parts.find((p) => p.type === type)?.value ?? "";
  const text = `${part("weekday")} ${part("day")} ${part("month").replace(/\.$/, "")}`;
  return text.charAt(0).toUpperCase() + text.slice(1);
}

function headerLine(kind: LineKind, serviceDate: string): string {
  return `${SUBJECT[kind]} — ${formatDate(serviceDate)}`;
}

function chip(text: string, bg: string, fg: string): string {
  return `<span style="display:inline-block;background:${bg};color:${fg};font:700 10px system-ui,sans-serif;text-transform:uppercase;letter-spacing:.04em;padding:2px 6px;border-radius:3px">${text}</span>`;
}

// ---- setlist standings table (spec §6: one table, never a per-song diff) ----

/** Groups consecutive rows sharing a `group` id. A run of one renders plain —
 * `buildRuns` can emit a one-song medley run from stored data, and the
 * renderer must guard that case itself (DayCard.tsx:156 does the same). */
function groupRuns(rows: TableRow[]): TableRow[][] {
  const runs: TableRow[][] = [];
  for (const row of rows) {
    const last = runs[runs.length - 1];
    if (row.group !== null && last && last[last.length - 1].group === row.group) last.push(row);
    else runs.push([row]);
  }
  return runs;
}

function headRow(showMovement: boolean): string {
  const label = (text: string, align: string) => td(
    `<span style="font:700 10px system-ui,sans-serif;text-transform:uppercase;letter-spacing:.08em;color:${C.muted}">${text}</span>`,
    { bg: C.surface, align, style: `padding:8px 8px;border-bottom:1px solid ${C.field}` },
  );
  return tr(
    label("#", "right") + label("Canción", "left") + label("Tono", "right") +
    (showMovement ? label("Mov.", "right") : ""),
  );
}

function songCell(title: string, gone: boolean): string {
  const text = escapeHtml(title);
  return gone ? `<s style="color:${C.muted}">${text}</s>` : `<span style="color:${C.ink}">${text}</span>`;
}

function keyCell(row: TableRow): string {
  const cur = `<span style="color:${C.ink}">${escapeHtml(row.key)}</span>`;
  if (!row.previousKey) return cur;
  return `<s style="color:${C.muted}">${escapeHtml(row.previousKey)}</s> ${cur}`;
}

function movementCell(row: TableRow): string {
  if (row.status === "new") return chip("NUEVA", C.positive, C.field);
  if (row.status === "gone") return chip("SALIÓ", C.retired, C.ink);
  if (!row.movement || row.movement.dir === "same") return `<span style="color:${C.muted}">&ndash;</span>`;
  if (row.movement.dir === "up") return `<span style="color:${C.positive}">▲${row.movement.n}</span>`;
  return `<span style="color:${C.warning}">▼${row.movement.n}</span>`;
}

function songRow(row: TableRow, titles: Map<string, string>, showMovement: boolean, spine: boolean): string {
  const title = titles.get(row.ref) ?? row.ref;
  const posText = row.position !== null ? String(row.position) : "&ndash;";
  const spineStyle = spine ? `border-left:2px solid ${C.accent};` : "";
  return tr(
    td(`<span style="color:${C.muted}">${posText}</span>`, { align: "right", style: `padding:6px 8px;${spineStyle}` }) +
    td(songCell(title, row.status === "gone"), { style: "padding:6px 8px;font:14px system-ui,sans-serif" }) +
    td(keyCell(row), { align: "right", style: "padding:6px 8px;font:13px monospace" }) +
    (showMovement ? td(movementCell(row), { align: "right", style: "padding:6px 8px;font:13px monospace" }) : ""),
  );
}

// Drawn the way DayCard.tsx already draws it: a `beam` spine down the left of
// the group, an uppercase "Medley" label above it, "+" between songs. A
// group of one (see groupRuns) never reaches here.
function medleyGroup(run: TableRow[], titles: Map<string, string>, showMovement: boolean): string {
  const cols = showMovement ? 4 : 3;
  const isNew = run.some((r) => r.groupIsNew);
  const label = tr(td(
    `<span style="text-transform:uppercase;letter-spacing:.12em;font:700 10px system-ui,sans-serif;color:${C.accent};border-left:2px solid ${C.accent};padding-left:8px">Medley</span>` +
    (isNew ? ` ${chip("NUEVO", C.positive, C.field)}` : ""),
    { colspan: cols, style: "padding:10px 8px 2px" },
  ));
  const plus = tr(td(
    `<span style="color:${C.accent};display:block;text-align:center">+</span>`,
    { colspan: cols, style: `padding:0 8px;border-left:2px solid ${C.accent}` },
  ));
  return label + run.map((row, i) => (i > 0 ? plus : "") + songRow(row, titles, showMovement, true)).join("");
}

export function renderSetlistTable(rows: TableRow[], titles: Map<string, string>, showMovement: boolean): string {
  const cols = showMovement ? 4 : 3;
  const body = groupRuns(rows)
    .map((run) => (run.length >= 2 ? medleyGroup(run, titles, showMovement) : songRow(run[0], titles, showMovement, false)))
    .join("");
  const legend = showMovement
    ? tr(td(`<span style="color:${C.muted};font:11px system-ui,sans-serif">▲ suena antes en el servicio</span>`, { colspan: cols, style: "padding:8px 8px 2px" }))
    : "";
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" bgcolor="${C.surface}" style="background:${C.surface};border-collapse:collapse">${headRow(showMovement)}${body}${legend}</table>`;
}

// ---- per-line sections ----
// Role phrasing is "Sirves como…", never "Cantas como…" — three of the five
// seat paths (instruments, FOH) do not sing.

function assignedSection(after: string[]): string {
  const roles = after.map(escapeHtml).join(", ");
  return tr(td(
    `<p style="margin:0;font:14px system-ui,sans-serif;color:${C.ink}">Sirves como <strong style="color:${C.accent}">${roles}</strong></p>`,
    { style: "padding:0 24px 18px" },
  ));
}

function removedSection(before: string[]): string {
  const roles = before.map(escapeHtml).join(", ");
  return tr(td(
    `<p style="margin:0;font:14px system-ui,sans-serif;color:${C.ink}">Ya no sirves como <s style="color:${C.muted}">${roles}</s></p>`,
    { style: "padding:0 24px 18px" },
  ));
}

function roleChangedSection(before: string[], after: string[]): string {
  const b = before.map(escapeHtml).join(", ") || "—";
  const a = after.map(escapeHtml).join(", ") || "—";
  const heading = (text: string) => td(
    `<span style="font:700 10px system-ui,sans-serif;text-transform:uppercase;letter-spacing:.08em;color:${C.muted}">${text}</span>`,
    { bg: C.surface, style: "padding:10px 16px 4px" },
  );
  const value = (html: string) => td(html, { bg: C.surface, style: "padding:0 16px 12px;font:14px system-ui,sans-serif" });
  const panel = `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" bgcolor="${C.surface}" style="background:${C.surface};border-collapse:collapse">` +
    tr(heading("Antes") + heading("Ahora")) +
    tr(value(`<s style="color:${C.muted}">${b}</s>`) + value(`<strong style="color:${C.accent}">${a}</strong>`)) +
    `</table>`;
  return tr(td(panel, { style: "padding:0 24px 18px" }));
}

function leadNotesSection(notes: string): string {
  return tr(td(
    `<p style="margin:0;white-space:pre-wrap;font:14px system-ui,sans-serif;color:${C.ink}">${escapeHtml(notes)}</p>`,
    { style: "padding:0 24px 18px" },
  ));
}

function setlistSection(line: Line, titles: Map<string, string>): string {
  const showMovement = line.kind === "setlistChanged";
  const table = buildSetlistTable(line.beforeSongs ?? [], line.songs ?? []);
  return tr(td(renderSetlistTable(table, titles, showMovement), { style: "padding:0 24px 18px" }));
}

function renderLine(line: Line, titles: Map<string, string>): string {
  const header = tr(td(
    `<span style="font:700 15px system-ui,sans-serif;color:${C.ink}">${escapeHtml(headerLine(line.kind, line.serviceDate))}</span>`,
    { style: "padding:18px 24px 8px" },
  ));
  switch (line.kind) {
    case "assigned": return header + assignedSection(line.after);
    case "removed": return header + removedSection(line.before);
    case "roleChanged": return header + roleChangedSection(line.before, line.after);
    case "leadNotes": return header + leadNotesSection(line.notes ?? "");
    case "setlistReady":
    case "setlistChanged": return header + setlistSection(line, titles);
  }
}

// ---- public entry point ----

export function buildGroupedEmail(
  o: { name: string; lines: Line[] },
  titles: Map<string, string>,
): { subject: string; html: string } {
  const subject = o.lines.length === 1
    ? headerLine(o.lines[0].kind, o.lines[0].serviceDate)
    : "Novedades de tus servicios";
  const greeting = tr(td(
    `<p style="margin:0;font:14px system-ui,sans-serif;color:${C.ink}">Hola ${escapeHtml(o.name || "equipo")},</p>`,
    { style: "padding:0 24px 8px" },
  ));
  const bodyRows = greeting + o.lines.map((l) => renderLine(l, titles)).join("");
  const link = `${appBaseUrl()}/me`;
  return { subject, html: shell(bodyRows, link) };
}
