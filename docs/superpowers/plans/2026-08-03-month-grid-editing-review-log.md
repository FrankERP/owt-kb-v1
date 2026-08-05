# Month-grid editing — adversarial review ledger

The cold reviewers receive only the implementation plan, repository path, reviewer brief, and original requirement. This separate ledger records round outcomes without anchoring later reviewers.

## Round 1 — `CHANGES_REQUIRED`

Plan reviewed at SHA-256 `cb1ae8ae81578ce8c3c17615d2295da5c9752b996779308d100f6fd94bf85db3`.

| # | Blocker | Author verification and disposition |
|---|---|---|
| 1 | Plan promised existing-service type editing although the current editor and PATCH prohibit conversion. | **Fixed.** `SeatBoard.tsx:476-492` shows a badge for `initial`; `[id]/route.ts:126-139` rejects a requested type different from stored `_type`. Revised E3/Task 4 keeps type immutable and limits the picker to create-one. |
| 2 | Date-keyed cells cannot represent legitimate shared-date stored services. | **Fixed.** `GridCell`/lookups are date-keyed and `buildColumns` drops duplicate dates; `serviceCardModel.test.ts:1118-1149` establishes differently named same-date specials as valid. Revised E2/Data Contract requires stable role-column identity everywhere and shared-date tests. |
| 3 | Whole-team Sunday/special↔Saturday swap can write Coro into Saturday. | **Fixed.** `swap/route.ts:154-169` exchanges all five fields, while `plannerModel.ts:280-317` excludes Coro only for Saturday. Revised E4/Task 6 adds a server topology refusal while preserving the existing atomic stored-state swap. |
| 4 | Immediate stored-state swap conflicts with staged unsaved edits, lacks cell item keys, and returns no refreshed revisions. | **Fixed.** The route commits from stored state and returns IDs only; roles GET has keys but `GridCell` did not. Revised E1/E11 and Tasks 2/6 carry occupant keys, require a globally clean grid, freeze unknown outcomes, and require readback before more edits. |
| 5 | Partial-save claims were impossible under lost PATCH response and successful response without `_rev`. | **Fixed.** `[id]/route.ts:281-347` commits before best-effort readback. Revised E8 and the Save Protocol distinguish committed/failed/unknown/not-sent/reload-needed, retain the exact old-revision attempt, and merge readback by role ID. |
| 6 | Same-date special rename bypasses destination occupancy and has no concurrent identity coordination. | **Fixed.** `[id]/route.ts:142-177` checks occupancy only for date moves; specials deliberately have no weekend lock. Revised E12/Tasks 3-4 add a separate deterministic special-identity coordinator shared by create and identity-changing edit, plus route/concurrency tests and an ADR. |
| 7 | Deleting `SeatBoard` mounts alone leaves card/primary edit handlers opening dead modal state. | **Fixed.** `ServicesPanel.tsx:1188-1192,1538-1540,1571-1591` still routes create/edit to Tablero. Revised Task 7 enumerates every redirect and requires interaction tests, not import search alone. |

Non-blocking notes also resolved: the stale Superpowers skill reference was replaced with the repository’s available bounded sub-agent workflow, and Tasks 2/5/6 now enumerate semantic no-op, notification-silence, revision-adoption, and mutation-discriminating tests.

## Round 2 — `CHANGES_REQUIRED`

Plan reviewed at SHA-256 `c599fc18542512801229ad988f77a0c3b891b84621d55b3cd2bc3b48c7f2d909`.

| # | Blocker | Author verification and disposition |
|---|---|---|
| 1 | Resolved 5xx/malformed responses were treated as failed although route side effects can throw after commit. | **Fixed.** Role PATCH/create/swap all call fallible notification/revalidation work after `tx.commit()`. Revised Fact 14/E8 and the response classifier treat only allowlisted typed pre-write 4xx as known failure; 5xx/malformed/untyped/transport outcomes freeze and reconcile. Tasks 3/5/6 require post-commit-500 tests. |
| 2 | Unknown create could mint a new request ID after payload edits and duplicate a committed-but-lost service. | **Fixed.** E9, Save Protocol, and Task 3 freeze the exact payload/`creationRequestId`, composer editing, and new logical creates until receipt replay/readback resolves the unknown attempt. |
| 3 | PATCH returns raw stored seat arrays incompatible with the dereferenced roles-GET translator. | **Fixed.** `serviceReadQueries.ts:17-26` confirms raw `Lead`/`BGVs`/`Chorus` refs, while roles GET dereferences them. Revised Data Contract/Save Protocol never translates a mutation body; every 2xx freezes until roles-GET plus integrity readback. |
| 4 | `guardControl` cannot prove per-role canonical/draft/dangling integrity and roles GET hides dangling voice refs. | **Fixed.** `guardControl` checks only source statuses (`serviceSourceState.ts:216-226`); roles GET filters unresolved voice refs. Revised E13/Task 2 requires an `_id`/`_rev` join to `RoleDomainSummary` with canonical-single, no-draft, valid, dangling-free, lock-safe evidence and integrated refusal tests. |
| 5 | Task 1 omitted the successful create-preview column swap baseline before identity refactor. | **Fixed.** `MonthGenerator.tsx:1727-1777` moves same-type rosters and rebuilds eventual drafts. Task 1 now requires positive roster/date/POST/request-ID assertions and a date-key mutant failure. |
| 6 | Production UI/tests/contracts still describe a shipping Tablero after component deletion. | **Fixed.** `MonthGenerator.tsx:865-904` renders Tablero-specific rules copy and `enforceableConfig` exists only for that surface. Revised Task 7 removes the contract, rewrites rendered copy, enumerates affected comments/docs/tests, and requires a global production-source search. |
| 7 | `bootstrap_completed_reload` can advance maintenance revisions while leaving business edits unapplied. | **Fixed.** `[id]/route.ts:197-216,281-289` can bootstrap then return the typed 409. Revised response state machine/Task 4 stops the batch, readbacks only revision/lock metadata while preserving semantic baseline/local cells, and requires a newly reviewed explicit retry. |

