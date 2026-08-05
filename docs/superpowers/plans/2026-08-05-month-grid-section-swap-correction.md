# Month-grid section swap correction

**Requirement (verbatim):** “the button to swap whole assignations from day is corrects, but the second sections seems useless because it's a change of one person by another person. What I meant with chaning a whole ‘section’ was that I can swap for example everyone on BGV on Aug-2 with everyone on BGV on Aug-9”

**Risk tier:** Critical. This extends the production swap writer with a new full-array mutation shape, so it requires two sequential cold approvals on byte-identical plan text.

**Review outcome:** The loop stopped at the policy churn cap. One corrected digest received a cold approval; the next independent review found two additional verified blockers (exact ordered readback identity and overlapping mutation initiators). Per the user's standing direction not to spend the implementation budget in an endless loop, those blockers were incorporated and the plan moved to implementation without claiming the formal two-approval threshold.

## Outcome and scope

Replace the stored editor's individual-person swap panel with an atomic section swap. An admin chooses one section (`Lead`, `BGVs`, `Chorus`, `instruments`, or `foh_team`) and two distinct stored services; the complete selected array from each service exchanges with the other. Whole-team/date-column swapping remains unchanged. The individual-seat API shape remains accepted for compatibility but has no month-grid UI entry.

## Mutation contract

1. Extend `parseSwapRequest` with `{ kind: "section", path, roles: [{ id, rev }, { id, rev }] }`. Accept only the five canonical seat paths and two distinct canonical role IDs with observed revisions. Ignore no client-supplied assignments because none are accepted.
2. In `/api/admin/roles/swap`, load both current stored roles under those revisions, retain draft-overlay/coordination admission, and derive both replacement arrays exclusively from stored server state.
3. Exchange exactly the selected stored array in one revision-guarded Sanity transaction. Entire items travel unchanged, including `_key`, `_type`, labels, references, order, emptiness, and differing cardinality. Do not set identity, date, service name, publication, songs, notes, or any of the other four seat arrays.
4. Allow shared sections across service types. Refuse `Chorus` when either role is Saturday, and retain the existing hidden-Saturday-Chorus fail-closed check. Whole-team topology rules do not change.
5. Resolve every member reference in the two selected arrays before coordination; reject dangling references before writing. Compute each role's before/after notification state pre-commit by replacing only the selected array, then retain the existing post-commit revalidation, push, and outbox behavior.
6. Preserve existing conflict and unknown-outcome semantics: both role revisions and owned coordination tokens are asserted atomically; any conflict writes neither side and returns the existing typed failure.

## Client contract

1. Replace the two per-person selectors with `Sección`, `Primer servicio`, and `Segundo servicio`; use Spanish section labels and service dates/names. Only integrity-approved stored columns are selectable. Require one section and two different services; disable/refuse Saturday + `Coro` with explicit Spanish copy.
2. Submit only `{ kind: "section", path, roles }`. Freeze the exact body and intended complete semantic snapshots before sending. Also freeze a section-specific ordered fingerprint for each destination from the partner's current canonical role: stable item key, member ID, and instrument/FOH label where applicable. Server route tests pin stored `_type` preservation; the admin read projection does not expose item `_type`.
3. Build intended snapshots by exchanging every grid cell belonging to the selected section between the two role IDs: one voice row for Lead/BGV/Coro, all `instrumento:*` rows for instruments, and all `foh:*` rows for FOH. Absence and unequal array lengths must transfer correctly. Reload verification requires both the complete semantic snapshots and exact ordered selected-section fingerprints to match; equal member sets with different keys, order, or labels remain unresolved. Never automatically retry an unknown outcome.
4. Reset the three selections only after a known-success response; retain them on typed refusal or unknown outcome so the requested intent remains visible.
5. Treat the full request-plus-reconciliation window as a single stored-grid mutation lock. Cell edits, date/name edits, instrument/FOH row add/remove, save/create actions, both clicks of whole-team selection, section selectors, and the section action must all refuse changes while `savingStored`, a swap verification, a pending save, or create reconciliation is active. Controls must expose the locked state rather than accepting an edit that the verified reload would overwrite; one swap may never overwrite the pending expectation for another.
6. Active stored transport hard-blocks Close and Escape so the component cannot unmount and lose its frozen intent before the outcome is known. An added/removed empty instrument or FOH row counts as unresolved local work and blocks swaps until reverted or populated; a verified reload may not silently erase row-layout preparation.

## Verification

- Parser tests: accept the exact section shape; reject unknown paths, duplicate roles, malformed IDs/revisions, replacement arrays, and extra mutation shapes.
- Writer tests: BGV arrays with unequal sizes/keys exchange exactly; only `BGVs` is patched; shared-section cross-type succeeds; Saturday Chorus refuses before transaction; dangling refs, stale revisions, draft overlays, bootstrap, atomic conflicts, notifications, and no-op unrelated fields remain pinned.
- Client tests: selecting BGV plus August 2/August 9 sends the section request; intended readback expects all BGV occupants exchanged; instruments/FOH move every related row including source-only labels; dirty/unresolved state and invalid Saturday Chorus disable the action; the old `Intercambiar puestos` UI is absent; whole-team swap tests remain green. A mutation-discriminating readback must keep verification pending when memberships match but ordered keys/labels do not. A deferred fetch must prove that cell, header, row, whole-team, and second section-swap mutations cannot be accepted during transport/reconciliation and therefore cannot be silently discarded or overwrite the pending expectation.
- Run focused parser/writer/client tests, mutation-discriminating regressions, then `npx tsc --noEmit`, `npm test`, `npx eslint .`, and `git diff --check`. After implementation, run a fresh code review and deploy only by merging the feature branch into `preview`.
- Push `preview`, then verify the canonical Vercel project built the exact pushed preview commit, reached `READY`, and attached `dev-owt-backstage.vercel.app` before reporting delivery.

## Non-goals

- No Sanity migration or direct content write.
- No section copy, partial-row selection, cross-section swap, service identity/date swap, retry-from-new-revision, or changes to whole-team swapping.
