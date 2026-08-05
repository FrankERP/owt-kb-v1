# Implementation Plan: Stable grid identity and stored-service read model

## Original request

> "For editing the services, I want to see the 3 column grid layout we just built. So there should be an 'Edit month' button that opens this layout. This will replace individual edits for a more robust edit view."
>
> "I want to drop Tablero and make the grid the king of editing."
>
> "The grid should also have the functionality to swap teams or just certain roles from one service to another."
>
> "Let's leave the auto fill with solver for a single service for later. We just need to be able to create a single new service and fill it manually."

This child delivers the prerequisite accepted in the parent plan: preserve the current create grid while giving stored services stable, integrity-approved grid identity. It does not add stored-service writes, create-one UI, swaps, entry-point redirects, or retire Tablero.

## Status and contract

- Document status: Review waived after verified fixes; implementation not authorized
- Accepted spec or requirement source: `docs/superpowers/plans/2026-08-03-month-grid-editing.md`, especially R7, R11 and shared decisions D2–D4
- Primary outcome: a pure, column-ID-based model that translates only complete, canonical stored roles into independent grid columns while leaving every create consumer's external meaning unchanged
- Preconditions: none; this plan is an enabling dependency with no prerequisite child plan
- Safe ending state: intentionally non-released branch state with the stored read model and read-only edit-mode rendering complete, all current create behavior regression-pinned, and no new stored mutation entry point

## Evidence and current behavior

| Evidence | Source | Planning implication |
|---|---|---|
| `GridCell` carries `date` plus `memberIds`, while `GridColumn` has no role identity or revision. | `app/components/admin/plannerModel.ts:52-124` | Introduce `columnId` and one `GridOccupant` assignment shape before loading stored roles. |
| `buildColumns` deliberately drops a second column on one date. | `app/components/admin/plannerModel.ts:370-406` | Preserve this create-preview rule, but stored columns must be built by a separate translator and keyed by role ID. |
| Solver merge, draft serialization, assignment lookup, and participation conversion group or key cells by date. | `app/components/admin/plannerModel.ts:726-760`, `876-951`, `1091-1100`, `1128-1167` | Audit every consumer: date remains calendar context, never current-service identity. |
| `PlannerGrid` keys cells, violations, overrides, React nodes, and picker state by date. | `app/components/admin/PlannerGrid.tsx:233-299`, `416-487`, `909-915`, `1424-1441` | Move all assignment/UI scopes to opaque `columnId`. |
| Roles GET returns `_id`, `_rev`, type/date/name/publication and stored `_key`s across all five seat fields, but filters unresolved vocal refs. | `app/api/admin/roles/route.ts:54-74` | Reuse this endpoint and pair every row with independently loaded integrity evidence; do not add another roles reader. |
| Integrity summaries expose target cardinality/public state, record identity/revision/date, all-five-field `assignedRefs`, dangling refs, draft conflicts, and weekend lock evidence. | `app/utils/serviceReadSummary.ts:58-125`, `153-305` | Build a pure fail-closed join before translation. |
| The current seat helper folds known labels case-insensitively (`bass` to `Bass`, `console` to `Console`). | `app/components/admin/seatModel.ts:34-73` | Stored row identity needs a separate case/accent-preserving `writeLabel`; create/new-seat canonicalization must not merge stored `Bass`/`bass` or `Console`/`console`. |
| `guardControl` checks only whether a control's source endpoints are ready. | `app/components/admin/serviceSourceState.ts:203-227` | Source readiness is necessary but not proof that one role is safe to translate. |
| Existing create tests cover idempotency, special names, participation, creatability, and refusal swaps, but do not collectively pin every model migration seam. | `app/components/admin/__tests__/plannerModel.test.ts`, `PlannerGrid.test.tsx`, `MonthGenerator.create.test.tsx` | Add mutation-discriminating regression pins before changing the model. |

## Scope

