# Notification emails — how it runs, and what to do when it doesn't

Members get an email when the setlist of a service they serve appears or
changes, and when they are added to, removed from, or moved within a service.
Changes are debounced 15 minutes per subject and grouped into one email per
person.

- **Design and reasoning:** [`superpowers/specs/2026-07-27-service-notification-emails-design.md`](superpowers/specs/2026-07-27-service-notification-emails-design.md) — the authority on every rule.
- **Implementation plan:** [`superpowers/plans/2026-07-27-service-notification-emails.md`](superpowers/plans/2026-07-27-service-notification-emails.md).
- **Secrets:** [`SECRETS.md`](SECRETS.md).

Shipped 2026-07-28. Sanity schema deployed to `ebb8vcnk`/`production`.

---

## The shape of it

A `notificationOutbox` document buffers "this subject changed" notices. A sweep
classifies each against **live** state, groups the resulting lines per recipient,
sends one email each, and deletes them.

```
writer commits ──▶ after() queues a notice (own transaction, writeClient)
                        │
                        ▼
              notificationOutbox  ◀── debounced: notifyAfter slides 15 min
                        │              per edit, hard ceiling 60 min
                        ▼
   sweep: gate ▶ select ▶ claim ▶ classify ▶ filter ▶ group ▶ send ▶ consume
```

Reading live state at send time rather than storing an "after" snapshot is what
makes the email never stale, and makes any change that nets out to nothing inside
the window collapse to silence. **The proposal thread is the one exception to
the second half:** it diffs a message COUNT against an append-only array, so a
repeat does not net out to nothing and does not collapse. See "The proposal
thread" below.

**Key modules.** `outboxNotice.ts` (ids, snapshots, upsert builders) ·
`outboxClassify.ts` (snapshot vs live → lines) · `setlistDiff.ts` (the standings
table) · `notificationEmail.ts` + `emailShell.ts` (rendering) ·
`outboxSweep.ts` (the one pipeline) · `outboxLiveness.ts` (the alarm) ·
`notifyPrefs.ts` (the single preference resolver) ·
`proposalNotifyQueries.ts` (the GROQ the proposal notifications read with — a
leaf with no client, so a test can execute the queries with `groq-js` instead of
hand-writing a fixture that mirrors them).

## The three flush triggers

| Layer | What | Where |
|---|---|---|
| 1 — primary | GitHub Actions, declared every 5 min — see §"Layer 1 does not run every five minutes" | `.github/workflows/flush-notifications.yml` → `/api/cron/flush-notifications` (drains up to 5 sweeps per tick when work is re-pended) |
| 2 — backstop | opportunistic sweep after any queueing write | end of `commitUpserts()` in `serviceMutationSideEffects.ts` |
| 3 — last resort | the daily Vercel cron | `/api/cron/service-reminders` |

**Layer 1 is load-bearing, not one of three redundant paths.** Layer 2 only
flushes subjects that have *already* gone quiet, so it can never flush the
terminal edit of a working session — and the terminal edit is what every notice
eventually is. If the GitHub workflow is broken or disabled, the realistic delay
is **up to 24 hours**, until layer 3 runs.

Layer 2 derates **both** knobs (half the recipient limit *and* half the send
budget) — but the budget is derated ABOVE THE RESERVE, not as a whole:

```
layer 2 sendBudgetMs  =  SEND_TIMEOUT_MS + (SEND_BUDGET_MS − SEND_TIMEOUT_MS) / 2
```

