# Service Readiness A1 — canonical operational reads

Date: 2026-07-18

## Goal

Establish one explicit, deterministic read contract for service roles, live setlists, and proposals before any writer or Service Readiness UI relies on them.

Canonical runtime data comes only from Sanity's `published` perspective. Raw drafts are queried separately as integrity evidence. No consumer may select an arbitrary document from an ambiguous group or turn a malformed/failed read into ordinary empty state.

## Boundary and dependencies

This is the first foundation plan in the Service Readiness program.

A1 changes read paths only. It does not add locks, repair production data, make mutations concurrency-safe, or deploy/promote a branch. A2 must consume these clients, validators, target helpers, and response shapes rather than recreating them.

A1 is complete only when every runtime read of the six existing protected types has been inventoried and either migrated to the canonical contract or documented as an A2 writer-local handoff.

## Protected read scope

Existing protected stored types:

- `sunday_role`
- `saturday_role`
- `special_role`
- `featuredSongs`
- `saturdarSongs` (deliberate stored typo; never rename)
- `setlistProposal`

`teamMembers` is included only as the canonical dependency used to resolve assignments, contributors, and availability. `roleTargetLock` does not exist yet and belongs to A2.

For member ids actually referenced by an operational role/proposal, A1 also inventories a raw member draft overlay as an integrity issue and resolves display/availability only from the canonical member. It does not perform a global audit of unrelated member drafts.

Definitions:

- **Canonical document:** a non-`drafts.*` document returned by explicit Sanity `perspective: "published"`. For roles this includes application `published: false`, `true`, or missing.
- **Member-visible role:** a canonical role additionally filtered by `published != false`.
- **Raw integrity document:** a protected `drafts.*` document returned by a separately named `perspective: "raw"` query.
- A published document plus its draft overlay is one canonical document plus one blocking integrity issue, never two live targets.
- A draft-only protected document is zero live targets plus one blocking integrity issue.
- Associate every raw draft to its canonical identity by stripping the `drafts.` prefix from `_id` before any target grouping. If the overlay changes `week`, `date`, `service_ref`, `service_type`, or `service_date`, the canonical target identified by the base document still receives a blocking overlay issue; the draft's changed target metadata is retained only as issue evidence and never creates or clears a live target. A draft-only document is reported by normalized base id and its raw metadata but remains zero live targets.
- Application draft gating (`published != false`) is never used for canonical counts, duplicate detection, mutation targeting, or integrity grouping.

## 1. Explicit clients and query boundary

Add `sanity/lib/operationalClient.ts`:

- an explicitly configured canonical operational client using `perspective: "published"` and `useCdn: false`
- a separately named tokened raw-integrity client using `perspective: "raw"` and `useCdn: false`
- `server-only` protection for the module so neither client, especially the token-bearing raw client, can enter a client bundle
- no global change to `client`, `serverClient`, or `writeClient`, because unrelated auth/content behavior is outside this slice
- tests that inspect actual client configuration/fetch options, not only wrapper names

Add `app/utils/serviceReadQueries.ts`:

- protected-type constants
- bound-parameter canonical role/setlist/proposal projections
- scoped raw-draft inventory queries
- canonical member projection
- no untrusted GROQ interpolation

Add an audit test that inventories runtime query sites touching a protected type and fails when a new direct protected-type read bypasses the operational helper without an explicit allowlisted A2 writer-local reason. Detection covers both literal `_type` queries and generic `_id`/reference queries whose projection or call-site contract reads protected documents, so helpers cannot evade the audit merely by omitting a type literal. The allowlist names file, method, and removal owner; it is not a blanket file exemption.

## 2. Pure validation and grouping model

Add `app/utils/serviceReadModel.ts` with focused table-driven tests.

### Roles

A role is groupable only when it has:

- non-empty `_id` and `_rev`
- `_type` in the three role types
- valid `YYYY-MM-DD` `week` for Sunday/Saturday or `date` for special
- all five seat fields are arrays (missing or non-array fields are invalid), and every item has the stored shape expected for that field:
  - `Lead`, `BGVs`, and `Chorus`: `{ _key, _type: "reference", _ref }` with non-empty `_ref`
  - `instruments`: `{ _key, _type: "instrument_slot", instrument, person: { _type: "reference", _ref } }` with non-empty `instrument` and `person._ref`
  - `foh_team`: `{ _key, _type: "foh_slot", role, person: { _type: "reference", _ref } }` with non-empty `role` and `person._ref`
