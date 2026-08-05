# Implementation Plan: Create one empty service in the month grid

## Original request

> "For editing the services, I want to see the 3 column grid layout we just built. So there should be an 'Edit month' button that opens this layout. This will replace individual edits for a more robust edit view."
>
> "I want to drop Tablero and make the grid the king of editing."
>
> "Let's leave the auto fill with solver for a single service for later. We just need to be able to create a single new service and fill it manually."

## Status and contract

- Document status: Draft; review-ready; implementation is not authorized
- Accepted spec or requirement source: `2026-08-03-month-grid-editing.md`, especially R3, R6, R8, R10, R14 and shared decision D6; parent delivery roadmap for the same initiative
- Primary outcome: Let an administrator compose and submit exactly one logical empty service from the stored-service month grid, then expose it for manual filling only after authoritative readback proves a safe stored revision.
- Preconditions: `2026-08-03-month-grid-editing-p1-grid-read-model.md` and `2026-08-03-month-grid-editing-p2-writer-hardening.md` are complete and have passed their gates. P1 supplies role-ID column identity and roles-GET/joined-integrity translation; P2 supplies authoritative weekend/special collision handling, the shared special-identity coordinator, conservative protected-writer outcomes, and pre-write assignee validation.
- Safe ending state: The create-one composer and tests exist on the feature branch but have no released Servicios entry point. Existing `SeatBoard` create/edit paths remain available and unchanged. No deployment, production Sanity write, merge, or push is authorized. P4 may expose this composer only after it also supplies safe manual PATCH/save reconciliation.

## Evidence and current behavior

| Evidence | Source | Planning implication |
|---|---|---|
| The current grid is a create-month surface and has no stored editable revision contract. | `app/components/admin/PlannerGrid.tsx`; `app/components/admin/MonthGenerator.tsx`; parent roadmap Evidence | Build create-one on P1's stored-role model; do not expose a revisionless local preview as an editable stored column. |
| Existing helpers mint one opaque logical-create ID and emit the complete POST body, including all five arrays and publication state. | `app/utils/monthDraftCreate.ts:45-72` | Reuse `newCreationRequestId` and `draftCreateBody`; do not invent a second create payload or idempotency scheme. |
| Role POST uses deterministic `roleCreationReceipt` replay, rejects occupied targets, and coordinates weekend targets in the create transaction. | `app/api/admin/roles/route.ts:79-240`; `app/utils/roleCreationReceipt.ts`; `app/api/__tests__/roleWriteRoutes.test.ts` | Preserve receipt replay and let P2's hardened writer remain authoritative for collisions and special coordination. |
| Roles GET provides role ID/revision, publication, and dereferenced occupants across all five stored seat fields. | `app/api/admin/roles/route.ts:41-76` | Resolve every known or uncertain create through roles GET plus P1's joined-integrity admission, never from raw POST arrays. |
| A special name is normalized with shared utilities and must be nonempty; differently named same-date specials are legitimate. | `app/utils/normalizeLabel.ts`; `app/utils/roleCreationReceipt.ts`; `app/components/admin/__tests__/serviceCardModel.test.ts` | Use the shared normalizer, reject normalized-empty names, refuse normalized-identical collisions, and retain differently named same-date specials. |
| ADR-0010 prohibits pointing special-service automation at the weekend solver. | `docs/adr/0010-specials-fill-locally-not-in-the-solver.md` | This composer calls neither `/api/admin/solve` nor local fill; every new service starts with zero occupants. |

## Scope

### In scope

- One in-grid composer for date, type, and a required normalized-nonempty name for `special_role`.
- One logical POST per confirmed action with `published: false` and `leads`, `bgvs`, `chorus`, `instruments`, and `foh` all empty.
- Stable logical-create request IDs before submission, exact-payload/request-ID freezing after an unknown outcome, and exact receipt replay/readback recovery.
- P2-authoritative weekend and special collision behavior, including differently named same-date specials and normalized-identical special refusal.
- Known-commit and unknown-outcome readback through roles GET plus P1's joined-integrity observation before adding an editable stored column.
- Focused pure, route-integration, and interaction tests plus the repository completion gates.

