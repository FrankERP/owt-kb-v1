# Outbox re-pend — design

**Date:** 2026-08-28
**Status:** simplified after adversarial review rounds 1 and 2 (5 and 2 verified
blockers). Awaiting two sequential fresh approvals on this text.
**Risk tier:** CRITICAL — changes a production writer's delivery behaviour. Per
`CLAUDE.md`, needs two sequential fresh `APPROVED` verdicts on byte-identical
text before implementation.

## Problem

Stage 8 of the sweep consumes whatever stage 3 claimed. A recipient whose send
**failed** is deleted along with the notice, so the notification is destroyed
rather than retried.

The defect is one line. `sendOne` calls `attemptedRecipientIds.add(recipientId)`
at `outboxSweep.ts:897`, *before* awaiting the send at `:929`. A recipient whose
send then fails is recorded as attended, and `partitionClaimed` believes it and
consumes.

## The organizing idea

**A send that was refused is treated exactly like a send the budget never
reached.**

The sweep already has a correct, documented, well-tested behaviour for "we did
not serve this recipient": leave them unsettled, re-pend the notice, let the next
sweep finish them. `docs/SECRETS.md` states the guarantee — *"nothing is deleted
unsent."* Nothing about that machinery needs to change. It has simply been fed a
lie about who was served.

So this design does **not** add a retry mechanism. It removes a false claim, and
routes refusals into the path that already exists.

### Why the earlier, larger design was abandoned

Two prior revisions of this spec added a per-notice retry backoff and a
deadline-based consumption bound. Review found, and source confirmed, that both
broke on the same case: a single notice can carry **both** throttled recipients
and budget-tail recipients — the repo already documents this as the correlated
case, at `.github/workflows/flush-notifications.yml:133-136`, *"since both come
from slow sends"*. `RependInput` is per notice (`outboxSweep.ts:538-541`), so
there is one `notifyAfter` to write and two populations wanting different values.
Backing off stalls pagination; not backing off storms the server. The deadline
bound had the same defect from the other side: `partitionClaimed` cannot tell the
two populations apart (`:600-601`), so consuming at the deadline destroyed
budget-tail recipients and broke the `SECRETS.md` guarantee.

Collapsing the two populations into one removes the case rather than resolving
it. That is the whole content of this revision.

## The circuit breaker

On the **first retryable failure in a sweep, the send stage stops.** Remaining
recipients are not attempted, and are accounted for exactly as budget exhaustion
already accounts for them.

The wave loop (`outboxSweep.ts:942-981`) already has the branch this needs — the
admission check that ends the stage with `report.unserved += entries.length - i`
and a `break`. The breaker adds a second reason to take that same branch,
evaluated after a wave resolves. It therefore inherits the existing accounting,
the existing re-pend path, and the existing tests.

**Why stopping the sweep is the right brake.** A 4xx means the server is
refusing us *now*, and it is a property of the connection, not of the recipient —
the next recipient in the same wave will almost certainly be refused too. Today
the sweep would keep pushing through the whole wave, collect eight failures, and
destroy all eight. Stopping is both gentler on the server and strictly less
destructive.

`drainOutbox` (`app/api/cron/flush-notifications/route.ts:88-96`) loops up to
`MAX_DRAIN_ROUNDS = 5` while `repended > 0`. Since a tripped breaker re-pends, the
loop would immediately retry against the server that just refused us. So the
breaker also **ends the drain loop**: the sweep reports `throttled > 0` and
`drainOutbox` breaks on it, alongside its existing `lost > 0` and `repended === 0`
conditions.

### What this does and does not pace

Layer 1 is fully paced: one refused send ends the sweep and the drain loop, so a
cron invocation makes at most one refused attempt.

**Layer 2 is paced per sweep, not across sweeps, and this is a deliberate
limitation.** Each mutation-triggered `after()` sweep is a separate invocation
with no shared state, so a burst of mutations produces one refused attempt each.
Cross-invocation pacing would need a cooldown stored in Sanity — new state, a new
failure mode, and a new thing to get wrong. It is not worth it here: the outbox
debounces at 15 minutes, so a mutation burst does not produce a burst of *due*
notices, and one refused send per sweep is already far gentler than today's eight.

## Non-goals

- No new document field, no migration, no new stored state.
- No retry backoff and no retry deadline — see "Termination" below.
- No change to `partitionClaimed`, to `repend`, to `countLost`, to the
  claim-and-delete contract, the debounce, grouping, or the flush layers.
- **No weakening of the budget-exhaustion path.** It is reused verbatim.
- Duplicates remain possible in general — a crash between a successful send and
  the discharge write is pre-existing and untouched.

## Termination

**Retry is bounded exactly as the existing unserved path is bounded, and no
further.** A notice whose sends keep being refused re-pends until it is served.

