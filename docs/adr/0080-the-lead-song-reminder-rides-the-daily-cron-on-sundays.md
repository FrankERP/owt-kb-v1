# ADR-0080: The lead song reminder rides the daily cron on Sundays

**Date:** 2026-11-05 · **Status:** Accepted

## Context

Frank asked (2026-11-04) for an email that reminds each Sunday's leads that they lead and must
choose the songs, sent the Sunday before in the afternoon or evening. Leads choose songs by
sending a setlist proposal (`/me/propose/[roleId]`); until 2026-11 nothing prompted them, and
push reaches almost nobody (0/36 on, 2026-10), so email is the channel. The plan is Vercel
Hobby: one cron a day. The daily cron, `/api/cron/service-reminders`, already runs at
`0 1 * * *` UTC, which is **19:00 CDMX** (Mexico has no DST since 2022), anywhere inside that
hour on Hobby.

## Decision

`sendLeadSongReminders` (`app/utils/leadSongReminder.ts`) runs inside that cron. On a CDMX
Sunday it reads every published service from Monday to the next Sunday with someone in Lead
(`LEAD_REMINDER_SCOPE = "week"`: Saturdays six days ahead, specials on their day) and emails
each lead of a service that still needs songs: no setlist songs and no proposal `pending` or
`approved`. A draft with songs or a `changes_requested` proposal gets its own wording. The
email names the co-lead, carries the pastor's message when there is one, and links the
proposal page. The lead's «Propuestas» email preference applies (`wantsNotification`, as on
every email to the same Lead seat). Sends run in parallel (the pool is `SEND_CONCURRENCY` wide),
BEFORE the sweep, and the sweep's deadline is derated by the time spent
(`sweepOptionsAfterReminders`); with less than `MIN_SWEEP_DEADLINE_MS` left the daily sweep is
skipped, since stage 7 could not reliably admit a send and layer 1 drains within five minutes.

## Rejected

- **An exact hour through layer 1** (the 5-minute Cloud Scheduler call to
  `/api/cron/flush-notifications`). It would allow "17:00 sharp", but a 5-minute tick fires
  many times in any window, so it needs a stored "already sent" marker per service and week:
  a new document type, a writer and a cleanup, for one email a week. 19:00–19:59 already
  matches "Sunday afternoon or evening".
- **A "sent" marker on the daily path.** Vercel can, rarely, deliver a cron event twice; the
  cost is a lead getting the same reminder twice. The existing «Sirves mañana» push on the
  same route has never had a marker either.
- **After the sweep.** The sweep can use up to 45 s of the route's 60; a reminder has no second
  chance that week, while the sweep is lossless (an unreached notice is re-pended for layer 1).
- **Serial sends.** Up to six or so leads × the 20 s `SEND_TIMEOUT_MS` could outlast the
  route; in parallel the step is bounded by one timeout plus the read.
- **A new preference switch.** The reminder reuses «Propuestas» (`emailProposals`, which also
  honours the legacy all-email opt-out). That row is shown only to admins (`EmailPrefToggles`),
  so a plain-member lead cannot turn it off from `/me`; a new switch is UI for a mail that
  reaches a person only on the weeks they lead. Ignoring preferences entirely was the first
  draft and was dropped in review: it would have been the one member email that skips them.

## Consequences

The hour is the daily cron's: moving that cron moves the reminder (and the outbox's last-resort
sweep). Switching to "only Sundays" is one constant. A Sunday run reads Sanity once more and
spends a few seconds of the route; a failure there is logged (`lead_reminder_failed`) and never
stops the alarms; if the step overruns (a send timeout), that day's sweep is skipped and left to
layer 1.

## Addendum, 2026-11-19: «Sirves mañana» by email too

The same route has always pushed «Sirves mañana» to whoever serves tomorrow. On 2026-11-19 no
member had push on, so that reminder reached nobody. Frank picked the fix from a proposal
(«Dale con las mejoras»): send it by email as well (`app/utils/serviceEveReminder.ts`,
`docs/NOTIFICATIONS.md` §«Sirves mañana»). It inherits this record's trades: the daily cron's
hour (the evening before), no «already sent» marker (a duplicated cron event sends it twice),
best-effort sends before the sweep.

What it decides on its own:

- **The «Nuevas asignaciones» preference, not a new switch.** A reminder of a seat you were given
  belongs with the notice that gave it; the Jóvenes reminders made the same choice (ADR-0089,
  addendum). A sixth switch means a schema field, the preferences route, the member form and the
  dev-verify seed, for a choice nobody asked for. The row's hint now names it.
- **One email per person per day, not per service.** Someone on a special and the Sunday service
  gets one email naming both; two emails the same evening read as a duplicate.
- **Its own 35 s step deadline, before the Jóvenes reminders.** Tomorrow is the nearest deadline;
  the Jóvenes step is told what this one spent and shortens itself, as it already did for the
  leads' step. On an ordinary evening a wave takes about 2.6 s, so neither starves the other.
- **The push stays.** It costs nothing and will matter once the iOS app ships.
