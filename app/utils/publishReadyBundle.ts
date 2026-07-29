// Server-authoritative readiness reload + guard-bundle assembly (Plan B item 3).
//
// The client's `Publicar listos` selection is a hint, never an authorization. This
// module is what makes the publish endpoints authoritative:
//
//  1. `loadServiceReadinessSources()` RELOADS all five A1 read domains through the
//     canonical operational clients and A1's own bound query builders (the same
//     fetches the three `service-integrity` GET routes use), with per-domain
//     failure isolation — a failed domain becomes `error`, never a clean `none`.
//  2. `assembleService()` runs A1's pure assembly (`buildRoleTargets`,
//     `buildSetlistTargets`, `buildProposalSummary`) into the SHARED pure
//     predicate `deriveServiceReadiness`. Nothing is re-derived here.
//  3. `buildPublishAssertion()` turns that same observation into A2's
//     `PublishReadyAssertion`, so the transaction asserts precisely the state the
//     readiness decision was made from: role + weekend lock (or the special role's
//     own revision), the setlist singleton id/rev or an explicit `none`, the
//     proposal singleton id/rev or an explicit absence, and EVERY assigned member
//     revision used for availability across all five seat paths.
//  4. `mergeAssertionOps()` collapses ops that address the same document across a
//     batch (two services sharing a member), because two `ifRevisionId` patches on
//     one document inside one transaction cannot both hold.
//
// Reads only. The business transaction stays in its route handler, as with every
// other A2 writer. `server-only` keeps the tokened clients out of any bundle.

import "server-only";

import { operationalClient, rawIntegrityClient } from "@/sanity/lib/operationalClient";
import {
  allRoleTargetLocksQuery,
  canonicalMembersByIdsQuery,
  canonicalProposalsQuery,
  canonicalRolesByIdsQuery,
  canonicalRolesQuery,
  canonicalSetlistsQuery,
  rawProposalDraftsQuery,
  rawRoleDraftsForBaseIdsQuery,
  rawRoleDraftsQuery,
  rawSetlistDraftsQuery,
} from "@/app/utils/serviceReadQueries";
import {
  deriveServiceReadiness,
  derivePublishState,
  lockIssuesToIntegrity,
  type ObservedTargetState,
  type ProposalObservation,
  type PublishState,
  type ServiceReadiness,
  type ServiceSourceKey,
  type ServiceSourceStates,
} from "@/app/components/admin/serviceReadiness";
import {
  normalizeBaseId,
  proposalTargetKey,
  setlistTargetKey,
  type CanonicalMember,
  type RoleType,
} from "./serviceReadModel";
import {
  buildProposalSummary,
  buildRoleTargets,
  buildSetlistTargets,
  collectRoleMemberRefs,
  type ProposalDomainSummary,
  type RoleDomainSummary,
  type RoleTargetRecord,
  type SetlistDomainSummary,
  type SetlistTarget,
} from "./serviceReadSummary";
import {
  planPublishReadyAssertions,
  type AssertionOp,
  type ObservedMemberAvailability,
  type ObservedSingleton,
  type PublishReadyAssertion,
  type PublishReadyPlan,
} from "./publishReadyTransaction";
import {
  isCanonicalDocumentId,
  isRevisionString,
  roleDateField,
  PUBLISH_BATCH_MAX,
  type ParseResult,
} from "./roleWriteRequest";
import {
  isPublishWorkflowBlocker,
  type PublishWorkflowBlocker,
} from "@/app/components/admin/publishSelection";

function isObj(v: unknown): v is Record<string, unknown> {
  return !!v && typeof v === "object";
}

function nonEmptyString(v: unknown): v is string {
  return typeof v === "string" && v.length > 0;
}

// ── Domain reload ───────────────────────────────────────────────────────────

type FetchOutcome<T> = { ok: true; rows: T[] } | { ok: false; rows: T[] };

