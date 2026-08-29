# ADR-0026: A failed send is not re-pended; consumption stays unconditional

**Date:** 2026-08-28 · **Status:** Accepted

## Context

`sweepOutbox` stage 8 consumes every notice stage 3 claimed, so a recipient whose
send **failed** is deleted along with the notice. The notification is destroyed.
The 2026-07-27 design spec §1 names this the "different outbox model" that must
be **designed rather than discovered**, and `docs/NOTIFICATIONS.md` carried it as
an open gap.

It was designed, in August 2026: three revisions and three adversarial review
rounds, which reported **5, 2 and 3 blockers** in that order. All three revisions
were rejected. Per-round dispositions are in the review log beside the spec. This record exists so
the next person does not spend the same week rediscovering why — the obvious fix
looks like a one-line change and is not.

The header of `app/utils/outboxSweep.ts:29-34` already stated the decision:

> Consumption is UNCONDITIONAL on send outcome … Delivery is best-effort with no
> retry; retrying would need delivery receipts, an attempt counter and a
> dead-letter path, and **half-building that is worse than not building it**. A
> member with a permanently-undeliverable address must never be able to hold the
> outbox — and therefore the liveness alarm — red forever.

What follows is the evidence that turns that assertion into a measured one.

## Decision

Keep it. `sendOne` continues to record a recipient as attended before awaiting
(`outboxSweep.ts:897`), `partitionClaimed` re-pends only never-attempted
recipients, and `countLost` keeps its meaning. Failed sends stay visible through
`failed` / `skipped` / `lost` in the sweep report and the flush workflow, which is
where the 2026-08-28 delivery stopped — visibility without retry.

## Rejected

**1. Classify the failure and re-pend the retryable ones, with a per-notice
backoff and the existing `deadline` as the bound.**

Killed by the failure classification itself. `sendEmail` flattens every error to
`String(err)`, so retrying "only unambiguous failures" first requires structured
classification — and the obvious rule, *retry on a 4xx*, duplicates real mail.
`nodemailer/lib/errors.js:19` defines `ECONNECTION` as **"Connection closed
unexpectedly"**, not a failure to connect; `smtp-connection/index.js:992` raises
it whenever the socket closes with a response action outstanding — including
`_actionSMTPStream` (`:1911`), the state *after the entire DATA payload is
written* — and `:994` attaches a trailing `[45]xx` as `responseCode` (`:952`). A
4xx-triggered retry can therefore re-send a message the server already queued.

It also broke on the **mixed population**. One notice can carry both refused and
budget-tail recipients — `.github/workflows/flush-notifications.yml:134` already
documents that correlated case, *"since both come from slow sends"* — while
`RependInput` is per notice (`outboxSweep.ts:538`). One `notifyAfter`, two needs:
backing off stalls `drainOutbox`'s pagination, not backing off runs five rounds
against a server that just refused us. And the `deadline` bound destroyed
budget-tail recipients, because `partitionClaimed` cannot tell the two
populations apart (`:600-601`).

**2. Collapse the populations: treat a refused send exactly like one the budget
never reached, and stop the send stage at the first refusal (a per-sweep circuit
breaker).**

Simpler, and it genuinely dissolved the mixed-population problem — at the cost of
any bound on retry, which is precisely what the header comment forbids. Gmail
returns **per-recipient** 4xx at `RCPT TO` (`452 4.2.2` over quota, `450 4.2.1`
rate), which `smtp-connection/index.js:1848-1850` surfaces as `EENVELOPE` with
that `responseCode`. One such recipient is enough:

- nothing expires a pending notice — `isDue` stays true forever once `notifyAfter`
  passes (`outboxNotice.ts:171-178`), and `repend` leaves `firstQueuedAt` alone;
- `DUE_NOTICES_QUERY` orders `firstQueuedAt asc` (`outboxSweep.ts:218`), so the
  stuck notice is always first, always in wave 1, and trips the breaker on **every**
  sweep;
- layer-1 throughput collapses to one wave per invocation, the backlog never
  drains, `oldest` crosses `STALE_ALERT_HOURS = 6` and the liveness alarm mails
  every super-admin daily, forever.

That is verbatim the state `outboxSweep.ts:32-34` declares must be impossible —
and because a refusal counts `throttled` (a warning) rather than `failed` (red at
2), the flush workflow would have stayed **green** throughout.

**3. Bounding retry by time instead.** Considered first and abandoned: a
time-bounded retry destroys mail at the deadline, and `countLost` structurally
cannot count it — it iterates `toConsume` only (`outboxSweep.ts:616-630, 998`), so
a recipient abandoned on a *re-pended* notice reads as zero loss on a green run.

## Consequences

A failed send is still lost, and the team still does not hear about that setlist.
The cost is bounded by how rare it is and made visible by `failed` / `lost`, which
is why visibility shipped and retry did not.

**Doing this properly needs all three of what the header comment names** —
delivery receipts to distinguish "queued" from "maybe queued", a per-recipient
attempt counter, and a dead-letter path so a dead address leaves the queue instead
of holding it. Any two of the three is the half-build, and each rejected design
above is a different two.

**Before reopening this, check that the motivating failure is even a 4xx.**
Gmail's account-level limit is `550 5.4.5 Daily user sending limit exceeded`,
which is terminal and would not be retried under any of these designs. No
production sample of a 4xx from this sender exists.

The three rejected designs and their review rounds are preserved in
[`docs/superpowers/specs/2026-08-28-outbox-repend-design.md`](../superpowers/specs/2026-08-28-outbox-repend-design.md),
which is a **rejected** design, not a plan of record.
