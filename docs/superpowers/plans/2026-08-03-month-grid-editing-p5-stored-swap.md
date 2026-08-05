# Implementation Plan: Topology-safe stored swaps with all-role reconciliation

> **Historical plan — implemented 2026-08-05.** Delivered in `3e0ab97` and
> preview merge `4d7165b`. See [`../../MONTH_GRID_EDITING.md`](../../MONTH_GRID_EDITING.md)
> and the [implementation log](2026-08-03-month-grid-editing-implementation-log.md).

## Original request

> “For editing the services, I want to see the 3 column grid layout we just built. So there should be an ‘Edit month’ button that opens this layout. This will replace individual edits for a more robust edit view.”
>
> “I want to drop Tablero and make the grid the king of editing.”
>
> “The grid should also have the functionality to swap teams or just certain roles from one service to another.”
>
> Later scoped down: “Let’s leave the auto fill with solver for a single service for later. We just need to be able to create a single new service and fill it manually.”

## Status and contract

- Document status: Draft; implementation is not authorized.
- Accepted spec or requirement source: `2026-08-03-month-grid-editing.md`, especially R4, R7, R10, R13, R14 and D6–D7.
- Primary outcome: Admins swap either all five stored team arrays or two stored seat occupants from **Editar mes**, while the server rejects incompatible/hidden topology before maintenance and the client adopts no role until canonical readback proves the complete multi-role intent.
- Preconditions: P1’s role-ID grid/read-admission model, P2’s truthful coordination/bootstrap contract, and P4’s frozen-attempt/status/reconciliation model are byte-current and have passed their acceptance gates.
- Safe ending state: Additive grid swap is complete and independently releasable only under later authority; card swap and `SeatBoard` remain available until P6. No production content, remote state, or release branch is changed by this plan.

## Evidence and current behavior

| Evidence | Source | Planning implication |
|---|---|---|
| Swap has exactly two parsed request shapes and derives writes from stored roles; it accepts no replacement roster. | `app/api/admin/roles/swap/route.ts:43-61,74-110`; `app/utils/roleWriteRequest.ts`; `app/utils/__tests__/roleWriteRequest.test.ts:445-476` | Preserve the identifier/revision/item-key boundary and do not add a roster payload. |
| Team swap exchanges exactly `Lead`, `BGVs`, `Chorus`, `instruments`, and `foh_team`; seat swap changes only addressed person refs. | `app/api/admin/roles/swap/route.ts:120-174` | Whole-team items/keys travel together; a seat’s destination key and exact label stay fixed. |
| Saturday alone hides Coro, but the route currently permits all stored type pairings and performs no topology check. | `app/components/admin/plannerModel.ts:280-305`; `app/api/admin/roles/swap/route.ts:86-108,154-168` | Authoritative compatibility is Saturday↔Saturday or non-Saturday↔non-Saturday, and hidden Saturday Coro is an integrity refusal. |
| Member resolution and coordination occur after stored write planning; legacy coordination can commit maintenance before a later refusal/conflict. | `app/api/admin/roles/swap/route.ts:176-239`; `app/utils/roleWriteOps.ts:282-351,446-506` | Topology refusal must precede member/coordination work, and every inherited bootstrap outcome remains truthful across both roles. |
| The business transaction revision-guards all roles/tokens, commits before cache/notification effects, and returns no refreshed rosters/revisions. | `app/api/admin/roles/swap/route.ts:194-276` | A 2xx still requires roles GET plus E13 readback; 5xx, malformed/untyped non-2xx, and transport loss are unknown outcomes. |
| Existing route tests record every mocked transaction and already pin stable-key seat writes, five-array team writes, special/weekend coordination, and bootstrap conflict mapping. | `app/api/__tests__/roleSwapRoutes.test.ts:1-7,343-668,672-869` | Extend this route harness with topology and multi-role maintenance cases; retain its zero-transaction assertions. |
| Card swap is still the shipping client workflow. | `app/components/admin/ServicesPanel.tsx:732-829,1333-1343,1440-1457,1548-1551,1610-1620`; `ServiceReadinessCard.tsx:79-101,186-200,409-445` | P5 adds grid swap without removing card swap; P6 owns cutover. |

