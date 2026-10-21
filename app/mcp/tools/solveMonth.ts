// MCP tool `solve_month` (P4 on solver v3, step 6): plan one or two months with the very Auto
// `/admin` → «Generar mes» runs (D3: `planV3Month` composes the planner's own functions), and
// store the result as a private, 7-day proposal for `apply_schedule` (D6). It writes nothing the
// team sees: no service, no record, no notice — only its own `mcpProposal` record.
//
// The order (plan step 6):
//   1. the engine gate (D2), before any read: v3 or nothing;
//   2. `planV3Month` (reads, preview, ledger, solve under the D5 budget);
//   3. any exit but success stores nothing (D8) and answers the browser's own lines, with
//      `retry` per AD-6;
//   4. a success with at least one creatable draft is stored (`create`, never replace); if the
//      store fails the answer is the report WITHOUT a handle plus «no pude guardar la propuesta»
//      (an orphan record, if one landed, is unreachable and swept); then the D12 sweep, skipped
//      once 45 s of the call have passed and never failing the call; then the D14 report.
//   A success with zero creatable drafts stores nothing (the browser's «Crear» is disabled then).
//
// LOGGING: the timing line (`runWriteTool`), one KH-2 line for the solve (engine, outcome class,
// status, ms — never a byte of the request or response), and fixed tags on a store or sweep
// failure. Never an id, a name, a rule key or a body.

import "server-only";

import type { CallToolResult, McpServer, ServerContext } from "@modelcontextprotocol/server";
import { z } from "zod";

import { serviceTodayIso } from "@/app/components/admin/serviceReadiness";
import { V3_CONNECTOR_LINES as L } from "@/app/components/admin/v3Copy";
import { resolveSolverEngine } from "@/app/utils/solverDeployment";
import { solveV3 } from "@/app/utils/solverV3Upstream";
import { mintSolveIdentity, planV3Month, type V3MonthPlanDeps, type V3MonthPlanInput, type V3MonthPlanResult } from "@/app/utils/v3MonthPlan";
import { loadV3Ledger, loadV3PlanSources } from "@/app/utils/v3MonthPlanReads";
import { admissionRefusal } from "../writes/refusals";
import { runWriteTool, type WriteFailureCopy } from "../writes/runWriteTool";
import { newProposalHandle } from "../monthProposals/handle";
import { buildProposal } from "../monthProposals/proposalDocument";
import { createProposal, sweepExpired } from "../monthProposals/proposalStore";
import { solveReport } from "../monthProposals/reports";
import { principalOf, type McpPrincipal } from "../monthProposals/principal";
import { PROPOSAL_CARD_TOOL_META } from "../apps/proposalCard";

/** D12: no sweep once this much of the call has passed. */
export const SWEEP_DEADLINE_MS = 45_000;

const DAY = /^\d{4}-\d{2}-\d{2}$/;

export const SOLVE_MONTH_INPUT = z
  .object({
    month: z.string().regex(/^\d{4}-\d{2}$/, { message: "month debe ser YYYY-MM." }),
    months: z.union([z.literal(1), z.literal(2)]).optional(),
    excludeSundays: z.array(z.string().regex(DAY)).max(10).optional(),
    excludeSaturdays: z.array(z.string().regex(DAY)).max(10).optional(),
    specials: z
      .array(
        z
          .object({
            date: z.string().regex(DAY),
            name: z.string().max(80),
            countsForFairness: z.boolean().optional(),
          })
          .strict(),
      )
      .max(10)
      .optional(),
  })
  .strict();

export type SolveMonthArgs = z.infer<typeof SOLVE_MONTH_INPUT>;

export const SOLVE_MONTH_COPY: WriteFailureCopy = {
  pre: "No se pudo completar solve_month; vuelve a intentarlo. No se guardó ninguna propuesta.",
  domain: "No se pudo confirmar si la propuesta se guardó; vuelve a correr solve_month.",
};

export const SOLVE_MONTH_DESCRIPTION =
  "Planea 1 o 2 meses del equipo de alabanza con el mismo Auto (solver v3) que «Generar mes» en /admin, y guarda " +
  "el resultado como una propuesta privada que vence en 7 días. No crea servicios, no registra elegibilidad y no " +
  "avisa a nadie: para crear los servicios como borradores, llama apply_schedule con la propuesta. Los servicios ya " +
  "guardados del mes se respetan tal cual y el solver planea alrededor de ellos. month es el primer mes (YYYY-MM); " +
  "months, 1 o 2 (por omisión 1). excludeSundays y excludeSaturdays quitan fines de semana del plan (fechas " +
  "YYYY-MM-DD de esos meses). specials agrega servicios especiales (fecha, nombre y, si quieres, si cuentan para " +
  "equidad; por omisión, lo mismo que en /admin). Usa las reglas guardadas del planificador. Si el solver no " +
  "encuentra un plan, falla o tarda demasiado, no se guarda nada y la respuesta dice por qué y si conviene reintentar. " +
  "La respuesta lista cada servicio con sus asignaciones por nombre, los lugares sin cubrir, los especiales no " +
  "agregados, las fechas que no se pudieron planear y la equidad de cada persona.";

export interface SolveMonthDeps {
  engine: () => string;
  plan: (input: V3MonthPlanInput, deps: V3MonthPlanDeps) => Promise<V3MonthPlanResult>;
  reads: V3MonthPlanDeps["reads"];
  readLedger: V3MonthPlanDeps["readLedger"];
  solve: V3MonthPlanDeps["solve"];
  identity: () => { seed: number; requestId: string };
  todayIso: () => string;
  nowMs: () => number;
  newHandle: () => string;
  createProposal: typeof createProposal;
  sweepExpired: typeof sweepExpired;
}

