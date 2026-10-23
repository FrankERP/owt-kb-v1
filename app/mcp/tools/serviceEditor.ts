// The MCP editor over a SAVED month (admin parity phase 1, S2:
// docs/superpowers/plans/2026-10-21-owt-mcp-admin-parity-f1.md, T2.4–T2.5 and S3; ADR-0066). Four
// entries over one judge:
//
//   check_service_edits      model-visible, read-only: edits asked for in the chat (services by id
//                            or date, seats by label, people by name), NEVER forced. Answers the
//                            change set to save, its lines, the groups and the month check.
//   check_service_edits_app  app-only, read-only: the card's edits with month-scoped member tokens
//                            (F6), a seat's candidates, and `force` per edit — which mints a waiver
//                            token for every rule finding a forced edit created (F5).
//   save_service_edits       destructive: writes the checked change set, one service at a time,
//                            through `/admin`'s own PATCH writer (`roleEditCommit.ts`, F1).
//   copy_instruments         destructive (S3): one service's instruments onto another, through
//                            `/admin`'s own copy writer (`copyInstrumentsCommit.ts`). Checked first as
//                            `copy` in check_service_edits: the destination's target judged as a diff,
//                            and lines that name EVERY instrument seat of the result (`copyLines`).
//
// The judge is the proposal editor's (F2, ADR-0062 E1/E4): the check replays the edits through the
// planner's gates on the stored month (`storedMonthBoard.ts`, a move in STORED mode), then judges
// each changed service's TARGET as a diff against its stored state (`storedJudge.ts`) — the same
// function the save runs again on a fresh read before writing anything.
//
// THE SAVE (F3, T2.5). It reads the month fresh and sorts every service: equal to its target →
// «ya estaba»; `_rev` ≠ `baseRev` → «cambió» (refuses the WHOLE call); else «por guardar». Only «por
// guardar» services are judged, have their lines compared (F4) and their waivers verified (F5).
// Groups are derived from the signed diffs. Then one write per service, awaited with its notices
// queued INLINE (`notices: "inline"`: Next holds `after()` until the response closes), under a hard
// stop and a start cut-off; each outcome is classified as the planner classifies a PATCH
// (`classifyPatchOutcome`). A repeat of the same call finishes what an interruption left.
//
// TIME. Every write and re-read races the call's hard stop (`SAVE_HARD_STOP_MS`): a race lost is
// «sin confirmar» and stops the run. The plan's other half — a per-request client with its own
// timeout threaded through the commit's loaders — was NOT built: those loaders read through the
// module clients the protected-read audit pins, and a second client parameter would fork them.
// The race bounds the CALL; a lost request may still finish in the background, which is exactly
// «sin confirmar» (ADR-0066).
//
// LOGGING: the timing line and fixed tags only — never an id, a name, a token or a rule key.

import "server-only";

import { after } from "next/server";
import type { CallToolResult, McpServer, ServerContext } from "@modelcontextprotocol/server";
import { z } from "zod";

import { normalizeMinistries } from "@/app/ministries";
import { normalizeText } from "@/app/utils/normalizeText";
import { normalizeServiceName } from "@/app/utils/normalizeLabel";
import { isServiceTime } from "@/app/utils/serviceTime";
import { MEMBER_TYPE_LABEL } from "@/app/utils/memberTypes";
import { parseEditRequest } from "@/app/utils/roleWriteRequest";
import { editRole } from "@/app/utils/roleEditCommit";
import { copyInstruments } from "@/app/utils/copyInstrumentsCommit";
import { operationalClient } from "@/sanity/lib/operationalClient";
import { adminRolesQuery } from "@/app/utils/serviceReadQueries";
import { serviceTodayIso } from "@/app/components/admin/serviceReadiness";
import { V3_CONNECTOR_LINES as L, V3_EDITOR_LINES as E, V3_STORED_EDITOR_LINES as S } from "@/app/components/admin/v3Copy";
import { cellsToParticipantRoles } from "@/app/components/admin/plannerModel";
import { savedWindowFor } from "@/app/components/admin/plannerMonth";
import { classifyPatchOutcome } from "@/app/components/admin/plannerSaveModel";
import { effectiveStoredCounts, isStoredColumnPast } from "@/app/components/admin/fairnessToggleModel";
import type { ServiceRole } from "@/app/components/admin/serviceCardModel";
import type { V3ConfirmEntry } from "@/app/components/admin/v3Confirm";
import { isWorshipNightFormat } from "@/app/utils/serviceFormat";
import { fairnessRecordEnvironment, resolveSolverEngine } from "@/app/utils/solverDeployment";
import { loadFairnessLedgerWith } from "@/app/utils/fairnessLedgerRead";
import type { LedgerService } from "@/app/utils/fairnessLedger";
import { shiftMonth, type FairnessLedgerResponse, type LogicalRecord, type RecordEnvironment } from "@/app/utils/fairnessVocabulary";
import { loadV3Ledger, loadV3PlanSources, type V3PlanSources } from "@/app/utils/v3MonthPlanReads";
import { runWriteTool, type WriteFailureCopy } from "../writes/runWriteTool";
import { principalOf, type McpPrincipal } from "../monthProposals/principal";
import { memberTokenKey, type MemberTokenKey, type MemberTokens } from "../monthProposals/memberTokens";
import { canonicalJson, changeMac, monthMemberTokens, sameMac, waiverToken } from "../monthProposals/changeSetTokens";
import { findingIsRule, serverPickCandidates, type EditorBoard } from "../monthProposals/editorBoard";
import { NOT_ELIGIBLE_SENTENCE, replayEdits, seatedIds, type EditVerdict, type EditorEdit, type EditorMember, type ReplayRefusal } from "../monthProposals/revise";
import { monthCheck, monthCheckLines, type FairShareLedger, type MonthCheck } from "../monthProposals/monthCheck";
import { boardView, findingView, type Namer } from "../monthProposals/editorView";
import {
  columnTarget,
  roleTarget,
  sameRoleSemantics,
  storedColumn,
  storedMonthBoard,
  targetSnapshot,
  withHeader,
  withTarget,
  type ServiceDiff,
  type ServiceTarget,
  type StoredMonthBoard,
} from "../monthProposals/storedMonthBoard";
import {
  MAX_GROUP,
  baselineLines,
  changeLines,
  copyLines,
  deriveGroups,
  saveUnits,
  judgeTarget,
  movedMembers,
  sameLines,
  servicesOf,
  storedLabel,
  type JudgeRefusal,
  type TargetJudgement,
} from "../monthProposals/storedJudge";
import { PROPOSAL_CARD_TOOL_META } from "../apps/proposalCard";
import { draftLabel } from "../monthProposals/labels";
import { kindOfType } from "@/app/components/admin/v3Services";
import { ROLE_TYPES } from "@/app/utils/serviceReadModel";


/** No write or re-read outlives this point of the call (T2.5 item 4). */
export const SAVE_HARD_STOP_MS = 45_000;
/**
 * No group or single service STARTS after this point. Set from the plan's first estimate and only
 * ever lowered by the dev measurement of the whole call (T2.6), so the last group ends with at
 * least 15 s to spare inside the 60 s function.
 */
export const SAVE_START_CUTOFF_MS = 30_000;
/** At most this many services in one call (a month has at most 31 days of services). */
export const MAX_CHANGES = 31;

// ── Wire schemas ─────────────────────────────────────────────────────────────

const MONTH = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/);
const DAY = /^\d{4}-\d{2}-\d{2}$/;
const SERVICE = z.string().min(1).max(128);
const ROW = z.string().max(80);
const TOKEN = z.string().max(32);
const LABEL = z.string().max(80);
const SEAT = z.object({ service: SERVICE, row: ROW, member: TOKEN }).strict();
/** A header edit, as the grid's header editor makes it: a special's name and time, «Cuenta para equidad». */
const HEADER = {
  op: z.literal("header"),
  service: SERVICE,
  name: LABEL.optional(),
  /** `"HH:mm"`, or `null`/`""` to clear a special's time. */
  time: z.string().max(5).nullable().optional(),
  countsForFairness: z.boolean().optional(),
};
const TOKEN_EDIT = z.discriminatedUnion("op", [
  z.object({ op: z.literal("place"), service: SERVICE, row: ROW, member: TOKEN, force: z.boolean().optional() }).strict(),
  z.object({ op: z.literal("move"), from: SEAT, to: z.object({ service: SERVICE, row: ROW }).strict(), force: z.boolean().optional() }).strict(),
  z.object({ op: z.literal("clear"), service: SERVICE, row: ROW, member: TOKEN }).strict(),
  z.object({ op: z.literal("exchange"), a: SEAT, b: SEAT, force: z.boolean().optional() }).strict(),
  z.object(HEADER).strict(),
]);

export const CHECK_SERVICE_EDITS_APP_INPUT = z
  .object({
    month: MONTH,
    edits: z.array(TOKEN_EDIT).max(200),
    /** A seat whose candidates to list; a call with it skips the month check. */
    seat: z.object({ service: SERVICE, row: ROW }).strict().optional(),
  })
  .strict();

const NAME = z.string().min(1).max(80);
/** A service by its id (as get_service and list_services answer it) or its date when that date has one. */
const NAME_SEAT = z.object({ service: SERVICE, seat: NAME, member: NAME }).strict();
const NAME_EDIT = z.discriminatedUnion("op", [
  z.object({ op: z.literal("place"), service: SERVICE, seat: NAME, member: NAME }).strict(),
  z.object({ op: z.literal("move"), from: NAME_SEAT, to: z.object({ service: SERVICE, seat: NAME }).strict() }).strict(),
  z.object({ op: z.literal("clear"), service: SERVICE, seat: NAME, member: NAME }).strict(),
  z.object({ op: z.literal("exchange"), a: NAME_SEAT, b: NAME_SEAT }).strict(),
  z.object(HEADER).strict(),
]);

