# ADR-0013: Keep SMTP sends serial, and the recipient cap below the seat count

**Date:** 2026-08-07 · **Status:** **Reversed** 2026-08-27 on its central decision — `SEND_CONCURRENCY` is 8, not 1. No superseding ADR: the reversal is the retirement condition this ADR named for itself ("the ~14 s remote accept, fixed at the mail server"), met by replacing the server, so there is no new decision to record separately. The sender also moved to a third party, which this ADR had rejected. See the banner below; the measurements and the reasoning are kept as the record of why 1 was right against `mail.oasis.mx`

## Context

The notification outbox wedged for ~28 hours on 2026-08-06/07: every flush run
returned 504 `FUNCTION_INVOCATION_TIMEOUT` and the team received nothing. The
proximate defects were ours and are fixed (unbounded sends, no reserve for the
consume stage, serial claims). The standing constraint underneath them is not.

> **The sender has since moved.** These figures were measured against
> `mail.oasis.mx`; production now sends through **Gmail SMTP** as
> `dev.raccoon.labs@gmail.com`, because DNS verification for `oasis.mx` in Resend
> could not be completed — [ADR-0025](0025-mail-sends-through-a-gmail-account.md)
> is that decision, with the 140-send measurement behind it. The 14.4 s per remote recipient below is a property of
> the OLD server.
>
> **Gmail has since been bounded at ~1.2 s per send** (2026-08-27: one sweep,
> 14 recipients, `emailed: 14, unserved: 0` — which serial sends and the 20 s
> ADMISSION WINDOW, not the 40 s budget, make impossible above ~1.5 s/send:
> 20 000 / 13 = 1 538 ms). Roughly 10–12× faster. The derivation
> is in `docs/NOTIFICATIONS.md` §"Send throughput on Gmail"; it is a bound from the
> sweep's report, not the authoritative `msPerSend` log line.
>
> **AND THE DECISION IS REVERSED.** `SEND_CONCURRENCY` is **8** as of
> 2026-08-27, on Frank's report that concurrency was tested against Gmail and
> works. The refutation recorded below is not thereby wrong — it measured that
> **`mail.oasis.mx`** serialized acceptance for remote recipients, and a different
> server has no obligation to. That is the ADR's own retirement condition ("the
> ~14 s remote accept, fixed at the mail server"), met by replacing the server
> rather than fixing it.
>
> **AND IT HAS ITS PROBE.** `scripts/measure-send-budget.mjs` was run against the
> live Gmail transport on 2026-08-27, 16 messages per width, 0 failures:
> serial p95 **1 838 ms**; width 8, per-wave p95 **2 429 ms**. So eight in flight
> cost 1.32× one send and carry 8× the messages — the opposite of the retired
> server, where ten connections bought the same two messages serial managed. At
> width 8 the clock allows 72 recipients per layer-1 sweep against 11 serial.
> The rule this ADR set is therefore honoured rather than waived: the value
> answers to measurement, and now it has one. And the hazard is unchanged in kind but worse in
> consequence: the old server punished concurrency with timeouts that destroyed a
> batch, while Gmail punishes it with per-account throttling that would stop every
> send until it lifts.
>
> The KNOB is separate and still un-raised: `NOTIFY_FLUSH_EMAIL_LIMIT=2` was sized
> for 14.4 s at concurrency 1 and is now the binding constraint by two orders of
> magnitude. See `docs/NOTIFICATIONS.md` §"Send throughput on Gmail".

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

> **REVERSED 2026-08-27, by Frank.** The own-server fault was not fixed, and the lag
> is why: the team moved off `mail.oasis.mx` to a third-party sender — Gmail SMTP as
> `dev.raccoon.labs@gmail.com`. So the alternative this section rejects is what
> production now runs, and "the team runs its own mail server" no longer holds.
>
> The Resend path specifically remains dormant, but for a different reason than the
> one recorded here: its DNS verification for `oasis.mx` could not be completed —
> that zone is served by `ns1/ns2.softlayer.com`, not by the reachable cPanel, so
> the records never publish. See `docs/SECRETS.md`.
>
> **The DECISION below is unaffected.** Serial sending rests on unconditional
> consumption destroying an unserved tail, which is a property of the sweep and not
> of the transport. What the move changes is the measured latency, and therefore the
> knob — see the amendment at the top of this file.

## Consequences

A monthly role publish arrives as **several emails per member instead of one**,
spread over ~10 sweeps. That is the cost, and it is the wrong product shape,
accepted only because the alternative loses mail.

**`setlist` notices are still truncated, and no cap can fix them.** One setlist
notice carries every participant in a single document, so it is taken alone, runs
over budget, and everyone past the serviceable count is destroyed — two on the
server these figures describe, seventeen at the latency measured after the move.

If someone raises `SEND_CONCURRENCY` without new measurements, sweeps will report
`emailed: 0` while destroying whole batches, and the flush workflow will go red on
`unserved > 0` — which is now the only signal that mail was lost.

Two things retire this ADR, and nothing else does:

1. **The ~14 s remote accept, fixed at the mail server.** Then the cap rises, one
   sweep serves a whole month, grouping works, and `SEND_CONCURRENCY` stops
   mattering. **NOT "returns to 40"**, which this line used to say: 40 needs
   `ms_per_send ≤ ~512 ms` under the runtime admission rule, not the 2 s the loose
   inequality suggests. The move to Gmail is the closest this has come — see
   `docs/NOTIFICATIONS.md` §"Send throughput on Gmail" and the bold warning in
   `docs/SECRETS.md` — and it does not reach 40.
2. **Re-pending notices the sweep never attempted, instead of consuming them.**
   Grouped *and* lossless across several sweeps, since a recipient's notices stay
   together and are either all served or all returned. This changes the consume
   contract that spec §1 calls "Claim and delete", so it needs a plan and
   adversarial review — it is the "different outbox model" §1 says must be
   designed rather than discovered.
