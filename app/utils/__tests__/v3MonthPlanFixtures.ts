// Shared by the MCP P4 month-planner suites — NOT a test file (no `.test.` in the name).
// Fictitious people only (the repository is public). The deps of `planV3Month` over injected
// transports: four ready reads, a ledger for the asked horizon, a solver that answers success.
import { vi } from "vitest";

import type { V3MonthPlanDeps } from "../v3MonthPlan";
import type { V3PlanSources } from "../v3MonthPlanReads";
import type { ServiceSnapshot } from "@/app/mcp/reads/serviceSnapshot";
import type { V3SolveRequest } from "@/app/components/admin/v3Wire";
import { MEMBERS, config, ledgerResponse } from "@/app/components/admin/__tests__/v3Fixtures";

export const POOLS = config({ sundayLeads: ["m-ana", "m-bruno"], saturdayLeads: ["m-carla"], support: ["m-dani"] });
const READY = { roles: "ready", members: "ready", proposals: "ready", roleTargets: "ready", setlistTargets: "ready" } as const;

export function snapshot(over: { sources?: Record<string, string>; roles?: Record<string, unknown>[] } = {}): ServiceSnapshot {
  return {
    readiness: {
      sources: { ...READY, ...(over.sources ?? {}) },
      failedSources: [],
      roleSummary: { targets: [], recordIssues: [], lockIssues: [] },
      setlistSummary: { targets: [], recordIssues: [] },
      proposalSummary: { records: [], serviceRefConflicts: [], targetKeyConflicts: [], recordIssues: [], draftIds: [] },
      rolesById: new Map(),
      proposalsById: new Map(),
      rawProposalDrafts: [],
    },
    roles: over.roles ?? [],
    setlists: [],
  } as unknown as ServiceSnapshot;
}

export function sources(over: Partial<V3PlanSources> = {}): V3PlanSources {
  return {
    adminRoles: [],
    members: MEMBERS as unknown as V3PlanSources["members"],
    rules: { rev: "rules-rev-1", config: POOLS },
    snapshot: snapshot(),
    ...over,
  };
}

export function successFor(request: V3SolveRequest, assignments: Record<string, Record<string, string[]>> = {}): string {
  return JSON.stringify({
    ok: true, contract: 3, engine: "v3", solver_version: "3.1.0", build: "t", request_id: request.request_id, seed: request.seed,
    months: request.months, reproducible: true, assignments, unfilled: [], pins: { requested: 0, honored: 0 }, violations: [],
    violation_ceiling: { value: 0, proven: true }, stages: [], total_ms: 1,
    fairness: { scale: 100, tolerance: 35, lines: [], people: [] }, cadence: [], missed: [], notices: [],
  });
}

export type Spied = V3MonthPlanDeps & { reads: ReturnType<typeof vi.fn>; readLedger: ReturnType<typeof vi.fn>; solve: ReturnType<typeof vi.fn> };

export function deps(over: Partial<V3MonthPlanDeps> = {}): Spied {
  return {
    reads: vi.fn(async () => ({ ok: true as const, value: sources() })),
    readLedger: vi.fn(async (months: readonly string[]) => ledgerResponse([...months])),
    solve: vi.fn(async (request: V3SolveRequest) => ({ status: 200, text: successFor(request) })),
    elapsedMs: () => 1_000,
    todayIso: "2026-10-20",
    seed: 7,
    requestId: "req-1",
    ...over,
  } as Spied;
}