export const CHECK_SERVICE_EDITS_INPUT = z
  .object({
    month: MONTH,
    edits: z.array(NAME_EDIT).max(200),
    /** A copy of one service's instruments (by id or date) onto another of this month, checked alone. */
    copy: z.object({ from: SERVICE, to: SERVICE }).strict().optional(),
    /** Card only: the dates it shows (one day, a weekend); what is checked is still the whole month. */
    focus: z.object({ from: z.string().regex(DAY), to: z.string().regex(DAY) }).strict().optional(),
  })
  .strict();

const WIRE_TARGET = z
  .object({
    _type: z.enum(ROLE_TYPES),
    date: z.string().regex(DAY),
    service_name: LABEL.optional(),
    time: z.string().max(5).optional(),
    countsForFairness: z.boolean(),
    leads: z.array(TOKEN).max(40),
    bgvs: z.array(TOKEN).max(40),
    chorus: z.array(TOKEN).max(40),
    instruments: z.array(z.object({ instrument: LABEL, member: TOKEN }).strict()).max(60),
    foh: z.array(z.object({ role: LABEL, member: TOKEN }).strict()).max(60),
  })
  .strict();
const WIRE_SEAT_CHANGE = z.object({ row: ROW, member: TOKEN }).strict();
const WIRE_DIFF = z.object({ removed: z.array(WIRE_SEAT_CHANGE).max(200), added: z.array(WIRE_SEAT_CHANGE).max(200) }).strict();
/** One service's change set, exactly as a check answered it. No `group`: groups are the server's (F3). */
const CHANGE = z
  .object({
    service: SERVICE,
    baseRev: z.string().min(1).max(64),
    target: WIRE_TARGET,
    diff: WIRE_DIFF,
    mac: z.string().max(64),
    /** The services this change must be saved with (signed by the check): a move's two halves. */
    unit: z.array(SERVICE).min(1).max(MAX_GROUP),
    lines: z.array(z.string().max(400)).max(200),
    waivers: z.array(TOKEN).max(200).optional(),
  })
  .strict();

export const SAVE_SERVICE_EDITS_INPUT = z.object({ month: MONTH, changes: z.array(CHANGE).min(1).max(MAX_CHANGES) }).strict();

/**
 * A copy exactly as a check answered it (`copy`): role ids and the prompt's lines. No waivers: the
 * solver's per-seat rules bind voice rows only (`ruleEnforcement.ts`), so a copy of instruments
 * cannot break one; if one ever appears, the copy is refused (fail closed), never forced.
 */
export const COPY_INSTRUMENTS_INPUT = z
  .object({
    month: MONTH,
    from: SERVICE,
    to: SERVICE,
    lines: z.array(z.string().max(400)).min(1).max(200),
  })
  .strict();

export type CheckServiceEditsArgs = z.infer<typeof CHECK_SERVICE_EDITS_INPUT>;
export type CheckServiceEditsAppArgs = z.infer<typeof CHECK_SERVICE_EDITS_APP_INPUT>;
export type SaveServiceEditsArgs = z.infer<typeof SAVE_SERVICE_EDITS_INPUT>;
export type CopyInstrumentsArgs = z.infer<typeof COPY_INSTRUMENTS_INPUT>;
type WireTarget = z.infer<typeof WIRE_TARGET>;
type WireDiff = z.infer<typeof WIRE_DIFF>;
type Change = z.infer<typeof CHANGE>;
type TokenEdit = z.infer<typeof TOKEN_EDIT>;
type NameEdit = z.infer<typeof NAME_EDIT>;
type HeaderEdit = Extract<TokenEdit, { op: "header" }>;

export const SERVICE_EDITOR_COPY: WriteFailureCopy = {
  pre: "No se pudo revisar el mes; vuelve a intentarlo. No se escribió nada.",
  domain: "No pude confirmar qué se guardó. Repite exactamente la misma llamada: lo que ya quedó se reconoce como «ya estaba».",
};

export const CHECK_SERVICE_EDITS_DESCRIPTION =
  "Revisa cambios a los servicios GUARDADOS de un mes (los que ya existen en /admin) sin guardar nada. month es " +
  "YYYY-MM; edits es la lista de cambios en orden: place (poner a alguien en un lugar), clear (quitarlo), move " +
  "(pasarlo a otro lugar, también de un servicio a otro), exchange (intercambiar a dos personas) y header (el nombre " +
  "o la hora de un especial, o «Cuenta para equidad»). Para copiar los instrumentos de un servicio a otro manda copy " +
  "{from, to} en lugar de edits (sola, sin otros cambios). Cada servicio se nombra por su id (el de get_service o " +
  "list_services) o por su fecha (YYYY-MM-DD) cuando ese día tiene uno solo; cada lugar por su nombre en el " +
  "planificador (Lead, BGV, Coro, un instrumento o la consola) y cada persona por su nombre. La fecha de un servicio no " +
  "se cambia desde aquí. Cada cambio pasa por las mismas reglas que /admin: si uno rompe una regla de lugar, se rechaza " +
  "(forzarlo solo se puede desde la tarjeta). La respuesta trae los cambios en palabras, los servicios que se guardan " +
  "juntos y lo que no cuadra con las reglas del mes; al final, una línea con los argumentos listos para save_service_edits " +
  "(o para copy_instruments, si es una copia), que se pasan tal cual (una por llamada si son varias). También abre la " +
  "tarjeta del mes: con focus {from, to} (YYYY-MM-DD) la tarjeta muestra solo esos días (un día: from = to; un fin de " +
  "semana: sábado a domingo), y con focus edits puede ir vacía para solo abrirla. focus no cambia lo que se revisa.";

export const COPY_INSTRUMENTS_DESCRIPTION =
  "Copia en producción los instrumentos de un servicio a otro, como «Copiar instrumentos» de /admin: los del destino se " +
  "reemplazan por los que el origen tiene guardados ahora. Antes revisa la copia con check_service_edits (copy {from, " +
  "to}) y manda aquí los argumentos de su última línea (month, from, to y lines) tal cual. Si algo cambió desde la revisión no " +
  "copia nada y pide revisar de nuevo; la respuesta dice siempre qué sigue.";

export const SAVE_SERVICE_EDITS_DESCRIPTION =
  "Guarda en producción cambios a servicios guardados que check_service_edits ya revisó. month es YYYY-MM; changes es " +
  "la lista que trae la última línea de la revisión, tal cual (cada uno con su service, baseRev, target, diff, mac, unit, lines y, si " +
  "hay, waivers). Escribe un servicio a la vez con las mismas reglas y avisos por correo que /admin. Si algo cambió " +
  "desde la revisión no guarda nada y pide revisar de nuevo; la respuesta dice siempre qué sigue. Si te piden guardar " +
  "«los cambios de la tarjeta» con una clave entre paréntesis, usa solo la línea del contexto con esa clave; si no la ves, " +
  "no guardes nada y pide tocar «Guardar» en la tarjeta otra vez.";

// ── Deps ─────────────────────────────────────────────────────────────────────

export interface ServiceEditorDeps {
  engine: () => string;
  reads: typeof loadV3PlanSources;
  readLedger: (months: readonly string[]) => Promise<FairnessLedgerResponse>;
  readFairShare: typeof loadFairnessLedgerWith;
  tokenKey: () => MemberTokenKey;
  environment: () => RecordEnvironment;
  nowMs: () => number;
  todayIso: () => string;
  editRole: typeof editRole;
  copyInstruments: typeof copyInstruments;
  /** One role as the admin roles read projects it; `null` = gone. Throws on a failed read. */
  rereadRole: (id: string) => Promise<ServiceRole | null>;
  /**
   * Keeps the function alive until `p` settles, after the answer: a write that loses the race to the
   * hard stop may still commit, and its inline notices must land with it (Next's `after`).
   */
  keepAlive: (p: Promise<unknown>) => void;
}

/** `after()` keeps a write that outlived the answer running to the end, notices included. */
export const keepWriteAlive = (p: Promise<unknown>) => after(() => p.then(() => undefined, () => undefined));

async function rereadRole(id: string): Promise<ServiceRole | null> {
  const q = adminRolesQuery();
  const rows: unknown = await operationalClient.fetch(q.query, q.params);
  if (!Array.isArray(rows)) throw new Error("roles");
  const row = (JSON.parse(JSON.stringify(rows)) as ServiceRole[]).find((r) => r._id === id);
  return row ?? null;
}

export function defaultServiceEditorDeps(): ServiceEditorDeps {
  return {
    engine: () => resolveSolverEngine(process.env),
    reads: loadV3PlanSources,
    readLedger: loadV3Ledger,
    readFairShare: loadFairnessLedgerWith,
    tokenKey: () => memberTokenKey(process.env),
    environment: () => fairnessRecordEnvironment(process.env),
    nowMs: () => Date.now(),
    todayIso: serviceTodayIso,
    editRole,
    copyInstruments,
    rereadRole,
    keepAlive: keepWriteAlive,
  };
}

// ── Answers ──────────────────────────────────────────────────────────────────

function answer(isError: boolean, lines: readonly string[], content: Record<string, unknown>): CallToolResult {
  return {
    ...(isError ? { isError: true } : {}),
    content: [{ type: "text", text: lines.filter(Boolean).join("\n") }],
    structuredContent: content,
  };
}