### Non-goals

- Solver calls, local auto-fill, fairness-based filling, an Auto control, or any roster assignment during create.
- Existing-service PATCH/save, date/name edits, semantic diff, or conflict reconciliation; P4 owns those.
- Team/seat swap; a later plan owns swap.
- Type conversion, cross-month moves, delete, publish/unpublish, setlist, proposal, or copy-instruments changes.
- Adding the Servicios **Editar mes** entry point, retiring `SeatBoard`, deploying, or writing production data.

### Preserved invariants

- Stored column identity is role ID, not date; same-date weekend and special services never alias.
- Existing service type remains immutable. The type control exists only in the empty-service composer.
- Dates remain `YYYY-MM-DD` and use the repository's Mexico City calendar handling.
- Member-facing reads continue to exclude `published == false`; this plan always creates an explicit draft.
- All five submitted assignment arrays are present and empty; no hidden/default occupant is inferred.
- P1's joined-integrity admission and P2's server collision, idempotency, authorization, and coordination checks are not weakened or reimplemented client-side.
- Client mutation handlers use try/catch/finally, check `res.ok`, reset pending state, and never close or claim safe success on failure or uncertainty.
- Spanish UI copy, 44px touch targets, and the existing in-flow grid layout remain in force.

## Affected boundaries

| Component, file, or system | Current responsibility | Planned responsibility |
|---|---|---|
| `app/components/admin/PlannerGrid.tsx` | Render controlled grid columns, cells, picker, and month-create controls. | Render a controlled create-one composer and frozen/recovery states; expose no fill automation. |
| `app/components/admin/MonthGenerator.tsx` | Own grid state and current month-create transport. | Own one logical create intent, request ID, exact POST body, outcome, and canonical readback without changing month-batch create semantics. |
| `app/components/admin/plannerModel.ts` or a narrowly scoped sibling pure module | Build grid create drafts and translations. | Validate/normalize composer intent and construct an empty `CreatableDraft` without occupants. |
| `app/utils/monthDraftCreate.ts` | Mint request IDs and serialize draft POST bodies. | Remain the sole request-ID/body helper; add only pure create-one outcome support if current types cannot express frozen states. |
| `POST /api/admin/roles` and P2 writer-hardening output | Create idempotent roles, coordinate targets, validate submitted assignees, and return typed outcomes. | Be consumed unchanged by the composer; every body explicitly requests an unpublished empty service. |
| `GET /api/admin/roles` plus P1 joined-integrity admission | Supply canonical stored role and integrity evidence. | Prove created identity, empty roster, `published === false`, and committed `_rev` before editability. |
| `app/utils/__tests__/monthDraftCreate.test.ts`, `app/components/admin/__tests__/MonthGenerator.create.test.tsx`, `app/components/admin/__tests__/PlannerGrid.test.tsx`, `app/api/__tests__/roleWriteRoutes.test.ts` | Pin create serialization, interaction, and route behavior. | Discriminate one-empty-create, collision, unknown freeze, replay, and safe readback behavior without remote writes. |

## Ordered changes

### 1. Model one empty create intent

- Purpose: Define one testable logical-create lifecycle before adding transport or UI.
- Components: `plannerModel.ts` or one narrowly scoped pure sibling; `monthDraftCreate.ts` only if its existing types need extension; focused unit tests.
- Change: Parse `{date,type,specialName?}` with shared date/name utilities. Require a normalized-nonempty special name. Construct one `CreatableDraft` with a fresh `newCreationRequestId()` and five empty arrays, and produce its body only through `draftCreateBody(draft, false)`. Before submission, any semantic date/type/name change replaces the request ID; incidental rerenders do not. Represent `editing`, `submitting`, `known_failed`, `known_committed_reload`, and `unknown_frozen` explicitly.
- Failure and recovery behavior: Invalid input performs no fetch and retains editable composer input. A typed known pre-write failure may return to editing; changing its logical body starts a new request ID. Unknown state retains the exact body and ID and permits no edit, discard, or new logical create.
- Verification: Pure tests assert one ID per stable logical body, changed body/new ID before submission, normalized-empty special refusal, all five arrays empty, and exact `published: false` serialization. Mutate one empty array or publication flag and record the targeted red assertion.
- State after this step: Pure create intent and lifecycle are safe but have no UI or transport.