async function attempt<T>(
  label: string,
  bound: { query: string; params: Record<string, unknown> },
  raw = false,
): Promise<FetchOutcome<T>> {
  try {
    const client = raw ? rawIntegrityClient : operationalClient;
    const rows = await client.fetch<T[]>(bound.query, bound.params);
    return { ok: true, rows: Array.isArray(rows) ? rows : [] };
  } catch (err) {
    // A failed domain is reported as `error` and becomes a hard blocker. It is
    // never silently downgraded to an empty/clean observation.
    console.error(`[publishReadyBundle] ${label} read failed:`, err);
    return { ok: false, rows: [] };
  }
}

export interface ServiceReadinessSources {
  /** Per-domain state; `error` for any domain whose reload failed. */
  sources: ServiceSourceStates;
  failedSources: ServiceSourceKey[];
  roleSummary: RoleDomainSummary;
  setlistSummary: SetlistDomainSummary;
  proposalSummary: ProposalDomainSummary;
  /** Canonical role documents by id — the committed state side effects derive from. */
  rolesById: Map<string, Record<string, unknown>>;
  /** Canonical proposal documents by id, for the proposal guard's no-op value. */
  proposalsById: Map<string, Record<string, unknown>>;
  /** Raw `drafts.*` proposals, associated per service through BOTH indexes. */
  rawProposalDrafts: Record<string, unknown>[];
}

/**
 * Reload the five A1 read domains. Every canonical read goes through the
 * published-perspective operational client; only raw-draft inventory uses the raw
 * client, exactly as A1 specifies.
 */
export async function loadServiceReadinessSources(): Promise<ServiceReadinessSources> {
  const [roles, roleDrafts, locks, setlists, setlistDrafts, proposals, proposalDrafts] =
    await Promise.all([
      attempt<Record<string, unknown>>("roles", canonicalRolesQuery()),
      attempt<Record<string, unknown>>("roleDrafts", rawRoleDraftsQuery(), true),
      attempt<Record<string, unknown>>("locks", allRoleTargetLocksQuery()),
      attempt<Record<string, unknown>>("setlists", canonicalSetlistsQuery()),
      attempt<Record<string, unknown>>("setlistDrafts", rawSetlistDraftsQuery(), true),
      attempt<Record<string, unknown>>("proposals", canonicalProposalsQuery()),
      attempt<Record<string, unknown>>("proposalDrafts", rawProposalDraftsQuery(), true),
    ]);

  const memberRefs = roles.ok ? collectRoleMemberRefs(roles.rows) : [];
  const members: FetchOutcome<CanonicalMember> = !roles.ok
    ? { ok: false, rows: [] }
    : memberRefs.length === 0
      ? { ok: true, rows: [] }
      : await attempt<CanonicalMember>("members", canonicalMembersByIdsQuery(memberRefs));

  const sources: ServiceSourceStates = {
    roles: roles.ok ? "ready" : "error",
    members: members.ok ? "ready" : "error",
    proposals: proposals.ok && proposalDrafts.ok ? "ready" : "error",
    roleTargets: roleDrafts.ok && locks.ok ? "ready" : "error",
    setlistTargets: setlists.ok && setlistDrafts.ok ? "ready" : "error",
  };
  const failedSources = (Object.keys(sources) as ServiceSourceKey[]).filter(
    (key) => sources[key] !== "ready",
  );

  const membersById = new Map<string, CanonicalMember>();
  for (const member of members.rows) {
    if (member && nonEmptyString(member._id)) membersById.set(member._id, member);
  }

  // A failed lock inventory is passed as `null` — "not inventoried" — so no lock
  // issue is invented; the `roleTargets: error` source already blocks the publish.
  const roleSummary = buildRoleTargets(
    roles.rows,
    roleDrafts.rows,
    membersById,
    locks.ok ? locks.rows : null,
  );

  const specialRolesWithSongs = roles.rows.filter(
    (r) => isObj(r) && r._type === "special_role" && r.songs !== undefined,
  );
  const setlistSummary = buildSetlistTargets(
    setlists.rows,
    setlistDrafts.rows,
    specialRolesWithSongs,
  );

  const rolesById = new Map<string, Record<string, unknown>>();
  for (const role of roles.rows) {
    if (isObj(role) && nonEmptyString(role._id)) rolesById.set(role._id, role);
  }
  const proposalSummary = buildProposalSummary(proposals.rows, proposalDrafts.rows, (ref) =>
    rolesById.get(ref) ?? null,
  );
  const proposalsById = new Map<string, Record<string, unknown>>();
  for (const doc of proposals.rows) {
    if (isObj(doc) && nonEmptyString(doc._id)) proposalsById.set(doc._id, doc);
  }

  return {
    sources,
    failedSources,
    roleSummary,
    setlistSummary,
    proposalSummary,
    rolesById,
    proposalsById,
    rawProposalDrafts: proposalDrafts.rows.filter(isObj),
  };
}

