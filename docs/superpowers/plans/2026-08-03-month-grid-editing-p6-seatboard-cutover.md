# Implementation Plan: Cut over every manual roster entry to the month grid

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
- Accepted spec or requirement source: `2026-08-03-month-grid-editing.md`, especially R1, R3, R5–R6, R11–R14 and D8.
- Primary outcome: Every shipping free-form roster create/edit/swap entry opens the correct **Editar mes** context, `SeatBoard`/Tablero and card swap are retired, and service cards retain their distinct protected workflows.
- Preconditions: P3 create-one, P4 existing-service edit/save, and P5 stored swap are accepted, byte-current, interaction-complete, and have each passed TypeScript, Vitest, and ESLint gates. P1/P2 inherited contracts remain unchanged.
- Safe ending state: One final release candidate exposes the three-part month grid as the sole manual roster editor, with honest rule readiness at every entry. Cutover is not releasable while any route, fallback removal, source cleanup, or full gate is incomplete; this plan grants no release action.

## Evidence and current behavior

| Evidence | Source | Planning implication |
|---|---|---|
| `ServicesPanel` mounts the generator as a full-width replacement but still models add/edit as `SeatBoard` modals. | `app/components/admin/ServicesPanel.tsx:393-431,1259-1300,1570-1591` | Reuse the P4 month-editor context and replace, rather than parallelize, add/edit handlers. |
| Top-level `Nuevo` opens the add modal; card Edit and `service_modal` primary actions open the edit modal. | `app/components/admin/ServicesPanel.tsx:1183-1193,1359-1366,1531-1541` | Redirect all three entry families to the correct month and composer/focused stable role column. |
| Card swap owns panel state, toggle/banner, confirmation, and card/chip branches. | `app/components/admin/ServicesPanel.tsx:436-440,732-829,1333-1343,1440-1457,1548-1551,1610-1620`; `ServiceReadinessCard.tsx:79-101,137-146,186-217,409-445` | Remove only this obsolete client workflow after P5 grid swap passes; preserve card copy-instruments and other workflows. |
| The two shipping add/edit mounts are the only production `SeatBoard` imports; `ParticipationRail` is imported by `SeatBoard`. | `app/components/admin/ServicesPanel.tsx:5-6,1570-1591`; `app/components/admin/SeatBoard.tsx:38,664-669` | Delete retired components/tests only after import searches prove no remaining consumer; `ParticipationRail` deletion is conditional. |
| `enforceableConfig` exists only to give Tablero a narrower rules contract. | `app/components/admin/solverConfigSource.ts:112-129`; `app/components/admin/__tests__/solverConfigSource.test.ts:113-128,205-230` | Remove it only after the last `SeatBoard` mount disappears; retain shared source-state parsing/controller behavior needed by the grid/rule panel. |
| Rendered copy and current docs explicitly describe Tablero/two-surface asymmetry. | `app/components/admin/MonthGenerator.tsx:838-904`; `docs/DATA_MODEL.md:295-300`; `docs/UTILITIES_AND_COMPONENTS.md:173-187`; `docs/adr/0010-specials-fill-locally-not-in-the-solver.md:19-57,96-148` | Rewrite current-state claims and append/update ADR later history without falsifying its original decision history. |
| Rules require an honest config and the displayed month’s full Sunday spine before any mutable grid path. | Parent roadmap R11 evidence: `app/components/admin/ruleEnforcement.ts:283-305,382-407,473-485`; `MonthGenerator.tsx:1288-1351` | Every former entry must funnel through one tested admission contract, not bypass it with handler-specific mutable state. |
| There is currently no `ServicesPanel` render harness; source-regex tests pin some wiring. | `app/components/admin/__tests__/solverConfigSource.test.ts:200-230` | Add interaction coverage for real former entries; source search alone is insufficient. |

## Scope

### In scope

