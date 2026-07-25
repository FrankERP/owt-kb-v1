// Canonical read queries for the six protected service types. Projections are
// shaped for the pure `serviceReadModel` validators; all filters bind trusted,
// code-owned type lists (and derived id lists) as GROQ parameters — never string
// interpolation of runtime values. Canonical queries run through the published
// perspective client; raw-draft inventory queries run through the tokened raw
// client and scope strictly to `drafts.*`.

import { ROLE_TYPES, SETLIST_TYPES } from "@/app/utils/serviceReadModel";

export interface BoundQuery {
  query: string;
  params: Record<string, unknown>;
}

const SONGS_FRAGMENT = `songs[]{ _key, play_key, medley_tag, song{ _type, _ref } }`;

export const ROLE_PROJECTION = `{
  _id, _rev, _type, published, week, date, service_name,
  creationReceiptId, creationFingerprint,
  Lead[]{ _key, _type, _ref },
  BGVs[]{ _key, _type, _ref },
  Chorus[]{ _key, _type, _ref },
  instruments[]{ _key, _type, instrument, person{ _type, _ref } },
  foh_team[]{ _key, _type, role, person{ _type, _ref } },
  ${SONGS_FRAGMENT}
}`;

export const SETLIST_PROJECTION = `{
  _id, _rev, _type, week,
  ${SONGS_FRAGMENT}
}`;

export const PROPOSAL_PROJECTION = `{
  _id, _rev, _createdAt, service_type,
  "service_ref": service_ref._ref,
  service_date, status,
  ${SONGS_FRAGMENT},
  contributors[]{ _key, "person": person._ref },
  "lead": lead._ref
}`;

export const CANONICAL_MEMBER_PROJECTION = `{ _id, _rev, member_name, alias, unavailableDates, unavailabilityNotes }`;

const DRAFTS_ONLY = `_id in path("drafts.**")`;

// ── Canonical (published perspective) ───────────────────────────────────────

export function canonicalRolesQuery(): BoundQuery {
  return {
    query: `*[_type in $roleTypes] ${ROLE_PROJECTION}`,
    params: { roleTypes: [...ROLE_TYPES] },
  };
}

export function canonicalSetlistsQuery(): BoundQuery {
  return {
    query: `*[_type in $setlistTypes] ${SETLIST_PROJECTION}`,
    params: { setlistTypes: [...SETLIST_TYPES] },
  };
}

export function canonicalProposalsQuery(): BoundQuery {
  return {
    query: `*[_type == "setlistProposal"] ${PROPOSAL_PROJECTION}`,
    params: {},
  };
}

export function canonicalMembersByIdsQuery(ids: string[]): BoundQuery {
  return {
    query: `*[_type == "teamMembers" && _id in $ids] ${CANONICAL_MEMBER_PROJECTION}`,
    params: { ids },
  };
}

// Resolve every canonical role sharing one base `_id` (published perspective, so
// `drafts.*` are excluded). Returned as an array — the caller fails closed unless
// exactly one groupable role resolves, never selecting an arbitrary `[0]`.
export function canonicalRoleByIdQuery(id: string): BoundQuery {
  return {
    query: `*[_type in $roleTypes && _id == $id] ${ROLE_PROJECTION}`,
    params: { roleTypes: [...ROLE_TYPES], id },
  };
}

// ── Admin setlist editor reads (§4) ─────────────────────────────────────────
// The editor needs the dereferenced song document to render a row, but the pure
// content-state validator needs the stored `_key` / raw `_ref`. Project both:
// `songRef` is the stored reference id and `song` its canonical resolution, so a
// dangling reference is visible as `songRef` present + `song` null (invalid
// content) instead of silently rendering as an empty row. `hasSongs` separates
// "field absent" (no setlist target yet) from "empty array" (an empty setlist).

const EDITOR_SONG_PROJECTION = `{ _id, title, author, key, "slug": slug.current }`;

export const EDITOR_SETLIST_SONGS_PROJECTION = `"hasSongs": defined(songs), songs[] {
  _key,
  play_key,
  medley_tag,
  "songRef": song._ref,
  "song": song-> ${EDITOR_SONG_PROJECTION}
}`;

/** Canonical weekend setlist group for one target — returned as an array, never `[0]`. */
export function editorWeekendSetlistQuery(setlistType: string, week: string): BoundQuery {
  return {
    query: `*[_type == $setlistType && week == $week] { _id, _rev, _type, week, ${EDITOR_SETLIST_SONGS_PROJECTION} }`,
    params: { setlistType, week },
  };
}

