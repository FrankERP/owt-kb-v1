# Outbox re-pend — design

**Date:** 2026-08-28
**Status:** design approved by Frank in chat; awaiting adversarial review
**Risk tier:** CRITICAL — changes a production writer's delivery and consumption
behaviour. Per `CLAUDE.md`, needs two sequential fresh `APPROVED` verdicts on
byte-identical text before implementation.

## Problem

Stage 8 of the sweep consumes whatever stage 3 claimed. A recipient whose send
**failed** is deleted along with the notice, so the notification is destroyed
rather than retried. Spec §1 of the notification design calls this out as the
"different outbox model" that must be designed rather than discovered.

The gap is narrower than that framing suggests, and the difference matters:

- **Recipients the send budget never reached are already re-pended.**
  `partitionClaimed` splits a claimed notice per recipient and re-pends the
  remainder with `servedRecipients` accumulated. That machinery works and this
  design does not change it.
- **The actual defect is one line.** `sendOne` calls
  `attemptedRecipientIds.add(recipientId)` *before* awaiting the send, so a
  recipient whose send then fails is recorded as attended. `partitionClaimed`
  believes it and consumes.

So this is not a new outbox model. It is telling the existing model the truth
about who was actually served, plus a bound so retrying terminates.

## The organizing idea

**Retry only when the mail server definitively did not accept the message.**

That is true in exactly two cases: the server gave an explicit negative reply
meaning "not now" (a 4xx), or we never got a connection at all. Everything else
is either permanent (5xx — retrying cannot help) or **without a verdict** (our
own timeout, a dead socket — the message may well have been delivered, and
retrying would duplicate it).

This is the strict reading of Frank's decision to retry only unambiguous
failures, and it is what makes duplicates structurally impossible on this path
rather than merely unlikely.

## Non-goals

- No new document field and no migration. The bound reuses the existing
  `deadline`.
- No per-recipient attempt counter. Retry is bounded by time, not by count.
- No change to the claim-and-delete contract, to the debounce, to grouping, or
  to the three flush layers.
- No change to the budget-exhaustion path, which already re-pends correctly.
- Duplicates remain possible in general — a crash between a successful send and
  the discharge write is pre-existing and untouched.

## Decisions taken during design

1. **Retry bounded by time, not attempts** (Frank). A notice retries while it is
   inside its existing `deadline`; on expiry it is consumed and reported lost.
2. **Only unambiguous failures retry** (Frank). A failure with no server verdict
   does not retry, because it may have been delivered.
3. **`ETIMEDOUT` / socket death are NOT retryable.** An earlier draft of this
   design listed network errors as retryable; that contradicted decision 2, since
   a socket that dies mid-`DATA` may have been accepted. Corrected before
   approval.
4. **Classification is derived from structured error fields, never from string
   matching.** `sendEmail` currently flattens every failure to `String(err)`,
   which is why this design has to change it.

## 1. Classifying a send failure

`app/utils/email.ts` gains an exported pure function:

```ts
export function classifySendFailure(err: unknown): { retryable: boolean }
```

Verified against the installed `nodemailer` source rather than assumed:

- `smtp-connection/index.js:952` sets `err.responseCode` to the numeric SMTP
  reply whenever the server actually answered.
- `_formatError(..., TYPE, ...)` assigns `err.code` from a closed vocabulary:
  `EENVELOPE`, `EAUTH`, `EMESSAGE`, `ECONNECTION`, `EREQUIRETLS`, `ESTREAM`,
  `EPROTOCOL`, `ETLS`, plus `ETIMEDOUT`.

The rule is two conditions:

```
retryable = code === 'ECONNECTION'                        // never connected
         || (responseCode >= 400 && responseCode < 500)   // server said "not now"
```

| Outcome | Signal | Retryable |
|---|---|---|
| Throttle / mailbox busy / greylist | `responseCode` 4xx (421, 450, 451, 452) | **yes** |
| Connection never established | `code === 'ECONNECTION'` | **yes** |
| Permanent reject | `responseCode` 5xx (550, 553, …) | no |
| Our own send timeout | the `timeout` branch of `sendWithTimeout` | no |
| Connection or protocol failure after connecting | `ETIMEDOUT`, `ESTREAM`, `EPROTOCOL` | no |
| Auth / TLS misconfiguration | `EAUTH`, `ETLS`, `EREQUIRETLS` | no |
| Unrecognised error shape | no usable `code` or `responseCode` | no |

`EENVELOPE` (rejected at `MAIL FROM`/`RCPT TO`) and `EMESSAGE` (rejected after
`DATA`) are not listed separately because both normally carry a `responseCode`
and are classified by the numeric rule — a 4xx of either kind is a refusal the
server is explicit about, so nothing was accepted. One of these *without* a
`responseCode` (nodemailer raises `EENVELOPE` for "No recipients defined" before
ever contacting the server) falls through to non-retryable, which is correct:
retrying cannot supply a recipient.

