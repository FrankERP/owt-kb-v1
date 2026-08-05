# Implementation Plan: Save and reconcile month-grid edits

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

This phase delivers the complete explicit-save editor and its entry point. Swap remains assigned to its later child plan, and `SeatBoard` remains a fallback until P6 removes it.

## Status and contract

- Document status: Draft; review-ready; implementation is not authorized
- Accepted spec or requirement source: `2026-08-03-month-grid-editing.md`, especially R1, R2, R7–R11, R14 and shared decisions D4 and D6; parent delivery roadmap for the same initiative
- Primary outcome: Add **Editar mes** to Servicios and let an administrator manually edit stored service rosters, dates including guarded cross-month moves, and special names through one semantic explicit-save batch whose per-service results remain truthful under failure, response loss, concurrent overwrite, and source-to-destination month reconciliation.
- Preconditions: `2026-08-03-month-grid-editing-p1-grid-read-model.md`, `2026-08-03-month-grid-editing-p2-writer-hardening.md`, and `2026-08-03-month-grid-editing-p3-create-one.md` are complete and have passed their gates. P1 supplies role-ID columns, exact stored `writeLabel`s, and roles-GET/joined-integrity admission. P2 supplies hardened special collision/coordination and bootstrap outcomes and authoritative pre-write `seatAssignees` plus `loadCanonicalMemberIds` validation across all five submitted fields. P3 supplies create-one and admits a new service only after unpublished empty readback at a stored `_rev`.
- Safe ending state: **Editar mes** is an additive, safely deployable entry to the stored month editor and create-one flow. Existing card/add/edit `SeatBoard` paths remain available as fallback through P6; P4 does not remove or redirect them. Every uncertain or superseded service stays frozen with explicit recovery. No deployment, production Sanity write, merge, or push is authorized by this plan.

## Evidence and current behavior

| Evidence | Source | Planning implication |
|---|---|---|
| Servicios currently owns source loading, individual add/edit modal transport, month-generator visibility, and card workflows. | `app/components/admin/ServicesPanel.tsx:446-730` | Add one top-level month-editor entry without deleting or redirecting existing fallback actions in P4. |
| Roles GET returns role `_id`, `_rev`, immutable type, date/name, publication, and dereferenced occupants with stored `_key`s across all five seat fields. | `app/api/admin/roles/route.ts:41-76` | Reconciliation uses role ID plus P1's joined-integrity admission; raw PATCH arrays are never adopted. |
| The current PATCH parser accepts one revision, date/name, and all five request arrays; `buildRoleEditPatch` writes all five stored arrays with fresh item `_key`s. | `app/utils/roleWriteRequest.ts:111-171,304-336`; `app/api/admin/roles/[id]/route.ts:112-235` | Emit one complete production payload for each dirty column and preserve P2's authoritative server validation before `.set(...)`. |
| Existing PATCH commits before notifications, revalidation, and best-effort canonical readback; success can omit `_rev`. | `app/api/admin/roles/[id]/route.ts:281-340`; parent roadmap Evidence | A 2xx is known committed, but editability waits for roles-GET/joined-integrity readback. A 5xx or lost response may hide a commit and is unknown. |
| Assignment notification captures `before` pre-commit and runs only after a route write. | `app/api/admin/roles/[id]/route.ts:219-318`; `docs/NOTIFICATIONS.md` “Landmines” | Semantic no-op must produce zero PATCH, which also proves zero notification-helper opportunity. |
| Current seat row normalization canonicalizes known labels such as Bass/Console by case, while stored labels and the server's shared `normalizeLabel` preserve case and accents after whitespace/NFC normalization. | `app/components/admin/seatModel.ts`; `app/utils/normalizeLabel.ts`; `app/utils/roleWriteRequest.ts:111-125` | Consume P1's separate row identity/display label/exact `writeLabel`; never collapse stored `Bass`/`bass` or `Console`/`console` during serialization. |
| Revision guards and protected target coordination already make a byte-identical old-revision retry at-most-once at the business transaction. | `app/api/admin/roles/[id]/route.ts:120-218,233-289`; P2 contract | Freeze `{roleId,observedRev,exactPayload,intendedSnapshot}` and never automatically rebuild against a fresh revision. |
| Shipping `SeatBoard` accepts any valid date unless a capability-derived lock reason disables it; PATCH owns guarded move dependencies and destination occupancy for every changed date. | `app/components/admin/SeatBoard.tsx:495-503`; `app/api/admin/roles/[id]/route.ts:142-176`; `app/components/admin/ServicesPanel.tsx` date-lock derivation | Preserve cross-month move parity before P6 retires the legacy editor; do not turn the displayed month into an artificial server limitation. |