## Scope

### In scope

- Add server-authoritative whole-team topology/hidden-data checks after both roles load and before member resolution, coordination, or maintenance.
- Add whole-team and stored-item seat selection/confirmation to the P4 month editor using P1-approved IDs, revisions, exact labels, and stored item keys.
- Freeze the exact existing route request plus the expected post-swap snapshot bundle for every involved role.
- Reconcile 2xx, unknown, maintenance, stale, and concurrent-overwrite outcomes through roles GET plus E13 all-role matching.
- Add mutation-discriminating route, pure-state, interaction, concurrency, and recovery tests.

### Non-goals

- A roster-bearing swap request, a new swap endpoint, per-cell autosave, type conversion, solver/local auto-fill, or moving card workflows other than swap.
- Removing card swap, `SeatBoard`, or any current fallback; P6 owns those changes.
- Automatic inverse swap, automatic new-revision retry, production Sanity writes, migration, deployment, merge, push, or PR.

### Preserved invariants

- Team compatibility is true iff both roles are `saturday_role` or both are in `{sunday_role,special_role}`.
- A stored Saturday has empty `Chorus`; hidden/noncanonical data is never translated to an empty visible row and written.
- Team swap moves all five stored arrays atomically without changing role identity/date/name/publication/songs/notes. Seat swap exchanges only person refs and preserves each destination `_key` and exact instrument/FOH label.
- Every request uses observed role revisions and, for seats, stored item keys. Globally unclean grid state issues zero swap fetches.
- No involved role becomes clean unless one coherent roles-GET/E13 readback matches every frozen intended snapshot and expected key/label topology.

## Affected boundaries

| Component, file, or system | Current responsibility | Planned responsibility |
|---|---|---|
| `app/api/admin/roles/swap/route.ts` | Loads stored roles, derives seat/team writes, resolves members/coordination, atomically commits, then triggers side effects. | Reject incompatible team classes and hidden Saturday Coro before member/coordination/maintenance while preserving both request shapes and writer ordering. |
| `app/utils/roleWriteRequest.ts` | Parses the two existing swap shapes and locates stable-key seats. | Remains the request authority; no roster fields or third shape are added. |
| P1/P4 grid model and month-editor orchestration (`PlannerGrid`, `MonthGenerator`, bounded pure helpers) | Own stored columns/cells, source admission, snapshots, statuses, and explicit saves. | Own clean-state swap selection, exact attempt freezing, all-role result state, and readback reconciliation without duplicating server swap logic. |
| `GET /api/admin/roles` plus roles integrity | Provide dereferenced rosters/keys/revisions and independent canonical/ref/topology evidence. | Sole post-swap adoption source through P1’s E13 join. |
| `app/api/__tests__/roleSwapRoutes.test.ts` and directly relevant grid/state tests | Pin existing writer and UI behavior. | Prove topology order, zero writes, exact client bodies, atomic all-role reconciliation, concurrency, and bootstrap propagation. |
| Sanity role/coordination documents and revision history | Authoritative stored state and operator restoration history. | No schema/migration change; later authorized recovery restores both coordinated roles as one coherent pair, never by blind inverse. |

## Ordered changes

### 1. Enforce topology before any maintenance-capable path

- Purpose: Make unsafe whole-team pairings and hidden Saturday data impossible even for a bypassed/stale client.
- Components: `app/api/admin/roles/swap/route.ts`; `app/api/__tests__/roleSwapRoutes.test.ts`.
- Change: Immediately after all observed-revision role loads, validate every involved Saturday has an empty stored `Chorus`. For `kind:"team"`, allow only Saturday/Saturday or non-Saturday/non-Saturday; return typed `integrity_conflict` for hidden Saturday Coro and typed `invalid_request` with a topology detail for a cross-class pair. Do this before canonical-member resolution, `resolveOwnedCoordination`, or any transaction.
- Failure and recovery behavior: Refusal is known pre-maintenance, performs zero transactions/side effects, and leaves client selection available for correction. It never returns a bootstrap maintenance outcome because bootstrap was not entered.
- Verification: Route tests cover Sunday/Sunday, Sunday/special in both orders, special/special, and Saturday/Saturday success; Sunday/Saturday and special/Saturday in both orders refuse with zero transactions/member-resolution/coordination calls; every request involving nonempty Saturday `Chorus` refuses before maintenance.
- State after this step: Server hardening is safe independently; existing compatible card/client calls still work.