// ── Per-service observation ─────────────────────────────────────────────────

export interface ServiceObservation {
  roleId: string;
  roleRev: string;
  roleType: RoleType;
  dateField: "week" | "date";
  serviceDate: string;
  /** A special service is its own target and takes NO weekend lock. */
  special: boolean;
  lock: { id: string; rev: string } | null;
  setlist: ObservedSingleton;
  /** The observed stored `week` of a weekend setlist singleton (its no-op value). */
  setlistWeek: string | null;
  proposal: ObservedSingleton;
  proposalServiceDate: string | null;
  /** Every assigned member across all five seat paths, at its observed revision. */
  members: ObservedMemberAvailability[];
  /**
   * Observations that are NOT a clean singleton-or-absent. Non-empty means no
   * assertion may be built at all — the guard bundle would be incomplete.
   */
  unsafe: string[];
  /** The canonical role document, for post-commit side effects. */
  role: Record<string, unknown>;
}

export interface AssembledService {
  readiness: ServiceReadiness;
  /** Null when the record itself is unusable — there is nothing safe to guard. */
  observation: ServiceObservation | null;
}

function proposalKind(roleType: string): "sunday" | "saturday" | "special" {
  if (roleType === "saturday_role") return "saturday";
  if (roleType === "special_role") return "special";
  return "sunday";
}

const EMPTY_SETLIST_BODY = { setlistId: null, songs: [] as unknown[], recentSongs: {} };

interface SetlistObservation {
  /** A1's admin setlist GET body, exactly as `deriveSetlist` consumes it. */
  body: unknown;
  observed: ObservedSingleton;
  week: string | null;
  unsafe: boolean;
}

/**
 * Rebuild A1's admin setlist GET body from the reloaded `setlistTargets` domain.
 * The song rows are not re-projected — readiness consumes `contentState`, which
 * A1's summary already computed from the canonical `songs` array — so the body
 * carries the target/observed/content facts the shared predicate reads and nothing
 * it does not.
 */