## Scope

### In scope

- One additive **Editar mes** Servicios entry that opens the displayed month's stored grid and includes P3 create-one.
- Existing-service headers with immutable type, any valid editable service date, explicit guarded cross-month move intent, and editable normalized-nonempty special name.
- Destination-month rule admission, confirmation, canonical readback, source-column removal, and an **Abrir mes destino** exit for cross-month moves.
- One pure editable semantic snapshot/comparator and pure explicit-save planner with a pre-confirmation category summary.
- Zero PATCH and zero notification-helper opportunity for a semantic no-op.
- One complete production serializer that selects solely by `columnId` and emits date/name plus all five arrays, preserving multiplicity and each exact stored `writeLabel` case/accent.
- Sequential displayed-order PATCH execution with per-service known-commit, typed-known-failure, maintenance-retry, unknown, not-sent, revision-reload, and superseded/conflicted outcomes.
- Exact-attempt freezing, roles-GET/joined-integrity-only reconciliation against frozen intent, safe old-revision retry, and explicit discard/reapply conflict controls.
- Exact production-path committed-document preservation tests, discriminating mutants, redacted structured outcome logs, focused tests, and all repository gates.

### Non-goals

- Team or individual-seat swap; its later child plan owns the existing swap-route integration.
- Removing `SeatBoard`, redirecting card Edit or Nuevo servicio actions, deleting legacy handlers/components, or changing the card quick actions; P6 owns retirement.
- Existing-service type conversion, deletion, copy-instruments, publish/unpublish, setlist, proposal, or service-card workflow changes.
- Solver or local auto-fill for create-one, per-pick autosave, background automatic retry, or a second batching/notification mechanism.
- Production data migration, production Sanity writes, deployment, merge, or push.

### Preserved invariants

- Stored role ID/`columnId`, never date, identifies a service; role-ID-distinct same-date services and differently named specials remain independent.
- Existing stored type is immutable and is loaded authoritatively by the server; P4 sends no conversion control or `_type` mutation.
- All five member-referencing fields are preserved: Lead, BGVs, Chorus, instruments/person, and foh_team/person. Every server write receives P2's authoritative canonical-member validation before business or maintenance write.
- A Saturday cannot hide/write nonempty Chorus; every edited role remains P1-approved and topology-valid.
- Sanity array-object writes carry `_key`; generated keys are incidental and excluded from semantic dirty comparison.
- Date handling remains `YYYY-MM-DD` in `America/Mexico_City`; no bare `new Date(iso)` is introduced.
- PATCH keeps its pre-commit notification `before` snapshot and canonical side-effect/revalidation path; the client does not call notification helpers.
- Source and rule readiness remain distinct. P1's exact joined-integrity contract and last-known-good rule admission govern every mutable path. A pending cross-month date uses the destination month's complete Sunday spine for date-sensitive rules and cannot save until that destination admission is ready.
- Client mutation handlers use try/catch/finally, check `res.ok`, reset loading state, and never close or claim success on failure or unknown outcome.
- Spanish UI, visible non-color status text, 44px controls, and the existing in-flow month workspace remain in force.

## Affected boundaries

