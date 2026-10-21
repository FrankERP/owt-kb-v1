// `apply_schedule`'s observation `O` and its phase-3 checks (P4 on solver v3, step 6; D7).
//
// R-OBS: every cumulative fact comes from one observation read from data at the start of the
// call. The stored `state` is a cache that may lag (a failed `state` write, a killed call): it
// can ADD facts (a created draft later deleted in /admin stays «created»), never stand in for a
// read.
//
//   own      = each draft whose `receiptIdForRequestId(creationRequestId)` equals a snapshot
//              row's `creationReceiptId` → that row. Only that draft's own create transaction
//              stamps that id (`roleWriteRequest.ts`), so `own` is proof, not inference.
//   created  = own ∪ state.created (by localId). A `state` entry with no row was created and
//              then deleted in /admin; any entry whose row's type, service day or name differs
//              from its draft was modified there. Neither is ever re-created.
//   pending  = the drafts creatable at solve (A2) not in `created`.
//   stored   = the horizon's role ids minus every row of `created` (check (c)).

import { receiptIdForRequestId } from "@/app/utils/roleCreationReceipt";
import { serviceDayKey } from "@/app/utils/serviceReadSelect";
import { isSpecialRoleType } from "@/app/utils/roleWriteRequest";
import { horizonRoleIds } from "@/app/utils/v3MonthPlan";
import type { V3PlanSources } from "@/app/utils/v3MonthPlanReads";
import { refuseSpecialOn, type CalendarExistingRole } from "@/app/components/admin/plannerCalendar";
import { integrityQueueFor } from "@/app/components/admin/monthPreflight";
import { describePreflightReason, monthTargetPreflight } from "@/app/components/admin/serviceCardModel";
import { v3TargetOf } from "@/app/components/admin/v3Board";
import { V3_CONNECTOR_LINES as L } from "@/app/components/admin/v3Copy";
import type { DraftCard } from "@/app/components/admin/plannerModel";
import type { ProposalDraft, StoredProposal } from "./proposalDocument";
import { draftLabel } from "./labels";

type Row = Readonly<Record<string, unknown>>;

export interface CreatedFact {
  roleId: string;
  /** How this call knows: the role's receipt id (proof) or only the proposal's `state` (cache). */
  via: "receipt" | "state";
  /** The role's row now, or `null` when it is gone (deleted in /admin). */
  row: Row | null;
}

export interface ProposalObservation {
  created: Map<string, CreatedFact>;
  deleted: Set<string>;
  modified: Set<string>;
  pending: ProposalDraft[];
  /** The horizon's stored role ids now, minus every row of `created`. */
  stored: string[];
}

const rowDay = (row: Row): string | null => serviceDayKey(row.week ?? row.date);

function rowTarget(row: Row): string | null {
  const day = rowDay(row);
  if (!day || typeof row._type !== "string") return null;
  return v3TargetOf({ type: row._type as DraftCard["_type"], date: day, serviceName: typeof row.service_name === "string" ? row.service_name : undefined });
}

const draftTarget = (d: DraftCard): string => v3TargetOf({ type: d._type, date: d.date, serviceName: d.service_name });

export function observeProposal(proposal: StoredProposal, roles: ReadonlyArray<Row>): ProposalObservation {
  const byReceipt = new Map<string, Row>();
  const byId = new Map<string, Row>();
  for (const row of roles) {
    if (typeof row.creationReceiptId === "string") byReceipt.set(row.creationReceiptId, row);
    if (typeof row._id === "string") byId.set(row._id, row);
  }

  const created = new Map<string, CreatedFact>();
  for (const { draft } of proposal.payload.drafts) {
    const receipt = receiptIdForRequestId(draft.creationRequestId);
    const row = receipt ? byReceipt.get(receipt) : undefined;
    if (row && typeof row._id === "string") created.set(draft.localId, { roleId: row._id, via: "receipt", row });
  }
  for (const [localId, roleId] of Object.entries(proposal.state.created)) {
    if (!created.has(localId)) created.set(localId, { roleId, via: "state", row: byId.get(roleId) ?? null });
  }

  const draftOf = new Map(proposal.payload.drafts.map((d) => [d.draft.localId, d.draft]));
  const deleted = new Set<string>();
  const modified = new Set<string>();
  for (const [localId, fact] of created) {
    const draft = draftOf.get(localId);
    if (!fact.row) deleted.add(localId);
    else if (draft && rowTarget(fact.row) !== draftTarget(draft)) modified.add(localId);
  }

  const pending = proposal.payload.drafts.filter((d) => d.atSolve === "creatable" && !created.has(d.draft.localId));
  const createdIds = new Set([...created.values()].map((f) => f.roleId));
  const stored = horizonRoleIds(roles, proposal.header.months).filter((id) => !createdIds.has(id));
  return { created, deleted, modified, pending, stored };
}

/**
 * Phase 3 (D7, A4): the lines that refuse the whole call, or `[]`.
 *   (a) the fresh preflight of every pending draft, built exactly as /admin builds it;
 *   (b) any special stored on a pending special's date (the preflight is name-blind and the
 *       create route refuses only the same normalized name, ADR-0011);
 *   (c) the horizon's stored services are the ones frozen at solve.
 */
export function phase3Refusals(proposal: StoredProposal, obs: ProposalObservation, sources: V3PlanSources): string[] {
  const { snapshot, adminRoles } = sources;
  const readiness = snapshot.readiness;
  const summaries = { roles: readiness.roleSummary, setlists: readiness.setlistSummary, proposals: readiness.proposalSummary };
  const queue = integrityQueueFor({ sources: readiness.sources, roles: adminRoles, summaries });
  const lines: string[] = [];

  for (const { draft } of obs.pending) {
    const pf = monthTargetPreflight({ sources: readiness.sources, summaries, queue, type: draft._type, date: draft.date });
    if (pf.state !== "creatable") {
      const reasons = pf.reasons.length ? pf.reasons.map(describePreflightReason).join(", ") : pf.state;
      lines.push(L.targetLost(draftLabel(draft), reasons));
    }
  }

  const createdIds = new Set([...obs.created.values()].map((f) => f.roleId));
  const others: CalendarExistingRole[] = snapshot.roles
    .filter((r) => typeof r._id === "string" && !createdIds.has(r._id) && typeof r._type === "string" && rowDay(r))
    .map((r) => ({
      _type: r._type as string,
      date: rowDay(r)!,
      ...(typeof r.service_name === "string" ? { service_name: r.service_name } : {}),
    }));
  for (const { draft } of obs.pending) {
    if (!isSpecialRoleType(draft._type)) continue;
    const refusal = refuseSpecialOn({ date: draft.date, weekendSelected: false, specials: [], existingRoles: others });
    if (refusal) lines.push(L.specialTaken(draftLabel(draft), refusal));
  }

  const frozen = [...proposal.payload.storedServiceIds].sort();
  const now = [...obs.stored].sort();
  if (frozen.length !== now.length || frozen.some((id, i) => id !== now[i])) lines.push(L.storedChanged(proposal.header.months));

  return lines;
}
