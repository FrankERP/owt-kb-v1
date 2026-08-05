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
- Create reconciliation now requires the exact role ID returned with the echoed creation request ID; an unrelated empty role at the same target cannot satisfy readback.
- Stored swaps freeze intended post-swap semantic snapshots for every involved role and adopt readback only when all match.
- Cross-month moves retain source role identity, use the destination service's complete Sunday spine, and reconcile by role ID outside the displayed-month filter.
- Per-role integrity failures remain visible as read-only columns. Invalid local edits count as unresolved work and cannot be silently closed or saved.
- Mixed save batches reconcile successful and maintenance-only roles independently while retaining rejected edits and truthful summary copy.