This is a deliberate departure from an earlier decision to bound retry by time.
That decision existed to stop a *new* unbounded loop; under this design there is
no new loop to stop. A refused recipient is the same thing as a budget-tail
recipient, and the system has always re-pended those indefinitely — documented,
monitored by `outboxLiveness`'s backlog alarm, and guaranteed by `SECRETS.md` not
to be destroyed. Adding a time bound here would mean *destroying* mail the system
currently promises to keep, which is the opposite of this design's purpose.

The case that would be unbounded in practice is a server returning 4xx forever.
That is indistinguishable from a server that is down, which the existing path
already handles the same way, and which the backlog alarm already surfaces.

## 1. Classifying a send failure

`app/utils/email.ts` gains an exported pure function:

```ts
export function classifySendFailure(err: unknown): { retryable: boolean }
```

**The rule is numeric and authoritative:**

```
retryable = responseCode >= 400 && responseCode < 500 && code !== 'ECONNECTION'
```

A 4xx is the server explicitly refusing a message it did not accept. Everything
else is terminal, for one of two reasons: it is permanent (5xx), or **we have no
verdict** — our own timeout, a dead socket, a connection closed mid-transaction.
A missing verdict may mean the message was delivered, and retrying it would send
a real person a duplicate.

### Why `ECONNECTION` is excluded even when it carries a 4xx

Verified in the installed source:

- `node_modules/nodemailer/lib/errors.js:19` defines `ECONNECTION` as
  **"Connection closed unexpectedly"** — not a failure to connect.
- `smtp-connection/index.js:992` raises it whenever the socket closes while a
  response action is outstanding. One such action is `_actionSMTPStream`
  (`:1911`) — the state *after the entire DATA payload has been written*, waiting
  for the server's accept or reject. A message in that state may already be
  queued on the server.
- `:994` raises it again for a close carrying a trailing `[45]xx`, and `_onClose`
  passes that response into `_formatError`, which sets `responseCode` (`:952`).

So a bare "4xx ⇒ retry" rule would retry a possibly-delivered message. The
exclusion is load-bearing, not defensive.

### The table is illustrative; the rule governs

| Outcome | Typical signal | Retryable |
|---|---|---|
| Throttle / greylist / "too many login attempts" on a live connection | `responseCode` 4xx | **yes** |
| Permanent reject | `responseCode` 5xx | no |
| Connection closed unexpectedly | `ECONNECTION`, with or without a 4xx | no |
| Our own send timeout | the `timeout` branch of `sendWithTimeout` | no |
| Socket / protocol / DNS failure with no server reply | `ETIMEDOUT`, `ESOCKET`, `ESTREAM`, `EDNS` | no |
| Misconfiguration with no server reply | `EAUTH`, `ETLS`, `EREQUIRETLS` | no |
| Unrecognised error shape | no usable `code`/`responseCode` | no |

**The `code` column describes the no-`responseCode` case and does not override
the rule.** `EAUTH`, `ETLS` and `EPROTOCOL` *can* carry a 4xx (e.g. `454 4.7.0
Too many login attempts`), and when they do they are retryable — correctly, since
that is Gmail telling us to come back later, and all of those states are pre-DATA
so none can have delivered. The tests in §5 assert the rule, not the table.

The nodemailer `code` vocabulary is **open**: the installed source also defines
`ESOCKET`, `EDNS`, `ENOAUTH`, `EOAUTH2`, `EMAXLIMIT`, `ECONFIG`, `EPROXY`,
`EFETCH`. The rule does not enumerate them; it tests two fields and defaults
everything else to terminal. If a future release changes the error surface, this
design fails toward today's behaviour.

`EENVELOPE` (refused at `MAIL FROM`/`RCPT TO`) and `EMESSAGE` (refused after
`DATA`) are classified by the numeric rule. One without a `responseCode` —
nodemailer raises `EENVELOPE` for "No recipients defined" before contacting the
server — falls through to terminal, which is correct.

### Signature

```ts
Promise<{ ok: boolean; error?: string; retryable?: boolean }>
```

Both `sendEmail` and `sendWithTimeout` (`email.ts:210-241`) thread it —
`sendWithTimeout` owns the timeout branch, so the classification is lost if it
does not.

**`retryable` must be OMITTED, not `false`, on unclassified returns.**
`app/utils/__tests__/deliveryFirewallTransports.test.ts:630` asserts
`toEqual({ ok: false, error: "email disabled" })`, which an added `retryable:
false` would break. This is a real constraint on the implementation, not a
stylistic preference.

Five callers (`outboxSweep:929`, `assignmentEmail:173,214`, `proposalNotify:102`,
`outboxLiveness:171`); only `outboxSweep` reads the new field.