The non-blocking schema/Studio note was also adopted in Task 4. Mixed participation retirement tests are explicitly updated surgically rather than deleted wholesale.

## Round 3 — `CHANGES_REQUIRED`

Plan reviewed at SHA-256 `8961b373a05e25dc482669d8612a83cba6d8fa68792bf2656575bcabfb1db2de`.

| # | Blocker | Author verification and disposition |
|---|---|---|
| 1 | Matching role ID/revision plus empty dangling refs can still certify an incomplete roles-GET roster when the two endpoints observe member resolution at different times. | **Fixed.** Roles GET and integrity are independent reads, and roles GET filters unresolved voice refs. Revised Fact 8/E13/Data Contract requires exact set equality between unique visible roles-GET occupants and integrity `assignedRefs`. Task 2 includes the race pair where integrity contains a member absent from GET even though `danglingRefs` is empty. |
| 2 | Writers can bootstrap maintenance and then return an ordinary later refusal, concealing that a revision-advancing commit already occurred. | **Fixed.** PATCH has post-bootstrap destination/lock refusal paths, and swap can bootstrap its first role before a later-role refusal; `resolveOwnedCoordination` already reports a per-call `bootstrapped` bit but the route discards it on failure. Revised Save Protocol/Tasks 4 and 6 require every post-bootstrap pre-business refusal to return `bootstrap_completed_reload`, preserve the underlying cause, reconcile metadata, stop, and require reviewed explicit retry. Tests cover PATCH destination refusal and first-role-bootstrap/second-role swap refusal. |

Author verification also found a related hidden-data loss case: the general validator permits nonempty Saturday `Chorus`, while the month grid intentionally hides that row. E13 and Task 2 now make any topology-hidden stored assignment read-only instead of translating it away. The row union also explicitly includes every stored custom instrument and FOH label.

## Round 4 — `CHANGES_REQUIRED`

Plan reviewed at SHA-256 `8afecbbf702b28cafd22e459c81bd756fbed916e4d2aea08ba2077554e9c7daa`.

| # | Blocker | Author verification and disposition |
|---|---|---|
| 1 | A known-commit GET readback can adopt a later administrator's overwrite as the initiating save's clean successful baseline. | **Fixed after churn-cap reassessment.** PATCH CAS protects only the transaction at `[id]/route.ts:233-289`; its best-effort readback and roles GET return latest state. E13 proves structural integrity, not transaction causality. Revised E8/state/protocol compares every canonical readback with the frozen intended semantics; a mismatch is committed-then-superseded/conflicted with intent and remote observation retained separately. Tasks 5/6 require PATCH plus team/seat-swap overwrite races and comparison-deletion mutants. |
| 2 | No required end-to-end test proves that changing one seat preserves every untouched stored field through the exact full-array PATCH serializer. | **Fixed after churn-cap reassessment.** `normalizeSeats` maps omitted arrays to empty and `buildRoleEditPatch` replaces all five arrays, while prior Tasks 2/5 tested separate seams. The plan now defines one complete production PATCH serializer and requires roles-GET/integrity → grid → one-seat edit → exact PATCH parser/patch → applied committed-document coverage across all five fields, custom labels, multiple occupants, and shared-date columns. A dirty-row-only serializer-loss mutant must make the committed-document assertion red. |

The non-blocking observations were independently verified and adopted: E13 now permits only a canonical-single deterministic `missing_lock` as explicit `bootstrapEligible` state while every other lock issue remains read-only; normalized-empty special names are refused by UI, pure parser when typed, and the authoritative stored-type server check before bootstrap; and every special coordinator assertion must advance a fresh nonce plus monotonic version under revision guard.

The repository skill's four-round churn cap applied here and paused the loop at the historical reviewed hash above.

## Post-cap reassessment — bounded hardening, not redesign

Plan changed to SHA-256 `8c54a005af6dc915621f3427453c2e0d66e4feb9b7fb7fdb7c0208d97cf53605`; approval streak reset to zero.

The architecture remains justified by current contracts rather than review-driven complexity: roles GET filters dangling voice refs; PATCH performs destructive full-array replacement; PATCH/create/swap expose unknown post-commit outcomes; same-date role identity cannot be date-keyed; and specials have no existing shared target mutex. The reassessment therefore kept the existing endpoint/read-integrity/revision model and applied only the two verified blockers plus the three hardening notes above. It rejected broader redesign, a second roles endpoint, a client roster swap payload, generic lock reuse for specials, and automatic new-revision retries as unnecessary or unsafe. Fresh sequential cold review resumes from this hash.

## Round 5 — `CHANGES_REQUIRED`

Plan reviewed at SHA-256 `8c54a005af6dc915621f3427453c2e0d66e4feb9b7fb7fdb7c0208d97cf53605`.

| # | Blocker | Author verification and disposition |
|---|---|---|
| 1 | Pre-existing specials with the same normalized date/name identity can each appear canonical-single because integrity keys specials by role ID, so both could remain writable. | **Fixed.** `roleTargetKey` returns the special role ID (`serviceReadModel.ts:43-59`) and `buildRoleTargets` groups on that key (`serviceReadSummary.ts:175-215`); PATCH checks occupancy only on a date move (`[id]/route.ts:142-177`). Revised E13/Data Contract cross-groups the full joined GET inventory by `{date,normalizeServiceName}` and makes every collision read-only. Task 4 now requires authoritative occupancy refusal on every special PATCH, including roster-only saves, plus bypass and predicate-deletion mutants. |

