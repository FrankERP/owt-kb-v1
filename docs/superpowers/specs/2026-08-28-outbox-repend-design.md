# Outbox re-pend — design

**Date:** 2026-08-28
**Status:** revised after adversarial review round 1 (CHANGES_REQUIRED, 5 blockers,
all verified against source and all accepted). Awaiting two sequential fresh
approvals on this text.
**Risk tier:** CRITICAL — changes a production writer's delivery and consumption
behaviour. Per `CLAUDE.md`, needs two sequential fresh `APPROVED` verdicts on
byte-identical text before implementation.

## Problem

Stage 8 of the sweep consumes whatever stage 3 claimed. A recipient whose send
**failed** is deleted along with the notice, so the notification is destroyed
rather than retried. Spec §1 of the notification design calls this out as the
"different outbox model" that must be designed rather than discovered.

The gap is narrower than that framing suggests:

- **Recipients the send budget never reached are already re-pended.**
  `partitionClaimed` splits a claimed notice per recipient and re-pends the
  remainder with `servedRecipients` accumulated. That machinery works, it is
  documented as a guarantee (`docs/SECRETS.md`: *"nothing is deleted unsent"*),
  and this design must not weaken it.
- **The actual defect is one line.** `sendOne` calls
  `attemptedRecipientIds.add(recipientId)` at `outboxSweep.ts:897`, *before*
  awaiting the send at `:929`, so a recipient whose send then fails is recorded
  as attended. `partitionClaimed` believes it and consumes.

So this is not a new outbox model. It is telling the existing model the truth
about who was actually served, plus a bound so retrying terminates.

## The organizing idea

**Retry only on an explicit 4xx reply from a connection that stayed up.**

A 4xx is the server saying "not now" about a message it did not accept. That is
the only signal available to us that is both negative and definitive.

Everything else does not retry, for one of two reasons: it is permanent (5xx —
retrying cannot help), or **we have no verdict** — our own timeout, a socket that
died, a connection that closed mid-transaction. A missing verdict is not a
failure; the message may well have been delivered, and retrying it would send a
real person a duplicate.

### Why the connection-close case is excluded explicitly

An earlier draft treated `ECONNECTION` as "never connected" and therefore safe to
retry. That is wrong, and the correction is the single most important change in
this revision. Verified in the installed source:

- `node_modules/nodemailer/lib/errors.js:19` defines `ECONNECTION` as
  **"Connection closed unexpectedly"** — not a failure to connect.
- `smtp-connection/index.js:992` raises it whenever the socket closes while a
  response action is outstanding. One such action is `_actionSMTPStream`
  (`:1911`), the state *after the entire DATA payload has been written*, waiting
  for the server's accept/reject. A message in that state may already be queued
  on the server.
- `:994` raises `ECONNECTION` again for a close carrying a trailing `[45]xx`
  response, and `_onClose` passes that response into `_formatError`, which sets
  `responseCode` (`:952`). **So an `ECONNECTION` can carry a 4xx `responseCode`.**

A naive "4xx ⇒ retry" rule therefore retries a possibly-delivered message. The
rule must exclude connection-close explicitly:

```
retryable = responseCode >= 400 && responseCode < 500 && code !== 'ECONNECTION'
```

Additionally, `smtp-pool/index.js:405-412` (`_shouldRequeuOnConnectionClose`)
returns `true` unconditionally when `maxRequeues` is undefined, which it is here
— so a mid-send close may *already* have produced one delivery attempt inside
nodemailer before any error reaches us. One more reason this path stays terminal.

### The honest claim about duplicates

This design does **not** claim duplicates are structurally impossible. The
correct, weaker claim: **no known nodemailer path can both have delivered the
message and be classified retryable.** An explicit 4xx on a live connection is a
refusal; the ambiguous paths are all terminal. If nodemailer grows a path that
violates this, the unrecognised-shape default (§1) keeps it terminal.

## Non-goals

- No new document field and no migration.
- No per-recipient attempt counter. Retry is bounded by time, not by count.
- No change to the claim-and-delete contract, the debounce, grouping, or the
  three flush layers.
- **No weakening of the budget-exhaustion path.** Recipients the budget never
  reached are still never destroyed — see §3.
- Duplicates remain possible in general — a crash between a successful send and
  the discharge write is pre-existing and untouched.