const refusal = (lines: readonly string[], content: Record<string, unknown>) => answer(true, lines, { refused: true, ...content });

// ── Opening a month ─────────────────────────────────────────────────────────

interface MonthContext {
  month: string;
  todayIso: string;
  sources: V3PlanSources;
  board: StoredMonthBoard;
  members: EditorMember[];
  key: Uint8Array;
  tokens: MemberTokens;
  namer: Namer;
}

const displayName = (m: { alias?: string; member_name: string }) => m.alias?.trim() || m.member_name;
const fold = (s: string) => normalizeText(s.normalize("NFC").trim().replace(/\s+/g, " "));
const isWorship = (m: EditorMember) => normalizeMinistries(m.ministries).includes("worship");

/**
 * People by display name; two people who share one are told apart by their Tipo in every line
 * (T2.3), so the permission prompt never shows two identical names for two people.
 */
function personNamer(members: readonly EditorMember[]): (id: string) => string {
  const byId = new Map(members.map((m) => [m._id, m]));
  const count = new Map<string, number>();
  for (const m of members) count.set(fold(displayName(m)), (count.get(fold(displayName(m))) ?? 0) + 1);
  return (id) => {
    const m = byId.get(id);
    if (!m) return "alguien que ya no está en la lista";
    const name = displayName(m);
    if ((count.get(fold(name)) ?? 0) < 2) return name;
    const tipos = (m.memberType ?? []).map((t) => MEMBER_TYPE_LABEL[t] ?? t);
    return `${name} (${tipos.length ? tipos.join(", ") : "sin Tipo"})`;
  };
}

async function openMonth(
  month: string,
  principal: McpPrincipal | null,
  deps: ServiceEditorDeps,
): Promise<{ ok: true; ctx: MonthContext } | { ok: false; result: CallToolResult }> {
  const fail = (result: CallToolResult) => ({ ok: false as const, result });
  if (!principal) return fail(refusal([L.noPrincipal], { code: "forbidden", detail: "no_principal" }));
  if (deps.engine() !== "v3") return fail(refusal([L.engineNotV3], { code: "integrity_conflict", detail: "engine_not_v3" }));
  const key = deps.tokenKey();
  if (!key.ok) {
    console.error("[mcp-service-editor] member token secret unavailable");
    return fail(refusal([E.noSecret], { code: "integrity_conflict", detail: "no_secret" }));
  }
  const read = await deps.reads();
  if (!read.ok) return fail(refusal([L.sources(read.failed)], { code: "integrity_conflict", detail: "sources", retry: true }));
  const sources = read.value;
  const states = sources.snapshot.readiness.sources;
  const unready = (Object.keys(states) as (keyof typeof states)[]).filter((k) => states[k] !== "ready");
  if (unready.length) return fail(refusal([L.sources(unready)], { code: "integrity_conflict", detail: "sources", retry: true }));
  const todayIso = deps.todayIso();
  const board = storedMonthBoard({ month, adminRoles: sources.adminRoles, summary: sources.snapshot.readiness.roleSummary, todayIso });
  const members = sources.members as EditorMember[];
  const tokens = monthMemberTokens(key.key, month, [...members.map((m) => m._id), ...seatedIds(board.cells)]);
  const byId = new Map(members.map((m) => [m._id, m]));
  const namer: Namer = {
    tokenOf: (id) => tokens.tokenOf(id),
    nameOf: personNamer(members),
    unavailableOn: (id, date) => (byId.get(id)?.unavailableDates ?? []).includes(date),
  };
  return { ok: true, ctx: { month, todayIso, sources, board, members, key: key.key, tokens, namer } };
}

// ── Wire ↔ ids ───────────────────────────────────────────────────────────────

function wireTarget(t: ServiceTarget, tokens: MemberTokens): WireTarget {
  return {
    _type: t._type,
    date: t.date,
    ...(t.service_name !== undefined ? { service_name: t.service_name } : {}),
    ...(t.time !== undefined ? { time: t.time } : {}),
    countsForFairness: t.countsForFairness,
    leads: t.leads.map(tokens.tokenOf),
    bgvs: t.bgvs.map(tokens.tokenOf),
    chorus: t.chorus.map(tokens.tokenOf),
    instruments: t.instruments.map((i) => ({ instrument: i.instrument, member: tokens.tokenOf(i.personId) })),
    foh: t.foh.map((f) => ({ role: f.role, member: tokens.tokenOf(f.personId) })),
  };
}

function idTarget(w: WireTarget, tokens: MemberTokens): ServiceTarget | null {
  const ids = (xs: readonly string[]) => xs.map((x) => tokens.idOf(x));
  const all = [...ids(w.leads), ...ids(w.bgvs), ...ids(w.chorus), ...ids(w.instruments.map((i) => i.member)), ...ids(w.foh.map((f) => f.member))];
  if (all.some((x) => x === null)) return null;
  return {
    _type: w._type,
    date: w.date,
    ...(w.service_name !== undefined ? { service_name: w.service_name } : {}),
    ...(w.time !== undefined ? { time: w.time } : {}),
    countsForFairness: w.countsForFairness,
    leads: ids(w.leads) as string[],
    bgvs: ids(w.bgvs) as string[],
    chorus: ids(w.chorus) as string[],
    instruments: w.instruments.map((i) => ({ instrument: i.instrument, personId: tokens.idOf(i.member)! })),
    foh: w.foh.map((f) => ({ role: f.role, personId: tokens.idOf(f.member)! })),
  };
}

const wireDiff = (d: ServiceDiff, tokens: MemberTokens): WireDiff => ({
  removed: d.removed.map((r) => ({ row: r.row, member: tokens.tokenOf(r.member) })),
  added: d.added.map((a) => ({ row: a.row, member: tokens.tokenOf(a.member) })),
});

// ── Edits ────────────────────────────────────────────────────────────────────

/** A header edit's refusal, or `null`; on success the board carries it. */
function applyHeader(board: EditorBoard, e: HeaderEdit, todayIso: string): { ok: true; board: EditorBoard } | { ok: false; sentence: string } {
  const column = storedColumn(board, e.service);
  if (!column) return { ok: false, sentence: S.judge.unknown_service };
  if (!board.editable.has(e.service)) return { ok: false, sentence: S.judge.not_editable };
  const special = kindOfType(column.type) === "special";
  if ((e.name !== undefined || e.time !== undefined) && !special) return { ok: false, sentence: S.headerOnlySpecial };
  if (e.name !== undefined && !normalizeServiceName(e.name)) return { ok: false, sentence: S.judge.header_invalid };
  if (e.time !== undefined && e.time !== null && e.time !== "" && !isServiceTime(e.time)) return { ok: false, sentence: S.judge.header_invalid };
  // F7: the planner's Switch is client-only (C1-D7); here the server refuses.
  if (e.countsForFairness !== undefined && isStoredColumnPast(column, todayIso) && e.countsForFairness !== effectiveStoredCounts(column, todayIso)) {
    return { ok: false, sentence: S.judge.past_counts };
  }
  return {
    ok: true,
    board: withHeader(board, e.service, {
      ...(e.name !== undefined ? { serviceName: normalizeServiceName(e.name) } : {}),
      ...(e.time !== undefined ? { time: e.time || null } : {}),
      ...(e.countsForFairness !== undefined ? { countsForFairness: e.countsForFairness } : {}),
    }),
  };
}

type Resolved = { ok: true; edits: Array<EditorEdit | HeaderEdit> } | { ok: false; lines: string[]; refusal?: ReplayRefusal };

function resolveTokenEdits(edits: readonly TokenEdit[], tokens: MemberTokens): Resolved {
  const out: Array<EditorEdit | HeaderEdit> = [];
  for (let index = 0; index < edits.length; index++) {
    const e = edits[index];
    if (e.op === "header") {
      out.push(e);
      continue;
    }
    const id = (t: string) => tokens.idOf(t);
    let edit: EditorEdit | null = null;
    if (e.op === "place" || e.op === "clear") {
      const m = id(e.member);
      if (m) edit = e.op === "place" ? { op: "place", service: e.service, row: e.row, member: m, force: e.force } : { op: "clear", service: e.service, row: e.row, member: m };
    } else if (e.op === "move") {
      const m = id(e.from.member);
      if (m) edit = { op: "move", from: { ...e.from, member: m }, to: e.to, force: e.force };
    } else {
      const a = id(e.a.member);
      const b = id(e.b.member);
      if (a && b) edit = { op: "exchange", a: { ...e.a, member: a }, b: { ...e.b, member: b }, force: e.force };
    }
    if (!edit) {
      const r: ReplayRefusal = { index, code: "member_not_eligible", sentence: NOT_ELIGIBLE_SENTENCE };
      return { ok: false, lines: [E.editRefused(index, r.sentence)], refusal: r };
    }
    out.push(edit);
  }
  return { ok: true, edits: out };
}

type ServiceRef = { ok: true; id: string } | { ok: false; line: string };

/** A service named by id, or by a date that has exactly one; `missing` when neither matches. */
function serviceByIdOrDate(services: ReadonlyArray<{ id: string; date: string; label: string }>, s: string, missing: string): ServiceRef {
  if (services.some((x) => x.id === s)) return { ok: true, id: s };
  if (!DAY.test(s)) return { ok: false, line: missing };
  const onDate = services.filter((x) => x.date === s);
  if (onDate.length === 1) return { ok: true, id: onDate[0].id };
  if (onDate.length === 0) return { ok: false, line: missing };
  return { ok: false, line: `Ese día tiene más de un servicio; usa su id: ${onDate.map((x) => `${x.label} (${x.id})`).join(", ")}.` };
}