### 2. Add the in-grid composer without fill automation

- Purpose: Let an administrator choose one target while making the zero-fill contract visible.
- Components: `PlannerGrid.tsx`; controlled state in `MonthGenerator.tsx`; interaction tests.
- Change: Add date/type controls and a conditional special-name field inside the existing in-flow workspace. The confirm action creates only the modeled empty intent. Disable confirmation when rule/source admission, input validation, or P2/P1 readiness fails. Render Spanish explanations for normalized-empty names, target collisions, submitting, committed-awaiting-readback, and unknown-frozen recovery. Do not render Auto, solve, or local-fill actions in this composer.
- Failure and recovery behavior: Disabled and pending paths have no keyboard/click escape. Closing the surrounding surface before submission may discard the local composer; after an unknown outcome neither close nor reset may mint another logical create.
- Verification: Interaction tests cover weekend duplicate, differently named same-date special eligibility, normalized-identical and normalized-empty special refusal, disabled mutation paths, one confirm/one POST intent, and attempted edit/new-ID/reset while unknown. A fetch spy proves `/api/admin/solve` and local fill are never called.
- State after this step: The controlled composer exists but remains unreachable from released Servicios navigation.

### 3. Submit through the idempotent protected writer

- Purpose: Preserve exact create identity across known, failed, and uncertain transport outcomes.
- Components: `MonthGenerator.tsx`; existing mutation-error parser; P2-hardened `POST /api/admin/roles`; route/client integration tests.
- Change: POST the exact frozen `draftCreateBody(..., false)`. Classify any 2xx as known committed even when the body lacks `_rev` or is malformed. Treat only P2-allowlisted typed responses proven pre-write as known failed. Treat 5xx, malformed/untyped non-2xx, unexpected status, thrown/lost response, and any P2 typed unknown as unknown. Unknown freezes the exact body/request ID and offers only exact replay and readback recovery.
- Failure and recovery behavior: Known failure leaves one editable composer and reports the typed cause. Known commit blocks the composer while canonical readback runs. Unknown never mints a replacement ID or retries with a changed body; exact replay lets `roleCreationReceipt` decide whether the first attempt committed.
- Verification: Tests cover explicit unpublished empty POST body, first-create success without `_rev`, lost-response receipt replay, post-commit 500, malformed/untyped rejection, and transport loss. Assert unknown disables composer changes/new create and replay is byte-for-byte identical.
- State after this step: Every submitted logical create has truthful identity and outcome, but no POST response can create an editable column directly.

### 4. Reconcile through authoritative readback

- Purpose: Admit only one coherent stored draft at a committed revision into manual editing.
- Components: P1 roles-GET/joined-integrity admission and translator; `MonthGenerator.tsx`; focused reconciliation tests.
- Change: Re-fetch roles and integrity evidence and resolve the frozen creation intent by receipt/result identity and target identity. Require one P1-approved role whose type/date/normalized special name match, whose five stored arrays are empty, whose publication is exactly `false`, and whose `_rev` is present. Only then translate and insert its role-ID stored column. A known commit lacking coherent readback stays frozen as **“Creado, falta recargar o revisar”**. For unknown, exact receipt replay or readback must prove the same full intent before resolution.
- Failure and recovery behavior: Missing/ambiguous identity, failed joined-integrity admission, nonempty roster, publication mismatch, target mismatch, or absent revision never becomes editable. Retain the frozen intent and permit read-only retry/reconciliation only. No revisionless column or unexpectedly published service is released to P4.
- Verification: Tests cover successful empty unpublished readback, publication mismatch, nonempty-array mismatch in each of the five fields, missing `_rev`, ambiguous/missing receipt identity, and unrelated same-date decoys. Deleting any match condition must make a targeted assertion red.
- State after this step: A coherently read-back service is a normal P1 stored column ready for P4 manual PATCH; unresolved creates remain safely frozen.

