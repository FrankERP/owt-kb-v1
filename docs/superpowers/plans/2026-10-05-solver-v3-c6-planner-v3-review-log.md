# Review log — `2026-10-05-solver-v3-c6-planner-v3.md` (the confirm slice, Tasks 17–19)

Written after the loop ended; never shown to a reviewer. **Approval is not authorization to
implement.** Implementation still needs: C1, C3, C2 and C5 on `main`; the plan's Task 0 entry gate
(Frank has read the C6 spec's §5.11 confirm protocol and §7 copy, or explicitly waived it); per-task
reviews; the gates; and a fresh code review of the diff before any merge to `main`.

## Tier

**Critical for Tasks 17–19 only**, derived from the ladder and from the C6 spec's own §15: §5.11 (U4)
orders writes to a new production writer (C2's `PUT /api/admin/fairness/months`, all-or-nothing) and
to the service-create route, and owns partial-failure recovery. The rest of the plan is standard and
relies on the per-task and final code reviews. Reviewers were pointed at Tasks 17–19 plus the §4 state
table, C2 IF2-4/5/6/21 and WR-7/8/9, and parent A5/A6/A27/A40; the rest of the plan was context.

## Rounds

| Round | Digest (plan file) | Commit | Verdict | Streak | Notes |
|---|---|---|---|---|---|
| 1 | `9513e44a…` | 6732ba30 | CHANGES_REQUIRED (substantive) | 0 | 1 blocker, fixed |
| 2 | `37746462…` | (uncommitted fix of r1) | CHANGES_REQUIRED (substantive) | 0 | 1 blocker, fixed → committed 42a13df1. **Churn cap reached.** |
| — | — | — | — | — | Frank's go-ahead for round 3+ (2026-10-06 ~13:40 CST, AskUserQuestion: «Sí, sigue (Recomendado)»), obtained before round 3 |
| 3 (void) | `2b21ab09…` | 42a13df1 | no verdict | 0 | reviewer stalled 6× twice (machine load > 100, API stalls); snapshot kept as `round-3-void-2b21ab09.md` |
| — | — | — | — | — | Ruling: replay the plan before round 3 (execution catches fixture/anchor defects more cheaply; any replay edit to 17–19 would reset credit anyway) |
| 3 | `1579b20c…` | 76b9ef41 | APPROVED | 1 | after replay + amendments; Tasks 17–19 had only non-behavioural edits |
| 4 | `1579b20c…` | 76b9ef41 | APPROVED | 2 | same bytes — **approved twice** |

Approved digest: `1579b20cc3fb972c584c8e94b3f71b39d5e07ce1d3a6e8c7e32df1ed1ef51687` (plan file at
76b9ef41). The private ledger is in `owt-agent-logs/sdd/2026-10-05-solver-v3-c6-planner-v3/review/`.

## Blockers and dispositions (rounds 1–2)

### Round 1 — `9513e44a7871…` — CHANGES_REQUIRED (substantive: True)

Defect class: An exit-confirmation dialog wired into only one branch of a component whose other branch is an early return, so shared-state handlers (Escape, Cancelar, discard-close) fire where the dialog is not mounted, or skip it entirely.
- **Blocker (fixed).** CF-10 is wired to only one exit path. The V3IncompleteDialog is mounted only inside the grid-step footer, but the config step is an early return whose «Cancelar» is a bare onClick={onClose}. So «← Volver» → «Cancelar» leaves with gaps and no prompt. Escape at the config step sets incompleteOpen with no dialog mounted, which then pops up on the next «Previsualizar». v3Gaps is also not keyed by horizon.
  - Evidence checked: Verified at c2-t10:app/components/admin/MonthGenerator.tsx. `if (step === "config") return (` is at 4410 and is the only occurrence. The config «Cancelar» at 4515 is `onClick={onClose}`, and its Find line occurs once. The Escape effect (2597-2613) sits above both returns. The plan's old Step 6 mounted the dialog only in the grid footer.

Fix in Task 19 Step 6:
- `incompleteDialog` is built once, just before the config early return, as `isV3 ? <V3IncompleteDialog open={incompleteOpen} …/> : null`. It is rendered in both branches: first child of the config `space-y-5` div, and after the grid footer ternary.
- The config «Cancelar» is gated on `v3HasGaps`, as are the grid «Cancelar» and Escape.
- I found and gated one more exit the reviewer did not list: `confirmPendingDiscard`'s «Cerrar de todos modos».
- `v3HasGaps` (inserted above `closeWouldDiscard`, c2-t10:2593) comes after the `v3Gaps` declaration. That declaration chains after Task 14's anchor at c2-t10:2025, so there is no TDZ.

On the reviewer's suggestion to key or clear v3Gaps by horizon: I deliberately did not. Doing so would let Volver → change month → «Cancelar» leave November's real gaps unprompted, which dilutes CF-10 («closing with gaps»). Instead, v3Gaps is session-wide by month and merged per attempt; a completed month leaves the list, and an Auto clears nothing because it writes nothing. The report lines are what I keyed: `v3Report {key, lines}`, shown only for their own horizon, like the retry button. Both choices are recorded as a Plan decisions row.

Tests added to Task 19 Step 1:
- Grid «Cancelar»: «Seguir aquí» stays, Escape asks, «Salir así» calls onClose once.
- Config step: «← Volver» then «Cancelar» opens the dialog, and so does Escape there.
- No stale open dialog on the next «Previsualizar», and the gap still asks from the grid.

The coverage row for CF-10 is updated.

Non-blocking:
- adopted: Auto is not locked while a confirm is in flight, so a late afterV3Attempt can put the old session (recordsDone: true) back over a new run. — Real CF-2/CF-7 hole. Task 19 Step 4 adds a Find/Replace in Task 15's handleAutoV3: `if (pushing) return;`. The confirm's finally block and its bookkeeping run in the same tick, so no window is left. v2's handleAuto is untouched. There is no component test: routeFetch answers synchronously, so a slow PUT cannot be scripted. MonthGenerator.v3Auto.test.tsx was added to Step 7's run list.
- adopted: confirmV3's outer catch shows «…No se creó nada; pulsa «Reintentar».» but sets no retry, and the text would be false if afterV3Attempt threw after drafts landed. — Rewrote confirmV3 so afterV3Attempt runs after try/finally, in the same order as today's handleConfirm. The catch keeps the session retryable, which is always safe: the PUT replays byte-identical and answers `unchanged` (WR-8 row 1), and each draft keeps its creationRequestId. It shows «No se creó nada» only when no draft of this confirm can exist (posted === 0 and no earlier creations). Otherwise it shows pessimistic CF-6 lines built with Task 18's now-exported progressFrom and merges the gaps. If no session exists yet (only the fresh read came before), it shows the read-failure line.
- adopted: CF-2 'edit pools after Auto' is untested (only the frozen rev is asserted). — This is the spec's named acceptance for a critical row. Added a component test: Auto → «← Volver» → «Volver de todos modos» → drop Bruno from «Líderes Domingo» → Previsualizar → Crear. It asserts the PUT entry's m-bruno Sun.Lead equals resolveMonthSources under the solved config. It also asserts that value differs from the edited config's, so the test can actually tell the two apart. Removed the coverage-gaps sentence that claimed no such path exists.
- adopted: CF-10's «Salir así» path is untested (the test named for it clicks «Seguir aquí»). — Both new CF-10 tests click «Salir así» and assert onClose is called once.
- declined: CF-9 'none for a specials-only month' is untested. — The v3 history filter is today's P1 second lock (`d._type !== "special_role"`), copied verbatim and already proven under v2 by today's create suite. A v3 component test would need that suite's non-exported special-composer helpers working under Task 14's stacked calendars. Stated as a coverage gap with the condition for adding it at replay.
- adopted: KH-1 name-shaped fixture through the confirm path. — Added a v3Confirm.test.ts case. Entries carry a name-shaped presence ruleKey, and 409/400 bodies carry every NAME_SHAPED_KEYS entry in message/details. Every line the confirm can render — each refusal, the other-failure line, both past lines, ceiling, month report, two-month summary, incompleteBody, retry — contains none of the keys. The KH-1 coverage row now cites it.
- adopted: Round-trip test could also prove WR-3 acceptance via validateFairnessMonthWrite. — Verified the export and signature `validateFairnessMonthWrite(body, actor, currentMonth)`, and that ROUTE_FIELDS = month/source/expectedRev/people/presence (c2-t10:fairnessMonthWriteRequest.ts:158,172). Added the assertion and import, and listed it under Task 17's test-only interfaces. Test files are exempt from the importer pin.
- adopted: A guard refusal on a retry after records landed but every draft failed lacks CF-6's per-month lines. — Task 18's executor now adds the per-month lines whenever `state.recordsDone`, matching the spec's failure-table row. The «nada más» variant stays gated on created drafts. Added a v3ConfirmRun.test.ts case for recordsDone with no creations at the boundary, asserting the exact three lines.
- declined: The no-Auto confirm reuses Auto's copy (ledgerFailed, «No se puede correr Auto: …»). — Spec §7.8 has no confirm-path row for a failed fresh read or a resolver refusal. Inventing copy would exceed the plan's remit, and the plan may not edit the spec. Listed as a spec change needed.
- adopted: The v2 surface changes: a space-y-2 wrapper and a closed V3IncompleteDialog mount. — The footer wrapper is now a fragment (no element). incompleteDialog is null under v2, and both v3 line blocks render nothing under v2, so the v2 footer DOM is today's.
- adopted: The frozen-entries ref has one slot, so H1 → H2 → back to H1 takes the no-Auto path. — CF-2 says «if no v3 Auto ran for this horizon in this session». v3EntriesRef is now a Map keyed by horizon. A stale frozen rev is refused by the writer (WR-15) with «vuelve a correr Auto». Recorded as a Plan decisions row.
- declined: Per-month history (CF-9) can shrink if the stored-source refresh drops planned columns before a retry. — It affects only the localStorage rollback copy, retired with D3. CF-9 requires the entry to be built «exactly as today», and today's v2 builds it from the same `drafts` filter. The runtime premise (that the refresh drops columns) is unverified, per the reviewer.
- adopted: `record` is imported but unused in the Task 17 test, raising the eslint warning count. — Confirmed: Task 17's test imports `record` and never uses it; the use at the old 9013 is in Task 19's test. Removed it from Task 17's import.

Sibling changes noted:
- C6 spec §7.8 (the contract; not edited here): add confirm-path rows for CF-2's no-Auto path — a failed fresh GET /api/admin/fairness read, and an ok:false resolver refusal. The plan currently reuses §7.6's ledgerFailed («…Auto no corrió…») and §7.9's «No se puede correr Auto: …» prefix on a confirm where Auto never ran.

### Round 2 — `37746462b84a…` — CHANGES_REQUIRED (substantive: True)

Defect class: A test fixture that contradicts the validator it exercises: an exact rule on a role whose status is not exact, in the critical acceptance test. Also a one-way concurrency lock between Auto and confirm.
- **Blocker (fixed).** The CF-3 round-trip test (Task 17 Step 1) gives m-bruno an exact Sun.Lead rule while Sun.Lead stays "in" through ALL_IN, so validateFairnessMonthWrite returns ok:false and the critical slice's acceptance test cannot pass as written.
  - Evidence checked: Confirmed. c2-t10:app/utils/fairnessMonthWriteRequest.ts:277-278 adds MSG.notExact when an exact rule lists a role whose status is not "exact". ALL_IN (plan :2816) sets every role to "in". buildFairnessMonthDocument and parseStoredFairnessMonth do not cross-check this, so only the final assertion fails. The reviewer's framing holds: it is a fixture defect, not a design flaw. Fix at plan :8296: roles are now { ...ALL_IN, "Sun.Lead": "exact", "Sat.Lead": "out" }, with a one-line comment. I re-checked the rest of the fixture against the same validator. exactUnlisted is now satisfied. The rule key r-ana-bruno matches RULE_KEY_RE. Both presence members are listed. The block date falls inside the month, and an unavailable block with no excluded roles is legal. m-ana's alternate cadence has no exact Sun.Lead rule. Nothing ties exempt to exactRules. Plan :5009 already uses "exact". Plan :4049 and :4100 go through the resolver and never reach this validator.

Non-blocking:
- adopted: The Auto/confirm lock only works one way: a confirm can start while an Auto is pending — Confirmed. The Crear buttons were disabled only on pushing || toCreate.length === 0 || gateBlocked (e358781d MonthGenerator.tsx:5166/5169). Five changes. (1) confirmV3 now begins with `if (autoPending) return;`. (2) Both Crear buttons are disabled on `pushing || (isV3 && autoPending) || …`, so v2 behaves exactly as today. This needed a new Find/Replace line for «Crear N borradores»; that line is unique in the source and no other task touches it. (3) «Reintentar» is disabled on `pushing || autoPending`. (4) The handleAutoV3 comment now describes a two-way lock instead of claiming "no gap", and the Task 19 Files line was updated to match. (5) A new Task 19 component test holds the solve open with a gated fetch stub, asserts both Crear buttons are disabled and no PUT or POST goes out, then releases the solve and confirms that exactly one PUT and one POST follow.
- declined: A full success under one horizon closes the planner even when an earlier horizon's attempt left gaps — Spec CF-10 says "Full success closes as today". Asking here would add a behaviour CF-10 does not name, and it would need a synchronous gap merge in the critical afterV3Attempt. The existing test harness also has no way to change the month to exercise it. I recorded the asymmetry with «Cancelar»/Escape in the afterV3Attempt comment, with the November/December example, as a deliberate spec-literal choice. If the spec owner wants success to ask, that is a CF-10 wording change.
- adopted: No-Auto sessions stay pinned after a refusal, and Crear repeats the refusal as a de facto retry — This is behaviour the spec mandates («vuelve a correr Auto»), so I added documentation, not code: a comment in confirmV3 explains that the session and its frozen entries outlive every refusal, and that only a new v3 Auto or closing the planner leaves it.
- declined: Out-of-horizon drafts would be dropped silently (proposed assertion) — This cannot happen by construction. Columns are built from the horizon, and trailingSaturday returns only same-month dates (plannerModel.ts:581-586); the reviewer confirmed both. An assertion would need a refusal line that §7.8 does not define, and the plan does not invent copy. It would also add a new refusal branch to the critical executor for a state that cannot occur.
- adopted: On the confirm-without-Auto path, the copy says "Auto" (ledgerFailed and resolver refusals) — Adopted as documentation only. The plan invents no line, because §7.8 is the source of every confirm string. A comment on freezeEntriesWithoutAuto records that these reuse Auto's lines and that this is a spec gap; it is listed in sibling_changes_needed.
- adopted: Lint: unused unprefixed parameters in the Task 18 test raise no-unused-vars warnings above the baseline — eslint.config.mjs ignores args matching ^_. The only unused parameter was `body` in attempt()'s default postDraft (plan :8649), now `_body`. I swept Tasks 17-19's test code: every other `body`/`b`/`r`/`m`/`n` parameter is used, and `partialFailure` already uses `_b`.

Sibling changes noted:
- C6 spec §7.8 (docs/superpowers/specs/2026-10-05-solver-v3-c6-planner-v3-design.md): define confirm-side wording for a failed fresh ledger read and for resolver refusals on CF-2's no-Auto path. Today the plan reuses Auto's lines, V3_ROUTE_COPY.ledgerFailed («… Auto no corrió …») and «No se puede correr Auto: …». Spec owner's decision; the plan was not changed beyond a comment.
- C6 spec CF-10 (optional): if success under one horizon should ask when another horizon's gaps remain, CF-10's "Full success closes as today" needs rewording; the plan follows the current text.
- Note for the coordinator: git diff now also shows docs/superpowers/plans/2026-10-05-solver-v3-c4-record-reconstruction.md as modified. That file was not touched in this round; another session appears to be editing it concurrently.

## Changes between round 2 and round 3 (replay)

The plan was executed task by task on C2 `0aa33514` + C5 `e3086f77` (replay base `4c50309b`) and
re-applied mechanically to a second clean clone (494 files / 8981 tests at the end). In Tasks 17–19
the replay changed only: Task 19 Step 4's import instruction became two Find/Replace pairs; Task 19
Step 1's «CONFIG step asks too» test waits for «Previsualizar» after the dialog's aria-hidden frame (a
flake fix); Task 19 Step 5's «Before X, insert» became a Find/Replace (the old wording would have
duplicated the anchor line). Outside the slice: provisional anchors verified, ADR numbers fixed at
0051/0052, an EQ-6 phone-width test, the spec-status wording and entry gate, the OWT_SOLVER_V3_URL
entry in the house style, and Frank's 2026-10-07 copy correction (cadence strings name Sunday lead
instead of «descansa»).