### In scope

- Regression-pin the current create path before changing production types.
- Add opaque `GridColumn.columnId`, `GridCell.columnId`, and `GridOccupant {memberId,itemKey?}` throughout all create-grid consumers.
- Keep create-preview columns stable as `create:${draftTargetKey(type,date)}` and preserve current draft identities and `creationRequestId`s.
- Build a pure roles-GET plus `RoleDomainSummary` join and a stored-role translator that only accepts an approved joined observation.
- Keep `ServicesPanel` as the single runtime owner of roles and role-integrity reads. Thread their rows/summary, independent source status and successful-load generation, and one paired retry callback into stored `MonthGenerator` mode; `MonthGenerator` must not fetch or retain a second source copy.
- Use role `_id` as every stored column's stable identity; retain `_rev`, immutable type, date/name, publication state, and each stored occupant `_key`.
- Make incomplete, invalid, ambiguous, raw-draft-overlaid, dangling, revision-mismatched, hidden-topology, globally incoherent role inventory, duplicate weekend target, blank/invalid-name special, normalized-identical-special-collision, and lock-invalid roles read-only with integrity details.
- Recognize only the narrowly defined deterministic weekend `missing_lock` case as `bootstrapEligible`; it is not ordinary mutable health and may later be sent only to a bootstrap-capable protected writer.
- Preserve stored instrument/FOH row identity with a case- and accent-sensitive `writeLabel` separate from display and new-seat canonicalization. `Bass`/`bass` and `Console`/`console` remain distinct rows and eventual write labels.
- Define and test R11's per-target admission contract for later mutation controls. Sunday owns its own calendar month/week; Saturday is governed by its following Sunday and therefore may belong to the next month's rule context (for example, `2026-02-28` is March week 1); specials have no week context. Build the complete Sunday spine for every target's owning Mexico City month, including a later P4 cross-month destination. P1 itself renders stored mode read-only in every rule state and supplies no mutation handler.
- Produce shared-date/all-five-field preservation fixtures for downstream writer/save tests.

### Non-goals

- No roles POST/PATCH/swap calls, PATCH serializer, save protocol, notification behavior, server writer changes, production migration, or production Sanity write.
- No create-one composer, solver call, single-service auto-fill, cross-month move UI/mutation, or service type conversion. P1 only supplies the per-target rule-admission primitive that P4 uses for guarded moves.
- No `Editar mes` entry point, card redirect, Tablero removal, or other release-facing workflow change.
- No second roles endpoint and no weakening of roles GET or integrity semantics.
- No case/accent folding of stored instrument/FOH labels and no cleanup of legacy labels.

### Preserved invariants

- Dates remain `YYYY-MM-DD` and calendar calculations/rendering use Mexico City local noon, never bare `new Date(iso)`.
- Saturday hides Coro; Sunday and special columns show it. Nonempty hidden Saturday `Chorus` is unsafe, not disposable.
- All five member-referencing fields remain represented, multiplicity is preserved, and stored `_key`s stay attached to their occupants.
- Create preview continues to permit one column per date and emits byte-for-byte equivalent POST meaning, including stable target-bound `creationRequestId`s.
- Same-date role-ID-distinct services are independent; dates are availability/calendar/rule context only.
- A stored roster is never inferred from a raw mutation response or translated from incomplete evidence.
- Any later mutable grid must use the exact ready/default/last-known-good config and an addressable owning-month Sunday spine required by R11 for every active weekend target, including a pending destination. Only an exact successful `{present:false}` config response confirms absence and permits defaults; malformed successful responses fail closed. P1 exposes only the tested per-target admission result.

## Affected boundaries