function observeSetlist(record: RoleTargetRecord, sources: ServiceReadinessSources): SetlistObservation {
  if (sources.sources.setlistTargets !== "ready") {
    return { body: null, observed: { state: "none" }, week: null, unsafe: true };
  }
  const key = record.serviceDate
    ? setlistTargetKey(record.type, record.serviceDate, record.id)
    : null;
  const target: SetlistTarget | null = key
    ? (sources.setlistSummary.targets.find((t) => t.targetKey === key) ?? null)
    : null;

  if (!key) {
    return {
      body: { ...EMPTY_SETLIST_BODY, targetState: "invalid", reason: "target_key", recordIds: [record.id] },
      observed: { state: "none" },
      week: null,
      unsafe: true,
    };
  }
  if (!target) {
    return {
      body: { ...EMPTY_SETLIST_BODY, targetState: "none", observed: { state: "none" } },
      observed: { state: "none" },
      week: null,
      unsafe: false,
    };
  }
  if (target.draftIds.length > 0) {
    return {
      body: {
        ...EMPTY_SETLIST_BODY,
        targetState: "draft_conflict",
        draftIds: target.draftIds,
        canonicalIds: target.canonicalIds,
      },
      observed: { state: "none" },
      week: null,
      unsafe: true,
    };
  }
  if (target.canonicalState === "duplicate") {
    return {
      body: {
        ...EMPTY_SETLIST_BODY,
        targetState: "duplicate",
        conflictingIds: target.canonicalIds,
        draftIds: target.draftIds,
      },
      observed: { state: "none" },
      week: null,
      unsafe: true,
    };
  }
  const single = target.records.length === 1 ? target.records[0] : null;
  if (
    target.canonicalState !== "single" ||
    !single ||
    !nonEmptyString(single.id) ||
    !nonEmptyString(single.rev)
  ) {
    return {
      body: {
        ...EMPTY_SETLIST_BODY,
        targetState: "invalid",
        reason: "malformed_canonical_record",
        recordIds: target.canonicalIds,
      },
      observed: { state: "none" },
      week: null,
      unsafe: true,
    };
  }
  return {
    body: {
      targetState: "single",
      contentState: target.contentState,
      observed: { state: "single", id: single.id, rev: single.rev },
      setlistId: single.id,
      songs: [],
      recentSongs: {},
    },
    observed: { state: "single", id: single.id, rev: single.rev },
    // A weekend target key matched on the role's own date, so this IS the stored
    // `week` of that setlist document; a special role stores songs on itself and
    // is covered by the role assertion instead.
    week: record.type === "special_role" ? null : record.serviceDate,
    unsafe: false,
  };
}

interface ProposalObservationResult {
  observation: ProposalObservation | null;
  observed: ObservedSingleton;
  serviceDate: string | null;
  unsafe: boolean;
}

/**
 * A1's already-grouped proposal answer for exactly ONE service, reached through
 * BOTH indexes (the role reference and the normalized target key), canonical and
 * raw — a proposal that references another role but occupies this service's date
 * still counts.
 */
function observeProposal(
  record: RoleTargetRecord,
  sources: ServiceReadinessSources,
): ProposalObservationResult {
  if (sources.sources.proposals !== "ready") {
    return { observation: null, observed: { state: "none" }, serviceDate: null, unsafe: true };
  }
  const kind = proposalKind(record.type);
  const key = record.serviceDate
    ? proposalTargetKey(kind, record.serviceDate, record.id)
    : null;
  const associates = (serviceRef: string | null, targetKey: string | null) =>
    serviceRef === record.id || (!!key && targetKey === key);

  const associated = sources.proposalSummary.records.filter((r) =>
    associates(r.serviceRef, r.targetKey),
  );
  const validated = associated.filter((r) => r.valid);
  const recordIssues = associated
    .filter((r) => !r.valid)
    .map((r) => ({ id: r.id, issues: r.issues }));
  const conflicts = [
    ...sources.proposalSummary.serviceRefConflicts.filter((c) => c.key === record.id),
    ...sources.proposalSummary.targetKeyConflicts.filter((c) => !!key && c.key === key),
  ].map((c) => ({ key: c.key, ids: c.ids }));

  const draftIds: string[] = [];
  for (const draft of sources.rawProposalDrafts) {
    if (!nonEmptyString(draft._id)) continue;
    const ref = nonEmptyString(draft.service_ref) ? normalizeBaseId(draft.service_ref) : null;
    const sameDate =
      nonEmptyString(draft.service_date) &&
      draft.service_date === record.serviceDate &&
      draft.service_type === kind;
    if (ref === record.id || sameDate) draftIds.push(draft._id);
  }

  const observation: ProposalObservation = {
    validated: validated.map((r) => ({ id: r.id, status: r.status })),
    conflicts,
    recordIssues,
    draftIds,
  };

  if (validated.length > 1) {
    return { observation, observed: { state: "none" }, serviceDate: null, unsafe: true };
  }
  if (validated.length === 0) {
    return { observation, observed: { state: "none" }, serviceDate: null, unsafe: false };
  }
  const winner = validated[0];
  const stored = sources.proposalsById.get(winner.id);
  const serviceDate = stored && nonEmptyString(stored.service_date) ? stored.service_date : null;
  if (!nonEmptyString(winner.id) || !nonEmptyString(winner.rev) || !serviceDate) {
    return { observation, observed: { state: "none" }, serviceDate: null, unsafe: true };
  }
  return {
    observation,
    observed: { state: "single", id: winner.id, rev: winner.rev },
    serviceDate,
    unsafe: false,
  };
}

