# Implementation Plan: Canonical assignee validation and role-writer coordination hardening

> **Historical plan — implemented 2026-08-05.** Delivered in `3e0ab97` and
> preview merge `4d7165b`. See [`../../MONTH_GRID_EDITING.md`](../../MONTH_GRID_EDITING.md)
> and the [implementation log](2026-08-03-month-grid-editing-implementation-log.md).

## Original request

> "For editing the services, I want to see the 3 column grid layout we just built. So there should be an 'Edit month' button that opens this layout. This will replace individual edits for a more robust edit view."
>
> "I want to drop Tablero and make the grid the king of editing."
>
> "The grid should also have the functionality to swap teams or just certain roles from one service to another."
>
> "Let's leave the auto fill with solver for a single service for later. We just need to be able to create a single new service and fill it manually."

This independent backend child hardens the existing roles candidate/read and mutation boundaries before the grid adds create, edit, or swap orchestration. It preserves current full-array and canonical stored-assignment behavior; it does not add member-type eligibility enforcement.

## Status and contract

- Document status: Draft
- Accepted spec or requirement source: `docs/superpowers/plans/2026-08-03-month-grid-editing.md`, especially R8, R10, the server trust prerequisite for R2, and shared decision D5
- Primary outcome: existing role writers accept only published-perspective canonical member IDs, report lock-bootstrap persistence truthfully, and serialize special create/identity-change collisions through one governed global coordinator
- Preconditions: none; this backend hardening is independent of P1 and supplies writer contracts to P3–P5
- Safe ending state: backend changes are independently deployable after all gates, with no migration; absent explicit release authority they remain held non-deployed, and implementation/testing performs no production Sanity write

## Evidence and current behavior

| Evidence | Source | Planning implication |
|---|---|---|
| Admin member candidates use `serverClient`, whose perspective is implicit. | `app/api/admin/members/route.ts:3-25`; `sanity/lib/serverClient.ts:4-11` | Serve candidates through the explicit published-perspective operational client so drafts never become selectable. |
| `operationalClient` explicitly selects `perspective: "published"`; the repository notes that older API defaults can leak raw drafts. | `sanity/lib/operationalClient.ts:7-23` | Reuse this canonical runtime perspective for candidates and ID resolution. |
| Request parsing accepts nonempty IDs across all five seat arrays, and `seatFields` writes those refs directly. | `app/utils/roleWriteRequest.ts:76-171`, `267-299`, `304-335` | Resolve every submitted assignee before any maintenance or business write. |
| `seatAssignees` already returns unique assignees across Lead, BGVs, Chorus, instruments, and FOH. | `app/utils/roleWriteRequest.ts:136-147` | Use it rather than reimplementing all-five-field traversal. |
| `loadCanonicalMemberIds` already performs published-perspective canonical member lookup through the shared operational runner. | `app/utils/roleWriteOps.ts:187-193` | Reuse it for POST/PATCH missing-ID refusal. |
| Roles POST handles an existing receipt before first-attempt occupancy and writes. Exact replay has no writes or side effects. | `app/api/admin/roles/route.ts:124-150`, `293-322` | Validate assignees only on first attempt; preserve receipt replay as a no-write tombstone path even if membership later changes. |
| Roles PATCH loads and validates the role, may bootstrap a missing weekend lock, then writes all five arrays by `.set(...)`. It does not resolve submitted assignees. | `app/api/admin/roles/[id]/route.ts:112-140`, `179-235` | Resolve the parsed full-array request before coordinator/bootstrap/transaction construction. Do not add eligibility reinterpretation. |
| `bootstrapLegacyLock` generates its nonce internally and maps every commit rejection to `committed:false` without reconciliation. | `app/utils/roleWriteOps.ts:444-506` | Retain the nonce and replace boolean ambiguity with evidence-backed `not_committed`/`committed_reload`/`unknown`. |
| Single and multi-role writers currently continue after successful bootstrap and collapse later failures using `bootstrapped` booleans. | `app/api/admin/roles/[id]/route.ts:179-217`, `281-289`; `app/utils/roleWriteOps.ts:282-351`; `app/api/admin/roles/publish/route.ts:119-166` | A maintenance commit must stop business processing and propagate a mandatory reload; unknown persistence must be typed and frozen by later clients. |
| Special roles take no weekend target lock; occupancy identifies specials by date plus shared normalized name. | `app/utils/roleWriteOps.ts:354-397`; `app/utils/serviceReadModel.ts:43-59` | Keep the no-weekend-lock invariant and add a separate global special identity mutex. |
| POST occupancy is preflight only, and PATCH checks destination occupancy only for moves. | `app/api/admin/roles/route.ts:130-150`; `app/api/admin/roles/[id]/route.ts:142-177` | Coordinate special create/identity changes and authoritatively check special occupancy on every PATCH, including roster-only saves. |
| Studio protection is code-owned and tests every type/capability; internal types are hidden/read-only but inspectable. | `app/utils/studioProtection.ts:26-56`, `117-194`; `app/utils/__tests__/studioProtection.test.ts:58-215`; `sanity/structure.ts:27-61` | Register the coordinator in schema, protection lists/fields/titles/panes, and exact policy tests. |