| Component, file, or system | Current responsibility | Planned responsibility |
|---|---|---|
| `app/components/admin/plannerModel.ts` | Date-keyed grid model and create/solver/participation translators | Own `columnId`/`GridOccupant`, preserve create outputs, and expose pure joined-observation/stored translation helpers. |
| `app/components/admin/seatModel.ts` | Canonical display/new-seat vocabulary with case-insensitive known-label folding | Keep that behavior for new seats; add or support a distinct stored-row definition with case/accent-sensitive `writeLabel`. |
| `app/components/admin/PlannerGrid.tsx` | Date-keyed rendering, picker, override, duplicate, and rule state | Key service-local behavior by `columnId`; use dates only by looking up the column's calendar context. |
| `app/components/admin/ruleEnforcement.ts` and candidate-ranking call sites | Evaluate one service's seated assignments | Receive assignments selected by `columnId`; violation/override state cannot bleed across same-date columns. |
| `app/components/admin/solverConfigSource.ts` | Classify solver-config GET responses as ready, absent, or error | Treat only `present === false` as confirmed absence; malformed successful objects are errors and never authorize defaults. |
| `app/components/admin/MonthGenerator.tsx` | Own create-grid fetch/state, config, columns, cells, and participation inputs | Adapt create consumers without output changes and host a non-released, always-read-only stored mode plus explicit R11 admission state for P4. |
| `app/components/admin/ServicesPanel.tsx` | Single owner of roles, role-integrity summaries, independent source lifecycle/generations, and retries | Remain the only read owner; pass a typed stored-source bundle and paired roles/integrity retry callback into `MonthGenerator` without exposing a released stored-edit entry point. |
| `GET /api/admin/roles` | Dereferenced stored-service reader | Remain unchanged as the stored grid's data source. |
| `GET /api/admin/service-integrity/roles` / `RoleDomainSummary` | Canonical/draft/member/lock integrity evidence | Supply the second half of the pure per-role join and full-inventory special collision check. |
| Focused planner/create tests | Pin existing pure/UI/create behavior | Prove create equivalence, stored identity/integrity refusal, label preservation, participation de-duplication, and rule readiness with demonstrated mutants. |

## Ordered changes

### 1. Pin the unchanged create contract

- Purpose: make model migration regressions visible before production structures change.
- Components: `plannerModel.test.ts`, `PlannerGrid.test.tsx`, `MonthGenerator.create.test.tsx` and only directly needed test fixtures.
- Change: pin every `createBlockFor` refusal reason; stable draft target identity and idempotency key; weekend/special `cellsToDrafts` POST meaning; row visibility; participation scope and `service_name` de-duplication; creatable-column filtering; and successful same-type preview-column swap. The positive swap assertion must prove the two rosters reach opposite dates at the eventual POST boundary while each date-target draft retains its original `creationRequestId`. Add a direct roles-GET route-contract test that pins `_id`, `_rev`, type/date/name/publication, all five seat projections, every slot `_key`, raw case/accent label values, and the existing dangling vocal-ref omission behavior.
- Failure and recovery behavior: tests only; no runtime state or data changes. If any behavior cannot be pinned without changing production code, stop and resolve the evidence gap rather than redefining the baseline.
- Verification: for each safety pin, record a temporary predicate inversion/deletion or original-date cell mutant and the targeted red assertion, then restore production code. The roles-GET test must exercise the route's operational-client result rather than restating a hand-built translator shape.
- State after this step: current create behavior is executable evidence; production behavior is unchanged and deployable, although this child remains unreleased.

### 2. Migrate the grid model without changing create output

