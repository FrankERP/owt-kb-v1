// scripts/lib/reconstructReport.ts
//
// The reconstruction's words (solver v3 C4): the private Spanish table (R11), the
// private refusal report (R13), the apply and rollback reports, and the ONLY lines
// stdout and stderr carry — which hold no member name or alias, no member `_id`, no
// rule key and no hash of one (R12). Every fairness figure is formatted through C2's
// one formatter from the ledger's tenths (IF2-13, A17); seat counts are the ledger's
// integers (A39). Pure: no I/O.

import { saldoWords } from "../../app/utils/fairnessFormat";
import {
  ROLE_KEYS,
  compareCodepoint,
  type FairnessMonthBody,
  type LogicalRecord,
  type RoleKey,
  type Status,
  type TabKey,
} from "../../app/utils/fairnessVocabulary";
import type { RunMode } from "./reconstructArgs";
import type { RollbackPlanContent } from "./reconstructPlanFile";
import { LINES, type Anomaly, type CellReason, type Line, type MonthAction, type RollbackAction, type RunRefusal } from "./reconstructTypes";

export const MODE_LABEL: Record<RunMode, string> = {
  "dry-run": "DRY-RUN",
  apply: "APPLY",
  rollback: "ROLLBACK",
  "rollback-apply": "ROLLBACK-APPLY",
};

/** The spec's «Decision per month» labels (plus R1's skip). */
export const ACTION_LABEL: Record<MonthAction, string> = {
  create: "crear",
  replace: "reemplazar",
  unchanged: "sin cambios",
  skip: "sin servicios guardados: no se reconstruye",
  not_reconstruction_owned: "no lo escribió la reconstrucción: no se toca",
  record_edited: "editado después de reconstruir: no se toca",
};

export const ROLLBACK_LABEL: Record<RollbackAction, string> = {
  delete: "borrar",
  none: "sin registro: nada que borrar",
  not_reconstruction_owned: "no lo escribió la reconstrucción: no se toca",
  record_edited: "editado después de reconstruir: no se toca",
};

export const REASON_LABEL: Record<CellReason, string> = {
  tipo: "Tipo de hoy",
  sin_tipo: "su Tipo no cubre el rol",
  regla: "regla de hoy",
  fija: "regla fija de hoy",
  linea: "antes de su primer servicio en esta línea",
  partida: "regla fija partida por el inicio de línea",
  correccion: "corrección",
};

export const SERVICE_TYPE_LABEL: Record<"sunday_role" | "saturday_role" | "special_role", string> = {
  sunday_role: "domingo",
  saturday_role: "sábado",
  special_role: "especial",
};

const LINE_LABEL: Record<Line, string> = { DL: "DL", SL: "SL", BGV: "BGV", CORO: "Coro" };
const ROLE_HEAD: Record<RoleKey, string> = {
  "Sun.Lead": "Dom. Líder",
  "Sat.Lead": "Sáb. Líder",
  "Sun.BGV": "Dom. BGV",
  "Sat.BGV": "Sáb. BGV",
  "Sun.Choir": "Dom. Coro",
  "Sat.Choir": "Sáb. Coro",
};
const SOURCE_LABEL: Record<"planned" | "stored" | "none", string> = {
  planned: "el plan",
  stored: "el registro guardado",
  none: "sin registro (no cuenta)",
};
const PREVIEW_TABS: readonly TabKey[] = ["DL", "SL", "BGV", "CORO", "TOTAL"];

export function statusLabel(status: Status, count: number | null): string {
  return status === "in" ? "elegible" : status === "out" ? "fuera" : `fija ${count ?? "?"}`;
}

export interface TableCell {
  status: Status;
  count: number | null;
  reason: CellReason;
  corrected: boolean;
}

export interface TableRow {
  memberId: string;
  name: string;
  cells: Record<RoleKey, TableCell>;
  joins: Partial<Record<Line, string>>;
  seats: Partial<Record<Line, number>>;
  blocked: string[];
  exempt: boolean;
  exemptCorrected: boolean;
  cadence: boolean;
  cadenceCorrected: boolean;
  blocksCorrected: boolean;
  added: boolean;
}