/** A service of this month's board. */
function boardServiceOf(ctx: MonthContext, s: string): ServiceRef {
  const { board } = ctx;
  const services = board.columns.map((c) => ({ id: board.localIdOf.get(c.columnId)!, date: c.date, label: storedLabel(board, board.localIdOf.get(c.columnId)!) }));
  return serviceByIdOrDate(services, s, S.judge.unknown_service);
}

/** Any stored service, of any month: a copy's source (as /admin's copy mode allows). */
function anyServiceOf(ctx: MonthContext, s: string): ServiceRef {
  const services = ctx.sources.adminRoles.map((r) => ({ id: r._id, date: r.date.slice(0, 10), label: draftLabel({ _type: r._type, date: r.date.slice(0, 10), service_name: r.service_name }) }));
  return serviceByIdOrDate(services, s, S.copy.noSource);
}

/** The resolved edits as the card sends them (members as the month's tokens): the card continues from them (S4). */
function tokenEditsOf(edits: ReadonlyArray<EditorEdit | HeaderEdit>, tokens: MemberTokens): TokenEdit[] {
  const seat = (x: { service: string; row: string; member: string }) => ({ service: x.service, row: x.row, member: tokens.tokenOf(x.member) });
  return edits.map((e): TokenEdit => {
    if (e.op === "header") return e;
    if (e.op === "place") return { op: "place", service: e.service, row: e.row, member: tokens.tokenOf(e.member), ...(e.force ? { force: true } : {}) };
    if (e.op === "clear") return { op: "clear", service: e.service, row: e.row, member: tokens.tokenOf(e.member) };
    if (e.op === "move") return { op: "move", from: seat(e.from), to: { service: e.to.service, row: e.to.row }, ...(e.force ? { force: true } : {}) };
    return { op: "exchange", a: seat(e.a), b: seat(e.b), ...(e.force ? { force: true } : {}) };
  });
}

function resolveNameEdits(edits: readonly NameEdit[], ctx: MonthContext): Resolved {
  const { board } = ctx;
  const seated = new Set(seatedIds(board.cells));
  const audience = ctx.members.filter((m) => isWorship(m) || seated.has(m._id));
  const nameOf = ctx.namer.nameOf;
  const serviceOf = (s: string) => boardServiceOf(ctx, s);
  const rowOf = (label: string) => board.rows.find((r) => fold(r.label) === fold(label) || fold(r.id) === fold(label))?.id ?? null;
  const memberOf = (name: string): { ok: true; id: string } | { ok: false; line: string } => {
    const want = fold(name);
    const exact = audience.filter((m) => fold(nameOf(m._id)) === want || fold(displayName(m)) === want || fold(m.member_name) === want);
    if (exact.length === 1) return { ok: true, id: exact[0]._id };
    const options = (exact.length ? exact : audience.filter((m) => fold(displayName(m)).includes(want) || fold(m.member_name).includes(want))).map((m) => nameOf(m._id));
    return { ok: false, line: E.ambiguousName(name, [...new Set(options)].slice(0, 8)) };
  };
  const out: Array<EditorEdit | HeaderEdit> = [];
  for (let index = 0; index < edits.length; index++) {
    const e = edits[index];
    const fail = (line: string): Resolved => ({ ok: false, lines: [E.editRefused(index, line)] });
    if (e.op === "header") {
      const s = serviceOf(e.service);
      if (!s.ok) return fail(s.line);
      out.push({ ...e, service: s.id });
      continue;
    }
    const seatOf = (x: { service: string; seat: string; member?: string }) => {
      const s = serviceOf(x.service);
      if (!s.ok) return { ok: false as const, line: s.line };
      const row = rowOf(x.seat);
      if (!row) return { ok: false as const, line: E.unknownSeat(x.seat) };
      if (x.member === undefined) return { ok: true as const, service: s.id, row, member: "" };
      const m = memberOf(x.member);
      return m.ok ? { ok: true as const, service: s.id, row, member: m.id } : { ok: false as const, line: m.line };
    };
    if (e.op === "place" || e.op === "clear") {
      const s = seatOf(e);
      if (!s.ok) return fail(s.line);
      out.push({ op: e.op, service: s.service, row: s.row, member: s.member });
    } else if (e.op === "move") {
      const from = seatOf(e.from);
      if (!from.ok) return fail(from.line);
      const to = seatOf(e.to);
      if (!to.ok) return fail(to.line);
      out.push({ op: "move", from: { service: from.service, row: from.row, member: from.member }, to: { service: to.service, row: to.row } });
    } else {
      const a = seatOf(e.a);
      if (!a.ok) return fail(a.line);
      const b = seatOf(e.b);
      if (!b.ok) return fail(b.line);
      out.push({ op: "exchange", a: { service: a.service, row: a.row, member: a.member }, b: { service: b.service, row: b.row, member: b.member } });
    }
  }
  return { ok: true, edits: out };
}

// ── The check ────────────────────────────────────────────────────────────────

interface CheckedChange {
  service: string;
  label: string;
  date: string;
  baseRev: string;
  target: WireTarget;
  diff: WireDiff;
  /** The services it must be saved with (`saveUnits`), signed into `mac`. */
  unit: string[];
  mac: string;
  lines: string[];
  waivers: string[];
  judged: TargetJudgement;
  /** New findings no forced edit covers: the save would refuse them. */
  unconfirmed: string[];
}

type Replayed =
  | { ok: true; board: EditorBoard; verdicts: EditVerdict[] }
  | { ok: false; board: EditorBoard; refusal: ReplayRefusal };

/** Header edits in order, then the seat edits through the planner's gates (stored mode). */
function replayStored(ctx: MonthContext, edits: ReadonlyArray<EditorEdit | HeaderEdit>): Replayed {
  let board: EditorBoard = ctx.board;
  const seatEdits: EditorEdit[] = [];
  const indexOf: number[] = [];
  for (let index = 0; index < edits.length; index++) {
    const e = edits[index];
    if (e.op !== "header") {
      seatEdits.push(e);
      indexOf.push(index);
      continue;
    }
    const applied = applyHeader(board, e, ctx.todayIso);
    if (!applied.ok) return { ok: false, board, refusal: { index, code: "column_not_created", sentence: applied.sentence } };
    board = applied.board;
  }
  const replay = replayEdits({ board, edits: seatEdits, members: ctx.members, config: ctx.sources.rules.config });
  if (!replay.ok) return { ok: false, board: replay.board, refusal: { ...replay.refusal, index: indexOf[replay.refusal.index] ?? replay.refusal.index } };
  return { ok: true, board: replay.board, verdicts: replay.verdicts };
}

/** Each changed service's change set (F3), judged by the save's own judge; or the first refusal. */
function changeSets(
  ctx: MonthContext,
  board: EditorBoard,
  verdicts: readonly EditVerdict[],
  app: boolean,
): { ok: true; changes: CheckedChange[] } | { ok: false; lines: string[]; refusal: JudgeRefusal } {
  const forced = verdicts.flatMap((v) => v.forced);
  const changes: CheckedChange[] = [];
  for (const column of ctx.board.columns) {
    const id = ctx.board.localIdOf.get(column.columnId)!;
    if (!ctx.board.editable.has(id)) continue;
    const before = columnTarget(ctx.board, id, ctx.todayIso);
    const target = columnTarget(board, id, ctx.todayIso);
    if (!before || !target) return { ok: false, lines: [E.replay.server_error], refusal: { code: "server_error", sentence: E.replay.server_error } };
    if (sameRoleSemantics(targetSnapshot(before), targetSnapshot(target))) continue;
    const verdict = judgeTarget({ board: ctx.board, roleId: id, target, members: ctx.members, config: ctx.sources.rules.config, todayIso: ctx.todayIso });
    const label = storedLabel(ctx.board, id);
    if (!verdict.ok) return { ok: false, lines: [S.refusedAll(label, verdict.refusal.sentence)], refusal: verdict.refusal };
    const judged = verdict.judged;
    const baseRev = storedColumn(ctx.board, id)!.rev;
    const covered = (f: { key: Parameters<typeof findingIsRule>[0] }) => forced.some(({ seat, rules }) => rules.some((r) => findingIsRule(f.key, seat, r)));
    const waivers = app ? judged.added.filter(covered).map((f) => waiverToken(ctx.key, { service: id, baseRev, finding: f.key, sentence: f.sentence })) : [];
    const unconfirmed = judged.added.filter((f) => !app || !covered(f)).map((f) => E.needsConfirm(f.sentence, findingView(judged.board, f, ctx.namer).where));
    const wt = wireTarget(target, ctx.tokens);
    const wd = wireDiff(judged.diff, ctx.tokens);
    changes.push({
      service: id,
      label,
      date: column.date,
      baseRev,
      target: wt,
      diff: wd,
      unit: [],
      mac: "",
      lines: changeLines({ board: ctx.board, roleId: id, target, judged, nameOf: ctx.namer.nameOf }),
      waivers,
      judged,
      unconfirmed,
    });
  }
  // The units are signed with each change, so a save that names half of one is refused (F3).
  const units = saveUnits(deriveGroups(changes.map((c) => ({ service: c.service, date: c.date, diff: c.diff }))));
  for (const c of changes) {
    c.unit = units.find((u) => u.includes(c.service))!;
    c.mac = changeMac(ctx.key, c);
  }
  return { ok: true, changes };
}