export function defaultSolveMonthDeps(): SolveMonthDeps {
  return {
    engine: () => resolveSolverEngine(process.env),
    plan: planV3Month,
    reads: loadV3PlanSources,
    readLedger: loadV3Ledger,
    solve: async (request, timeoutMs) => {
      const started = Date.now();
      const result = await solveV3(request, process.env, undefined, timeoutMs);
      const outcome = /^[a-z_]{1,40}$/.test(result.outcome) ? result.outcome : "coded";
      console.info(JSON.stringify({ route: "mcp/solve_month", engine: "v3", outcome, status: result.status, ms: Date.now() - started }));
      return { status: result.status, text: result.text };
    },
    identity: mintSolveIdentity,
    todayIso: serviceTodayIso,
    nowMs: () => Date.now(),
    newHandle: newProposalHandle,
    createProposal,
    sweepExpired,
  };
}

function refusalLines(lines: readonly string[], content: Record<string, unknown>): CallToolResult {
  return { isError: true, content: [{ type: "text", text: lines.join("\n") }], structuredContent: { refused: true, ...content } };
}

/** The tool's whole behaviour, callable without a server. */
export async function solveMonthResult(
  args: SolveMonthArgs,
  principal: McpPrincipal | null,
  deps: SolveMonthDeps = defaultSolveMonthDeps(),
): Promise<CallToolResult> {
  return runWriteTool(
    "solve_month",
    async ({ callDomain }) => {
      const startedAt = deps.nowMs();
      const elapsedMs = () => deps.nowMs() - startedAt;
      if (!principal) return admissionRefusal("forbidden", "no_principal", L.noPrincipal);
      // D2: before any read.
      if (deps.engine() !== "v3") return admissionRefusal("integrity_conflict", "engine_not_v3", L.engineNotV3);

      const { seed, requestId } = deps.identity();
      const input: V3MonthPlanInput = {
        month: args.month,
        months: args.months ?? 1,
        excludeSundays: args.excludeSundays,
        excludeSaturdays: args.excludeSaturdays,
        specials: args.specials,
      };
      const out = await deps.plan(input, {
        reads: deps.reads,
        readLedger: deps.readLedger,
        solve: deps.solve,
        elapsedMs,
        todayIso: deps.todayIso(),
        seed,
        requestId,
      });

      // D8: every exit but success stores nothing.
      switch (out.kind) {
        case "invalid":
          return admissionRefusal("invalid_request", out.detail, L.invalid[out.detail] ?? L.invalid.month);
        case "no_columns":
          return refusalLines([L.invalid.no_columns, ...out.refusedSpecials.map((r) => L.refusedSpecial(r.date, r.reason)), L.noProposalStored], {
            code: "invalid_request", detail: "no_columns",
          });
        case "sources":
          return refusalLines([L.sources(out.failed), L.noProposalStored], { code: "integrity_conflict", detail: "sources", retry: true });
        case "time_budget":
          return refusalLines([L.timeBudget], { code: "time_budget", retry: true });
        case "refused":
          return refusalLines([...out.lines, L.noProposalStored], { code: "solve_refused", retry: false });
        case "failed":
          return refusalLines([...out.lines, L.noProposalStored], { code: "solve_failed", retry: out.retry });
        case "success":
          break;
      }

      const plan = out.plan;
      if (!plan.drafts.some((d) => d.atSolve === "creatable")) {
        const report = solveReport(plan, { nothingToCreate: true });
        return { content: [{ type: "text", text: report.text }], structuredContent: report.structured };
      }

      const handle = deps.newHandle();
      const built = buildProposal({
        handle,
        origin: principal.origin,
        principal: principal.sub,
        nowMs: deps.nowMs(),
        rulesRev: plan.rulesRev,
        months: plan.months,
        requestId: plan.requestId,
        payload: {
          entries: plan.entries,
          drafts: plan.drafts.map((d) => ({ draft: d.draft, atSolve: d.atSolve, reasons: d.reasons })),
          storedServiceIds: plan.storedServiceIds,
        },
      });
      // The only write this tool makes, so the only call on the `domain` side.
      const saved = built.ok ? await callDomain(() => deps.createProposal(built.doc)) : { ok: false as const };
      if (!saved.ok) console.error("[mcp-month] proposal store failed:", built.ok ? "write" : "build");

      if (saved.ok && elapsedMs() < SWEEP_DEADLINE_MS) {
        const swept = await deps.sweepExpired(deps.nowMs());
        if (!swept.ok) console.error("[mcp-month] proposal sweep failed");
      }

      const report = solveReport(plan, saved.ok && built.ok ? { handle, expiresAt: built.doc.expiresAt } : { failed: true });
      return { content: [{ type: "text", text: report.text }], structuredContent: report.structured };
    },
    SOLVE_MONTH_COPY,
  );
}

/** Registers `solve_month` on a per-request MCP server. */
export function registerSolveMonth(server: McpServer): void {
  server.registerTool(
    "solve_month",
    {
      title: "Planear un mes (solver v3)",
      description: SOLVE_MONTH_DESCRIPTION,
      inputSchema: SOLVE_MONTH_INPUT,
      // D13: it writes only its own private record.
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
      // MCP Apps (S1): a host that supports them draws the result as the proposal card.
      _meta: PROPOSAL_CARD_TOOL_META,
    },
    async (args, ctx: ServerContext) => solveMonthResult(args, principalOf(ctx)),
  );
}