- Purpose: separate service identity from date before stored roles enter the grid.
- Components: `plannerModel.ts`, `PlannerGrid.tsx`, `MonthGenerator.tsx`, `ruleEnforcement.ts`, candidate-ranking/local-fill call sites, and focused tests.
- Change: replace cell `date`/`memberIds` identity with `columnId`/`occupants`; give all columns opaque IDs; update cell lookup, solver merge, draft conversion, current-column assignment checks, duplicate detection, picker ranking, overrides, violation maps, participation conversion, DOM/React keys, skip/swap targets, and callbacks. Calendar/history/availability/week positioning resolve `column.date`; assignment and rule scopes select one `columnId`. Create translators serialize `occupants.map(o => o.memberId)` and generate exactly their old request meaning.
- Failure and recovery behavior: no persisted data changes. A missing or duplicate column ID fails in pure validation/tests rather than falling back to date. Keep the branch non-released until the full create regression suite and gates pass.
- Verification: snapshot/equality checks at `DraftCard` and POST-body boundaries, same-type preview swap tests, and date-aggregation mutants across picker, duplicate, rule, override, participation, and violation consumers.
- State after this step: the create grid uses stable internal identity while retaining current external behavior; no stored column exists yet.

### 3. Add the fail-closed joined integrity observation

- Purpose: prove one roles-GET row is complete and canonical before converting it to editable structures.
- Components: pure planner/read-model helper colocated with `plannerModel.ts` unless extraction is required by existing size/style, `serviceReadSummary` types, and focused pure tests.
- Change: build one immutable roles-GET inventory before admitting any stored role. Flatten every integrity target record and require an exact bijection with roles GET across unique role `_id`, `_rev`, `_type`, and service date; every roles-GET row must have usable identity/type/date and exactly one matching integrity record, and every integrity record must match exactly one roles-GET row. Require `recordIssues.length === 0` and no `draftIds` on any integrity target, because those raw issue/draft shapes lack enough type/date/name/revision evidence to assign them safely to a target across independent snapshots. Independent source generations are diagnostic only and never prove equality. This yields one global `roleInventoryCoherent` predicate. If it is false, every stored role is visible only as read-only integrity context and one paired roles/integrity retry is the sole recovery; no role is translated as mutable and the client never guesses which snapshot is newer. Only after coherence succeeds, group all roles-GET weekend rows by `{_type,date}` and require exactly one row whose ID/revision is the integrity target's sole record before that weekend role can be approved or `bootstrapEligible`. Separately build special identity from every roles-GET `special_role` row: missing, non-string, blank, or whitespace-only normalized names are read-only; group usable rows by `{date,normalizeServiceName(service_name)}` and make every duplicate-group member read-only. Then complete each per-role join by requiring `canonicalState === "single"`, `publicState === "single"`, no dangling ref, exact set equality between unique visible GET occupant IDs across all five fields and integrity `assignedRefs`, topology-valid visible fields, and valid expected owned-lock evidence. Retain a special's normalized name identity alongside its original display/write value. Classify only a globally coherent, target-unique canonical weekend role whose sole lock issue is its expected deterministic `missing_lock` as `bootstrapEligible`; all broader lock exceptions are forbidden.
- Failure and recovery behavior: any missing, stale, malformed, contradictory, duplicate, hidden-data, raw-draft, dangling, or lock-invalid evidence yields read-only context with integrity details. Any global inventory mismatch, untyped record issue, or raw draft makes the entire stored grid read-only until one paired retry obtains a coherent observation; target-specific duplicate weekend or special identity groups remain read-only after global coherence succeeds. No refusal yields empty cells or partial mutable admission as a recovery path.
- Verification: table-driven pair/inventory tests must cover exact coherent bijection plus missing/extra/duplicate/revision/type/date mismatch; malformed canonical rows; matched and unmatched `invalid_role`/`draft_only`; canonical draft overlays; asymmetric peer create/delete/move observations; and mutants that omit whole-inventory reconciliation, accept any issue/draft, or admit unaffected roles during global incoherence. Weekend target tests cover valid-plus-malformed same-target peers, raw-draft peers, duplicate full-GET `{type,date}` groups, and a mutant that trusts the integrity target's internally single bucket. Special tests cover valid-plus-malformed normalized-identical peers, missing/non-string/blank/whitespace-only names, full-inventory normalized collision grouping, and join-only/empty-name mutants. Per-role tests still cover revision/assignment-set equality, hidden Saturday data, and narrow lock bootstrap. Every global mismatch must block all mutable role admission; target collisions must block every member of only that target/identity group.
- State after this step: stored roles have deterministic approved/read-only observations, but nothing is rendered or written.