/** The month's frozen eligibility, from its fairness record (T2.3); none = «sin revisar» where it is needed (E7). */
function entryFromRecord(record: LogicalRecord): V3ConfirmEntry {
  return {
    month: record.month,
    state: "bound",
    write: {
      month: record.month,
      source: record.source === "auto" ? "auto" : "manual",
      expectedRev: record.rev,
      people: record.people.map(({ name: _name, ...p }) => p),
      presence: record.presence,
    },
    expects: ["unchanged"],
  };
}

/** The ledger's stored services with each editable service replaced by the board's seats. */
function storedFairShareAdjust(board: EditorBoard): (stored: { records: LogicalRecord[]; services: LedgerService[] }) => { records: LogicalRecord[]; services: LedgerService[] } {
  return (stored) => {
    const services = stored.services.filter((s) => !board.editable.has(s._id));
    for (const column of board.columns) {
      const id = board.localIdOf.get(column.columnId)!;
      if (!board.editable.has(id)) continue;
      const seat = (rowId: string) => board.cells.find((c) => c.columnId === column.columnId && c.rowId === rowId)?.occupants.map((o) => o.memberId) ?? [];
      services.push({
        _id: id,
        _type: column.type,
        date: column.date,
        ...(column.time ? { time: column.time } : {}),
        published: (column as { published?: boolean }).published !== false,
        countsForFairness: column.countsForFairness,
        Lead: seat("lead"),
        BGVs: seat("bgv"),
        Chorus: kindOfType(column.type) === "saturday" ? [] : seat("coro"),
      });
    }
    return { records: stored.records, services };
  };
}

/** Whether a focus leaves out any service the month check would speak about (an editable one). */
const focusNarrows = (board: EditorBoard, focus: { from: string; to: string } | undefined) =>
  !!focus && board.columns.some((c) => board.editable.has(board.localIdOf.get(c.columnId)!) && (c.date < focus.from || c.date > focus.to));

/** The month check over the edited board (T2.3): the board's services as planned, the rest stored. */
async function runStoredMonthCheck(ctx: MonthContext, board: EditorBoard, deps: ServiceEditorDeps, days?: { from: string; to: string }): Promise<MonthCheck> {
  const months = [ctx.month];
  const [ledger, fairShare] = await Promise.all([
    deps.readLedger(months).catch(() => null),
    deps.readFairShare({ target: shiftMonth(ctx.month, 1), recordsThrough: ctx.month, adjust: storedFairShareAdjust(board) }).catch(() => null as FairShareLedger | null),
  ]);
  if (!ledger || !fairShare) console.error("[mcp-service-editor] ledger read failed");
  const record = ledger?.horizon.find((h) => h.month === ctx.month)?.record ?? null;
  const onBoard = new Set(board.columns.map((c) => c.columnId));
  const [year, month] = ctx.month.split("-").map(Number);
  const adminRoles = ctx.sources.adminRoles;
  return monthCheck({
    months,
    currentMonth: ctx.todayIso.slice(0, 7),
    entries: record ? [entryFromRecord(record)] : [],
    board,
    config: ctx.sources.rules.config,
    members: ctx.members,
    storedRoles: adminRoles.filter((r) => !board.editable.has(r._id)),
    savedWindow: savedWindowFor(year, month, adminRoles).filter((r) => !onBoard.has((r as { _id?: string })._id ?? "")),
    ledger,
    fairShare,
    ...(days ? { days } : {}),
  });
}

/** A worship night's song leaders must stay in its Lead (ADR-0036); the role writer does not check it. */
function songLeadLines(ctx: MonthContext, board: EditorBoard, days?: { from: string; to: string }): string[] {
  const lines: string[] = [];
  for (const column of board.columns) {
    const id = board.localIdOf.get(column.columnId)!;
    if (!board.editable.has(id) || kindOfType(column.type) !== "special" || !isWorshipNightFormat(column.format)) continue;
    if (days && (column.date < days.from || column.date > days.to)) continue;
    const role = ctx.sources.snapshot.roles.find((r) => r._id === id) as { songs?: Array<{ leads?: Array<{ _ref?: string }> }> } | undefined;
    const lead = new Set(board.cells.find((c) => c.columnId === column.columnId && c.rowId === "lead")?.occupants.map((o) => o.memberId) ?? []);
    const leaders = new Set((role?.songs ?? []).flatMap((s) => (s.leads ?? []).map((l) => l._ref).filter((x): x is string => !!x)));
    for (const m of leaders) if (!lead.has(m)) lines.push(S.songLeadGone(storedLabel(board, id), ctx.namer.nameOf(m)));
  }
  return lines;
}

function refusalView(r: ReplayRefusal, ctx: MonthContext) {
  return {
    index: r.index,
    code: r.code,
    sentence: r.sentence,
    ...(r.prompt
      ? {
          prompt: {
            service: r.prompt.seat.service,
            row: r.prompt.seat.row,
            member: ctx.namer.tokenOf(r.prompt.seat.member),
            rules: r.prompt.rules.map((x) => ({ kind: x.kind, rule: x.ruleId, sentence: x.sentence })),
          },
        }
      : {}),
  };
}

/** The card's dates: in order, inside the month, and holding at least one of its services. */
function focusOf(ctx: MonthContext, focus: { from: string; to: string }): { ok: true; value: { from: string; to: string } } | { ok: false; line: string } {
  const inMonth = (d: string) => d.slice(0, 7) === ctx.month;
  if (!inMonth(focus.from) || !inMonth(focus.to) || focus.from > focus.to) return { ok: false, line: S.focusInvalid };
  if (!ctx.board.columns.some((c) => c.date >= focus.from && c.date <= focus.to)) return { ok: false, line: S.focusEmpty };
  return { ok: true, value: focus };
}

async function checkMonth(
  ctx: MonthContext,
  edits: ReadonlyArray<EditorEdit | HeaderEdit>,
  deps: ServiceEditorDeps,
  options: { app: boolean; seat?: { service: string; row: string }; focus?: { from: string; to: string } },
): Promise<CallToolResult> {
  const head = { ok: true, month: ctx.month, edits: tokenEditsOf(edits, ctx.tokens), ...(options.focus ? { focus: options.focus } : {}) };
  const notes = [
    ...(ctx.board.coherent ? [] : [S.readOnlyMonth]),
    ...(ctx.board.untranslated ? [S.untranslated(ctx.board.untranslated)] : []),
  ];
  const replay = replayStored(ctx, edits);
  const board = replay.board;

  let candidates: unknown[] | undefined;
  if (options.seat) {
    const columnId = board.columnIdOf.get(options.seat.service);
    const onBoard = new Set(board.columns.map((c) => c.columnId));
    const [year, month] = ctx.month.split("-").map(Number);
    const ranked = columnId
      ? serverPickCandidates({
          board,
          columnId,
          rowId: options.seat.row,
          members: ctx.members,
          config: ctx.sources.rules.config,
          windowRoles: [
            ...savedWindowFor(year, month, ctx.sources.adminRoles).filter((r) => !onBoard.has((r as { _id?: string })._id ?? "")),
            ...cellsToParticipantRoles(board.cells, board.columns, ctx.members),
          ],
        })
      : null;
    if (!ranked) return refusal([S.judge.unknown_service], { code: "invalid_request", detail: "seat" });
    const worship = new Set(ctx.members.filter(isWorship).map((m) => m._id));
    candidates = ranked.filter((c) => worship.has(c.id)).map((c) => ({
      token: ctx.namer.tokenOf(c.id),
      name: ctx.namer.nameOf(c.id),
      available: c.available,
      alreadyAssigned: c.alreadyAssigned,
      undeclared: c.undeclared,
      blocked: c.blockedReason,
      rule: c.ruleBlockedReason,
      load: c.load,
      recent: c.recent,
    }));
  }

  if (!replay.ok) {
    const r = replay.refusal;
    return answer(false, [...notes, E.editRefused(r.index, r.sentence)], {
      ...head,
      board: boardView(board, ctx.namer),
      refusal: refusalView(r, ctx),
      changes: [],
      groups: [],
      ...(candidates ? { candidates } : {}),
    });
  }

  const sets = changeSets(ctx, board, replay.verdicts, options.app);
  if (!sets.ok) {
    return answer(false, [...notes, ...sets.lines], {
      ...head,
      board: boardView(board, ctx.namer),
      refusal: { code: sets.refusal.code, sentence: sets.refusal.sentence },
      changes: [],
      groups: [],
      ...(candidates ? { candidates } : {}),
    });
  }
  const changes = sets.changes;
  const groups = deriveGroups(changes.map((c) => ({ service: c.service, date: c.date, diff: c.diff })));
  const labelOf = new Map(changes.map((c) => [c.service, c.label]));
  const linked = groups.filter((g) => g.length > 1);
  const tooBig = groups.filter((g) => g.length > MAX_GROUP);
  const unconfirmed = changes.flatMap((c) => c.unconfirmed);
  // A focus narrows the per-service lines to its days (the month's rules and fairness stay whole).
  const partial = focusNarrows(board, options.focus);
  const check = options.seat ? null : await runStoredMonthCheck(ctx, board, deps, partial ? options.focus : undefined);

  // What save_service_edits takes, as is (F3) — in the structured answer for the card, and in the
  // text for the model, which never sees `structuredContent`: one line per call, so a group too big
  // for one save comes as one line per signed unit. None when the save would refuse anyway.
  const wire = changes.map((c) => ({ service: c.service, baseRev: c.baseRev, target: c.target, diff: c.diff, mac: c.mac, unit: c.unit, lines: c.lines, ...(c.waivers.length ? { waivers: c.waivers } : {}) }));
  const calls = options.app || !wire.length || unconfirmed.length ? []
    : tooBig.length ? [...Map.groupBy(wire, (c) => c.unit.join(",")).values()]
      : [wire];
  const lines = [
    ...notes,
    ...(changes.length ? [S.checkHead(changes.length, calls.length), ...changes.flatMap((c) => c.lines)] : [S.noChanges]),
    ...linked.map((g) => S.groupNote(g.map((id) => labelOf.get(id)!))),
    ...tooBig.map((g) => S.groupTooBig(g.length, MAX_GROUP)),
    ...(unconfirmed.length ? [S.needsCard, ...unconfirmed] : []),
    ...changes.flatMap((c) => baselineLines(c.judged)),
    ...songLeadLines(ctx, board, partial ? options.focus : undefined),
    ...(check ? [...(partial ? [S.focusHidden] : []), ...monthCheckLines(check, { partial })] : []),
  ];
  for (const part of calls) lines.push(S.saveArgs(JSON.stringify({ month: ctx.month, changes: part })));
  return answer(false, lines, {
    ...head,
    board: boardView(board, ctx.namer),
    verdicts: replay.verdicts.map((v) => ({
      index: v.index,
      op: v.op,
      placed: v.placed.map((p) => ({ service: p.service, row: p.row, member: ctx.namer.tokenOf(p.member), unavailable: p.unavailable })),
      forced: v.forced.length > 0,
    })),
    changes: wire,
    groups,
    ...(tooBig.length ? { maxGroup: MAX_GROUP } : {}),
    ...(unconfirmed.length ? { needsCard: true } : {}),
    ...(check ? { monthCheck: check } : {}),
    ...(candidates ? { candidates } : {}),
  });
}