| Component, file, or system | Current responsibility | Planned responsibility |
|---|---|---|
| `app/components/admin/ServicesPanel.tsx` | Load service/integrity sources and mount current card/modal/month surfaces. | Add **Editar mes**, pass the selected month and P1/P2 readiness, and keep all `SeatBoard` fallback mounts/actions through P6. |
| `app/components/admin/PlannerGrid.tsx` | Render controlled month-grid assignments and picker. | Render immutable type/editable headers, pending cross-month move context, dirty/frozen states, save summary/confirmation, per-service results, and explicit conflict/move exits. |
| `app/components/admin/MonthGenerator.tsx` | Own current grid cells, source config, create batch, and month navigation. | Own P4 baseline/current/frozen/remote state by role ID, destination-month rule admission, sequential save, source/destination readback reconciliation, and unrelated edits. |
| `app/components/admin/plannerModel.ts` and a narrowly scoped pure save module | Represent P1 columns/cells/rows and create translation. | Canonicalize editable semantics, compare multisets, plan dirty writes, and serialize every approved stored column completely by `columnId`. |
| P1 roles-GET/joined-integrity admission and translator | Admit coherent stored roles with exact labels/item keys/revisions. | Be the only readback adoption path for commit, uncertainty, discard, and reapply; preserve exact `writeLabel` and shared-date identity. |
| P2-hardened `PATCH /api/admin/roles/[id]`, `roleWriteRequest.ts`, and `roleWriteOps.ts` | Authoritatively validate all submitted assignees, enforce immutable type/collisions/coordination/revisions, and distinguish maintenance outcomes. | Remain the sole writer. P4 preserves complete five-field validation and consumes P2's typed outcomes without weakening or duplicating them. |
| `serviceMutationSideEffects.ts` and notification/outbox utilities | Run canonical post-commit assignment notices and cache revalidation. | Remain server-owned and unchanged except test spies; no-op client plans never reach them. |
| Focused component/pure/route tests | Pin current create/grid and protected-writer behavior. | Add semantic no-op, serializer, truthful batch, exact retry/readback conflict, fallback-entry, and committed-document preservation coverage. |
| Redacted structured logging helper/call sites | No month-grid batch outcome vocabulary exists yet. | Emit attempt/classification/reconciliation events containing attempt ID, role ID, ordinal, and outcome only—never member IDs, assignments, service names, payloads, or secrets. |

## Ordered changes

### 1. Add the additive month-editor entry and per-role state

- Purpose: Open the P1/P3 stored editor without removing the proven fallback.
- Components: `ServicesPanel.tsx`; `MonthGenerator.tsx`; interaction tests.
- Change: Add **Editar mes** beside current Servicios controls. Open the currently selected/navigated Mexico City month with P1 stored columns and P3 composer. Track each role as `{baselineSnapshot,currentSnapshot,observedRev,status,frozenAttempt?,remoteObservation?}` keyed by role ID. Baseline is immutable until matching commit readback. Dirty state is derived only from the P4 comparator.
- Failure and recovery behavior: Missing source/joined-integrity/rule readiness renders stored context read-only with retry details. Closing/reopening never marks dirty state clean or adopts a remote response. Existing add/edit `SeatBoard` actions remain available and unchanged.
- Verification: Interaction tests open the intended month, show role-ID-distinct same-date columns, enforce P1 readiness, include P3 create-one, and prove legacy card/add/edit actions still mount `SeatBoard`. A source check prevents P4 deletion/redirection of fallback paths.
- State after this step: The additive editor can load coherent roles but cannot write until later steps supply pure save planning and reconciliation.

### 2. Implement safe existing-service header edits and guarded cross-month move intent