- Retain/add **Editar mes** and route top-level `Nuevo`, direct card Edit, and every `primaryActionRoute(...) === "service_modal"` result to one month-editor opener.
- Open `Nuevo` directly on P3’s create-one composer; open card/primary edit in the role’s `YYYY-MM` month and focus its stable role-ID column.
- Remove card team/seat swap mode in favor of P5 grid swap.
- Remove only add/edit `SeatBoard` mounts and state/refs/handlers/components/tests that become obsolete solely because of the cutover.
- Remove `ParticipationRail` only if a post-cutover import search is empty; remove Tablero-only `enforceableConfig` only after its last consumer is gone.
- Rewrite rendered rules copy, source comments, current component/data docs, and ADR-0010 current-state/later-history claims.
- Add interaction tests for every former entry, guarded same-month/cross-month date editing, R11 rule readiness/full Sunday spines for displayed/destination months, retained card workflows, Spanish labels, 44px targets, and Mexico City date context.
- Add a final non-production browser-preview check for the integrated normal and redirected entry paths at mobile and desktop widths, with all mutation endpoints intercepted or bound to an isolated non-production backend.

### Non-goals

- Changing/deleting card-owned delete, atomic copy-instruments, publish/unpublish, setlist, or proposal workflows.
- Removing solver infrastructure, adding single-service solver/local auto-fill, changing service type, or changing P3–P5 mutation/recovery semantics, including P4's established guarded cross-month move contract.
- Deleting historical plans/review logs or rewriting ADR-0010’s historical context as though Tablero never existed.
- Production Sanity writes, migration, deployment, merge, push, PR, or direct stable-dev alias work.

### Preserved invariants

- Every mutable entry uses P1/P4’s rule admission: initial loading/error without retained config is read-only; confirmed absent uses established in-memory defaults; ready uses fetched shared config; retained last-known-good stays mutable during reload loading/error with a visible stale warning.
- Every mutable grid receives that exact config and the correct Mexico City calendar month’s complete Sunday spine, independently of loaded/selected services.
- Stored role focus uses role `_id`; role date determines month context and is rendered from `YYYY-MM-DD` at local noon, never `new Date(iso)`.
- Spanish UI and minimum 44px interactive targets remain. All P3–P5 client mutations retain truthful unknown/frozen outcomes and try/catch/finally behavior.
- Card workflows named above remain card-owned, manager-gated, revision-aware, notification-safe, and cache-revalidating.

## Affected boundaries

| Component, file, or system | Current responsibility | Planned responsibility |
|---|---|---|
| `app/components/admin/ServicesPanel.tsx` | Owns generator, `SeatBoard` add/edit modals, card swap, cards, and protected card workflows. | Own one month-editor context/opener and route every manual roster entry to composer/focused column; remove only obsolete modal/swap wiring. |
| P3/P4 month editor (`MonthGenerator`, `PlannerGrid`, bounded helpers) | Additive create/edit/save surface with rule admission. | Sole free-form roster/create/swap surface and destination for every former entry. |
| `app/components/admin/ServiceReadinessCard.tsx` | Renders Edit plus card team/seat swap branches and all retained actions. | Edit opens focused month grid; card swap props/branches disappear; retained actions stay unchanged. |
| `SeatBoard.tsx`, `ParticipationRail.tsx`, directly retired tests | Shipping legacy manual editor and its dialog-only participation gutter. | Delete `SeatBoard`; delete rail only after no-import proof; surgically remove only retired test cases. |
| `solverConfigSource.ts`, `useSolverConfig.ts`, `MonthGenerator.tsx` copy/comments/tests | Own shared source states plus Tablero-only enforcement/copy. | Keep source/controller/grid contracts, remove `enforceableConfig`, and describe sole-surface R11 behavior truthfully. |
| `CueDialog.tsx`, participation/grid comments/tests | Include current Tablero/rail geometry claims alongside live shared behavior. | Remove obsolete Tablero-only claims while preserving independently used dialog/grid/participation behavior and tests. |
| `docs/DATA_MODEL.md`, `docs/UTILITIES_AND_COMPONENTS.md`, ADR-0010 and other current docs found by search | Describe current components and two-surface rule behavior. | Describe sole month editor; retain historical records with a clear later-history cutover note. |
| Configured app browser-preview tooling | Verify browser-exercisable changes in an integrated non-production app. | Exercise normal and redirected grid entries, responsive layout, keyboard/focus, and rule-readiness with mutation interception or an explicitly isolated non-production backend. |

## Ordered changes

### 1. Centralize and test the month-editor destination contract

