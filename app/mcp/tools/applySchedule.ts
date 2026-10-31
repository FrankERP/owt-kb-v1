// MCP tool `apply_schedule` (P4 on solver v3, step 6): create a stored month proposal as draft
// services, exactly as «Crear N borradores» does under v3 — `runV3ConfirmAttempt` itself (D4),
// with server transports: the records through `commitFairnessMonths` (the fairness PUT's own
// commit module) and each draft through `createRole` (the roles POST's). Always drafts
// (`published: false`): nobody is notified.
//
// An apply may take several calls (D5: no create starts after 40 s of a call), and any call may
// be killed, lose its answer or fail to save its progress. Two rules govern every decision and
// sentence (plan step 6):
//   R-OBS  cumulative facts come from ONE observation read from data at the start of the call
//          (`observeProposal`): a draft whose own create landed is recognised by its receipt id,
//          so it is never re-posted, whatever the stored `state` says;
//   R-CALL negative claims are about THIS call only, and only when it knows them: a write whose
//          answer was lost is «sin confirmar», never «falló»; nothing here says «No se creó
//          nada» about the proposal, nor blames «otro administrador» (V3_CONNECTOR_LINES).
//
// Phases: 0 gate (engine, handle, load, D10) · 1 observe (reads, sources, rules rev) · 2 done? ·
// 3 check (D7: the whole call refuses before any write) · 4 confirm (inside `callDomain`) ·
// 5 save `state` (merge under `ifRevisionId`) and sweep.
//
// An edited version (ADR-0062) changes three things only: a superseded version is refused naming
// its successor unless it already created a service (the save/apply race, finished not stranded);
// one that carries waivers is refused before any write unless `waivers` repeats each one (Q1), so a
// seat forced past a rule always reaches the destructive call's arguments; and the answer names
// the version and repeats «sin revisar».

import "server-only";

import type { CallToolResult, McpServer, ServerContext } from "@modelcontextprotocol/server";
import { z } from "zod";

import { serviceTodayIso } from "@/app/components/admin/serviceReadiness";
import { V3_CONNECTOR_LINES as L, V3_EDITOR_LINES as E, V3_LINES } from "@/app/components/admin/v3Copy";
import { v3Names } from "@/app/components/admin/v3RunReport";
import { classifyRecordPut, confirmGuard, draftsByMonth, type V3ConfirmEntry } from "@/app/components/admin/v3Confirm";
import { runV3ConfirmAttempt, type V3ConfirmResult } from "@/app/components/admin/v3ConfirmRun";
import type { DraftCard } from "@/app/components/admin/plannerModel";
import { commitFairnessMonths } from "@/app/utils/fairnessMonthCommit";
import { createRole } from "@/app/utils/roleCreateCommit";
import { resolveSolverEngine } from "@/app/utils/solverDeployment";
import { loadV3PlanSources } from "@/app/utils/v3MonthPlanReads";
import type { FairnessMonthsPut } from "@/app/utils/fairnessVocabulary";
import { confirmMembersFrom, type DraftPostOutcome, type draftCreateBody } from "@/app/utils/monthDraftCreate";
import { serviceRefusalLine, type DomainRefusal } from "../writes/refusals";
import { runWriteTool, type WriteFailureCopy } from "../writes/runWriteTool";
import { isProposalHandle } from "../monthProposals/handle";
import { admitsProposal, PROPOSAL_MAX_WAIVERS, WAIVER_SENTENCE_MAX, type ProposalState, type StoredProposal } from "../monthProposals/proposalDocument";
import { loadProposal, sweepExpired, writeState } from "../monthProposals/proposalStore";
import { observeProposal, phase3Refusals, type ProposalObservation } from "../monthProposals/observe";
import { draftLabel } from "../monthProposals/labels";
import { principalOf, type McpPrincipal } from "../monthProposals/principal";
import { proposalBoard } from "../monthProposals/editorBoard";
import { sameWaiverItems, waiverItems, type WaiverItem } from "../monthProposals/editorView";