- Purpose: Move the existing date/special-name operations into the grid without permitting type conversion, losing cross-month parity, or allowing an unadmitted destination.
- Components: `PlannerGrid.tsx`; pure header parser; P2-hardened PATCH route/contracts; focused UI/pure/route tests.
- Change: Show type as a badge only. Accept any valid `YYYY-MM-DD` date. An outside-displayed-month value remains a pending move attached to the source role-ID column rather than being re-keyed/repositioned by date; show **“Se moverá a …”**, load P1's admission for the destination `YYYY-MM`, evaluate date-sensitive rules with that destination date/spine, and require an explicit source/destination confirmation. Show name input only for stored `special_role`, use the shared normalizer, and reject normalized-empty input. Include date/name in current semantic state and complete PATCH payload. Preserve capability-derived date locks and P2's authoritative stored-type check, every-special-PATCH normalized collision inventory, shared special coordinator for identity changes, move dependencies/target occupancy, and mandatory post-bootstrap outcomes.
- Failure and recovery behavior: Invalid date/name, capability lock, missing destination-month admission, collision, dependency refusal, joined-integrity mismatch, or P2 writer refusal leaves the move/local intent visible and sends no later unsafe request. `bootstrap_completed_reload` stops the batch, re-fetches revision/maintenance metadata without replacing baseline/current semantics, and requires review plus explicit retry.
- Verification: Discriminating tests cover no type control/payload, valid same-month and cross-month dates, source-column identity retained while pending, explicit destination confirmation, destination-month Sunday spine/rule admission, capability-derived date lock, normalized-empty special name in UI/parser/stored-type server check, normalized rename collision, differently named same-date special, dependency/occupied destination move, every-special-PATCH collision check, and bootstrap maintenance-reload preserving cells. Displayed-spine reuse, premature source removal, date-rekey, and removed stored-type/name/collision mutants must turn targeted assertions red.
- State after this step: Header edits are representable and server-hardened but still issue no request without the explicit-save planner.

### 3. Define semantic snapshots, comparison, and save confirmation

- Purpose: Send writes only for meaningful editable changes and explain them before confirmation.
- Components: New narrowly scoped pure save module beside `plannerModel.ts`; `MonthGenerator.tsx`; `PlannerGrid.tsx`; unit/interaction tests.
- Change: Canonicalize date, normalized special display name, voice member IDs as multisets, and instrument/FOH `(normalizeLabel(writeLabel),memberId)` tuples as multisets. Preserve duplicate counts and case/accent distinctions. Exclude `_key`, row/array order, origin, override metadata, display-only labels, and transient UI state. Compare immutable baseline with current state and build a displayed-order save plan naming each service and changed categories. A cross-month entry includes source month, destination month/date, and destination-admission evidence in confirmation. Empty plans close no surface and perform zero fetch.
- Failure and recovery behavior: Any column lacking P1 approval, role ID, observed revision, exact labels, or valid topology is unplannable and remains read-only. The administrator can cancel confirmation without changing baseline/current state.
- Verification: Unit tests prove shuffled keys/rows/arrays are no-op; changed member/date/name and duplicate-count changes are dirty; Bass/bass and Console/console stay distinct; merely opening or saving an unchanged month performs zero PATCH. Mutate multiset counting, label case handling, or no-op filtering and record the targeted red assertion.
- State after this step: The editor can truthfully identify dirty services and summarize changes but has not yet serialized or sent writes.

### 4. Serialize one complete frozen attempt per dirty column

- Purpose: Prevent one-seat edits from erasing untouched arrays, custom seats, or same-date services.
- Components: Pure production serializer/save planner; P1 row metadata; `MonthGenerator.tsx`; unit and preservation tests.
- Change: Select cells only by `columnId`. Emit `{rev,date,service_name?}` plus complete `leads`, `bgvs`, `chorus`, `instruments`, and `foh` arrays for every dirty role. Loaded instrument/FOH rows serialize their exact stored `writeLabel` after only shared `normalizeLabel` whitespace/NFC handling; never substitute canonical display labels. Preserve multiple occupants and duplicate tuple counts. Freeze `{roleId,observedRev,exactPayload,intendedSnapshot}` before the first request; retries reuse bytes and old revision exactly.
- Failure and recovery behavior: Missing/ambiguous row metadata, duplicate row identity, hidden topology data, or inability to emit any complete field blocks the whole column before fetch. Never serialize only dirty rows or aggregate by date.
- Verification: Pure tests cover all five arrays, exact Bass/bass and Console/console write labels, multiple occupants, duplicate counts, date/name, and role-ID-distinct shared-date decoys. Dirty-row-only, date-key, and label-collapse mutants must make targeted exact-body assertions red.
- State after this step: Every planned role has one complete immutable attempt suitable for P2's authoritative server validation.

### 5. Execute sequentially with truthful outcomes and redacted logs

