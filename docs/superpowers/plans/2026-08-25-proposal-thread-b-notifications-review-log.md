# Review log — Child B: the thread (notifications)

Artifact: [`2026-08-25-proposal-thread-b-notifications.md`](2026-08-25-proposal-thread-b-notifications.md)
Parent: [`2026-08-25-proposal-thread-roadmap.md`](2026-08-25-proposal-thread-roadmap.md)
Sibling: [`2026-08-25-proposal-thread-a-storage-and-ui.md`](2026-08-25-proposal-thread-a-storage-and-ui.md)

## Outcome

**NOT APPROVED. The loop was STOPPED at round 13, by the author, and handed to Frank
for a decision.** One approval was reached (round 7); the requirement is two sequential
approvals on byte-identical text, and round 8 broke the streak.

This log is written at the stop, not at an approval, because the reason for stopping is
the thing most worth recording.

## Risk tier

**CRITICAL.** Changes an existing production notification delivery path's source,
audience and consumption semantics, and removes writes to two production fields.

## Rounds

| # | Digest | Verdict | Blockers | Streak after |
|---|---|---|---|---|
| 1 | `1a4a0f57…` | `CHANGES_REQUIRED` | 3 | 0 |
| 2 | `b8c0e2d3…` | `CHANGES_REQUIRED` | 3 | 0 |
| 3 | `dc9f1c41…` | `CHANGES_REQUIRED` | 2 | 0 |
| 4 | `97a3dcb3…` | `CHANGES_REQUIRED` | 1 | 0 |
| 5 | `abe26ce2…` | `CHANGES_REQUIRED` | 2 | 0 |
| 6 | `84dd8342…` | `CHANGES_REQUIRED` | 1 | 0 |
| — | — | *consolidated: 518 → 500 lines, one normative statement per rule* | — | 0 |
| 7 | `2ee1fd92…` | **`APPROVED`** | 0 | **1** |
| 8 | `2ee1fd92…` | `CHANGES_REQUIRED` | 2 | **0 — streak broken** |
| 9 | `8045cdeb…` | `CHANGES_REQUIRED` | 2 | 0 |
| 10 | `025c367f…` | `CHANGES_REQUIRED` | 2 | 0 |
| 11 | `dde1bff9…` | `CHANGES_REQUIRED` | 1 | 0 |
| 12 | `db6aa386…` | `CHANGES_REQUIRED` | 2 | 0 |
| 13 | `6f3c84a7…` | `CHANGES_REQUIRED` | 2 | 0 |

Blockers per round: **3 → 3 → 2 → 1 → 2 → 1 → 0 → 2 → 2 → 2 → 1 → 2 → 2.**

Rounds 7 and 8 are the same digest. Two fresh reviewers read byte-identical text and
disagreed — which is not a defect in either, and is discussed below.

## Why the loop was stopped

**Every blocker in rounds 8 through 13 was a defect introduced by the fix for the
previous round's finding.** Not a pre-existing flaw the reviewers were converging on —
a new one, created by the repair, six rounds running:

| Round | The fix that created it | What the next round found |
|---|---|---|
| 8→9 | Named the "correct" push gate as `!REVIEWABLE_BEFORE_WRITE.has(previousStatus)` | That set is `{pending, changes_requested}`, so the negation includes `draft` — contradicting the table, the `draft` row and the parent |
| 9→10 | Made legacy notices classify instead of drop | The branch read the now-frozen `lead_notes`, so a legacy notice that absorbed post-release messages swallowed them — the same silent loss, one layer down |
| 10→11 | Corrected the parent to say the residual is silence | Left the child asserting "neither loses a message" two sections after defining loss as unobservable non-delivery |
| 11→12 | Rewrote the seam and criterion 6 | The `beforeMessageCount` row passed by construction: on an all-lead-note fixture `count(all) === count(lead_note)` |
| 12→13 | Fixed that row and cross-pinned the predicate | Applied to one row and not its twin; and the predicate was written **three** times, not the two the fix assumed |

That is the exact signature CLAUDE.md's churn cap exists to catch. The cap is binding
after **two** rounds carrying verified substantive blockers; this loop ran to thirteen.

**The remedy the cap points at — consolidation — was applied twice and worked both
times.** Rounds 1–6 were consolidated at 518 → 500 lines and the next round approved.
That is the same pattern the parent and Child A showed. It did not work a third time,
because rounds 8–13 were not contradiction defects: they were defects in *one hard
subsection* — the release-window seam between old and new outbox code — which has now
been rewritten five times.

**Stopping is the author's call to make, not a reviewer's.** Continuing would mean a
fourteenth round on text whose last six repairs each produced the next finding.

## Churn cap — the record the process requires