### 4. Translate approved stored roles without normalizing away identity

- Purpose: materialize complete stored services in the grid with lossless assignment and row identity.
- Components: pure stored translator, `GridRow`/seat helpers, fixtures, and planner tests.
- Change: translate only an approved join; use role ID as `columnId`; retain role ID/revision/type/date/name/publication and occupant item keys. Union default rows with every stored nonempty instrument/FOH label. Give each stored row an opaque category-plus-case/accent-sensitive identity and a separate `writeLabel`; apply only the shared storage-level whitespace normalization, never lowercase or accent folding. Existing display/new-seat canonicalization remains separate. Group multiple occupants only when their exact write labels match, preserving duplicate counts and keys.
- Failure and recovery behavior: labels or stored structures that cannot be represented become read-only integrity states; they are not merged, renamed, or dropped. No migration rewrites legacy labels.
- Verification: fixtures containing all five fields, duplicate/multiple occupants, custom/accented labels, `Bass` plus `bass`, `Console` plus `console`, and at least three role-ID-distinct services sharing one date; omission/folding/key-loss mutants must fail exact preservation assertions.
- State after this step: approved stored services can be losslessly represented as independent grid columns; invalid services remain visible only as read-only context.

### 5. Integrate a non-released read-only stored month mode

- Purpose: prove the stable read model works with real grid consumers before any stored mutation path is introduced.
- Components: `ServicesPanel.tsx`, `MonthGenerator.tsx`, `PlannerGrid.tsx`, `solverConfigSource.ts`, participation/candidate-load composition, rule-source state, and interaction tests.
- Change: keep `ServicesPanel` as the sole runtime read owner and pass stored mode a typed bundle containing the full roles-GET rows, `RoleDomainSummary | null`, separate roles/role-target source statuses and successful-load generations, and a paired retry that reloads both domains. `MonthGenerator` performs no duplicate fetch and treats either non-ready/null domain as unproven. Select stored roles inside the displayed Mexico City calendar month without placeholder date columns. Exclude each loaded stored role's old participation/history copy before adding exactly one live grid copy. Carry explicit `{config,lastKnownGood,sourceStatus,warning,mutationAdmission}` state: initial config loading/error has no admission; only an exact successful `{present:false}` response confirms absence and computes admission from established defaults; `present === true` requires a usable revision/config; every other successful shape is an error with no admission; ready uses fetched config; retained last-known-good computes admission through reload loading/error with a visible stale warning. Derive pure rule context per target: Sunday uses its date's month/week, Saturday uses its following Sunday's month/week, and special has no week context. Generate a complete Sunday spine independently for each required owning month, including P4's pending destination target, and require every relevant weekend target to be addressable before admission. Stored P1 rendering remains read-only even when `mutationAdmission` is true for P4 handoff. Do not expose roster/date/name controls or a save, POST, PATCH, or swap handler.
- Failure and recovery behavior: endpoint or per-role evidence failure leaves affected data read-only with retry/integrity guidance. Rule state with no usable config, a malformed successful config response, or an unaddressable weekend target yields no mutation admission and visible retry/integrity guidance. The mode stays unreachable from released entry points, and a source/interaction guard proves P1 adds no `ServicesPanel` route or mutable stored callback.
- Verification: direct-mode tests for the exact `ServicesPanel` source-bundle boundary, independent loading/error/generation states, paired retry, and proof that `MonthGenerator` issues no roles/integrity fetch. Rerender with a newer parent source generation and changed rows/summary, and require immediate re-join/render from props so a mutant that retains the first coherent bundle in child state fails. Test explicit `{present:false}`, usable `present:true`, retained last-known-good, and malformed successful bodies such as `{}`, `{present:null}`, `{present:"false"}`, and `{present:0}`; a mutant that restores `present !== true` as absence must fail. Test per-target hard-rule inputs for displayed and cross-month destination targets, including `2026-02-28` mapping to March week 1; mutants that reuse the displayed month, return `null` and skip week rules, omit the owning-month spine, or use selected/stored Sundays must fail. Also test same-date isolation, pure column-date replacement retaining cell attachment, one-live-copy participation/candidate load, and absence of stored mutation controls/entry points. Mutants that duplicate a fetch, retain a stale child source copy, treat either failed/null domain as ready, drop generation/retry wiring, retain both stored/live participation copies, or expose controls must fail.
- State after this step: P3–P6 receive a verified stable model and fixtures; the application has no released stored-grid writer or new editing entry point.

