# Review log — outbox re-pend design

Companion to [`2026-08-28-outbox-repend-design.md`](2026-08-28-outbox-repend-design.md),
written after the loop and never shown to a reviewer. Risk tier **CRITICAL**
(production writer's delivery and consumption behaviour), so the bar was two
sequential fresh `APPROVED` verdicts on byte-identical text. **That bar was never
met.** The design was abandoned and the decision recorded in
[ADR-0026](../../adr/0026-failed-sends-are-not-re-pended.md).

Three rounds ran, each with a fresh `skeptical-reviewer` given no knowledge of
prior rounds. **10 blockers total: 5, then 2, then 3.**

## Round 1 — first design (per-notice backoff + `deadline` bound)

Digest `fd19ae93…`. Verdict **CHANGES_REQUIRED**, 5 blockers. All five verified
against source by the coordinator before acceptance; none disputed.

| # | Blocker | Disposition |
|---|---|---|
| 1 | `ECONNECTION` is nodemailer's *"connection closed unexpectedly"*, can follow a fully-written DATA payload, and can carry a 4xx — so "retry on 4xx" could re-send delivered mail | **Accepted.** Rule changed to exclude connection-close explicitly; the "duplicates are structurally impossible" claim replaced with the weaker one the code supports |
| 2 | `deferred` already existed (due-but-unclaimed) and `aggregateFlushReports` takes it from the last round only, so the new counter would serialize as 0 over an undelivered wave | **Accepted.** Renamed `throttled`, specified as summed |
| 3 | The `deadline` bound destroyed budget-tail recipients, against `SECRETS.md`'s documented guarantee and the spec's own non-goal | **Accepted.** Bound scoped to throttled recipients only |
| 4 | Unspecified `partitionClaimed` branch order would re-ship a known silent-destruction bug | **Accepted.** Order pinned in the spec, test specified |
| 5 | Moving "email disabled" to `skipped` removed the only red alarm for a missing credential | **Accepted.** Reverted; stays terminal |

## Round 2 — revised first design

Digest `091f9ca5…`. Verdict **CHANGES_REQUIRED**, 2 blockers. This round
independently **verified the two central safety properties** — that no
4xx-carrying error can follow an accepted message except `ECONNECTION`, which the
rule excludes; and that termination holds because `deadline` is immutable across
edits. Both blockers had one root.

| # | Blocker | Disposition |
|---|---|---|
| 1 | A notice can carry BOTH throttled and budget-tail recipients — the repo already documents this correlated case — while `RependInput` is per notice, so one `notifyAfter` cannot serve both. Backing off stalls pagination; not backing off storms the server | **Accepted, and fatal to the approach.** Not patched — the design was replaced |
| 2 | `lost` cannot count deadline-abandoned recipients on a re-pended notice (`countLost` iterates `toConsume` only), so the abandonment would read green | **Accepted**, same root |

Churn cap reached here: two rounds with verified substantive blockers, which
`CLAUDE.md` says requires Frank's explicit advance go-ahead for a third. He was
asked and chose to **simplify** rather than iterate — the remedy the cap points
at. Round 3 below is therefore round 1 of a *different* design, not a third round
on this one, which is how the worklog labels it. Both framings appear in this
cycle's records; this is the reconciliation. No separate go-ahead for "round 3 of
the original" was sought, because that round never ran.

## Round 3 — simplified design (per-sweep circuit breaker)

Digest `27a67cbb…`. Verdict **CHANGES_REQUIRED**, 3 blockers.

| # | Blocker | Disposition |
|---|---|---|
| 1 | A persistently-4xx recipient (Gmail refuses per-recipient at `RCPT TO`) re-pends forever, sorts first by `firstQueuedAt asc`, trips the breaker in wave 1 of every sweep, and holds the liveness alarm red forever — the state `outboxSweep.ts:32-34` declares must be impossible | **Accepted. Design abandoned.** The invariant had never been read across three revisions; it also predicts the whole approach, naming delivery receipts, an attempt counter and a dead-letter path, and calling a half-build worse than nothing |
| 2 | The advertised pacing bound was wrong by a factor of `SEND_CONCURRENCY`, and it was the sole basis for declining cross-invocation pacing | **Accepted**, moot once abandoned |
| 3 | The top risk's mitigation rested on "every other 4xx-carrying state is pre-DATA", refuted by `EMESSAGE` — which the spec's own §1 already conceded | **Accepted**, moot once abandoned |

Round 3 also **refuted a coordinator claim** carried since round 1: that
`smtp-pool` may already have retried a mid-send close. It cannot — the error
callback clears `queueEntry` before the requeue path runs. Corrected rather than
left standing.

## Outcome

No `APPROVED` verdict was ever issued. The spec is marked **rejected** and kept
only for its nodemailer classification analysis (§1), which survived all three
rounds intact. The decision, and what a correct implementation would actually
require, are in ADR-0026.

**What the loop was worth.** Round 1 caught a duplicate-mail defect that would
have reached real people. Round 3 caught an invariant three revisions had walked
past — stated in the header of the very file being changed. Plan review found
what plan review is good at: contradictions with recorded decisions. It took
three rounds because the coordinator kept correcting one copy of a claim and
leaving the second standing.
