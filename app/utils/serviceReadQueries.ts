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
  _id, _rev, _type, published, week, date,
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

// The raw `drafts.` overlay(s) for one role base id, used to detect a
// draft-conflicted role identity (a published base plus a draft overlay is one
// canonical target plus a blocking integrity issue — never a live read source).
export function rawRoleDraftForBaseQuery(baseId: string): BoundQuery {
  return {
    query: `*[_type in $roleTypes && ${DRAFTS_ONLY} && _id == $draftId]{ _id }`,
    params: { roleTypes: [...ROLE_TYPES], draftId: `drafts.${baseId}` },
  };
}