/**
 * Canonical `special_role` group for one role id. A special service stores its
 * songs on the role document itself, so this both validates the request identity
 * (type + `date`) and carries the setlist content.
 */
export function editorSpecialRoleQuery(roleId: string): BoundQuery {
  return {
    query: `*[_type == "special_role" && _id == $id] { _id, _rev, _type, date, ${EDITOR_SETLIST_SONGS_PROJECTION} }`,
    params: { id: roleId },
  };
}

/** Recent play history (past N weeks) across all three service kinds, for repeat warnings. */
export function editorRecentSetlistsQuery(cutoff: string): BoundQuery {
  return {
    query: `{
      "sunday":   *[_type == "featuredSongs" && week >= $cutoff] { week, ${EDITOR_SETLIST_SONGS_PROJECTION} },
      "saturday": *[_type == "saturdarSongs" && week >= $cutoff] { week, ${EDITOR_SETLIST_SONGS_PROJECTION} },
      "special":  *[_type == "special_role"  && date >= $cutoff && defined(songs)] { "week": date, ${EDITOR_SETLIST_SONGS_PROJECTION} }
    }`,
    params: { cutoff },
  };
}

// ── Protected mutation scopes (A2 §1/§2/§3) ─────────────────────────────────
// Scoped variants of the canonical reads, so a writer inventories exactly the
// target(s) it affects instead of the whole dataset. All of these run through the
// canonical operational clients; the role/setlist/proposal types stay bound as
// parameters or code-owned literals, never interpolated runtime values.

export function canonicalRolesByIdsQuery(ids: string[]): BoundQuery {
  return {
    query: `*[_type in $roleTypes && _id in $ids] ${ROLE_PROJECTION}`,
    params: { roleTypes: [...ROLE_TYPES], ids },
  };
}

/** Canonical role group occupying one weekend target (`_type` + `week`). */
export function canonicalWeekendRolesForTargetQuery(roleType: string, week: string): BoundQuery {
  return {
    query: `*[_type == $roleType && week == $week] ${ROLE_PROJECTION}`,
    params: { roleType, week },
  };
}

/** Canonical special-service group on one calendar day (identity is date + name). */
export function canonicalSpecialRolesForDateQuery(date: string): BoundQuery {
  return {
    query: `*[_type == "special_role" && date == $date] ${ROLE_PROJECTION}`,
    params: { date },
  };
}

// ── Internal coordination documents ─────────────────────────────────────────

export const ROLE_TARGET_LOCK_PROJECTION = `{
  _id, _rev, _type, targetKey, state, roleId, roleType, date, claimNonce, generation
}`;

export function roleTargetLocksByIdsQuery(ids: string[]): BoundQuery {
  return {
    query: `*[_type == "roleTargetLock" && _id in $ids] ${ROLE_TARGET_LOCK_PROJECTION}`,
    params: { ids },
  };
}

export const ROLE_CREATION_RECEIPT_PROJECTION = `{
  _id, _rev, _type, requestId, fingerprint, roleId, roleType, targetIdentity, state
}`;

export function roleCreationReceiptByIdQuery(id: string): BoundQuery {
  return {
    query: `*[_type == "roleCreationReceipt" && _id == $id] ${ROLE_CREATION_RECEIPT_PROJECTION}`,
    params: { id },
  };
}

/**
 * Receipts whose immutable `roleId` names this role — the authoritative reverse
 * link used when retiring a receipt-backed key on delete. Returned as an array:
 * more than one is an integrity conflict, never an arbitrary pick.
 */
export function roleCreationReceiptsForRoleQuery(roleId: string): BoundQuery {
  return {
    query: `*[_type == "roleCreationReceipt" && roleId == $roleId] ${ROLE_CREATION_RECEIPT_PROJECTION}`,
    params: { roleId },
  };
}

// ── Dependency inventory scopes (§3) ────────────────────────────────────────

/** Canonical weekend setlists on any of the affected dates. */
export function canonicalSetlistsForWeeksQuery(weeks: string[]): BoundQuery {
  return {
    query: `*[_type in $setlistTypes && week in $weeks] ${SETLIST_PROJECTION}`,
    params: { setlistTypes: [...SETLIST_TYPES], weeks },
  };
}

/**
 * Proposals reached through BOTH indexes: the role reference and the affected
 * date(s), across every status. A destination proposal must block even when it
 * references another role or no role at all.
 */