Plan changed to SHA-256 `57c868f9a66aa064f33a133f112a66e34f5642096605250964d783e26e90e401`; approval streak reset to zero. The reviewer also ran a focused 209-test baseline over role writers, swaps, integrity, and planner logic; it passed. No production data read was authorized, so whether such duplicates currently exist remains unverified and is not assumed safe.

## Round 6 — `CHANGES_REQUIRED`

Plan reviewed at SHA-256 `57c868f9a66aa064f33a133f112a66e34f5642096605250964d783e26e90e401`.

| # | Blocker | Author verification and disposition |
|---|---|---|
| 1 | Direct stored-grid entry did not preserve solver-rule readiness, so missing config could silently disable all hard-rule refusals. | **Fixed.** `PlannerGrid` returns no violations when `config` is absent (`PlannerGrid.tsx:457-490`); current create preview prevents entry while no honest config exists and retains last-known-good on reload failure (`MonthGenerator.tsx:1288-1351,1682-1691`). Added E14/direct-admission state and Task 2/7 interaction plus omission mutants: initial loading/error is read-only, confirmed absent uses established in-memory defaults, ready uses fetched config, retained config survives reload failure with warning, and every mutable grid receives the full calendar Sunday spine. |
| 2 | A lost response after the separate lock-bootstrap transaction could persist maintenance but return ordinary `stale_revision`, allowing the month batch to continue. | **Fixed.** `bootstrapLegacyLock` currently catches every commit rejection as `committed:false` without readback (`roleWriteOps.ts:483-495`). Revised Protocol requires a retained generated nonce and canonical role/lock reconciliation with three outcomes: not-committed, committed-reload, or unknown. Single/multi-role writers map committed/reload to mandatory `bootstrap_completed_reload`, unknown to `bootstrap_outcome_unknown`, and both stop before any later business write. Tasks 4/6 require exact-nonce, concurrent-nonce, absent-lock, inconclusive-readback, and earlier-role lost-response mutants. |

Both non-blocking notes were adopted. Task 4 now updates `docs/ARCHITECTURE.md` so its two-mutex/special-own-revision claims do not become stale. E5 clarifies that card copy-instruments remains an intentional atomic stored-state quick action rather than a manual editor; all free-form assignment changes and swaps remain grid-only.

Plan changed to SHA-256 `5af39df0ee9ae2bd0c959e34e0867203f1988497b395cb0a16741444419b7aae`; approval streak reset to zero.

## Round 7 — `CHANGES_REQUIRED`

Plan reviewed at SHA-256 `5af39df0ee9ae2bd0c959e34e0867203f1988497b395cb0a16741444419b7aae`.

| # | Blocker | Author verification and disposition |
|---|---|---|
| 1 | Same-date assignment and rule aggregation would create false hard conflicts between distinct services sharing a date. | **Fixed.** `EvaluateInput.assigned` is explicitly everyone on “THIS column” (`ruleEnforcement.ts:283-305`), pairwise rules are bounded within one column (`ruleEnforcement.ts:382-407,473-475`), and the original planner contract says the old date-wide selection meant that date's **one service** (`2026-07-29-planner-grid.md:240,254-255`). E2/Data Contract/Task 2 now scope candidate assignments, same-category duplicates, overrides, and hard-rule violations by `columnId`, with same-date split-column controls and date-aggregation mutants. Calendar/history semantics alone continue to use the date. |
| 2 | An invalid/read-only same-date role could disappear from date-wide same-category safety and permit an unsafe assignment in a healthy sibling. | **Rejected after verification.** The premise is the date aggregation corrected above. Candidate blocking is defined as another seat “on this service” (`2026-07-29-service-team-editor-design.md:108-119`); `candidateRanking.ts:174-205` evaluates only its supplied current-service assignments, and hard rules cannot consume another column. Injecting occupants from an untranslatable sibling would falsely block legitimate independently named same-date services. E13 still keeps that invalid role itself read-only and preserves it from serialization. |

The reviewer’s two hardening notes were adopted: create-one now explicitly sends and reconciles `published: false`, and frozen conflicts have concrete discard-remote versus freshly confirmed reapply controls with no passive or automatic new-revision retry.

Plan changed to SHA-256 `faf8219b9d64dd9b8e4e1c361fa5c37e755f11e777c34de9cdab1190bde2075b`; approval streak reset to zero.

## Round 8 — `CHANGES_REQUIRED`; loop paused at churn cap

Plan reviewed at SHA-256 `faf8219b9d64dd9b8e4e1c361fa5c37e755f11e777c34de9cdab1190bde2075b`.

One attempted cold read before this round was discarded without a verdict because the reviewer exposed itself to prior findings through the agent roster. It does not count as a round or approval. Round 8 used a replacement reviewer that was explicitly isolated from collaboration tools and the ledger.