export interface TableMonth {
  month: string;
  action: MonthAction;
  services: Array<{ date: string; type: string; counted: boolean }>;
  rows: TableRow[];
  presence: Array<{ ordinal: string; ruleKey: string; roles: RoleKey[]; members: string[]; exclusive: boolean }>;
  /** Only on a month planned «reemplazar»: what the replace changes against the stored record, person by person. */
  changes?: ReplaceChange[];
}

/**
 * One line of a «reemplazar» month's per-person diff against the stored record (spec
 * «Decision per month»: «the table shows the per-person diff»; R21: a replace after an
 * edit shows what the edit changed). Private table only: `id` is a member `_id` or a
 * presence `ruleKey`, `name` a display name.
 */
export interface ReplaceChange {
  kind: "person" | "presence";
  id: string;
  name: string;
  change: "added" | "removed" | "changed";
  details: string[];
}

type BodyPerson = FairnessMonthBody["people"][number];
const countFor = (p: BodyPerson, k: RoleKey) => p.exactRules.find((r) => r.roles.includes(k))?.count ?? null;
const blockLabel = (b: BodyPerson["blocks"][number]) => (b.unavailable ? b.date : `${b.date} (${b.excludedRoles.join(", ")})`);
const rulesLabel = (p: BodyPerson) => p.exactRules.map((r) => `${r.roles.join("+")} = ${r.count}`).join("; ") || "ninguna";
const cadenceLabel = (p: BodyPerson) => (p.sundayCadence === "alternate" ? "sí" : "no");

/**
 * The diff a «reemplazar» row shows: every person the replace adds, removes or changes
 * (status words as the table words them, exact-rule grouping, «Exenta», «Mes por medio»,
 * blocked dates), by display name with Spanish collation, then every presence rule it
 * adds, removes or changes, by key. Pure; computes no seat and no figure.
 */
export function replaceChanges(
  existing: Pick<LogicalRecord, "people" | "presence">,
  planned: Pick<FairnessMonthBody, "people" | "presence">,
  nameOf: (id: string) => string,
): ReplaceChange[] {
  const before = new Map(existing.people.map((p) => [p.memberId, p] as const));
  const after = new Map(planned.people.map((p) => [p.memberId, p] as const));
  const people: ReplaceChange[] = [];
  for (const id of new Set([...before.keys(), ...after.keys()])) {
    const old = before.get(id);
    const now = after.get(id);
    const name = nameOf(id) || old?.name || "";
    if (!old || !now) {
      people.push({ kind: "person", id, name, change: old ? "removed" : "added", details: [] });
      continue;
    }
    const details: string[] = [];
    for (const k of ROLE_KEYS) {
      const was = statusLabel(old.roles[k], countFor(old, k));
      const is = statusLabel(now.roles[k], countFor(now, k));
      if (was !== is) details.push(`${ROLE_HEAD[k]}: ${was} → ${is}`);
    }
    if (details.length === 0 && rulesLabel(old) !== rulesLabel(now)) details.push(`reglas fijas: ${rulesLabel(old)} → ${rulesLabel(now)}`);
    if (old.exempt !== now.exempt) details.push(`Exenta: ${old.exempt ? "sí" : "no"} → ${now.exempt ? "sí" : "no"}`);
    if (cadenceLabel(old) !== cadenceLabel(now)) details.push(`Mes por medio: ${cadenceLabel(old)} → ${cadenceLabel(now)}`);
    const oldBlocks = new Map(old.blocks.map((b) => [b.date, blockLabel(b)] as const));
    const newBlocks = new Map(now.blocks.map((b) => [b.date, blockLabel(b)] as const));
    for (const date of [...new Set([...oldBlocks.keys(), ...newBlocks.keys()])].sort(compareCodepoint)) {
      const was = oldBlocks.get(date);
      const is = newBlocks.get(date);
      if (was === undefined) details.push(`fecha bloqueada nueva: ${is}`);
      else if (is === undefined) details.push(`fecha bloqueada quitada: ${was}`);
      else if (was !== is) details.push(`fecha bloqueada cambiada: ${was} → ${is}`);
    }
    if (details.length > 0) people.push({ kind: "person", id, name, change: "changed", details });
  }
  people.sort((a, b) => a.name.localeCompare(b.name, "es") || compareCodepoint(a.id, b.id));

  const ruleLabel = (r: FairnessMonthBody["presence"][number]) =>
    `${r.roles.join(", ")} · ${r.members.map((id) => nameOf(id) || id).join(", ")} · ${r.exclusive ? "exclusiva" : "no exclusiva"}`;
  const oldRules = new Map(existing.presence.map((r) => [r.ruleKey, ruleLabel(r)] as const));
  const newRules = new Map(planned.presence.map((r) => [r.ruleKey, ruleLabel(r)] as const));
  const presence: ReplaceChange[] = [];
  for (const key of [...new Set([...oldRules.keys(), ...newRules.keys()])].sort(compareCodepoint)) {
    const was = oldRules.get(key);
    const is = newRules.get(key);
    if (was === undefined) presence.push({ kind: "presence", id: key, name: "", change: "added", details: [is ?? ""] });
    else if (is === undefined) presence.push({ kind: "presence", id: key, name: "", change: "removed", details: [was] });
    else if (was !== is) presence.push({ kind: "presence", id: key, name: "", change: "changed", details: [`${was} → ${is}`] });
  }
  return [...people, ...presence];
}