## Data and failure safety

- Identity and source of truth: stored service identity is role `_id`; create-preview identity is `create:${draftTargetKey(type,date)}`. Roles GET supplies dereferenced visible assignments/keys, and the matching integrity summary proves completeness and canonical safety.
- Migration and compatibility: no data migration. Internal create types change, but draft and eventual POST meaning remain equivalent. Existing stored labels are represented without cleanup or canonical rewrite.
- Partial failure and retry behavior: `ServicesPanel` owns one paired roles/role-integrity retry. Reads fail closed per role; either domain being non-ready or integrity being null makes stored mode unproven. A failed refresh never replaces a previously coherent model with inferred empties or triggers a duplicate child fetch. No mutation/retry protocol exists in this child.
- Concurrency, conflicts, and idempotency: exact whole-inventory GET/integrity identity is required before any stored role admission. Any source mismatch, record issue, or raw draft blocks the entire stored grid and requires paired retry rather than guessing observation order; coherent target duplicates remain target-local refusals. Create-preview `creationRequestId` behavior remains unchanged.
- Data preservation and rollback: all five fields, multiplicity, item keys, exact case/accent-sensitive write labels, and same-date document separation are preserved in fixtures and translation. Roll back by reverting this branch; no content restoration is needed because this child performs no stored writes.

## Verification

| Requirement | Test or check | Failure it detects |
|---|---|---|
| Current create contract survives model migration. | Regression pins plus exact `DraftCard`/POST-body assertions for weekend/special, block reasons, row visibility, creatability, participation, and successful same-type preview swap. | Changed request meaning, unstable request IDs, wrong target/date, hidden row writes, or refusal-only swap coverage. |
| Every service-local consumer uses `columnId`. | Same-date weekend plus two differently named specials; cross-service and within-one-column assignment/rule cases; targeted date-aggregation mutants. | Cross-wired rosters, picker blocks, duplicate/hard-rule/override/violation bleed, or date-keyed React/state identity. |
| Stored join refuses incomplete or unsafe evidence. | Tests for hidden dangling voice ref, assignment-set race, raw draft, duplicate target, invalid role, revision mismatch, nonempty Saturday Chorus, normalized-identical specials, and every invalid lock state. | Translation to misleading empty/mutable cells. |
| Read ownership and transport cannot drift. | `ServicesPanel`-to-`MonthGenerator` boundary tests for full rows, role summary, independent status/generation, paired retry, absence of child roles/integrity fetches, and parent-generation rerender that defeats a retained-child-copy mutant. | Duplicate source state, stale independent copies, or retrying only half of the joined observation. |
| Special identity is complete before admission. | Missing/non-string/blank/whitespace names plus valid-and-malformed normalized-identical peer inventory tests and join-only/empty-name mutants. | A nameless special or a valid peer of an excluded collision becoming mutable. |
| Role inventory is coherent across independent reads. | Exact whole-inventory ID/revision/type/date bijection; zero record issues and target draft IDs; asymmetric create/delete/move, malformed peer, and raw-draft pairs; global-reconciliation/partial-admission mutants. | Any role becoming mutable while another published or draft role exists only in the other observation. |
| Weekend targets are unique in the full read inventory. | Full roles-GET `{type,date}` grouping matched to the integrity target's sole record, with malformed/draft-only peer fixtures and an integrity-bucket-only mutant. | A valid weekend becoming mutable while a hidden peer occupies its deterministic target. |
| Missing-lock exception is narrow. | Deterministic sole-`missing_lock` fixture plus malformed/wrong-owner/vacant/orphan/multiple-issue fixtures and broadening mutant. | Unsafe implicit lock repair eligibility. |
| Stored row/occupant identity is lossless. | All-five-field fixture with custom/accented labels, multiple occupants, duplicates, `Bass`/`bass`, `Console`/`console`, keys, and shared dates. | Label folding, dropped fields/occupants, multiplicity loss, or key reassignment. |
| Participation/candidate inputs contain one live copy per column. | Open-only count/ranking tests and retained-copy mutant. | Fairness double counting or disappearance of loaded assignments. |
| Rule admission is honest, per-target, and fail-closed. | Initial loading/error, exact absent/default, ready/fetched, malformed-success, retained-last-known-good warning, boundary-Saturday/displayed/destination hard-rule tests, and response-classification/month-reuse/null-week/spine-omission mutants. | Mutable grid with unknown rules, malformed 200 responses authorizing defaults, destination moves using the wrong calendar, or silently skipped week rules. |
| Repository gate remains green. | `npx tsc --noEmit`; focused tests during delivery; `npm test`; `npx eslint .` with 0 errors. | Type drift, regressions, or lint errors. |

