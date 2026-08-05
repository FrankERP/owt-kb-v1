# Artifact Roadmap: Month grid as the sole roster editing surface

## Original request

> “For editing the services, I want to see the 3 column grid layout we just built. So there should be an ‘Edit month’ button that opens this layout. This will replace individual edits for a more robust edit view.”
>
> “I want to drop Tablero and make the grid the king of editing.”
>
> “The grid should also have the functionality to swap teams or just certain roles from one service to another.”
>
> Later scoped down: “Let’s leave the auto fill with solver for a single service for later. We just need to be able to create a single new service and fill it manually.”

## Parent scope

- **Document status:** Draft delivery roadmap; requirements are accepted, implementation is not authorized.
- **Shared outcome:** An admin opens **Editar mes** from Servicios and uses the existing three-part planner layout—participation, date/seat grid, and ranked candidate picker—as the only free-form service-roster editor. The grid loads stored services, explicitly saves existing-service edits, creates one empty draft service at a time for manual filling, and performs atomic whole-team or individual-seat swaps. `SeatBoard`/Tablero is retired only after every replacement path is verified.
- **Current gap:** The planner grid creates date-keyed preview drafts; it does not carry stored role IDs/revisions/item keys or PATCH/reconciliation state. `SeatBoard` remains mounted for add/edit, and card-level swap owns the shipping client workflow.
- **Global requirements:** Preserve canonical source admission, all five seat fields, exact stored label identity and multiplicity, revision guards, idempotency receipts, truthful unknown/partial outcomes, pre-commit notification snapshots, cache revalidation, Spanish UI, Mexico City date semantics, shared-rule readiness, and existing guarded cross-month date-move capability.
- **Preserved invariants:** `saturdarSongs` remains unchanged; Sanity array items carry `_key`; member-facing reads keep `published != false`; `/api/cron/*` stays outside both synchronized route matchers; protected writers remain manager-gated and stored-state-derived; no semantic no-op emits PATCH or notification work.
- **Non-goals:** Single-service solver/local auto-fill; service type conversion; moving delete, copy-instruments, publish/unpublish, setlist, or proposal workflows off service cards; a second roles read endpoint; a roster payload for swap; production data migration.
- **Integration acceptance:** Every former roster add/edit/swap entry opens the correct month editor context; stored services sharing a date remain independent; one-seat edits preserve every untouched byte-semantic seat value; existing guarded cross-month moves remain available and reconcile from source to destination month without losing frozen intent; create-one is empty and unpublished; team/seat swaps reconcile atomically; no current production UI describes Tablero as shipping; all three repository gates pass after every child and at integration. Before cutover is release-ready, the complete surface also passes a non-production browser-preview check at mobile and desktop widths, with mutation calls intercepted or bound to an isolated non-production backend so verification cannot write production data.

## Evidence

| Fact | Source | Planning implication |
|---|---|---|
| The create grid keys cells/columns by date and deliberately drops duplicate dates. | `app/components/admin/plannerModel.ts:54-58,378-406`; `PlannerGrid.tsx:414-505` | Stored columns need opaque role-based identity before any edit path can be safe. |
| Roles GET already returns role identity/revision/publication and stored `_key`s across all five assignment fields, but resolved projections can omit dangling refs. | `app/api/admin/roles/route.ts:54-74` | Reuse this endpoint and join it to independent integrity evidence; never adopt mutation response arrays as a read model. |
| Role integrity reports canonical/public/draft/record/ref/lock state independently. | `app/api/admin/service-integrity/roles/route.ts:26-52`; `app/utils/serviceReadSummary.ts:58-124` | Only a revision-matching, assignment-set-equal pair may become an editable stored column. |
| Member candidates use an implicit raw-perspective client under the pinned pre-2025 API version. | `app/api/admin/members/route.ts:18-25`; `sanity/lib/serverClient.ts:4-11`; `sanity/lib/operationalClient.ts:7-23` | Candidate reads must use the explicit published perspective, and writers must independently resolve submitted refs before any write. |
| Client seat helpers case-fold known labels while server label identity preserves case and accents. | `app/components/admin/seatModel.ts:38-73`; `app/utils/normalizeLabel.ts:26-35`; `app/utils/serviceReadModel.ts:111-135` | Loaded stored row/write identity must not use display/new-seat canonicalization. |
| PATCH replaces all five assignment arrays and commits before fallible notification, revalidation, and readback work. | `app/utils/roleWriteRequest.ts:95-171,230-248`; `app/api/admin/roles/[id]/route.ts:219-347` | Header edits, complete serialization, semantic diffing, committed-document preservation, and reconciliation stay in one child. |
| Create is receipt-idempotent; special services have no weekend target lock. | `app/api/admin/roles/route.ts:79-258`; `app/utils/roleTargetLock.ts:27-44` | Create-one retains the exact request ID, while special identity changes require shared deterministic coordination. |
| Swap already accepts only IDs/revisions/item keys, derives writes from stored roles, and atomically asserts coordination tokens. | `app/api/admin/roles/swap/route.ts:43-239` | Reuse the route; add topology validation and grid-side clean-state/readback reconciliation, never a roster payload. |
| Saturday alone hides Coro, but whole-team swap exchanges all five arrays. | `app/components/admin/plannerModel.ts:280-305`; `app/api/admin/roles/swap/route.ts:154-168` | Team swaps are valid only when both roles are Saturday or both are non-Saturday. |
| `SeatBoard` still owns shipping add/edit mounts and card swap remains active. | `app/components/admin/ServicesPanel.tsx:1333-1365,1440-1457,1531-1620` | Cutover/removal is a final migration child, not early cleanup. |
| Hard rules are current-column scoped and need an honest config plus the full month Sunday spine. | `app/components/admin/ruleEnforcement.ts:283-305,382-407,473-485`; `MonthGenerator.tsx:1288-1351` | Stored-grid admission and every entry path must preserve rule readiness without date-wide cross-service conflicts. |