/** D5: no create starts after this much of the call. */
export const APPLY_CREATE_CUTOFF_MS = 40_000;
/** D12: no sweep once this much of the call has passed. */
export const APPLY_SWEEP_DEADLINE_MS = 45_000;

/** Q1: one item per waiver the proposal carries, repeated from save_proposal_edits' answer or apply's refusal. */
const WAIVER_ITEM = z
  .object({
    service: z.string().max(200),
    members: z.array(z.string().max(200)).max(12),
    rule: z.string().max(WAIVER_SENTENCE_MAX),
  })
  .strict();

export const APPLY_SCHEDULE_INPUT = z
  .object({ proposal: z.string().max(64), waivers: z.array(WAIVER_ITEM).max(PROPOSAL_MAX_WAIVERS).optional() })
  .strict();

export type ApplyScheduleArgs = z.infer<typeof APPLY_SCHEDULE_INPUT>;

export const APPLY_SCHEDULE_COPY: WriteFailureCopy = {
  pre: `No se pudo preparar apply_schedule; vuelve a intentarlo. ${L.noWriteThisCall}`,
  domain:
    "No pude confirmar qué escribió esta llamada. Volver a llamar apply_schedule es seguro: el registro responde sin cambios y lo creado se reconoce por su recibo.",
};

export const APPLY_SCHEDULE_DESCRIPTION =
  "Crea como BORRADORES los servicios de una propuesta de solve_month, exactamente como «Crear borradores» en " +
  "/admin con el solver v3: primero registra la elegibilidad de los meses (una sola escritura para todos) y luego " +
  "crea los servicios mes por mes, del más antiguo al más nuevo. No publica nada ni avisa a nadie. proposal es el " +
  "identificador que devolvió solve_month (vence en 7 días). Antes de escribir vuelve a leer todo: si una fecha " +
  "planeada ya no se puede crear, si apareció o desapareció un servicio guardado, o si cambiaron las reglas, no " +
  "escribe nada y pide volver a correr solve_month. Si una llamada no alcanza a crear todo (límite de tiempo) o " +
  "pierde una respuesta, volver a llamarla con la misma propuesta es seguro: nunca crea un servicio dos veces, y " +
  "lo ya creado se reconoce por su recibo. La respuesta dice, por mes y por servicio, qué se creó, qué ya existía, " +
  "qué quedó pendiente o sin confirmar y qué se rechazó, y si la propuesta quedó completa. Una versión editada " +
  "(save_proposal_edits) reemplaza a la anterior: aplica siempre la más nueva; una reemplazada se rechaza nombrando " +
  "a la nueva, salvo que ya haya creado servicios. Si la versión tiene lugares asignados contra una regla, waivers " +
  "debe repetir exactamente cada uno ({service, members, rule}, tal como los dio save_proposal_edits o el rechazo " +
  "de apply_schedule); si falta o cambia alguno, no escribe nada y responde la lista exacta.";

type PutKnown =
  | { kind: "none" }
  | { kind: "answered"; status: number; body: unknown }
  | { kind: "unknown" };

type PostKnown =
  | { kind: "created"; roleId: string | null }
  | { kind: "refused"; outcome: DomainRefusal }
  | { kind: "unknown" }
  | { kind: "deferred" };

export interface ApplyScheduleDeps {
  engine: () => string;
  loadProposal: typeof loadProposal;
  reads: typeof loadV3PlanSources;
  commitRecords: typeof commitFairnessMonths;
  createRole: typeof createRole;
  writeState: typeof writeState;
  sweepExpired: typeof sweepExpired;
  nowMs: () => number;
  todayIso: () => string;
}

export function defaultApplyScheduleDeps(): ApplyScheduleDeps {
  return {
    engine: () => resolveSolverEngine(process.env),
    loadProposal,
    reads: loadV3PlanSources,
    commitRecords: commitFairnessMonths,
    createRole,
    writeState,
    sweepExpired,
    nowMs: () => Date.now(),
    todayIso: serviceTodayIso,
  };
}