**The default for an unrecognised shape is non-retryable, deliberately.** An
unknown case then loses the mail loudly — into a counter that already turns the
workflow red — instead of retrying forever. If a future nodemailer release
changes its error surface, this design fails toward today's behaviour.

`sendEmail`'s return type gains one optional field:

```ts
Promise<{ ok: boolean; error?: string; retryable?: boolean }>
```

It has five callers (`outboxSweep`, `assignmentEmail` ×2, `proposalNotify`,
`outboxLiveness`). Only `outboxSweep` reads the new field; the other four log
`res.error` and are unchanged.

### Non-delivery is not failure

`sendEmail` returns `ok: false` for `delivery blocked` (the test firewall) and
`email disabled` (no `from`, no credentials, no API key). These are not delivery
failures — they are the system switched off or the harness intercepting on
purpose. They are classified non-retryable, and in §2 they are counted as
`skipped` rather than `failed`, so they stop inflating the alarm threshold.

## 2. What "attended" means in the sweep

Three changes in `app/utils/outboxSweep.ts`.

**2.1 `sendOne` records the recipient after the outcome, not before.** The set is
renamed `attemptedRecipientIds` → `settledRecipientIds`, because "attempted" is
no longer what it holds. A recipient is settled when it succeeded, was rejected
permanently, failed to render, had no usable address, or was skipped. A
retryable failure leaves it unsettled.

**2.2 The re-pend itself needs no new logic.** `partitionClaimed` already
computes `neverAttempted` from that set and re-pends with `servedRecipients`
accumulated. Feeding it the truth is the whole fix.

**2.3 The deadline becomes a consumption bound.** This deliberately overloads a
field that today means something else, and the trade is worth stating plainly.
`deadline` is set at queue time to `firstQueuedAt + MAX_WINDOW_MS` (60 minutes by
default, overridable via `NOTIFY_MAX_WINDOW_MINUTES`), and its existing job is to
cap how long the *debounce* may hold a notice waiting for quiet. Reusing it as
the retry bound means the retry window is whatever remains of that 60 minutes
after the debounce and the cron latency have taken their share — a notice queued
at minute 0, released at 15, first attempted at 41, has 19 minutes left.

The alternative is a dedicated field plus a migration. It is rejected because the
remaining window is *already* the right answer to "is this notice still worth
sending?" — a setlist notice that has been undeliverable for an hour has been
overtaken by the service it describes. A separate retry deadline could keep
retrying a notice the debounce contract already considers stale. Today `deadline` participates
only in `DUE_NOTICES_QUERY` selection; nothing forces consumption. Now: if
`notice.deadline <= now`, the notice is consumed even with unsettled recipients,
and those land in `countLost`, which already counts exactly this — pending
recipients of a consumed notice that were never settled.

### Counters

`SweepReport.failed` currently absorbs every `!res.ok`. A throttle that
re-pends successfully is not an incident, and the flush workflow turns red at
`failed >= 2` — so leaving it there would make the gate scream in precisely the
case this design fixes.

- `deferred` (new) — retryable failure, recipient re-pended. Reported as a
  health signal; lights nothing.
- `failed` — terminal delivery failure. Keeps the existing red threshold.
- `skipped` — nothing was attempted and nothing was lost (no address, not
  allowed, firewall, email disabled).
- `lost` — unchanged in meaning, and for the first time verifiable: recipients
  consumed without ever being settled.

`.github/workflows/flush-notifications.yml` gains a `deferred` line in its
report. Its thresholds and their order are unchanged, and
`app/api/__tests__/flushWorkflowGate.test.ts` pins the serialized field names
against the workflow's `sed` patterns, so a rename that breaks the gate fails
the suite.

## 3. Backoff, and why only for the new case

`repend` writes `notifyAfter: new Date().toISOString()` — immediately due —
with a comment stating that only the send budget stopped us. That comment stops
being true the moment a second reason to re-pend exists, and the immediacy is
correct for only one of the two:

- **Budget exhaustion must stay immediately due.** That is how the sweep
  paginates: the next sweep continues where this one stopped.
- **A deferral must back off.** Re-pending a throttled notice as immediately due
  means the next sweep hits a server that just said "not now". Cron-driven
  sweeps run ~41 minutes apart so it rarely shows, but a mutation-triggered
  `after()` sweep can arrive within seconds, and a burst of mutations becomes a
  retry storm against a server already limiting us.