- Purpose: Make partial month saves understandable and stop safely when commit outcome is uncertain.
- Components: `MonthGenerator.tsx` executor; mutation response classifier; injectable structured logging helper; interaction/unit tests.
- Change: PATCH in displayed order. Treat every 2xx as known committed, even with malformed body or missing `_rev`, then freeze that column awaiting roles-GET/joined-integrity readback. Continue after only P2-allowlisted typed failures proven to occur before business or maintenance writes. Treat `bootstrap_completed_reload` as maintenance committed/review retry and stop. Treat 5xx, malformed/untyped non-2xx, unexpected status, thrown/lost response, and P2 `bootstrap_outcome_unknown` as unknown; freeze that attempt, mark later roles not sent, and stop. Keep known-failed and unsent local edits. Emit redacted JSON events for attempt, response classification, and later reconciliation with only event/attempt ID, role ID, ordinal, and outcome.
- Failure and recovery behavior: Known commits stay noneditable until readback. A known failure leaves that role dirty and may allow the next sequential request. Maintenance/unknown stops all later sends. Logging failure never changes mutation classification and logging never includes assignments, member IDs, labels, names, exact payload, cookies, or secrets.
- Verification: Tests cover one dirty/one PATCH; typed pre-write 409 continuation; mixed committed/typed-failed; mixed committed/lost-response unknown/not-sent; 2xx malformed/no `_rev`; post-commit 500; and unrelated unsaved-column preservation. Logger tests assert event vocabulary/redaction and that throwing logger calls cannot alter executor state.
- State after this step: Each sent/unsent role has a truthful visible and logged result, but no known/unknown commit becomes clean before canonical reconciliation.

### 6. Reconcile only against frozen intent and expose explicit exits

- Purpose: Distinguish this operation's current commit from a later administrator overwrite without destructive merging or automatic retry.
- Components: P1 roles-GET/joined-integrity canonicalizer; P4 state reducer; `PlannerGrid.tsx` recovery controls; focused reconciliation tests.
- Change: Ignore raw PATCH arrays/revision for adoption. Fetch roles GET plus joined-integrity evidence, match by role ID even when its date left the displayed month, canonicalize through the same semantic snapshot, and compare with frozen `intendedSnapshot`. Equality adopts canonical item keys/revision and becomes clean. For a matching cross-month move, only then remove the role from the source-month grid and offer **“Abrir mes destino”** focused by role ID; destination reload must independently admit that canonical role. Valid different readback becomes **committed then superseded/conflicted**, retaining frozen intent and latest remote observation separately in the source workspace. Failed/incoherent readback remains frozen. For unknown, allow byte-identical retry at the exact old revision; if it commits, reconcile normally, and if it returns `stale_revision`, read back: equality proves prior commit, while difference remains unknown/conflicted. Never automatically retry from a new revision.
- Failure and recovery behavior: Provide two explicit controls only when the latest observation is P1 joined-integrity-approved: **“Descartar intención y recargar estado remoto”** abandons retained intent and adopts that approved observation, moving/removing the source column only if that remote date is outside the month; **“Reaplicar sobre el estado actual”** first shows a fresh semantic diff between retained intent and remote, then creates a new-revision attempt only after fresh confirmation and destination-month admission. Passive reload, failed/incoherent readback, or merely selecting reapply sends nothing. Preserve all unrelated columns and their unsaved states.
- Verification: Tests simulate known 2xx then concurrent overwrite before readback and require superseded/conflicted with both snapshots retained and zero automatic requests. Cross-month tests require role-ID readback outside the displayed filter, no source removal before exact intent equality, exact removal after equality, destination open/focus plus independent admission, and failed/ambiguous destination reload remaining safe. Test exact old-revision retry at-most-once, stale/equal reconciliation, stale/different conflict, known commit/readback failure, no-`_rev` response, broad refresh isolation, discard adopting only approved remote, and reapply requiring fresh diff/confirmation. Deleting intended-vs-readback comparison, removing the source early, or automatically adopting latest remote must make targeted assertions red.
- State after this step: Matching commits are clean at canonical revisions; all other outcomes remain explicit, recoverable, and noneditable without human choice.