function answer(isError: boolean, lines: readonly string[], content: Record<string, unknown>): CallToolResult {
  return {
    ...(isError ? { isError: true } : {}),
    content: [{ type: "text", text: lines.filter(Boolean).join("\n") }],
    structuredContent: content,
  };
}

const refusal = (lines: readonly string[], content: Record<string, unknown>) => answer(true, lines, { refused: true, ...content });

type ServiceStatus = "created" | "already" | "deleted" | "modified" | "refused" | "unknown" | "pending" | "blocked" | "not_planned";

interface ServiceRow {
  month: string;
  service: string;
  status: ServiceStatus;
  detail?: string;
}

const STATUS_LINE: Record<Exclude<ServiceStatus, "refused">, (s: string) => string> = {
  created: L.serviceCreated,
  already: L.serviceAlready,
  deleted: L.serviceDeleted,
  modified: L.serviceModified,
  unknown: L.serviceUnknown,
  pending: L.servicePending,
  blocked: L.serviceBlocked,
  not_planned: L.serviceNotPlanned,
};

/** Every draft of the proposal, by month, with what this call knows of it. */
function serviceRows(
  proposal: StoredProposal,
  obs: ProposalObservation,
  posts: ReadonlyMap<string, PostKnown>,
): ServiceRow[] {
  const rows: ServiceRow[] = [];
  let refusedEarlier = false;
  for (const { month, drafts } of draftsByMonth(proposal.payload.drafts.map((d) => ({ ...d, date: d.draft.date })), proposal.header.months)) {
    let refusedHere = false;
    for (const { draft, atSolve } of drafts) {
      const service = draftLabel(draft);
      const post = posts.get(draft.creationRequestId);
      let status: ServiceStatus;
      let detail: string | undefined;
      if (atSolve !== "creatable") status = "not_planned";
      else if (obs.deleted.has(draft.localId)) status = "deleted";
      else if (obs.modified.has(draft.localId)) status = "modified";
      else if (obs.created.has(draft.localId)) status = "already";
      else if (post?.kind === "created") status = post.roleId ? "created" : "unknown";
      else if (post?.kind === "refused") {
        status = "refused";
        detail = serviceRefusalLine(post.outcome);
        refusedHere = true;
      } else if (post?.kind === "unknown") status = "unknown";
      else if (post?.kind === "deferred") status = "pending";
      else status = refusedEarlier ? "blocked" : "pending";
      rows.push({ month, service, status, ...(detail ? { detail } : {}) });
    }
    if (refusedHere) refusedEarlier = true;
  }
  return rows;
}

function serviceLines(rows: readonly ServiceRow[]): string[] {
  const lines: string[] = [];
  let month = "";
  for (const r of rows) {
    if (r.month !== month) {
      month = r.month;
      lines.push(L.monthHeader(month));
    }
    lines.push(r.status === "refused" ? L.serviceRefused(r.service, r.detail ?? "") : STATUS_LINE[r.status](r.service));
  }
  return lines;
}

/** I9: complete only when every draft creatable at solve exists as created, and nothing else is owed. */
const isComplete = (rows: readonly ServiceRow[]) =>
  rows.every((r) => r.status === "created" || r.status === "already" || r.status === "not_planned");

function existsLine(proposal: StoredProposal, obs: ProposalObservation): string[] {
  const labels = proposal.payload.drafts
    .filter((d) => obs.created.has(d.draft.localId) && !obs.deleted.has(d.draft.localId))
    .map((d) => draftLabel(d.draft));
  return labels.length ? [L.exists(labels)] : [];
}