export async function checkServiceEditsResult(
  args: CheckServiceEditsArgs,
  principal: McpPrincipal | null,
  deps: ServiceEditorDeps = defaultServiceEditorDeps(),
): Promise<CallToolResult> {
  return runWriteTool(
    "check_service_edits",
    async () => {
      const opened = await openMonth(args.month, principal, deps);
      if (!opened.ok) return opened.result;
      if (args.copy) {
        if (args.edits.length) return refusal([S.copy.alone], { code: "invalid_request", detail: "copy_alone" });
        if (args.focus) return refusal([S.focusWithCopy], { code: "invalid_request", detail: "focus" });
        const from = anyServiceOf(opened.ctx, args.copy.from);
        if (!from.ok) return refusal([from.line], { code: "invalid_request", detail: "copy_from" });
        const to = boardServiceOf(opened.ctx, args.copy.to);
        if (!to.ok) return refusal([to.line], { code: "invalid_request", detail: "copy_to" });
        return checkCopy(opened.ctx, { from: from.id, to: to.id }, deps);
      }
      const focus = args.focus ? focusOf(opened.ctx, args.focus) : null;
      if (focus && !focus.ok) return refusal([focus.line], { code: "invalid_request", detail: "focus" });
      // No edits only to open the card (with `focus`, on those dates); otherwise there is nothing to check.
      if (!args.edits.length && !focus) return refusal([S.nothingToCheck], { code: "invalid_request", detail: "empty" });
      const resolved = resolveNameEdits(args.edits, opened.ctx);
      if (!resolved.ok) return refusal(resolved.lines, { code: "invalid_request", detail: "edit" });
      // From the chat nothing is forced: a rule block refuses its edit in the replay.
      return checkMonth(opened.ctx, resolved.edits, deps, { app: false, ...(focus ? { focus: focus.value } : {}) });
    },
    SERVICE_EDITOR_COPY,
  );
}

export async function checkServiceEditsAppResult(
  args: CheckServiceEditsAppArgs,
  principal: McpPrincipal | null,
  deps: ServiceEditorDeps = defaultServiceEditorDeps(),
): Promise<CallToolResult> {
  return runWriteTool(
    "check_service_edits_app",
    async () => {
      const opened = await openMonth(args.month, principal, deps);
      if (!opened.ok) return opened.result;
      const resolved = resolveTokenEdits(args.edits, opened.ctx.tokens);
      if (!resolved.ok) {
        return refusal(resolved.lines, { code: "invalid_request", detail: resolved.refusal?.code ?? "edit", ...(resolved.refusal ? { refusal: refusalView(resolved.refusal, opened.ctx) } : {}) });
      }
      return checkMonth(opened.ctx, resolved.edits, deps, { app: true, seat: args.seat });
    },
    SERVICE_EDITOR_COPY,
  );
}

// ── Copy instruments (S3) ────────────────────────────────────────────────────

interface CopyPlan {
  from: ServiceRole;
  fromLabel: string;
  to: string;
  label: string;
  /** `to` as stored, with its instruments replaced by what `from` stores now: what the commit writes. */
  target: ServiceTarget;
  same: boolean;
}

/** The copy's target state, from THIS read (the commit reads both roles fresh and copies the same). */
function copyPlan(ctx: MonthContext, fromId: string, toId: string): { ok: true; plan: CopyPlan } | { ok: false; sentence: string } {
  const { board } = ctx;
  if (!storedColumn(board, toId)) return { ok: false, sentence: S.judge.unknown_service };
  if (!board.editable.has(toId)) return { ok: false, sentence: S.judge.not_editable };
  if (fromId === toId) return { ok: false, sentence: S.copy.sameService };
  const from = ctx.sources.adminRoles.find((r) => r._id === fromId);
  if (!from) return { ok: false, sentence: S.copy.noSource };
  const source = roleTarget(from as ServiceRole, ctx.todayIso);
  const before = columnTarget(board, toId, ctx.todayIso);
  if (!source) return { ok: false, sentence: S.copy.sourceUnreadable };
  if (!before) return { ok: false, sentence: S.judge.not_editable };
  const target: ServiceTarget = { ...before, instruments: source.target.instruments };
  return {
    ok: true,
    plan: {
      from: from as ServiceRole,
      fromLabel: draftLabel({ _type: from._type, date: from.date.slice(0, 10), service_name: from.service_name }),
      to: toId,
      label: storedLabel(board, toId),
      target,
      same: sameRoleSemantics(targetSnapshot(before), targetSnapshot(target)),
    },
  };
}

async function checkCopy(ctx: MonthContext, copy: { from: string; to: string }, deps: ServiceEditorDeps): Promise<CallToolResult> {
  const head = { ok: true, month: ctx.month, changes: [], groups: [] };
  const built = copyPlan(ctx, copy.from, copy.to);
  if (!built.ok) return refusal([built.sentence], { code: "invalid_request", detail: "copy" });
  const plan = built.plan;
  if (plan.same) return answer(false, [S.copy.nothing(plan.label)], { ...head, board: boardView(ctx.board, ctx.namer), copy: null });
  const verdict = judgeTarget({ board: ctx.board, roleId: plan.to, target: plan.target, members: ctx.members, config: ctx.sources.rules.config, todayIso: ctx.todayIso });
  if (!verdict.ok) {
    return answer(false, [S.refusedAll(plan.label, verdict.refusal.sentence)], {
      ...head,
      board: boardView(ctx.board, ctx.namer),
      refusal: { code: verdict.refusal.code, sentence: verdict.refusal.sentence },
      copy: null,
    });
  }
  const judged = verdict.judged;
  // Nothing is forced on a copy (see COPY_INSTRUMENTS_INPUT): a new finding refuses it.
  const unconfirmed = judged.added.map((f) => E.needsConfirm(f.sentence, findingView(judged.board, f, ctx.namer).where));
  const lines = copyLines({ board: ctx.board, roleId: plan.to, fromLabel: plan.fromLabel, target: plan.target, judged, nameOf: ctx.namer.nameOf });
  const check = await runStoredMonthCheck(ctx, judged.board, deps);
  const args = unconfirmed.length ? null : { month: ctx.month, from: plan.from._id, to: plan.to, lines };
  return answer(false, [
    ...(unconfirmed.length ? [] : [S.copy.checkHead]),
    ...lines,
    ...(unconfirmed.length ? [S.copy.needsCard, ...unconfirmed] : []),
    ...baselineLines(judged),
    ...monthCheckLines(check),
    ...(args ? [S.copy.args(JSON.stringify(args))] : []),
  ], {
    ...head,
    board: boardView(judged.board, ctx.namer),
    // What copy_instruments takes, as is (also the text's last line). None when the chat would be refused anyway.
    copy: args,
    ...(unconfirmed.length ? { needsCard: true } : {}),
    monthCheck: check,
  });
}