**The Resend backend (`email.ts:293-304`) produces no nodemailer error shape**, so
every Resend failure is terminal. Correct — we cannot tell a Resend throttle from
a reject — and stated so it is not later found as a bug. SMTP is the production
path.

### "Email disabled" stays a failure

`email.ts:267,273,294` returns `{ok:false, error:"email disabled"}` when
`EMAIL_FROM`, `SMTP_USER`/`SMTP_PASS`, or `RESEND_API_KEY` is absent — the shape
of a rotation that unsets a variable or a deploy pointed at the wrong
environment. It stays terminal and counts `failed`, red at 2.

Downgrading it to a warning was considered and rejected: the recipient would
settle, the notice would be consumed, the outbox would drain to empty, and
`outboxLiveness`'s backlog alarm would see nothing — while `outboxLiveness` mails
through the same disabled `sendEmail` (`outboxLiveness.ts:171`) and so could not
report either. A dropped environment variable would yield a fully green pipeline
delivering nothing to anyone.

Only the test firewall (`delivery blocked`) counts `skipped`, and that is inert:
stage 1 gates it at `outboxSweep.ts:662`, and both it and `sendOne`'s check reduce
to `evaluateDelivery(process.env)` (`deliveryFirewall.ts:180-192,329-347`), so
they cannot disagree within one sweep.

## 2. Changes in the sweep

**2.1 `sendOne` records the recipient after the outcome.** The set is renamed
`attemptedRecipientIds` → `settledRecipientIds`. A recipient is settled when it
succeeded, was refused terminally, failed to render, had no usable address, or
was firewalled. **A retryable failure leaves it unsettled** and increments
`report.throttled`.