## Scope

### In scope

- Change admin member candidate GET to read `teamMembers` through `operationalClient`'s published perspective.
- On first-attempt roles POST and every roles PATCH, derive unique submitted assignees with `seatAssignees(request.seats)`, resolve them with `loadCanonicalMemberIds`, and return typed `integrity_conflict` with missing IDs and zero writes if any do not resolve.
- Perform submitted-assignee validation before special coordination, weekend bootstrap, transaction creation/commit, notification, or revalidation. Preserve exact receipt replay as a no-write path before first-attempt validation.
- After loading the immutable stored type on PATCH, reject a `special_role` request whose `service_name` normalizes empty before occupancy, coordinator, bootstrap, or business writes; an omitted client `_type` cannot bypass this stored-type-aware check.
- Preserve canonical existing assignments, complete full-array request semantics, duplicate/multiplicity behavior, and existing client-side candidate guidance. Do not enforce `memberType` eligibility on the server.
- Replace legacy bootstrap's boolean with evidence-backed `not_committed`, `committed_reload`, and `unknown` outcomes using a retained fresh claim nonce and canonical role/lock readback.
- Propagate `bootstrap_completed_reload` after any self/concurrent maintenance commit and a new typed `bootstrap_outcome_unknown` when persistence cannot be proved through every single- and multi-role protected writer; neither outcome may reach a business write.
- Add one deterministic global `specialIdentityCoordinator` document. First use creates version 1 with a fresh nonce; every later assertion uses its observed `_rev`, writes a fresh nonce, and advances version monotonically so it necessarily creates a new revision.
- Authoritatively load normalized target occupancy for every special PATCH, excluding the current role, and refuse canonical or raw-draft conflicts before business writes.
- Extend raw special occupancy evidence to project and normalize `service_name`, so only a raw draft occupying the requested normalized identity is a target collision; a differently named same-date draft is not falsely adopted or treated as that target. Raw overlays for the role being edited remain independently blocking by base ID.
- Assert the global coordinator in the same transaction as every special create and every special date/name identity change; on a coordination conflict, re-read receipt/occupancy/coordinator evidence and never blindly replay the business transaction.
- Add hidden/read-only schema and Studio protections, operational read/query registration, architecture/data-model/API documentation, and a short ADR recording why the global coordinator was chosen over per-special weekend locks.
- Use mocks/in-memory documents only; there is no production migration or implementation-time production write.

### Non-goals

- No server-side `memberType` eligibility enforcement, automatic assignment cleanup, canonical-roster migration, label cleanup, or change to full-array PATCH semantics.
- No grid read model/UI, create-one UI, save orchestration, swap UI, Tablero removal, solver/auto-fill, notification redesign, or client unknown-outcome reconciliation.
- No production Sanity migration/write, deployment, merge, push, or Studio-authored coordinator.
- No reuse or expansion of `roleTargetLock` for specials and no per-special lock documents.
- No automatic retry after bootstrap uncertainty or special coordination conflict.