## Decomposition rationale

The former seven-task document crossed six semantic delivery boundaries. Splitting is required because the work spans distinct frontend read admission, server trust/data writers, create idempotency recovery, destructive full-array PATCH handling, multi-role swap recovery, and final UI migration boundaries. Each child below has its own acceptance contract, owner, verification, safe ending state, and rollback/recovery path.

- P1 couples create-grid regression pins to the identity refactor because the same pure model serves both create and stored modes. It also couples roles-GET/integrity joining to stored translation; either source alone can hide data.
- P2 groups canonical assignee validation, special identity coordination, and legacy-bootstrap truthfulness because all are pre-business-write server trust contracts used by later clients. It is independently deployable hardening with no production migration.
- P3 remains separate because receipt replay and an unknown first-create outcome have a different identity and recovery boundary from PATCH.
- P4 keeps header edits, full-array serialization, semantic no-op suppression, save batching, and committed-document reconciliation together. Splitting any of them would create a write-capable state without proof that untouched fields survive.
- P5 reuses an existing stored-state server route but needs its own multi-role intended-state and recovery contract.
- P6 owns the only-surface migration. `SeatBoard` remains available until all replacement capabilities pass; deletion is never a prerequisite for proving data safety.

## Child plans

| ID | Artifact type | Outcome and acceptance contract | Prerequisites | Outputs | Safe ending state | Rollback or recovery | Review order |
|---|---|---|---|---|---|---|---|
| P1 | [Implementation plan](2026-08-03-month-grid-editing-p1-grid-read-model.md) | Stable `columnId` grid model and integrity-admissible stored read translation that preserves exact stored labels/keys and create behavior. | None | Shared model, translator, fixtures, rule-readiness contract | Intentionally non-released; no stored mutation entry is exposed | Revert model-only changes; shipping `SeatBoard` remains | 1 |
| P2 | [Implementation plan](2026-08-03-month-grid-editing-p2-writer-hardening.md) | Canonical member candidate/write validation, truthful bootstrap outcomes, and coordinated special identity writers. | None | Protected writer contract used by P3–P5 | Deployable backend hardening or safely held on branch; no migration/write | Revert code; unused coordinator schema is inert | 2 |
| P3 | [Implementation plan](2026-08-03-month-grid-editing-p3-create-one.md) | Create one empty unpublished service manually with receipt-safe unknown recovery and canonical readback admission. | P1, P2 | In-grid composer and frozen create-attempt protocol | Intentionally non-released until P4 supplies the complete editor entry | Exact replay/readback; code revert creates no content changes | 3 |
| P4 | [Implementation plan](2026-08-03-month-grid-editing-p4-save-reconciliation.md) | Explicit existing-service edits, including guarded cross-month date moves, through complete five-array PATCH, semantic no-op silence, and truthful per-service reconciliation. | P1, P2; sequence after P3 | Safe **Editar mes** editing/save/move surface while legacy editor remains fallback | Deployable additive editor; `SeatBoard` is still available | Frozen-intent forward recovery; code revert plus Sanity history for real edits | 4 |
| P5 | [Implementation plan](2026-08-03-month-grid-editing-p5-stored-swap.md) | Topology-safe whole-team and stored-key seat swaps with all-role reconciliation. | P1, P2, P4 | Grid swap controls and protected route validation | Deployable additive grid swaps; card swap remains until P6 | Exact-request reconciliation; restore both coordinated role revisions if needed | 5 |
| P6 | [Implementation plan](2026-08-03-month-grid-editing-p6-seatboard-cutover.md) | Route every roster workflow to the month grid, remove card swap/manual `SeatBoard`, and update current-state contracts. | P3, P4, P5 | Sole manual roster surface and retired Tablero | Final releasable integration state after all gates | Pre-release revert restores legacy surface; post-edit content uses Sanity recovery | 6 |

