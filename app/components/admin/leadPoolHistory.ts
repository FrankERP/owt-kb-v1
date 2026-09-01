// Lead-pool members who did not hold Sun.Lead / Sat.Lead in the calendar month
// before the month being planned. Read-only visibility for the planner — does
// not affect solver randomness or fairness objectives.

import type { RankMember } from "./candidateRanking";
import { patternMatches, type RuleRow } from "./ruleEnforcement";
import {
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

function leadPoolMemberIds(config: SolverConfig, service: "Sun" | "Sat"): string[] {
  if (service === "Sun") return [...config.sundayLeads];
  const sundaySet = new Set(config.sundayLeads);
  return config.saturdayLeads.filter((id) => !sundaySet.has(id));
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
  for (const id of leadPoolMemberIds(config, service)) {
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