## Non-blocking items from the approving rounds (3 and 4)

None was adopted into the approved bytes; all are **deferred to implementation** and copied into the
C6 SDD global constraints (`owt-agent-logs/sdd/2026-10-05-solver-v3-c6-planner-v3/review-followups.md`)
so the task reviewers check them against the code:

1. Two-way lock gap: Auto's «Reintentar» keeps a stale `handleAuto` closure and is not disabled while
   `pushing`; pressed during a confirm it can restore an old session (`recordsDone: true`) over a new
   run. Not a data hazard (same config/members), but disable Auto «Reintentar» and «Auto-asignar»
   while `pushing` under v3, or call the latest handler through a ref, and test that half of the lock.
2. `V3ConfirmSession.publish` is fixed at the first attempt; a later attempt with the other button
   reuses it. Disable the other button once a session exists, or use the pressed button.
3. `HORIZON_MONTHS_AHEAD = 12` duplicates C2's `RECORD_LIMITS.monthsAhead`; import it or add a sync test.
4. `draftsByMonth` / `runV3ConfirmAttempt` silently drop drafts outside the horizon months (unreachable
   under HZ-2/HZ-3); a one-line refusal makes the critical module self-defending.
5. A failed Auto still replaces the frozen entries (CF-2 «frozen when the run's request is built");
   the writer's revision check keeps it safe; record `source: "auto"` semantics in the code comment.
6. «Reintentar (0 pendientes)» after a draft 409 exits silently — UX wart.
7. A 403 on the PUT is «other failure» and offers «Reintentar» (same as v2's draft POST).
8. The no-Auto path's `exactLeadLabel: () => null` names «regla fija»; its failed-read/resolver lines
   say «Auto no corrió» (already recorded as a spec gap for §7.8).
9. After a refusal with no «Reintentar», stale frozen entries persist until a new Auto or close; the
   copy does not say that reopening is the exit when Auto itself cannot run.
10. Coverage: CF-9 «none for a specials-only month» untested (declined with rationale in the plan);
    CF-1 «anchored, unrecorded month gets drafts and a create entry» tested at entry-shape level only.
11. Full success closes even when another horizon's months still have gaps (disclosed by the plan;
    follows CF-10's current wording).

## Process failures on the author's side

- **Churn cap reached at round 2.** Logged as a coordinator-inline worklog entry naming the defect
  classes (an exit dialog wired into only one branch of an early-return component; a test fixture
  contradicting the validator it exercises), and Frank's go-ahead was obtained **before** round 3.
- **Round 3 stalled twice with no verdict** under a machine load spike (load average > 100, swap
  nearly full). The void snapshot is kept; no verdict from it was counted.
- **The replay was inserted between rounds** by the author's ruling, not by the skill's procedure; it
  changed the reviewed bytes (non-behaviourally in 17–19), so round 3 reviewed the replayed text
  from a zero streak.
- Round 1's fixer adopted several non-blocking items into the plan mid-loop (allowed: they were
  reviewed by rounds 2–4 afterwards).

## Post-approval changes (un-reviewed)

None. The plan file still hashes to `1579b20c…` at the time this log was written.
