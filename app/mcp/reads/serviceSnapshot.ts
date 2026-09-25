// app/mcp/reads/serviceSnapshot.ts — the MCP service snapshot (P1 Decision D1).
//
// ONE load of the service catalogue that yields both the readiness the
// publish-ready route decides with AND the content the read tools show beside
// it: raw role, setlist and proposal rows, the draft overlay ids and the member
// map. Readiness and content come from the same query rows, so every `_rev` a
// read reports sits next to the content it was observed with (spec I4, I7).
//
// WHY A COPY. `loadServiceReadinessSources()` (`app/utils/publishReadyBundle.ts`)
// runs exactly these reads but discards the rows and the member map, and
// widening its return value would change an export a production writer imports
// (the roadmap's additive-only rule). So this module mirrors it line for line:
// the same seven parallel builders from `serviceReadQueries.ts` plus the same
// follow-up member read, the same client per read (canonical reads on the
// published-perspective `operationalClient`, draft inventories on
// `rawIntegrityClient`), the same per-domain failure isolation (a failed domain
// is `error`, never empty) and the same exported summary builders. Nothing is
// re-derived. `serviceSnapshotParity.test.ts` runs both loaders over the same
// responses and fails on any divergence — change the two together or not at all.
//
// The clients are imported HERE, directly from `sanity/lib/operationalClient`,
// because the protected-read audit only recognises clients imported from that
// module. No GROQ lives in this file: it executes the canonical builders only,
// which keeps it out of the draft-gating scan's reach by construction (I2).
//
// `loadMemberNames` is content, not readiness, and sits outside the parity
// scope: names for members a proposal references who hold no seat.

import "server-only";

import { operationalClient, rawIntegrityClient } from "@/sanity/lib/operationalClient";
import {
  allRoleTargetLocksQuery,
  canonicalMembersByIdsQuery,
  canonicalProposalsQuery,
  canonicalRolesQuery,
  canonicalSetlistsQuery,
  rawProposalDraftsQuery,
  rawRoleDraftsQuery,
  rawSetlistDraftsQuery,
  type BoundQuery,
} from "@/app/utils/serviceReadQueries";
import type { ServiceSourceKey, ServiceSourceStates } from "@/app/components/admin/serviceReadiness";
import type { CanonicalMember } from "@/app/utils/serviceReadModel";
import {
  buildProposalSummary,
  buildRoleTargets,
  buildSetlistTargets,
  collectRoleMemberRefs,
  specialRolesWithEmbeddedSetlist,
} from "@/app/utils/serviceReadSummary";
import type { ServiceReadinessSources } from "@/app/utils/publishReadyBundle";

function isObj(v: unknown): v is Record<string, unknown> {
  return !!v && typeof v === "object";
}

function nonEmptyString(v: unknown): v is string {
  return typeof v === "string" && v.length > 0;
}

type FetchOutcome<T> = { ok: true; rows: T[] } | { ok: false; rows: T[] };

/**
 * `publishReadyBundle`'s `attempt()`, duplicated because it is not exported. Same
 * outcome on every path; the one deliberate difference is the log line, which
 * carries a fixed tag and the domain label only — never the error, whose message
 * is Sanity's own text (the MCP rule, spec E1).
 */
async function attempt<T>(label: string, bound: BoundQuery, raw = false): Promise<FetchOutcome<T>> {
  try {
    const rows = raw
      ? await rawIntegrityClient.fetch<T[]>(bound.query, bound.params)
      : await operationalClient.fetch<T[]>(bound.query, bound.params);
    return { ok: true, rows: Array.isArray(rows) ? rows : [] };
  } catch {
    // A failed domain is reported as `error` and becomes a hard blocker. It is
    // never silently downgraded to an empty/clean observation.
    console.error("[mcp-snapshot] read failed:", label);
    return { ok: false, rows: [] };
  }
}

/** A row exactly as its projection returned it. Read-only: it is the same object readiness holds. */
export type SnapshotRow = Readonly<Record<string, unknown>>;

/**
 * Every row, id list and map here is the SAME object `readiness` was computed
 * from (`readiness.rolesById.get(id) === roles[i]`), so the fields are typed
 * read-only: sorting or editing one in place would silently change what
 * `assembleService` sees. Copy before reshaping. `readiness` keeps the mutable
 * `ServiceReadinessSources` type because `assembleService` takes exactly that.
 */
