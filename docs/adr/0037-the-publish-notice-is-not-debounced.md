# ADR-0037: The publish transition's setlist notice is not debounced

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
the same `after()` block.

**For a single-service publish that is seconds, with no Scheduler tick involved.**
For a whole-month «Publicar todos» it is seconds for the first 20 distinct
recipients and up to one tick for the rest: layer 2 runs at `EMAIL_LIMIT / 2` =
20 against layer 1's 40, and stage 2 stops selecting once the recipient union
passes it, deferring the remainder. August 2026 was 7 services over ~20 people,
so a month publish sits right on that ceiling. The requirement is still met —
a deferred notice is already due, so the next tick takes it, which is at most 5
minutes — but "instant for everyone" would be the wrong thing to promise.

This uses the override seam `buildUpsert` already had (`UpsertWindowOverrides`),
so the arithmetic is not duplicated and the default path is untouched. Only the
`false -> true` transition gets it. An ordinary setlist edit on an
already-published service still debounces exactly as before.

`maxWindowMs` is deliberately left at its default: `isDue` takes
`min(notifyAfter, deadline)`, so a zeroed `notifyAfter` already satisfies the
ceiling, and pinning it here would be a second way to say the same thing.

Carried by `app/utils/serviceMutationSideEffects.ts` (`PUBLISH_WINDOWS`,
`setlistUpsert`, `queuePublishedSetlistNotices`) and guarded by the six cases in
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
- **Budget exhaustion is safe; a transport failure is not, and never was.**
  Recipients the sweep runs out of clock for move to `unserved` and are RE-PENDED
  (`partitionClaimed`), so that path degrades to the old behaviour and no worse.
  An ATTEMPTED-BUT-FAILED send is a different path: it is consumed, never retried
  (ADR-0026), so a transport refusal or a `SEND_TIMEOUT_MS` expiry destroys the
  «Setlist listo» notice. That was already true at layer 1 — this change moves
  *where* the attempt happens, not whether a failure destroys it. An earlier
  draft of this ADR claimed "no new failure mode … never below the old
  behaviour"; that was too strong and a pre-release review retracted it.
- **The two `after()` blocks now run concurrently.** Next's after-queue is a
  `p-queue` at the default `concurrency: Infinity`, and a publish registers two
  callbacks: `notifyRolePublished` (push fan-out plus `sendAssignmentEmailsBatch`,
  which has no clock of its own) and `queuePublishedSetlistNotices` (the upsert
  plus layer 2's sweep). They now overlap, feeding one module-level nodemailer
  pool — `maxConnections: 8`, `rateLimit: 8` per second — and one Gmail account
  that throttles per account. A month publish therefore doubles the burst from a
  single invocation. This is accepted, not measured: `measure-send-budget.mjs`
  has never probed two senders from one invocation, and a throttled wave is
  destroyed mail (spec hole #1). If «Setlist listo» starts going missing on batch
  publishes, this is the first place to look.
- **An invocation killed mid-sweep leaves claims, where before it left none.**
  The derated deadline plus the admission reserve bounds the sweep at ≈35 s and
  both routes allow 60, so this is not the normal case; if it happens, the claims
  sit at `status: "sending"` for the 5-minute lease and are re-sent — duplicates
  for anyone already served, which is the enumerated duplicate path in spec §1
  rather than a new one.
- **Undoing this looks harmless and is not.** Dropping `PUBLISH_WINDOWS` at the
  call site restores a silent 5-to-10-minute delay that no gate would otherwise
  notice. Six guards cover it, mutation-tested against four mutants: reverting
  the call site to `{}` kills 2 (one on `isDue`, the sweep's own predicate, one
  on the raw window); re-debouncing `PUBLISH_WINDOWS` itself kills 3; zeroing
  `DEBOUNCE_MS` inside `buildUpsert` kills the two scope guards; and leaking
  `PUBLISH_WINDOWS` onto the role notices kills the role arm — which existed
  nowhere in the repo until a pre-release review found that mutant surviving the
  whole suite.
- **The guards sample the clock AFTER the flush, deliberately.** Taking it before
  makes the assertion depend on two `new Date()` calls landing in the same
  millisecond: green 15/15 idle, red under parallel load. A flaky guard on a
  protected branch invites someone to weaken the assertion this change exists
  for. The scope guards sample before, which is correct for them — a debounced
  `notifyAfter` only moves further away as the clock advances.