export async function copyInstrumentsResult(
  args: CopyInstrumentsArgs,
  principal: McpPrincipal | null,
  deps: ServiceEditorDeps = defaultServiceEditorDeps(),
): Promise<CallToolResult> {
  return runWriteTool(
    "copy_instruments",
    async ({ callDomain }) => {
      const startedAt = deps.nowMs();
      const opened = await openMonth(args.month, principal, deps);
      if (!opened.ok) return opened.result;
      const ctx = opened.ctx;
      const built = copyPlan(ctx, args.from, args.to);
      if (!built.ok) return refusal([built.sentence], { code: "invalid_request", detail: "copy" });
      const plan = built.plan;
      // Sorted first, as a save is (F3): already there → nothing to judge, compare or write.
      if (plan.same) return answer(false, [S.copy.already(plan.label)], { ok: true, month: ctx.month, status: "already" });
      const verdict = judgeTarget({ board: ctx.board, roleId: plan.to, target: plan.target, members: ctx.members, config: ctx.sources.rules.config, todayIso: ctx.todayIso });
      if (!verdict.ok) return refusal([S.refusedAll(plan.label, verdict.refusal.sentence)], { code: "invalid_request", detail: verdict.refusal.code });
      const judged = verdict.judged;
      const baseRev = storedColumn(ctx.board, plan.to)!.rev;
      // F4: the prompt's lines are what this read renders, or nothing is written.
      if (!sameLines(args.lines, copyLines({ board: ctx.board, roleId: plan.to, fromLabel: plan.fromLabel, target: plan.target, judged, nameOf: ctx.namer.nameOf }))) {
        return refusal([S.copy.notTheChecked(plan.label)], { code: "invalid_request", detail: "not_the_checked" });
      }
      if (judged.added.length) {
        const found = judged.added.map((f) => S.waiverMissing(f.sentence, findingView(judged.board, f, ctx.namer).where));
        return refusal([S.copy.needsCard, ...found], { code: "invalid_request", detail: "rule" });
      }

      // The write: `/admin`'s own copy commit, both revisions as THIS call read them.
      let outcome: Awaited<ReturnType<typeof deps.copyInstruments>> | null = null;
      try {
        const raced = await callDomain(() =>
        {
          const write = deps.copyInstruments({ source: { id: plan.from._id, rev: plan.from._rev }, target: { id: plan.to, rev: baseRev } }, { notices: "inline" });
          deps.keepAlive(write);
          return beforeStop(write, SAVE_HARD_STOP_MS - (deps.nowMs() - startedAt));
        });
        if (!raced.late) outcome = raced.value;
      } catch {
        console.error("[mcp-service-editor] copy threw");
      }
      const transport = classifyWrite(outcome);
      if (transport.kind === "knownCommitted" && outcome?.ok) {
        const noticesUnknown = outcome.effects.noticesQueued === false;
        return answer(false, [S.copy.done(plan.fromLabel, plan.label), ...(noticesUnknown ? [S.noticesUnknown] : [])], {
          ok: true,
          month: ctx.month,
          status: noticesUnknown ? "saved_notices_unknown" : "saved",
        });
      }
      if (transport.kind !== "knownFailure") {
        return answer(true, [S.copy.unknown], { ok: false, month: ctx.month, status: "unknown", next: "repeat_same_call" });
      }
      // A proven pre-write refusal: what does the destination hold now?
      let now: { rev: string; target: ServiceTarget } | null | "failed" = "failed";
      try {
        const reread = await beforeStop(deps.rereadRole(plan.to), SAVE_HARD_STOP_MS - (deps.nowMs() - startedAt));
        if (!reread.late) now = reread.value ? roleTarget(reread.value, ctx.todayIso) : null;
      } catch {
        console.error("[mcp-service-editor] re-read failed");
      }
      if (now !== "failed" && now !== null && sameRoleSemantics(targetSnapshot(now.target), targetSnapshot(plan.target))) {
        return answer(false, [S.copy.already(plan.label)], { ok: true, month: ctx.month, status: "already" });
      }
      // A stale SOURCE moves only the source's `_rev`: the destination's unchanged rev still says «repite».
      const fromNow = await beforeStop(deps.rereadRole(plan.from._id), SAVE_HARD_STOP_MS - (deps.nowMs() - startedAt)).catch(() => ({ late: true as const }));
      const sourceMoved = fromNow.late || !fromNow.value || fromNow.value._rev !== plan.from._rev;
      if (transport.code === "stale_revision" && now !== "failed" && now !== null && now.rev === baseRev && !sourceMoved) {
        return answer(true, [S.copy.repeat], { ok: false, month: ctx.month, status: "not_saved", next: "repeat_same_call" });
      }
      return answer(true, [S.copy.recheck(S.reason[transport.code] ?? S.reason.invalid_request)], {
        ok: false,
        month: ctx.month,
        status: "not_saved",
        next: "check_again",
      });
    },
    SERVICE_EDITOR_COPY,
  );
}

// ── The save ─────────────────────────────────────────────────────────────────

/**
 * A write's outcome as the planner classifies a PATCH (`classifyPatchOutcome`). A maintenance reload
 * (the commit bootstrapped a lock and then refused) wrote nothing to the role: a proven refusal.
 */
function classifyWrite(outcome: { status: number; body: unknown } | null): { kind: "knownCommitted" } | { kind: "knownFailure"; code: string } | { kind: "unknown" } {
  if (!outcome) return { kind: "unknown" };
  const t = classifyPatchOutcome({ status: outcome.status, body: outcome.body });
  if (t.kind === "maintenanceReload") return { kind: "knownFailure", code: "bootstrap_completed_reload" };
  if (t.kind === "knownCommitted") return { kind: "knownCommitted" };
  if (t.kind === "knownFailure") return { kind: "knownFailure", code: t.code };
  return { kind: "unknown" };
}

type SaveStatus =
  | { kind: "already" }
  | { kind: "saved"; noticesQueued: boolean | null }
  | { kind: "unknown" }
  | { kind: "pending" }
  | { kind: "notSavedRepeat" }
  | { kind: "notSavedRecheck"; code: string }
  | { kind: "notSavedGroup" };

function statusText(s: SaveStatus): string {
  switch (s.kind) {
    case "already": return S.status.already;
    case "saved": return s.noticesQueued === false ? S.status.savedNoticesUnknown : S.status.saved;
    case "unknown": return S.status.unknown;
    case "pending": return S.status.pending;
    case "notSavedRepeat": return S.status.notSavedRepeat;
    case "notSavedRecheck": return S.status.notSavedRecheck(S.reason[s.code] ?? S.reason.invalid_request);
    case "notSavedGroup": return S.status.notSavedGroup;
  }
}

/** `p`, or `{ late: true }` when the call's hard stop comes first. */
export async function beforeStop<T>(p: Promise<T>, ms: number): Promise<{ late: false; value: T } | { late: true }> {
  if (ms <= 0) return { late: true };
  let timer: ReturnType<typeof setTimeout> | undefined;
  const late = new Promise<{ late: true }>((resolve) => { timer = setTimeout(() => resolve({ late: true }), ms); });
  try {
    return await Promise.race([p.then((value) => ({ late: false as const, value })), late]);
  } finally {
    clearTimeout(timer);
  }
}

interface SortedChange {
  change: Change;
  id: string;
  label: string;
  date: string;
  target: ServiceTarget;
  state: "already" | "changed" | "toSave";
}