| # | Blocker | Author verification and disposition |
|---|---|---|
| 1 | A newly selected draft-only, deleted, or arbitrary member ID can be committed before E13 readback detects the dangling reference. | **Verified; not yet applied because the churn cap requires user reassessment.** The members endpoint reads through implicit-perspective `serverClient` (`members/route.ts:18-25`, `serverClient.ts:4-11`), while the pinned pre-2025 API version defaults to raw and the repository's canonical runtime client explicitly selects published (`sanity/env.ts:1-2`, `operationalClient.ts:7-23`). `parseEditRequest` accepts nonempty IDs and `seatFields` writes them directly (`roleWriteRequest.ts:95-171,316-335`); role PATCH has no submitted-assignee resolution. The existing `loadCanonicalMemberIds` helper already performs the required published-perspective lookup (`roleWriteOps.ts:187-193`). A revision must make the candidate source canonical and resolve every submitted POST/PATCH assignee before maintenance or business writes, with zero-write draft-only/deleted/arbitrary-ID tests. |
| 2 | Canonical client seat helpers can collapse distinct, server-valid stored labels such as `Bass`/`bass` or `Console`/`console`, so an unrelated edit can rewrite untouched slots. | **Verified; not yet applied because the churn cap requires user reassessment.** `normalizeSeatName` case-folds known labels and `instrumentSeatDef`/`fohSeatDef` derive row IDs from that folded value (`seatModel.ts:38-73`); `buildRows` passes every supplied label through those helpers (`plannerModel.ts:259-276`). Server normalization preserves case and structural validation accepts every nonempty label (`normalizeLabel.ts:26-35`, `serviceReadModel.ts:111-135`). A revision must preserve an opaque stored-label identity separately from display canonicalization and add a full committed-document fixture with colliding client-normalized labels plus a collapse mutant. |
| 3 | Team-swap topology wording accidentally excludes same-class Sunday↔Sunday and special↔special swaps. | **Verified; not yet applied because the churn cap requires user reassessment.** E4 literally lists only Saturday↔Saturday and Sunday↔special, while the safe visible topology classes are both Saturday or both non-Saturday. The route contract and tests already support Sunday↔Sunday, weekend↔special, and special↔special coordination (`API_REFERENCE.md:258`, `roleSwapRoutes.test.ts:441-465,672-727`). A revision must state both topology classes and test Sunday↔Sunday, special↔special, Sunday↔special, Saturday↔Saturday, plus both forbidden Saturday/non-Saturday directions. |

The approval streak remains zero. This is the fourth substantive post-reassessment cold round (Rounds 5–8), so the repository skill's churn guardrail applies again: stop and reassess with the user before any further plan edit, reviewer, or implementation.

## User-authorized reassessment — scoped roadmap decomposition

The user explicitly requested use of the `write-scoped-plans` skill to check and modify the current plan. That request satisfies the Round 8 churn-cap pause for planning work only; it does not approve implementation or start another adversarial-review round.

Repository evidence showed that the monolithic plan crossed six semantic delivery boundaries with different trust, failure, recovery, and release contracts. The current plan path is therefore now the parent roadmap, with six self-contained child plans reviewed and delivered in dependency order:

| Artifact | SHA-256 |
|---|---|
| Parent roadmap — `2026-08-03-month-grid-editing.md` | `a923d5f102dafe5694996d37c10a45b8d6be44dcef67620a6da454bebee322cd` |
| P1 — `2026-08-03-month-grid-editing-p1-grid-read-model.md` | `d8c84cd119ffe34a23b79bffbdbb91399664af7ac8daa7ef9d4bb4cd4f9981c4` |
| P2 — `2026-08-03-month-grid-editing-p2-writer-hardening.md` | `ea3978ce799960b1a8484b203d1da0826330b68f93a2f8d3bb1b580a4be98365` |
| P3 — `2026-08-03-month-grid-editing-p3-create-one.md` | `e35432efe8c14e767428b44e83fd4faf367ab876747320ca9972851a12f0fdaf` |
| P4 — `2026-08-03-month-grid-editing-p4-save-reconciliation.md` | `f83e4e2b12bb916595bbd0bfe049c593b092ed39620148a1d1a0e09f29f39dea` |
| P5 — `2026-08-03-month-grid-editing-p5-stored-swap.md` | `171d3a72a21dd761187315d32c2655484f6bc9db391c7137c2303b546f956d5f` |
| P6 — `2026-08-03-month-grid-editing-p6-seatboard-cutover.md` | `67607371353103c4d5b3426453e503fe275ac47244e0f78e81df7d45021a2600` |

Round 8 dispositions:

1. **Canonical assignees:** P2 makes candidate reads explicitly published-perspective and resolves every first-attempt POST/every PATCH assignee across all five seat fields before coordinator, bootstrap, transaction, notification, or revalidation work. Receipt replay remains a no-write path.
2. **Stored labels:** P1 separates opaque stored row identity and exact case/accent-preserving `writeLabel` from display/new-seat canonicalization. P4 requires one complete production serializer and committed-document round trip across all five fields, including `Bass`/`bass`, `Console`/`console`, multiplicity, shared-date decoys, and destructive serializer/label-collapse mutants.
3. **Swap topology:** P5 defines compatibility as both Saturday or both non-Saturday and requires the complete allowed/refused order matrix before any maintenance write.

The two previously verified Round 4 safety blockers remain explicit in P4: readback becomes clean only when it equals frozen intended semantics, and a one-seat edit must survive the exact full-array PATCH path without changing any untouched field. Earlier identity, integrity, bootstrap, rule-readiness, notification, and cutover decisions are redistributed without weakening them.

The approval streak remains zero. No reviewer was invoked during this reassessment. Fresh review, if explicitly requested, starts with the parent roadmap and then proceeds P1 → P2 → P3 → P4 → P5 → P6, strictly one fresh reviewer at a time. Readiness is not approval, and neither this entry nor the plans authorize implementation, production Sanity writes, migration, deployment, merge, push, or PR creation.

## Parent roadmap cold review 1 — `APPROVED`

Parent roadmap reviewed at SHA-256 `a923d5f102dafe5694996d37c10a45b8d6be44dcef67620a6da454bebee322cd`.