For every new pure-logic safety test, record the production mutant and targeted red assertion before counting the restored green test as evidence.

## Rollout, observability, and rollback

- Release sequence and gates: implement on the feature branch in ordered steps; run focused tests after each step and all three repository gates at completion. Do not merge, push, deploy, or expose an entry point under this plan.
- Signals proving success: exact create-boundary equivalence; all joined-observation refusal tests; all-five-field/shared-date/label preservation; one-copy participation; rule-readiness tests; and green TypeScript/Vitest/ESLint gates.
- Stop conditions: any create request/body or request-ID change, any role translated without complete matching evidence, any case/accent label merge, any hidden field loss, any mutable handler, or any failing gate.
- Rollback or forward-recovery steps: revert only this child's branch changes or fix forward before dependent plans begin. Keep the current released create/Tablero surfaces untouched.
- Restoration verification: rerun create regression pins and global searches proving no stored mutation endpoint or released edit entry was added; no Sanity restoration is required.

## Decisions

| Decision | Choice | Why | Tradeoffs | Owner |
|---|---|---|---|---|
| Stored column identity | Role `_id` | Stored services may share dates; IDs remain stable through date/name edits. | Requires explicit calendar lookups instead of convenient date grouping. | Parent plan / implementation owner |
| Create-preview identity | `create:${draftTargetKey(type,date)}` | Preserves the accepted one-column-per-date create behavior and idempotency. | Create and stored translators have different construction paths. | Parent plan / implementation owner |
| Assignment shape | `GridOccupant` only | Member ID and stored item key cannot drift in parallel arrays. | All current consumers must migrate together. | Implementation owner |
| Integrity admission | Exact whole-role-inventory bijection first, then target-specific weekend and special identity checks, then per-role assignment/lock admission | Roles GET can hide dangling refs; integrity excludes malformed roles from target buckets and omits comparable identity on issues/drafts, so per-row or special-only matching cannot prove a safe inventory. | Any source race, issue, or draft makes all stored roles temporarily read-only; paired retry is safer than inference. | Parent plan / implementation owner |
| Stored read ownership | `ServicesPanel` owns both source domains and passes one typed bundle plus paired retry | It already owns roles, integrity summaries, lifecycle generations, and retries; a child fetch would create drift. | Adds an explicit prop boundary to the otherwise internal stored mode. | Implementation owner |
| Weekend rule context | Sunday owns its calendar month/week; Saturday uses its following Sunday | Week exclusions are Sunday-spine-based, so a month-end Saturday must remain addressable across the boundary rather than silently skip rules. | A displayed month can require a second owning-month spine for its final Saturday. | Parent plan / implementation owner |
| Config absence | Only exact `present === false` confirms absence | Missing or ill-typed `present` is not evidence that defaults are authoritative. | Malformed successful responses block mutation until retry/fix. | Implementation owner |
| Stored seat labels | Separate case/accent-sensitive `writeLabel`; canonicalization only for display/new seats | Prevents destructive merging/renaming of legacy stored rows. | Visually similar legacy rows can remain separate until an explicit cleanup is designed. | Parent plan / implementation owner |
| Child release boundary | Intentionally non-released, no writer | A read-model prerequisite can be verified without exposing a partial editor. | Delays user-visible value until dependent plans complete. | Release owner |

