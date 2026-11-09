// The server reads behind the MCP month planner (MCP P4 step 4): the same sources the
// `/admin` planner holds when its v3 Auto runs, read here without a browser.
//
//   - the admin roles rows (`adminRolesQuery`, the roles GET's own GROQ) — the planner's
//     `existingRoles`, `allRoles` and `storedSource.roles`;
//   - the members (`adminMembersQuery(allMembers)`, bound by the CALLER as the members GET
//     binds it from the live role: `true` only for a super-admin (`readsAllMembers` in
//     `app/mcp/monthProposals/principal.ts`), `false` for a worship admin. `true` does not
//     add a field: it turns the worship filter OFF (`WORSHIP_MEMBER_GROQ_FILTER`'s `$all`
//     arm) and returns every ministry's members — ADR-0075's isolation holds at the query,
//     not downstream. The availability sweep binds `true` explicitly, as it always read;
//   - the stored rules and their `_rev`, through the route GET's own body and the
//     browser's own `sourceFromGet` (an absent document solves with the defaults and
//     binds `rev: null`; a present one without a revision is a failed read, as there);
//   - the P1 service snapshot (`loadServiceSnapshot`, ADR-0040): the five source states,
//     the three integrity summaries and the canonical role rows (`ROLE_PROJECTION`,
//     which carries each role's `creationReceiptId`).
//
// The snapshot is read AFTER the admin roles rows, so a role created between the two
// reads is in the snapshot's rows: apply's observation recognises its own create from
// them, and the reverse order could refuse the proposal's own service as taken.
//
// Every row the browser receives crossed a JSON response, so each read here goes
// through one JSON round trip: both surfaces hand the shared functions equal inputs.
//
// Each read is isolated, so a failure names its source and is never an empty list.

import "server-only";

import { operationalClient } from "@/sanity/lib/operationalClient";
import { adminMembersQuery, adminRolesQuery } from "@/app/utils/serviceReadQueries";
import { loadStoredSolverConfig, solverConfigGetBody } from "@/app/utils/solverConfigRead";
import { loadFairnessLedger } from "@/app/utils/fairnessLedgerRead";
import { fairnessRecordEnvironment, resolveSolverEngine } from "@/app/utils/solverDeployment";
import type { FairnessLedgerResponse } from "@/app/utils/fairnessVocabulary";
import { loadServiceSnapshot, type ServiceSnapshot } from "@/app/mcp/reads/serviceSnapshot";
import { editableConfig, sourceFromGet } from "@/app/components/admin/solverConfigSource";
import { serviceTodayIso } from "@/app/components/admin/serviceReadiness";
import type { MemberOption, ServiceRole } from "@/app/components/admin/serviceCardModel";
import type { SolverConfig } from "@/app/components/admin/plannerModel";

export type V3PlanReadSource = "roles" | "members" | "rules" | "snapshot";

export interface V3PlanRules {
  /** The stored document's `_rev`; `null` when the document is absent (the defaults). */
  rev: string | null;
  config: SolverConfig;
}

export interface V3PlanSources {
  adminRoles: ServiceRole[];
  members: MemberOption[];
  rules: V3PlanRules;
  snapshot: ServiceSnapshot;
}

export type V3PlanSourcesResult =
  | { ok: true; value: V3PlanSources }
  | { ok: false; failed: V3PlanReadSource[] };

const viaJson = <T>(value: unknown): T => JSON.parse(JSON.stringify(value)) as T;

async function settle<T>(run: () => Promise<T>): Promise<{ ok: true; value: T } | { ok: false }> {
  try {
    return { ok: true, value: await run() };
  } catch {
    return { ok: false };
  }
}

/** The stored rules as the planner reads them (exported for `get_solver_rules`). */
export async function readRules(): Promise<V3PlanRules> {
  const source = sourceFromGet(true, viaJson(solverConfigGetBody(await loadStoredSolverConfig())));
  const config = editableConfig(source);
  if (!config) throw new Error("rules");
  return { rev: source.status === "ready" ? source.rev : null, config };
}

/**
 * Which members the read returns. REQUIRED, with no default, so `tsc` refuses a call site that has
 * not chosen: `true` is every ministry's members (a super-admin's view), `false` worship only.
 */
export interface V3PlanReadScope {
  allMembers: boolean;
}

export async function loadV3PlanSources(scope: V3PlanReadScope): Promise<V3PlanSourcesResult> {
  const roles = adminRolesQuery();
  const members = adminMembersQuery(scope.allMembers);
  const [rolesRead, membersRead, rulesRead] = await Promise.all([
    settle(async () => {
      const rows: unknown = await operationalClient.fetch(roles.query, roles.params);
      if (!Array.isArray(rows)) throw new Error("roles");
      return viaJson<ServiceRole[]>(rows);
    }),
    settle(async () => {
      const rows: unknown = await operationalClient.fetch(members.query, members.params);
      if (!Array.isArray(rows)) throw new Error("members");
      return viaJson<MemberOption[]>(rows);
    }),
    settle(readRules),
  ]);
  // After the roles rows, never beside them (see the file header).
  const snapshotRead = await settle(loadServiceSnapshot);

  const failed: V3PlanReadSource[] = [];
  if (!rolesRead.ok) failed.push("roles");
  if (!membersRead.ok) failed.push("members");
  if (!rulesRead.ok) failed.push("rules");
  if (!snapshotRead.ok) failed.push("snapshot");
  if (!rolesRead.ok || !membersRead.ok || !rulesRead.ok || !snapshotRead.ok) {
    console.error("[mcp-month-plan] read failed:", failed.join(","));
    return { ok: false, failed };
  }
  return {
    ok: true,
    value: { adminRoles: rolesRead.value, members: membersRead.value, rules: rulesRead.value, snapshot: snapshotRead.value },
  };
}

/**
 * The fairness ledger for a horizon, with the arguments `GET /api/admin/fairness` passes
 * (C2 IF2-8). Throws on any failure, as the route answers non-200 — the caller refuses.
 */
export function loadV3Ledger(months: readonly string[]): Promise<FairnessLedgerResponse> {
  return loadFairnessLedger({
    month: months[0],
    horizon: months.length === 2 ? 2 : 1,
    currentMonth: serviceTodayIso().slice(0, 7),
    engine: resolveSolverEngine(process.env),
    environment: fairnessRecordEnvironment(process.env),
  });
}
