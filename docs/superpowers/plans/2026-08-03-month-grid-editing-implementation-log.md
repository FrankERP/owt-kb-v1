# Month-grid editing implementation evidence

Implementation began only after the user explicitly authorized it on 2026-08-04. The adversarial plan-review waiver and its limits remain recorded in `2026-08-03-month-grid-editing-review-log.md`.

## Baseline

- Branch: `feat/month-grid-editing`
- `npx tsc --noEmit`: passed.
- `npm test`: passed, 129 files and 3027 tests.
- `npx eslint .`: passed with 0 errors and 91 pre-existing warnings.

## P1 evidence

### Strict solver-config response classification

- Production change: `sourceFromGet` treats only exact `present === false` as confirmed absence; missing or ill-typed `present` values return `error`.
- Restored-green check: `npx vitest run app/components/admin/__tests__/solverConfigSource.test.ts` passed, 19 tests.
- Mutant: temporarily restored `body.present !== true` as the absence predicate.
- Targeted red assertion: `a malformed successful response is error — only explicit false confirms absence` failed with expected `error`, received `absent`.
- The safe predicate was restored immediately after the red proof.

### Whole-inventory stored-role admission

- Production change: added a pure roles-GET/integrity join that requires an exact ID/revision/type/date/publication bijection, zero untyped record issues, zero raw drafts, exact all-five-field assignment identity, target uniqueness, topology validity, and narrow lock health before admission.
- Restored-green check: `npx vitest run app/components/admin/__tests__/storedRoleReadModel.test.ts` passed, 9 tests.
- Mutant: temporarily replaced `reasons.size === 0` with unconditional coherent inventory.
- Targeted red assertions: all three missing-peer, extra-integrity-peer, and revision-race cases failed because incoherent observations were incorrectly reported coherent.
- The fail-closed coherence predicate was restored immediately after the red proof.

### Lossless stored-role translation

- Production change: admitted roles translate to role-ID columns and keyed occupants across all five fields; stored instrument/FOH rows retain exact case/accent-sensitive write labels beside create defaults.
- Restored-green check: `npx vitest run app/components/admin/__tests__/storedRoleReadModel.test.ts` passed after adding translation coverage, 11 tests.
- Mutant: temporarily lowercased stored instrument row identity.
- Targeted red assertion: `Bass` and `bass` collapsed into one row and the exact occupant/key preservation assertion failed.
- Case-sensitive row identity was restored immediately after the red proof.

### Per-target weekend rule context

- Production change: added a pure owning-Sunday context. Saturdays use their following Sunday even across a month boundary; specials have no week context; unaddressable weekends fail closed.
- Restored-green check: `npx vitest run app/components/admin/__tests__/serviceRuleContext.test.ts` passed, 4 tests.
- Mutant: temporarily treated Saturday's own date/month as its rule context.
- Targeted red assertion: the `2026-02-28` boundary case returned February/null instead of March week 1.
- Following-Sunday ownership was restored immediately after the red proof.

## P2 evidence

### Canonical assignees and truthful protected writers

- Production change: the members read uses published perspective and role POST/PATCH resolve every submitted assignee across all five seat fields against canonical published member IDs before coordinator, bootstrap, transaction, notification, or revalidation work.
- Route tests prove draft-only, deleted, and arbitrary member IDs produce zero writes. Receipt replay remains a no-write recovery path.
- Protected PATCH/create/swap paths propagate `bootstrap_completed_reload` whenever maintenance committed before a later business refusal; clients never mistake the advanced revision for an ordinary no-write failure.
- `npx vitest run app/api/__tests__/roleWriteRoutes.test.ts` passed 96 tests, including the production-path all-five-array preservation fixture. Focused bootstrap/swap route cases also passed inside the full suite, including first-role-bootstrap/second-role refusal and destination conflict.

### Serialized special identity