A send is admitted while `elapsed + SEND_TIMEOUT_MS <= sendBudgetMs`, and that
reserve is the worst case of ONE send, so it cannot shrink with the budget.
**Halving the budget as a whole did not derate layer 2, it disabled it:** at 20 s
the check read `elapsed + 20 000 > 20 000`, false only at zero, so layer 2 sent
exactly one email per sweep at any latency while its recipient limit said 20.
Fixed 2026-08-27. On the shipped defaults layer 2 now gets 30 s — half of layer 1's
spendable 20 s — which is nine sends at the ~1.2 s measured on Gmail and still one
at the 14.4 s of the retired server, the conservative behaviour the original
halving intended. `SWEEP_DEADLINE_MS` is unchanged, so the worst case an
invocation can spend does not widen. It does not fire on
proposal submit or review, which queue nothing; layer 1 is what covers those —
nominally within five minutes, in practice at a 41-minute median (§"Layer 1 does
not run every five minutes"). The proposal-submit **email** (`buildProposalEmail`) is immediate, not
queued: intro + CTA, the same setlist table as "Setlist listo" (no Mov. column,
medleys grouped), and the lead's newest `lead_note` message when the thread has one — the same thread source as the debounced email below, moved in the same delivery that stopped writing the legacy field. Empty or unreadable songs still
send the intro and CTA. Push stays a one-line alert.

## Send throughput on Gmail — measured 2026-08-27

`NOTIFY_FLUSH_EMAIL_LIMIT=2` in production is calibrated for a server that no
longer sends. The sender moved to Gmail SMTP (see `docs/SECRETS.md`); this is the
first real measurement on it, and the first that means anything — on
`mail.oasis.mx` the fan-out was slow enough that reaching the whole audience was
the exception.

**What happened.** One `setlist` notice for 2026-08-30 with 14 recipients, flushed
manually at 17:43 UTC. The sweep reported:

```
{"rounds":1,"claimed":1,"emailed":14,"consumed":1,
 "deferred":0,"unserved":0,"repended":0,"lost":0}
```

**What that PROVES, by arithmetic rather than by stopwatch.** `SEND_CONCURRENCY`
is **1** — sends are serial, which is ADR-0013's decision — and the send loop
checks `elapsed + SEND_TIMEOUT_MS (20 s) > NOTIFY_SEND_BUDGET_MS (40 s)` before
each send, stopping and recording `unserved` when it trips.

- At the old 14 413 ms/send: send 1 passes, send 2 passes (14.4 + 20 < 40), send 3
  trips (28.8 + 20 > 40). Result would be `emailed: 2, unserved: 12`.
- Observed: `emailed: 14, unserved: 0`. For the 14th send to start, the first 13
  had to fit inside 20 s → **≤ ~1.5 s per send**. The GitHub step's wall clock
  (~17 s end to end, including curl, reads and consume) puts it nearer **1.2 s**.

So Gmail is roughly **10–12× faster** than `mail.oasis.mx` on this path.

**What it does NOT prove.** This is a bound derived from the sweep's report, not
the authoritative `msPerSend` on the `notify_sweep_done` log line — Vercel's log
retention on this plan had already dropped that line by 19:15. Treat the number as
an order of magnitude with a firm ceiling, not a precise figure. To get the exact
one, read the log within the hour of a real sweep, or run
`scripts/measure-send-budget.mjs --to=you@example.com --apply` with the app
password.

**What it unlocks — and USE THE RIGHT INEQUALITY.** The design spec states the
release gate as `ms_per_send × NOTIFY_FLUSH_EMAIL_LIMIT < NOTIFY_SEND_BUDGET_MS`,
i.e. against 40 000 ms. **The runtime is stricter than that**, and the difference
is a factor of two: the loop stops when `elapsed + SEND_TIMEOUT_MS (20 s) > 40 s`,
so only the first **20 s** are actually available for sending. Serial sends of
duration `d` therefore fit

```
N  =  floor(20 000 / d) + 1
```

**There is a second clock, and it can bind first.** The same check also refuses a
send when `elapsed_since_sweep_start + SEND_TIMEOUT_MS > SWEEP_DEADLINE_MS (45 s)`,
so the sending window is really `min(20 s, 25 s − read_phase)`. At the recommended
limit of 12 — 14.4 s of sending at 1.2 s each — a read phase over ~10.6 s lowers
the ceiling with no separate signal. `stoppedBy` on the
`notify_sweep_send_budget_exhausted` log line says which clock stopped it.

| sender | ms/send | N (runtime) | spec's looser form |
|---|---|---|---|
| `mail.oasis.mx` | 14 413 (measured 2026-08-07) | **2** — which is why production runs 2 | 2 |
| Gmail | ~1 200 (bounded 2026-08-27) | **17** | 33 |

The 14 sent on 2026-08-27 are consistent with the runtime form and not a fluke:
13 × 1 200 = 15 600 < 20 000, with room for three more.

**Nothing has been raised.** The code's default of 40 needs `d ≤ ~512 ms` under the
runtime form, which Gmail does not meet. A value around **12** would be safe at the
bounded latency with margin for a slow day. Raising `NOTIFY_FLUSH_EMAIL_LIMIT` is a
deliberate change that should follow a direct measurement rather than this bound —
and `MEASURED_MS_PER_SEND` in `outboxSweep.test.ts` is a guard on the shipped
defaults, never a place to write an observed number.

## Layer 1 does not run every five minutes

The flush cron is declared `*/5 * * * *` in
`.github/workflows/flush-notifications.yml`, and the route's own comment calls it
"the PRIMARY one, and genuinely load-bearing". **The schedule is not honoured.**
Measured over 98 consecutive scheduled runs, 2026-08-23 to 2026-08-27:

| | |
|---|---|
| declared interval | 5.0 min |
| minimum observed | 17.3 min |
| **median** | **41.3 min** |
| mean | 56.0 min |
| maximum | **682 min (11.4 h)** |
| intervals ≤ 10 min | **0 of 98** |
| intervals > 60 min | 18 of 98 |

GitHub documents `schedule` as best-effort: the five-minute minimum bounds what
you may REQUEST, not what runs, and high-frequency schedules are delayed under
load. No GitHub plan changes this, and neither more `schedule` entries nor
self-hosted runners help — the trigger is the bottleneck, not the runner.

**The practical consequence:** a notice becomes due 15 minutes after it is queued,
and layer 2 (the writer's own `after()` sweep) has already run by then, so layer 1
is what must come back. On the median it comes back at 41 minutes; on a bad day it
does not come back for half a day. Layer 3's liveness alarm is daily, so a stall
shorter than that is invisible.

**Mitigation, not yet applied:** an external scheduler (Google Cloud Scheduler —
the project already runs GCP for the solver — or a free cron service) hitting
`/api/cron/flush-notifications` with `Authorization: Bearer $CRON_SECRET` in the
HEADER, never in the `?secret=` query string, where it would land in access logs.
Keep the GitHub workflow as a second, independent trigger rather than replacing
it. Blocked as of 2026-08-27 on `CRON_SECRET` being unrecoverable by design — it
is `Sensitive` in Vercel and write-only in GitHub Secrets — so wiring a third
consumer means either supplying the stored value or rotating it in all three
places at once.

## The proposal thread — what it notifies

Released 2026-08-26. `lead_notes` / `admin_notes` became a `messages[]` thread.

**The debounced admin email now reads the THREAD, not `lead_notes`** (Child B
slice 1). `PROPOSAL_QUERY` no longer projects
`lead_notes` at all: the notice stores `before.beforeMessageCount`, the
pre-commit count of `kind == "lead_note"` messages, and the flush emails
everything appended since that index. **The legacy fields are no longer written
at all** (slice 2): the lead message route, both branches of the save route and
the `request_changes` transition have all stopped mirroring. `lead_notes` and
`admin_notes` are a FROZEN archive — nothing blanks them, nothing updates them,
and the thread is the only record of what was said.

Audience, debounce and preference key are unchanged: the same admin set resolved
at flush, the same 15–60 minute window, the same `notifPrefs.emailProposals`.

A notice minted before that cutover carries `beforeNotes` and no count. It is
classified against the thread too — against the **newest `lead_note` body**,
which is precisely what the mirror held — never dropped. Dropping would be safe
and not correct: a notice that yields no pairs contributes no pending recipients,
so `report.lost` stays 0 while a real message vanishes.

**Both directions of the conversation now reach their counterpart** (Child B
slice 3). **Released to production 2026-08-27** in `c47d30ad` (PR #10),
production alias verified by `alias` + `meta.githubCommitSha`, and the
`notificationOutbox` schema redeployed with `beforeMessageCount` in the same
delivery. They did
not before: `queueLeadNotesNotice` requires the pre-write status to be `pending`
or `changes_requested`, and production holds **13 approved proposals, 1 draft,
and zero in either reviewable status** — so before slice 3 a message posted on a
real proposal notified NOBODY, in either direction.

| Who posts | Where | Signal |
|---|---|---|
| Lead, on `pending` / `changes_requested` | thread | the debounced admin **email** |
| Lead, on `approved` — **the dominant real case** | thread | **push to admins**, `/admin` |
| Lead, on `draft` | thread | nothing — a draft is not in front of admins yet |
| Admin, standalone message | thread | **push to the lead** + contributors, "Nuevo mensaje" |
| Admin, via `request_changes` / `reopen` | transition | unchanged review push, exactly one |
| Lead, first submission | save | unchanged `notifyProposalSubmitted` |

**AT MOST ONE SIGNAL PER MESSAGE** — never both, and in one named case neither — an email or a push, never the pair. The
gate for the lead→admin push is `status === "approved"`, nothing looser: "a
status the outbox will not cover" is a NECESSARY condition only, and read as
sufficient it fires on `draft` too. Neither branch is reachable by hand in
production, so it rests on `proposalMessageRoutes.test.ts` composed with
`serviceMutationSideEffects.test.ts` — the first pins the push, the second pins
that the status handed to the outbox helper queues nothing.

Four named exceptions, all inherent and none introduced here. Three send twice:
the outbox's send-budget re-pend can re-send a joined body to an admin already
served; a status round-trip inside one 60-minute window can email a message that
was already pushed; and a re-submit fires `notifyProposalSubmitted`, which pushes
and emails admins as it always has (outside this delivery and unchanged by it).

The fourth sends **nothing**, which is why the invariant is "at most one" rather
than "exactly one". A lead posts while `pending`, so a notice is queued and no
push fires. An admin reads the thread and approves inside the 15–60 minute
debounce — the ordinary flow, since reading the message is what prompts the
approval. At flush the live status is no longer reviewable, the notice
classifies to `null`, and it is consumed. The other admins never learn the
message existed, and `report.lost` stays 0. Pre-existing and named in Child B's
plan; closing it would mean firing a push the email was meant to cover, or
widening the flush gate.

**These pushes are not debounced.** N messages, N pushes. Acceptable at this
team's volume; if it becomes noise the fix is a push debounce, not a wider email.
They also gate on a different preference axis from the email: `sendPush` reads
`notifPrefs.proposals` via `optedIn`, while the email reads `emailProposals` via
`wantsNotification`. Independent on purpose — do not "unify" them.

The debounced email's subject is **"Mensajes de la propuesta"**, not "Notas del
líder" — the thread carries admin replies and the body can be several messages
joined. `SUBJECT` feeds both the subject line and the in-body header, so that is
one constant and two visible strings. One accepted drift: the submit email's
section label stays "Notas del líder", so a member sees two names for one thread.

Three smaller behaviours worth knowing. The first two CHANGED with slice 1 and
supersede what Child A §1 named as accepted gaps:

- **A repeated identical message now queues and emails — ON THE THREAD ROUTE.**
  It used to be suppressed twice over: `queueLeadNotesNotice` compared the notes
  trimmed, and so did the flush classifier. Neither comparison is on the path a
  new message takes any more — the queue side has no "after" string to compare
  against, and the flush diffs a count against the thread. (`classifyLeadNotes`
  and its trimmed comparison still exist, and are still reached, on the
  legacy-notice arm of the sweep.) Posting `"ok"` twice inside one window sends one
  email whose body is `ok` / `ok`. An improvement, and intended: a lead repeating
  themselves is saying something.

  The legacy `leadNotes` save path still declines an unchanged note, in the
  route rather than in the queue helper (`notesChanged` in
  `app/api/me/proposals/route.ts`) — that predicate is now load-bearing alone,
  and it is what stops a client re-sending its one-time initializer from minting
  a bubble on every save.
- **Two messages inside one window produce one email carrying BOTH**, joined by a
  blank line, not only the newest. The debounce deliberately collapses a burst,
  and dropping the middle of a conversation is worse than a longer email. The
  bound is the window; the nominal ceiling is `PROPOSAL_MESSAGES_MAX` ×
  `PROPOSAL_NOTES_MAX` = 200 × 4000 ≈ 800 KB, which no realistic window reaches.
- A pre-deploy client that deliberately CLEARS the note textarea is ignored,
  which retires a signal that used to fire. Unchanged by slice 1.

## The liveness alarm

The daily cron reports the oldest `firstQueuedAt` across notices in **either**
status — `pending` *and* `sending`, because one stuck mid-fan-out sits in
`sending`. Past `NOTIFY_STALE_ALERT_HOURS` (6) it logs a structured error **and
emails the super-admins**.

The email is the whole mitigation, not belt-and-braces: this repo has no log
drain and Vercel Hobby offers no alerting, so a `console.error` in a daily cron
has no consumer.

**It measures before the sweep runs, deliberately.** Measuring after would read
an outbox the sweep had just emptied and report healthy — which is exactly the
"layer 1 is dead" scenario it exists to catch. If you ever reorder that, the
alarm stops working while continuing to look fine.

## Operating it

**Is layer 1 alive?**

```bash
gh run list --workflow="Flush notification outbox" --limit 5
```

**Force a sweep now:**

```bash
gh workflow run "Flush notification outbox"
```

A healthy run prints `HTTP 200` and a report like
`{"claimed":0,"emailed":0,"consumed":0,"deferred":0,"unserved":0,"repended":0,"lost":0,"rounds":1}`. The workflow
asserts the status code explicitly rather than relying on `curl --fail`, which
ignores 3xx — see the landmine below.

**A red run does not always mean the cron is broken.** The job fails when the
report carries `lost > 0`, which means recipients were claimed, never reached,
and their notices were **consumed anyway** — permanently deleted. `unserved > 0`
with `repended > 0` is normal: the send budget stopped early and those recipients
wait for the next sweep (declared five-minutely; median 41). `deferred > 0` is also healthy:
work left *unclaimed* for the next sweep.

**Is the mail path healthy, and where is its time going?**

```bash
gh workflow run "Probe the SMTP path"
```

Connects, greets, authenticates, asks about a recipient, quits — **no mail sent**
— and reports per-command timings, so "sending is slow" becomes a statement about
which SMTP phase is slow. Reachability from a laptop proves nothing; this measures
Vercel's egress, which is the only path that matters. Inputs:

| input | meaning |
|---|---|
| `to` | whose address `RCPT TO` asks about. Blank = our own mailbox (LOCAL, no callout). An external address tests whether Exim calls out to their MTA |
| `repeat` | readings to take, 1–5, so a figure has variance behind it |
| `data` | `1` submits a REAL message and times `DATA` — the only option that sends anything. Refused for every recipient but our own sending mailbox |
| `bytes` | body padding for a `data` run; scan cost tracks size, so compare `0` against `20000` |

It also reports `redirectTo`, which is the only way to see whether
`EMAIL_REDIRECT_TO` is quietly diverting the whole team's mail.

**Put back notices a lossy flush spent.** After a sweep reports `lost > 0` (not
merely `unserved > 0` — unserved with `repended > 0` is retried automatically),
those notifications are gone; this re-queues them for the affected services:

```bash
npx tsx --env-file=.env.local scripts/requeue-role-notices.mjs <roleId> [<roleId>…]
```

Dry run by default — add `--apply` to write, `--now` to skip the debounce. **Run
it with `tsx`, not bare `node`:** it imports the real `queueRoleNotices` helpers so
a notice minted here cannot drift in shape from one minted by a save, and those
modules use extensionless specifiers Node's ESM loader refuses. Members already
notified will receive a duplicate — that is usually the right trade against
someone never being told they serve.

**Put back a destroyed setlist notice** the same way:

```bash
npx tsx --env-file=.env.local scripts/requeue-setlist-notice.mjs <roleId> --apply --now
```

Uses an empty `beforeSongs` snapshot so every participant gets "Setlist listo".
Members already notified will receive a duplicate.

**Inspect the outbox** (Studio → the read-only *Cola de avisos* pane, or GROQ):

```groq
*[_type == "notificationOutbox"] | order(firstQueuedAt asc) {
  _id, kind, subjectKey, serviceDate, status, firstQueuedAt, notifyAfter, deadline
}
```

Nothing accumulates in normal operation — every claimed notice is consumed in the
sweep that claimed it. A backlog means layer 1 has stopped.

**Pruning is safe.** `notificationOutbox` is delete-only in the Studio by policy;
an entry is a debounce record, not a ledger. Deleting one loses at most one
pending notification.

## Configuration

| Name | Default | Meaning |
|---|---|---|
| `NOTIFY_DEBOUNCE_MINUTES` | 15 | Quiet period before a subject flushes |
| `NOTIFY_MAX_WINDOW_MINUTES` | 60 | Hard ceiling from first queue; defeats starvation |
| `NOTIFY_CLAIM_TTL_MINUTES` | 5 | Lease on a claimed notice; expiry makes it due again |
| `NOTIFY_SEND_BUDGET_MS` | 40000 | Wall-clock bound on the send loop |
| `NOTIFY_FLUSH_EMAIL_LIMIT` | 40 | Max recipients per sweep. **Currently overridden to `2` in Vercel Production — see `SECRETS.md`.** The "must exceed the largest per-service seat count" rule the default encodes is knowingly suspended there; see *Still open* |
| `NOTIFY_STALE_ALERT_HOURS` | 6 | Oldest age that trips the alarm |

All have code defaults and are validated (empty, non-numeric, zero and negative
all fall back). `CRON_SECRET` and `APP_BASE_URL` are covered in `SECRETS.md`.

## Landmines

Things that are counter-intuitive and were each a real defect at some point.

- **Never compare raw `medley_tag` values.** `normalizeMedleyTags` mints a fresh
  tag for every group on every editor write, so tag equality reports a change
  whenever any unrelated song moves. Snapshots store the **partition** — the
  index of the contiguous run — and a one-song run normalises to `null`.
- **`before` is captured pre-commit and threaded into `after()`.** Reading live
  state inside `after()` returns post-write state, making `before == after` for
  every notice — a system that silently sends nothing while passing its tests.
  A regression guard in `roleWriteRoutes.test.ts` mutates the store on commit and
  fails if the capture ever moves.
- **The claim is `Patch.commit()`, never `Transaction.commit()`** — the latter
  returns no `_rev` to assert at consume time. The consume is a
  revision-asserting no-op patch plus the delete in one transaction, because
  `delete()` takes no precondition.
- **A deleted role notifies only members whose before-snapshot is non-empty.**
  Otherwise creating a published service and deleting it minutes later mails
  every assignee about a service they were never told existed.
- **`/api/cron/*` must stay excluded from the session middleware.** It was not,
  and both cron routes 307'd to the sign-in page — including the pre-existing
  daily cron, which had been redirecting rather than running. The routes
  authenticate themselves with `CRON_SECRET`; session gating is the wrong gate
  for a machine caller. `routeMatcher.test.ts` enumerates every route off disk
  and pins exactly which are ungated.
- **The flush workflow asserts HTTP 200 explicitly.** `curl --fail` treats only
  4xx/5xx as errors, so the 307 above passed it — the job reported green on every
  run while the sweep never executed once. Layer 1's only failure signal is
  red-vs-green, so a green that means nothing is the worst failure it can have.
- **The email palette is light and deliberately not `brand.css`.** Five attempts
  to hold a dark palette against Outlook for Mac failed; see spec §6 for the full
  table. Client dark-mode transforms assume email is light, and there is no
  reliable hook to win from the sending side.
- **Unpublishing does not notify, and a date move does not notify.** Both are
  deliberate; see spec §1 and §4.
- **Concurrency does not help. Tested twice, and it makes things worse.**
  2026-08-07, ten messages in flight to ten DIFFERENT gmail addresses:
  `sendMs: 20020`, `emailed: 2`, and eight `SMTP send timed out after 20000ms`.
  In twenty seconds with ten connections open the server accepted **two** —
  the same rate it manages serially. The server serializes acceptance for remote
  recipients, so concurrency buys no throughput while turning would-be successes
  into destroyed notices (stage 8 consumes regardless). `SEND_CONCURRENCY` stays
  at 1, and the wave machinery in stage 7 stays with it, because both become
  correct the moment the server does. Recorded as **ADR-0013**. **Do not re-raise it on the reasoning that
  pooling or parallelism "should" help — that reasoning has now failed twice
  against measurement.**
- **Therefore the grouped monthly email cannot be delivered by tuning this
  codebase.** ~20 recipients × ~14 s is far past the hosting function's 60 s
  ceiling at any concurrency and any cap. Two things can fix it, and nothing else
  can: the **~14 s remote accept on the mail server**, or a change so the sweep
  **re-pends notices it never attempted instead of consuming them** — which would
  give grouped-and-lossless delivery spread over several sweeps, since a
  recipient's notices stay together and are either all served or all returned.
  The second is a change to the consume contract and needs a plan and review; the
  first is one setting on someone else's box and fixes everything at once.
- **Remote recipients cost ~14 s to ACCEPT; local ones cost 67 ms. That is the
  whole problem, and it is server-side.** Measured 2026-08-07 with
  `/api/cron/smtp-probe` (the *Probe the SMTP path* workflow): to a LOCAL
  recipient the entire SMTP conversation — connect, TLS, `EHLO`, `AUTH`,
  `MAIL FROM`, `RCPT TO`, `DATA` and a 20 KB body — completes in **under 600 ms**,
  with the body accepted in 67 ms. `RCPT TO` for an external address is equally
  fast (~35 ms), so it is not recipient callout verification. Yet a real send to
  an external recipient measured **`msPerSend` 14 413 ms** across two successful
  sends. Accepting for remote delivery is the only step left, which points at the
  server delivering synchronously rather than queueing. Ask the host why
  `cp1-dal1.bioxnet.com` takes fourteen seconds to accept a remote message when a
  local one takes 67 ms — everything on this page downstream of that number gets
  easier the moment it comes down.
- **The load that matters is a MONTHLY ROLE PUBLISH, and grouping is the
  requirement — not a nicety.** A month's services are generated and published
  together, so one sweep owes every affected member ONE email covering every
  service they serve that month. August 2026 is 7 services and 88 seats over
  ~20 people. Stage 6 groups what stage 3 claimed, so grouping only happens for
  recipients served in the SAME sweep — which makes
  `NOTIFY_FLUSH_EMAIL_LIMIT` a product setting, not just a safety valve: below
  the month's distinct-recipient count the fan-out fragments into per-service
  singles. (Singles are correct for **setlist** notices, which are published one
  service at a time. They are wrong for a role publish.) The consequence is that
  serial sends are not merely slow but unusable, and
  `ceil(recipients / SEND_CONCURRENCY) × ms_per_send < NOTIFY_SEND_BUDGET_MS` is
  the inequality the design actually has to satisfy — §1's version assumes
  concurrency of one.
- **A batch larger than the budget is re-pended, not destroyed.** Stage 8
  consumes only notices whose every intended recipient was attempted. Recipients
  the send stage never reached stay on a re-pended notice (`repended` in the
  sweep report) with `servedRecipients` recording who was already attempted, so
  the next sweep emails **new** people instead of retrying the first two.
  A writer re-queue on the same subject **clears** that list — a later edit is a
  new change. The GitHub workflow fails only on `lost > 0`. Failed sends still
  count as attempted (no retry for bad addresses).
- **The rehearsal harness distorts the thing it measures.** `EMAIL_REDIRECT_TO`
  points every message at ONE address, so a fan-out that would have gone to 17
  domains becomes 17 messages to one — and the big providers throttle exactly
  that. The 2026-08-07 rehearsal at 8-wide concurrency returned 16 timeouts and
  zero deliveries, which is strong evidence about one-domain bursts and weak
  evidence about the real case. Use the redirect to prove *safety* and *shape*;
  do not read throughput off it.
- **The send cost is in the MESSAGE, not the connection — measured, not assumed.**
  `/api/cron/smtp-probe` (the *Probe the SMTP path* workflow; it sends no mail
  except on the explicit `data: 1` path, which submits only to our own mailbox)
  reported `coldMs:428, warmMs:328, secondColdMs:200` from production on
  2026-08-07: TCP, TLS, greeting and AUTH together cost under half a second,
  against a whole send of ~13.4 s. So pooling is not what makes a batch fast —
  setup is already cheap. **This is where the reasoning went wrong at the time:**
  "therefore `maxConnections: 1` is the ceiling, so widen it" seemed to follow and
  did not, because the server serializes acceptance regardless. See the
  concurrency landmine above; that conclusion was tested twice and refuted twice.
  Before drawing conclusions from a slow sweep, run the probe — reachability from
  a laptop says nothing about Vercel's egress, and that confusion cost a day.
- **`sendEmail` must resolve within `SEND_TIMEOUT_MS` (20 s), on every path.**
  Nodemailer's own defaults are connection 120 s, greeting 30 s and socket 600 s
  — each at or past the hosting route's `maxDuration = 60` — so a mail server
  that accepts the connection and then stops answering does not fail the send, it
  hangs the whole invocation until the platform kills it. `email.ts` overrides all
  three and additionally races the conversation, because `socketTimeout` bounds
  *inactivity*, not total duration. A timed-out send does **not** tear down the
  pool — `socketTimeout` equals `SEND_TIMEOUT_MS`, so nodemailer destroys that one
  connection and dials a replacement at the same moment we abandon it, which is
  reclamation at the right granularity. (An earlier version closed the whole
  transport. That was defensible at `maxConnections: 1` and became friendly fire
  the moment sends could run alongside each other.) The ceiling is 20 s rather
  than 15 s because a typical send measured 14.4 s: at 15 s a merely
  slower-than-average send was killed, and a killed send is a notification
  destroyed.
- **The send stage answers to two clocks, and the second one is not a budget.**
  `NOTIFY_SEND_BUDGET_MS` deliberately starts at the first send and is never
  charged for the read phase — correct for spec §1's inequality, and not a bound
  on staying alive. `SWEEP_DEADLINE_MS` (45 s, measured from the top of the
  sweep) is the reserve that keeps stage 8 reachable. Without it, reads plus a
  full send budget reach `maxDuration` on their own, the process dies before it
  consumes what it claimed, the 5-minute lease re-offers the identical batch, and
  the next sweep dies in the same place. **This is not theoretical: it is what
  happened.** On 2026-08-06 sends began stalling mid-conversation; 28 claimed
  notices sat in `status:"sending"` for over a day, every flush run timed out at
  60 s, and the team received nothing. `notify_sweep_send_budget_exhausted` now
  carries `stoppedBy`, which names which clock stopped the stage — `sweep_deadline`
  means the read phase is crowding out the sends.

## Verifying the templates

Renders all thirteen templates, asserts the email-client constraints, and writes
previews plus `.eml` files:

```bash
PREVIEW_EMAILS=1 npx vitest run app/utils/__tests__/emailTemplateGallery.test.ts
```

Open a `.eml` in a mail client to check real rendering — it goes through the same
pipeline a received message does, with no SMTP credentials and nothing sent.

## Still open

- **The send-budget inequality and the recipient cap.** Spec §1 requires
  `ms_per_send × NOTIFY_FLUSH_EMAIL_LIMIT < NOTIFY_SEND_BUDGET_MS`. Production
  measured `ms_per_send` = **14 413 ms** (2026-08-07). Production runs
  `NOTIFY_FLUSH_EMAIL_LIMIT = 2` so each sweep sends at most two recipients
  before the budget stops; **setlist notices re-pend** for the next sweep
  instead of losing the tail. Role notices defer via selection when the union
  exceeds the cap. Fixing the ~14 s remote accept on the mail server would let
  the cap return toward 40 and collapse multi-sweep setlist delivery back into
  one. **Raising `MEASURED_MS_PER_SEND` to make the guard green remains the one
  forbidden move.**
- **Outlook on Windows is untested.** macOS Outlook is WebKit, so the Word-engine
  question spec §6 raises — `border-radius` and `padding` on the key pills — is
  unanswered. Expected degradation is cosmetic: squared chips, tighter padding.
- **A weekend setlist saved before its role exists never notifies.** Rare and
  accepted; see spec §11.