export interface TableModel {
  generatedAt: string;
  projectId: string;
  dataset: string;
  months: string[];
  previewRun: string;
  overridesHash: string;
  cadenceSettings: { config: number; overrides: number };
  table: TableMonth[];
  preview: {
    window: string[];
    sources: Array<{ month: string; from: "planned" | "stored" | "none" }>;
    /** Balance TENTHS per tab, from the ledger (IF2-8 `tenths.balance`). */
    rows: Array<{ memberId: string; name: string; tabs: Partial<Record<TabKey, number>> }>;
  };
  anomalies: Array<{ anomaly: Anomaly; text: string }>;
  notes: Array<{ ordinal: number; memberId: string; name: string; note: string }>;
  notApplicable: Array<{ ordinal: number; memberId: string; month: string }>;
}

/** R11: rows by display name with Spanish collation, then `_id`. */
const byNameEs = <T extends { name: string; memberId: string }>(a: T, b: T) =>
  a.name.localeCompare(b.name, "es") || (a.memberId < b.memberId ? -1 : a.memberId > b.memberId ? 1 : 0);

export function renderTable(m: TableModel): string {
  const lines: string[] = [];
  lines.push("# Reconstrucción de registros de equidad — tabla para revisar", "");
  lines.push(`- Destino: \`${m.projectId}\` · \`${m.dataset}\``);
  lines.push(`- Generado: ${m.generatedAt} (no entra en la huella)`);
  lines.push(`- Meses pedidos: ${m.months.join(", ")} · vista previa del saldo: corrida ${m.previewRun}`);
  lines.push(`- Archivo de correcciones: ${m.overridesHash === "none" ? "ninguno" : `\`${m.overridesHash}\``}`);
  lines.push(`- «Mes por medio» encontrados: ${m.cadenceSettings.config} en las reglas · ${m.cadenceSettings.overrides} en correcciones`);
  lines.push("- **Disponibilidad: lo guardado hoy, no lo que había entonces.**");
  lines.push(
    "- Las reglas de hoy se aplican hacia atrás. Una corrección no puede editar una regla de presencia ni quitar una exclusión por semana: se aceptan como quedan registradas (ver anomalías) o el mes no se aplica.",
  );
  lines.push("");

  for (const month of m.table) {
    lines.push(`## ${month.month} — ${ACTION_LABEL[month.action]}`, "");
    if (month.action === "skip") continue;
    lines.push("### Servicios", "");
    if (month.services.length === 0) lines.push("_Sin servicios guardados._", "");
    else {
      lines.push("| Fecha | Tipo | Cuenta |", "|---|---|---|");
      for (const s of month.services) lines.push(`| ${s.date} | ${s.type} | ${s.counted ? "sí" : "no"} |`);
      lines.push("");
    }
    lines.push("### Personas", "");
    lines.push(
      `| Persona | ${ROLE_KEYS.map((k) => ROLE_HEAD[k]).join(" | ")} | Inicio de línea (DL · SL · BGV · Coro) | Lugares (DL · SL · BGV · Coro) | Fechas bloqueadas | Exenta | Mes por medio |`,
    );
    lines.push(`|---|${ROLE_KEYS.map(() => "---").join("|")}|---|---|---|---|---|`);
    for (const r of [...month.rows].sort(byNameEs)) {
      const roleCells = ROLE_KEYS.map((k) => {
        const c = r.cells[k];
        return `${statusLabel(c.status, c.count)} · ${REASON_LABEL[c.reason]}${c.corrected ? " · corregido" : ""}`;
      });
      const joins = LINES.map((l) => r.joins[l] ?? "—").join(" · ");
      const seats = LINES.map((l) => String(r.seats[l] ?? 0)).join(" · ");
      const blocked = `${r.blocked.length > 0 ? r.blocked.join(", ") : "—"}${r.blocksCorrected ? " · corregido" : ""}`;
      const who = `${r.name || "(sin nombre)"} (\`${r.memberId}\`)${r.added ? " · añadida por corrección" : ""}`;
      lines.push(
        `| ${who} | ${roleCells.join(" | ")} | ${joins} | ${seats} | ${blocked} | ${r.exempt ? "sí" : "no"}${r.exemptCorrected ? " · corregido" : ""} | ${r.cadence ? "sí" : "no"}${r.cadenceCorrected ? " · corregido" : ""} |`,
      );
    }
    lines.push("");
    if (month.changes) {
      lines.push("### Cambios frente al registro guardado", "");
      if (month.changes.length === 0) lines.push("_Ningún cambio visible por persona._", "");
      else {
        lines.push("| Persona o regla | Cambio |", "|---|---|");
        for (const c of month.changes) {
          const who = c.kind === "person" ? `${c.name || "(sin nombre)"} (\`${c.id}\`)` : `presencia \`${c.id}\``;
          const what = c.change === "added" ? ["nueva en el registro"] : c.change === "removed" ? ["sale del registro"] : [];
          lines.push(`| ${who} | ${[...what, ...c.details].join(" · ")} |`);
        }
        lines.push("");
      }
    }
    lines.push("### Reglas de presencia (como se guardarán)", "");
    if (month.presence.length === 0) lines.push("_Ninguna._", "");
    else {
      lines.push("| Regla | Clave | Roles | Miembros | Exclusiva |", "|---|---|---|---|---|");
      for (const p of month.presence) {
        lines.push(`| ${p.ordinal} | \`${p.ruleKey}\` | ${p.roles.join(", ")} | ${p.members.join(", ")} | ${p.exclusive ? "sí" : "no"} |`);
      }
      lines.push("");
    }
  }

  lines.push(`## Vista previa del saldo — corrida ${m.previewRun} (ventana ${m.preview.window.join(", ")})`, "");
  lines.push(`Registros usados: ${m.preview.sources.map((s) => `${s.month}: ${SOURCE_LABEL[s.from]}`).join(" · ")}`, "");
  lines.push("Cifras del ledger de C2 con un decimal; «le deben» = le toca más de lo que tuvo.", "");
  lines.push("| Persona | DL | SL | BGV | Coro | Total |", "|---|---|---|---|---|---|");
  for (const r of [...m.preview.rows].sort(byNameEs)) {
    lines.push(`| ${r.name || "Miembro eliminado"} (\`${r.memberId}\`) | ${PREVIEW_TABS.map((t) => saldoWords(r.tabs[t] ?? 0)).join(" | ")} |`);
  }
  lines.push("");

  lines.push("## Anomalías (se listan; nada se resuelve solo)", "");
  if (m.anomalies.length === 0) lines.push("_Ninguna._");
  for (const a of m.anomalies) lines.push(`- ${a.text}`);
  lines.push("");
  lines.push("## Correcciones: notas", "");
  if (m.notes.length === 0) lines.push("_Ninguna._");
  for (const n of m.notes) lines.push(`- entrada ${n.ordinal} · ${n.name || "(sin nombre)"} (\`${n.memberId}\`): ${n.note}`);
  lines.push("");
  lines.push("## Correcciones que no aplican a esta corrida", "");
  if (m.notApplicable.length === 0) lines.push("_Ninguna._");
  for (const n of m.notApplicable) lines.push(`- entrada ${n.ordinal} · \`${n.memberId}\` · ${n.month}: no aplica a esta corrida`);
  return `${lines.join("\n")}\n`;
}