/**
 * Assemble ONE service's readiness plus the observation its guard bundle is built
 * from. Returns null only when the id names no canonical role and no record issue
 * at all — the caller answers `404` for that.
 */
export function assembleService(
  sources: ServiceReadinessSources,
  roleId: string,
): AssembledService | null {
  const roleDoc = sources.rolesById.get(roleId) ?? null;
  const target =
    sources.roleSummary.targets.find((t) => t.canonicalIds.includes(roleId)) ?? null;
  const record = target?.records.find((r) => r.id === roleId) ?? null;
  const recordIssue = sources.roleSummary.recordIssues.find((r) => r.id === roleId) ?? null;

  if (!roleDoc && !record && !recordIssue) return null;

  if (!target || !record) {
    // The role exists but is structurally unusable (or draft-only): an invalid
    // record, reported as such. There is nothing safe to guard.
    return {
      readiness: deriveServiceReadiness({
        sources: sources.sources,
        published: roleDoc?.published,
        recordValid: false,
        roleId,
        roleTarget: "invalid",
        roleTargetIds: recordIssue?.draftIds ?? [],
        team: { assignedRefs: [], danglingRefs: [] },
        setlistResponse: null,
        proposal: null,
        serviceDate: null,
        members: [],
      }),
      observation: null,
    };
  }

  const setlist = observeSetlist(record, sources);
  const proposal = observeProposal(record, sources);
  const lockIssues = lockIssuesToIntegrity(target.lockIssues);

  const readiness = deriveServiceReadiness({
    sources: sources.sources,
    published: record.published,
    recordValid: true,
    roleId,
    roleTarget: target.publicState as ObservedTargetState,
    roleTargetIds: [...target.canonicalIds, ...target.draftIds],
    team: { assignedRefs: record.assignedRefs, danglingRefs: record.danglingRefs },
    setlistResponse: setlist.body,
    proposal: proposal.observation,
    serviceDate: record.serviceDate,
    members: record.members,
    integrityIssues: lockIssues,
  });

  const special = record.type === "special_role";
  const unsafe: string[] = [];
  if (setlist.unsafe) unsafe.push("setlist");
  if (proposal.unsafe) unsafe.push("proposal");
  if (!nonEmptyString(record.rev)) unsafe.push("role_revision");
  if (!nonEmptyString(record.serviceDate)) unsafe.push("role_date");
  if (!special && !target.lock) unsafe.push("lock");
  if (record.danglingRefs.length > 0) unsafe.push("members");

  const members: ObservedMemberAvailability[] = record.members.map((m) => ({
    id: m._id,
    rev: m._rev,
    unavailableDates: Array.isArray(m.unavailableDates) ? [...m.unavailableDates] : null,
  }));

  return {
    readiness,
    observation: {
      roleId,
      roleRev: record.rev,
      roleType: record.type,
      dateField: roleDateField(record.type),
      serviceDate: record.serviceDate ?? "",
      special,
      lock: special
        ? null
        : target.lock && nonEmptyString(target.lock.id) && nonEmptyString(target.lock.rev)
          ? { id: target.lock.id, rev: target.lock.rev }
          : null,
      setlist: setlist.observed,
      setlistWeek: setlist.week,
      proposal: proposal.observed,
      proposalServiceDate: proposal.serviceDate,
      members,
      unsafe,
      role: sources.rolesById.get(roleId) ?? {},
    },
  };
}

