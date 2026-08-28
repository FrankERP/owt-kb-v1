# ADR-0025: Send mail through a dedicated Gmail account, not the church mailbox

**Date:** 2026-08-24 · **Status:** Accepted · **Salvaged and renumbered 2026-08-28**

> **This was written on 2026-08-24 as ADR-0023 and never merged.** It sat on the
> branch `claude/email-sending-solution-7b7045`, in a worktree that should have
> been removed at merge time, and its number was taken meanwhile by
> [ADR-0023](0023-thread-does-not-bump-the-approval-receipt.md).
>
> It is recovered because its MEASUREMENTS are the record of why the sender moved
> and why concurrency was raised — 140 sends at four widths, which nothing else in
> the repo carries. The decision and its reasoning are preserved verbatim below.
> **What changed after it was written is at the end, under "Since this was
> written"** — read that before acting on the last paragraph of Consequences,
> which describes a state the repo has left.

## Context

Every outbound email went through `contacto@oasis.mx` on `cp1-dal1.bioxnet.com`,
and that server takes **14 413 ms to accept a message for a remote recipient**
while accepting a 20 KB message for a *local* one in 67 ms (measured 2026-08-07,
`/api/cron/smtp-probe`). The asymmetry is the diagnosis: the server delivers
synchronously instead of queueing. It is not our box, and asking the host to fix
it produced nothing.

The consequence was not slowness but data loss. Stage 8 of the sweep consumes
claimed notices unconditionally, so a recipient the send budget never reached is
a notification destroyed. Production was forced down to
`NOTIFY_FLUSH_EMAIL_LIMIT=2` — two people served per sweep — which
[ADR-0013](0013-smtp-sends-stay-serial.md) and `docs/NOTIFICATIONS.md` both record
as making the monthly grouped publish (~20 recipients, one email each) impossible
to deliver by tuning this codebase.

## Decision

Send through a dedicated Google account over `smtp.gmail.com:465`, authenticated
with a Google **app password**. No code changed: `sendEmail`
(`app/utils/email.ts`) already prefers the SMTP backend whenever `SMTP_HOST` is
set, so this is the five `SMTP_*`/`EMAIL_FROM` variables in Vercel and nothing
else. See `docs/SECRETS.md` for the set and its rotation.

`EMAIL_FROM` carries the display name — `OWT Backstage <…@gmail.com>` — which is
what a member actually sees in their inbox. Gmail delivers that header unchanged,
with no rewrite and no "via" annotation (verified 2026-08-24).

Measured 2026-08-24, 140 sends, **0 failures**, no `421` throttling at any width:

| path | median | p95 |
|---|---|---|
| serial → gmail.com | 1 213 ms | 1 967 ms |
| serial → oasis.mx (external) | 2 627 ms | 3 090 ms |
| 4 in flight → oasis.mx | — | 2 665 ms **per wave** (666 ms/recipient) |
| 8 in flight → oasis.mx | — | 3 080 ms **per wave** (385 ms/recipient) |

**These are laptop figures, not Vercel's.** The authoritative number is
`msPerSend` on the `notify_sweep_done` log line. They are recorded here because
they are what justified the switch, not because they size any constant.

## Rejected

**Fix the mail server.** The right fix and the one that helps everything at once
— but it is one setting on someone else's box, it was asked for, and it did not
come. Waiting is not a plan.

**Resend, MailerSend or Brevo with a verified sending domain.** The obvious
choice, already half-built: `app/utils/email.ts` carries a Resend backend and the
package is installed. It needs a DKIM `TXT` record on a domain we control, and we
do not control one. `oasis.mx` is delegated to `ns1.softlayer.com` /
`ns2.softlayer.com`; edits made in the cPanel DNS editor land in a zone nobody
queries, which is why they appeared to do nothing. Buying a domain would work and
costs money, which the request explicitly excluded.

**Resend with no domain at all.** `onboarding@resend.dev` delivers only to the
Resend account owner. It cannot reach the team.

**Brevo or Mailjet with single-sender verification** (no DNS required). Sending
*as* a `@gmail.com` address through a third-party relay misaligns SPF and DKIM —
the classic path into spam folders. Sending through Google, where the signer and
the sender are the same party, aligns natively.

## Consequences

The sender is a `gmail.com` address, not the church domain. The display name
carries the identity, and **replies land in that Gmail inbox**, not at
`contacto@oasis.mx`.

The daily ceiling becomes Google's **500 recipients/day** (real load: ~150/month).

The credential is an app password on a personal-projects Google account. Give each
project its own app password so revoking one does not take down the others.

**[ADR-0013](0013-smtp-sends-stay-serial.md) no longer describes the server we
use.** Its `SEND_CONCURRENCY = 1` was measured against an Exim that accepted two
messages in twenty seconds with ten connections open; Gmail accepts eight in about
three. That pin is now a fact about a server we left. It is **not** thereby
retired: raising the width changes a production writer's concurrency, which
`CLAUDE.md` classes as a critical contract needing a plan and two approvals. Until
that lands, `SEND_CONCURRENCY` stays 1 and the sweep serves ~7 recipients per pass
instead of 2.

## Since this was written

**2026-08-27 — the width landed, and ADR-0013 is Reversed.** `SEND_CONCURRENCY` is
**8** and `NOTIFY_FLUSH_EMAIL_LIMIT` is **40**, released in that order — the cap is
only safe at the width, so shipping it first would have had a sweep claim 40, serve
about 11, and destroy the rest. Independently re-probed before the change (serial
p95 1 838 ms; 8 in flight, per-WAVE p95 2 429 ms) and then verified on the real
path from Vercel: 14 recipients in 2 waves in 5 210 ms, `unserved: 0`, `lost: 0`.
Those agree with the table above, measured four days earlier on a laptop.

**The reply problem is real and unaddressed.** `sendEmail` sets no `Reply-To` on
either transport, so a member who replies writes to that Gmail inbox and nothing
tells them not to. Noted here because the Consequences section above states the
fact without naming it as a gap.

**A throttle is still destructive, but no longer silent** (2026-08-28). A failed
send discharges its notice exactly like a successful one, so the mail is gone; the
sweep report now carries `failed` and `skipped`, and the flush workflow goes red on
a cluster. The `rateDelta`/`rateLimit` on the pool is a sustained-rate cap and
**not** a brake on the burst — nodemailer consults the limiter only after a send
succeeds, so the error path a throttle takes bypasses it. See
`docs/NOTIFICATIONS.md`.

If someone points `SMTP_HOST` back at `mail.oasis.mx`, every number above reverts
and the outbox returns to destroying notifications on any service above two seats.