- every item in each of those five arrays has a non-empty `_key`, unique within that array
- raw reference ids and resolution state for all five assignment paths: `Lead`, `BGVs`, `Chorus`, `instruments[].person`, and `foh_team[].person`

The canonical member projection includes `_id`, `_rev`, `member_name`, `alias`, `unavailableDates`, and `unavailabilityNotes`. A non-empty assignment reference that has no canonical member is `dangling`, never `empty` or silently removed.

Invalid roles remain visible as integrity issues but never enter date slicing, sorting, target-key construction, target counts, or member-visible rendering.

### Target helpers

- role target: `sunday_role:${week}` or `saturday_role:${week}`; special uses its role id
- live setlist: `featuredSongs:${week}`, `saturdarSongs:${week}`, or special role id
- proposal target: `sunday:${service_date}`, `saturday:${service_date}`, or `special:${service_ref}`

These helpers are server-safe and shared with A2.

### Setlists

Separate canonical target state from draft evidence:

- `canonicalState: none | single | duplicate | invalid`
- `draftIds: string[]`
- public/admin `targetState` becomes `draft_conflict` whenever relevant raw drafts exist; otherwise it mirrors canonical state

A structurally safe setlist entry has a unique non-empty `_key` and a resolvable canonical `post` reference. Singleton content state is:

- `empty`: no entries
- `incomplete`: every entry is structurally safe but at least one `play_key` is empty
- `ready`: at least one entry and every structurally safe entry has a non-empty `play_key`
- `invalid`: malformed array/object, missing/duplicate `_key`, or missing/dangling song reference

Invalid content is never ordinary incomplete content.

### Proposals

A proposal is valid for grouping only when it has:

- non-empty `_id` and `_rev`
- `service_type` in `sunday | saturday | special`
- non-empty `service_ref`
- valid `YYYY-MM-DD` `service_date`
- status in `draft | pending | changes_requested | approved`
- `service_ref` resolves through the canonical operational client to one groupable canonical role, and its stored target metadata agrees with that role:
  - `sunday` requires `sunday_role` and `service_date == role.week`
  - `saturday` requires `saturday_role` and `service_date == role.week`
  - `special` requires `special_role` and `service_date == role.date`

Preserve raw target metadata, contributor/member resolution, song references, and `_createdAt`. Validate content separately as `empty | incomplete | ready | invalid` using the same key/reference principles.

Build both indexes:

- by `service_ref`
- by proposal target key

Invalid, dangling, unresolved-role, type-mismatched, and date-mismatched records are issues, not candidates in either index. When an existing display still requires ordering, use `pending`, `changes_requested`, `draft`, `approved`, then oldest `_createdAt`; never `[0]` without validated grouping.

## 3. Runtime read inventory and migration

Migrate protected reads in these member-facing surfaces:

- `app/(client)/page.tsx`
- `app/(client)/schedule/page.tsx`
- `app/(client)/me/page.tsx`
- `app/(client)/me/propose/[roleId]/page.tsx`
- protected history queries in `app/(client)/posts/[slug]/page.tsx`
- `app/api/song/[id]/route.ts`
- `app/api/me/songs/route.ts`
- `app/api/notifications/count/route.ts`
- `app/api/cron/service-reminders/route.ts`

Rules:

- retain `published != false` for member-visible roles
- pair weekend setlists only with one valid member-visible role and one valid canonical setlist target
- fail closed on duplicate/invalid/draft-conflict service targets rather than leaking or choosing data
- history/recent-play queries canonicalize by target before counting plays; ambiguous targets do not create false play history
- notification/reminder assignment reads cover all five seat paths through `assignedMemberRefsQuery()` semantics
- malformed records cannot crash `.slice()`, date formatting, or sorting

Migrate GET/read portions of mixed routes without changing their mutation methods:

- GET in `app/api/admin/roles/route.ts`
- GET in `app/api/admin/setlists/route.ts`
- GET in `app/api/admin/proposals/route.ts`
- GET in `app/api/me/proposals/route.ts`