### Preserved invariants

- Member IDs are canonical published `teamMembers` IDs; raw draft-only, deleted, missing, arbitrary, or `drafts.*` IDs never enter a role write.
- All five member-referencing paths are validated through the shared seat model and written with required `_key`s under current full-array semantics.
- Existing canonical assignments remain legal even when their current `memberType` would not make them a new UI candidate.
- Exact creation receipt replay remains idempotent and performs no write, notification, revalidation, bootstrap, coordinator assertion, or assignee re-resolution.
- Weekend services keep deterministic `roleTargetLock`; specials keep no weekend lock.
- Role/coordinator writes are revision-asserted; coordinator assertions always change nonce/version and therefore revision.
- Existing manager/content-editor and route-specific authorization remains unchanged and is checked before protected reads or writes.
- Notification `before` remains captured pre-commit, and integrity refusal/maintenance-only outcomes trigger no notification or cache revalidation.

## Affected boundaries

| Component, file, or system | Current responsibility | Planned responsibility |
|---|---|---|
| `app/api/admin/members/route.ts` | Admin member candidate reader through implicit-perspective client | Read the same projection/order through `operationalClient`. |
| `app/api/admin/roles/route.ts` | Receipt-idempotent role create with weekend lock and preflight occupancy | Preserve replay; validate first-attempt assignees; coordinate special creates in the business transaction. |
| `app/api/admin/roles/[id]/route.ts` | Role PATCH/DELETE with full-array edit and optional weekend bootstrap | Validate every PATCH assignee before writes; check every special PATCH occupancy; coordinate special identity changes; consume typed bootstrap outcomes. |
| `app/utils/roleWriteRequest.ts` | Normalize/parse seats and construct all-five-field documents/patches | Remain the unique seat traversal/write semantics; no member-type validation is added. |
| `app/utils/serviceReadQueries.ts` and `app/utils/roleWriteOps.ts` | Canonical/raw loaders, date-wide raw special IDs, occupancy, coordination, and boolean legacy bootstrap | Project normalized raw special identity, retain nonce/readback evidence, and expose three-way bootstrap plus global special coordinator loaders/plans. |
| `app/utils/serviceWriteTargets.ts` | Single-role coordination used by setlist/proposal writers | Propagate maintenance committed/unknown outcomes without allowing downstream business writes. |
| Role publish/unpublish, copy-instruments, and swap routes | Single/multi-role protected writes using bootstrap coordination | Map any bootstrap maintenance/uncertainty truthfully and stop before business writes. |
| `app/utils/serviceMutation.ts` | Shared typed service error model | Register `bootstrap_outcome_unknown` with conflict/unknown-safe client semantics. |
| New coordinator helper/query/schema | None | Own deterministic ID/type, nonce/version/revision assertion, canonical operational read, and hidden/read-only schema. |
| `sanity/schema.ts`, `app/utils/studioProtection.ts`, `sanity/structure.ts` | Register and govern internal operational types | Make coordinator hidden, read-only, uncreatable/unupdatable/undeletable by Studio, and inspectable in a titled read-only pane. |
| `app/utils/protectedReadAudit.ts` and focused policy tests | Audit protected runtime readers/writers | Register the new protected operational type/helper and prove no implicit/raw client path. |
| `docs/ARCHITECTURE.md`, `docs/DATA_MODEL.md`, `docs/API_REFERENCE.md`, new ADR and ADR index | Current writer/mutex contracts and rejected alternatives | Document the third coordinator, lazy creation, claims, failure semantics, and rejected per-special-lock design. |
| API/helper/Studio tests | Existing role writer and policy regression coverage | Add discriminatory candidate, assignee, bootstrap, concurrency, protection, and recovery coverage. |