### 5. Verify the phase boundary and gates

- Purpose: Prove the phase is complete without accidentally releasing a create-only editor.
- Components: affected tests, source searches, repository gates.
- Change: Add a production-source assertion/search showing no new Servicios entry route exposes the composer and `SeatBoard` remains mounted. Record each required safety-test mutant and its targeted red assertion. Run the focused Vitest files, then `npx tsc --noEmit`, `npm test`, and `npx eslint .` with zero errors.
- Failure and recovery behavior: Any gate failure, reachable revisionless column, released entry point, solver/local-fill call, or missing mutant proof blocks handoff to P4.
- Verification: Focused interaction/source checks and all repository gates pass; tests and fixtures perform no production Sanity write.
- State after this step: P3 is a safe, intentionally unreleased branch state that supplies create-one to P4.

## Data and failure safety

- Identity and source of truth: The exact `creationRequestId` plus exact POST body identifies one logical create. The deterministic receipt is replay evidence; the canonical role ID/revision and P1 joined-integrity observation are the editable source of truth. Date is never stored-column identity.
- Migration and compatibility: No migration and no new remote document are introduced by P3. P2's coordinator/schema and existing receipts/locks remain authoritative. The existing month-batch create path and `SeatBoard` behavior stay compatible.
- Partial failure and retry behavior: There is only one create in flight. Known pre-write failure may be corrected as a new logical body/ID. Known commit waits for readback. Unknown freezes the exact body/ID, blocks new creates, and permits only exact receipt replay/readback.
- Concurrency, conflicts, and idempotency: P2 serializes weekend and normalized special targets; the receipt serializes the same request ID. Differently named same-date specials remain independent. Never automatically retry from a new ID after uncertainty.
- Data preservation and rollback: Create writes contain an empty roster and explicit draft state. Code rollback is a branch revert; it does not delete a role that a mocked/test flow represents. Production content rollback is irrelevant because this plan authorizes no production write.

## Verification

| Requirement | Test or check | Failure it detects |
|---|---|---|
| One empty unpublished service per action | Pure body test plus interaction request-count assertion | Duplicate create, hidden fill, missing array, or accidental publication |
| Stable ID and unknown freeze | Lifecycle unit test and byte-identical replay assertion | New logical create or changed payload after uncertain commit |
| Weekend/special collision correctness | P2 route integration plus composer interaction tests | Client-only authority, normalized duplicate, or same-date overblocking |
| No solver or local fill | Endpoint/function spies and production-source search | Regression against the scoped requirement and ADR-0010 |
| Receipt recovery | Lost-response replay test | Duplicate role after transport loss |
| No revisionless editable column | First-create/no-`_rev` and readback-failure tests | Editing from a stale or invented revision |
| Full readback intent match | Roles-GET/joined-integrity fixtures for identity, five empty fields, and publication | Adoption of wrong, populated, ambiguous, or published role |
| Safe unreleased boundary | Source/interaction check for absent entry and retained `SeatBoard` | Deploying a create-only incomplete editor |
| Repository quality gate | `npx tsc --noEmit`; `npm test`; `npx eslint .` | Type, behavior, or lint regression |

## Rollout, observability, and rollback

- Release sequence and gates: Implement only after P1/P2 approval and authorization. Keep P3 on the feature branch and undeployed. Run focused tests and all three repository gates. P4 must consume the stored-column output before any Servicios entry is enabled.
- Signals proving success: Tests show one exact empty unpublished request, no solve/fill calls, receipt replay recovery, frozen unknown state, and role-ID/revision admission only after matching roles-GET/joined-integrity readback.
- Stop conditions: Any production writer invocation, solver/fill call, collision admitted incorrectly, unknown state that permits a new ID, publication/roster mismatch, missing revision, released entry point, or failed gate.
- Rollback or forward-recovery steps: Revert only P3 branch changes. For an uncertain mocked/test outcome, retain the exact body/ID and complete replay/readback rather than resetting state. Do not delete or mutate remote roles.
- Restoration verification: Existing month-create tests and `SeatBoard` mounts remain green; source search confirms no P3 entry point; all gates pass after revert.

