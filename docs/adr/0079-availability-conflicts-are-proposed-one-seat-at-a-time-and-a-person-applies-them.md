# ADR-0079: Availability conflicts are proposed one seat at a time, and a person applies them

**Date:** 2026-10-30 · **Status:** Accepted

## Context

A member marks a day they cannot serve AFTER the month was planned, often after it was published.
Nothing noticed: the planner's picker never refuses an unavailable person (`pickJudge.ts`), and
`/admin › Disponibilidad` only listed the conflict client-side. Frank asked (2026-10-29) for the
solver to resolve these by itself, regularly, and on demand from the page. The first plan let the
sweep rewrite drafts automatically and only propose for published services; seven rounds of
adversarial review never converged on it — every round found a new interaction between automatic
writes and a shared working board. On 2026-10-30 Frank chose «Solo propuestas por ahora»: the sweep
never changes a service, draft or published. That plan was approved in rounds 10 and 11
(`docs/superpowers/plans/2026-10-29-availability-conflict-resolver.md` and its review log).

## Decision

- **Find** (`app/utils/availabilityConflicts.ts`, pure): a person seated in any of the five seats on
  a service dated from CDMX today through the end of the month after next, who has that date in
  `unavailableDates`. Identity `(roleId, memberId, date)`.
- **Propose one seat at a time**, never a month re-solve. For each seat the person holds: remove
  them, build the pool the planner's fillers would (`serverPickCandidates` → eligible, not already
  serving that service, the instrument declared, worship), order it as the fillers do (voices by
  `orderByEffectiveLoad`; the instrument rows `fillInstruments` fills by `orderForFill`; anything
  else in `rankCandidates`' order), and walk at most 8 candidates through: a weekend voice must be
  on the month's v3 eligibility for that service; the service target is `ok` with no new finding
  (`judgeTarget`); the month gate (`monthCheckVerdict`, `monthCheck.ts`) shows no new or grown
  protection. Eligibility and the gate read the month's record with TODAY's availability: a
  «no disponible» block on a date the person has since unmarked is lifted for the judgement
  (`withLiveAvailability`; the record is never written). The record is a photo of availability on
  the day the month was confirmed (Frank, 2026-11-05: Marianne freed 14–15 nov and stayed off every
  option until this). All seats or none — except that an instrument or FOH seat nobody passes is proposed
  EMPTY («queda vacío»; Frank, 2026-10-31: «si no hay nadie para cubrir Bass, se puede quedar
  vacío»), so a person in Lead and Bass still gets a Lead proposal; a voice seat always needs a
  person. **When nobody free fits a voice seat, one singer already on the same service moves up**
  into it and a free person takes the seat they leave (`moveUp`; Frank, 2026-10-31, on 27 dic:
  Liu's «Mes por medio» and Niza's second Sunday in a row left nobody free for Lead, while «Marianne
  BGV → Lead, Liu → BGV» broke nothing). Both people pass the same gates; never a worship night's
  song lead; at most 6 singers × 8 fillers per seat. «Aplicar» accepts that one extra seat and
  refuses unless the re-judged proposal is exactly the one shown. A worship-night song lead gets no pick («song_lead»). A service the
  board cannot edit, a month without its fairness record, or no rules: «sin revisar».
- **When nobody passes every rule, show the least-bad options and what each breaks** (Frank,
  2026-11-05, on Rachel's 15 nov: every Sunday leader was away, already on the service, or already
  leading another Sunday that month: «que entregue 2 o más propuestas y explique por qué rompen las
  reglas»; plan `docs/superpowers/plans/2026-11-05-availability-fallback-options.md` and its review
  log). Only for a VOICE seat whose strict search answers «sin reemplazo», and only in the panel
  (the sweep and the cron compute no options; the email's «Sin reemplazo» line now points to the app, and the records gain only `waived`, set by «Aplicar de todos modos» and unset by every other transition): `proposeFallbacks` runs the same search
  relaxed — a taker a personal rule blocks is allowed, a singer may move up — and judges each build
  against the month with the seat merely emptied. Every new or grown month finding (a second Sunday
  as Lead, two Sundays in a row, a count rule, a presence or pair rule) and every personal rule
  broken on the service is one line, in `v3Copy.ts`'s and `ruleCopy.ts`'s Spanish. Never offered:
  someone who marked that day, a seat clash, someone already serving that service, someone off the
  month's v3 lists for the seat (unless a personal rule on that seat is what keeps them off, and is
  shown; only someone on that seat's pool without the rule, `pooledForRoleKey`), a worship night's song lead, an empty voice seat, or a build that breaks nothing. Up to
  four, fewest breaks first. **«Aplicar de todos modos»** sends the option's break keys as `waive`;
  the writer first runs the strict check (a now-clean option is refused: reload), then re-derives the
  option on a fresh read under the same role `_rev` and writes only if its seats AND its break set
  are exactly the ones shown; the `applied` record keeps the keys in `waived`.
- **Record and tell** (`app/utils/availabilityFixCommit.ts`, the one writer): an
  `availabilityConflict.<sha256>` record per identity (`proposed`/`none`/`applied`/`kept`/`gone`,
  guarded `create` / `ifRevisionId`), one admin email per sweep that claimed new events
  («Conflictos de disponibilidad (N)»; admins and super-admins in worship, not disabled, not system
  accounts, allowlisted, «Propuestas» switch on). Triggers: the member's own save (`after()` on
  `PATCH /api/me/availability`, that member only), every third tick of layer 1's 5-minute flush cron
  (a cheap seat pre-check first), and «Revisar ahora». **Only Production acts**
  (`fairnessRecordEnvironment`); Preview and local sweep dry. `AVAILABILITY_SWEEP_DISABLED=1` stops
  every automatic sweep without a release.
- **A person applies** in `/admin › Disponibilidad › Conflictos` (`AvailabilityProposals.tsx`):
  «Aplicar», «Elegir otro» (up to three alternatives; they vary the voice seats and keep the
  instrument/FOH pick, or vary those when the person holds no voice seat), «Mantener» (silenced while that conflict
  lasts), «Deshacer» on a kept one. «Aplicar» re-judges on a fresh read under the role `_rev` the
  screen showed, then writes through `/admin`'s own `editRole` (`roleEditCommit.ts`, unchanged), so
  the usual notices go out on a published service and none on a draft.

## Rejected

- **Rewrite drafts automatically** (Frank's first ask). Seven review rounds, each with a new defect
  in how automatic writes shared one working board with the proposals; deferred by Frank, not
  refused. Revisit only as its own plan, on top of this one.
- **Re-run solver v3 for the month.** It seats only voices (instrument and FOH conflicts stay), needs
  a new «free this pinned seat» mode in the Cloud Function contract and checker, and is free to move
  other people — each move an email once published. One seat changes exactly two people, or three
  when a singer moves up (below), all on that one service.
- **Apply the first proposal of every conflict in one sweep.** Two proposals may name the same
  person (two seats, or past a monthly cap across services): each is judged alone against the same
  read, which is safe only because «Aplicar» re-judges. A batch apply would need the shared board
  this design removed.
- **A new `NotifyKind` for this email.** It touches the member form, `/me` and four tests for one
  admin email; it reuses «Propuestas». Follow-up if Frank wants it off alone.
- **Leaving a voice seat empty** (for an instrument or FOH seat, an empty seat is what the team
  already does by hand, as on 29 nov). A service short a voice is a decision about the service, not a
  replacement; «Aplicar» refuses `to: null` on a voice seat.
- **The client-side list as the only view.** It stays, but only as the fallback when the proposals'
  read fails or cannot judge — a failure never reads as «sin conflictos».

## Consequences

Accepted costs, told to Frank:

- A sweep that cannot judge (a lingering raw Studio draft, the engine flipped to v2, no read token)
  is silent: no alarm, only «No se pudo revisar» in the panel and the `[availability-sweep]` logs.
- An email lost after its claim is not retried (the claim is the de-duplication).
- Two proposals may name the same person; the second «Aplicar» then refuses and the panel shows a
  recomputed proposal.
- If the record write after a successful «Aplicar» fails, the role change stands and the next sweep
  records the conflict as `gone`, so it misses the 30-day «Aplicados» list.
- The month gate judges one month; a candidate's load in the neighbouring month is not compared.
- A conflict whose service cannot be judged is re-checked by the tick at most every 6 hours (a
  person's «Revisar ahora» re-judges it at once). The panel's read stops computing alternatives,
  then picks, past a 30 s budget, so a very busy month may show «sin revisar» until a calmer read.
- «Mantener» and «Aplicar» pressed on dev write the REAL dataset, like every admin button there.
- «Aplicar de todos modos» writes a change that breaks the rules it lists; there is no switch for it
  short of a revert (`AVAILABILITY_SWEEP_DISABLED` stops the sweeps, not the clicks). The writer does
  not look for a rule-clean option that appeared for someone else between the panel's read and the
  click: the admin chose this one with these breaks. The fallback options cost up to ~26 more month
  checks per conflict on the panel's read, inside the same 30 s budget (past it they are skipped).
- An exempt member past the strict search's first 8 is never offered: a build that breaks nothing is
  not a fallback option, and the strict search orders its pool by its own load median.

Undoing it: set `AVAILABILITY_SWEEP_DISABLED=1` to stop the sweeps; the panel still reads. Removing
the feature means deleting the four routes, the two triggers and the writer (pinned in
`serviceCommitCallers.test.ts`); the records are internal and can stay.