## Decisions taken during design

1. **Retry bounded by time, not attempts** (Frank).
2. **Only unambiguous failures retry** (Frank).
3. **`ETIMEDOUT`, socket death, and connection-close are NOT retryable.** Any
   failure without a server verdict may have been delivered.
4. **Classification derives from structured error fields, never string matching.**
   `sendEmail` currently flattens every failure to `String(err)`.
5. **The new counter is `throttled`, not `deferred`.** `deferred` is already
   taken — see §2.

## 1. Classifying a send failure

`app/utils/email.ts` gains an exported pure function:

```ts
export function classifySendFailure(err: unknown): { retryable: boolean }
```

implementing the rule above. Both `sendEmail` and `sendWithTimeout`
(`email.ts:210-241`) return the classification: `sendWithTimeout` is the inner
function that owns the timeout branch, and its own return type must thread
`retryable` or the classification is lost before `sendEmail` sees it.

| Outcome | Signal | Retryable |
|---|---|---|
| Throttle / mailbox busy / greylist on a live connection | `responseCode` 4xx and `code !== 'ECONNECTION'` | **yes** |
| Permanent reject | `responseCode` 5xx | no |
| Connection closed unexpectedly | `code === 'ECONNECTION'` (with or without a 4xx) | no |
| Our own send timeout | the `timeout` branch of `sendWithTimeout` | no |
| Socket / protocol / DNS failure | `ETIMEDOUT`, `ESOCKET`, `ESTREAM`, `EPROTOCOL`, `EDNS` | no |
| Auth / TLS misconfiguration | `EAUTH`, `ETLS`, `EREQUIRETLS`, `ENOAUTH`, `EOAUTH2` | no |
| Unrecognised error shape | no usable `code`/`responseCode` | no |

`EENVELOPE` (rejected at `MAIL FROM`/`RCPT TO`) and `EMESSAGE` (rejected after
`DATA`) are not listed separately: both normally carry a `responseCode` and are
classified by the numeric rule. One *without* a `responseCode` — nodemailer
raises `EENVELOPE` for "No recipients defined" before contacting the server —
falls through to non-retryable, which is correct.

**The `code` vocabulary is open, not closed.** An earlier draft claimed a closed
set of nine; the installed source also defines `ESOCKET`, `EDNS`, `ENOAUTH`,
`EOAUTH2`, `EMAXLIMIT`, `ECONFIG`, `EPROXY`, `EFETCH`. The rule does not depend
on enumerating them — it tests two fields and defaults everything else to
terminal — but the enumeration above is illustrative, not exhaustive, and must
not be read as a guarantee.

**The default for an unrecognised shape is non-retryable, deliberately.** An
unknown case loses the mail loudly, into a counter that turns the workflow red,
instead of retrying forever. If a future nodemailer release changes its error
surface, this design fails toward today's behaviour.

`sendEmail`'s return type gains one optional field:

```ts
Promise<{ ok: boolean; error?: string; retryable?: boolean }>
```

Five callers (`outboxSweep:929`, `assignmentEmail:173,214`, `proposalNotify:102`,
`outboxLiveness:171`). Only `outboxSweep` reads the new field.

**The Resend backend (`email.ts:293-304`) produces no nodemailer error shape**,
so `classifySendFailure` returns non-retryable for every Resend failure. That is
correct — we cannot tell a Resend throttle from a Resend reject — and is stated
here so it is not later discovered as a bug. SMTP is the production path.

### "Email disabled" stays a failure

`email.ts:267,273,294` returns `{ok:false, error:"email disabled"}` when
`EMAIL_FROM`, `SMTP_USER`/`SMTP_PASS`, or `RESEND_API_KEY` is absent — the exact
shape of a rotation that unsets a variable or a deploy pointed at the wrong
environment. An earlier draft moved this to `skipped` on the theory that it is
"the system switched off". **That was wrong and is reverted.**

If it became `skipped`, the recipient would be settled, the notice consumed, the
outbox drained to empty, and `outboxLiveness`'s backlog alarm would see nothing —
while `outboxLiveness` itself mails through the same disabled `sendEmail`
(`outboxLiveness.ts:171`) and so cannot report either. A dropped environment
variable would yield a fully green pipeline delivering nothing to anyone. It
stays terminal and counts `failed`, which is red at 2.