// ── Guard bundle ────────────────────────────────────────────────────────────

/**
 * A2's `PublishReadyAssertion` for one observation, refused outright when any
 * observation was not a clean singleton-or-absent. A partially guarded plan is
 * never produced.
 */
export function buildPublishAssertion(observation: ServiceObservation): PublishReadyPlan {
  if (observation.unsafe.length > 0) {
    return { ok: false, issues: observation.unsafe };
  }
  const assertion: PublishReadyAssertion = {
    role: {
      id: observation.roleId,
      rev: observation.roleRev,
      dateField: observation.dateField,
      date: observation.serviceDate,
    },
    lock: observation.lock,
    special: observation.special,
    setlist: observation.setlist,
    setlistWeek: observation.setlistWeek,
    proposal: observation.proposal,
    proposalServiceDate: observation.proposalServiceDate,
    members: observation.members,
  };
  return planPublishReadyAssertions(assertion);
}

export type MergedAssertionOps =
  | { ok: true; ops: AssertionOp[] }
  | { ok: false; issues: string[] };

/**
 * Collapse a batch's assertion ops so each document appears exactly once. Two
 * services can legitimately share a member (or, defensively, any other document);
 * two `ifRevisionId` patches against the same document inside one transaction
 * cannot both hold, so they must merge. A revision or value disagreement between
 * two observations of the same document is an explicit refusal, never a silent
 * "last one wins".
 */
export function mergeAssertionOps(ops: readonly AssertionOp[]): MergedAssertionOps {
  const byId = new Map<string, AssertionOp>();
  const issues: string[] = [];
  for (const op of ops) {
    const existing = byId.get(op.id);
    if (!existing) {
      byId.set(op.id, { ...op, set: { ...op.set }, unset: [...op.unset] });
      continue;
    }
    if (existing.rev !== op.rev) {
      issues.push(`revision_disagreement:${op.id}`);
      continue;
    }
    for (const [key, value] of Object.entries(op.set)) {
      if (key in existing.set && JSON.stringify(existing.set[key]) !== JSON.stringify(value)) {
        issues.push(`value_disagreement:${op.id}:${key}`);
        continue;
      }
      existing.set[key] = value;
    }
    for (const field of op.unset) if (!existing.unset.includes(field)) existing.unset.push(field);
  }
  for (const op of byId.values()) {
    for (const field of op.unset) {
      if (field in op.set) issues.push(`set_unset_conflict:${op.id}:${field}`);
    }
  }
  if (issues.length) return { ok: false, issues: [...new Set(issues)] };
  return { ok: true, ops: [...byId.values()] };
}

/**
 * Fold `published: true` into each role's OWN assertion op, so one revision-guarded
 * patch both asserts the state readiness was computed from and flips publication.
 * A second patch of the same document in the same transaction could not carry a
 * second valid `ifRevisionId`. `_type` is never written — it is immutable per id.
 */
export function withPublishedTrue(
  ops: readonly AssertionOp[],
  roleIds: readonly string[],
): MergedAssertionOps {
  const wanted = new Set(roleIds);
  const covered = new Set<string>();
  const out = ops.map((op) => {
    if (op.subject !== "role" || !wanted.has(op.id)) return op;
    covered.add(op.id);
    return { ...op, set: { ...op.set, published: true } };
  });
  const missing = [...wanted].filter((id) => !covered.has(id));
  if (missing.length) return { ok: false, issues: missing.map((id) => `no_role_assertion:${id}`) };
  return { ok: true, ops: out };
}