export async function saveServiceEditsResult(
  args: SaveServiceEditsArgs,
  principal: McpPrincipal | null,
  deps: ServiceEditorDeps = defaultServiceEditorDeps(),
): Promise<CallToolResult> {
  return runWriteTool(
    "save_service_edits",
    async ({ callDomain }) => {
      const startedAt = deps.nowMs();
      const elapsed = () => deps.nowMs() - startedAt;
      const opened = await openMonth(args.month, principal, deps);
      if (!opened.ok) return opened.result;
      const ctx = opened.ctx;
      const { board } = ctx;
      const notChecked = (label: string) => refusal([S.notTheChecked(label)], { code: "invalid_request", detail: "not_the_checked" });

      // (1) Admission: services of this month, `approved`, each once; (2) the signed change set.
      const seen = new Set<string>();
      const sorted: SortedChange[] = [];
      for (const change of args.changes) {
        const column = storedColumn(board, change.service);
        if (!column || seen.has(change.service)) return refusal([S.judge.unknown_service], { code: "invalid_request", detail: "service" });
        seen.add(change.service);
        const label = storedLabel(board, change.service);
        if (!board.editable.has(change.service)) return refusal([S.refusedAll(label, S.judge.not_editable)], { code: "invalid_request", detail: "not_editable" });
        if (!sameMac(change.mac, changeMac(ctx.key, change))) return notChecked(label);
        const target = idTarget(change.target, ctx.tokens);
        if (!target) return notChecked(label);
        // The PATCH contract, with the STORED date and no `lockRev` (the writer reads the lock fresh).
        const parsed = parseEditRequest({ ...target, rev: change.baseRev });
        if (!parsed.ok || parsed.value.lockRev !== null || target.date !== column.date) {
          return refusal([S.refusedAll(label, S.judge.date_changed)], { code: "invalid_request", detail: "target" });
        }
        const stored = columnTarget(board, change.service, ctx.todayIso);
        if (!stored) return refusal([S.refusedAll(label, S.judge.not_editable)], { code: "invalid_request", detail: "not_editable" });
        const state = sameRoleSemantics(targetSnapshot(stored), targetSnapshot(target)) ? "already" : column.rev !== change.baseRev ? "changed" : "toSave";
        sorted.push({ change, id: change.service, label, date: column.date, target, state });
      }
      // A signed unit must be saved whole: never one half of a move without the other (F3).
      const missingFromUnit = [...new Set(sorted.flatMap((s) => s.change.unit.filter((u) => !seen.has(u))))];
      if (sorted.some((s) => !s.change.unit.includes(s.id)) || missingFromUnit.length) {
        const names = missingFromUnit.map((u) => (storedColumn(board, u) ? storedLabel(board, u) : S.judge.unknown_service));
        return refusal([S.unitIncomplete(names)], { code: "invalid_request", detail: "unit_incomplete" });
      }
      const changed = sorted.filter((s) => s.state === "changed");
      if (changed.length) return refusal([S.changed(changed.map((s) => s.label))], { code: "stale_revision", detail: "changed", services: changed.map((s) => s.id) });
      if (sorted.every((s) => s.state === "already")) {
        return answer(false, [S.noneToSave], { ok: true, month: ctx.month, services: sorted.map((s) => ({ service: s.id, status: "already" })) });
      }

      // Groups over EVERY named service, from the signed diffs (F3).
      const groups = deriveGroups(sorted.map((s) => ({ service: s.id, date: s.date, diff: s.change.diff })));
      const big = groups.find((g) => g.length > MAX_GROUP);
      if (big) return refusal([S.groupTooBig(big.length, MAX_GROUP)], { code: "invalid_request", detail: "group_too_big", maxGroup: MAX_GROUP });

      // (3) Judge every «por guardar» service on the fresh read; any failure refuses all.
      const missing: string[] = [];
      for (const s of sorted.filter((x) => x.state === "toSave")) {
        const verdict = judgeTarget({ board, roleId: s.id, target: s.target, members: ctx.members, config: ctx.sources.rules.config, todayIso: ctx.todayIso });
        if (!verdict.ok) return refusal([S.refusedAll(s.label, verdict.refusal.sentence)], { code: "invalid_request", detail: verdict.refusal.code });
        const judged = verdict.judged;
        const diff = wireDiff(judged.diff, ctx.tokens);
        if (canonicalJson(diff) !== canonicalJson(s.change.diff)) return notChecked(s.label);
        if (!sameLines(s.change.lines, changeLines({ board, roleId: s.id, target: s.target, judged, nameOf: ctx.namer.nameOf }))) return notChecked(s.label);
        const given = new Set(s.change.waivers ?? []);
        for (const f of judged.added) {
          if (!given.has(waiverToken(ctx.key, { service: s.id, baseRev: s.change.baseRev, finding: f.key, sentence: f.sentence }))) {
            missing.push(S.waiverMissing(f.sentence, findingView(judged.board, f, ctx.namer).where));
          }
        }
      }
      if (missing.length) return refusal([S.waiverMissingHead, S.needsCard, ...missing], { code: "invalid_request", detail: "needs_card" });

      // (4) The writes, one service at a time, a group's back to back, in order of earliest date.
      const status = new Map<string, SaveStatus>(sorted.filter((s) => s.state === "already").map((s) => [s.id, { kind: "already" }]));
      const byId = new Map(sorted.map((s) => [s.id, s]));
      let stopped: "unknown" | "group" | null = null;
      let whereLines: string[] = [];
      let repeatAdvised = false;

      for (const group of groups) {
        if (stopped) {
          for (const id of group) if (!status.has(id)) status.set(id, { kind: "pending" });
          continue;
        }
        if (elapsed() >= SAVE_START_CUTOFF_MS) {
          for (const id of group) if (!status.has(id)) status.set(id, { kind: "pending" });
          repeatAdvised = true;
          continue;
        }
        for (const id of group) {
          if (status.has(id)) continue;
          const s = byId.get(id)!;
          const parsed = parseEditRequest({ ...s.target, rev: s.change.baseRev });
          if (!parsed.ok) throw new Error("parse");
          let outcome: Awaited<ReturnType<typeof deps.editRole>> | null = null;
          try {
            const raced = await callDomain(() => {
              const write = deps.editRole(id, parsed.value, { notices: "inline" });
              deps.keepAlive(write);
              return beforeStop(write, SAVE_HARD_STOP_MS - elapsed());
            });
            if (!raced.late) outcome = raced.value;
          } catch {
            console.error("[mcp-service-editor] write threw");
          }
          const transport = classifyWrite(outcome);
          if (transport.kind === "knownCommitted" && outcome?.ok) {
            status.set(id, { kind: "saved", noticesQueued: outcome.effects.noticesQueued });
            continue;
          }
          if (transport.kind !== "knownFailure") {
            status.set(id, { kind: "unknown" });
            stopped = "unknown";
            repeatAdvised = true;
            break;
          }
          // A proven pre-write refusal: what is stored now?
          let now: { rev: string; target: ServiceTarget } | null | "failed" = "failed";
          try {
            const reread = await beforeStop(deps.rereadRole(id), SAVE_HARD_STOP_MS - elapsed());
            if (!reread.late) now = reread.value ? roleTarget(reread.value, ctx.todayIso) : null;
          } catch {
            console.error("[mcp-service-editor] re-read failed");
          }
          let st: SaveStatus;
          if (now !== "failed" && now !== null && sameRoleSemantics(targetSnapshot(now.target), targetSnapshot(s.target))) st = { kind: "already" };
          else if (transport.code === "stale_revision" && now !== "failed" && now !== null && now.rev === s.change.baseRev) st = { kind: "notSavedRepeat" };
          else st = { kind: "notSavedRecheck", code: transport.code };
          status.set(id, st);
          if (st.kind === "already") continue;
          if (st.kind === "notSavedRepeat") repeatAdvised = true;
          // Written = saved by this call, or «ya estaba» (a previous call, or a twin, wrote it).
          const writtenInGroup = group.some((g) => g !== id && (status.get(g)?.kind === "saved" || status.get(g)?.kind === "already"));
          if (group.length > 1 && writtenInGroup) {
            // (5) Half a group is written: stop, and say who is where now.
            stopped = "group";
            let after: EditorBoard = board;
            for (const g of group) {
              const x = status.get(g);
              if (x?.kind === "saved" || x?.kind === "already") after = withTarget(after, g, byId.get(g)!.target) ?? after;
            }
            const groupDiffs = group.map((g) => {
              const t = byId.get(g)!.change.diff;
              const ids = (xs: ReadonlyArray<{ row: string; member: string }>) => xs.map((x) => ({ row: x.row, member: ctx.tokens.idOf(x.member) ?? x.member }));
              return { diff: { removed: ids(t.removed), added: ids(t.added) } };
            });
            whereLines = movedMembers(groupDiffs).map((m) => S.whereNow(ctx.namer.nameOf(m), servicesOf(after, m)));
            break;
          }
          if (group.length > 1) {
            // Nothing of this group is written: none of it is, and the run goes on.
            for (const g of group) if (!status.has(g)) status.set(g, { kind: "notSavedGroup" });
            break;
          }
        }
      }
      for (const s of sorted) if (!status.has(s.id)) status.set(s.id, { kind: "pending" });

      // (6) Every service with its status, and the next step.
      const all = [...status.values()];
      // A service refused because it changed makes a repeat certain to be refused («cambió»): check again.
      if (all.some((x) => x.kind === "notSavedRecheck")) repeatAdvised = false;
      const anyRecheck = all.some((x) => x.kind === "notSavedRecheck" || x.kind === "notSavedGroup");
      const noticesUnknown = all.some((x) => x.kind === "saved" && x.noticesQueued === false);
      const ordered = groups.flat();
      const lines = [
        S.savedHead,
        ...ordered.map((id) => S.line(byId.get(id)!.label, statusText(status.get(id)!))),
        ...(stopped === "group" ? [S.stoppedGroup, ...whereLines] : []),
        ...(noticesUnknown ? [S.noticesUnknown] : []),
        ...(repeatAdvised ? [S.repeatSame] : []),
        ...(anyRecheck ? [S.recheck] : []),
      ];
      const failed = all.some((x) => x.kind !== "saved" && x.kind !== "already");
      return answer(failed, lines, {
        ok: !failed,
        month: ctx.month,
        services: ordered.map((id) => ({ service: id, status: status.get(id)!.kind })),
        ...(repeatAdvised ? { next: "repeat_same_call" } : anyRecheck ? { next: "check_again" } : {}),
      });
    },
    SERVICE_EDITOR_COPY,
  );
}

// ── Registration ─────────────────────────────────────────────────────────────

/** MCP Apps: a tool only the card may call; a host that honours it hides it from the model (ADR-0062 Q1 (1)). */
const APP_ONLY_META = { ui: { resourceUri: PROPOSAL_CARD_TOOL_META.ui.resourceUri, visibility: ["app"] } } as const;

export function registerServiceEditor(server: McpServer): void {
  server.registerTool(
    "check_service_edits",
    {
      title: "Revisar cambios a servicios guardados",
      description: CHECK_SERVICE_EDITS_DESCRIPTION,
      inputSchema: CHECK_SERVICE_EDITS_INPUT,
      annotations: { readOnlyHint: true, openWorldHint: false },
      _meta: PROPOSAL_CARD_TOOL_META,
    },
    async (args, ctx: ServerContext) => checkServiceEditsResult(args, principalOf(ctx)),
  );
  server.registerTool(
    "check_service_edits_app",
    {
      title: "Revisar cambios a servicios guardados (tarjeta)",
      description: "Solo para la tarjeta del mes guardado: revisa una lista de cambios sin guardar nada.",
      inputSchema: CHECK_SERVICE_EDITS_APP_INPUT,
      annotations: { readOnlyHint: true, openWorldHint: false },
      _meta: APP_ONLY_META,
    },
    async (args, ctx: ServerContext) => checkServiceEditsAppResult(args, principalOf(ctx)),
  );
  server.registerTool(
    "save_service_edits",
    {
      title: "Guardar cambios a servicios",
      description: SAVE_SERVICE_EDITS_DESCRIPTION,
      inputSchema: SAVE_SERVICE_EDITS_INPUT,
      // A repeat of the same call is safe (written services answer «ya estaba»), but every write declares
      // `idempotentHint: false`, as the four P3 writes and apply_schedule do (I14).
      annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: false },
    },
    async (args, ctx: ServerContext) => saveServiceEditsResult(args, principalOf(ctx)),
  );
  server.registerTool(
    "copy_instruments",
    {
      title: "Copiar instrumentos",
      description: COPY_INSTRUMENTS_DESCRIPTION,
      inputSchema: COPY_INSTRUMENTS_INPUT,
      annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: false },
    },
    async (args, ctx: ServerContext) => copyInstrumentsResult(args, principalOf(ctx)),
  );
}