- Purpose: Ensure replacement behavior exists before deleting any fallback.
- Components: `ServicesPanel.tsx`, P3/P4 month-editor props/state, new focused interaction harness/tests.
- Change: Reuse one opener carrying displayed `YYYY-MM` plus either `{openComposer:true}` or `{focusRoleId}`. Retain/add **Editar mes** for normal month entry. Route top-level `Nuevo` to the same default/current displayed month and immediately open P3’s composer. Route direct card Edit and each `service_modal` primary kind (`resolve_conflict`, `edit_team`, `edit_service`) to `role.date.slice(0,7)` and focus `role._id`; date is calendar context, not identity. Preserve close/focus restoration and all R11 admission props.
- Failure and recovery behavior: If role/source/rule admission is incoherent, open the correct read-only month context with Spanish retry/integrity guidance; never fall back to a mutable legacy modal or expose a revisionless column. Missing focus role remains read-only/retry rather than focusing another same-date role.
- Verification: Real interaction tests trigger **Editar mes**, `Nuevo`, card Edit, and data-driven readiness cases for every `service_modal` result, asserting month/composer/focused role ID and focus restoration.
- State after this step: All replacement routes work while legacy mounts/card swap still exist; safe but explicitly non-deployable to avoid duplicate current surfaces.

### 2. Prove R11 and complete interaction behavior at every former entry

- Purpose: Prevent a handler-specific route from bypassing hard-rule readiness or using an incomplete week spine.
- Components: `ServicesPanel` interaction harness, P1/P4 admission helpers, directly relevant tests.
- Change: Run the same former-entry trigger matrix through initial loading, initial error, confirmed absent/default, ready/fetched, and retained last-known-good reload loading/error. Assert loading/error without retained config renders context but disables roster/date/name/create/swap keyboard and pointer paths; absent/default and ready are mutable; retained config stays mutable with a visible stale warning. For every mutable case, assert the exact admitted config and full Sunday list for the displayed Mexico City calendar month reaches `PlannerGrid`. For P4 cross-month move intent, repeat admission with the destination month, refuse save while that context is unready, and prove the source role-ID column remains present until exact matching canonical readback.
- Failure and recovery behavior: Retry never clears a retained config prematurely. Changing destination month rebuilds the complete Sunday spine. A failed config/Sunday admission cannot be bypassed by composer, focused-column, date-move, keyboard, or swap handlers; uncertain moves retain frozen source context.
- Verification: Interaction assertions plus hard-rule controls fail when config is omitted/substituted, displayed-month Sundays are reused for a destination month, or Sundays are derived from loaded/selected roles. Record targeted red assertions for those mutants.
- State after this step: Every former route is behaviorally safe; fallback still exists until retained workflow checks pass.

### 3. Remove card swap and only the obsolete SeatBoard path

- Purpose: Make the verified grid the sole manual editor without damaging distinct card capabilities.
- Components: `ServicesPanel.tsx`, `ServiceReadinessCard.tsx`, `SeatBoard.tsx`, `ParticipationRail.tsx`, `solverConfigSource.ts`, directly relevant tests.
- Change: Remove panel/card swap toggle, selection, confirmation, stale snapshot, props, chip branches, banners, and tests; P5 grid swap remains. Remove add/edit modal variants/mounts and only their now-unreferenced add/edit state, request refs, handlers, loading/error paths, imports, component, and retired-only tests. Keep delete modal/state/handler, copy-instruments mode, publish/unpublish, setlist, proposal, cards, participation sidebar, and integrity flows. Delete `enforceableConfig` after its final mount disappears. Run an import search; delete `ParticipationRail` only if no production import remains, otherwise retain it and update its ownership comments. In mixed test files such as participation coverage, delete retired-board cases but preserve grid/sidebar assertions and move shared constants to their live owner if needed.
- Failure and recovery behavior: This step is non-releasable unless every former route and retained workflow interaction test is green in the same byte state. No mutation endpoint or stored data changes.
- Verification: Import/mount searches show no `SeatBoard`, card-swap, or `enforceableConfig` production consumer. Interaction tests prove delete/copy/publish/unpublish/setlist/proposal still reach their original workflows and P5 swap remains reachable only in grid.
- State after this step: Sole manual surface exists in code; current-state copy/docs cleanup and full integration gates still block release.