/** R13's sentence for an anomaly — private table only (it names people). */
export function anomalyText(a: Anomaly, nameOf: (id: string) => string): string {
  const when = a.month ? `${a.month} · ` : "";
  const who = a.memberId ? `${nameOf(a.memberId) || "miembro sin documento"} (\`${a.memberId}\`)` : "";
  const rule = a.ruleKey ? `${a.ruleOrdinal ?? "presencia"} (\`${a.ruleKey}\`)` : "una regla de presencia";
  const line = a.line ? LINE_LABEL[a.line] : "";
  const months = (a.months ?? []).join(", ");
  switch (a.code) {
    case "seat_while_out":
      return `${when}${who}: tiene un lugar ${a.roleKey} el ${a.date} con estado «fuera»; se queda fuera (un lugar nunca da elegibilidad).`;
    case "seat_unavailable":
      return `${when}${who}: tiene un lugar ${a.roleKey} el ${a.date}, una fecha marcada como no disponible.`;
    case "seat_rule_excluded":
      return `${when}${who}: tiene un lugar ${a.roleKey} el ${a.date}, un fin de semana en que una regla de hoy la excluye de ese rol.`;
    case "join_mid_month":
      return `${when}${who}: su primer lugar en ${line} (${a.date}) no es el primer servicio de esa línea en el mes (${a.firstServiceDate}); si llegó a mitad de mes, corrige con «blockedDates».`;
    case "exact_mismatch":
      return `${when}${who}: regla fija = ${a.count}, tuvo ${a.held} (${(a.roles ?? []).join(", ")}).`;
    case "cadence_not_in":
      return `${when}${who}: tiene «Mes por medio» pero Sun.Lead no está elegible; el ajuste se guarda como lo da el resolvedor.`;
    case "not_ticked_today":
      return `${who}: elegible por Tipo para ${line} pero hoy no está marcada en la lista (${months}); la inferencia puede sobrestimarla.`;
    case "ticked_never_seated":
      return `${who}: marcada hoy para ${line} y sin ningún lugar contado en esa línea: queda «fuera» en ${months} y puede leerse «al día» cuando se le debe. Corrección: «joinMonths».`;
    case "presence_no_seat":
      return `${when}${rule}: aplica el ${a.date} y nadie de la regla tuvo un lugar de presencia; quizá la regla de hoy no regía entonces.`;
    case "presence_outside":
      return `${when}${rule}: el lugar de presencia de ${who} (${(a.dates ?? []).join(", ")}) queda fuera de la población (C2 LG-7).`;
    case "person_added":
      return `${when}${who}: añadida por corrección; las exclusiones por semana de hoy no se le aplican (R8).`;
    case "member_gone":
      return `${when}${who}: miembro eliminado o fuera de alabanza: sus lugares no cuentan y la parte de los demás en esos servicios cambia.`;
    case "duplicate_target":
      return `${when}dos documentos ${a.type} el ${a.date} (${(a.roleIds ?? []).map((id) => `\`${id}\``).join(", ")}): el ledger descarta los dos.`;
    case "second_seat":
      return `${when}${who}: dos lugares de voz en el servicio del ${a.date}; el de ${a.roleKey} se aparta como segundo lugar.`;
    case "rule_split":
      return `${when}${who}: regla fija partida por el inicio de línea; ${(a.roles ?? []).join(", ")} queda «elegible». Si hace falta, restáurala con una regla fija en el archivo de correcciones.`;
    case "lost_block":
      return `${when}${who}: fecha bloqueada perdida (${a.date}): el registro actual la tiene y el nuevo no; el registro se respaldó. Corrección: «blockedDates».`;
  }
}

export function renderRefusalReport(input: { generatedAt: string; refusals: readonly RunRefusal[]; nameOf: (id: string) => string }): string {
  const n = input.refusals.length;
  const lines = [
    "# Reconstrucción de registros de equidad — rechazo",
    "",
    `- Generado: ${input.generatedAt}`,
    "- Nada se escribió en Sanity, ni tabla ni plan.",
    "",
  ];
  input.refusals.forEach((r, i) => {
    lines.push(`## Rechazo ${i + 1} de ${n} — \`${r.reason}\``, "");
    lines.push(`- Tipo: ${r.kind}`);
    if (r.month) lines.push(`- Mes: ${r.month}`);
    if (r.roleKey) lines.push(`- Rol: ${r.roleKey}`);
    for (const rule of r.rules) lines.push(`- Regla: ${rule.ordinal}${rule.key ? ` · clave \`${rule.key}\`` : ""}`);
    if (r.person) lines.push(`- Nombre en la regla: «${r.person}»`);
    for (const id of r.memberIds ?? []) lines.push(`- Miembro: ${input.nameOf(id) || "(sin documento)"} · \`${id}\``);
    for (const issue of r.issues ?? []) lines.push(`- Validador: ${issue.path}: ${issue.message}`);
    lines.push(`- Qué pasa: ${r.detail}`, `- Cómo se arregla: ${r.fix}`, "");
  });
  return `${lines.join("\n")}\n`;
}