export interface ServiceSnapshot {
  /**
   * Exactly what `loadServiceReadinessSources()` returns for the same reads, so
   * it goes straight into `assembleService(snapshot.readiness, roleId)`.
   */
  readonly readiness: ServiceReadinessSources;
  /** Canonical role rows (`ROLE_PROJECTION`). `[]` when this read failed, and then `sources.roles` is `error`. */
  readonly roles: ReadonlyArray<SnapshotRow>;
  /**
   * Canonical weekend setlist rows (`SETLIST_PROJECTION`). `[]` when this read
   * failed; `sources.setlistTargets` is also `error` when its sibling read (the
   * raw setlist drafts) failed — check `sources.setlistTargets` before trusting
   * presence or absence.
   */
  readonly setlists: ReadonlyArray<SnapshotRow>;
  /**
   * Ids of the raw `drafts.*` setlist rows. `[]` when this read failed;
   * `sources.setlistTargets` is also `error` when its sibling read (the canonical
   * setlists) failed — check `sources.setlistTargets` before trusting presence or
   * absence.
   */
  readonly setlistDraftIds: readonly string[];
  /**
   * Ids of the raw `drafts.*` role rows. `[]` when this read failed;
   * `sources.roleTargets` is also `error` when its sibling read (the weekend
   * locks) failed — check `sources.roleTargets` before trusting presence or
   * absence.
   */
  readonly roleDraftIds: readonly string[];
  /**
   * Members seated on any groupable role, from `CANONICAL_MEMBER_PROJECTION` — the
   * same map (and the same objects) readiness resolved seats against. Empty when
   * `sources.members` is `error` (its read failed, or roles failed and it never ran).
   */
  readonly membersById: ReadonlyMap<string, Readonly<CanonicalMember>>;
  /**
   * Canonical proposal rows (`PROPOSAL_PROJECTION`). `[]` when this read failed;
   * `sources.proposals` is also `error` when its sibling read (the raw proposal
   * drafts) failed — check `sources.proposals` before trusting presence or
   * absence.
   */
  readonly proposals: ReadonlyArray<SnapshotRow>;
}

/**
 * Load the service catalogue once. Mirrors `loadServiceReadinessSources()` read
 * for read; see the file header for why it is a copy and what pins it.
 */
export async function loadServiceSnapshot(): Promise<ServiceSnapshot> {
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

  const specialRolesWithSongs = specialRolesWithEmbeddedSetlist(roles.rows);
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

  const readiness: ServiceReadinessSources = {
    sources,
    failedSources,
    roleSummary,
    setlistSummary,
    proposalSummary,
    rolesById,
    proposalsById,
    rawProposalDrafts: proposalDrafts.rows.filter(isObj),
  };

  const draftIds = (rows: Record<string, unknown>[]) =>
    rows.filter(isObj).map((row) => row._id).filter(nonEmptyString);

  return {
    readiness,
    roles: roles.rows.filter(isObj),
    setlists: setlists.rows.filter(isObj),
    setlistDraftIds: draftIds(setlistDrafts.rows),
    roleDraftIds: draftIds(roleDrafts.rows),
    membersById,
    proposals: proposals.rows.filter(isObj),
  };
}

// ── Content beyond readiness ────────────────────────────────────────────────

export interface MemberNameLookup {
  /**
   * False when the lookup read failed. An id missing from `byId` is then
   * UNKNOWN, not missing — the caller must say so rather than report it absent.
   */
  readonly ok: boolean;
  /** Every requested id that resolved, from `known` first (the same objects) and then the dataset. */
  readonly byId: ReadonlyMap<string, Readonly<CanonicalMember>>;
}

/**
 * Names for members a proposal references (lead, contributors, message
 * authors, song leaders) that the snapshot's seat-derived `membersById` does
 * not hold. Only the unknown ids are read, in one canonical
 * `canonicalMembersByIdsQuery` on `operationalClient`; nothing is read when
 * every id is already known. Not part of the readiness parity.
 */
export async function loadMemberNames(
  ids: readonly string[],
  known: ReadonlyMap<string, Readonly<CanonicalMember>>,
): Promise<MemberNameLookup> {
  const wanted = [...new Set(ids.filter(nonEmptyString))];
  const byId = new Map<string, Readonly<CanonicalMember>>();
  const unknown: string[] = [];
  for (const id of wanted) {
    const member = known.get(id);
    if (member) byId.set(id, member);
    else unknown.push(id);
  }
  if (unknown.length === 0) return { ok: true, byId };

  const fetched = await attempt<CanonicalMember>("memberNames", canonicalMembersByIdsQuery(unknown));
  for (const member of fetched.rows) {
    if (member && nonEmptyString(member._id) && unknown.includes(member._id)) byId.set(member._id, member);
  }
  return { ok: fetched.ok, byId };
}
