# ADR-0032: Layer 1 of the notification outbox runs on Google Cloud Scheduler

**Date:** 2026-09-10 · **Status:** Accepted

## Context

Layer 1 of the outbox — the five-minute flush that turns a debounced notice into
an email — was a GitHub Actions `schedule`. GitHub deprioritizes `schedule`
against every other event on the same repository, and since `main` became
PR-protected on 2026-08-24 every PR fires the `gates` workflow twice. The flush
cadence collapsed from ~2 runs/h to 0.1–0.3/h (issue #25; the measurement is in
`docs/NOTIFICATIONS.md` §"Layer 1 does not run on the schedule it declares").

The case that forced the decision: a setlist published on 2026-09-10 at 10:47 CST
came due at 11:02 and was still unclaimed at 12:02, because the last scheduled
run had been at 09:02 — a three-hour gap. It went out at 12:03 only because
someone ran `gh workflow run` by hand.

## Decision

A **Cloud Scheduler job** in the GCP project that already runs the solver
(`eloquent-figure-421401`, region `us-central1`, job `flush-notification-outbox`)
calls `GET https://owt-backstage.vercel.app/api/cron/flush-notifications` every
five minutes with `Authorization: Bearer $CRON_SECRET` in the header, a 90 s
attempt deadline and **no retries** — the next tick is five minutes away, and a
retry would overlap the sweep it is retrying.

The GitHub workflow **stays** as a second, independent trigger. Two callers
racing cannot double-send, because the sweep claims before it sends; a
collision does split one backlog across two sweeps that share the SMTP width,
which the workflow's `concurrency` group cannot prevent since it serialises
GitHub only against itself. That cost is accepted: the GitHub caller rarely
fires, and a split batch is still delivered.

`CRON_SECRET` now has three presenters/verifiers (Vercel, GitHub Actions, Cloud
Scheduler), and its rotation in `docs/SECRETS.md` writes all three in one command.

## Rejected

- **Vercel Pro.** Lifts the one-cron-per-day Hobby limit and needs no secret
  rotation. Rejected on cost: 20 USD/month for a five-minute cron the project
  can get for free. Reversible — if the project moves to Pro for another
  reason, move the schedule into `vercel.json` and delete the Scheduler job.
- **A lower declared cadence on GitHub.** Tried 2026-08-30 and reverted; the
  mechanism is repo busyness, not the cron expression. Do not re-run it.
- **A third-party cron service.** Same rotation cost as Scheduler, one more
  vendor, and no billing relationship. Scheduler was already one `gcloud`
  command away.
- **Leaning on layer 2.** It fires inside the writer's `after()` and so can
  never flush the terminal edit of a session. Mitigation, not a fix.

Cloud Scheduler is priced per job (first three per billing account free, then
0.10 USD/job/month), not per execution, so `*/5` costs the same as daily.

## Consequences

- **Live since 2026-09-10 12:58 CST.** The job was created PAUSED with a
  placeholder bearer, `CRON_SECRET` was rotated into all three stores
  (`docs/SECRETS.md`, steps 1–3 — twice, because the first pass echoed the
  value to a terminal), production was redeployed, the job resumed, and a
  forced tick returned success (`status.code` empty, as the docs predict).
- `gcloud` logs its arguments and the raw output of `describe` to
  `~/.config/gcloud/logs/`, so the header update runs with
  `CLOUDSDK_CORE_DISABLE_FILE_LOGGING=true`, and every `update` or `describe`
  of this job carries a `--format` projection — `update` echoes the whole job,
  header included, by default.
- A rotation of `CRON_SECRET` has a third destination. Forgetting Scheduler
  leaves it presenting the old value: every tick 401s silently in GCP and
  layer 1 degrades back to GitHub's starved cadence with nothing in the app
  going red. `gcloud scheduler jobs describe … --format="value(state,status.code,lastAttemptTime)"`
  shows the last attempt; check it after every rotation.
- The job is a GCP resource, not repo state. Deleting the GCP project, or the
  API being disabled, removes layer 1's primary caller with no diff in this
  repo. The daily liveness alarm in `/api/cron/service-reminders` is what makes
  a stalled layer 1 loud, with a detection window of up to 48 h.
- Pausing the job (`gcloud scheduler jobs pause`) is the off switch during an
  incident; it does not need a deploy.
