// The MCP proposal editor's three tools (docs/superpowers/plans/2026-10-21-owt-mcp-proposal-editor.md,
// T2.5), one implementation behind three entries:
//
//   check_proposal_edits  app-only, read-only: replay the screen's edits and answer the board,
//                         each edit's verdict, the per-seat rule findings, the month check (E6)
//                         and, for one seat, its candidates in the planner's order. Stores nothing.
//   save_proposal_edits   app-only: the same, then store the result as a NEW revision (E2) in one
//                         transaction with the base's `supersededBy` (T2.2). Its edits may carry
//                         `force` (Q1-A) with `confirms`, the finding keys the screen showed Frank.
//   revise_proposal       model-visible: the same save for edits asked for in the chat, people by
//                         name, and NO `force` field — from the chat a rule block is refused.
//
// E1: the server judges every edit; the screen holds a list of edits and never a board this trusts.
// Every call replays the whole list from the stored proposal through the planner's own gates
// (`revise.ts`), against CURRENT members (a fresh pool read) and the proposal's BOUND rules.
// Neither save is destructive: each writes only a private record, like `solve_month` (I14).
//
// LOGGING: the timing line and fixed tags only — never an id, a name, a token or a rule key.

import "server-only";

import type { CallToolResult, McpServer, ServerContext } from "@modelcontextprotocol/server";
import { z } from "zod";

import { normalizeMinistries } from "@/app/ministries";
import { normalizeText } from "@/app/utils/normalizeText";
import { serviceTodayIso } from "@/app/components/admin/serviceReadiness";
import { V3_CONNECTOR_LINES as L, V3_EDITOR_LINES as E } from "@/app/components/admin/v3Copy";
import { cellsToParticipantRoles } from "@/app/components/admin/plannerModel";
import { v3Names } from "@/app/components/admin/v3RunReport";
import { savedWindowFor } from "@/app/components/admin/plannerMonth";
import { fairnessRecordEnvironment, resolveSolverEngine } from "@/app/utils/solverDeployment";
import { loadFairnessLedgerWith } from "@/app/utils/fairnessLedgerRead";
import { shiftMonth, type FairnessLedgerResponse, type RecordEnvironment } from "@/app/utils/fairnessVocabulary";
import { newCreationRequestId } from "@/app/utils/monthDraftCreate";
import { loadV3Ledger, loadV3PlanSources, type V3PlanSources } from "@/app/utils/v3MonthPlanReads";
import { runWriteTool, type CallDomain, type WriteFailureCopy } from "../writes/runWriteTool";
import { isProposalHandle, newProposalHandle } from "../monthProposals/handle";
import {
  PROPOSAL_MAX_REVISION,
  admitsProposal,
  buildProposal,
  type FindingKey,
  type StoredProposal,
  type Waiver,
} from "../monthProposals/proposalDocument";
import { loadProposal, saveRevision, sweepExpired } from "../monthProposals/proposalStore";
import { observeProposal, phase3Refusals } from "../monthProposals/observe";
import { principalOf, type McpPrincipal } from "../monthProposals/principal";
import { memberTokenKey, memberTokens, type MemberTokenKey, type MemberTokens } from "../monthProposals/memberTokens";
import { boardFindings, childDrafts, proposalBoard, serverPickCandidates, type EditorBoard, type Finding } from "../monthProposals/editorBoard";
import { NOT_ELIGIBLE_SENTENCE, replayEdits, seatedIds, type EditorEdit, type EditorMember, type ReplayRefusal, type SeatRef } from "../monthProposals/revise";
import { confirmVerdict, everyFindingExplained, judgeBoard, type BoardJudgement } from "../monthProposals/waivers";
import { fairShareAdjust, monthCheck, monthCheckLines, type FairShareLedger, type MonthCheck } from "../monthProposals/monthCheck";
import { boardView, findingView, waiverItems, whereOf, type Namer } from "../monthProposals/editorView";
import { PROPOSAL_CARD_TOOL_META } from "../apps/proposalCard";

/** No sweep once this much of a save has passed (D12). */
export const EDITOR_SWEEP_DEADLINE_MS = 45_000;

// ── Wire schemas ─────────────────────────────────────────────────────────────

const HANDLE = z.string().max(64);
const SERVICE = z.string().max(64);
const ROW = z.string().max(80);
const TOKEN = z.string().max(32);
const SEAT = z.object({ service: SERVICE, row: ROW, member: TOKEN }).strict();
const TOKEN_EDIT = z.discriminatedUnion("op", [
  z.object({ op: z.literal("place"), service: SERVICE, row: ROW, member: TOKEN, force: z.boolean().optional() }).strict(),
  z.object({ op: z.literal("move"), from: SEAT, to: z.object({ service: SERVICE, row: ROW }).strict(), force: z.boolean().optional() }).strict(),
  z.object({ op: z.literal("clear"), service: SERVICE, row: ROW, member: TOKEN }).strict(),
  z.object({ op: z.literal("exchange"), a: SEAT, b: SEAT, force: z.boolean().optional() }).strict(),
]);
const KEY = z
  .object({
    kind: z.enum(["exclusion", "week_exclusion", "pair"]),
    rule: z.string().max(40),
    service: SERVICE,
    row: ROW.nullable(),
    members: z.array(TOKEN).min(1).max(2),
  })
  .strict();