- Production change: special create and identity-changing PATCH use one revision-guarded coordinator keyed by normalized date/name target. Special occupancy is authoritative for roster-only PATCH as well as moves/renames.
- Added the `specialIdentityCoordinator` Sanity schema, monotonic nonce/version mutation, Studio hiding/protection, protected-read audit coverage, and ADR 0011.
- Concurrency tests prove one winner for same-target attempts and prevent stale coordinator revisions from authorizing a writer.

## P3 evidence

### Idempotent create-one and exact readback

- Production change: the stored editor creates one empty unpublished service with a stable `creationRequestId`; it never invokes solver/local-fill.
- Unknown create outcomes freeze the exact payload and disable a new logical create until receipt replay/readback resolves it.
- A successful response must return the role ID and echo the exact request ID. Canonical readback must then match type, date, normalized special name, five empty arrays, and `published: false`.
- The unrelated-empty-role regression proves another role at the same target cannot be adopted as the created service.

## P5 evidence

### Stored swap topology admission

- Production change: stored team swaps accept only Saturday-to-Saturday or non-Saturday-to-non-Saturday teams; individual-seat swaps retain cross-class support. Any involved Saturday with hidden nonempty Chorus fails before member resolution, coordination, or transaction creation.
- Restored-green check: `npx vitest run app/api/__tests__/roleSwapRoutes.test.ts` passed, 38 tests.
- Mutants: temporarily disabled the compatibility predicate, then separately disabled the hidden-Chorus predicate.
- Targeted red assertions: both Saturday orderings escaped the expected 400 refusal; both hidden-Chorus seat/team cases reached later paths and lost the required integrity reason.
- Both topology guards were restored immediately after their red proofs.

## P4 evidence

### Full-array save intent and reconciliation

- Production change: added a role-ID-only complete PATCH serializer, canonical semantic snapshots/no-op comparison, frozen exact retry bytes, transport outcome classification, and reconciliation that preserves intended edits when a known commit is later overwritten.
- Restored-green check: `npx vitest run app/components/admin/__tests__/plannerSaveModel.test.ts` passed, 6 tests.
- Serializer-loss mutant: temporarily serialized only the Lead row. The exact full-body assertion failed on every untouched instrument and FOH assignment.
- Concurrent-overwrite mutant: temporarily adopted any known-commit readback as clean. The committed-then-superseded assertion failed and exposed adoption of the other administrator's roster.
- Complete serialization and intended-snapshot comparison were restored immediately after their red proofs.

## P6 evidence

### Servicios entry-point cutover

- Production change: Servicios routes the top-level **Editar mes**, card roster edit, and **Nuevo servicio** actions into the stored month editor; the create entry opens its one-service composer.
- Restored-green check: the focused ServicesPanel source-contract suite passed.
- Mutant: temporarily removed the `openComposerInitially` handoff from the **Nuevo servicio** route.
- Targeted red assertion: the `routes Nuevo` test failed on the missing composer wiring.
- The composer handoff was restored immediately after the red proof.
- Mutant: temporarily removed the focused role ID from the card-menu edit entry. The interaction test observed only one focused edit handoff instead of both primary/menu paths; role focus was restored.
- Mutant: temporarily froze `integrityGeneration` at zero. The stored-source wiring test failed because canonical reconciliation could no longer observe integrity refreshes; the live generation was restored.
- Combined mutant: temporarily re-enabled legacy card swap mode and added an edit-team opener guard. The targeted retirement and read-only/retry reachability assertions both failed; the grid-owned swap path and fail-closed editor entry were restored.

### Final integrated review corrections