### 4. Rewrite current-state copy, comments, docs, and ADR later history

- Purpose: Stop presenting a retired surface or obsolete two-surface rule asymmetry as current behavior.
- Components: `MonthGenerator.tsx` rendered rules copy, `useSolverConfig.ts`, `solverConfigSource.ts`, `CueDialog.tsx`, participation/grid source and tests, `docs/DATA_MODEL.md`, `docs/UTILITIES_AND_COMPONENTS.md`, ADR-0010, and any additional current source found by the production search.
- Change: Use Spanish copy that rules govern the sole month-aware editor, including month-aware week exclusions. Remove Tablero-only `enforceableConfig` explanations and obsolete rail/dialog geometry claims. Update component/data docs. Preserve ADR-0010’s original local-fill/shared-rules decision and historical alternatives, but add/update a dated later-history/current-state note: SeatBoard was subsequently retired, manual picks now use PlannerGrid only, every mutable entry has R11 config/full-Sunday admission, and single-service auto-fill remains deferred. Do not edit historical plans/review logs merely to erase history.
- Failure and recovery behavior: If a search hit cannot be classified as historical versus current, stop and resolve ownership before deletion/rewrite. Do not weaken independently valid solver/local-fill/fairness consequences.
- Verification: A documented current-source search over all `app` production files and current docs/ADR has no shipping claim that Tablero/SeatBoard/card swap/two manual surfaces exists; expected historical statements are explicitly allowlisted by path/context.
- State after this step: Production UI/source and current documentation consistently describe the sole month grid.

### 5. Run final integration, browser-preview, accessibility, and release-safety gates

- Purpose: Establish that the cutover is complete and reversible before any separately authorized release.
- Components: Focused interaction suite, configured app browser-preview tooling, global searches, repository gates, rollback/recovery checklist.
- Change: Exercise every former entry at mobile/desktop widths, keyboard paths, Spanish labels, focus return, and minimum 44px targets. Verify role-derived month/focus for shared-date services, same-month and cross-month date edits, destination-month admission, exact-readback source removal/destination focus, and local-noon date rendering. Repeat P3 create-one manual/no-solver, P4 preservation/no-op/unknown/move, and P5 all-role swap acceptance. Then launch the integrated app through the repository's configured browser-preview tooling—not the live deployed Playwright harness—and verify the normal **Editar mes** entry plus redirected create, edit (including a cross-month move), whole-team-swap, and seat-swap entries at mobile and desktop widths. In-browser verification covers the three-part responsive layout, keyboard traversal, focus arrival/return, visible rule-readiness/read-only states, pending-move source context, and expected mutation request boundaries. Intercept POST/PATCH/swap calls with deterministic fixtures or bind the preview to an explicitly isolated non-production backend; fail closed if production isolation cannot be proved. Run full gates only after all child acceptance contracts are byte-current.
- Failure and recovery behavior: Any missing route, mutable unready state, stale current claim, retained workflow regression, browser rendering/focus/responsive failure, unexpected or unisolated mutation request, source/import hit, warning-baseline increase, or child/gate failure blocks release and triggers a branch revert of the entire cutover rather than partial legacy restoration.
- Verification: Focused interaction suite; captured browser-preview evidence for each normal/redirected entry and both widths with mutation-interception/isolation assertions; `rg` current-source/import/mount checks; `npx tsc --noEmit`; `npm test`; `npx eslint .` with 0 errors and no undocumented warning increase.
- State after this step: Final releasable integration candidate exists on the feature branch; no deploy, push, merge, alias, or production write is authorized.

## Data and failure safety