### 2. Add stored-state swap controls to the globally clean grid

- Purpose: Put manual whole-team and individual-seat swap where stored editing now lives without letting stored-state writes ignore visible edits.
- Components: P1/P4 grid components and the smallest bounded pure swap-attempt helper; directly relevant tests.
- Change: Add Spanish, keyboard-operable, minimum-44px team/seat selection and review controls. Re-check `guardControl("swap")`, E13 approval, role ID/revision, and P4 status for the entire displayed grid. Permit POST only when every service is clean and unfrozen; refuse dirty, saving, conflicted, unknown, maintenance-reload, or newly picked/keyless occupants with “guarda o descarta primero” guidance. Build exactly the existing team or seat body—identifiers/revisions and stored paths/item keys only.
- Failure and recovery behavior: Admission refusal issues zero fetches and preserves edits. A source disappearing or revision changing clears the selection and requires canonical reload/reselection. Client handlers retain the repository try/catch/finally, `res.ok`, and truthful-loading requirements.
- Verification: Interaction/pure tests prove every excluded status and keyless occupant blocks fetch, exact request bodies contain no roster, seat path/key selection is stable, labels/keys are not rewritten, and same-role seat swaps retain one agreed revision.
- State after this step: Compatible clean-grid swaps can be requested; card swap remains untouched.

### 3. Freeze intent and reconcile every involved role atomically

- Purpose: Avoid partial clean adoption, accidental inverse swaps, and false failure/success after concurrent writes or lost responses.
- Components: P4 attempt/status model, P1 readback join, grid swap orchestration, directly relevant tests.
- Change: Before POST, freeze `{exactRequest,intendedSnapshotsByRoleId}` for all involved roles. Each intent contains canonical editable semantics and expected stored key/label topology: team intent exchanges all five source arrays while retaining each destination role’s identity/date/name; seat intent exchanges only selected member IDs while retaining both destination seats’ keys/labels. Treat 2xx as known committed but freeze every involved column until one roles-GET/E13 refresh matches **all** intents. Treat 5xx, malformed/untyped non-2xx, unexpected status, thrown/lost response, and `bootstrap_outcome_unknown` as unknown and reconcile the same frozen request/intents. Equality for all roles resolves current commit; any incoherent/missing role remains frozen; a known-commit mismatch becomes whole-operation committed-then-superseded/conflicted, while an unknown mismatch remains unknown/conflicted. Never partially replace baseline/roster/revision.
- Failure and recovery behavior: Preserve unrelated grid state and every intent/latest remote observation. `bootstrap_completed_reload` forces all involved roles to reload maintenance metadata while semantic rosters/baselines stay unchanged, clears selection, and requires review plus explicit reselection. Only an explicitly chosen exact old-revision replay may follow the inherited protocol; never auto-retry from new revisions and never issue a blind inverse.
- Verification: Team and seat cases cover 2xx, post-commit 500/malformed response, transport loss, stale old-revision replay, failed/incoherent readback, and a concurrent overwrite of either role before readback. Mutants that compare only one role, invert intent equality, partially adopt, forget an earlier bootstrap, or retry at a new revision make named assertions red.
- State after this step: Additive grid swap has a complete forward-recovery contract and is safe to hand to P6 after gates.

### 4. Prove multi-role maintenance and restoration boundaries