- Split create, edit, and swap capability gates so opening the editor through one path cannot authorize another operation.
- Added a separate `changeServiceDate` capability and enforced it in both the date input and save path.
- Create reconciliation now requires the exact role ID returned with the echoed creation request ID; an unrelated empty role at the same target cannot satisfy readback.
- Create readback compares the complete frozen target: type, date, normalized special name, empty roster, and unpublished state.
- Stored swaps freeze intended post-swap semantic snapshots for every involved role and adopt readback only when all match.
- Swap non-2xx classification clears frozen intent only for allowlisted typed pre-write refusals; 5xx, malformed/untyped, bootstrap-unknown, and transport loss remain verification-pending.
- Cross-month moves retain source role identity, use the destination service's complete Sunday spine, and reconcile by role ID outside the displayed-month filter.
- Per-role integrity failures remain visible as read-only columns. Invalid local edits count as unresolved work and cannot be silently closed or saved.
- Read-only columns are excluded as row-copy sources and destinations.
- Mixed save batches reconcile successful and maintenance-only roles independently while retaining rejected edits and truthful summary copy.
- Full-panel close restores focus to a stable remounted toolbar, **Nuevo**, or card opener identity rather than an unmounted DOM node.

## Post-preview correction — legacy publication flags (2026-08-05)

- Preview diagnosis found 14 of 27 stored role documents predated the `published` field. Sanity projected those missing values as `null`, while the stored-role parser requires a boolean and the established publication invariant treats only explicit `false` as unpublished.
- The admin roles inventory now projects `"published": coalesce(published, true)`. This keeps legacy/missing values grandfathered as published, preserves explicit drafts as `false`, and makes the editor inventory agree with the integrity routes.
- No Sanity migration or content write was needed. The correction is read-only and removes the primary `invalid_roles_response`; the reported cardinality and mismatch codes were downstream consequences of rejecting the whole inventory.
- Added a route query-contract regression for the normalized boolean projection. Full verification passed: 135 test files / 3159 tests, TypeScript, diff check, and ESLint with 0 errors / 90 accepted warnings.
- While rerunning the gate, restored the documented legacy `ParticipationRail` threshold sentence required by its existing source-contract test; the helper remains unmounted cleanup debt.

## Post-preview correction — complete section swaps (2026-08-05)

- User testing clarified that the second swap control was meant to exchange a complete section between two dates (for example, every BGV assignment on August 2 with every BGV assignment on August 9), not exchange one person with another.
- The stored writer now accepts a section path plus two role ID/revision selections and derives both complete arrays from canonical server state. One guarded transaction swaps only that field; array order, `_key`, `_type`, labels, references, emptiness, and unequal cardinality travel unchanged.
- The month editor replaces the per-person selectors with **Sección**, **Primer servicio**, **Segundo servicio**, and **Intercambiar sección**. The five choices are Líderes, BGV, Coro, Instrumentos, and FOH; services remain selectable even when the chosen section is empty.
- Shared sections may cross service classes. Coro refuses a pair containing Saturday, and the existing hidden-Saturday-Coro integrity refusal remains fail-closed.
- Section reconciliation adds ordered key/member/label fingerprints to the complete semantic snapshots. Equal member sets with wrong keys, order, or labels remain verification-pending and are never automatically retried.
- A single stored-mutation lock now covers cells, headers, row add/remove, save/create, both whole-team clicks, and section controls through transport and reconciliation. This closes the pre-existing window where a local edit or second swap could be accepted and then overwritten by readback adoption.
- Fresh integrated code review found two remaining loss windows: Close/Escape could unmount during active transport, and an empty custom row did not count as unresolved before a swap. Active stored transport now blocks both exits, and row-layout drift blocks team/section swaps until reverted or populated; deferred-request and empty-row regressions pin both corrections.
- The final bounded correction pass also closes three related races: a discard confirmation opened before transport can no longer close the editor during that request; row-only local work prevents adoption of unrelated source reloads; and a typed error counts as a proven pre-write refusal only when its exact HTTP status also matches. All 5xx responses remain unknown outcomes and reconcile from readback even if their JSON body reuses an allowlisted error code.
- Review accounting: the first review found the in-flight edit-loss window; the corrected digest received one cold approval; the next cold review found exact-fingerprint and overlapping-swap gaps. The loop then stopped at the churn cap under the user's token-efficiency direction. All three verified blockers were implemented; no claim is made that the final plan received two unchanged approvals.
- Focused integrated verification passed 5 files / 254 tests. Full verification passed 135 files / 3191 tests, TypeScript, diff check, and ESLint with 0 errors / 90 accepted warnings.
- The correction required no Sanity migration, direct content write, or automatic retry. It was later released through the recorded `main` merge and production deployment below.