// ── Lost-outcome recovery ───────────────────────────────────────────────────

export interface ObservedPublication {
  id: string;
  /** `missing` when the id resolves to no canonical role at all. */
  publishState: PublishState | "missing";
  /** Raw `drafts.` overlay ids observed for the same base id. */
  rawDrafts: string[];
}

export interface PublicationObservation {
  /** False when the refetch itself failed — the outcome stays `unknown`. */
  ok: boolean;
  states: ObservedPublication[];
}

/**
 * Authoritative role identity + publication state for a lost/unknown response.
 * READ ONLY: recovery never replays a mutation. A failed refetch reports
 * `ok: false`, which the caller must surface as `unknown`, not as failure.
 */
export async function observePublicationStates(ids: string[]): Promise<PublicationObservation> {
  const unique = [...new Set(ids)].filter(nonEmptyString);
  if (!unique.length) return { ok: true, states: [] };
  const [roles, drafts] = await Promise.all([
    attempt<Record<string, unknown>>("recoverRoles", canonicalRolesByIdsQuery(unique)),
    attempt<Record<string, unknown>>(
      "recoverRoleDrafts",
      rawRoleDraftsForBaseIdsQuery(unique),
      true,
    ),
  ]);
  if (!roles.ok || !drafts.ok) return { ok: false, states: [] };

  const byId = new Map<string, Record<string, unknown>>();
  for (const role of roles.rows) {
    if (isObj(role) && nonEmptyString(role._id)) byId.set(role._id, role);
  }
  const draftsByBase = new Map<string, string[]>();
  for (const draft of drafts.rows) {
    if (!isObj(draft) || !nonEmptyString(draft._id)) continue;
    const base = normalizeBaseId(draft._id);
    draftsByBase.set(base, [...(draftsByBase.get(base) ?? []), draft._id]);
  }

  return {
    ok: true,
    states: unique.map((id) => {
      const doc = byId.get(id);
      return {
        id,
        publishState: doc ? derivePublishState(doc.published) : ("missing" as const),
        rawDrafts: draftsByBase.get(id) ?? [],
      };
    }),
  };
}

/** True only when EVERY submitted role is observed in the requested state. */
export function allObservedIn(
  states: readonly ObservedPublication[],
  requested: PublishState,
): boolean {
  return states.length > 0 && states.every((s) => s.publishState === requested);
}

// ── Request contracts ───────────────────────────────────────────────────────

export type PublishReadyMode = "ready" | "override" | "recover";

export interface PublishReadyEntry {
  id: string;
  /** The canonical role revision the client observed. Empty only in `recover`. */
  rev: string;
  /** The exact workflow blocker codes the admin acknowledged (`override` only). */
  acknowledgedBlockers: PublishWorkflowBlocker[];
}

export interface ParsedPublishReadyRequest {
  mode: PublishReadyMode;
  entries: PublishReadyEntry[];
  /** `recover` only: the publication state the lost submission had requested. */
  requestedState: PublishState;
}

function fail<T>(issues: string[]): ParseResult<T> {
  return { ok: false, issues };
}

/**
 * `{ mode, roles: [{ id, rev, acknowledgedBlockers? }], published? }`.
 *
 * `ready` acknowledges nothing — a bulk submission that carries acknowledgements
 * is malformed, not generously reinterpreted as an override. `override` may name
 * ONLY registered workflow blocker codes; a hard-blocker code in the payload is a
 * rejected request, never a negotiation. `recover` is read-only and needs no
 * revisions, but must state which publication state it was trying to reach.
 *
 * `override` accepts a BATCH (it was single-service while the individual card
 * button was its only caller; `Publicar todos` now submits many). Batching costs
 * no safety: the handler already classified, guarded and committed per entry, so
 * each role is still checked against its OWN freshly recomputed workflow set, one
 * mismatch still rejects the whole request, and hard blockers are still refused
 * for every entry. An entry acknowledging nothing (`[]`) is a clean draft, which
 * is how one atomic request can publish the ready and the acknowledged together.
 */