export function proposalsForRoleOrDatesQuery(roleId: string | null, dates: string[]): BoundQuery {
  return {
    query: `*[_type == "setlistProposal" && (service_ref._ref == $roleId || service_date in $dates)] ${PROPOSAL_PROJECTION}`,
    params: { roleId, dates },
  };
}

/** Documents holding a strong reference to this role (unknown references, §3). */
export function documentsReferencingRoleQuery(roleId: string): BoundQuery {
  return {
    query: `*[references($roleId)]{ _id, _type }`,
    params: { roleId },
  };
}

// ── Raw-draft inventory (raw perspective, drafts.* only) ─────────────────────

export function rawRoleDraftsQuery(): BoundQuery {
  return {
    query: `*[_type in $roleTypes && ${DRAFTS_ONLY}] ${ROLE_PROJECTION}`,
    params: { roleTypes: [...ROLE_TYPES] },
  };
}

export function rawSetlistDraftsQuery(): BoundQuery {
  return {
    query: `*[_type in $setlistTypes && ${DRAFTS_ONLY}] ${SETLIST_PROJECTION}`,
    params: { setlistTypes: [...SETLIST_TYPES] },
  };
}

export function rawProposalDraftsQuery(): BoundQuery {
  return {
    query: `*[_type == "setlistProposal" && ${DRAFTS_ONLY}] ${PROPOSAL_PROJECTION}`,
    params: {},
  };
}

// The raw `drafts.*` setlist overlay(s) relevant to one weekend setlist target.
// Scoped by the target's own week so a draft-only setlist for that week is also
// evidence (zero live targets plus a blocking integrity issue).
export function rawSetlistDraftsForWeekQuery(setlistType: string, week: string): BoundQuery {
  return {
    query: `*[_type == $setlistType && ${DRAFTS_ONLY} && week == $week]{ _id }`,
    params: { setlistType, week },
  };
}

/** Raw `drafts.*` weekend role overlays occupying one target (`_type` + `week`). */
export function rawRoleDraftsForTargetQuery(roleType: string, week: string): BoundQuery {
  return {
    query: `*[_type == $roleType && ${DRAFTS_ONLY} && week == $week]{ _id, _type }`,
    params: { roleType, week },
  };
}

/** Raw `drafts.*` special-role overlays on one calendar day. */
export function rawSpecialRoleDraftsForDateQuery(date: string): BoundQuery {
  return {
    query: `*[_type == "special_role" && ${DRAFTS_ONLY} && date == $date]{ _id, _type }`,
    params: { date },
  };
}

/** Raw `drafts.` overlays for a set of role base ids (publish batch prevalidation). */
export function rawRoleDraftsForBaseIdsQuery(baseIds: string[]): BoundQuery {
  return {
    query: `*[_type in $roleTypes && ${DRAFTS_ONLY} && _id in $draftIds]{ _id, _type }`,
    params: { roleTypes: [...ROLE_TYPES], draftIds: baseIds.map((id) => `drafts.${id}`) },
  };
}

/** Raw `drafts.*` weekend setlists on any of the affected dates (§3 evidence). */
export function rawSetlistDraftsForWeeksQuery(weeks: string[]): BoundQuery {
  return {
    query: `*[_type in $setlistTypes && ${DRAFTS_ONLY} && week in $weeks] ${SETLIST_PROJECTION}`,
    params: { setlistTypes: [...SETLIST_TYPES], weeks },
  };
}

/** Raw `drafts.*` proposals reached through the role reference or an affected date. */
export function rawProposalDraftsForRoleOrDatesQuery(
  roleId: string | null,
  dates: string[],
): BoundQuery {
  return {
    query: `*[_type == "setlistProposal" && ${DRAFTS_ONLY} && (service_ref._ref == $roleId || service_date in $dates)] ${PROPOSAL_PROJECTION}`,
    params: { roleId, dates },
  };
}

// The raw `drafts.` overlay(s) for one role base id, used to detect a
// draft-conflicted role identity (a published base plus a draft overlay is one
// canonical target plus a blocking integrity issue — never a live read source).
export function rawRoleDraftForBaseQuery(baseId: string): BoundQuery {
  return {
    query: `*[_type in $roleTypes && ${DRAFTS_ONLY} && _id == $draftId]{ _id }`,
    params: { roleTypes: [...ROLE_TYPES], draftId: `drafts.${baseId}` },
  };
}