- **Verified:** requirement/staged-cutover coverage; role-ID identity need; roles GET plus independent integrity evidence; destructive revision-guarded five-array PATCH; P4 frozen-intent and committed-document proof; receipt/weekend-lock/special behavior; stored-state atomic swap; Saturday/Coro topology; shipping fallback; ADR-0010 automation deferral; gate-based sequencing.
- **Unverified:** availability of production Sanity revision-history restoration and the operator recovery runbook. The roadmap already treats confirmation as a pre-release stop gate and no remote access was used.
- **Disposition:** no blocker and no roadmap edit; approval streak for this artifact is 1 on the hash above.

## Parent roadmap cold review 2 — `CHANGES_REQUIRED`

Parent roadmap reviewed at SHA-256 `a923d5f102dafe5694996d37c10a45b8d6be44dcef67620a6da454bebee322cd`.

| # | Blocker | Author verification and disposition |
|---|---|---|
| 1 | The sole-editor cutover could become release-ready with component interaction tests and static gates but no integrated browser-preview verification. | **Fixed.** `docs/DEVELOPMENT.md:40-42,68-71` explicitly requires end-to-end preview verification for browser-exercisable changes. Parent Integration acceptance, R13, and the P6 exit criterion now require a non-production browser-preview gate. P6 verifies normal **Editar mes** plus redirected create/edit/team-swap/seat-swap entries at mobile/desktop widths, responsive three-part layout, keyboard/focus, and rule-readiness, with mutation interception or an explicitly isolated non-production backend. The live mutation-capable deployed Playwright harness is excluded. |

The parent roadmap changed to SHA-256 `07dd39572abf0373c7325e8a9de12c8116946f6df5c1171cd9b85990d4385a01`; its approval streak reset to zero. P6 changed to SHA-256 `89b682513ea4f3255f5a41ccd74556f5813bcac48ddbc53837f4bad4ebf25d70` and will be reviewed later at its normal dependency position.

## Parent roadmap cold review 3 — `CHANGES_REQUIRED`

Parent roadmap reviewed at SHA-256 `07dd39572abf0373c7325e8a9de12c8116946f6df5c1171cd9b85990d4385a01`.

| # | Blocker | Author verification and disposition |
|---|---|---|
| 1 | Retiring `SeatBoard` while limiting grid date edits to the displayed month would silently remove the shipping cross-month move capability. | **Fixed.** `SeatBoard.tsx:495-503` accepts any valid date unless capability-locked, and `[id]/route.ts:142-176` owns guarded move dependency and destination-occupancy checks. Parent requirements R2/R11 and D9 now preserve cross-month parity. P1 supplies month-parameterized Sunday-spine/rule admission. P4 keeps pending move intent on the source role-ID column, requires explicit destination-month admission/confirmation, freezes the exact full PATCH attempt, matches readback by role ID outside the source filter, removes the source column only after exact intent equality, and offers focused destination-month entry. P6 repeats same/cross-month interaction and isolated browser-preview checks before removing the legacy editor. |

The parent roadmap changed to SHA-256 `6a6b0bec925df5deab3b96eabce591d3aeb5aec285b0162bd05ec9f9dbf6a032`; its approval streak remains zero. Affected unreviewed children changed to P1 `dfba521c38d40c4cba49b76ec8d37f3a20fca12ef6e4f13a84cf2d07a08ea3d8`, P4 `bf6518ba50be1142e4df96013797bd19d475a2e1d924100a53242a9c5be6bd7c`, and P6 `666e3b9a4b4c1f885321c303d901d6c6f4f15d21ac8d7e31c83e65ebd2c0934c`.

## Parent roadmap cold review 4 — `APPROVED`; loop stopped for user discussion

Parent roadmap reviewed at SHA-256 `6a6b0bec925df5deab3b96eabce591d3aeb5aec285b0162bd05ec9f9dbf6a032`.

- **Verified:** request/scope coverage; date-keyed-grid premise; roles GET plus independent integrity evidence; destructive PATCH isolation and production-path proof; frozen-intent reconciliation; stored-state atomic swap and Saturday/Coro topology; late legacy cutover; repository invariants/gates; ADR-0010 automation boundary.
- **Unverified:** live Sanity revision-history restoration availability and isolated browser-preview tooling. Both remain explicit pre-release validation/stop conditions rather than assumed facts.
- **Disposition:** no blocker and no plan edit; approval streak for this artifact is 1 on the hash above.

At the user's explicit request, the loop stops after this round for impact/cost discussion. No confirming parent reviewer and no child reviewer was launched. The parent and children are therefore **not approved under the two-fresh-approvals-on-identical-bytes contract**, and implementation remains unauthorized unless the user chooses and explicitly authorizes a revised review policy or waiver.

## Review-policy decision — risk-tiered, token-efficient approval

The user explicitly replaced the unconditional two-approval rule with a risk-tiered policy after reviewing the loop's demonstrated benefit and token cost. Reviewers remain fresh, cold, and strictly sequential; only the number of approvals and churn cap change.