## Ordered changes

### 1. Canonicalize the candidate and submitted-assignee boundary

- Purpose: make the selectable roster and accepted write refs agree on published canonical membership.
- Components: members route, roles POST/PATCH, shared seat helpers/loaders, and focused API tests.
- Change: swap member GET's reader to `operationalClient` without changing projection/order/auth. After exact receipt handling on POST—but before first-attempt occupancy/coordination/transaction—and after parsing every PATCH—but before coordinator/bootstrap/transaction—compute `wanted = seatAssignees(request.seats)`, resolve once with `loadCanonicalMemberIds`, and refuse the sorted missing set as typed `integrity_conflict` details. Once PATCH loads the immutable stored type, reject normalized-empty `service_name` for a stored special before any maintenance/business write. Keep all-five-field/full-array behavior and deliberately omit `memberType` checks.
- Failure and recovery behavior: missing IDs produce zero writes and no notification/revalidation; the administrator reloads canonical candidates and corrects the roster. Candidate read failure remains a normal failed read, not an inferred empty list. Existing exact receipt replay returns its prior result with no assignee lookup or state change.
- Verification: draft-overlay candidate exclusion, draft-only/deleted/arbitrary/`drafts.*` ID refusal in each of five fields, mixed duplicate IDs, validation-before-bootstrap/coordinator spies, replay no-call/no-write tests, normalized-empty stored-special name with omitted `_type`, unchanged authorization tests, and acceptance of a resolving canonical assignment whose `memberType` does not match the seat. Omitting any field, bypassing the stored-type/name check, moving validation after maintenance, weakening authorization, or adding member-type enforcement must make targeted tests red.
- State after this step: existing role POST/PATCH writers reject unresolved canonical refs before any write; no coordinator/schema change exists yet.

### 2. Make legacy bootstrap persistence truthful everywhere

- Purpose: prevent a lost maintenance response or later refusal from being classified as an ordinary no-write conflict.
- Components: `roleWriteOps.ts`, `serviceMutation.ts`, `serviceWriteTargets.ts`, roles PATCH/DELETE/publish/unpublish/copy/swap routes, and focused helper/route tests.
- Change: generate and retain the attempted lock's fresh nonce outside commit handling. Return exactly three maintenance outcomes. `not_committed` requires one conclusive observation: exactly one published-perspective canonical role, no raw overlay, role `_rev` exactly equal to the attempted pre-bootstrap revision, unchanged expected type/target/date, and no deterministic lock document. A valid lock owned by this role with this nonce proves this maintenance committed; a valid owned lock with a different nonce proves concurrent maintenance changed state; successful commit even with incomplete revision refresh is also committed. All committed/concurrent cases become `committed_reload`. A missing lock with a moved role revision, or any failed/unreadable/malformed/wrong-owner/contradictory reconciliation, becomes `unknown` rather than a false no-write claim. Stop immediately: map committed state to `bootstrap_completed_reload`, unknown to registered `bootstrap_outcome_unknown`, and preserve cause, nonce-safe evidence, role/lock IDs/revisions, and underlying refusal details. No protected writer may continue to a business transaction after either result.
- Failure and recovery behavior: `not_committed` preserves the underlying pre-business conflict and may be retried only after normal reload; `committed_reload` requires canonical readback and explicit reviewed retry from new revisions; `unknown` freezes the logical operation for read-only reconciliation and forbids automatic retry. In multi-role flows, any earlier maintenance outcome governs the whole operation and later validation cannot downgrade it.
- Verification: successful commit/readback, successful commit/readback failure, lost/rejected response with exact nonce, different valid nonce, coherently absent lock plus exact attempted role revision/target, absent lock with moved revision classified unknown, malformed/wrong-owner/contradictory/read failure, first/later role propagation, and post-bootstrap business-conflict tests. Boolean-collapse, skipped revision equality, regenerated-nonce, ordinary-stale mapping, or continue-after-maintenance mutants must fail.
- State after this step: all current protected writers expose truthful maintenance outcomes and no longer combine bootstrap maintenance with a business write in one request.