export const CHECK_PROPOSAL_EDITS_INPUT = z
  .object({
    proposal: HANDLE,
    edits: z.array(TOKEN_EDIT).max(200),
    /** A seat whose candidates to list; a call with it skips the month check (E6). */
    seat: z.object({ service: SERVICE, row: ROW }).strict().optional(),
  })
  .strict();

export const SAVE_PROPOSAL_EDITS_INPUT = z
  .object({
    proposal: HANDLE,
    edits: z.array(TOKEN_EDIT).max(200),
    confirms: z.array(KEY).max(400).optional(),
    saveId: z.string().regex(/^[A-Za-z0-9_-]{8,64}$/),
  })
  .strict();

const DAY = /^\d{4}-\d{2}-\d{2}$/;
const NAME = z.string().min(1).max(80);
const NAME_SEAT = z.object({ service: z.string().regex(DAY), seat: NAME, member: NAME }).strict();
/** The chat's edits: services by date, seats by their label, people by name — and never `force`. */
const NAME_EDIT = z.discriminatedUnion("op", [
  z.object({ op: z.literal("place"), service: z.string().regex(DAY), seat: NAME, member: NAME }).strict(),
  z.object({ op: z.literal("move"), from: NAME_SEAT, to: z.object({ service: z.string().regex(DAY), seat: NAME }).strict() }).strict(),
  z.object({ op: z.literal("clear"), service: z.string().regex(DAY), seat: NAME, member: NAME }).strict(),
  z.object({ op: z.literal("exchange"), a: NAME_SEAT, b: NAME_SEAT }).strict(),
]);

export const REVISE_PROPOSAL_INPUT = z.object({ proposal: HANDLE, edits: z.array(NAME_EDIT).min(1).max(200) }).strict();

export type CheckProposalEditsArgs = z.infer<typeof CHECK_PROPOSAL_EDITS_INPUT>;
export type SaveProposalEditsArgs = z.infer<typeof SAVE_PROPOSAL_EDITS_INPUT>;
export type ReviseProposalArgs = z.infer<typeof REVISE_PROPOSAL_INPUT>;
type TokenEdit = z.infer<typeof TOKEN_EDIT>;
type NameEdit = z.infer<typeof NAME_EDIT>;

export const EDITOR_COPY: WriteFailureCopy = {
  pre: "No se pudo revisar la propuesta; vuelve a intentarlo. No se guardó nada.",
  domain: "No pude confirmar si la versión se guardó. Volver a intentarlo es seguro: si quedó, se reconoce.",
};

export const REVISE_PROPOSAL_DESCRIPTION =
  "Cambia a mano los lugares de una propuesta de solve_month y la guarda como una versión nueva (no crea " +
  "servicios ni avisa a nadie; para crearlos, llama apply_schedule con la versión nueva). proposal es el " +
  "identificador de la propuesta; edits es la lista de cambios, en orden: place (poner a alguien en un lugar), " +
  "clear (quitarlo), move (pasarlo a otro lugar) y exchange (intercambiar a dos personas). Cada servicio se nombra " +
  "por su fecha (YYYY-MM-DD), cada lugar por su nombre en el planificador (Lead, BGV, Coro, un instrumento o la " +
  "consola) y cada persona por su nombre. Cada cambio pasa por las mismas reglas que /admin: si uno rompe una regla " +
  "de lugar (una exclusión o dos personas que no van juntas), se rechaza y no se guarda nada; forzarlo solo se puede " +
  "desde la tarjeta de la propuesta. La respuesta dice qué no cuadra con las reglas del mes, qué lugares quedaron " +
  "vacíos y cómo queda la equidad, y repite lo que se asignó de todos modos en versiones anteriores.";

// ── Deps ─────────────────────────────────────────────────────────────────────

export interface EditorDeps {
  engine: () => string;
  loadProposal: typeof loadProposal;
  reads: typeof loadV3PlanSources;
  readLedger: (months: readonly string[]) => Promise<FairnessLedgerResponse>;
  readFairShare: typeof loadFairnessLedgerWith;
  saveRevision: typeof saveRevision;
  sweepExpired: typeof sweepExpired;
  tokenKey: () => MemberTokenKey;
  environment: () => RecordEnvironment;
  nowMs: () => number;
  todayIso: () => string;
  newHandle: () => string;
  mintRequestId: () => string;
}