| Artifact | Tier | Required approval | Rationale | Current state |
|---|---|---|---|---|
| Parent roadmap | Standard | One fresh cold `APPROVED` | Requirements/dependency/release roadmap; it does not itself implement a writer, serializer, or remote mutation contract. | **Approved** at cold review 4 on current SHA-256 `6a6b0bec925df5deab3b96eabce591d3aeb5aec285b0162bd05ec9f9dbf6a032`. |
| P1 grid read model | Standard | One fresh cold `APPROVED` | Read/model-only, intentionally unreleased, and no stored mutation handler. | Pending. |
| P2 writer hardening | Critical | Two sequential fresh `APPROVED` verdicts on identical bytes | Changes server writer trust boundaries, coordination, schema, and maintenance recovery. | Pending. |
| P3 create-one | Standard | One fresh cold `APPROVED` | After P2 approval, the client composer consumes its receipt-idempotent writer and does not change that writer's trust/payload contract. | Pending. |
| P4 save/reconciliation | Critical | Two sequential fresh `APPROVED` verdicts on identical bytes | Owns destructive full-array serialization, PATCH batching, retry, and conflict recovery. | Pending. |
| P5 stored swap | Critical | Two sequential fresh `APPROVED` verdicts on identical bytes | Owns multi-document atomic mutation, topology, concurrency, and two-role recovery. | Pending. |
| P6 cutover | Standard | One fresh cold `APPROVED` | Reversible UI/source migration with explicit fallback, browser-preview, and release stop gates; it inherits rather than changes P2/P4/P5 mutation contracts. | Pending. |

After two substantive `CHANGES_REQUIRED` rounds for any one artifact, the loop stops for user reassessment before another edit or review. Every implemented phase receives a fresh code review plus documented test and browser gates. Plan approval remains separate from implementation authorization.

## P1 grid read model cold review 1 — `CHANGES_REQUIRED`

P1 reviewed at SHA-256 `dfba521c38d40c4cba49b76ec8d37f3a20fca12ef6e4f13a84cf2d07a08ea3d8`.

| # | Blocker | Author verification and disposition |
|---|---|---|
| 1 | P1 did not designate a single runtime owner or transport contract for roles GET plus role-integrity evidence. | **Fixed.** `ServicesPanel.tsx:383-448,571-610,1274-1292` already owns the full roles rows, `RoleDomainSummary`, independent source lifecycle/generations, and retries, while `MonthGenerator.tsx:58-110` receives neither integrity evidence nor lifecycle. P1 now keeps `ServicesPanel` as sole owner and defines a typed bundle with full rows, summary, separate status/generation, and one paired retry; child duplicate fetches are forbidden and mutation-tested. |
| 2 | Collision grouping only over approved joins could miss a malformed same-identity special peer. | **Fixed.** `serviceReadSummary.ts:179-217` puts malformed roles in `recordIssues`, outside target records. P1 now builds special collision inventory from every roles-GET special row with usable ID/date/nonempty normalized name before integrity admission, makes every duplicate member read-only, and requires a valid-plus-malformed peer test plus join-only mutant. |
| 3 | A lone nameless special could satisfy every stated admission condition. | **Fixed.** `serviceReadModel.ts:394-415` does not validate `service_name`, the Studio schema does not require it, and `normalizeServiceName` totalizes missing/blank values to `""`. P1 now makes missing, non-string, blank, and whitespace-only names read-only, preserves normalized name identity for approved specials, and requires empty-name acceptance mutants to fail. |

P1 changed to SHA-256 `31c0c225c93b550b7da1e4582ea2d10f9ded83ab698027b52cfc466c2c4ac5ef`; its standard-risk approval credit remains zero. No production data read or mutation was performed. A fresh cold reviewer receives only this current P1 file, the repository, reviewer brief, code pointers, and original requirement.

## P1 grid read model cold review 2 — `CHANGES_REQUIRED`; churn cap reached

P1 reviewed at SHA-256 `31c0c225c93b550b7da1e4582ea2d10f9ded83ab698027b52cfc466c2c4ac5ef`.

| # | Blocker | Author verification and disposition |
|---|---|---|
| 1 | Per-role joining plus roles-GET-only collision inventory is not coherent across independent roles and integrity snapshots; an unchanged special can remain approved when a peer is created, deleted, or renamed between observations. | **Verified; pending user reassessment before edit.** `ServicesPanel.tsx:565-620` starts independent endpoint reads and tracks independent generations, which do not establish one snapshot. Roles GET exposes every special ID/revision/name, while `RoleDomainSummary` has special IDs/revisions/dates but no name and keys special targets by role ID (`roles/route.ts:54-74`, `serviceReadSummary.ts:58-125`, `serviceReadModel.ts:43-59`). In the create/rename race, the unchanged role still matches by revision and the P1 inventory sees no collision. The bounded correction is a global special-inventory coherence predicate before any special admission: reconcile every roles-GET special ID/revision against integrity targets/issues, reject all special admission on missing/extra/revision-mismatched peers, conservatively reject integrity-only invalid IDs, and require create/delete/rename race tests plus an omission mutant. |

This is P1's second substantive `CHANGES_REQUIRED` round under the risk-tiered policy. The churn cap therefore stops the loop before another P1 edit or reviewer. P1 remains unchanged at the hash above with approval credit zero; P2 and later reviews remain queued behind it. No implementation, production read/write, deployment, merge, push, or PR action is authorized.

## P1 post-cap reassessment — user-authorized inventory-coherence correction

The user authorized one bounded correction and exactly one additional fresh P1 cold review. P1 changed from SHA-256 `31c0c225c93b550b7da1e4582ea2d10f9ded83ab698027b52cfc466c2c4ac5ef` to SHA-256 `a3d1cceb82fd83a060ca8f37fa70a8e96757198e817c008500499c7630690429`; approval credit remains zero before that review.

The correction adds one fail-closed global `specialInventoryCoherent` predicate without adding an endpoint or claiming atomic snapshots. Every roles-GET special ID/type/revision must match exactly one special integrity target record and vice versa. Missing, extra, duplicate, type-conflicting, revision-mismatched, issue-backed-without-revision, or integrity-only-invalid peers make every special read-only until paired retry; unrelated weekend roles retain per-role admission. Peer create/delete/rename/type-change/invalid-role race tests and production mutants must prove the predicate discriminates. This preserves the earlier pre-admission roles-GET name/collision inventory and blank-name refusal while closing the independently observed snapshot race.

