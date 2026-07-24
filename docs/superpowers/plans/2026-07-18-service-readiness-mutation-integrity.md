# Service Readiness A2 — protected mutation integrity

Date: 2026-07-18

## Goal

Make every service-role, live-setlist, and proposal writer target-safe, revision-aware, and atomic, while preserving existing notifications and cache behavior.

A2 answers:

> Can a protected writer reject stale or ambiguous state, serialize against every competing writer, and either commit all business changes or commit none?

## Dependencies and boundary

A2 begins only after:

- A1 canonical published/raw clients, validators, target helpers, member resolution, setlist observations, and integrity summaries are implemented and verified
- A3's isolated non-production Sanity verification environment and credentials are explicitly authorized, provisioned, and locally usable

A2 consumes A1 helpers rather than duplicating read semantics. It implements no Service Readiness cards and performs no Vercel deployment, `preview` promotion, production cleanup, or production Sanity write.

## Protected mutation scope

Runtime routes:

- POST `app/api/admin/roles/route.ts`
- PATCH/DELETE `app/api/admin/roles/[id]/route.ts`
- `app/api/admin/roles/publish/route.ts`
- new `app/api/admin/roles/swap/route.ts`
- new `app/api/admin/roles/copy-instruments/route.ts`
- PUT `app/api/admin/setlists/route.ts`
- POST `app/api/me/proposals/route.ts`
- proposal transitions in `app/api/admin/proposals/[id]/route.ts`
- guarded target/legacy-approval reconciliation actions

Client callers:

- `ServicesPanel`
- `app/components/admin/MonthGenerator.tsx`
- `SetlistEditor`
- `ProposalsPanel`
- `app/(client)/me/propose/[roleId]/ProposalEditor.tsx`

Protected stored types:

- `sunday_role`
- `saturday_role`
- `special_role`
- `featuredSongs`
- `saturdarSongs`
- `setlistProposal`
- new internal `roleTargetLock`
- new internal `roleCreationReceipt`

Suggested shared modules:

- `app/utils/serviceMutation.ts`
- `app/utils/roleCreationReceipt.ts`
- `app/utils/roleTargetLock.ts`
- `app/utils/roleDependencies.ts`
- `app/utils/proposalIntegrity.ts`
- `app/utils/serviceMutationSideEffects.ts`

## 1. Persistent weekend target locks

Add hidden/internal `roleTargetLock` with:

- deterministic `_id`
- `targetKey`
- `state: claimed | vacant`
- optional `roleId` stored as a plain string, not a strong reference
- `roleType`, `date`
- `claimNonce`/generation
- `createdAt`, `updatedAt`

IDs and keys:

- target `sunday_role:${week}` -> lock `roleTarget.sunday_role.${week}`
- target `saturday_role:${week}` -> lock `roleTarget.saturday_role.${week}`
- special roles use their own id/revision and do not receive weekend locks

Invariants:

- `claimed` has one non-empty `roleId` whose canonical role owns the same target
- `vacant` has no `roleId` and advances generation
- deletion vacates rather than deletes the lock
- recreation claims the same lock with a fresh, non-reused role id
- wrong-owner/orphan locks are integrity issues and are never reclaimed implicitly

Every Sunday/Saturday writer asserts/heartbeats the owned lock in the same business transaction. Special-service writers assert the special role revision.

Weekend locks serialize a weekend target only. They are never used as the create-request idempotency mutex; the cross-target, all-role-type mutex is the deterministic creation receipt in section 2.

Extend A1's role-target integrity summary with lock state/owner/generation and explicit missing, vacant-with-role, claimed-without-role, wrong-owner, and orphan-lock issues. One malformed lock remains a record-level issue and does not fail unrelated targets.

### Legacy bootstrap maintenance boundary

All body/id/type/cardinality, client-observed revision, raw-draft, ambiguity, and dependency validation runs before bootstrap. Invalid requests write nothing.

When exactly one canonical legacy weekend role lacks a lock:

1. revision-guard/heartbeat only its unchanged target field and create its claimed lock in a maintenance transaction
2. refetch role/lock and continue only from the produced revisions
3. report `409 bootstrap_completed_reload` when a later business conflict occurs

The later conflict leaves business fields unchanged and runs no notification/revalidation, but the lock and advanced role revision intentionally persist. Responses/logs expose that maintenance committed. Concurrent bootstrap losers reload; they never apply stale business data.

The isolated-dataset tests distinguish prevalidation zero-write rejection, bootstrap+business success, and bootstrap+business conflict with only documented maintenance state persisted.

## 2. Role create/edit/delete/publish

### Create and idempotency

- Require one bounded opaque `creationRequestId` per logical create. Canonicalize the complete create payload on the server, including role type, normalized target identity/date, normalized special-service name, effective publication default, and ordered normalized assignment/label inputs. Exclude the request id, generated `_key` values, role id, and timestamps. Hash that canonical value to a deterministic payload fingerprint.
- Add hidden/internal `roleCreationReceipt` as the global create-request mutex for `sunday_role`, `saturday_role`, and `special_role`. Its deterministic `_id` is derived from a collision-resistant digest of the exact request id; it stores the exact request id for equality verification, payload fingerprint, pre-generated role id, initial role type/target, `state: committed | role_deleted`, and timestamps. Its request identity, fingerprint, role id, and initial target fields are immutable. The role stores the receipt id and fingerprint, not a separately authoritative copy of the key.
- Before creation, fetch the deterministic receipt and inventory canonical/raw role, weekend lock when applicable, setlist, and proposal indexes for the requested target. Normal create never adopts orphaned history.
- If the receipt already exists, exact request-id equality plus the same fingerprint and a live role carrying that receipt is lost-response idempotent success: return the committed role without writes, notifications, or revalidation. Any same-key/different fingerprint -- including a different date, role type, or special target -- returns `409 idempotency_mismatch`. A `role_deleted` receipt returns `409 idempotency_key_retired`; a missing/mismatched result role returns an integrity conflict and is never recreated implicitly.
- If no receipt exists, pre-generate a fresh role id and use one transaction to `create` (not `createIfNotExists`) the deterministic receipt, create the role, and either create a claimed missing weekend lock or revision-guard a vacant weekend claim. A special-role create uses the same receipt transaction but has no weekend lock. Thus the receipt serializes same-key attempts across every role type and target, while the weekend lock independently serializes different keys competing for one weekend target.
- On transaction conflict, refetch the receipt first. If it now exists, apply the exact-key/fingerprint/live-result rules above; otherwise refetch target state and return the appropriate target/integrity conflict. Never blindly retry the original transaction. Different key/occupied weekend target returns `409` without leaving a receipt; any role, receipt, or lock conflict leaves all three business documents unchanged.
- When deleting a receipt-backed role, change its receipt to `role_deleted` in the same transaction that deletes the role and vacates any weekend lock. Legacy roles without a receipt remain deletable under the normal guarded policy. A later recreation is a new logical create and requires a new request id.

`ServicesPanel` creates one request id when an add-modal logical submission begins and retains it while that submission is retryable; changing the form after a failed attempt begins a new logical create with a new id rather than reusing the old key with a different payload.

`app/components/admin/MonthGenerator.tsx` adds a dedicated `creationRequestId` to each `DraftCard` when that preview draft is first constructed; it is distinct from the short UI `localId`, uses `crypto.randomUUID()` (or the shared opaque-id helper), and is sent on every POST for that draft. Editing or swapping assignments, a partial-batch result, `onCreated()` refresh, and retrying after an HTTP/network/lost-response failure preserve the draft's request id. Confirmed successes alone become `exists`; failed/unknown outcomes remain retryable with the same id. Explicitly generating a new preview creates new logical drafts and new ids.

Add focused route/helper and `MonthGenerator` tests that prove:

- sequential and concurrent same-key/same-payload replay creates exactly one receipt and one role for Sunday, Saturday, and special creates, with no replay side effects
- same key with a changed date/target, role type, special-service identity, or other payload returns `idempotency_mismatch` even when both targets are otherwise vacant; cover special-to-special and weekend-to-special reuse
- different keys racing for one weekend target are serialized by its target lock, while same-key attempts at different targets are serialized by the receipt; aborted transactions leave no stray role, receipt, or lock
- receipt-backed deletion atomically retires the key, a retired-key retry cannot recreate the role, and corrupt/missing receipt-result combinations fail closed
- a partial `MonthGenerator` batch marks only confirmed successes, retries only failed/unknown drafts, and sends byte-for-byte the same per-draft request id; a mocked lost response followed by replay also reuses the id and produces one server role/one side-effect attempt

### Edit

- Fetch stored role and derive old type/target from it; request `_type` never converts a document.
- Require the role revision observed by the client when it loaded/confirmed.
- Same-date weekend edits assert role plus owned lock revisions.
- A permitted date move atomically vacates old lock, claims missing/vacant new lock, and patches the role.
- Wrong owner, duplicate target, raw draft, dependency, stale role/lock, or destination conflict returns `409` without business mutation.

### Delete

- Require client-observed role revision and owned lock revision.
- Apply the dependency-refusal policy before bootstrap.
- Atomically vacate an owned weekend lock when applicable, retire a receipt-backed creation key, and delete the role.
- Never vacate a lock owned by another role.

### Publish

Exact request:

```ts
{ roles: [{ id: string; rev: string }], published: boolean }
```

- Validate exact boolean, non-empty bounded batch, canonical ids/revisions, no duplicates, and no `drafts.*` ids.
- Fetch only canonical `sunday_role | saturday_role | special_role` docs and require exact one-to-one cardinality/type/revision.
- Missing/wrong-type/stale/raw-draft/duplicate-target/wrong-owner entry rejects the complete batch during prevalidation.
- After any maintenance bootstrap/refetch, atomically patch all publication states and heartbeat all coordination tokens.
- Missing `published` remains grandfathered published; only actual `false -> true` transitions notify.

## 3. Confirmed date/deletion dependency policy

Normal create/move/delete never cascades, adopts, migrates, archives, or deletes service history.

- Weekend move/delete inventories old and proposed-new date-keyed canonical/raw setlists explicitly; `references(roleId)` cannot find date-paired setlists.
- Every role type inventories proposals through both `service_ref` and old/new target-key indexes, across every status, malformed/dangling/missing-role records, and raw drafts.
- Inventory unknown strong references.
- A destination proposal blocks even when it references another or missing role.
- Special deletion treats non-empty embedded songs as a dependency.
- Special date move keeps embedded songs but refuses proposal history that would become stale.
- Approved proposal history makes ordinary date/history mutation immutable.

Return exact ids/types with:

- `409 target_has_orphaned_dependencies`
- `409 role_date_has_dependencies`
- `409 role_has_dependencies`

Every setlist/proposal writer shares the service coordination token, so dependency absence is race-safe. Tests cover old/destination setlists, every proposal state, malformed/raw records, special songs, unknown refs, dependency-created-during-operation, and dependency-free paths. Dependency rejection precedes bootstrap and preserves business documents byte-for-byte.

## 4. Atomic swap and copy instruments

Add guarded swap requests:

```ts
type SwapRequest =
  | {
      kind: "seat";
      source: { roleId: string; rev: string; path: string; itemKey: string };
      target: { roleId: string; rev: string; path: string; itemKey: string };
    }
  | { kind: "team"; roles: [{ id: string; rev: string }, { id: string; rev: string }] };
```

- Derive assignments from current stored roles; never accept replacement team payloads.
- Seat swaps use stable stored `_key`, not rendered index, and preserve destination `_key`, instrument label, and FOH label.
- Team swaps exchange exactly `Lead`, `BGVs`, `Chorus`, `instruments`, and `foh_team`; preserve identity/date/name/publication/songs/team notes.
- Same-role, weekend-to-weekend, weekend-to-special, and special-to-special operations assert every involved role/coordination token in one transaction.
- Reject identical/missing-key/malformed/dangling/unsupported selections.