### 3. Add the governed global special identity coordinator

- Purpose: provide a real shared mutex for special create and date/name identity changes without violating the no-weekend-lock invariant.
- Components: new `app/utils/specialIdentityCoordinator.ts`, bound operational query/loader, new schema, schema registry, protected-read audit, Studio policy/structure, and pure/policy tests.
- Change: define one code-owned deterministic document ID/type. A missing coordinator plan creates a hidden/read-only document with `{version:1,claimNonce:fresh,updatedAt}`. An existing valid document plan patches under `ifRevisionId(observedRev)` with `{version:observedVersion+1,claimNonce:fresh,updatedAt}`. Reject malformed/non-monotonic state as `integrity_conflict`; never repair it implicitly. Add every field to internal-field protection, every required type/title/list/pane registration, and exact create/update/delete/action/structure tests.
- Failure and recovery behavior: transaction conflicts are expected serialization; callers re-read occupancy/coordinator evidence and return a typed reload/conflict result rather than blindly retrying. A malformed coordinator blocks special identity writes but not unrelated weekend writes. The lazily created document may remain inert after code rollback.
- Verification: deterministic ID, valid first create, sequential nonce/version/revision advancement, two concurrent same-revision assertions with one winner, malformed-state refusal, explicit operational-client query test, protected-read audit, hidden/read-only schema assertions, full Studio capability/action/template/structure policy tests, and no remote-client integration. No-op nonce/version or omitted protection registration mutants must fail.
- State after this step: a tested, Studio-governed special mutex exists in code/schema; no route uses it and no remote document has been created.

### 4. Coordinate special create and identity-changing PATCH transactions

- Purpose: prevent two distinct requests from concurrently creating/renaming into the same normalized special identity.
- Components: roles POST/PATCH, occupancy/coordinator helpers, route transaction mocks, and route tests.
- Change: extend raw special-date queries/occupancy rows with `service_name` and compare it through the shared normalizer. After assignee/dependency/preflight validation, load authoritative normalized special occupancy and coordinator state. Every special create transaction includes the planned coordinator create/revision patch plus receipt and role create. Every special PATCH first checks occupancy for requested `{date,normalizeServiceName(service_name)}` excluding itself; a date/name identity change includes the coordinator assertion in the same transaction as the role patch. On Sanity conflict, POST first rechecks its deterministic receipt, then occupancy/coordinator; PATCH rechecks occupancy/coordinator. Return replay, normalized collision/integrity, or typed stale/unknown-safe conflict based on evidence, never an automatic business retry.
- Failure and recovery behavior: only one concurrent create/rename target claimant commits. A lost or 5xx route response remains potentially committed for later P3–P5 client protocols; backend readback does not claim no-write unless evidence proves it. Roster-only special PATCHes do not assert the mutex when identity is unchanged, but their mandatory authoritative occupancy check prevents knowingly writing either member of an existing normalized-identical collision.
- Verification: differently named same-date canonical and raw-draft specials; matching-name raw draft collision; raw base-ID overlay refusal; case/accent distinctions matching shared normalization; whitespace-normalized collisions; create/create, rename/rename, and create/rename concurrency with one winner; fresh nonce/version on sequential claims; receipt winner checked before target conflict; and every-special-PATCH occupancy bypass tests. Skipping raw label projection/filtering, coordinator assertion, or occupancy must make targeted route tests red.
- State after this step: current backend special identity writes are serialized and duplicate special observations are refused; no production migration/write has run.

### 5. Document the operational contract and complete gates