### 7. Prove exact production-path preservation and phase gates

- Purpose: Demonstrate that a small edit cannot destroy untouched production-shaped service data.
- Components: Production serializer; `parseEditRequest`; `buildRoleEditPatch`; route transaction fixture/harness; focused tests; repository gates.
- Change: Add one committed-document test through the exact path: roles GET plus integrity fixture → P1 joined-integrity admission → stored grid translation → one-seat edit → P4 exact payload → `parseEditRequest`/`buildRoleEditPatch` → application of the real complete `.set(...)` to the document. Fixture data populates all five member fields, custom case-colliding instrument labels `Bass`/`bass`, FOH labels `Console`/`console`, multiple occupants, duplicate counts, and role-ID-distinct shared-date weekend/special decoys. Assert only the intended person/role changes and every untouched member, count, exact label, date/name, and decoy document survives. Exercise P2 canonical-member validation on the complete submitted assignee set. Spy that no notification helper can run when no PATCH is emitted.
- Failure and recovery behavior: Any lost untouched field, collapsed label, wrong same-date document, bypassed assignee validation, no-op notification opportunity, absent mutant proof, or failed repository gate blocks rollout.
- Verification: Temporarily apply dirty-row serializer and label-collapse mutants and record the targeted red committed-document assertions. Run focused tests, then `npx tsc --noEmit`, `npm test`, and `npx eslint .` with zero errors.
- State after this step: P4 is an additive, safely deployable editor with `SeatBoard` fallback and no silent data-loss/retry path.

## Data and failure safety

- Identity and source of truth: Role ID/`columnId` identifies each stored service. Immutable loaded semantics are the baseline; the P1 joined-integrity-approved roles-GET observation is remote truth. A write becomes this operation's clean baseline only when its canonical semantics equal frozen intent.
- Migration and compatibility: No content migration is required. P4 consumes P1/P2/P3 types and writers. Existing `SeatBoard`, card actions, receipts, locks, special coordinator, notification outbox, and cache invalidation remain compatible and available.
- Partial failure and retry behavior: Sequential execution continues only after known pre-write failure or known commit; maintenance/unknown stops later requests. Each known commit waits for readback. Unknown and later not-sent roles retain local state and exact attempts. No broad refresh replaces failed, frozen, conflicted, or unsent cells.
- Concurrency, conflicts, and idempotency: Revision guards make exact old-revision retry at-most-once; stale retry triggers read-only reconciliation. Frozen intent is compared to readback before clean adoption. Superseded remote state is retained separately. Fresh-revision reapply requires a new diff and confirmation; it is never automatic.
- Data preservation and rollback: The sole serializer always emits all five arrays by `columnId`, preserves multiplicity and exact stored write labels, and passes P2's server canonical-member validation. Code rollback restores the additive entry/fallback state; deliberate post-release content edits require ordinary Sanity revision-history restoration, not blind inverse PATCH.

## Verification

| Requirement | Test or check | Failure it detects |
|---|---|---|
| Additive **Editar mes** with fallback | Servicios interaction test and production-source search | Missing entry or premature `SeatBoard` retirement/redirection |
| Immutable type and guarded date/special name | UI, parser, destination-admission, capability-lock, and P2 route tests | Type conversion, removed cross-month parity, unadmitted move, empty name, collision, or bypass |
| Cross-month source/destination reconciliation | Pending source-column test plus outside-month role-ID readback, exact-intent removal, destination open/focus/admission tests and premature-removal mutant | Lost/falsely clean move, wrong-month rules, date-rekey, or disappearing frozen intent |
| Semantic no-op | Comparator unit tests, zero-fetch interaction, notification-helper spy | False PATCH and false team notification |
| Complete exact serializer | Exact-body tests across five fields, case-colliding labels, multiplicity, and shared-date columns | Dirty-row write, label collapse, count loss, or date cross-wire |
| P2 assignee validation preserved | Route/production-path test using complete `seatAssignees` resolution | Dangling or nonexistent assignee written from one of five fields |
| Truthful sequential batch | Mixed outcome executor tests | Continuing after unknown, false failure, erased unsent edit, or wrong summary |
| Exact-attempt retry | Byte-identical old-revision retry and stale/readback tests | Double commit or automatic new-revision retry |
| Frozen-intent reconciliation | Concurrent-overwrite and intended-vs-readback mutant test | Adopting another administrator's overwrite as this save's success |
| Concrete conflict exits | Approved-remote discard and fresh-diff/reconfirm reapply tests | Silent intent loss or unconfirmed new-revision write |
| End-to-end document preservation | Exact production-path committed-document test plus dirty-row/label mutants | Untouched field, member, label, count, identity, or decoy destruction |
| Redacted observability | Structured log schema/redaction/nonthrowing tests | Missing outcome evidence or leakage of roster/payload data |
| Repository quality gate | `npx tsc --noEmit`; `npm test`; `npx eslint .` | Type, behavior, or lint regression |