Migrate the role lookup inside `notifyProposalSubmitted()` in `app/utils/proposalNotify.ts` to the canonical helper. It is an operational notification read, not a mutation-local A2 exception: resolve exactly one valid canonical role by `roleId`, obtain `Lead` references using all normal role validation, and fail closed/no-notification on missing, draft-conflicted, or invalid identity.

Explicit A2 handoff allowlist:

- mutation-local reads in `app/api/admin/roles/[id]/route.ts`
- mutation-local reads in `app/api/admin/roles/publish/route.ts`
- POST in `app/api/admin/roles/route.ts`
- PUT in `app/api/admin/setlists/route.ts`
- mutations in `app/api/admin/proposals/[id]/route.ts`
- POST in `app/api/me/proposals/route.ts`
- `scripts/cleanup-superseded-proposals.mjs` — query `setlistProposal`, then delete stale non-approved proposal documents
- `scripts/import-schedule.ts` — create-if-missing and patch `sunday_role`/`saturday_role` assignment arrays
- `scripts/import-setlist-history.mjs` — query existing `featuredSongs`/`saturdarSongs`, then create missing history documents
- `scripts/migrate-shared-proposals.mjs` — query `setlistProposal`, patch the retained shared proposal, and delete loser documents
- `scripts/sa-roster.mjs` — query role documents and patch `Lead`/`BGVs`/`Chorus` roster arrays in its `assign`/`clear` operations
- `scripts/unpublish-july-2026.mjs` — query July role documents and patch `published: false`

The audit represents each exclusion as an exact file plus method/operation entry and rejects any unlisted protected read or writer, including a newly added script; directory or glob exemptions such as `scripts/**` are forbidden. A2 owns removal or canonical-read migration of every entry above and removes each allowlist entry in the same change that migrates or retires its writer.

## 4. Admin setlist GET contract

Replace arbitrary target selection with an additive response that preserves `recentSongs`:

Validate the request before querying a target or returning `targetState: "none"`: `type` must be exactly `sunday | saturday | special`; the service date (`week` in the current request shape) must be present and valid `YYYY-MM-DD`; Sunday/Saturday require that date as their target; and special requires a non-empty `roleId` resolving to a canonical `special_role` with a valid `date` equal to the requested service date. Missing, malformed, or mismatched request identity returns a 400/integrity error and can never be represented as an absent target.

```ts
type SetlistReadBase = {
  // Preserve the existing additive response fields on every success branch.
  setlistId: string | null;
  songs: unknown[];
  recentSongs: Record<string, string>;
};

type SetlistRead = SetlistReadBase & (
  | {
      targetState: "none";
      observed: { state: "none" };
      songs: [];
      setlistId: null;
    }
  | {
      targetState: "single";
      contentState: "empty" | "incomplete" | "ready" | "invalid";
      observed: { state: "single"; id: string; rev: string };
      songs: unknown[];
      setlistId: string;
    }
  | { targetState: "duplicate"; conflictingIds: string[]; draftIds: string[]; setlistId: null; songs: [] }
  | { targetState: "draft_conflict"; draftIds: string[]; canonicalIds: string[]; setlistId: null; songs: [] }
  | { targetState: "invalid"; reason: string; recordIds: string[]; setlistId: null; songs: [] }
);
```

For special services, singleton observation uses the special-role id/revision.

Update `SetlistEditor` so only canonical `none` or singleton `empty | incomplete | ready` opens editable state. Duplicate, draft conflict, invalid target/content, HTTP failure, and malformed response stay non-editable with Spanish retry/integrity copy. `recentSongs` continues powering repeat-song warnings.

## 5. Independently loadable integrity summaries

Add read-only manager routes:

- `app/api/admin/service-integrity/roles/route.ts`
- `app/api/admin/service-integrity/setlists/route.ts`
- `app/api/admin/service-integrity/proposals/route.ts`

These routes follow the existing service-admin authorization contract: call `requireActiveManager()` and then reject `content-editor`, leaving only `admin` and `super-admin`. This is not an access expansion; add route tests for unauthenticated, member, and content-editor denial.

Response shapes:

- role targets: target key, canonical count/ids, canonical state, application publish state, raw assignment ids, canonical members, dangling refs, invalid-record issues, draft ids
- setlist targets: target key, canonical count/ids, canonical/content state, song count/keys, invalid-entry issues, draft ids
- proposals: validated records, referenced-role metadata, both grouping conflicts, content state, record issues, draft ids

One malformed record does not fail the domain response. The three domains load independently; a route-level failure remains a domain error and is never converted to an empty clean result.

Update admin read consumers only as needed to preserve existing behavior and surface non-editable integrity errors:

- `ServicesPanel`
- `AvailabilityPanel`
- `MonthGenerator`
- `ProposalsPanel`

Do not implement the Service Readiness card redesign in A1.

## 6. Documentation and tests

Update `docs/ARCHITECTURE.md`, `docs/DATA_MODEL.md`, and `docs/API_REFERENCE.md` with:

- explicit published/raw perspective terminology
- canonical versus member-visible distinction
- protected-read audit rule
- integrity summary contracts
- exact A2 writer exclusions

Required coverage:

- both operational clients expose the intended perspective, set `useCdn: false`, and cannot be imported into client code
- published-plus-draft and draft-only records for every protected type
- changed-target draft overlays remain attached by normalized base id to the canonical target and cannot make that target appear clean
- canonical `published: false` role counts versus member visibility
- canonical member plus raw member draft parity
- dangling refs across all five seat paths
- invalid types/dates excluded before target construction
- singleton/duplicate/invalid/draft-conflict role and setlist groups
- setlist empty/incomplete/ready/invalid, duplicate/missing keys, malformed entries, dangling songs
- valid/malformed/dangling/duplicate proposal groups through both indexes
- proposal references whose canonical role type or date disagrees with `service_type`/`service_date` are invalid and excluded from both indexes
- member pages fail closed on ambiguous targets without leaking drafts
- history/count/reminder queries do not double-count overlays or ambiguous targets
- `notifyProposalSubmitted()` cannot select an arbitrary role and sends nothing for missing, ambiguous, invalid, or draft-conflicted role identity
- weekend and special setlist GET responses, including `recentSongs`
- every successful setlist GET branch preserves top-level `setlistId`, `songs`, and `recentSongs`; conflict branches return `setlistId: null` and `songs: []`
- setlist GET rejects invalid `type`, missing/malformed service date, missing special `roleId`, and special role/date mismatches before any `none` response
- editor failure/malformed states never become editable empty state
- summary record-level issue preservation and source-failure isolation
- integrity summary authorization denies member and content-editor roles while allowing admin and super-admin
- read-audit allowlist is exact by file and operation, contains only A2-owned mutation reads/writers, rejects new unlisted scripts, and contains no directory/glob exemption
- read-audit fixtures prove both literal protected-type queries and generic `_id` protected-role reads are detected

## Implementation order

1. Add explicit operational clients and configuration tests.
2. Add pure target, validation, grouping, and content-state helpers/tests.
3. Add canonical projections, all-five-path member resolution, and raw inventory.
4. Add the exact read-site audit and temporary A2 allowlist.
5. Add the three integrity summary routes/tests.
6. Migrate member pages, history, notification, and reminder reads.
7. Migrate GET portions of mixed API routes.
8. Implement the additive setlist GET contract and editor fail-closed behavior.
9. Update admin consumers and documentation.
10. Run the local gate.

## Verification

Required on a clean branch commit:

- `npx tsc --noEmit`
- `npm test`
- `npm run build`
- `git diff --check`

A1 performs no Sanity writes, cleanup, Studio mutation, Vercel mutation, preview promotion, or production deployment.

## Completion gate

A1 is complete when:

- all read-only runtime consumers of the six existing protected types use explicit canonical reads
- raw protected drafts are inventoried separately
- malformed, dangling, duplicate, and draft-conflict data is represented without arbitrary selection
- the three read domains expose independent integrity summaries
- setlist GET exposes an observed state and preserves `recentSongs`
- the editor cannot mistake bad data or a failed request for an empty setlist
- the only remaining direct protected reads are exact, documented A2 mutation-local allowlist entries

A1 does not claim writer safety, uniqueness enforcement, locks, revision-guarded writes, proposal approval safety, cleanup tooling, Studio protection, publish-ready transactions, isolated mutating deployment checks, preview promotion, or completion of the full Service Readiness program.