- Purpose: keep the non-obvious third coordinator and recovery procedures discoverable and prevent a plausible future "fix" that gives specials weekend locks.
- Components: `docs/ARCHITECTURE.md`, `docs/DATA_MODEL.md`, `docs/API_REFERENCE.md`, next numbered ADR from `docs/adr/TEMPLATE.md`, `docs/adr/README.md`, and final focused/full checks.
- Change: document canonical candidate/assignee validation order, bootstrap outcome/recovery semantics, deterministic lazy coordinator shape and claim transaction, every-special-PATCH occupancy, no migration, and operator inspection/protection. ADR records the accepted global coordinator and rejected per-special `roleTargetLock` alternative, including global contention and lazy-document tradeoffs.
- Failure and recovery behavior: documentation must not imply deployment, migration, or authorization to write production data. If tests reveal a schema/route contract mismatch, fix the contract before marking the child complete.
- Verification: documentation/source terminology search; ADR format/index check; focused API/helper/Studio tests; `npx tsc --noEmit`; `npm test`; `npx eslint .` with 0 errors.
- State after this step: backend hardening is safe to deploy independently but remains non-deployed absent explicit authorization; P3–P5 have stable writer/recovery contracts.

## Data and failure safety

- Identity and source of truth: `operationalClient` published `teamMembers` are canonical assignees. Weekend writes use role revision plus deterministic role target lock; special identity writes use role/receipt revision plus the deterministic global coordinator and authoritative normalized occupancy.
- Migration and compatibility: no production migration. The coordinator is lazily created by the first authorized runtime special create/identity change after deployment. Existing roles/assignments and full-array APIs remain compatible; malformed legacy state is refused rather than rewritten.
- Partial failure and retry behavior: unresolved submitted IDs are proven pre-write failures. Bootstrap `committed_reload` requires reload/review; bootstrap `unknown` permits reconciliation only. Special transaction conflict triggers receipt/occupancy/coordinator readback and a typed conflict, not blind retry. HTTP/post-commit uncertainty remains for downstream client plans to freeze/reconcile.
- Concurrency, conflicts, and idempotency: exact receipt replay remains no-write. Coordinator first-create serializes on deterministic ID; later claims serialize on `_rev` and must advance nonce/version. Business role/lock/coordinator changes remain in one revision-asserted transaction.
- Data preservation and rollback: no assignment is modified by candidate reads or maintenance-only refusal. POST/PATCH retain all-five-field/full-array semantics and do not reinterpret member eligibility. Code rollback is a branch revert; an already lazily created coordinator is inert and can remain for forward compatibility. Do not delete it as rollback. Any actual administrator content write after a later release uses Sanity revision history/existing recovery, outside this implementation plan.

## Verification

| Requirement | Test or check | Failure it detects |
|---|---|---|
| Candidate reads are canonical published perspective. | Members-route mock asserts `operationalClient`, same projection/order/auth, and no draft-overlay candidate. | Draft leakage or response-contract regression. |
| First POST/every PATCH resolve all five fields and stored special names before writes. | Per-field missing-ID tests; mixed duplicate IDs; normalized-empty stored-special name; transaction/bootstrap/coordinator/side-effect spies; traversal/ordering mutants. | Dangling refs, blank special identity, partial validation, maintenance before refusal, notifications/revalidation on no-write conflict. |
| Receipt replay remains no-write. | Exact replay test asserts no member lookup, occupancy, coordinator, transaction, notification, or revalidation. | Retired/idempotent request becoming dependent on current membership or writing again. |
| Existing assignment semantics are preserved. | Canonical resolving wrong-`memberType` fixture accepted; full-array/multiplicity/request tests remain green; enforcement mutant is red. | Accidental server eligibility policy or assignment cleanup. |
| Bootstrap outcomes are evidence-backed and propagated. | Exact/concurrent nonce, absent, malformed/contradictory/read-failure, successful-commit-refresh-failure, and first/later multi-role tests with route spies. | False no-write claim, boolean collapse, later downgrade, or business continuation. |
| Unknown maintenance is typed. | Shared error-model plus each protected-writer mapping test for `bootstrap_outcome_unknown`. | Client treating possible maintenance persistence as ordinary stale failure. |
| Coordinator is a real mutex. | First-create, sequential advancement, same-revision one-winner, create/create, rename/rename, create/rename tests and no-op assertion mutant. | Revision assertion that does not mutate, duplicate target commits, stale/no nonce/version. |
| Every special PATCH checks normalized canonical/raw occupancy. | Roster-only and identity-change duplicate fixtures, same/different-name raw drafts, base overlay, direct admission bypass, and removed projection/filter/check mutants. | Existing normalized-identical special being overwritten or a differently named same-date draft being misclassified. |
| Schema/Studio/docs govern the new type. | Hidden/read-only/internal field, exact capability/action/template/structure/title/pane, audit, docs, and ADR checks. | Alternate Studio write path, undiscoverable coordinator, or accidental lock reuse. |
| No production mutation/migration occurs during delivery. | Tests mock clients; scripts/global diff search show no migration/apply path; no remote commands. | Unauthorized production write. |
| Repository gates pass. | `npx tsc --noEmit`; focused tests; `npm test`; `npx eslint .` with 0 errors. | Type, behavioral, or lint regression. |