## Rollout, observability, and rollback

- Release sequence and gates: Implement only after P1–P3 approval and explicit implementation authorization. Complete focused mutant-backed tests and all three repository gates. Release P4 only as an additive **Editar mes** path with existing `SeatBoard` fallback; do not remove/redirect fallback before P6. No Vercel command is authorized here.
- Signals proving success: Per-service UI ledger and redacted logs distinguish planned/sent/known-failed/committed/reload/maintenance/unknown/not-sent/superseded/reconciled outcomes by attempt and role. Cross-month evidence shows destination admission, source retention through uncertainty, exact-intent removal, and focused destination reload. Request-count tests prove semantic no-op emits nothing. Preservation tests prove complete five-field writes and P2 assignee validation.
- Stop conditions: Any unknown that permits later sends or new-revision retry, commit adopted without matching roles-GET/joined-integrity intent, cross-month move without destination admission, premature source-column removal, untouched-data/label loss, server validation bypass, notification on no-op, fallback removal, sensitive log field, missing mutant red result, or failed gate.
- Rollback or forward-recovery steps: Disable/revert the additive **Editar mes** entry first while leaving `SeatBoard` available. Revert P4 code normally. For frozen attempts, complete exact old-revision readback/reconciliation before any content action. For deliberate committed content that must be undone, inspect Sanity document revision history and restore the approved revision; do not synthesize an inverse month batch.
- Restoration verification: Confirm Servicios fallback edit/create still works, no P4 entry remains after rollback, frozen attempts were not automatically resent, restored documents retain all five fields/labels/publication/date/name, notification outbox has no no-op event, and all repository gates pass.

## Decisions

| Decision | Choice | Why | Tradeoffs | Owner |
|---|---|---|---|---|
| Save trigger | One explicit reviewed month save | Prevents per-pick writes and lets the administrator see affected services. | More local dirty state must be retained. | Accepted parent R2 |
| No-op behavior | Zero PATCH and zero notification opportunity | PATCH itself can queue notices after commit. | Client comparator is a safety-critical production predicate. | Accepted parent R9 |
| Serializer | One complete five-array serializer by `columnId` | Full `.set(...)` can erase omitted fields; dates are not unique identity. | Every small edit sends the complete editable roster meaning. | Accepted parent/P4 contract |
| Stored labels | Preserve exact P1 `writeLabel` case/accent and multiplicity | Case-colliding custom seats are valid stored data and must round-trip. | Display canonicalization cannot substitute for write metadata. | P4 contract |
| Batch execution | Sequential displayed order with conservative classifier | Makes partial outcomes attributable and stops after uncertainty. | Slower than parallel PATCHes. | Accepted parent R9 |
| Clean adoption | Roles-GET/joined-integrity readback must equal frozen intent | Latest remote may be a concurrent overwrite, not this save. | A known commit may remain conflicted/frozen. | Accepted parent R9/D6 |
| Retry | Exact old revision only; fresh revision requires diff/reconfirmation | Avoids double commit and lost-update retry. | Recovery requires explicit human review. | Accepted parent R9/D6 |
| Entry rollout | Add **Editar mes** while retaining `SeatBoard` through P6 | Provides a rollback/fallback path during phased delivery. | Two edit surfaces temporarily coexist. | Parent roadmap |
| Cross-month moves | Keep pending intent on the source role-ID column; remove only after exact matching readback, then offer focused destination month | Preserves shipping date-edit parity without confusing date with identity or hiding uncertain outcomes. | Requires destination-month rule admission and explicit transfer UX. | Parent R2/D9 and P4 |
| Logs | Redacted structured attempt/classification/reconciliation events | High-risk partial writes need evidence without exposing roster data. | Adds a small logging contract and tests. | P4 operational contract |