- Identity and source of truth: Stored role ID selects focus; `YYYY-MM` from the role date selects calendar context; P1 roles-GET/E13 evidence and P3–P5 frozen intent remain the only mutation/adoption authorities.
- Migration and compatibility: UI/source cutover only; no schema, endpoint, env var, secret, or data migration. Historical plans/logs remain. The final release intentionally removes the legacy component contract.
- Partial failure and retry behavior: Steps 1–4 are held non-released until every redirect/removal/current-source check passes together. Underlying create/save/swap unknown and maintenance outcomes remain frozen/truthful; cutover adds no retry path.
- Concurrency, conflicts, and idempotency: P3 receipts, P4 exact old-revision PATCH attempts, and P5 exact all-role swap attempts remain unchanged. Multiple same-date roles focus by role ID, never date.
- Data preservation and rollback: Before release, one branch revert restores `SeatBoard` add/edit and card swap together. A later code rollback cannot undo real service edits; use the relevant prior Sanity document revision(s), including coordinated two-role recovery for swaps, and verify canonical E13 state.

## Verification

| Requirement | Test or check | Failure it detects |
|---|---|---|
| Retain/add direct **Editar mes** | Interaction opens selected/default month grid | Sole editor lacks an explicit normal entry. |
| Route every former create/edit entry | `Nuevo`, card Edit, and all three `service_modal` primary-kind interactions | Dead handler, wrong month, wrong same-date role, or composer not opened. |
| R11 at every former entry | Entry × source-state matrix plus keyboard/pointer mutation assertions | Mutable grid with unknown rules or bypass through a specific handler. |
| Full Sunday spine/current config | Prop/hard-rule assertions for destination month; omission/stored-Sunday mutants go red | Week exclusions evaluated against selected/loaded services. |
| Cross-month edit parity | Pending source role remains through uncertainty, destination-month admission is required, exact matching readback removes source, and **Abrir mes destino** focuses the same role ID | Retiring `SeatBoard` silently removes date-move capability or makes a move disappear/falsely succeed. |
| Grid-only swap | No card swap UI/props/state; P5 grid interaction remains | Duplicate/legacy swap surface or missing replacement. |
| Surgical legacy removal | Import/mount/reference searches; directly retired test deletion review | Deleting retained card workflows/tests or leaving hidden mounts. |
| Conditional rail/config cleanup | No-import proof before rail deletion; no consumer before `enforceableConfig` deletion | Removing a live helper or retaining Tablero-only dead code. |
| Retained card ownership | Delete, copy-instruments, publish/unpublish, setlist, proposal interaction tests | Scope creep that moves/breaks protected card workflows. |
| Create-one remains manual | P3 acceptance spy proves no solver/local-fill call | Deferred auto-fill silently reintroduced during rerouting. |
| Spanish/touch/date/accessibility | Labels, keyboard/focus, computed/class minimum 44px, role month and local-noon rendering | English copy, undersized controls, inaccessible path, or UTC day flip. |
| Integrated browser preview | Configured non-production preview at mobile/desktop widths for **Editar mes** plus redirected create/edit/team-swap/seat-swap; keyboard/focus, responsive three-part layout, rule-readiness, and mutation-interception/isolation assertions | A statically green cutover that fails in the integrated browser, bypasses readiness, or risks a production write during verification. |
| Current production-source truth | Global `app` production + current-doc/ADR search with explicit historical allowlist | Shipping/current claims still describe Tablero or two surfaces. |
| Child and repository gates | Repeat P3–P5 acceptance; `npx tsc --noEmit`; `npm test`; `npx eslint .` | Integration, type, behavior, lint, or warning-baseline regression. |

## Rollout, observability, and rollback

- Release sequence and gates: Enter only after all P3/P4/P5 acceptance and gates pass with unchanged inherited contracts. Complete route interactions before removal, then removal/current-source cleanup, focused mutants, retained workflow checks, all full gates, and isolated non-production browser-preview verification. Only the complete final state is release-safe, and this plan grants no release authority.
- Signals proving success: Every former trigger reports the intended month/context; unready displayed/destination rules visibly disable mutation; retained config visibly warns on stale reload; same-month/cross-month date edits and source-to-destination reconciliation pass; grid swap and all retained card workflows pass; searches show no current legacy surface; browser preview and full gates are green.
- Stop conditions: Any child contract changed/stale, any former route missing, initial unready state mutable, Sunday spine incomplete, card workflow broken, unresolved production/current-doc legacy hit, component still imported, browser-preview failure, inability to prove preview mutation isolation, gate failure, or inability to restore the old surface atomically before release.
- Rollback or forward-recovery steps: Before release, revert the cutover as one unit to restore both legacy add/edit and card swap; do not ship a mixed partial rollback. After later authorized release, revert code for UI regression and use Sanity history/forward reconciliation for content already changed through P3–P5.
- Restoration verification: Pre-release, rerun former legacy entry/card swap smoke checks after revert. Post-edit, roles GET/E13 must prove restored role identity/revision/assignment sets/topology; coordinated swaps require both role histories to restore coherently.

