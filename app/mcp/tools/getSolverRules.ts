// MCP tool `get_solver_rules` (admin parity phase 1, S1): the solver rules and pools as `/admin` →
// «Generar mes» → Reglas shows them, as Spanish lines. The rules come through the planner's own read
// (`readRules`: the route GET's body and the browser's `sourceFromGet`), the pools' member ids are
// shown as display names. KH-1: never a rule key (`id`), never the rules revision, never a member id
// (`monthToolHygiene.test.ts`).

import "server-only";

import type { CallToolResult, McpServer, ServerContext } from "@modelcontextprotocol/server";
import { z } from "zod";

import type { SolverConfig } from "@/app/components/admin/plannerModel";
import { conflictSentence, presenceSentence, restrictionText, sentenceText } from "@/app/components/admin/ruleCopy";
import type { MemberOption } from "@/app/components/admin/serviceCardModel";
import { displayMemberName } from "@/app/utils/memberRuleNames";
import { adminMembersQuery } from "@/app/utils/serviceReadQueries";
import { readRules } from "@/app/utils/v3MonthPlanReads";
import { operationalClient } from "@/sanity/lib/operationalClient";
import { runReadTool, successResult } from "../reads/errors";
import { readsAllMembers } from "../monthProposals/principal";

export const GET_SOLVER_RULES_INPUT = z.object({}).strict();

export const GET_SOLVER_RULES_DESCRIPTION =
  "Muestra las reglas del solver tal como /admin → Generar mes → Reglas: las listas (Líder Domingo, Líder Sábado, " +
  "Soporte) con sus nombres, y cada regla como una línea en español. Patrones: Sun = domingo, Sat = sábado; Lead, " +
  "BGV, Choir (coro); «*» = cualquier lugar; «!» = nunca; «sem.N» = solo esa semana del mes; «sem−N» = semanas del " +
  "mes menos N. Solo lee: no cambia nada.";

export interface GetSolverRulesDeps {
  rules: () => Promise<{ config: SolverConfig }>;
  /** `allMembers`: every ministry (a super-admin) or worship only (a worship admin), `readsAllMembers`. */
  members: (allMembers: boolean) => Promise<MemberOption[]>;
}

const defaultDeps: GetSolverRulesDeps = {
  rules: readRules,
  members: async (allMembers) => {
    const q = adminMembersQuery(allMembers);
    const rows: unknown = await operationalClient.fetch(q.query, q.params);
    if (!Array.isArray(rows)) throw new Error("members");
    return rows as MemberOption[];
  },
};

const POOLS = [
  ["sundayLeads", "Líder Domingo"],
  ["saturdayLeads", "Líder Sábado"],
  ["support", "Soporte"],
] as const;

/** The rules as lines; pool ids become names, an id with no member is counted, never shown. */
export function presentSolverRules(config: SolverConfig, members: readonly MemberOption[]) {
  const nameById = new Map(members.map((m) => [m._id, displayMemberName(m)]));
  const pools = POOLS.map(([field, label]) => {
    const ids = config[field];
    const names = ids.flatMap((id) => (nameById.has(id) ? [nameById.get(id) as string] : []));
    const missing = ids.length - names.length;
    return { lista: label, nombres: names.sort((a, b) => a.localeCompare(b, "es")), ...(missing ? { sinMiembro: missing } : {}) };
  });
  // The rules card's own sentences (`ruleCopy.ts`, bloque 2), so a rule reads the same in the chat as
  // on /admin.
  const personas = config.restrictions.map(restrictionText);
  const noJuntos = config.conflicts.map((c) => sentenceText(conflictSentence(c)));
  const presencia = config.presence.map((p) => sentenceText(presenceSentence(p)));
  return { listas: pools, personas, noJuntos, presencia };
}

export async function getSolverRulesResult(
  _args: Record<string, never>,
  allMembers: boolean,
  deps: GetSolverRulesDeps = defaultDeps,
): Promise<CallToolResult> {
  return runReadTool("get_solver_rules", async () => {
    const [{ config }, members] = await Promise.all([deps.rules(), deps.members(allMembers)]);
    return successResult(presentSolverRules(config, members));
  });
}

export function registerGetSolverRules(server: McpServer): void {
  server.registerTool(
    "get_solver_rules",
    {
      title: "Ver las reglas del solver",
      description: GET_SOLVER_RULES_DESCRIPTION,
      inputSchema: GET_SOLVER_RULES_INPUT,
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async (_args, ctx: ServerContext) => getSolverRulesResult({}, readsAllMembers(ctx)),
  );
}