export function parsePublishReadyRequest(
  body: unknown,
): ParseResult<ParsedPublishReadyRequest> {
  if (!isObj(body)) return fail(["payload"]);
  const mode = body.mode;
  if (mode !== "ready" && mode !== "override" && mode !== "recover") return fail(["mode"]);

  const rows = body.roles;
  if (!Array.isArray(rows) || rows.length === 0) return fail(["roles"]);
  if (rows.length > PUBLISH_BATCH_MAX) return fail(["batch_size"]);

  let requestedState: PublishState = "published";
  if (mode === "recover") {
    if (typeof body.published !== "boolean") return fail(["published"]);
    requestedState = body.published ? "published" : "draft";
  }

  const entries: PublishReadyEntry[] = [];
  const seen = new Set<string>();
  for (const row of rows) {
    if (!isObj(row)) return fail(["roles"]);
    if (!isCanonicalDocumentId(row.id)) return fail(["role_id"]);
    if (seen.has(row.id)) return fail(["duplicate_role_id"]);
    seen.add(row.id);

    let rev = "";
    if (mode !== "recover") {
      if (!isRevisionString(row.rev)) return fail(["role_rev"]);
      rev = row.rev;
    }

    const raw = row.acknowledgedBlockers;
    if (raw !== undefined && !Array.isArray(raw)) return fail(["acknowledged_blockers"]);
    const codes = [...new Set((raw ?? []) as unknown[])];
    if (!codes.every(isPublishWorkflowBlocker)) return fail(["acknowledged_blockers"]);
    if (mode !== "override" && codes.length > 0) return fail(["acknowledged_blockers"]);

    entries.push({ id: row.id, rev, acknowledgedBlockers: codes as PublishWorkflowBlocker[] });
  }
  return { ok: true, value: { mode, entries, requestedState } };
}

export interface ParsedUnpublishRequest {
  mode: "unpublish" | "recover";
  entries: { id: string; rev: string }[];
}

/**
 * `{ roles: [{ id, rev }] }` — deliberately NARROW. No blocker acknowledgements,
 * no member/setlist/proposal observations: hiding a published service must stay
 * possible precisely when those are unsafe. A `published` field, if sent at all,
 * must be `false`; this endpoint never publishes.
 */
export function parseUnpublishRequest(body: unknown): ParseResult<ParsedUnpublishRequest> {
  if (!isObj(body)) return fail(["payload"]);
  const mode = body.mode === undefined ? "unpublish" : body.mode;
  if (mode !== "unpublish" && mode !== "recover") return fail(["mode"]);
  if (body.published !== undefined && body.published !== false) return fail(["published"]);
  if ("acknowledgedBlockers" in body) return fail(["acknowledged_blockers"]);

  const rows = body.roles;
  if (!Array.isArray(rows) || rows.length === 0) return fail(["roles"]);
  if (rows.length > PUBLISH_BATCH_MAX) return fail(["batch_size"]);

  const entries: { id: string; rev: string }[] = [];
  const seen = new Set<string>();
  for (const row of rows) {
    if (!isObj(row)) return fail(["roles"]);
    if (!isCanonicalDocumentId(row.id)) return fail(["role_id"]);
    if (seen.has(row.id)) return fail(["duplicate_role_id"]);
    if ("acknowledgedBlockers" in row) return fail(["acknowledged_blockers"]);
    seen.add(row.id);
    let rev = "";
    if (mode === "unpublish") {
      if (!isRevisionString(row.rev)) return fail(["role_rev"]);
      rev = row.rev;
    }
    entries.push({ id: row.id, rev });
  }
  return { ok: true, value: { mode, entries } };
}