- Purpose: Ensure maintenance persistence and content rollback are handled as coordinated two-role outcomes.
- Components: `roleSwapRoutes.test.ts`, P2 coordination outcomes as consumed by swap, recovery documentation/checklist if the repository’s existing runbook requires a bounded update.
- Change: Extend multi-role tests so a first/later role bootstrap followed by a second-role coordination/integrity refusal, lost bootstrap response, or business transaction conflict propagates `bootstrap_completed_reload` or `bootstrap_outcome_unknown` for the whole operation with cause evidence and no business write. Record the later-release recovery rule: use the two request role IDs/observed revisions and Sanity history to restore both documents to one verified pre-swap pair; do not run the swap again as an inverse.
- Failure and recovery behavior: Maintenance readback updates only coordination/revision metadata and requires reselection. A released content recovery stops if either historical role revision is unavailable or the restored pair fails roles GET/E13 coherence.
- Verification: Mocked route histories distinguish first-role and later-role maintenance; a no-network recovery tabletop verifies both role revisions, all five arrays, identity fields, and E13 coherence are checked together.
- State after this step: Recovery evidence is complete without performing a production read or write.

## Data and failure safety

- Identity and source of truth: Stored role `_id` identifies each column; observed `_rev`, stable item `_key`, exact stored label, roles GET, and revision-matching E13 integrity evidence identify an admissible swap/readback.
- Migration and compatibility: No schema, endpoint, or data migration. Both existing request shapes remain compatible; unsafe cross-topology team calls now receive typed refusal.
- Partial failure and retry behavior: The server transaction stays atomic. Client 2xx/unknown outcomes freeze the full operation; only all-role intent equality permits adoption. Maintenance outcomes use P2’s discriminated result and stop/reload/review behavior.
- Concurrency, conflicts, and idempotency: Role/token revisions serialize the write. Exact old-revision replay cannot double-commit; new-revision or inverse replay can reverse a committed swap and is prohibited unless a human starts a genuinely new reviewed intent.
- Data preservation and rollback: Seat destinations retain key/label; team swaps touch exactly five arrays. Pre-release code revert restores additive controls. After later authorized real swaps, restore both historical role revisions as a coordinated pair and verify roles GET/E13; code rollback alone does not restore content.

## Verification

| Requirement | Test or check | Failure it detects |
|---|---|---|
| Authoritative compatible topology | Positive matrix: Sunday/Sunday, Sunday/special both orders, special/special, Saturday/Saturday | Over-restricting valid non-Saturday or Saturday swaps. |
| Cross-class and hidden-data refusal before maintenance | Negative matrix in both orders plus nonempty Saturday Coro; zero transaction/member/coordination assertions | Hidden roster loss or maintenance persistence on an invalid request. |
| Existing stored-state request contract | Exact client-body assertions and parser pins | Roster leakage, missing revisions, rendered-index addressing, or a new request shape. |
| Seat/team preservation | Route patch assertions and all-role expected topology snapshots | Rewritten destination keys/labels or edits to identity/non-seat fields. |
| Globally clean admission | Status/key/source matrix with fetch spy | Swap silently ignoring visible edits or keyless occupants. |
| Truthful complete reconciliation | 2xx/unknown/stale/maintenance/readback matrix for team and seat | Partial clean adoption, false failure/success, or raw-response adoption. |
| Concurrent overwrite safety | Overwrite either role after known 2xx; retain every intent/remote observation | Adopting another admin’s write as this operation’s baseline. |
| Bootstrap propagation | First/later bootstrap followed by later refusal, lost response, or business conflict | Forgetting an earlier maintenance commit or continuing to business write. |
| Mutation discrimination | Temporarily invert topology, all-role equality, and earlier-bootstrap propagation; record targeted red assertions | Green tests that do not enforce the safety predicates. |
| Two-role content recovery | Mock/tabletop restoration of both observed revisions followed by all-five-array and E13 checks | Blind inverse or one-sided historical restoration. |
| Repository completion gate | `npx tsc --noEmit`; `npm test`; `npx eslint .` with 0 errors | Type, behavior, or lint regression. |

## Rollout, observability, and rollback

