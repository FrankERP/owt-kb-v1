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
| `NOTIFY_FLUSH_EMAIL_LIMIT` | 40 | Max recipients per sweep — **must exceed the largest per-service seat count** |
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
- **`sendEmail` must resolve within `SEND_TIMEOUT_MS` (15 s), on every path.**
  Nodemailer's own defaults are connection 120 s, greeting 30 s and socket 600 s
  — each at or past the hosting route's `maxDuration = 60` — so a mail server
  that accepts the connection and then stops answering does not fail the send, it
  hangs the whole invocation until the platform kills it. `email.ts` overrides all
  three and additionally races the conversation, because `socketTimeout` bounds
  *inactivity*, not total duration. On a timeout the pooled transport is closed:
  `maxConnections: 1` means an abandoned `sendMail` still owns the only
  connection, so reusing it would make every remaining recipient in the batch
  wait out its own full timeout.
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

- **The send-budget measurement.** Spec §1 requires
  `ms_per_send × NOTIFY_FLUSH_EMAIL_LIMIT < NOTIFY_SEND_BUDGET_MS`.
  `MEASURED_MS_PER_SEND` in `outboxSweep.test.ts` is a **500 ms placeholder**.
  Every sweep that sends now logs `notify_sweep_done` with a real `msPerSend`;
  take the number from a production run and replace the placeholder.
  `scripts/measure-send-budget.mjs` can measure locally, but needs the mailbox
  password (not retrievable from Vercel — see `SECRETS.md`).
- **Outlook on Windows is untested.** macOS Outlook is WebKit, so the Word-engine
  question spec §6 raises — `border-radius` and `padding` on the key pills — is
  unanswered. Expected degradation is cosmetic: squared chips, tighter padding.
- **A weekend setlist saved before its role exists never notifies.** Rare and
  accepted; see spec §11.