## Assumptions

| Assumption | Impact if false | Validation point | Failure response |
|---|---|---|---|
| Roles GET and integrity summary expose enough data to prove all-five-field completeness without another endpoint. | Stored roles cannot be safely admitted under this scope. | Step 3 fixtures against current response types and route tests. | Stop with exact missing evidence; revise parent/child plans before adding a reader. |
| Internal grid type migration has no external package consumer beyond repository call sites. | A consumer could retain date/member-array semantics silently. | `rg` consumer inventory plus TypeScript and full tests in Step 2. | Include the discovered direct consumer in the same migration; do not add compatibility state. |
| Shared storage-level label whitespace normalization preserves the required stored case/accent identity. | Eventual writer labels could differ from the modeled rows. | During P1 Step 4, compare translator fixture labels with `parseEditRequest`/`normalizeSeats` behavior before P1 completes or P4 review begins. | Mark the role read-only and revise the parent/P1/P4 serializer contract; P1 is not review-ready until resolved. |
| Holding this child non-released is operationally acceptable. | A partial internal model might need an unsupported release surface. | Release review after all gates. | Keep entry points absent; obtain a new reviewed release plan rather than expose partial editing. |

## Open questions

| Question | Why it matters | Recommendation and why | Tradeoffs | Owner | Blocking? | Resolution point | Bounded default |
|---|---|---|---|---|---|---|---|
| Should the pure joined model remain in `plannerModel.ts` or move to one sibling file? | File ownership and test imports, not behavior or safety, differ. | Keep it in `plannerModel.ts` unless repository lint/size or a server/client boundary requires a sibling; the contract remains pure either way. | Colocation is simpler; extraction can improve navigation but adds a module boundary. | Implementation owner | No | Step 3 before editing | Colocate. |
| When should this child become reachable? | Its safe ending state intentionally has no complete editing workflow. | Only with the downstream release plan after P3–P6 and entry-point/removal gates pass. | Holding delays feedback; early exposure creates a partial editor. | Release owner | No | Integrated release review | Keep unreachable and non-deployed. |

No unresolved question changes this child's contract or safe path.

## Handoff

- Prerequisites supplied to later plans: none required by this child
- Outputs promised to later plans: stable `columnId`/`GridOccupant` contracts; approved/read-only/bootstrap-eligible joined observations; lossless stored translator and row `writeLabel`; same-date/all-five-field preservation fixtures; one-copy participation composition; fail-closed per-target R11 rule-admission state and owning-month Sunday spines for displayed/destination contexts in P3–P6
- Adversarial review status: remaining plan review is waived by the decision recorded in the review ledger; this waiver is not a formal approval
- Implementation authorization: **not granted by this plan; implementation is not authorized**

## Terminal state

REVIEW_WAIVED_IMPLEMENTATION_NOT_AUTHORIZED