/** The tool's whole behaviour, callable without a server. */
export async function applyScheduleResult(
  args: ApplyScheduleArgs,
  principal: McpPrincipal | null,
  deps: ApplyScheduleDeps = defaultApplyScheduleDeps(),
): Promise<CallToolResult> {
  return runWriteTool(
    "apply_schedule",
    async ({ callDomain }) => {
      const startedAt = deps.nowMs();
      const elapsedMs = () => deps.nowMs() - startedAt;

      // ── 0. Gate ──────────────────────────────────────────────────────────
      if (!principal) return refusal([L.noPrincipal, L.noWriteThisCall], { code: "forbidden", detail: "no_principal" });
      if (deps.engine() !== "v3") return refusal([L.engineNotV3, L.noWriteThisCall], { code: "integrity_conflict", detail: "engine_not_v3" });
      const notFound = () => refusal([L.proposalNotFound], { code: "not_found", detail: "proposal" });
      if (!isProposalHandle(args.proposal)) return notFound();
      const loaded = await deps.loadProposal(args.proposal);
      if (!loaded.ok) {
        if (loaded.reason === "not_found") return notFound();
        console.error("[mcp-month] proposal read failed");
        return refusal([L.proposalReadFailed], { code: "read_failed", retry: true });
      }
      const proposal = loaded.proposal;
      if (!admitsProposal(proposal, { origin: principal.origin, principal: principal.sub, nowMs: deps.nowMs() })) return notFound();
      const months = proposal.header.months;

      // ── 1. Observe (R-OBS) ───────────────────────────────────────────────
      const read = await deps.reads();
      if (!read.ok) return refusal([L.sources(read.failed), L.noWriteThisCall], { code: "integrity_conflict", detail: "sources", retry: true });
      const sources = read.value;
      const states = sources.snapshot.readiness.sources;
      const unready = (Object.keys(states) as (keyof typeof states)[]).filter((k) => states[k] !== "ready");
      if (unready.length) return refusal([L.sources(unready), L.noWriteThisCall], { code: "integrity_conflict", detail: "sources", retry: true });
      if (sources.rules.rev !== proposal.header.rulesRev) {
        return refusal([L.rulesChanged], { code: "stale_revision", detail: "rules_changed", next: "solve_month" });
      }
      const obs = observeProposal(proposal, sources.snapshot.roles);

      // ── E3: a superseded version, unless it already created a service (T2.2's race) ──
      const payload = proposal.payload;
      const revision = proposal.header.lineage?.revision ?? 1;
      const successor = proposal.state.supersededBy;
      if (successor && obs.created.size === 0) {
        return refusal([E.applySuperseded(successor)], { code: "stale_revision", detail: "superseded", supersededBy: successor, next: "apply_schedule" });
      }
      const head = [
        ...(proposal.header.lineage ? [E.applyRevision(revision)] : []),
        ...(successor ? [E.applySupersededContinuing(successor)] : []),
        ...(payload.v === 2 && !payload.checked ? [E.applyUnchecked] : []),
      ];
      const about = {
        revision,
        ...(payload.v === 2 ? { checked: payload.checked } : {}),
        ...(successor ? { supersededBy: successor } : {}),
      };

      // ── 2. Done? ─────────────────────────────────────────────────────────
      if (obs.pending.length === 0) {
        const rows = serviceRows(proposal, obs, new Map());
        const complete = isComplete(rows);
        return answer(false, [...head, ...(complete ? [L.complete] : []), ...serviceLines(rows), L.noWriteThisCall], {
          ok: true, complete, months, ...about, services: rows, ...(complete ? {} : { next: "solve_month" }),
        });
      }

      // ── 3. Check (D7): refuse the whole call before any write ────────────
      const lost = phase3Refusals(proposal, obs, sources);
      if (lost.length) {
        return refusal([...head, ...lost, ...existsLine(proposal, obs), L.resolveAgain], { code: "integrity_conflict", detail: "target_lost", next: "solve_month" });
      }

      // ── Q1: every waiver repeated in this call's arguments, before any write ──
      if (payload.v === 2 && payload.waivers.length > 0) {
        const board = proposalBoard(payload.drafts);
        if (!board) {
          console.error("[mcp-month] proposal board unreadable");
          return refusal([E.replay.server_error, L.noWriteThisCall], { code: "server_error" });
        }
        const person = v3Names({ members: sources.members, serviceLabels: new Map(), ruleLabels: new Map() }).person;
        const expected: WaiverItem[] = waiverItems(board, payload.waivers, person);
        if (!sameWaiverItems(args.waivers ?? [], expected)) {
          return refusal(
            [...head, E.applyWaiversMissing(expected.length), ...expected.map((w) => E.applyWaiverItem(w.service, w.members.join(" y "), w.rule))],
            { code: "invalid_request", detail: "waivers", expectedWaivers: expected, next: "apply_schedule" },
          );
        }
      }

      // ── 4. Confirm (D4), every call resending the PUT ────────────────────
      let put: PutKnown = { kind: "none" };
      const posts = new Map<string, PostKnown>();
      const putRecords = async (body: FairnessMonthsPut) => {
        try {
          const out = await deps.commitRecords(body, { recordedBy: principal.sub });
          put = out.status >= 500 ? { kind: "unknown" } : { kind: "answered", status: out.status, body: out.body };
          return { status: out.status, body: out.body };
        } catch (err) {
          put = { kind: "unknown" };
          throw err;
        }
      };
      const postDraft = async (body: ReturnType<typeof draftCreateBody>): Promise<DraftPostOutcome> => {
        if (elapsedMs() >= APPLY_CREATE_CUTOFF_MS) {
          posts.set(body.creationRequestId, { kind: "deferred" });
          return { ok: false, error: "deferred" };
        }
        try {
          const out = await deps.createRole(body);
          if (out.ok) {
            posts.set(body.creationRequestId, { kind: "created", roleId: out.effects.roleId });
          } else {
            posts.set(body.creationRequestId, out.status >= 500 ? { kind: "unknown" } : { kind: "refused", outcome: out });
          }
          const code = (out.body as { error?: unknown }).error;
          return { ok: out.ok, status: out.status, ...(typeof code === "string" ? { error: code } : {}) };
        } catch (err) {
          posts.set(body.creationRequestId, { kind: "unknown" });
          throw err;
        }
      };
      const creatable: DraftCard[] = proposal.payload.drafts.filter((d) => d.atSolve === "creatable").map((d) => d.draft);
      const currentMonth = deps.todayIso().slice(0, 7);
      const result: V3ConfirmResult = await callDomain(() =>
        runV3ConfirmAttempt({
          entries: proposal.payload.entries as readonly V3ConfirmEntry[],
          months,
          drafts: creatable,
          published: false,
          state: { recordsDone: false, createdLocalIds: new Set(obs.created.keys()) },
          currentMonth,
          members: confirmMembersFrom(sources.members),
          putRecords,
          postDraft,
        }),
      );

      // ── 5. Save what this call knows, then sweep ─────────────────────────
      const putAnswer = put as PutKnown;
      const recordsLanded =
        putAnswer.kind === "answered" && classifyRecordPut(proposal.payload.entries, { kind: "http", status: putAnswer.status, body: putAnswer.body }).ok;
      const learned: ProposalState = { recordsDone: recordsLanded, created: {} };
      for (const [localId, fact] of obs.created) if (fact.via === "receipt") learned.created[localId] = fact.roleId;
      const byRequest = new Map(creatable.map((d) => [d.creationRequestId, d.localId]));
      for (const [requestId, p] of posts) {
        const localId = byRequest.get(requestId);
        if (localId && p.kind === "created" && p.roleId) learned.created[localId] = p.roleId;
      }
      const isNew = (learned.recordsDone && !proposal.state.recordsDone) ||
        Object.keys(learned.created).some((k) => proposal.state.created[k] !== learned.created[k]);
      let saveFailed = false;
      if (isNew) {
        const saved = await deps.writeState(proposal, learned);
        if (!saved.ok) {
          saveFailed = true;
          console.error("[mcp-month] proposal state write failed:", saved.reason);
        }
      }
      if (elapsedMs() < APPLY_SWEEP_DEADLINE_MS) {
        const swept = await deps.sweepExpired(deps.nowMs());
        if (!swept.ok) console.error("[mcp-month] proposal sweep failed");
      }
      const tail = saveFailed ? [L.stateSaveFailed] : [];

      // ── The answer, per outcome ──────────────────────────────────────────
      if (result.kind === "refused_guard" && result.reason === "seat_clash") {
        // Names and seat labels only (the runner's lines); nothing of this call was written.
        return refusal(
          [...head, ...result.lines, L.noWriteThisCall, obs.created.size === 0 ? L.seatClashRevise : L.seatClashResolve, ...existsLine(proposal, obs), ...tail],
          { code: "invalid_request", detail: "seat_clash" },
        );
      }
      if (result.kind === "refused_guard" && result.reason === "outside_horizon") {
        return refusal([...head, ...result.lines, L.noWriteThisCall, ...existsLine(proposal, obs), ...tail], {
          code: "integrity_conflict", detail: "outside_horizon", next: "solve_month",
        });
      }
      if (result.kind === "refused_guard") {
        const guard = confirmGuard(months, currentMonth);
        const line = guard?.kind === "ceiling" ? V3_LINES.horizonCeiling(guard.month, guard.limit) : L.guardPast(guard?.month ?? months[0]);
        return refusal([...head, line, ...(guard?.kind === "ceiling" ? [L.noWriteThisCall] : []), ...existsLine(proposal, obs), ...tail], {
          code: "integrity_conflict", detail: guard?.kind ?? "guard", next: "solve_month",
        });
      }
      if (result.kind === "record_failed") {
        if (putAnswer.kind === "answered" && putAnswer.status < 500 && putAnswer.status !== 200) {
          const verdict = classifyRecordPut(proposal.payload.entries, { kind: "http", status: putAnswer.status, body: putAnswer.body });
          const line = !verdict.ok && verdict.kind === "refusal" ? L.recordRefusal[verdict.detail](verdict.month) : L.recordInvalid;
          return refusal([...head, line, ...existsLine(proposal, obs), ...tail], {
            code: "record_refused", detail: !verdict.ok && verdict.kind === "refusal" ? verdict.detail : "invalid", next: "solve_month",
          });
        }
        return refusal([...head, L.recordUnknown, ...existsLine(proposal, obs), ...tail], { code: "record_unknown", retry: true, next: "apply_schedule" });
      }

      const rows = serviceRows(proposal, obs, posts);
      const complete = isComplete(rows);
      // R-CALL: «before creating a new service» only when no post of this call may have landed — a lost
      // answer or a replay without a role id is `unknown`, never «nothing created».
      const mayHaveCreated = [...posts.values()].some((p) => p.kind === "created" || p.kind === "unknown");
      const deferred = [...posts.values()].some((p) => p.kind === "deferred");
      const owesSolve = rows.some((r) => r.status === "refused" || r.status === "blocked" || r.status === "deleted" || r.status === "modified");
      const owesCall = rows.some((r) => r.status === "pending" || r.status === "unknown");
      const lines = [
        ...head,
        ...(complete ? [L.complete] : []),
        ...(recordsLanded ? [L.recordsSaved(months)] : []),
        ...serviceLines(rows),
        ...(deferred && !mayHaveCreated ? [L.cutoffNothing] : []),
        ...tail,
      ];
      return answer(false, lines, {
        ok: true,
        complete,
        months,
        ...about,
        recordsSaved: recordsLanded,
        services: rows,
        ...(complete ? {} : { next: owesCall ? "apply_schedule" : owesSolve ? "solve_month" : "apply_schedule", retry: owesCall }),
        ...(saveFailed ? { stateSaved: false } : {}),
      });
    },
    APPLY_SCHEDULE_COPY,
  );
}

/** Registers `apply_schedule` on a per-request MCP server. */
export function registerApplySchedule(server: McpServer): void {
  server.registerTool(
    "apply_schedule",
    {
      title: "Crear los servicios de una propuesta",
      description: APPLY_SCHEDULE_DESCRIPTION,
      inputSchema: APPLY_SCHEDULE_INPUT,
      // D13: P3's write annotations.
      annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: false },
    },
    async (args, ctx: ServerContext) => applyScheduleResult(args, principalOf(ctx)),
  );
}