Add guarded copy-instruments:

- accepts source/target ids plus both client-observed role revisions
- reads both current singleton roles and never accepts cached client instrument payload
- asserts/heartbeats both coordination tokens in one transaction while patching only target instruments
- stale/deleted source, stale target, dangling assignment, invalid target, or conflict leaves target assignments unchanged

Post-commit additions are computed per destination role. Replace the current two-PATCH swap and cached-source copy handlers; `409` keeps modes open and requires reload.

## 5. Setlist concurrency

PUT submits A1's unchanged `observed` state:

- observed singleton requires the same target id and `_rev`
- observed none permits only deterministic creation at `featuredSongs.<week>` or `saturdarSongs.<week>`
- duplicate/draft/invalid target, stale identity/revision, or concurrent creation returns `409`
- weekend saves assert/heartbeat the owned lock in the same transaction
- special saves revision-guard the special role
- client retains observed state until success/reload and never closes on failure

All direct setlist writers and scripts use the same invariant or stop before writing.

## 6. Proposal concurrency and approval

Every proposal create/save/resubmit/request/reopen/reconcile/approve:

- uses A1's two indexes and never arbitrary `[0]`
- requires exact observed proposal id/revision when one exists
- heartbeats weekend lock or special-role revision
- uses deterministic proposal id for first-create mutex
- rejects duplicate/ambiguous groups
- refreshes target metadata from the authorized canonical role

Admin proposal reads include `_rev` and approval-input fingerprint fields. Admin transitions submit the revision actually reviewed; a freshly fetched server revision is not a substitute. `409` preserves the reviewed card/modal and requires reload.

### Approval

- allowed source states: `pending | changes_requested`
- require proposal content `ready`, canonical role/target, owned coordination token, safe setlist observation, no raw draft, and no duplicate group
- one transaction asserts proposal, role/coordination, and setlist state; writes live setlist; marks approved; and records approval receipt
- receipt fingerprints normalized target, ordered song refs/play keys/medley tags, team notes, timestamp, and app/version marker
- matching approved receipt/input-fingerprint retry is no-write success
- approved without valid receipt returns `409 legacy_approval_unverified`
- remove hidden sibling-proposal deletion

`request_changes`, `reopen`, and `reconcile_target` validate source state, client-observed revision, and transition fingerprint. Matching already-committed transitions may be explicit no-write retries; mismatches return `409`.

### Publish-ready transaction helper for Plan B

Expose a server-only helper that accepts the target states/revisions produced by one readiness computation and atomically asserts:

- role plus weekend lock, or special role
- setlist singleton id/revision or explicit `none`; weekend absence is protected by the same lock every deterministic setlist create must heartbeat
- proposal singleton id/revision or explicit absence protected by the service coordination token
- every assigned member revision used for availability across all five paths

If member availability cannot be asserted safely with the installed client without changing availability data, implementation stops and the plan is revised. A member `lastSeen` update may cause a conservative false conflict but cannot permit stale availability publication.

## 7. Post-commit side effects

Recipients derive from committed server state and all five seat paths, never client lists. Run only after a successful business commit:

- published create: every initial assignee
- published/grandfathered edit, swap, or copy: newly added assignees per destination role
- `false -> true`: every current assignee
- draft edit, unpublish, removal, no-op retry, prevalidation/transaction conflict: silent
- manual setlist save: existing `setlistRecipientIds` audience plus `revalidateServiceViews()`
- proposal committed as pending: existing admin/co-lead push and allowlist/preference-aware admin email
- request changes/reopen/approval: existing review-recipient push
- approval: `revalidateServiceViews()`
- successful role create/edit/delete/swap/copy/publish/unpublish: matching service/member cache revalidation once per affected batch

Delivery stays best-effort at-most-once. Failure is logged/swallowed and does not roll back content. Retries do not duplicate attempts; no exactly-once claim is made without an outbox.

## 8. Guarded cleanup, Studio, and scripts