Each new pure-logic safety test records a temporary production mutant and its targeted red assertion before restored green evidence is accepted.

## Rollout, observability, and rollback

- Release sequence and gates: implement in order on the feature branch; run focused tests after each step and all three repository gates after docs. This plan grants no merge, push, deployment, or production-write authority. With separate release approval, P2 may deploy before grid UI because its API changes are backward-compatible; bounded default is to hold it non-deployed.
- Signals proving success: candidate-client assertion, zero-write missing-ID/replay spies, typed bootstrap outcome counts/details in route tests/logging, coordinator nonce/version/revision advancement, one-winner concurrency tests, authoritative occupancy refusals, Studio policy coverage, and green gates.
- Stop conditions: any draft candidate; any missing ID reaching bootstrap/coordinator/transaction; replay invoking a writer; any server member-type refusal; any boolean/ordinary-stale bootstrap ambiguity; two special claimants committing; malformed coordinator repair; production client mutation; or failing gate.
- Rollback or forward-recovery steps: before deployment, revert/fix the branch. After separately authorized deployment, revert code normally; leave a created coordinator document intact. For `bootstrap_completed_reload`, reload canonical role/lock evidence before explicit retry. For `bootstrap_outcome_unknown`, stop writes and inspect canonical role/lock plus retained nonce evidence; do not auto-retry. For special conflicts, inspect receipt, normalized occupancy, and coordinator version/revision before a fresh request.
- Restoration verification: rerun all zero-write spies and gates; after any separately authorized runtime rollback, verify weekend writers still use their locks, specials no longer invoke coordinator code, the inert coordinator is not exposed in editable Studio panes, and no assignment content was changed by maintenance-only requests.

## Decisions

| Decision | Choice | Why | Tradeoffs | Owner |
|---|---|---|---|---|
| Candidate perspective | `operationalClient` published perspective | Matches runtime canonical member resolution and excludes drafts explicitly. | Admin cannot assign an unpublished member draft, intentionally. | Parent plan / implementation owner |
| Submitted-assignee traversal | `seatAssignees` plus one `loadCanonicalMemberIds` call | Reuses all-five-field semantics and resolves unique IDs efficiently. | Does not provide per-seat eligibility diagnostics; that is not server policy here. | Implementation owner |
| Validation placement | First-attempt POST and every PATCH before all maintenance/business writes; replay first | Missing IDs are true zero-write failures while receipt replay remains immutable/idempotent. | Replay can return a role containing a member that was later deleted; integrity readers still surface that legacy state. | Parent plan / implementation owner |
| Server eligibility | No `memberType` enforcement | Preserves current canonical assignments and full-array edit behavior; UI guidance is not an accepted server migration policy. | A crafted request can assign a resolving member outside suggested seat type. | Parent plan / product owner |
| Bootstrap contract | `not_committed` / `committed_reload` / `unknown`, never boolean | Lost responses and concurrent bootstrap can persist maintenance. | More requests stop for reload/review instead of continuing immediately. | Parent plan / implementation owner |
| Special mutex | One deterministic global coordinator, separate from weekend locks | Create and rename need a shared target-independent serialization point; specials deliberately have no weekend lock. | All special identity changes contend globally. | Parent plan / architecture owner |
| Coordinator lifecycle | Lazy first-use creation; never implementation migration | Avoids unauthorized production mutation and remains transactionally safe. | First authorized claimant takes the create path; malformed manual documents fail closed. | Release owner |
| Deployability | Backward-compatible independent backend release, held by default | Hardens current writers without requiring partial UI release. | Holding postpones protection until explicit release authority. | Release owner |