Only the **test firewall** (`delivery blocked`) moves to `skipped`, and even that
is mostly theoretical: stage 1 gates it at `outboxSweep.ts:662`, so it does not
reach `sendOne` in a real sweep.

## 2. What "attended" means in the sweep

**2.1 `sendOne` records the recipient after the outcome, not before.** The set is
renamed `attemptedRecipientIds` → `settledRecipientIds`. A recipient is settled
when it succeeded, was rejected terminally, failed to render, had no usable
address, or was firewalled. A retryable failure leaves it unsettled and adds it
to a **second, separate set, `throttledRecipientIds`** — §3 depends on telling
these apart from budget-tail recipients.

**2.2 The re-pend needs no new logic.** `partitionClaimed` (`:600-609`) already
computes the unsettled remainder and re-pends with `servedRecipients`
accumulated. Feeding it the truth is the fix.

**2.3 Branch order inside `partitionClaimed` is pinned by this spec.** The
existing branches must keep their current precedence:

1. the `classifiedIds` branch (`:591-593`), which re-pends notices the classify
   deadline never reached, and
2. the empty-`pending` branch,

**come first**, and the new deadline logic (§3) applies **only inside the branch
with a non-empty pending set.** Order matters: a past-deadline notice that was
never classified has no `pendingByNotice` entry, so `countLost` counts nothing
for it (`:621-623`). Testing the deadline ahead of the classify branch would
consume it with `lost: 0` — reproducing exactly the silent destruction recorded
at `outboxSweep.ts:795-800`, read green by the gate built to catch it. A test
covers a past-deadline never-classified notice.

### Counters

`SweepReport.failed` currently absorbs every `!res.ok`. A throttle that re-pends
successfully is not an incident, and the flush workflow turns red at
`failed >= 2` — so leaving it there makes the gate scream in precisely the case
this design fixes.

**The new counter is `throttled`.** `deferred` is already taken: it exists on
`SweepReport` (`outboxSweep.ts:118`) meaning *due notices left unclaimed*
(`:693,708,714`), documented in `docs/NOTIFICATIONS.md` and `docs/SECRETS.md`.
Reusing the name would silently corrupt an existing signal.

- `throttled` (new) — retryable failure, recipient re-pended for another attempt.
- `failed` — terminal delivery failure, including "email disabled". Red at 2.
- `skipped` — nothing attempted, nothing lost (no address, not allowed, firewall).
- `lost` — recipients consumed without ever being settled. Now also includes
  throttled recipients abandoned at the deadline (§3).

**`throttled` must be SUMMED across rounds in `aggregateFlushReports`**
(`app/api/cron/flush-notifications/route.ts:34-70`), alongside `failed`, `lost`
and `skipped` — **not** taken from the last round the way `deferred` and
`repended` are. This is load-bearing, not stylistic. The route runs up to
`MAX_DRAIN_ROUNDS` rounds; a throttle wave that defers 8 recipients in round 1
is made not-due by the backoff, so round 2 throttles nothing. Taking the last
round would serialize `throttled: 0` alongside `failed: 0` and `lost: 0` — a
fully green run over eight undelivered emails. The comment at `route.ts:56-58`
already exists to prevent exactly this for `failed`.

`.github/workflows/flush-notifications.yml` reports `throttled`; its existing
thresholds and their order are unchanged. `throttled` is added to `GATED_FIELDS`
in `app/api/__tests__/flushWorkflowGate.test.ts:44` so the field name stays
pinned against the workflow's `sed` patterns. The workflow's `lost` annotation
currently points triage at `notify_sweep_send_budget_exhausted`; after this
change `lost` most often means "deadline expired with throttled recipients", so
the annotation is updated.

## 3. The deadline bound, scoped so it cannot destroy the budget tail

An earlier draft said: at `deadline <= now`, consume even with unsettled
recipients. **That was wrong.** `partitionClaimed` cannot distinguish "unsettled
because the send failed retryably" from "unsettled because the send budget never
reached them" — both are just absence from the settled set (`:600-601`). Today
nothing consumes on deadline, so a fan-out tail is re-pended until served, and
`docs/SECRETS.md` states that as a guarantee. The draft's rule would have turned
the budget path into destruction, contradicting this design's own non-goal.

The corrected rule uses the `throttledRecipientIds` set from §2.1. At
`deadline <= now`, inside the non-empty-pending branch:

- **Throttled recipients are abandoned.** They are added to `servedRecipients` so
  they are not attempted again, and counted in `lost`.
- **Budget-tail recipients are re-pended as today.** They are never destroyed by
  the deadline.
- If, after abandoning the throttled ones, no unsettled recipients remain, the
  notice is consumed. Otherwise it is re-pended and the budget path continues.

So the deadline bounds *retrying*, which is what this design introduces, and does
not touch *pagination*, which already worked.

### Overloading `deadline` — the trade, stated

`deadline` is set at queue time to `firstQueuedAt + MAX_WINDOW_MS` (60 minutes by
default, overridable via `NOTIFY_MAX_WINDOW_MINUTES`), and its existing job is to
cap how long the debounce may hold a notice waiting for quiet. Reusing it as the
retry bound means the retry window is whatever remains after the debounce and the
cron latency: a notice queued at minute 0, released at 15, first attempted at 41,
has 19 minutes left.

The alternative is a dedicated field plus a migration. Rejected because the
remaining window is already the right answer to "is this notice still worth
sending?" — a setlist notice undeliverable for an hour has been overtaken by the
service it describes. A separate retry deadline could keep retrying a notice the
debounce contract already considers stale.

### Backoff, and why only for the new case

`repend` writes `notifyAfter: now` (`:553-556`) with a comment stating that only
the send budget stopped us. That comment stops being true once a second reason
exists, and the immediacy is correct for only one of the two:

- **Budget exhaustion stays immediately due.** That is how the sweep paginates.
- **A throttle must back off.** Re-pending immediately means the next sweep hits
  a server that just said "not now". Cron sweeps are ~41 min apart so it rarely
  shows, but a mutation-triggered `after()` sweep can arrive within seconds, and
  a burst of mutations becomes a retry storm against a server already limiting us.

`repend` takes the reason. `budget` keeps `now`; `throttled` sets
`now + RETRY_BACKOFF_MS`, proposed at **2 minutes**. The comment is updated to
describe both. `DUE_NOTICES_QUERY` selects on `notifyAfter <= $now || deadline <=
$now`, so a backed-off notice is correctly not selected until either fires.

### Why retry terminates

**Termination rests on the deadline alone.** An earlier draft claimed three
independent bounds; that was reassurance the code does not provide.
`servedRecipients` is *not* monotone in the pathological case — a lone recipient
failing retryably yields an empty `attemptedHere` (`:600,608`), and
`buildUpsert.patchSet` resets `servedRecipients: []` on any new edit
(`outboxNotice.ts:148`). The backoff bounds frequency, not count. The deadline is
the bound, and §3 makes it unconditional for throttled recipients.

### A widened pre-existing window, stated

If the `repend` write itself fails (`:558-565`), the notice stays `sending` under
its claim lease and is re-offered when the lease expires — with successful sends
from this pass **not** recorded in `servedRecipients`, so those recipients get a
duplicate. This is pre-existing on the budget path, but this design exercises
`repend` on every throttle wave, so the window widens materially. It is not
solved here; it is named so it is not mistaken for new behaviour, and it is the
strongest argument for keeping the retryable set as narrow as it is.

## 4. What is still lost, on purpose

Permanent rejections, verdict-less failures, missing credentials, and anything
throttled still unsent at the deadline. All land in `lost` or `failed`.

**Where retries actually come from, honestly.** With the deadline 60 minutes from
queue time and the GitHub cron at a 41-minute median, the next cron pass after a
failure usually arrives past the deadline — so cron-driven retry mostly does not
happen. The retry that does happen is the layer-2 opportunistic sweep fired by
`after()` on the next mutation, which can arrive within seconds. That is also why
the backoff is 2 minutes and not longer: layer 2 is what is being paced.

So the value is **highest on a busy weekend** and **near zero on a quiet
weekday**, where the late cron finds an expired notice and reports it lost. Still
strictly better than today — the same notice is counted instead of destroyed
silently — but not a general retry guarantee, and it should not be sold as one.

A 5-minute scheduler would give ~11 real retries with no change to this code.
That remains a separately-tracked open issue.

## 5. Testing