## Requirement-to-plan coverage

| Requirement ID | Requirement | Primary owner plan | Dependent plans | Verification owner | Coverage note |
|---|---|---|---|---|---|
| R1 | **Editar mes** opens the existing three-part layout against stored services. | P4 | P1, P6 | P6 | P4 creates the additive entry; P6 verifies every migrated path. |
| R2 | Existing roster/date/special-name edits, including guarded moves to another month, use explicit save with immutable type. | P4 | P1, P2 | P4 | Header, assignment, source/destination-month rule context, and serializer meaning share one frozen-intent contract. |
| R3 | Create one logical empty unpublished service at a time and fill it manually. | P3 | P1, P2, P4 | P3 | Exact create body/readback proves empty and `published: false`. |
| R4 | Swap whole teams or individual stored seats atomically from the grid. | P5 | P1, P2, P4 | P5 | Team topology and seat item-key contracts are server-authoritative. |
| R5 | Make the grid the only free-form editor and retire SeatBoard/Tablero. | P6 | P3, P4, P5 | P6 | Removal follows interaction-complete replacement. |
| R6 | Defer single-service solver/local auto-fill. | P3 | P6 | P3 | Create-one tests spy on solver/local-fill boundaries. |
| R7 | Shared-date roles, hidden/dangling/draft data, item keys, and exact stored labels are preserved. | P1 | P4, P5 | P4 | P1 owns admission; P4 owns destructive round-trip proof. |
| R8 | Candidate and submitted assignee refs are canonical before any write. | P2 | P3, P4 | P2 | Client provenance is not trusted as writer validation. |
| R9 | Semantic no-ops emit no PATCH/notifications; partial/unknown/superseded outcomes are truthful. | P4 | P2 | P4 | Frozen exact payload and intended snapshot govern reconciliation. |
| R10 | Special identity races and legacy-lock lost outcomes serialize/reconcile safely. | P2 | P3, P4, P5 | P2 | Shared server foundation precedes all new clients. |
| R11 | Mutable roster paths always have honest rules and the full Sunday spine for the displayed month and any pending destination month. | P1 | P4, P6 | P6 | Initial failure is read-only; retained last-known-good is visibly stale; a cross-month move is disabled until destination-month admission is complete. |
| R12 | Delete/copy/publish/setlist/proposal remain card-owned protected workflows. | P6 | None | P6 | Only free-form roster edit and swap move to the grid. |
| R13 | TypeScript, Vitest, and ESLint gates pass per child; safety tests prove targeted mutant failures; the final browser-exercisable cutover passes a non-production browser-preview gate. | P6 | P1, P2, P3, P4, P5 | P6 | Every child owns local gates; P6 repeats integration gates and verifies normal plus redirected entry paths, responsive layout, keyboard/focus behavior, and rule-readiness in-browser without production writes. |
| R14 | Planning/implementation performs no production Sanity write, migration, deploy, merge, push, or PR. | P6 | P1, P2, P3, P4, P5 | P6 | Mocks/non-production fixtures only; later remote actions need separate authorization. |

## Sequence and safe states

| Transition | Entry criteria | Allowed release state | Exit criteria | Recovery if interrupted |
|---|---|---|---|---|
| Start → P1 | Parent requirements accepted | Branch-only, intentionally non-released model work | Create regressions and stored-read admission tests/gates pass | Revert P1; shipping UI is unchanged |
| Start/P1 → P2 | Parent requirements accepted; P1 may proceed independently | Backend hardening may deploy alone, but this roadmap grants no deploy authority | Writer, concurrency, Studio policy, docs, and gates pass | Revert P2 code; no production coordinator is pre-created |
| P1 + P2 → P3 | Both prerequisite outputs are byte-current | Branch-only composer; no former entry is rerouted | Empty unpublished create/replay/readback tests and gates pass | Retain/replay exact unknown attempt; revert UI code |
| P3 → P4 | P1/P2 contracts remain unchanged | Additive **Editar mes** may release only after P4 acceptance; `SeatBoard` remains fallback | Full production-path preservation, guarded cross-month move, no-op, partial/unknown, and gates pass | Freeze/reconcile writes and moves; revert code; recover content from prior Sanity revision |
| P4 → P5 | Grid state/reconciliation contract accepted | Additive grid swap; card swap remains | Topology matrix, all-role reconciliation, overwrite races, and gates pass | Reconcile exact request; restore both pre-swap revisions if necessary |
| P3 + P4 + P5 → P6 | All replacement interactions pass and no inherited contract changed | Final release candidate | Former entries, current-source cleanup, rule readiness, mutants, repository gates, and isolated non-production browser-preview verification pass | Revert cutover before release; after real edits use content recovery, not blind inverse writes |

