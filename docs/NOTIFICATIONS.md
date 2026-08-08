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
the window collapse to silence.

**Key modules.** `outboxNotice.ts` (ids, snapshots, upsert builders) ·
`outboxClassify.ts` (snapshot vs live → lines) · `setlistDiff.ts` (the standings
table) · `notificationEmail.ts` + `emailShell.ts` (rendering) ·
`outboxSweep.ts` (the one pipeline) · `outboxLiveness.ts` (the alarm) ·
`notifyPrefs.ts` (the single preference resolver).

## The three flush triggers

| Layer | What | Where |
|---|---|---|
| 1 — primary | GitHub Actions, every 5 min | `.github/workflows/flush-notifications.yml` → `/api/cron/flush-notifications` |
| 2 — backstop | opportunistic sweep after any queueing write | end of `commitUpserts()` in `serviceMutationSideEffects.ts` |
| 3 — last resort | the daily Vercel cron | `/api/cron/service-reminders` |

**Layer 1 is load-bearing, not one of three redundant paths.** Layer 2 only
flushes subjects that have *already* gone quiet, so it can never flush the
terminal edit of a working session — and the terminal edit is what every notice
eventually is. If the GitHub workflow is broken or disabled, the realistic delay
is **up to 24 hours**, until layer 3 runs.

Layer 2 derates **both** knobs (half the recipient limit *and* half the send
budget), so the send-time inequality holds identically there. It does not fire on
proposal submit or review, which queue nothing; layer 1 covers those within five
minutes.

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
`{"claimed":0,"emailed":0,"consumed":0,"deferred":0,"unserved":0}`. The workflow
asserts the status code explicitly rather than relying on `curl --fail`, which
ignores 3xx — see the landmine below.

**A red run does not always mean the cron is broken.** The job also fails when the
report carries `unserved > 0`, which means the opposite of a dead trigger: the
sweep ran, claimed those recipients, never reached them, and — because stage 8
consumes whatever was claimed — **deleted their notifications**. Nothing else
reports it. The outbox is empty afterwards, so the staleness alarm sees nothing
wrong and the route still answers 200; going red here is the only signal mail was
lost. `deferred > 0` is the healthy counterpart: work left *unclaimed* for the
next sweep, which is not loss.

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

**Put back notices a lossy flush spent.** After a sweep reports `unserved > 0`,
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
- **A batch larger than the budget is DESTROYED, not deferred — this is the open
  wound.** Stage 8 consumes every claimed notice whatever stage 7 returned (§1,
  best-effort, no retry). That is sound when `ms_per_send × EMAIL_LIMIT` fits the
  budget, and catastrophic when it does not: at ~13 s per send only **two**
  recipients are serviceable per sweep, so a 17-seat Sunday claims all 17, serves
  2 and deletes 15. It happened on 2026-08-07 — one confirmed delivery out of 17,
  and the notices gone. Until either `ms_per_send` or `NOTIFY_FLUSH_EMAIL_LIMIT`
  comes down to meet §1's inequality, **any fan-out wider than two people is
  mostly loss that still reports green.** Selection already knows how to leave
  work behind (`report.deferred`); it is the limit that is wrong, not the
  mechanism.
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

Renders all twelve templates, asserts the email-client constraints, and writes
previews plus `.eml` files:

```bash
PREVIEW_EMAILS=1 npx vitest run app/utils/__tests__/emailTemplateGallery.test.ts
```

Open a `.eml` in a mail client to check real rendering — it goes through the same
pipeline a received message does, with no SMTP credentials and nothing sent.

## Still open

- **The send-budget inequality holds only because the limit was cut to 2, and
  that is a trade, not a fix.** Spec §1 requires
  `ms_per_send × NOTIFY_FLUSH_EMAIL_LIMIT < NOTIFY_SEND_BUDGET_MS`. Production
  measured `ms_per_send` = **14 413 ms** (2026-08-07), against the 500 ms
  `MEASURED_MS_PER_SEND` placeholder in `outboxSweep.test.ts` — 29× out. At the
  code default of 40 that is `14 413 × 40 = 576 520` against a 40 000 ms budget,
  and everything unserved is **destroyed**, because stage 8 consumes
  unconditionally. Production therefore runs `NOTIFY_FLUSH_EMAIL_LIMIT = 2`, where
  `14 413 × 2 = 28 826 < 40 000` and the inequality is satisfied. Concurrency
  cannot widen this — see the landmine above.

  What that buys and what it costs: role notices are now lossless and
  **fragmented** (a member's month arrives as several emails instead of one),
  which is the wrong shape for a monthly publish but the right side of "wrong".
  **It does nothing for `setlist` notices**, which carry every participant in ONE
  document and so cannot be split by any cap — they are taken alone, over budget,
  and everyone past the second recipient is destroyed.

  Two things close this, and no amount of tuning does: the **~14 s remote accept
  on the mail server**, or **re-pending notices the sweep never attempted instead
  of consuming them** (grouped *and* lossless across several sweeps, since a
  recipient's notices stay together). The second changes the consume contract and
  needs a plan and review. **Raising `MEASURED_MS_PER_SEND` to make the guard
  green remains the one forbidden move** — the guard is green today only because
  it asserts the default limit of 40, not the 2 production runs.
- **Outlook on Windows is untested.** macOS Outlook is WebKit, so the Word-engine
  question spec §6 raises — `border-radius` and `padding` on the key pills — is
  unanswered. Expected degradation is cosmetic: squared chips, tighter padding.
- **A weekend setlist saved before its role exists never notifies.** Rare and
  accepted; see spec §11.