## Decisions

| Decision | Choice | Why | Tradeoffs | Owner |
|---|---|---|---|---|
| Create scope | One empty service per explicit action | Matches the user's reduced scope and yields a manually editable stored revision. | No bulk create or immediate staffed preview. | User/accepted parent requirement |
| Publication | Always send explicit `published: false` | Prevents member visibility and creation notices while the roster is empty. | Administrator publishes later from the card workflow. | Accepted parent R3 |
| Fill behavior | Zero fill; no solver and no local filler | Explicitly deferred by the user and consistent with ADR-0010. | Every seat is filled manually after readback. | User |
| Unknown recovery | Freeze exact body/ID; exact replay/readback only | Prevents duplicate logical creates after a lost response. | Composer is unavailable until uncertainty resolves. | Accepted parent R3/D6 |
| Edit admission | Require roles-GET/joined-integrity identity, empty roster, exact draft publication, and `_rev` | POST bodies/replies cannot prove a safe editable stored state. | Known commits can remain temporarily frozen. | Accepted parent R3/R7 |
| Release boundary | No Servicios entry until P4 | A create-only surface cannot safely fill/save the new service. | P3 is independently verifiable but intentionally unreleased. | Parent roadmap |

## Assumptions

| Assumption | Impact if false | Validation point | Failure response |
|---|---|---|---|
| P1 exposes a pure role-ID readback/joined-integrity translator with publication and all five fields. | P3 cannot prove safe edit admission. | Before P3 implementation begins and in reconciliation fixtures. | Stop; revise P1 and treat its review as stale before continuing. |
| P2 exposes create collision/coordinator and conservative outcome contracts without requiring a client roster. | Special races or unknown outcomes would be unsafe. | P2 API/types and route tests before wiring POST. | Stop P3; harden/re-review P2 rather than reimplementing it in the client. |
| Receipt replay returns enough immutable identity to correlate the logical create, while roles-GET/joined-integrity readback supplies final roster/revision truth. | Unknown recovery could select the wrong same-date role. | Lost-response replay and shared-date-decoy tests. | Keep frozen and require further discovery; never admit a target-only match. |
| The composer can remain unmounted from released Servicios navigation through P3. | The safe ending state would expose an unusable editor. | Phase-boundary source and interaction check. | Block release and remove/guard the entry before handoff. |

## Open questions

| Question | Why it matters | Recommendation and why | Tradeoffs | Owner | Blocking? | Resolution point | Bounded default |
|---|---|---|---|---|---|---|---|
| Exact Spanish wording for frozen create states | Copy must distinguish known commit awaiting readback from unknown outcome. | Use the parent phrase “Creado, falta recargar o revisar” for known commit and an explicit “Resultado desconocido; reintenta exactamente o recarga” for unknown. | Final wording may be shortened for layout, not semantics. | Implementer/product owner | No | P3 interaction-test review | Use the recommended semantic wording. |
| Whether reconciliation retries automatically on a short timer | It affects UX but not identity safety. | Do not poll in P3; provide an explicit retry/readback action to keep behavior deterministic and minimal. | Manual recovery takes one extra action. | Implementer | No | P3 implementation | One explicit retry action; no background polling. |

## Handoff

- Prerequisites supplied to later plans: P1's safe stored-column model and P2's hardened writer contracts must remain intact.
- Outputs promised to later plans: One role-ID stored column only after matching unpublished empty readback at a committed `_rev`; otherwise an exact frozen create attempt and truthful recovery state. No released navigation entry.
- Adversarial review order: Parent roadmap → P1 → P2 → this P3 → P4 → P5 → P6, strictly one fresh reviewer at a time. Invoke review only on explicit user request; material changes propagate and restart review from the earliest affected artifact.
- Implementation authorization: **not granted by this plan; implementation is not authorized**

## Terminal state

READY_FOR_ADVERSARIAL_REVIEW
