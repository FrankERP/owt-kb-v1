// MCP tool `get_solver_rules` (admin parity phase 1, S1): the solver rules and pools as `/admin` →
// «Generar mes» → Reglas shows them, as Spanish lines. The rules come through the planner's own read
// (`readRules`: the route GET's body and the browser's `sourceFromGet`), the pools' member ids are
// shown as display names. KH-1: never a rule key (`id`), never the rules revision, never a member id
// (`monthToolHygiene.test.ts`).

import "server-only";

import type { CallToolResult, McpServer } from "@modelcontextprotocol/server";
import { z } from "zod";

import { capLabel, type SolverConfig } from "@/app/components/admin/plannerModel";
import type { MemberOption } from "@/app/components/admin/serviceCardModel";
import { displayMemberName } from "@/app/utils/memberRuleNames";
import { adminMembersQuery } from "@/app/utils/serviceReadQueries";
import { SLACK_V3_NOTE } from "@/app/utils/sundayCadence";
import { readRules } from "@/app/utils/v3MonthPlanReads";
import { operationalClient } from "@/sanity/lib/operationalClient";
import { runReadTool, successResult } from "../reads/errors";

export const GET_SOLVER_RULES_INPUT = z.object({}).strict();

export const GET_SOLVER_RULES_DESCRIPTION =
  "Muestra las reglas del solver tal como /admin → Generar mes → Reglas: las listas (Líder Domingo, Líder Sábado, " +
  "Soporte) con sus nombres, y cada regla como una línea en español. Patrones: Sun = domingo, Sat = sábado; Lead, " +
  "BGV, Choir (coro); «*» = cualquier lugar; «!» = nunca; «sem.N» = solo esa semana del mes; «sem−N» = semanas del " +
  "mes menos N. Solo lee: no cambia nada.";

export interface GetSolverRulesDeps {
  rules: () => Promise<{ config: SolverConfig }>;
  members: () => Promise<MemberOption[]>;
}

const defaultDeps: GetSolverRulesDeps = {
  rules: readRules,
  members: async () => {
    const q = adminMembersQuery(true);
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
  const personas = config.restrictions.map((r) => {
    const clauses = [
      ...r.excludedPatterns.map((p) => `nunca ${p}`),
      ...r.weekExclusions.map((w) => `sem.${w.week}: nunca ${w.pattern}`),
      ...r.caps.map(capLabel),
      ...(r.fairness === "exempt" ? ["exenta de carga total"] : []),
      ...(r.fairness === "slack" ? [`holgura ${r.fairnessSlack} · ${SLACK_V3_NOTE}`] : []),
      ...(r.sundayCadence === "alternate" ? ["Mes por medio"] : []),
    ];
    return `${r.person}: ${clauses.length ? clauses.join(" · ") : "sin cláusulas"}`;
  });
  const noJuntos = config.conflicts.map((c) => `${c.personA} ≠ ${c.personB} en ${c.pattern}`);
  const presencia = config.presence.map((p) => `al menos uno de ${p.persons.join(", ")} en ${p.pattern} cada semana`);
  return { listas: pools, personas, noJuntos, presencia };
}

export async function getSolverRulesResult(_args: Record<string, never>, deps: GetSolverRulesDeps = defaultDeps): Promise<CallToolResult> {
  return runReadTool("get_solver_rules", async () => {
    const [{ config }, members] = await Promise.all([deps.rules(), deps.members()]);
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
    async () => getSolverRulesResult({}),
  );
}