No later child was edited, and no implementation or remote action was authorized. The next action is the single user-authorized fresh P1 reviewer on the current hash; regardless of verdict, the coordinator stops before P2 for report/discussion.

## P1 user-authorized post-cap cold review — `CHANGES_REQUIRED`; stopped as agreed

P1 reviewed byte-identically at SHA-256 `a3d1cceb82fd83a060ca8f37fa70a8e96757198e817c008500499c7630690429`.

| # | Blocker | Author verification and disposition |
|---|---|---|
| 1 | The global special-inventory predicate accounts for unmatched `invalid_role` issues but not unmatched `draft_only` issues, whose missing type/name/revision can hide a draft-only special from published roles GET. | **Verified; not edited because the authorized review scope ends at this verdict.** `operationalClient` explicitly uses the `published` perspective, while raw integrity separately inventories draft documents. `RoleRecordIssue` permits `draft_only`, and `buildRoleTargets` emits unmatched raw drafts using only ID/base ID and no type/date/name/revision (`operationalClient.ts:7-23`, `serviceReadSummary.ts:106-114,297-305`). P1's predicate mentions only unmatched `invalid_role`. The smallest fail-closed correction is to make any unmatched `draft_only` issue global special-inventory incoherence, with one targeted fixture and mutant; exposing additional raw identity is unnecessary for this scope. |

The one post-cap reviewer authorized by the user is consumed. P1 remains unchanged at the reviewed hash with standard-risk approval credit zero. Per the explicit agreement, the coordinator stops before another edit, reviewer, or P2 action. No implementation or remote state change is authorized.

## P1 final correction — user-authorized review continuation

The user chose to apply the verified `draft_only` correction and continue sequential plan review. P1 changed from SHA-256 `a3d1cceb82fd83a060ca8f37fa70a8e96757198e817c008500499c7630690429` to SHA-256 `f91f35d988f114da5d954a8bacf3013ea1d9e71e0addbbdd2562c6f9f899d275`; approval credit reset to zero.

The global special-inventory predicate now treats any integrity issue absent from roles GET—`invalid_role` or `draft_only`—as unclassifiable and blocks every special until paired retry. A matched invalid weekend issue remains scoped to weekend admission. P1 requires a targeted unmatched-draft fixture and a production mutant that ignores that issue and makes the assertion red. No endpoint or raw-identity expansion was added.

Fresh cold review resumes on this P1 hash. Later children remain unchanged and queued in dependency order; reviewers remain strictly one at a time.

## P1 continuation cold review — `CHANGES_REQUIRED`

P1 reviewed at SHA-256 `f91f35d988f114da5d954a8bacf3013ea1d9e71e0addbbdd2562c6f9f899d275`.

| # | Blocker | Author verification and disposition |
|---|---|---|
| 1 | A same-ID weekend roles-GET row cannot safely exempt an integrity `invalid_role` issue from global special blocking because the issue has no comparable type/revision/name across independent snapshots. | **Fixed.** `RoleRecordIssue` contains only ID/kind/issues and invalid-role assembly discards raw type/revision/name (`serviceReadSummary.ts:106-114,179-193`). The P1 type-change race makes ID equality alone insufficient. P1 now makes every integrity record issue block special admission, removes the weekend-ID exemption, and requires the invalid-special-issue/same-ID-weekend/healthy-special fixture plus an exemption mutant. Healthy weekend admission remains per-role, but any unresolved issue conservatively blocks specials. |

The reviewer’s non-blocking source-copy note was also adopted narrowly: P1 now requires a parent-generation rerender test proving `MonthGenerator` immediately rejoins from changed props, with a retained-first-bundle child-state mutant failing. P1 changed to SHA-256 `c846d21a0a3851fe2dbebaa4d2cd4e6c68fbeff781c127d4d859fdaa4fc678d3`; approval credit reset to zero. One fresh continuation review now runs on this hash. If it returns another substantive `CHANGES_REQUIRED`, the resumed churn cap stops P1 again before further edits.

## P1 resumed-cap cold review — `CHANGES_REQUIRED`; loop paused

P1 reviewed at SHA-256 `c846d21a0a3851fe2dbebaa4d2cd4e6c68fbeff781c127d4d859fdaa4fc678d3`.

| # | Blocker | Author verification and disposition |
|---|---|---|
| 1 | Weekend admission can approve a valid row while another malformed canonical or draft-only document occupies the same deterministic weekend target outside the integrity target bucket. | **Verified; pending reassessment before edit.** `buildRoleTargets` excludes malformed roles into untyped `recordIssues`, groups draft overlays only by canonical base ID, and emits unmatched drafts as untyped `draft_only`, so a valid target can still report canonical/public single (`serviceReadSummary.ts:175-215,242-287,297-302`). Roles GET returns every published role without target-cardinality filtering. A full roles-GET weekend group can therefore contain A plus malformed B while A's integrity target remains single, or an asymmetric snapshot/issue-only draft can be invisible to A's per-role join. The authoritative writer occupancy check includes canonical and raw-draft target occupants, while same-date PATCH does not rerun destination occupancy (`roleWriteOps.ts:354-397`, `[id]/route.ts:142-177`). |

The resumed churn cap now pauses P1 before another edit or reviewer, and P2 remains blocked behind it. The recommended reassessment is to replace the special-only global predicate with one unified role-inventory coherence/admission contract: reconcile the complete roles-GET ID/type/revision inventory against integrity, make every untyped record issue block all mutable role admission, and require unique full-GET weekend `{type,date}` groups matching integrity's sole record; retain special `{date,normalizedName}` collision grouping afterward. Required tests are malformed/draft-only weekend peers plus asymmetric create/delete observations and omission mutants. P1 remains unchanged at the reviewed hash with approval credit zero.

