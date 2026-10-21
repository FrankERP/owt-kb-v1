// MCP tool `get_fairness_ledger` (admin parity phase 1, S1): what `/admin` → «Equidad» shows for a
// month, read through the ledger GET's own loader (`loadFairnessLedger`, whose one assembly passes
// the balance start, ADR-0055) and laid out by the panel's own view-model (`fairnessPreviewModel.ts`
// `tabRows`, `chipText`, `windowSpan`). The loader fails closed without `SANITY_API_READ_TOKEN`
// (ADR-0050), so a failed read is the fixed tool error, never an empty ledger.
//
// Names, never ids: rows carry the person's display name only, and nothing else from the payload
// (no member id, no rule key, no record revision) reaches the answer.

import "server-only";

import type { CallToolResult, McpServer } from "@modelcontextprotocol/server";
import { z } from "zod";

import { COPY, TABS, chipText, monthYear, tabRows, windowSpan } from "@/app/components/admin/fairnessPreviewModel";
import { serviceTodayIso } from "@/app/components/admin/serviceReadiness";
import { loadFairnessLedger } from "@/app/utils/fairnessLedgerRead";
import type { FairnessLedgerResponse } from "@/app/utils/fairnessVocabulary";
import { fairnessRecordEnvironment, resolveSolverEngine } from "@/app/utils/solverDeployment";
import { runReadTool, successResult } from "../reads/errors";

export const GET_FAIRNESS_LEDGER_INPUT = z
  .object({ month: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/).optional() })
  .strict();

export type GetFairnessLedgerArgs = z.infer<typeof GET_FAIRNESS_LEDGER_INPUT>;

export const GET_FAIRNESS_LEDGER_DESCRIPTION =
  "Muestra el saldo de equidad de un mes (month: \"YYYY-MM\"; por defecto el mes actual en America/Mexico_City), " +
  "lo mismo que /admin → Equidad: la ventana de 3 meses con el estado de cada mes, y por pestaña (Dom Lead, Sáb " +
  "Lead, BGV, Coro, Total) cada persona con «le tocaba», «tuvo», su saldo de la ventana, su saldo acumulado desde " +
  "el inicio y el motivo. «Le deben» = le tocaba más de lo que tuvo. Solo nombres, nunca ids. Solo lee: no cambia nada.";

export interface GetFairnessLedgerDeps {
  load: (month: string) => Promise<FairnessLedgerResponse>;
}

const defaultDeps: GetFairnessLedgerDeps = {
  load: (month) =>
    loadFairnessLedger({
      month,
      horizon: 1,
      currentMonth: serviceTodayIso().slice(0, 7),
      engine: resolveSolverEngine(process.env),
      environment: fairnessRecordEnvironment(process.env),
    }),
};

/** The panel's rows for every tab, without member ids. */
export function presentFairnessLedger(data: FairnessLedgerResponse) {
  const span = windowSpan(data.window);
  const since = data.balanceStart ? monthYear(data.balanceStart) : span;
  const tabs = TABS.map(({ key, label }) => {
    const { rows, out } = tabRows(data, key);
    const strip = (r: (typeof rows)[number]) => ({
      name: r.name,
      leTocaba: r.leTocaba,
      tuvo: r.tuvo,
      saldo: r.saldo,
      desdeInicio: r.desde,
      ...(key === "TOTAL" ? { canto: r.canto } : {}),
      ...(r.motivo ? { motivo: r.motivo } : {}),
    });
    return { tab: label, people: rows.map(strip), ...(out.length ? { fueraDeEstaLinea: out.map((r) => r.name) } : {}) };
  });
  return {
    month: data.target,
    ventana: data.window.map((w) => chipText(w, data.balanceStart)),
    resumen: COPY.subheader(span),
    ...(data.balanceStart ? { inicioDelSaldo: COPY.beforeStart(monthYear(data.balanceStart)) } : {}),
    columnas: { saldo: COPY.columns.saldo, desdeInicio: COPY.columns.desde(since) },
    tabs,
    nota: COPY.footer,
  };
}

export async function getFairnessLedgerResult(args: GetFairnessLedgerArgs, deps: GetFairnessLedgerDeps = defaultDeps): Promise<CallToolResult> {
  return runReadTool("get_fairness_ledger", async () => {
    const month = args.month ?? serviceTodayIso().slice(0, 7);
    return successResult(presentFairnessLedger(await deps.load(month)));
  });
}

export function registerGetFairnessLedger(server: McpServer): void {
  server.registerTool(
    "get_fairness_ledger",
    {
      title: "Ver el saldo de equidad",
      description: GET_FAIRNESS_LEDGER_DESCRIPTION,
      inputSchema: GET_FAIRNESS_LEDGER_INPUT,
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async (args) => getFairnessLedgerResult(args),
  );
}