## Shared decisions

| Decision | Choice | Why | Tradeoffs | Owner |
|---|---|---|---|---|
| D1 | Split into P1–P6 at semantic data/recovery/release boundaries. | Each child is independently testable with a safe state; trust-boundary work should not be hidden inside UI steps. | More artifacts and sequential review work. | Planning owner |
| D2 | Reuse roles GET plus integrity; add no second roster endpoint. | Together they expose dereferenced UI data and raw integrity evidence already owned by the system. | Independent reads require revision/set-equality joining. | P1 |
| D3 | Stored column identity is role ID; date remains calendar context only. | Multiple valid services may share a date. | Create-preview identity still needs its existing stable target key. | P1 |
| D4 | Stored label/write identity is exact server-normalized, case/accent preserving; display/new-seat canonicalization is separate. | `Bass`/`bass` and `Console`/`console` are structurally valid distinct stored values and cannot be collapsed during unrelated edits. | Legacy variants remain visibly distinct until deliberately edited. | P1/P4 |
| D5 | Resolve canonical member existence server-side but do not add server `memberType` eligibility enforcement. | Referential validity is a writer invariant; profile classification is not current role structural validity and can change after assignment. | UI eligibility remains a client workflow rule rather than an API authorization rule. | P2 |
| D6 | Keep create receipt recovery, PATCH reconciliation, and swap reconciliation separate. | Their identities and safe retry/forward-recovery paths differ materially. | Some shared client state helpers may be reused without merging contracts. | P3/P4/P5 |
| D7 | Team topology is compatible iff both roles are Saturday or both are non-Saturday. | Saturday hides/requires empty Coro; Sunday and special share the full visible topology. | Existing unsafe cross-class card attempts become typed refusals. | P5 |
| D8 | Retain card copy-instruments as an atomic protected quick action. | It is stored-state-derived, not free-form assignment editing. | The grid is sole manual editor, not the sole roster-mutating workflow. | P6 |
| D9 | Preserve guarded cross-month date moves in the grid before retiring `SeatBoard`. | The shipping editor accepts unrestricted valid dates and PATCH already owns dependency, destination-occupancy, revision, and coordination refusals. | A pending move needs destination-month rule admission and explicit source-to-destination reconciliation. | P1/P4/P6 |

## Shared assumptions

| Assumption | Impact if false | Validation | Failure response |
|---|---|---|---|
| Roles GET and integrity can be reloaded together for the displayed month. | Stored columns cannot be safely admitted or reconciled. | P1 source-status and join tests; P4/P5 readback tests. | Render context read-only with integrity retry; issue no mutation. |
| Exact server-normalized labels are sufficient stored seat identity within category/path. | Distinct slots could still collide or serialize ambiguously. | P1 fixtures include exact-equal multiplicity and case-colliding labels; P4 committed-document test. | Stop release and revise the row identity contract before P4 review. |
| Existing idempotency receipts and target occupancy remain authoritative across reload/browser changes. | Unknown create could duplicate or become unrecoverable. | P3 receipt replay plus target readback tests. | Freeze create and permit only exact replay/readback; no new logical create. |
| Sanity revision history is available for operator content restoration after a released edit/swap. | Code rollback alone cannot restore changed content. | Confirm recovery procedure before any later release authorization. | Stop release until a verified forward/content-recovery runbook exists. |

## Open questions

| Question | Why it matters | Recommendation and why | Tradeoffs | Owner | Blocking? | Resolution point | Bounded default |
|---|---|---|---|---|---|---|---|
| None. | Repository evidence resolves the product, identity, trust, sequencing, and recovery choices needed for planning. | Proceed to parent then child adversarial review only on explicit request. | Review may still discover defects; readiness is not approval. | User/review coordinator | No | Before implementation | Do not implement without the required approvals and later implementation authorization. |

## Review handoff

- **Parent review first, then child order:** parent → P1 → P2 → P3 → P4 → P5 → P6, strictly one fresh reviewer at a time under the repository-local `adversarial-plan-review` skill.
- **Evidence pointers:** this roadmap’s Evidence table plus each child’s bounded evidence table and repository paths.
- **Prior reviews, feedback, rebuttals, and planning dialogue excluded from cold-review payload:** yes.
- **Material child changes propagate to the parent and affected children and restart review from the earliest affected artifact:** yes.
- **Implementation authorization:** **not granted by this roadmap or its child plans.**
- **Remote-state authorization:** no production Sanity write, migration, deploy, merge, push, or PR is granted.

## Terminal state

READY_FOR_ADVERSARIAL_REVIEW