- Release sequence and gates: Sequence only after accepted P1, P2, and P4 outputs. Complete steps 1–4, targeted mutants, then all three repository gates. The allowed intermediate is additive grid swap with card swap still shipping; no deploy/push/merge is authorized.
- Signals proving success: Typed topology refusals have zero transactions; compatible calls commit one atomic business transaction; the UI displays whole-operation status until all-role readback resolves; route tests observe expected post-commit side effects only after commit.
- Stop conditions: Any hidden topology reaches coordination, any request contains roster data, any role is partially adopted, any unknown outcome auto-retries, either historical role revision is unavailable, inherited prerequisite changes, or a gate fails.
- Rollback or forward-recovery steps: Revert additive code before release. For frozen attempts, retain exact request/intents and reconcile through roles GET/E13. For later authorized content recovery, restore both pre-swap role revisions together from Sanity history; do not inverse-swap.
- Restoration verification: Reload both role IDs plus integrity, require matching revisions/canonical state/assignment sets/topology, compare all five arrays and untouched identity fields, then clear the frozen UI state only after coherent all-role evidence.

## Decisions

| Decision | Choice | Why | Tradeoffs | Owner |
|---|---|---|---|---|
| Team topology | Saturday/Saturday or non-Saturday/non-Saturday only | Saturday hides Coro; Sunday and special expose the same five-field topology. | Existing cross-class calls become typed refusals. | P5 |
| Hidden Saturday Coro | Reject every involved role before maintenance | Translating hidden data to empty is destructive. | Corrupt legacy data needs separate repair before swap. | P5 |
| Swap writer | Reuse `POST /api/admin/roles/swap` unchanged in shape | It already derives and revision-guards stored state atomically. | Client must perform canonical readback because response lacks rosters/revisions. | P5 |
| Admission | Entire displayed grid must be clean | Prevents stored writes from ignoring visible state. | An unrelated dirty service delays swap. | P5 |
| Adoption | All involved role intents/topology match or none adopt | Swap is one logical multi-role operation. | One overwritten role freezes both. | P5 |
| Recovery | Exact old-revision reconciliation or coordinated history restoration, never blind inverse/new-revision retry | A repeated swap can undo an already committed result. | Recovery requires explicit review and may need operator history access. | P5/operator |

## Assumptions

| Assumption | Impact if false | Validation point | Failure response |
|---|---|---|---|
| P1 readback preserves every stored key/exact label and rejects hidden topology. | Intended topology cannot be constructed or verified safely. | P1 acceptance fixtures plus P5 route/readback tests. | Keep swap disabled and return to P1 contract/review. |
| P2 exposes truthful multi-role bootstrap outcomes with cause evidence. | A maintenance commit could be reported as ordinary failure. | P2 contract tests and P5 first/later-role propagation tests. | Stop P5; do not flatten or infer outcomes client-side. |
| P4 statuses/frozen attempts can represent one multi-role operation without overwriting unrelated local state. | Reconciliation could erase edits or partially clean roles. | P5 concurrency/state tests. | Keep additive controls non-released and revise P4/P5 contracts. |
| Both requested historical role revisions remain available for later operator restoration. | Post-release content cannot be safely restored as a pair. | Recovery tabletop before any later release authorization. | Stop release until a verified forward/content-recovery path exists. |

## Open questions

| Question | Why it matters | Recommendation and why | Tradeoffs | Owner | Blocking? | Resolution point | Bounded default |
|---|---|---|---|---|---|---|---|
| None. | Parent decisions and repository evidence settle topology, trust, result classification, and recovery. | Continue to adversarial review in roadmap order when explicitly requested. | Review may still require parent/prerequisite propagation. | Review coordinator | No | Before implementation | Do not implement. |

## Handoff

- Prerequisites supplied to later plans: P1/P2/P4 byte-current contracts and this plan’s topology matrix, exact-attempt bundle, grid controls, all-role reconciliation tests, and two-role recovery evidence.
- Outputs promised to later plans: P6 may remove card swap only after these outputs and all P5 gates pass; it inherits grid swap as the sole manual swap workflow.
- Adversarial review order: Parent roadmap → P1 → P2 → P3 → P4 → this P5 plan → P6, one fresh reviewer at a time. A material prerequisite/contract change propagates and restarts review from the earliest affected artifact.
- Implementation authorization: **not granted by this plan**
- Remote-state authorization: No production Sanity write, migration, deploy, merge, push, or PR is authorized.

## Terminal state

READY_FOR_ADVERSARIAL_REVIEW