export function renderApplyReport(input: {
  generatedAt: string;
  mode: RunMode;
  results: ReadonlyArray<{ month: string; verdict: string; memberIds?: string[] }>;
  notAttempted: readonly string[];
}): string {
  const lines = [`# Reconstrucción de registros de equidad — ${MODE_LABEL[input.mode]}`, "", `- Generado: ${input.generatedAt}`, ""];
  lines.push("| Mes | Resultado |", "|---|---|");
  for (const r of input.results) lines.push(`| ${r.month} | ${r.verdict}${r.memberIds?.length ? ` (${r.memberIds.map((id) => `\`${id}\``).join(", ")})` : ""} |`);
  for (const month of input.notAttempted) lines.push(`| ${month} | sin intentar |`);
  lines.push(
    "",
    input.mode === "rollback-apply"
      ? "Un borrado fallido pudo haber llegado: corre --rollback (sin --apply) otra vez antes de cualquier reparación (R16, R18)."
      : "Una escritura fallida pudo haber llegado: corre el dry run otra vez antes de cualquier reparación (R16).",
  );
  return `${lines.join("\n")}\n`;
}

export function renderRollbackTable(input: { generatedAt: string; projectId: string; dataset: string; content: RollbackPlanContent }): string {
  const lines = [
    "# Reconstrucción de registros de equidad — borrado para revisar",
    "",
    `- Destino: \`${input.projectId}\` · \`${input.dataset}\``,
    `- Generado: ${input.generatedAt} (no entra en la huella)`,
    "- Solo se borra un registro que escribió la reconstrucción y que nadie editó después (R18).",
    "",
    "| Mes | Acción | Registro | Revisión | Origen | Intacto | Respaldo |",
    "|---|---|---|---|---|---|---|",
  ];
  for (const m of input.content.months) {
    const s = m.stored;
    lines.push(
      `| ${m.month} | ${ROLLBACK_LABEL[m.action]} | ${s ? `\`${s.id}\`` : "—"} | ${s ? `\`${s.rev}\`` : "—"} | ${s?.source ?? "—"} | ${s ? (s.recomputedHash === s.contentHash ? "sí" : "no") : "—"} | ${m.backup ? m.backup.file : "—"} |`,
    );
  }
  return `${lines.join("\n")}\n`;
}

/** R12: printed before any read. Project and dataset are configuration, not secrets. */
export function targetLine(mode: RunMode, projectId: string, dataset: string): string {
  return `reconstruct-fairness-months · ${projectId} · ${dataset} · ${MODE_LABEL[mode]}`;
}

/** R13's name-free refusal line: ordinal, reason, kind, rule ordinals, role, month, C2's index-based issues, the report's path. */
export function refusalLine(r: RunRefusal, index: number, total: number, reportPath: string | null): string {
  const parts = [`rechazo ${index} de ${total}`, r.reason, r.kind];
  if (r.rules.length > 0) parts.push(r.rules.map((x) => x.ordinal).join("; "));
  if (r.roleKey) parts.push(r.roleKey);
  if (r.month) parts.push(r.month);
  if (r.issues && r.issues.length > 0) parts.push(r.issues.map((x) => `${x.path}: ${x.message}`).join("; "));
  parts.push(reportPath ? `informe: ${reportPath}` : "sin informe");
  return parts.join(" · ");
}