## Decisions

| Decision | Choice | Why | Tradeoffs | Owner |
|---|---|---|---|---|
| Destination | One month-editor opener with composer or stable role focus | Makes every route share rule/source/recovery admission. | ServicesPanel must carry explicit context rather than a boolean-only generator state. | P6 |
| `Nuevo` | Open create-one composer in the normal current/default month context | Preserves the top-level workflow while making grid sole editor. | Creating in another month first requires month navigation. | P6 |
| Card Edit/primary action | Role month plus role-ID focus | Same-date roles cannot be addressed safely by date. | Missing/incoherent role opens read-only recovery, not a fallback modal. | P6 |
| Card scope | Retain delete/copy/publish/setlist/proposal; remove only manual edit/swap | These retained actions are distinct protected stored-state workflows. | “Sole editor” does not mean sole roster-mutating quick action. | P6 |
| Legacy deletion | Only after interaction-complete replacement; rail/config deletion requires no-consumer proof | Prevents an unusable intermediate and accidental live-helper removal. | Final cleanup happens late. | P6 |
| Documentation | Update current claims and ADR later history; preserve historical artifacts | Current guidance must be true without erasing why old decisions existed. | Search requires explicit historical classification. | P6/docs owner |
| Release boundary | Complete cutover only after all children and full gates | Partial removal has no safe fallback guarantee. | No incremental release of P6 cleanup. | P6/release owner |

## Assumptions

| Assumption | Impact if false | Validation point | Failure response |
|---|---|---|---|
| P3/P4 expose one reusable month-editor context that can open composer/focus by role ID. | Redirects would need architecture/scope changes. | Step 1 API/interaction inspection before edits. | Stop P6 and propagate a material contract change to parent/P3/P4 review. |
| P5 grid swap fully replaces card team/seat selection. | Removing card swap would lose capability. | P5 acceptance matrix and direct interaction before step 3. | Retain card swap; P6 is not ready. |
| `SeatBoard` remains the only production importer of `ParticipationRail` after prerequisites. | Rail deletion could break another surface. | Post-cutover `rg` import search. | Retain rail and update ownership comments/tests; deletion is not required. |
| Current docs are limited to the docs/ADR hits found by the final search; historical superpowers artifacts may accurately mention Tablero. | Current operator/developer guidance could remain stale or history could be falsified. | Step 4 classification and final search. | Update newly found current claims; allowlist only clearly historical paths/context. |
| Pre-release branch revert can restore add/edit and card swap in one coherent byte state. | Cutover rollback could leave no editor or duplicate workflows. | Revert tabletop before any later release authorization. | Stop release until atomic restoration is verified. |

## Open questions

| Question | Why it matters | Recommendation and why | Tradeoffs | Owner | Blocking? | Resolution point | Bounded default |
|---|---|---|---|---|---|---|---|
| None. | Parent requirements and prerequisite outputs settle routing, ownership, rules, cleanup, and rollback. | Continue to adversarial review in roadmap order when explicitly requested. | Review may discover a prerequisite change that must propagate. | Review coordinator | No | Before implementation | Do not implement. |

## Handoff

- Prerequisites supplied to later plans: None; P6 is the final roadmap child.
- Outputs promised to later plans: Final sole-surface interaction evidence, current-source cleanup evidence, retained-workflow checks, full gates, and rollback/content-recovery checklist for a separately authorized release workflow.
- Adversarial review order: Parent roadmap → P1 → P2 → P3 → P4 → P5 → this P6 plan, one fresh reviewer at a time. Any material child/prerequisite change propagates and restarts review from the earliest affected artifact.
- Implementation authorization: **not granted by this plan**
- Remote-state authorization: No production Sanity write, migration, deploy, merge, push, PR, or Vercel mutation is authorized.

## Terminal state

READY_FOR_ADVERSARIAL_REVIEW