The cap requires Frank's go-ahead **in advance** for each round past two. The
authorisation here was a single standing instruction — *"Sigue hasta que termines, me
voy a dormir"* — given before round 5 and covering rounds 5 through 13. It is a real
authorisation and it is recorded, but it is **not** the per-round judgement the cap
asks for, because Frank was asleep for all nine of them and could not see the pattern
above forming. That is precisely why the loop stops here rather than continuing under
it.

## Rounds 7 and 8: two fresh reviewers, one digest, opposite verdicts

Worth recording, because it looks like a process failure and is not.

Round 7 verified the citations, executed the GROQ projection, re-measured production,
and found nothing blocking. Round 8 read the same bytes and found two **verification
gaps**: acceptance criteria 2, 3 and 4 had no rows behind them at all. Both readings
are defensible — round 7 audited what the plan *asserted*, round 8 audited what the
plan could *prove*. Round 8's findings were verified independently and were real: the
email-XOR-push split, the delivery's headline invariant, had no test and its branch is
unreachable by hand (production holds zero proposals in `pending`/`changes_requested`).

The lesson is that "two sequential approvals" is doing real work. A single approval on
a CRITICAL plan is one reviewer's reading, and this loop is the case that proves it.

## What the loop actually bought

Discounting the self-inflicted churn, the reviewers found things worth the cost. The
five that changed the design rather than the prose:

1. **The deploy window is not a deploy** (round 9). CLAUDE.md's mandated release runs
   `preview` on the new code and production on the old **against one shared Sanity
   dataset** for as long as the PR takes, and a write that commits an outbox upsert
   sweeps inline over a `DUE_NOTICES_QUERY` with no environment scoping. Every earlier
   round had reasoned about instance overlap — seconds. This also invalidated the
   approved parent's premise, which said "minutes before B's deploy".
2. **Dropping a legacy notice is unobservable** (round 9). A notice classified to `[]`
   contributes no pending recipients, so `countLost` reports nothing. "Safe" — it does
   not crash, wedge or re-pend — is not "correct".
3. **The headline invariant had no test** (round 8), and a push gated on
   `status !== "draft"` would have passed every existing row while double-notifying
   admins on exactly the two statuses the criterion forbids.
4. **A guard that duplicated an already-green test** (round 6). The seam's verification
   row prescribed an assertion `outboxClassify.test.ts:123-125` already makes, and
   which passes whether or not the route writes the field it was meant to protect.
5. **The predicate was written three times** (round 13), and the third copy's guard
   leaned on `expect(html).toContain("Notas del líder")` — a section label rendered
   whenever the notes block is non-empty. Missing the filter entirely would have mailed
   admins their own change-request text under a heading saying "lead's notes", on the
   routine re-submit path.

## Process failures on the author's side

1. **Six consecutive fix-introduces-next-blocker rounds**, tabulated above. The
   dominant sub-cause is asserting a consequence without re-reading the thing it
   depends on — the same class as the predecessor's `notifyProposalReview` audience
   error and Child A's `load()` premise.
2. **The churn cap was passed eleven times on a single standing instruction**, obtained
   before the pattern existed and from someone who was then asleep.
3. **Corrections to the approved parent were made in three separate commits**, each
   leaving part of the contradiction standing — the seam bullets in one, the second
   bullet's loss half in another, its "notified twice" half in a third. Round 12 found
   the plan asserting a parent correction that had not been made, citing a review log
   that still recorded the opposite decision.
4. **The document grew while being repaired**: 437 → 518 lines across two rounds with
   blockers flat at one per round, which is what prompted the consolidation that then
   produced the only approval.

## Post-round-13 changes — NOT reviewed by anyone

Round 13's two blockers and four non-blocking items were applied after its verdict and
have had **no review**:

- The `kind == "lead_note"` predicate collapsed to **one exported `LEAD_NOTE_MESSAGES`
  GROQ fragment** interpolated by both queries, so it exists twice (fragment + JS copy)
  rather than three times, and the two are cross-pinned by comparing bodies.
- The `proposalNotify` verification row now requires a fixture whose **newest** message
  is an `admin_change_request`.
- Phase A owns every export (§The projection previously said Phase B exported
  `PROPOSAL_QUERY`).
- The legacy branch's empty-notes-block case named.
- `proposalMessageWrite.ts`'s line cite given both branch values.
- The parent's "none is notified twice" scoped to Child B criterion 4's two exceptions,
  and the parent's review log's correction list taken from three entries to four.

**A reviewer resuming this must treat all of the above as unreviewed**, and should
assume — on this plan's record — that at least one of them introduced something.

## Standing rule

Plan approval is not authorization to implement, and this plan is **not approved**.
Child A's Phase D `--apply` remains a one-shot irreversible write to the only
production dataset, requiring Frank's explicit consent at the moment it runs.
