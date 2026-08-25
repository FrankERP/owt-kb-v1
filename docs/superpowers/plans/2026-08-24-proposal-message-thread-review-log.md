# Review log — Proposal message thread (R2)

Artifact: `docs/superpowers/plans/2026-08-24-proposal-message-thread.md`

**This loop has NOT terminated in an approval.** Three fresh reviewers have run;
all three returned `CHANGES_REQUIRED`. No `APPROVED` verdict exists for any
digest, so the critical tier's requirement — two sequential fresh approvals on
byte-identical text — is unsatisfied. This log is published mid-loop, against the
skill's usual "write it after the loop terminates" rule, because work has begun
on two phases and the record of *why that is defensible* must exist before it is
needed rather than after.

## Risk tier

**CRITICAL, derived from the ladder, not a judgment call.** The artifact hits
three enumerated triggers: a schema/data migration, a production mutation trust
boundary (two new writers), and a concurrency-protocol change on an existing
guarded writer.

### Tier reconciliation for Phases 0 and 1 — read this before concluding the process was skipped

Phases 0 and 1 were implemented on `feat/proposal-thread-foundation` while the
plan's status line still reads "not authorization to implement". That is
deliberate, was decided with Frank explicitly, and rests on the skill's own
instruction that *when only a slice of a spec owns the critical contract, review
that slice, not the whole spec*:

- **Phase 0 is tests only.** No runtime change of any kind.
- **Phase 1 is an unreferenced schema declaration plus two unreferenced pure
  modules.** Nothing reads or writes `messages`. A code reviewer verified this
  independently by grep across `app/`, `sanity/` and `scripts/`, and confirmed
  that every GROQ projection on `setlistProposal` in `app/` and `scripts/` is an
  explicit field list with no spread, so no read payload changed. (An earlier
  version of this log said "all six"; a later reviewer counted eight under
  `app/` alone and re-verified the conclusion. The count was wrong; the
  conclusion was not.)

Neither phase touches a critical trigger. They were therefore treated as
**standard tier**, which needs no plan-review approval at all under the
2026-08-19 retier — standard work relies on spec review plus the
post-implementation fresh code review of the diff, which is exactly what
happened (see "Implementation reviews" below).

**Phases 2, 4 and 6 remain CRITICAL and remain unapproved.** No migration, write
route, outbox change, notification change or UI may be implemented until that
slice has its two sequential fresh approvals.

## Rounds

| # | Digest reviewed | Verdict | Streak after | Reset cause |
|---|---|---|---|---|
| 1 | `64c70db1…` | `CHANGES_REQUIRED` | 0 | 3 verified blockers |
| 2 | `afa828f5…` | `CHANGES_REQUIRED` | 0 | 2 verified blockers |
| — | — | *churn cap reached; escalated to Frank; artifact restructured rather than re-reviewed* | 0 | — |
| 3 | `3098a4a0…` | `CHANGES_REQUIRED` | 0 | 3 verified blockers |
| — | — | *third substantive round; escalated to Frank again; F0–F1 implementation authorized as standard tier* | 0 | — |

Current canonical digest is later than `3098a4a0…` and has never been reviewed.

## Round 1 — blockers

| Blocker | Disposition | Evidence actually checked |
|---|---|---|
| Bare Sanity `insert` with no `setIfMissing({messages: []})` breaks the first message on any proposal with no array, and fails the `request_changes` transaction outright | **fixed** | Read `node_modules/@sanity/client/README.md:1213-1218` ("Ensure that the `reviews` array exists…") and `app/api/me/push-token/route.ts:20-23`, the repo's only array-append precedent, which does `setIfMissing({deviceTokens: []}).append(...)`. Confirmed by grep that no other append site exists. |
| The rewritten `leadNotes` outbox notice can never queue — its only caller never appends messages | **fixed** | `grep` for `queueLeadNotesNotice` returns exactly one non-test caller, `app/api/me/proposals/route.ts:311`, passing `afterNotes: request.leadNotes`, which the plan's own Phase 5 removes. |
| Migration's array-emptiness skip guard strands legacy history on documents written to between the write-path deploy and the `--apply` | **fixed** | Internal to the plan: its Phase 2 dual-write rationale and "every phase boundary is independently deployable" establish the window. Later resolved *structurally* by moving the migration ahead of every write path. |

**Non-blocking:** 6 adopted (empty-`reopen` guard, stale composer prefill,
timestamp rule, `sanity:deploy-schema` is a skill not an npm script,
`loadCanonicalProposal` on the new routes, restating to Frank that R2 ships no
read marks). **1 declined on evidence:** adding `messages` to `PROTECTED_FIELDS`
— checked `app/utils/protectedReadAudit.ts:729`, which builds a word-boundary
regex over the raw names, and `:34-38`, whose comment says the list
"Intentionally excludes ambiguous fields … so the signal stays specific".
`messages` is a generic identifier; adding it contradicts the module's own
design. Round 3's reviewer independently reached the same conclusion.