## Final verification

- Focused client command (`MonthGenerator.stored`, `PlannerGrid`, and `solverConfigSource`): 3 files and 104 tests passed. The production role-write path was verified separately by the 96-test route suite above.
- `npm test`: 135 files and 3191 tests passed on the final feature and `main` merge trees.
- `npx tsc --noEmit`: passed.
- `npx eslint .`: passed with 0 errors and 90 accepted backlog warnings.
- `git diff --check`: passed.
- Production-source search confirmed no rendered `Tablero` or `SeatBoard` entry remained in `MonthGenerator`/`ServicesPanel`.
- Local browser verification reached the expected sign-in shell with no console errors. Authenticated admin UI was unavailable without credentials, so mutation behavior remained covered by automated component/route tests.

### Code-review accounting

- The P4 production-path preservation change received a fresh read-only review and `APPROVED` verdict after 96/96 route tests.
- The final P6/integrated review found the five material defects listed above. They were corrected and the focused/full gates were rerun green.
- At the user's direction, the review loop stopped after that bounded correction pass to preserve implementation budget. No claim is made that every phase received a separate formal post-fix approval or that a second final cold review was run.

## Commits and release delivery

- `6914c6d` — `docs(agents): make plan review risk-tiered`: formalized the token-efficient policy in the repository and Claude guidance while retaining two approvals for critical mutation/recovery plans.
- `3e0ab97` — `feat(admin): add safe month-grid service editing`: 60 files, 7659 insertions, 1249 deletions; pushed to `origin/feat/month-grid-editing`.
- `4d7165b` — `merge: month-grid editing into preview`: exact feature tree merged and pushed to `preview` on 2026-08-05.
- Vercel deployment `dpl_77qBCC7VCkAdhp87u51q8BN9vmyf` built commit `4d7165b` in canonical project `owt-backstage`, reached `READY`, and received aliases `dev-owt-backstage.vercel.app` and `owt-backstage-git-preview-frank-rochas-projects.vercel.app`.
- Stable preview returned HTTP 200 and the expected app sign-in shell. `/admin` correctly remained behind Vercel Deployment Protection.
- The Vercel build completed successfully with one non-blocking Turbopack NFT tracing warning from the existing `next.config.mjs`/solve-route trace.
- `8346a88` — `fix(admin): admit legacy services in month grid`: corrected the missing-`published` read projection without a Sanity migration and was pushed to the feature branch.
- `ed77adb` — `fix(admin): swap complete roster sections`: replaced person swaps with complete stored-section exchanges and added the final mutation-lock/readback corrections; pushed to the feature branch.
- `39d955c` — `merge: complete section swaps into preview`: exact corrected feature tree merged and pushed to `preview`; Vercel deployment `dpl_EmphTLKX4eM6k8XovVTc5ZPkiksa` reached `READY` with `dev-owt-backstage.vercel.app` attached.
- `fee03d8` — `merge: month-grid editing into main`: exact tested feature tree merged and pushed to `main` on 2026-08-05.
- Production Vercel deployment `dpl_9PcfDGNvjtWzYt38FCZ69BJy6zJH` built commit `fee03d8` in canonical project `owt-backstage`, reached `READY`, and attached `owt-backstage.vercel.app` without alias errors.

## Explicit non-actions and remaining release checks

- No production Sanity content write, migration, or PR occurred. The Git/Vercel production release completed from `main` as recorded above.
- No live authenticated roster mutation was used for verification.
- Monitor the first authenticated production use and retain the Sanity revision-history recovery procedure for real edits/swaps.
- Deferred by scope: single-service solver/local auto-fill, service-type conversion, and automatic retry from a fresh revision.
