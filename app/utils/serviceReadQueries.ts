// Canonical read queries for the seven protected service types. Projections are
// shaped for the pure `serviceReadModel` validators; all filters bind trusted,
// code-owned type lists (and derived id lists) as GROQ parameters — never string
// interpolation of runtime values. Canonical queries run through the published
// perspective client; raw-draft inventory queries run through the tokened raw
// client and scope strictly to `drafts.*`.

import { ROLE_TYPES, SETLIST_TYPES } from "@/app/utils/serviceReadModel";
import { WORSHIP_AUDIENCE_GROQ_FILTER } from "@/app/ministries";
import { COUNTS_FOR_FAIRNESS_GROQ } from "@/app/utils/countsForFairness";
import { SOLVER_CONFIG_DOC_ID } from "@/app/utils/solverConfigWriteRequest";

export interface BoundQuery {
  query: string;
  params: Record<string, unknown>;
}

const SONGS_FRAGMENT = `songs[]{ _key, play_key, medley_tag, song{ _type, _ref }, leads[]{ _key, _type, _ref } }`;

export const ROLE_PROJECTION = `{
  _id, _rev, _type, published, week, date, service_name, time, format,
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

/**
 * The proposal as the WRITE PATHS read it.
 *
 * `messages` is projected with a BARE `author` ref and no name join, because
 * writers compare and store references. The surfaces want something else and use
 * `THREAD_MESSAGES` (`proposalMessageRead.ts`), which resolves the display name.
 *
 * Payload note: this also backs `canonicalProposalsQuery()` →
 * `publishReadyBundle.ts`, an ALL-proposals read on the service-readiness
 * surface, so the worst case for the thread is ~800 KB × the catalog rather than
 * × 1. Nothing hashes or digests this projection, so it is payload-only.
 * Irrelevant at 14 documents; revisit before the catalog grows.
 */
export const PROPOSAL_PROJECTION = `{
  _id, _rev, _createdAt, service_type,
  "service_ref": service_ref._ref,
  service_date, status,
  ${SONGS_FRAGMENT},
  contributors[]{ _key, "person": person._ref },
  "lead": lead._ref,
  lead_notes, team_notes, admin_notes,
  messages[]{ _key, _type, "author": author._ref, author_role, kind, body, at },
  approval_receipt, last_transition
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
  "leadIds": leads[]._ref,
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
 * (type + `date`) and carries the setlist content — plus its `format` and the
 * members in its `Lead`, the only people a worship night's song may name as leader.
 */
export function editorSpecialRoleQuery(roleId: string): BoundQuery {
  return {
    query: `*[_type == "special_role" && _id == $id] { _id, _rev, _type, date, format, "leadRoster": Lead[]->{ _id, member_name, alias }, ${EDITOR_SETLIST_SONGS_PROJECTION} }`,
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

/**
 * Canonical live-setlist group for ONE weekend target (`_type` + `week`).
 * Returned as an array: zero is an absent target, more than one is a duplicate
 * conflict, never an arbitrary `[0]` pick.
 */
export function canonicalSetlistsForTargetQuery(setlistType: string, week: string): BoundQuery {
  return {
    query: `*[_type == $setlistType && week == $week] ${SETLIST_PROJECTION}`,
    params: { setlistType, week },
  };
}

/** Canonical proposal group for one proposal id (array — never `[0]`). */
export function canonicalProposalByIdQuery(id: string): BoundQuery {
  return {
    query: `*[_type == "setlistProposal" && _id == $id] ${PROPOSAL_PROJECTION}`,
    params: { id },
  };
}

// ── Internal coordination documents ─────────────────────────────────────────

export const ROLE_TARGET_LOCK_PROJECTION = `{
  _id, _rev, _type, targetKey, state, roleId, roleType, date, claimNonce, generation
}`;

/**
 * Every weekend target lock, for the roles integrity summary (A2 §1). Locks are
 * internal coordination documents, so the whole set is small and bounded by the
 * number of weekend targets that ever existed.
 */
export function allRoleTargetLocksQuery(): BoundQuery {
  return {
    query: `*[_type == "roleTargetLock"] ${ROLE_TARGET_LOCK_PROJECTION}`,
    params: {},
  };
}

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
    query: `*[_type == "special_role" && ${DRAFTS_ONLY} && date == $date]{ _id, _type, service_name }`,
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

/** The raw `drafts.` overlay(s) for one proposal base id (a blocking conflict). */
export function rawProposalDraftForBaseQuery(baseId: string): BoundQuery {
  return {
    query: `*[_type == "setlistProposal" && ${DRAFTS_ONLY} && _id == $draftId]{ _id }`,
    params: { draftId: `drafts.${baseId}` },
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

// ── Solver history reads (MCP P2, R9) ───────────────────────────────────────
// Feed the server-derived solver fairness history
// (`docs/superpowers/specs/2026-09-23-solver-history-derivation-design.md`).
// Weekend-only — a `special_role` is out of scope for the solver's history
// (ADR-0010) — and NONE of these carry a `published` clause: prior-month
// drafts count toward fairness too (R3), so filtering them out here would
// silently undercount a service the team has not published yet.

/** `ROLE_TYPES` minus `special_role` — the two types the solver's history counts. */
const WEEKEND_ROLE_TYPES = ROLE_TYPES.filter(
  (type): type is "sunday_role" | "saturday_role" => type !== "special_role",
);

/**
 * Weekend role documents whose `week` falls in the half-open range
 * `[fromDay, toDayExclusive)`. No `published` filter — see the section note.
 */
export function canonicalWeekendRolesInRangeQuery(fromDay: string, toDayExclusive: string): BoundQuery {
  return {
    query: `*[_type in $roleTypes && week >= $from && week < $to] ${ROLE_PROJECTION}`,
    params: { roleTypes: [...WEEKEND_ROLE_TYPES], from: fromDay, to: toDayExclusive },
  };
}

/**
 * Every team member's `_id` and current `member_name`, with no ministry
 * filter (R7; spec v2 I5: the solver's pool is not a member-listing read).
 */
export function canonicalMemberNamesQuery(): BoundQuery {
  return {
    query: `*[_type == "teamMembers"]{ _id, member_name }`,
    params: {},
  };
}

/** `ROLE_CREATION_RECEIPT_PROJECTION` plus the receipt's own `createdAt`/`updatedAt` fields. */
export const ROLE_CREATION_RECEIPT_EVIDENCE_PROJECTION = `{
  _id, _rev, _type, requestId, fingerprint, roleId, roleType, targetIdentity, state, createdAt, updatedAt
}`;

/**
 * Every weekend role-creation receipt (`sunday_role`/`saturday_role`),
 * unscoped by date. Rule 4's "moved out of the month" arm needs receipts whose
 * immutable `targetIdentity` is in the window while their role is not — a
 * document moved INTO the window has a receipt targeting a date outside it, so
 * one unscoped read covers both directions. Small: bounded by the weekend
 * roles created since 2026-07-24 (Assumption A2).
 */
export function weekendRoleCreationReceiptsQuery(): BoundQuery {
  return {
    query: `*[_type == "roleCreationReceipt" && roleType in $roleTypes] ${ROLE_CREATION_RECEIPT_EVIDENCE_PROJECTION}`,
    params: { roleTypes: [...WEEKEND_ROLE_TYPES] },
  };
}

// ── Solver v3 fairness reads (C2 IF2-24 … IF2-28) ──────────────────────────
// Additive builders for the fairness ledger, its write executor, C4's script and
// C7's rehearsal. NONE carries a `published` clause — prior-month drafts count,
// and neither `fairnessMonth`, `teamMembers` nor `solverConfig` is draft-gated —
// and each names canonical documents only. A caller runs them only on a client
// carrying the read token, the `published` perspective and no CDN (parent A2):
// `fairnessMonth` ids are dotted, so an untokened read answers «no record» with
// no error. This file stays the one exempt home of draft-seeing reads
// (`draftGatingCoverage.test.ts`); no new exemption is added.

const CANONICAL = `!(_id in path("drafts.**"))`;

/** The weekend role types — the freezing services' weekend half (§4 vocabulary). */
const FAIRNESS_WEEKEND_TYPES = ["sunday_role", "saturday_role"];

/** `YYYY-MM` → `[YYYY-MM-01, first day of the next month)`, by integer arithmetic. */
function monthRange(month: string): { month: string; from: string; to: string } {
  const year = Number(month.slice(0, 4));
  const m = Number(month.slice(5, 7));
  const next = m === 12 ? `${String(year + 1).padStart(4, "0")}-01` : `${month.slice(0, 4)}-${String(m + 1).padStart(2, "0")}`;
  return { month, from: `${month}-01`, to: `${next}-01` };
}

/**
 * IF2-24 — the freezing-services counts per month: the ONE definition of §4's
 * freezing services (parent A5), used by the write executor (WR-7), the ledger
 * reader (RD-1), C4 (R1) and, through IF2-8's `storedServices`, C6. Answers
 * `Array<{ month, weekend, countedSpecials, uncountedSpecials }>` in the order of
 * `months`; freezing = `weekend + countedSpecials`. Specials split by C1's rule.
 */
export function serviceCountsInMonths(months: string[]): BoundQuery {
  return {
    query: `$months[]{
      "month": month,
      "weekend": count(*[_type in $weekendTypes && ${CANONICAL} && week >= ^.from && week < ^.to]),
      "countedSpecials": count(*[_type == "special_role" && ${CANONICAL} && date >= ^.from && date < ^.to && ${COUNTS_FOR_FAIRNESS_GROQ}]),
      "uncountedSpecials": count(*[_type == "special_role" && ${CANONICAL} && date >= ^.from && date < ^.to && !(${COUNTS_FOR_FAIRNESS_GROQ})])
    }`,
    params: { months: months.map(monthRange), weekendTypes: FAIRNESS_WEEKEND_TYPES },
  };
}

/**
 * IF2-25 — every `fairnessMonth` document with `month <= lastMonth`, whole, as stored
 * (IF2-2). Every caller parses each row through the stored-record parser (IF2-20).
 */
export function fairnessMonthsThroughQuery(lastMonth: string): BoundQuery {
  return {
    query: `*[_type == "fairnessMonth" && ${CANONICAL} && month <= $last] | order(month asc)`,
    params: { last: lastMonth },
  };
}

/**
 * The `fairnessMonth` documents with these exact ids, whole, as stored — the write
 * executor's fresh re-read (WR-7). The ids come from the write-request module, the one
 * place that constructs them (REC-1).
 */
export function fairnessMonthsByIdsQuery(ids: string[]): BoundQuery {
  return {
    query: `*[_type == "fairnessMonth" && _id in $ids]`,
    params: { ids: [...ids] },
  };
}

/**
 * IF2-26 — the voice role documents of the three types whose stored date (`week` on a
 * weekend role, `date` on a special) is in `[fromDay, toDayExclusive)`, every published
 * state, with the effective counted flag (`ROLE_PROJECTION` does not carry it) and the
 * Lead/BGVs/Chorus `_ref`s in stored order. The caller normalises `date` through
 * `serviceDayKey` and maps each row to IF2-10's `LedgerService`.
 */
export function voiceRolesInRangeQuery(fromDay: string, toDayExclusive: string): BoundQuery {
  return {
    query: `*[_type in $roleTypes && ${CANONICAL} && select(_type == "special_role" => date, week) >= $from && select(_type == "special_role" => date, week) < $to]{
      _id, _type,
      "date": select(_type == "special_role" => date, week),
      time, published,
      "countsForFairness": ${COUNTS_FOR_FAIRNESS_GROQ},
      "Lead": Lead[]._ref, "BGVs": BGVs[]._ref, "Chorus": Chorus[]._ref
    }`,
    params: { roleTypes: [...ROLE_TYPES], from: fromDay, to: toDayExclusive },
  };
}

/**
 * Team members by id with the fields the fairness writer and ledger read: the display
 * name (alias, else `member_name`), `ministries` and `memberType` (the executor's WR-5
 * checks) and `unavailableDates` (the ledger's live availability, LG-6). No ministry
 * filter — a seat holder is named whatever her ministry.
 */
export function fairnessMembersByIdsQuery(ids: string[]): BoundQuery {
  return {
    query: `*[_type == "teamMembers" && ${CANONICAL} && _id in $ids]{ _id, member_name, alias, ministries, memberType, unavailableDates }`,
    params: { ids: [...ids] },
  };
}

/**
 * IF2-27 — the worship roster: the one server-side definition of the eligibility
 * resolver's unfiltered worship roster (RES-5) and of C3's `RosterMember` list for a
 * script. Every canonical `teamMembers` document matching `WORSHIP_AUDIENCE_GROQ_FILTER`
 * (absent or empty `ministries` is worship; no `$all` arm), with no `voz`, Tipo, pool or
 * `disabled` filter, projecting exactly six fields.
 */
export function worshipRosterQuery(): BoundQuery {
  return {
    query: `*[_type == "teamMembers" && ${CANONICAL} && ${WORSHIP_AUDIENCE_GROQ_FILTER}]{ _id, member_name, alias, memberType, ministries, unavailableDates }`,
    params: {},
  };
}

/**
 * IF2-28 — the rule set singleton, `$id` bound from `SOLVER_CONFIG_DOC_ID` (never a
 * second literal). Answers the stored document or `null`; the caller parses it with
 * `solverConfigFromDocument` and treats `null` as ABSENT, never as the defaults.
 */
export function solverConfigQuery(): BoundQuery {
  return {
    query: `*[_id == $id][0]`,
    params: { id: SOLVER_CONFIG_DOC_ID },
  };
}