## Round 2 — blockers

| Blocker | Disposition | Evidence actually checked |
|---|---|---|
| Moving `queueLeadNotesNotice` into Phase 2 *created* the window it claimed to close, and Phase 2 could not typecheck | **fixed** | Read `serviceMutationSideEffects.ts:614-624` — the input still declares `beforeNotes`/`afterNotes`, so a P2 caller passing a count fails `tsc`. Read `outboxSweep.ts:388` — the classifier reads `notice.before?.beforeNotes ?? ""` and diffs against live `lead_notes`, non-empty on 7 of 14 production proposals, so the reverse ordering mass-mails admins. |
| An admin-authored message reaches the lead through no channel at all | **fixed** | `grep notifyProposalReview` → called only from the two transition branches (`app/api/admin/proposals/[id]/route.ts:379`, `:532`). Read `ProposalEditor.tsx:446-450`, the `Comentarios del admin` banner the cutover deletes. |

The reviewer also **re-measured the production dataset independently** and
confirmed every figure in the plan exact, and checked something the plan had not:
that no migration reference dangles.

## Round 3 — blockers

| Blocker | Disposition | Evidence actually checked |
|---|---|---|
| Posting a message bumps `setlistProposal._rev`; neither the response shape nor the client wiring refreshes it, so the next admin action 409s and the lead cannot save | **fixed** | Read `ProposalsPanel.tsx:492` (submits `rev: proposal._rev` from the cached prop) and `:508` (`load()` only after success); `ProposalEditor.tsx:162-163`, `:346`, `:369` (rev held in state, sent as `observed`, refreshed only from a save response); `app/api/me/proposals/route.ts:320-328`, which already returns a fresh `_rev` — the pattern existed and the plan had not used it. |
| The Phase 3 `--apply` snapshot drifts unreconciled while production keeps writing the legacy fields through the remaining phases | **fixed** | Read `app/api/me/proposals/route.ts:232`, `:263` and `app/api/admin/proposals/[id]/route.ts:500` — all still writing the legacy fields until the cutover ships. Resolved by moving `--apply` to minutes before the release. |
| §5's whole-array `set` plus a `_key`-only skip contradicted each other; followed literally the script erases a live thread, and the Verification table *mandated* that behaviour | **fixed** | Read the plan's own two bullets at `:320` and `:326`. Confirmed they cannot both hold. |

**Non-blocking adopted:** one predicate for both halves of the count-and-slice,
`OPERATOR_TOOLING_ALLOWLIST` registration moved into the phase that creates the
script, the e2e deployability caveat stated, the `preview`-walkthrough data
residue named.

## Process failures on the author's side

Recorded because a log containing only reviewer findings hides the half of the
record most worth keeping.

1. **Two of the eight blockers were introduced by the author while fixing
   earlier ones.** Round 2's blocker 1 was created by round 1's fix; round 3's
   blocker 3 was created by the restructure. This is the substantive signal from
   the loop: this subsystem couples `_rev` as authorization token, concurrency
   snapshot and `observed` guard simultaneously, and each edit to one edge moved
   another.
2. **The churn cap was reached at round 2 and again at round 3.** Both times the
   loop stopped and Frank's go-ahead was obtained *in advance*, with the defect
   class logged to `.agents/log/worklog.jsonl` before anything further was
   dispatched. The cap was not passed silently.
3. **This log was missing** until the code review of the foundation branch
   flagged it. CLAUDE.md requires a committed review log for every completed
   review; three rounds had run without one.
4. **The plan's own status metadata went stale** — it named the wrong branch and
   did not mark Phases 0/1 as shipped while they were being implemented.

## Implementation reviews (separate from plan review)

Plan approval is not authorization to implement, and a diff review is not a plan
review. Phases 0–1 received their own fresh code review of the diff, which
returned 5 findings, all resolved:

- an intransitive `orderedMessages` comparator that scrambled valid messages —
  reproduced independently on a 40-element probe before accepting, then fixed by
  partition and verified red in both directions;
- a green test that **asserted the bug**, corrected to the contract's answer;
- `proposalMessageWrite` value-importing a `node:crypto` module, extracted to a
  dependency-free leaf per the `normalizeLabel.ts:17-24` precedent;
- frozen digests that never exercised NFC — verified by deleting
  `.normalize("NFC")` and watching 4150 tests stay green, then fixed with a
  decomposed-accent fixture that fails without it;
- this log and the plan's stale metadata.

## Standing rule

**Approval is not authorization to implement, and no approval exists.** Phases 2,
4 and 6 require the critical tier's two sequential fresh approvals on
byte-identical text before any of their code is written. Each implemented phase
additionally requires its own fresh code review of the diff plus the documented
gates.
