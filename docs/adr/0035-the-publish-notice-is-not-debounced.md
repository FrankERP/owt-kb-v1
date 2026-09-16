# ADR-0035: The publish transition's setlist notice is not debounced

**Date:** 2026-09-16 · **Status:** Accepted

## Context

Publishing a service fires two independent signals, and only one of them was
fast. The consolidated publish EMAIL and its push go out immediately from
`notifyRolePublished`, outside the outbox entirely — spec §7's reasoning is that
"publishing is a single deliberate click and that email must not be delayed."
The **«Setlist listo» email**, which is the one that says *what the songs are*,
went through the outbox on the ordinary debounce.

That put the member-visible latency at **5 to 10 minutes**: 5 minutes of
`NOTIFY_DEBOUNCE_MINUTES` before the notice is due, plus up to one Cloud
Scheduler tick (ADR-0032) before anything sweeps it. Layer 2 — the opportunistic
sweep at the end of the very `commitUpserts` that writes the notice — ran while
the notice was still four-and-a-half minutes from due, saw nothing to claim, and
returned. An edit inside the window slid `notifyAfter` forward again, up to the
60-minute `deadline` ceiling.

The requirement that forced the choice: a published set must reach the team
**within five minutes of the click**, which the old path could not guarantee even
in the quiet case.

## Decision

`queuePublishedSetlistNotices` passes `PUBLISH_WINDOWS` (`{ debounceMs: 0 }`)
into `setlistUpsert` → `buildUpsert`, so the publish notice is due the instant it
is committed and layer 2's sweep — already ordered after the commit — sends it in
the same `after()` block. Delivery is seconds, not minutes.

This uses the override seam `buildUpsert` already had (`UpsertWindowOverrides`),
so the arithmetic is not duplicated and the default path is untouched. Only the
`false -> true` transition gets it. An ordinary setlist edit on an
already-published service still debounces exactly as before.

`maxWindowMs` is deliberately left at its default: `isDue` takes
`min(notifyAfter, deadline)`, so a zeroed `notifyAfter` already satisfies the
ceiling, and pinning it here would be a second way to say the same thing.

Carried by `app/utils/serviceMutationSideEffects.ts` (`PUBLISH_WINDOWS`,
`setlistUpsert`, `queuePublishedSetlistNotices`) and guarded by the five cases in
`describe("the publish transition sends immediately, not on the debounce")` in
`app/utils/__tests__/serviceMutationSideEffects.test.ts`.

## Rejected

- **Shorten the debounce and speed up the Scheduler** — `NOTIFY_DEBOUNCE_MINUTES=3`
  with `*/2` on the job, worst case 5 minutes exactly. Rejected on three counts.
  It is a GLOBAL retune: it moves every role notice too, and the 5-minute window
  was itself a measured choice (2026-09-10, six weeks of Sanity transaction
  history — a 15-minute window collapsed 9 bursts into 59 notices, a 5-minute one
  would have produced 63). It lands the worst case exactly ON the requirement
  with no margin, so any future Scheduler starvation breaks it silently. And it
  pays in every subject's latency for a guarantee only the publish click needs.
- **Leave it and raise the Scheduler to `*/1`.** Cloud Scheduler is priced per
  job rather than per execution, so this is free in GCP, but it cannot get below
  the debounce itself — the floor stays 5 minutes and the worst case 6. It also
  puts the tick interval (60 s) at exactly the route's `maxDuration`, so a busy
  sweep overlaps the next tick and splits one backlog across two sweeps sharing
  the SMTP width.
- **Send the setlist from `notifyRolePublished`, outside the outbox**, next to
  the assignment email. Rejected because it would duplicate the classify/group/
  preference pipeline that `outboxSweep` already owns — `wantsNotification`, the
  per-recipient grouping, `setlistDiff`'s table — and the outbox exists precisely
  so there is one of those, not two.

## Consequences

- **Publish-then-edit no longer collapses.** Publishing and then touching the
  setlist within a few minutes now sends «Setlist listo» and then «El setlist
  cambió», where the debounce used to merge them into one email. This was the
  explicit trade, accepted 2026-09-16: the guarantee was wanted more than the
  collapse. If it becomes noise, the fix is a short debounce on the publish
  notice (1–2 min), not a return to 5.
- **The collapse argument does not apply to the publish notice anyway.** Its
  before-snapshot is the constant `[]`, so `[] -> songs` can never net out to
  nothing the way an edit that is undone inside the window does. There was
  nothing for the debounce to collapse except the publish against a subsequent
  edit.
- **No new failure mode when the sweep is slow.** Layer 2 is derated (half the
  email limit and budget) and both publish routes are `maxDuration = 60`, so
  there is room; anything the sweep cannot finish is RE-PENDED, not lost, and the
  next Scheduler tick takes it. The worst case degrades to exactly the old
  behaviour and never below it.
- **Undoing this looks harmless and is not.** Dropping `PUBLISH_WINDOWS` at the
  call site restores a silent 5-to-10-minute delay that no gate would notice, so
  two of the guards assert on `isDue` — the sweep's own predicate — and die
  against the pre-fix code. A third asserts that ordinary edits STILL debounce,
  which is what fails if someone "simplifies" this by zeroing `DEBOUNCE_MS`
  inside `buildUpsert` instead.