The comment at `outboxSweep.ts:911-916` ("The recipient is already in
`attemptedRecipientIds`, so a rejection would propagate…") becomes false when the
add moves and is corrected in the same delivery. `blockDelivery` never throws
(`deliveryFirewall.ts:327`), so `sendOne` still cannot reject in practice.

**2.2 The wave loop takes its existing exit on a tripped breaker.** After a wave
resolves, if `report.throttled > 0`, the loop takes the same `break` as budget
exhaustion, with the same `report.unserved += entries.length - i` accounting and
a distinct log event (`notify_sweep_throttled`) carrying the count and the
recipient that tripped it.

**2.3 Nothing else in the sweep changes.** `partitionClaimed`, `repend`,
`countLost`, and the branch ordering are untouched, and their existing tests must
pass unedited. That is the point of this revision.

### Counters

`SweepReport.failed` absorbs every `!res.ok` today, and the flush workflow turns
red at `failed >= 2` — so a refusal that re-pends correctly would light the alarm
in exactly the case this design fixes.

**The new counter is `throttled`.** `deferred` is already taken: it exists on
`SweepReport` (`outboxSweep.ts:118`) meaning *due notices left unclaimed*
(`:693,708,714`), documented in `docs/NOTIFICATIONS.md` and `docs/SECRETS.md`.
Reusing the name would corrupt an existing signal.

- `throttled` — incremented in `sendOne`, once per observed retryable failure.
  The breaker is evaluated after a wave resolves, not mid-wave, so a wave whose
  sends all get 4xx reports `throttled: 8` (`SEND_CONCURRENCY`), not 1. It is
  bounded by one wave, never by the whole notice.
- `failed` — terminal delivery failure, including "email disabled". Red at 2.
- `skipped` — nothing attempted, nothing lost.
- `lost` — **unchanged in meaning and in implementation.** No recipient is
  abandoned by this design, so `countLost` keeps its signature and its call site.

**`throttled` must be SUMMED across rounds in `aggregateFlushReports`**
(`app/api/cron/flush-notifications/route.ts:35-73`), alongside `failed`, `lost`
and `skipped` — not taken from the last round the way `deferred` and `repended`
are. The comment at `route.ts:56-58` already defends this for `failed`. In
practice the breaker ends the drain after the throttling round, so the last round
*is* the throttling one; summing is still specified, because a later refactor
that removes the drain break must not silently zero the signal.

**The workflow emits a `::warning::` when `throttled > 0`**, modelled on the
`skipped` precedent at `.github/workflows/flush-notifications.yml:102-104`. This
matters: today a Gmail block goes red immediately at `failed: 8 >= 2`; under this
design those sends are correctly preserved instead of destroyed, so without a
warning a real block would be silent. Existing thresholds and their order are
unchanged. `throttled` is added to `GATED_FIELDS`
(`app/api/__tests__/flushWorkflowGate.test.ts:44`) so the field name stays pinned
against the workflow's `sed` patterns.

The workflow's `lost` annotation points triage at
`notify_sweep_send_budget_exhausted`; that stays accurate, since this design adds
no new source of `lost`.

## 3. Testing

**`email.test.ts` — the classification rule**, against `classifySendFailure`
directly, no transport mock:

- 4xx on a live connection retryable; 5xx terminal.
- **`ECONNECTION` carrying a 4xx `responseCode` is terminal** — the round-1
  blocker, pinned as a regression.
- `EAUTH` carrying `454` is **retryable** — pins that the numeric rule governs
  and the table does not.
- `ETIMEDOUT`, `ESOCKET`, `ESTREAM`, `EDNS` with no `responseCode` terminal; our
  own timeout terminal; unrecognised shape terminal; `EENVELOPE` with no
  `responseCode` terminal; a Resend-shaped failure terminal.
- `retryable` is **absent**, not `false`, on an unclassified return
  (`deliveryFirewallTransports.test.ts:630` depends on it).

**`outboxSweep.test.ts` — the behaviour.** `sendEmailMock` is a plain `vi.fn()`
(`:16,107-110`).

- A retryable failure leaves the recipient unsettled and re-pends the notice.
- It counts `throttled`, not `failed`, and not `lost`.
- **The breaker stops the stage:** with a multi-wave notice, a refusal in wave 1
  means wave 2 is never attempted, and its recipients are accounted `unserved`
  and re-pended — asserted by counting `sendEmailMock` calls.
- The mixed case that killed the previous design: one notice with a refused
  recipient and a budget tail re-pends **both**, destroys neither, and writes one
  `notifyAfter` with no ambiguity.
- A terminal failure settles the recipient and counts `failed`.
- "Email disabled" counts `failed`, not `skipped`.

**`flushNotificationsRoute.test.ts`** — `drainOutbox` stops after a round with
`throttled > 0`; and `throttled` is summed, not last-round.

**Regression pins that must pass unedited:** every existing `partitionClaimed`,
`repend`, `countLost` and budget-exhaustion test. If any of them needs editing,
this design has failed its central claim and the change should be reconsidered
rather than the test adjusted.

One test **must** be edited, mechanically: `flushNotificationsRoute.test.ts`'s
`round()` helper (`:398-402`) enumerates every `SweepReport` field, so `tsc`
requires `throttled: 0` there. That is a compile requirement, not a behavioural
change.

**No production probe.** The classification is deterministic and the behaviour is
observable in unit tests. Whether Gmail's throttle arrives as a 4xx on a live
connection rather than an abrupt close is **unverified** and deliberately not
blocking: if it never fires, the design degrades to today's behaviour — every
failure terminal, nothing re-pended.

Plus the repository gates: `npx tsc --noEmit`, `npm test`, `npx eslint .` with 0
errors.

## 4. Risks

| Risk | Mitigation |
|---|---|
| Retrying a delivered message → duplicate to a real person | Only a 4xx retries, and `ECONNECTION` is excluded even carrying a 4xx (`smtp-connection/index.js:952,992,994`). Every other 4xx-carrying state is pre-DATA. |
| nodemailer changes its error surface | Unrecognised shapes default to terminal. |
| A real Gmail block becoming silent, since those sends no longer count `failed` | `throttled > 0` emits a workflow warning; the backlog grows and `outboxLiveness` alarms. |
| `throttled` silently serializing as 0 | Summed in `aggregateFlushReports`, pinned by a route test and by `GATED_FIELDS`. |
| A missing credential going unnoticed | "Email disabled" stays terminal and counts `failed`, red at 2. |
| Layer 2 not paced across invocations | Stated, bounded: one refused send per sweep, and the 15-minute debounce means a mutation burst does not produce a burst of due notices. |
| Unbounded re-pending against a permanently refusing server | Same behaviour the unserved path has always had; surfaced by the backlog alarm. Bounding it would mean destroying mail `SECRETS.md` guarantees is kept. |
| `repend` write failure duplicating successful sends | Pre-existing on the budget path (`:558-565`); this design routes more traffic through it, so the window widens. Named, not solved. |

## Files touched

- `app/utils/email.ts` — `classifySendFailure`; `retryable` threaded through
  `sendEmail` and `sendWithTimeout`.
- `app/utils/outboxSweep.ts` — settle-after-outcome, `throttled` counter, breaker
  in the wave loop, corrected comment at `:911-916`.
- `app/api/cron/flush-notifications/route.ts` — sum `throttled`; break the drain
  loop on it.
- `.github/workflows/flush-notifications.yml` — extract and warn on `throttled`.
- `app/utils/__tests__/email.test.ts`, `app/utils/__tests__/outboxSweep.test.ts`,
  `app/api/__tests__/flushWorkflowGate.test.ts`,
  `app/api/__tests__/flushNotificationsRoute.test.ts`.
- `docs/NOTIFICATIONS.md` — the breaker, the counters, and the serialized body
  string pinned at `:359`, which gains a field.