Add a guarded operator command that is dry-run by default and requires exact ids/revisions, action-specific confirmation, a timestamped backup outside tracked files, post-write re-query, and a safe revision-aware restore command. Production `--apply` always requires separate explicit user consent.

Actions:

- discard exact raw draft
- select canonical duplicate role/setlist without implicit merging
- repair malformed record
- remove malformed role only after the same dependency inventory/refusal policy
- remove named orphan singleton setlist with proof no canonical owner exists
- retarget/normalize/remove non-approved proposal
- reconcile legacy approved receipt; never automatically delete approved history
- vacate orphan lock with published/raw proof
- inspect or remove one malformed/orphan creation receipt only by exact id/revision, after proving no live role carries it and no concurrent create can use it; committed or retired receipts are durable idempotency tombstones and normal cleanup never deletes them

Each target cleanup is atomic; multi-target cleanup is separate. Restore refuses later-write conflicts and never force-overwrites.

Protect all eight types in embedded Studio:

- hide from default create/structure affordances
- read-only fields/documents
- remove mutating actions even by direct URL
- keep locks and internal idempotency fields hidden
- allow useful read-only inspection

Audit and guard or retire these executable writers:

- `scripts/import-schedule.ts`
- `scripts/import-setlist-history.mjs`
- `scripts/cleanup-superseded-proposals.mjs`
- `scripts/migrate-shared-proposals.mjs`
- `scripts/sa-roster.mjs`
- `scripts/unpublish-july-2026.mjs`

Documentation-only retirement is insufficient; a script that cannot use the shared invariant must fail before any production write.

## 9. Isolated-dataset feasibility gate

Before replacing runtime writers, use A3's isolated dataset with the installed Sanity client to prove:

- role+receipt+weekend-lock create and same-key retry for Sunday/Saturday, plus role+receipt create and same-key retry for special
- same-key/different-payload conflicts across different dates, targets, and role types, including special roles
- receipt/target races, atomic rollback, receipt retirement on delete, and guarded malformed/orphan-receipt cleanup
- legacy bootstrap then guarded success/conflict
- vacant reclaim and delete+vacate
- dependency-created-during-move/delete conflict
- same/cross-role/team swap
- copy-instruments source assertion
- observed-singleton/none setlist conflicts
- proposal first-create/transition conflicts
- atomic approval and receipt retry
- multi-role publish

After every induced conflict, re-query all involved documents and prove no partial business state or side effects. Bootstrap cases prove only documented maintenance state persists. If Content Lake rejects a transaction shape or the isolated environment is unavailable, stop before production route replacement.

## Implementation order

1. Add receipt/lock internal fields, shared mutation/dependency helpers, error model, and isolated-dataset harness.
2. Pass the isolated transaction feasibility gate.
3. Replace role create/edit/delete/publish.
4. Add swap/copy endpoints and replace unsafe client handlers.
5. Guard setlist writes.
6. Guard proposal create/save/transitions and implement atomic approval/receipt.
7. Add the Plan B publish-ready transaction helper.
8. Extend A1 integrity summaries with lock state/issues.
9. Centralize/test post-commit side effects.
10. Implement cleanup/backup/restore.
11. Protect Studio and guard/disable every executable writer.
12. Remove all A1 mutation-read audit allowlist entries.
13. Update API/data-model/operations documentation and run the local gate.

## Verification and completion gate

Required on a clean branch commit:

- isolated-dataset contract suite
- `npx tsc --noEmit`
- `npm test`
- `npm run build`
- `git diff --check`

A2 is complete when every protected runtime/executable writer uses A1's canonical/raw contracts, exact observed revisions, shared coordination, strict dependency refusal, and atomic business transactions; alternate Studio/script paths are closed; side effects are preserved; cleanup is guarded; the isolated contract suite and local gates pass; and the A1 writer-read allowlist is empty.

A2 excludes Vercel deployment/promotion, production cleanup/backfill execution, Service Readiness UI, automatic history migration/cascade, exactly-once notification delivery, and any production Sanity write without separate consent.