So `repend` takes the reason. `budget` keeps `notifyAfter: now`; `deferred` sets
`now + RETRY_BACKOFF_MS`, proposed at **2 minutes** — invisible against the cron
cadence, sufficient to not hammer. The comment is updated to describe both.

### Why retry terminates

Three independent bounds, none of which requires new state:

1. `deadline` forces consumption.
2. The backoff bounds frequency.
3. `servedRecipients` grows monotonically, so each pass has strictly fewer
   recipients to attempt.

### Why duplicates are excluded on this path

A 4xx is an explicit refusal and `ECONNECTION` never opened a connection;
neither can have delivered. A duplicate would require retrying a send with no
verdict, which is exactly the case classified non-retryable.

## 4. What is still lost, on purpose

Permanent rejections, verdict-less failures, and anything unsettled when the
deadline expires. All land in `lost`. A dead address does not improve by being
retried, and retrying it would hold the alarm red forever.

**Where the retries actually come from, honestly.** With the deadline at 60
minutes from queue time and the GitHub cron running at a 41-minute median, the
*next cron pass after a failure usually arrives past the deadline* — so
cron-driven retry mostly does not happen at all. The retry that does happen is
the layer-2 opportunistic sweep fired by `after()` on the next mutation, which
can arrive within seconds. That is also why the backoff is 2 minutes and not
longer: layer 2 is the mechanism actually being paced.

The consequence is that the value of this change is **highest on a busy
weekend** (mutations frequent, layer 2 firing often) and **near zero on a quiet
weekday** (nothing but the late cron, which finds an expired notice and reports
it lost). That is still strictly better than today, where the same notice is
destroyed silently instead of counted — but it should not be sold as a general
retry guarantee.

A 5-minute scheduler would change this completely, giving ~11 real retries with
no change to this code. That remains a separately-tracked open issue and is not
solved here.

## 5. Testing

**`email.test.ts` — the classification table**, tested directly against
`classifySendFailure` with no transport mock: 421/450/451/452 retryable;
550/553 not; `ECONNECTION` retryable; `ETIMEDOUT`, `ESTREAM`, `EPROTOCOL`,
`EAUTH`, `ETLS` not; our own timeout not; an unrecognised error shape not.

**`outboxSweep.test.ts` — the behaviour.** `sendEmailMock` is a plain `vi.fn()`,
so returning a classified failure needs no new scaffolding.

- A retryable failure re-pends and does not mark the recipient served.
- A terminal failure consumes and counts `failed`, not `lost` — it was settled.
- A past-deadline notice consumes despite unsettled recipients; those count
  `lost`.
- `deferred` re-pend sets `notifyAfter` ≈ now + 2 min; `budget` re-pend keeps now.
- `servedRecipients` accumulates: a second sweep writes only to who remained.
- A `deferred` does not count toward `failed`.
- A mixed notice (one success, one deferral) re-pends with the success recorded.

**Regression pin:** the existing budget-exhaustion re-pend tests must pass
**unedited**. They are the evidence that the pagination path was not disturbed.

**No production probe.** Unlike the concurrency change, the classification is
deterministic and the behaviour is fully observable in unit tests. If Gmail never
emits a 4xx, the design degrades exactly to today's behaviour — everything
terminal, nothing re-pended — so "never fires" is not a failure mode.

Plus the repository gates: `npx tsc --noEmit`, `npm test`, `npx eslint .` with 0
errors.

## 6. Risks

| Risk | Mitigation |
|---|---|
| Misclassifying a delivered send as retryable → duplicate | Only 4xx and `ECONNECTION` retry; neither can have delivered. |
| nodemailer changes its error surface | Unrecognised shapes default to non-retryable: degrades to today's behaviour. |
| Retry storm against a throttling server | `RETRY_BACKOFF_MS` on the deferral path only. |
| `deferred` masking a real outage | A systemic outage surfaces as `EAUTH`/`ECONNECTION`; `EAUTH` is terminal and counts `failed`. Sustained `deferred` is reported. |
| Renaming counters breaks the workflow gate silently | `flushWorkflowGate.test.ts` pins field names against the workflow's `sed` patterns. |
| Retry benefit is concentrated in layer 2, near zero on a quiet weekday | Stated plainly in §4 rather than sold as a general retry guarantee; the cron cadence is a separately-tracked open issue, not solved here. |

## Files touched

- `app/utils/email.ts` — `classifySendFailure`, `retryable` on the return type.
- `app/utils/outboxSweep.ts` — settle-after-outcome, deadline consumption bound,
  `deferred` counter, `repend` reason + backoff.
- `.github/workflows/flush-notifications.yml` — report `deferred`.
- `app/utils/__tests__/email.test.ts`, `app/utils/__tests__/outboxSweep.test.ts`.
- `docs/NOTIFICATIONS.md` — document the retry semantics and the counters.
