// Lead-pool members who did not hold Sun.Lead / Sat.Lead in the calendar month
// before the month being planned. Read-only visibility for the planner — does
// not affect solver randomness or fairness objectives.

import type { RankMember } from "./candidateRanking";
import { patternMatches, type RuleRow } from "./ruleEnforcement";
import {
  memberFitsPool,
  memberIdToName,
  type SolverConfig,
  type SolverHistoryEntry,
} from "./plannerModel";

export type LeadRoleKey = "Sun.Lead" | "Sat.Lead";

export const SPANISH_MONTHS = [
  "Enero", "Febrero", "Marzo", "Abril", "Mayo", "Junio",
  "Julio", "Agosto", "Septiembre", "Octubre", "Noviembre", "Diciembre",
];

export interface PriorMonthLeadVisibility {
  role: LeadRoleKey;
  serviceLabel: string;
  priorMonthLabel: string;
  hasPriorMonthEntry: boolean;
  names: string[];
}

const LEAD_ROW: RuleRow = { id: "lead" };

export function priorCalendarMonth(year: number, month: number): { year: number; month: number; key: string } {
  if (month <= 1) return { year: year - 1, month: 12, key: `${year - 1}-12` };
  return { year, month: month - 1, key: `${year}-${month - 1}` };
}

function isExcludedFromLead(config: SolverConfig, memberId: string, service: "Sun" | "Sat"): boolean {
  const restriction = config.restrictions.find((r) => r.person === memberId);
  if (!restriction) return false;
  const column = {
    type: service === "Sun" ? "sunday_role" as const : "saturday_role" as const,
    date: "",
  };
  return restriction.excludedPatterns.some((pattern) => patternMatches(pattern, column, LEAD_ROW));
}

/**
 * Filtered by live Tipo, like every other reader of these ids. The stored pools
 * are ticks made in the past; `buildSolveRequest` drops the ones Tipo no longer
 * supports and `poolTipoMismatch` surfaces them for removal (ADR-0029). This
 * read did neither, so it could name someone in "did not lead last month" who
 * can no longer be assigned at all — presenting an unschedulable member as an
 * available lead, which is the opposite of what the panel is for.
 */
function leadPoolMemberIds(
  config: SolverConfig,
  service: "Sun" | "Sat",
  members: Array<{ _id: string; memberType?: string[] }>,
): string[] {
  const byId = new Map(members.map((m) => [m._id, m]));
  const fits = (id: string, field: "sundayLeads" | "saturdayLeads") =>
    memberFitsPool(byId.get(id), field);
  if (service === "Sun") return config.sundayLeads.filter((id) => fits(id, "sundayLeads"));
  // Dedupe against the FILTERED Sunday pool, exactly as `buildSolveRequest`
  // does. Against the raw ticks, a member with a stale `sundayLeads` tick and a
  // valid Saturday Tipo was dropped from the Sunday column for Tipo and from
  // the Saturday column for the tick — absent from both, while the solver had
  // them in its Saturday pool. A panel whose job is "who has not led" cannot
  // afford to lose someone to bookkeeping.
  const sundayEligible = new Set(config.sundayLeads.filter((id) => fits(id, "sundayLeads")));
  return config.saturdayLeads.filter((id) => !sundayEligible.has(id) && fits(id, "saturdayLeads"));
}

function displayNameForMember(id: string, members: RankMember[]): string {
  const m = members.find((x) => x._id === id);
  return m?.alias?.trim() || memberIdToName(id, members);
}

export function priorMonthLeadVisibility(input: {
  config: SolverConfig;
  members: RankMember[];
  history: SolverHistoryEntry[];
  year: number;
  month: number;
  role: LeadRoleKey;
}): PriorMonthLeadVisibility {
  const { config, members, history, year, month, role } = input;
  const service = role === "Sun.Lead" ? "Sun" : "Sat";
  const prior = priorCalendarMonth(year, month);
  const entry = history.find(
    (h) => h.key === prior.key || (h.year === prior.year && h.month === prior.month),
  );
  const priorMonthLabel = `${SPANISH_MONTHS[prior.month - 1]} ${prior.year}`;

  const names: string[] = [];
  for (const id of leadPoolMemberIds(config, service, members)) {
    if (isExcludedFromLead(config, id, service)) continue;
    const name = memberIdToName(id, members);
    const priorCount = entry?.role_counts[name]?.[role] ?? 0;
    if (priorCount <= 0) names.push(displayNameForMember(id, members));
  }
  names.sort((a, b) => a.localeCompare(b, "es"));

  return {
    role,
    serviceLabel: service === "Sun" ? "Domingo" : "Sábado",
    priorMonthLabel,
    hasPriorMonthEntry: !!entry,
    names,
  };
}

export function bothPriorMonthLeadVisibilities(input: {
  config: SolverConfig;
  members: RankMember[];
  history: SolverHistoryEntry[];
  year: number;
  month: number;
}): { sunday: PriorMonthLeadVisibility; saturday: PriorMonthLeadVisibility } {
  return {
    sunday: priorMonthLeadVisibility({ ...input, role: "Sun.Lead" }),
    saturday: priorMonthLeadVisibility({ ...input, role: "Sat.Lead" }),
  };
}