## Assumptions

| Assumption | Impact if false | Validation point | Failure response |
|---|---|---|---|
| `loadCanonicalMemberIds` always runs through `operationalClient`'s published perspective. | ID resolution could admit drafts despite candidate hardening. | Bound-query/runner unit test and protected-read audit in Step 1. | Stop; bind the helper explicitly to the operational client before route use. |
| Existing exact receipt replay must not be invalidated by later member deletion. | Revalidation could change idempotency/tombstone semantics and possibly create writes. | Existing receipt decision tests plus no-call replay test. | Preserve replay; surface legacy dangling state through integrity readers, not create replay. |
| One global special mutex has acceptable contention at current operational volume. | Special identity writes could conflict more often than desired. | Observe typed coordination conflicts after a separately authorized release. | Keep correctness; propose a separately reviewed sharded design/ADR only with evidence. |
| Lazy coordinator creation is acceptable and requires no pre-deploy migration. | Release could require a pre-created document, which would need production-write authority. | Transaction tests and release review. | Hold deployment and request explicit migration planning/consent; do not create it during implementation. |
| Existing route logging/details can carry outcome evidence without a new secret or external service. | Recovery may lack useful operator evidence. | Focused route tests and docs review in Steps 2/5. | Add only non-sensitive structured details/logging in scope; document any remaining observability gap. |

## Open questions

| Question | Why it matters | Recommendation and why | Tradeoffs | Owner | Blocking? | Resolution point | Bounded default |
|---|---|---|---|---|---|---|---|
| Deploy P2 independently or with the first grid writer? | Independent deployment protects current APIs sooner; combined release reduces rollout events. | Treat it as independently deployable after gates because the request shapes remain compatible, but require separate release authority. | Earlier protection versus one more backend rollout. | Release owner | No | Release review | Hold non-deployed until explicit authorization. |
| Is global coordinator contention material in production? | Sustained conflicts could affect special create/rename UX. | Do not speculate or shard now; observe typed conflicts after authorized release because current special identity write volume is low and correctness dominates. | Global simplicity/correctness versus potential future throughput. | Operations/architecture owner | No | Post-release observation | Keep one global coordinator. |
| Should recovery evidence be logged in addition to typed response details? | A lost client response cannot preserve response details. | Use existing non-sensitive structured route logging if available; do not add an external system or secret in this child. | Better diagnosis versus extra logging surface. | Implementation owner | No | Step 2 | Typed details plus existing logger only. |

No unresolved question changes this child's architecture, safety, sequencing, or rollback path.

## Handoff

- Prerequisites supplied to later plans: none required by P2; a separately authorized release may deploy it independently
- Outputs promised to later plans: canonical published candidate contract; zero-write `integrity_conflict` assignee admission; unchanged receipt/full-array/no-member-type semantics; three-way bootstrap and mandatory reload/unknown response contracts; deterministic global coordinator plans/schema; authoritative special occupancy and create/rename transaction contracts; recovery details for P3–P5
- Adversarial review order: review the parent roadmap first, then P1 and this P2 separately in numbered/dependency order, one reviewer at a time; later children follow separately
- Implementation authorization: **not granted by this plan; implementation is not authorized**

## Terminal state

READY_FOR_ADVERSARIAL_REVIEW
