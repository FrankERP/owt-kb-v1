# ADR-0013: Keep SMTP sends serial, and the recipient cap below the seat count

**Date:** 2026-08-07 · **Status:** Accepted

## Context

The notification outbox wedged for ~28 hours on 2026-08-06/07: every flush run
returned 504 `FUNCTION_INVOCATION_TIMEOUT` and the team received nothing. The
proximate defects were ours and are fixed (unbounded sends, no reserve for the
consume stage, serial claims). The standing constraint underneath them is not.

> **The sender has since moved.** These figures were measured against
> `mail.oasis.mx`; production now sends through **Gmail SMTP** as
> `dev.raccoon.labs@gmail.com`, because DNS verification for `oasis.mx` in Resend
> could not be completed. The 14.4 s per remote recipient is a property of the OLD
> server and has **not** been re-measured on Gmail. Everything calibrated on it —
> `NOTIFY_FLUSH_EMAIL_LIMIT=2`, the 40 s send budget, and the inequality
> `MEASURED_MS_PER_SEND` guards in `outboxSweep.test.ts` — is therefore
> conservative rather than wrong: a faster server sends MORE per sweep than the
> budget assumes, never fewer. Re-measure with
> `scripts/measure-send-budget.mjs` before loosening any of them. The decision
> below stands on its own reasoning and is not invalidated by the move.

Measured from production, against `mail.oasis.mx`:

| what | cost |
|---|---|
| connect + TLS + greeting + `AUTH` | ~400 ms |
| `RCPT TO`, local **and** external recipient | ~35 ms |
| `DATA`, 20 KB body, **local** recipient | **67 ms** |
| a whole send to a **remote** recipient | **14 413 ms** |

Nothing in the SMTP conversation is slow except accepting a message for a remote
recipient, which is ~200× the local cost. That is a server-side property; the
same figures say it is not scanning, not a callout, not DNS, and not the network.

A sweep has a 40 s send budget inside a 60 s function. At 14.4 s per send that is
**two recipients per sweep** — against a monthly role publish that owes ~20 people
an email each.

## Decision

`SEND_CONCURRENCY = 1` (`app/utils/email.ts`), which also sizes the pool's
`maxConnections`. The wave machinery in `outboxSweep.ts` stage 7 stays, and is
correct at any width; the constant is the whole knob.

`NOTIFY_FLUSH_EMAIL_LIMIT = 2` in Vercel Production (`docs/SECRETS.md`),
deliberately **below** the 12–20 per-service seat count that spec §1 names as the
floor, and below the code default of 40.

`SEND_TIMEOUT_MS = 20_000`, above the 14.4 s typical send rather than the 15 s
that sat 600 ms over it.

## Rejected

**Concurrency.** Tried twice and refuted twice:

- 8 wide, 16 messages: `emailed: 0`, every send timed out. Dismissable — the
  rehearsal used `EMAIL_REDIRECT_TO`, so all 16 went to one Hotmail address.
- 10 wide, to **ten different gmail addresses**: `sendMs: 20020`, `emailed: 2`,
  eight `SMTP send timed out after 20000ms`.

Twenty seconds with ten connections open bought **two** accepted messages — the
same rate serial achieves. The server serializes acceptance for remote
recipients, so concurrency adds no throughput while converting would-be successes
into destroyed notifications (stage 8 consumes whatever was claimed). Serial is
not a compromise here; it is strictly better. **"Pooling/parallelism should help"
has now failed twice against measurement — do not re-derive it from first
principles a third time.**

**Raising `NOTIFY_SEND_BUDGET_MS`.** Bounded by `maxDuration = 60`, which Vercel
Hobby will not raise. There is no room behind it.

**Leaving the cap at 40 to preserve grouping.** Grouping is a real requirement — a
month's roles are published together, so a member should get one email covering
their month, and stage 6 can only group what stage 3 claimed. But at 40 the sweep
claims 20 recipients, serves 2, and **deletes the other 18**. Fragmented delivery
is the wrong shape; destroyed delivery is worse.

**A third-party sender.** `email.ts` already supports Resend and it would end the
problem outright. Rejected on the owner's instruction: the team runs its own mail
server, and a 14 s accept is a fault to fix rather than route around.

## Consequences

A monthly role publish arrives as **several emails per member instead of one**,
spread over ~10 sweeps. That is the cost, and it is the wrong product shape,
accepted only because the alternative loses mail.

**`setlist` notices are still truncated, and no cap can fix them.** One setlist
notice carries every participant in a single document, so it is taken alone, runs
over budget, and everyone past the second recipient is destroyed.

If someone raises `SEND_CONCURRENCY` without new measurements, sweeps will report
`emailed: 0` while destroying whole batches, and the flush workflow will go red on
`unserved > 0` — which is now the only signal that mail was lost.

Two things retire this ADR, and nothing else does:

1. **The ~14 s remote accept, fixed at the mail server.** Then the cap returns to
   40, one sweep serves a whole month, grouping works, and `SEND_CONCURRENCY`
   stops mattering.
2. **Re-pending notices the sweep never attempted, instead of consuming them.**
   Grouped *and* lossless across several sweeps, since a recipient's notices stay
   together and are either all served or all returned. This changes the consume
   contract that spec §1 calls "Claim and delete", so it needs a plan and
   adversarial review — it is the "different outbox model" §1 says must be
   designed rather than discovered.