export function defaultEditorDeps(): EditorDeps {
  return {
    engine: () => resolveSolverEngine(process.env),
    loadProposal,
    reads: loadV3PlanSources,
    readLedger: loadV3Ledger,
    readFairShare: loadFairnessLedgerWith,
    saveRevision,
    sweepExpired,
    tokenKey: () => memberTokenKey(process.env),
    environment: () => fairnessRecordEnvironment(process.env),
    nowMs: () => Date.now(),
    todayIso: serviceTodayIso,
    newHandle: newProposalHandle,
    mintRequestId: newCreationRequestId,
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
const notFound = () => refusal([L.proposalNotFound], { code: "not_found", detail: "proposal" });

// ── Opening a proposal (shared by the three tools) ───────────────────────────

interface EditorContext {
  principal: McpPrincipal;
  handle: string;
  proposal: StoredProposal;
  root: string;
  revision: number;
  sources: V3PlanSources;
  board: EditorBoard;
  members: EditorMember[];
  tokens: MemberTokens;
  namer: Namer;
}

const displayName = (m: { alias?: string; member_name: string }) => m.alias?.trim() || m.member_name;
const isWorship = (m: EditorMember) => normalizeMinistries(m.ministries).includes("worship");

async function openProposal(
  handle: string,
  principal: McpPrincipal | null,
  deps: EditorDeps,
): Promise<{ ok: true; ctx: EditorContext } | { ok: false; result: CallToolResult }> {
  const fail = (result: CallToolResult) => ({ ok: false as const, result });
  if (!principal) return fail(refusal([L.noPrincipal], { code: "forbidden", detail: "no_principal" }));
  if (deps.engine() !== "v3") return fail(refusal([L.engineNotV3], { code: "integrity_conflict", detail: "engine_not_v3" }));
  if (!isProposalHandle(handle)) return fail(notFound());
  const loaded = await deps.loadProposal(handle);
  if (!loaded.ok) {
    if (loaded.reason === "not_found") return fail(notFound());
    console.error("[mcp-editor] proposal read failed");
    return fail(refusal([L.proposalReadFailed], { code: "read_failed", retry: true }));
  }
  const proposal = loaded.proposal;
  // D10: nothing with a name before admission.
  if (!admitsProposal(proposal, { origin: principal.origin, principal: principal.sub, nowMs: deps.nowMs() })) return fail(notFound());
  const key = deps.tokenKey();
  if (!key.ok) {
    console.error("[mcp-editor] member token secret unavailable");
    return fail(refusal([E.noSecret], { code: "integrity_conflict", detail: "no_secret" }));
  }
  const read = await deps.reads();
  if (!read.ok) return fail(refusal([L.sources(read.failed)], { code: "integrity_conflict", detail: "sources", retry: true }));
  const sources = read.value;
  const states = sources.snapshot.readiness.sources;
  const unready = (Object.keys(states) as (keyof typeof states)[]).filter((k) => states[k] !== "ready");
  if (unready.length) return fail(refusal([L.sources(unready)], { code: "integrity_conflict", detail: "sources", retry: true }));
  // R12: the proposal's BOUND rules, as apply checks them.
  if (sources.rules.rev !== proposal.header.rulesRev) {
    return fail(refusal([L.rulesChanged], { code: "stale_revision", detail: "rules_changed", next: "solve_month" }));
  }
  const board = proposalBoard(proposal.payload.drafts);
  if (!board) {
    console.error("[mcp-editor] proposal board unreadable");
    return fail(refusal([E.replay.server_error], { code: "server_error" }));
  }
  const members = sources.members as EditorMember[];
  const root = proposal.header.lineage?.root ?? handle;
  const tokens = memberTokens(key.key, root, [...members.map((m) => m._id), ...seatedIds(board.cells)]);
  const byId = new Map(members.map((m) => [m._id, m]));
  const person = v3Names({ members, serviceLabels: new Map(), ruleLabels: new Map() }).person;
  const namer: Namer = {
    tokenOf: (id) => tokens.tokenOf(id),
    nameOf: person,
    unavailableOn: (id, date) => (byId.get(id)?.unavailableDates ?? []).includes(date),
  };
  return {
    ok: true,
    ctx: { principal, handle, proposal, root, revision: proposal.header.lineage?.revision ?? 1, sources, board, members, tokens, namer },
  };
}

/** E3 (b), (c): a base that started applying, or that apply would refuse today. */
function e3Refusal(ctx: EditorContext): CallToolResult | null {
  const obs = observeProposal(ctx.proposal, ctx.sources.snapshot.roles);
  if (obs.created.size > 0) return refusal([E.startedApplying], { code: "stale_revision", detail: "started_applying" });
  const lost = phase3Refusals(ctx.proposal, obs, ctx.sources);
  if (lost.length) return refusal([E.mustResolve, ...lost], { code: "stale_revision", detail: "target_lost", next: "solve_month" });
  return null;
}

const supersededRefusal = (by: string) =>
  refusal([E.superseded(by)], { code: "stale_revision", detail: "superseded", successor: by });

// ── Token edits ──────────────────────────────────────────────────────────────

type Resolved = { ok: true; edits: EditorEdit[] } | { ok: false; refusal: ReplayRefusal };

function resolveTokenEdits(edits: readonly TokenEdit[], tokens: MemberTokens): Resolved {
  const out: EditorEdit[] = [];
  for (let index = 0; index < edits.length; index++) {
    const e = edits[index];
    const id = (t: string) => tokens.idOf(t);
    const seat = (s: { service: string; row: string; member: string }): SeatRef | null => {
      const m = id(s.member);
      return m ? { service: s.service, row: s.row, member: m } : null;
    };
    let edit: EditorEdit | null = null;
    if (e.op === "place" || e.op === "clear") {
      const m = id(e.member);
      if (m) edit = e.op === "place" ? { op: "place", service: e.service, row: e.row, member: m, force: e.force } : { op: "clear", service: e.service, row: e.row, member: m };
    } else if (e.op === "move") {
      const from = seat(e.from);
      if (from) edit = { op: "move", from, to: e.to, force: e.force };
    } else {
      const a = seat(e.a);
      const b = seat(e.b);
      if (a && b) edit = { op: "exchange", a, b, force: e.force };
    }
    if (!edit) return { ok: false, refusal: { index, code: "member_not_eligible", sentence: NOT_ELIGIBLE_SENTENCE } };
    out.push(edit);
  }
  return { ok: true, edits: out };
}

function resolveKeys(keys: ReadonlyArray<z.infer<typeof KEY>>, tokens: MemberTokens): FindingKey[] | null {
  const out: FindingKey[] = [];
  for (const k of keys) {
    const members = k.members.map((t) => tokens.idOf(t));
    if (members.some((m) => m === null)) return null;
    const ids = members as string[];
    out.push({ kind: k.kind, rule: k.rule, service: k.service, row: k.row, members: k.kind === "pair" ? [...ids].sort() : ids });
  }
  return out;
}

// ── Name edits (revise_proposal) ─────────────────────────────────────────────

const fold = (s: string) => normalizeText(s.normalize("NFC").trim().replace(/\s+/g, " "));

function resolveNameEdits(edits: readonly NameEdit[], ctx: EditorContext): Resolved | { ok: false; lines: string[] } {
  const { board } = ctx;
  // I5: the people a name may mean are the worship audience plus whoever sits on the board.
  const seated = new Set(seatedIds(board.cells));
  const audience = ctx.members.filter((m) => isWorship(m) || seated.has(m._id));
  const serviceOf = (date: string) => {
    const column = board.columns.find((c) => c.date === date);
    return column ? board.localIdOf.get(column.columnId)! : null;
  };
  const rowOf = (label: string) => board.rows.find((r) => fold(r.label) === fold(label) || fold(r.id) === fold(label))?.id ?? null;
  const memberOf = (name: string): { ok: true; id: string } | { ok: false; line: string } => {
    const want = fold(name);
    const exact = audience.filter((m) => fold(displayName(m)) === want || fold(m.member_name) === want);
    if (exact.length === 1) return { ok: true, id: exact[0]._id };
    const options = (exact.length ? exact : audience.filter((m) => fold(displayName(m)).includes(want) || fold(m.member_name).includes(want)))
      .map(displayName);
    return { ok: false, line: E.ambiguousName(name, [...new Set(options)].slice(0, 8)) };
  };
  const out: EditorEdit[] = [];
  for (let index = 0; index < edits.length; index++) {
    const e = edits[index];
    const seatOf = (s: { service: string; seat: string; member?: string }) => {
      const service = serviceOf(s.service);
      const row = rowOf(s.seat);
      if (!service) return { ok: false as const, line: E.editRefused(index, E.replay.unknown_service) };
      if (!row) return { ok: false as const, line: E.editRefused(index, E.unknownSeat(s.seat)) };
      if (s.member === undefined) return { ok: true as const, service, row, member: "" };
      const m = memberOf(s.member);
      return m.ok ? { ok: true as const, service, row, member: m.id } : { ok: false as const, line: E.editRefused(index, m.line) };
    };
    if (e.op === "place" || e.op === "clear") {
      const s = seatOf(e);
      if (!s.ok) return { ok: false, lines: [s.line] };
      out.push({ op: e.op, service: s.service, row: s.row, member: s.member });
    } else if (e.op === "move") {
      const from = seatOf(e.from);
      if (!from.ok) return { ok: false, lines: [from.line] };
      const to = seatOf(e.to);
      if (!to.ok) return { ok: false, lines: [to.line] };
      out.push({ op: "move", from: { service: from.service, row: from.row, member: from.member }, to: { service: to.service, row: to.row } });
    } else {
      const a = seatOf(e.a);
      if (!a.ok) return { ok: false, lines: [a.line] };
      const b = seatOf(e.b);
      if (!b.ok) return { ok: false, lines: [b.line] };
      out.push({ op: "exchange", a: { service: a.service, row: a.row, member: a.member }, b: { service: b.service, row: b.row, member: b.member } });
    }
  }
  return { ok: true, edits: out };
}

// ── The shared judgement ─────────────────────────────────────────────────────

interface Judged {
  board: EditorBoard;
  verdicts: ReturnType<typeof replayEdits>["verdicts"];
  judgement: BoardJudgement;
  baseFindings: Finding[];
}

type JudgeOutcome = { ok: true; judged: Judged } | { ok: false; refusal: ReplayRefusal; board: EditorBoard };

function judge(ctx: EditorContext, edits: readonly EditorEdit[]): JudgeOutcome | { ok: false; serverError: true } {
  const config = ctx.sources.rules.config;
  const replay = replayEdits({ board: ctx.board, edits, members: ctx.members, config });
  if (!replay.ok) return { ok: false, refusal: replay.refusal, board: replay.board };
  const baseFindings = boardFindings(ctx.board, ctx.members, config);
  const findings = boardFindings(replay.board, ctx.members, config);
  if (!baseFindings || !findings) return { ok: false, serverError: true };
  const payload = ctx.proposal.payload;
  const judgement = judgeBoard({
    board: replay.board,
    findings,
    baseFindings,
    baseline: payload.v === 2 ? payload.baseline : null,
    inherited: payload.v === 2 ? payload.waivers : [],
    forced: replay.verdicts.flatMap((v) => v.forced),
  });
  return { ok: true, judged: { board: replay.board, verdicts: replay.verdicts, judgement, baseFindings } };
}

/** The month check over a judged board, with its two ledger reads (E6, E7). */
async function runMonthCheck(ctx: EditorContext, board: EditorBoard, deps: EditorDeps): Promise<MonthCheck> {
  const months = ctx.proposal.header.months;
  const entries = ctx.proposal.payload.entries;
  const after = shiftMonth(months[months.length - 1], 1);
  const [ledger, fairShare] = await Promise.all([
    deps.readLedger(months).catch(() => null),
    deps.readFairShare({
      target: after,
      recordsThrough: months[months.length - 1],
      adjust: fairShareAdjust({ months, entries, board, environment: deps.environment(), nameOf: ctx.namer.nameOf }),
    }).catch(() => null as FairShareLedger | null),
  ]);
  if (!ledger || !fairShare) console.error("[mcp-editor] ledger read failed");
  const [year, month] = months[0].split("-").map(Number);
  return monthCheck({
    months,
    currentMonth: deps.todayIso().slice(0, 7),
    entries,
    board,
    config: ctx.sources.rules.config,
    members: ctx.members,
    storedRoles: ctx.sources.adminRoles,
    savedWindow: savedWindowFor(year, month, ctx.sources.adminRoles),
    ledger,
    fairShare,
  });
}

function seatRuleLines(board: EditorBoard, j: BoardJudgement): string[] {
  const w = (f: { key: FindingKey; sentence: string }) => [f.sentence, whereOf(board, f.key)] as const;
  const active = j.waivers.filter((x) => !j.dormant.some((d) => sameKey(d.key, x.key)));
  return [
    ...active.map((x) => E.waived(...w(x))),
    ...j.dormant.map((x) => E.dormant(...w(x))),
    ...j.dropped.map((x) => E.dropped(...w(x))),
    ...j.solver.map((x) => E.solverWarning(...w(x))),
    ...j.appeared.map((x) => E.appeared(...w(x))),
  ];
}

const sameKey = (a: FindingKey, b: FindingKey) => JSON.stringify(a) === JSON.stringify(b);

function judgementView(board: EditorBoard, j: BoardJudgement, namer: Namer) {
  const view = (f: Finding | Waiver) => findingView(board, f, namer);
  return {
    waivers: j.waivers.map(view),
    dormant: j.dormant.map(view),
    dropped: j.dropped.map(view),
    solver: j.solver.map(view),
    appeared: j.appeared.map(view),
    diff: j.diff.map(view),
  };
}

function refusalView(r: ReplayRefusal, ctx: EditorContext) {
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

// ── check_proposal_edits ─────────────────────────────────────────────────────

export async function checkProposalEditsResult(
  args: CheckProposalEditsArgs,
  principal: McpPrincipal | null,
  deps: EditorDeps = defaultEditorDeps(),
): Promise<CallToolResult> {
  return runWriteTool(
    "check_proposal_edits",
    async () => {
      const opened = await openProposal(args.proposal, principal, deps);
      if (!opened.ok) return opened.result;
      const ctx = opened.ctx;
      const by = ctx.proposal.state.supersededBy;
      if (by) return supersededRefusal(by);
      const e3 = e3Refusal(ctx);
      if (e3) return e3;

      const head = { proposal: ctx.handle, revision: ctx.revision, expiresAt: ctx.proposal.header.expiresAt };
      const resolved = resolveTokenEdits(args.edits, ctx.tokens);
      const edits = resolved.ok ? resolved.edits : [];
      const outcome = resolved.ok ? judge(ctx, edits) : ({ ok: false, refusal: resolved.refusal, board: ctx.board } as const);
      if (!outcome.ok && "serverError" in outcome) return refusal([E.replay.server_error], { code: "server_error" });

      let board: EditorBoard;
      let judged: Judged | null = null;
      let refused: ReplayRefusal | null = null;
      let prompt: { diff: ReturnType<typeof judgementView>["diff"] } | null = null;
      if (outcome.ok) {
        judged = outcome.judged;
        board = judged.board;
      } else {
        refused = outcome.refusal;
        board = outcome.board;
        // The last edit asks «¿Asignar de todos modos?»: answer what forcing it would confirm.
        if (refused.code === "hard_rule" && refused.index === edits.length - 1) {
          const forcedEdits = edits.map((e, i) => (i === refused!.index && e.op !== "clear" ? { ...e, force: true } : e));
          const forced = judge(ctx, forcedEdits);
          if (forced.ok) prompt = { diff: judgementView(forced.judged.board, forced.judged.judgement, ctx.namer).diff };
        }
      }

      let candidates: unknown[] | undefined;
      if (args.seat) {
        const columnId = board.columnIdOf.get(args.seat.service);
        const ranked = columnId
          ? serverPickCandidates({
              board,
              columnId,
              rowId: args.seat.row,
              members: ctx.members,
              config: ctx.sources.rules.config,
              windowRoles: [
                ...savedWindowFor(Number(ctx.proposal.header.months[0].slice(0, 4)), Number(ctx.proposal.header.months[0].slice(5, 7)), ctx.sources.adminRoles),
                ...cellsToParticipantRoles(board.cells, board.columns, ctx.members),
              ],
            })
          : null;
        if (!ranked) return refusal([E.replay.unknown_service], { code: "invalid_request", detail: "seat" });
        // I5: candidates from the worship audience only; the gate still judges by id against the pool.
        const worship = new Set(ctx.members.filter(isWorship).map((m) => m._id));
        candidates = ranked.filter((c) => worship.has(c.id)).map((c) => ({
          token: ctx.namer.tokenOf(c.id),
          name: c.name,
          available: c.available,
          alreadyAssigned: c.alreadyAssigned,
          undeclared: c.undeclared,
          blocked: c.blockedReason,
          rule: c.ruleBlockedReason,
          load: c.load,
          recent: c.recent,
        }));
      }

      const check = args.seat || !judged ? null : await runMonthCheck(ctx, board, deps);
      const lines = [
        ...(refused ? [E.editRefused(refused.index, refused.sentence)] : []),
        ...(judged && judged.judgement.diff.length ? [E.confirmFirst, ...judged.judgement.diff.map((f) => E.needsConfirm(f.sentence, whereOf(board, f.key)))] : []),
        ...(judged ? seatRuleLines(board, judged.judgement) : []),
        ...(check ? monthCheckLines(check) : []),
      ];
      return answer(false, lines.length ? lines : [E.allClear], {
        ok: true,
        ...head,
        board: boardView(board, ctx.namer),
        verdicts: (judged?.verdicts ?? []).map((v) => ({
          index: v.index,
          op: v.op,
          placed: v.placed.map((p) => ({ service: p.service, row: p.row, member: ctx.namer.tokenOf(p.member), unavailable: p.unavailable })),
          forced: v.forced.length > 0,
        })),
        ...(refused ? { refusal: refusalView(refused, ctx) } : {}),
        ...(prompt ? { prompt } : {}),
        ...(judged ? { rules: judgementView(board, judged.judgement, ctx.namer) } : {}),
        ...(check ? { monthCheck: check } : {}),
        ...(candidates ? { candidates } : {}),
      });
    },
    EDITOR_COPY,
  );
}

// ── The save (save_proposal_edits, revise_proposal) ─────────────────────────

async function saveEdits(
  ctx: EditorContext,
  edits: readonly EditorEdit[],
  confirms: FindingKey[] | null,
  saveId: string,
  deps: EditorDeps,
  callDomain: CallDomain,
  startedAt: number,
): Promise<CallToolResult> {
  const { proposal, handle } = ctx;

  // Lost answer: a retry whose base is superseded by ITS OWN child is that child's success.
  const by = proposal.state.supersededBy;
  if (by) {
    const child = await deps.loadProposal(by);
    if (child.ok && child.proposal.payload.v === 2 && child.proposal.payload.saveId === saveId && child.proposal.header.lineage?.parent === handle) {
      const rev = child.proposal.header.lineage.revision;
      return answer(false, [E.saved(by, rev), ...(child.proposal.payload.checked ? [] : [E.savedUnchecked])], {
        ok: true, proposal: by, revision: rev, expiresAt: child.proposal.header.expiresAt, checked: child.proposal.payload.checked, replayed: true,
      });
    }
    return supersededRefusal(by);
  }
  if (ctx.revision >= PROPOSAL_MAX_REVISION) return refusal([E.revisionLimit], { code: "invalid_request", detail: "revision_limit", next: "solve_month" });
  const e3 = e3Refusal(ctx);
  if (e3) return e3;

  const outcome = judge(ctx, edits);
  if (!outcome.ok) {
    if ("serverError" in outcome) return refusal([E.replay.server_error], { code: "server_error" });
    return refusal([E.editRefused(outcome.refusal.index, outcome.refusal.sentence)], {
      code: "invalid_request", detail: outcome.refusal.code, refusal: refusalView(outcome.refusal, ctx),
    });
  }
  const { board, judgement } = outcome.judged;
  const cv = confirmVerdict(judgement.diff, confirms);
  if (cv.kind !== "ok") {
    const diff = cv.diff.map((f) => findingView(board, f, ctx.namer));
    return refusal([cv.kind === "stale" ? E.staleCheck : E.confirmFirst, ...cv.diff.map((f) => E.needsConfirm(f.sentence, whereOf(board, f.key)))], {
      code: "invalid_request", detail: cv.kind === "stale" ? "stale_check" : "needs_confirmation", diff,
    });
  }
  if (!everyFindingExplained(judgement, outcome.judged.baseFindings)) {
    console.error("[mcp-editor] safety net refused a save");
    return refusal([E.replay.judge_disagreement], { code: "server_error" });
  }

  const check = await runMonthCheck(ctx, board, deps);
  const newHandle = deps.newHandle();
  const revision = ctx.revision + 1;
  const built = buildProposal({
    handle: newHandle,
    origin: proposal.header.origin,
    principal: proposal.header.principal,
    nowMs: deps.nowMs(),
    rulesRev: proposal.header.rulesRev,
    months: proposal.header.months,
    requestId: deps.mintRequestId(),
    payload: {
      entries: proposal.payload.entries,
      drafts: childDrafts(proposal.payload.drafts, board, deps.mintRequestId),
      storedServiceIds: proposal.payload.storedServiceIds,
    },
    revision: {
      lineage: { parent: handle, revision, root: ctx.root },
      expiresAt: proposal.header.expiresAt,
      waivers: judgement.waivers,
      baseline: judgement.baseline,
      checked: check.checked,
      saveId,
    },
  });
  if (!built.ok) {
    console.error("[mcp-editor] revision build failed");
    return refusal([E.saveFailed], { code: "server_error" });
  }

  // E3 (b) again from a fresh roles read: the month check in between took time.
  const fresh = await deps.reads();
  if (!fresh.ok) return refusal([L.sources(fresh.failed), E.saveFailed], { code: "integrity_conflict", detail: "sources", retry: true });
  if (observeProposal(proposal, fresh.value.snapshot.roles).created.size > 0) {
    return refusal([E.startedApplying], { code: "stale_revision", detail: "started_applying" });
  }
  const saved = await callDomain(() =>
    deps.saveRevision(proposal, built.doc, async (base) => {
      const again = await deps.reads();
      if (!again.ok) throw new Error("reads");
      return observeProposal(base, again.value.snapshot.roles).created.size > 0 ? "started_applying" : null;
    }));
  if (!saved.ok) {
    if (saved.reason === "superseded") return supersededRefusal(saved.by);
    if (saved.reason === "refused") return refusal([E.startedApplying], { code: "stale_revision", detail: "started_applying" });
    if (saved.reason === "gone") return notFound();
    console.error("[mcp-editor] revision save failed:", saved.reason);
    return refusal([saved.reason === "conflict" ? E.saveConflict : E.saveFailed], { code: saved.reason === "conflict" ? "conflict" : "server_error", retry: true });
  }
  if (deps.nowMs() - startedAt < EDITOR_SWEEP_DEADLINE_MS) {
    const swept = await deps.sweepExpired(deps.nowMs());
    if (!swept.ok) console.error("[mcp-editor] proposal sweep failed");
  }

  const childBoard = { ...board };
  const lines = [
    E.saved(newHandle, revision),
    ...(check.checked ? [] : [E.savedUnchecked]),
    ...(judgement.waivers.length ? [E.forceNotice] : []),
    ...seatRuleLines(childBoard, judgement),
    ...monthCheckLines(check),
  ];
  return answer(false, lines, {
    ok: true,
    proposal: newHandle,
    revision,
    expiresAt: proposal.header.expiresAt,
    checked: check.checked,
    board: boardView(childBoard, ctx.namer),
    rules: judgementView(childBoard, judgement, ctx.namer),
    monthCheck: check,
    // What apply_schedule's `waivers` must repeat (Q1): live names, the bound sentence.
    waivers: waiverItems(childBoard, judgement.waivers, ctx.namer.nameOf),
  });
}

/** One waiver as `apply_schedule` asks for it back: the service and the people by name, the rule's sentence verbatim. */
export async function saveProposalEditsResult(
  args: SaveProposalEditsArgs,
  principal: McpPrincipal | null,
  deps: EditorDeps = defaultEditorDeps(),
): Promise<CallToolResult> {
  return runWriteTool(
    "save_proposal_edits",
    async ({ callDomain }) => {
      const startedAt = deps.nowMs();
      const opened = await openProposal(args.proposal, principal, deps);
      if (!opened.ok) return opened.result;
      const ctx = opened.ctx;
      const resolved = resolveTokenEdits(args.edits, ctx.tokens);
      if (!resolved.ok) {
        return refusal([E.editRefused(resolved.refusal.index, resolved.refusal.sentence)], {
          code: "invalid_request", detail: resolved.refusal.code, refusal: refusalView(resolved.refusal, ctx),
        });
      }
      let confirms: FindingKey[] | null = null;
      if (args.confirms) {
        confirms = resolveKeys(args.confirms, ctx.tokens);
        // A token that resolves to nobody: the people changed since the check.
        if (!confirms) return refusal([E.staleCheck], { code: "invalid_request", detail: "stale_check" });
      }
      return saveEdits(ctx, resolved.edits, confirms, args.saveId, deps, callDomain, startedAt);
    },
    EDITOR_COPY,
  );
}

export async function reviseProposalResult(
  args: ReviseProposalArgs,
  principal: McpPrincipal | null,
  deps: EditorDeps = defaultEditorDeps(),
): Promise<CallToolResult> {
  return runWriteTool(
    "revise_proposal",
    async ({ callDomain }) => {
      const startedAt = deps.nowMs();
      const opened = await openProposal(args.proposal, principal, deps);
      if (!opened.ok) return opened.result;
      const ctx = opened.ctx;
      const resolved = resolveNameEdits(args.edits, ctx);
      if (!resolved.ok) {
        if ("lines" in resolved) return refusal(resolved.lines, { code: "invalid_request", detail: "edit" });
        return refusal([E.editRefused(resolved.refusal.index, resolved.refusal.sentence)], { code: "invalid_request", detail: resolved.refusal.code });
      }
      // From the chat nothing is forced: `confirms` is null, so any new rule finding refuses.
      return saveEdits(ctx, resolved.edits, null, `chat-${deps.mintRequestId()}`.slice(0, 64).replace(/[^A-Za-z0-9_-]/g, "-"), deps, callDomain, startedAt);
    },
    EDITOR_COPY,
  );
}

// ── Registration ─────────────────────────────────────────────────────────────

/** MCP Apps: a tool only the card may call; a host that honours it hides it from the model (Q1 (1)). */
const APP_ONLY_META = { ui: { resourceUri: PROPOSAL_CARD_TOOL_META.ui.resourceUri, visibility: ["app"] } } as const;

export function registerProposalEditor(server: McpServer): void {
  server.registerTool(
    "check_proposal_edits",
    {
      title: "Revisar cambios a una propuesta",
      description: "Solo para la tarjeta de la propuesta: revisa una lista de cambios sin guardar nada.",
      inputSchema: CHECK_PROPOSAL_EDITS_INPUT,
      annotations: { readOnlyHint: true, openWorldHint: false },
      _meta: APP_ONLY_META,
    },
    async (args, ctx: ServerContext) => checkProposalEditsResult(args, principalOf(ctx)),
  );
  server.registerTool(
    "save_proposal_edits",
    {
      title: "Guardar cambios a una propuesta",
      description: "Solo para la tarjeta de la propuesta: guarda una lista de cambios como una versión nueva.",
      inputSchema: SAVE_PROPOSAL_EDITS_INPUT,
      // I14: it writes only a private record, like solve_month.
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
      _meta: APP_ONLY_META,
    },
    async (args, ctx: ServerContext) => saveProposalEditsResult(args, principalOf(ctx)),
  );
  server.registerTool(
    "revise_proposal",
    {
      title: "Cambiar lugares de una propuesta",
      description: REVISE_PROPOSAL_DESCRIPTION,
      inputSchema: REVISE_PROPOSAL_INPUT,
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
      // The card follows a revision into the chat (E8).
      _meta: PROPOSAL_CARD_TOOL_META,
    },
    async (args, ctx: ServerContext) => reviseProposalResult(args, principalOf(ctx)),
  );
}