## P1 unified role-inventory reassessment — user authorized

The user authorized the architectural correction and another fresh P1 review. P1 changed from SHA-256 `c846d21a0a3851fe2dbebaa4d2cd4e6c68fbeff781c127d4d859fdaa4fc678d3` to SHA-256 `2c543874e493314aa9a776fe8c3743df6d55a05ecf7be7c56607a14c45101293`; approval credit remains zero before review.

The special-only predicate and accumulated issue exceptions were replaced by one `roleInventoryCoherent` contract. It requires an exact whole-inventory bijection between roles GET and flattened integrity target records by unique ID/revision/type/date, zero untyped record issues, and zero raw draft IDs before any stored role becomes mutable. Any mismatch makes the entire stored grid read-only until paired retry. After coherence, weekend roles additionally require a unique full-GET `{type,date}` group matching the integrity target's sole record; specials retain normalized-nonempty name and `{date,normalizedName}` collision grouping. Per-role assignment-set, topology, publication-state, and lock checks remain unchanged.

Tests now require asymmetric create/delete/move observations, malformed canonical rows, raw draft overlays and draft-only peers, partial-admission mutants, duplicate weekend targets that the integrity bucket would hide, and the existing special/name/assignment/label safeguards. No endpoint, migration, writer, implementation, or remote action was added. Fresh review resumes on the hash above, with P2 still queued.

## P1 unified-inventory cold review — `CHANGES_REQUIRED`; loop paused

P1 reviewed at SHA-256 `2c543874e493314aa9a776fe8c3743df6d55a05ecf7be7c56607a14c45101293`.

| # | Blocker | Author verification and disposition |
|---|---|---|
| 1 | Month-only Sunday spines cannot address a boundary Saturday whose following Sunday is in the next month, allowing week exclusions to be skipped. | **Verified; pending reassessment before edit.** `weekForColumn` maps Saturday only by finding its next-day Sunday in the provided spine (`plannerModel.ts:675-684`), while `getDates` returns Sundays inside the requested month only (`MonthGenerator.tsx:157-167`). Existing tests prove `2026-02-28` is unaddressable from February's Sundays, and rule enforcement skips week exclusions when the mapping is null (`plannerModel.test.ts:268-273`, `ruleEnforcement.ts:367-380`). P1 currently grants month admission from that incomplete spine. The bounded fix is per-target addressability: include the adjacent next-month Sunday with explicit week semantics or refuse the boundary Saturday with visible guidance; tests must cover displayed and cross-month destination contexts plus a skipped-week-rule mutant. |
| 2 | A malformed successful solver-config response is classified as confirmed absence and can authorize defaults. | **Verified; pending reassessment before edit.** `sourceFromGet` maps every object whose `present !== true` to `absent`, so `{}` and `{present:"invalid"}` become default-backed state (`solverConfigSource.ts:88-96`). Existing tests cover explicit false and non-object failures, not malformed successful objects (`solverConfigSource.test.ts:78-110`). The bounded fix requires `present === false` for absence and maps every other malformed shape to error/no admission, with targeted malformed-200 tests. |

The unified role-inventory correction itself survived this cold read; both blockers are independent rule-admission gaps. The resumed churn cap pauses P1 before another edit/reviewer, leaves approval credit zero, and keeps P2 queued. No implementation or remote action occurred.

## Review-budget decision — verified fixes applied; remaining plan review waived

The user delegated the stop/continue decision to the coordinator because continued cold-review churn would consume the implementation budget. The coordinator applied the two independently verified P1 corrections and stops the adversarial plan-review loop here. P1 changed from SHA-256 `2c543874e493314aa9a776fe8c3743df6d55a05ecf7be7c56607a14c45101293` to SHA-256 `315a4cfe7051501208dd287d809d977841a0999ee900f608ae921d48b3d355bb`; no further reviewer receives this hash.

The final corrections are:

1. Rule admission is per target, not per displayed month. A Sunday uses its own calendar month/week; a Saturday uses its following Sunday's month/week, so `2026-02-28` is March week 1. Every relevant weekend target, including a pending cross-month destination, must have an addressable owning-month Sunday spine or remain read-only. Mutation-discriminating tests must fail if a boundary week maps to `null`, uses the displayed month, or silently skips a week exclusion.
2. Solver-config absence is confirmed only by an exact successful `present === false`. `present === true` still requires usable config/revision data; missing or ill-typed `present` values are errors with no admission. Targeted malformed-200 tests and a response-classification mutant are required.

This is an explicit **review waiver, not a formal `APPROVED` verdict**. The parent roadmap retains its risk-tiered approval. P1 has no approval credit, and the formal P1 plus P2–P6 child-plan review requirements are waived by this user-delegated coordinator decision. The plans may guide implementation only after separate implementation authorization.

Safety now moves to executable implementation evidence:

- Implement in dependency order and preserve each child plan's scope/release boundary.
- For every new safety-critical pure-logic test, demonstrate a production mutant that makes the targeted assertion red before restoring green.
- Run a fresh code review after each implemented phase, focusing on the actual diff and tests rather than reopening the plan loop.
- Run focused tests during each phase and require `npx tsc --noEmit`, `npm test`, and `npx eslint .` with zero errors before claiming completion.
- Run isolated non-production browser verification for browser-exercisable work and the P6 cutover.
- Do not perform production data writes, deploy, merge, push, or create a PR without the corresponding authorization.

This decision does **not** authorize implementation or any remote-state change.