**`email.test.ts` — the classification table**, against `classifySendFailure`
directly, no transport mock: 4xx on a live connection retryable; 5xx not;
`ECONNECTION` not, **including `ECONNECTION` carrying a 4xx `responseCode`**
(the round-1 blocker, pinned as a regression); `ETIMEDOUT`, `ESOCKET`, `ESTREAM`,
`EPROTOCOL`, `EAUTH`, `ETLS` not; our own timeout not; unrecognised shape not;
`EENVELOPE` without a `responseCode` not. Plus: a Resend-shaped failure is
terminal.

**`outboxSweep.test.ts` — the behaviour.** `sendEmailMock` is a plain `vi.fn()`
(`:16,107-110`), so returning a classified failure needs no new scaffolding.

- A retryable failure re-pends and does not mark the recipient served.
- A terminal failure consumes and counts `failed`, not `lost` — it was settled.
- "Email disabled" counts `failed`, not `skipped`.
- At the deadline, throttled recipients are abandoned into `lost` **and**
  budget-tail recipients on the same notice are still re-pended, not destroyed.
- A past-deadline notice that was never classified is re-pended by the
  `classifiedIds` branch, not consumed with `lost: 0` (branch-order pin, §2.3).
- `throttled` re-pend sets `notifyAfter` ≈ now + 2 min; `budget` re-pend keeps now.
- A `throttled` does not count toward `failed`.
- A mixed notice (one success, one throttle) re-pends with the success recorded.

**`flushNotificationsRoute.test.ts` — the aggregation.** `throttled` is summed
across rounds: a round-1 throttle followed by a clean round 2 must serialize a
non-zero `throttled`, not net out to zero. This is the round-1 blocker most
likely to be reintroduced by a later refactor.

**Regression pins that must pass unedited:** the existing budget-exhaustion
re-pend tests, and `flushNotificationsRoute.test.ts:408-423` (which pins
`deferred`/`repended` as last-round values — this design must not disturb them).

**No production probe.** The classification is deterministic and the behaviour is
fully observable in unit tests. If Gmail never emits a 4xx on a live connection,
the design degrades exactly to today's behaviour — everything terminal, nothing
re-pended — so "never fires" is not a failure mode. Whether Gmail's throttle
actually arrives as a 4xx rather than an abrupt close is **unverified** and
deliberately not blocking, for that reason.

Plus the repository gates: `npx tsc --noEmit`, `npm test`, `npx eslint .` with 0
errors.

## 6. Risks

| Risk | Mitigation |
|---|---|
| Retrying a delivered message → duplicate to a real person | Only a 4xx on a live connection retries; `ECONNECTION` excluded even when it carries a 4xx, verified against `smtp-connection/index.js:992-994`. |
| nodemailer changes its error surface | Unrecognised shapes default to terminal: degrades to today's behaviour. |
| New counter silently serializing as 0 | `throttled` is summed in `aggregateFlushReports`, pinned by a route test and by `GATED_FIELDS`. |
| Deadline bound destroying budget-tail recipients | Bound applies only to `throttledRecipientIds`; budget tail re-pends as today (§3). |
| Branch order re-shipping known silent destruction | Order pinned in §2.3 and covered by a test. |
| A missing credential going unnoticed | "Email disabled" stays terminal and counts `failed`, red at 2. |
| `repend` write failure duplicating successful sends | Pre-existing; named in §3, window widened, retryable set kept narrow to limit exposure. |
| Retry benefit concentrated in layer 2, near zero on a quiet weekday | Stated plainly in §4 rather than sold as a guarantee; cron cadence is a separate open issue. |

## Files touched

- `app/utils/email.ts` — `classifySendFailure`; `retryable` on `sendEmail` and
  `sendWithTimeout`.
- `app/utils/outboxSweep.ts` — settle-after-outcome, `throttledRecipientIds`,
  scoped deadline bound, `throttled` counter, `repend` reason + backoff.
- `app/api/cron/flush-notifications/route.ts` — sum `throttled`.
- `.github/workflows/flush-notifications.yml` — report `throttled`; correct the
  `lost` triage annotation.
- `app/utils/__tests__/email.test.ts`, `app/utils/__tests__/outboxSweep.test.ts`,
  `app/api/__tests__/flushWorkflowGate.test.ts`,
  `app/api/__tests__/flushNotificationsRoute.test.ts`.
- `docs/NOTIFICATIONS.md` — retry semantics and the counters.