## Assumptions

| Assumption | Impact if false | Validation point | Failure response |
|---|---|---|---|
| P1 exposes stable role-ID columns, distinct exact `writeLabel` metadata for case-colliding custom rows, and month-parameterized R11 admission/Sunday spines. | Complete serializer could collapse labels/cross-wire roles, or a move could evaluate the wrong month's rules. | P1 types, Bass/bass and Console/console fixtures, and different displayed/destination-month spine tests before P4 implementation. | Stop; revise/re-review P1 before implementing P4. |
| P2's future PATCH contract performs `seatAssignees` plus `loadCanonicalMemberIds` validation on all five submitted arrays before any business/maintenance write. | P4 could write dangling member refs. | P2 route types/tests before wiring the serializer. | Stop; complete and re-review P2. Do not claim current PATCH already has this behavior. |
| P2 distinguishes pre-write typed failures, `bootstrap_completed_reload`, and `bootstrap_outcome_unknown`. | Classifier could continue after hidden maintenance/commit. | P2 exported error model and route mutation-order tests. | Treat any unrecognized response as unknown and stop; revise P2 if required. |
| P3 supplies only joined-integrity-approved unpublished empty stored columns at a committed revision. | Newly created revisionless service could enter the save plan. | P3 handoff fixture and P4 admission test. | Keep create result frozen; do not serialize it. |
| Existing card/add/edit paths can coexist with **Editar mes** until P6. | P4 safe rollback/fallback boundary would fail. | Servicios interaction tests before release gate. | Block release or rescope sequencing with the parent roadmap. |

## Open questions

| Question | Why it matters | Recommendation and why | Tradeoffs | Owner | Blocking? | Resolution point | Bounded default |
|---|---|---|---|---|---|---|---|
| Exact visual placement of the additive **Editar mes** control | It must be discoverable without altering card workflows. | Place it with top-level Servicios actions and reuse existing button tokens. | Minor layout adjustment; no new navigation abstraction. | Implementer/product owner | No | P4 interaction review | Top-level Servicios action row. |
| Whether redacted browser logs have a durable consumer before final rollout | Current batch reconciliation is client-owned, while protected writer logs are server-owned. | Emit the defined nonthrowing structured events and treat the visible per-service ledger as the immediate operator record; do not add a new telemetry service in P4. | Browser events may not persist after close. | Operational owner | No | P4 rollout review | Visible ledger plus redacted existing-console events; no new external service/env var. |
| Exact Spanish category labels in the confirmation summary | Categories must be understandable but do not change save semantics. | Use Fecha, Nombre, Voces, Instrumentos, and FOH, with service date/name only in the UI—not structured logs. | Copy can be refined without changing comparator tests. | Product owner | No | P4 UI test review | Use the recommended labels. |

## Handoff

- Prerequisites supplied to later plans: P1 role-ID/read integrity, P2 writer hardening/assignee validation, and P3 safe create-one remain mandatory and unchanged.
- Outputs promised to later plans: An additive complete manual editor with guarded cross-month parity; globally explicit per-role clean/dirty/frozen/conflicted/move states; canonical revisions/item keys after matching readback; exact frozen attempts, source/destination reconciliation and recovery exits; `SeatBoard` still available for P6 retirement sequencing.
- Adversarial review order: Parent roadmap → P1 → P2 → P3 → this P4 → P5 → P6, strictly one fresh reviewer at a time. Invoke review only on explicit user request; material changes propagate and restart review from the earliest affected artifact.
- Implementation authorization: **not granted by this plan; implementation is not authorized**

## Terminal state

READY_FOR_ADVERSARIAL_REVIEW
