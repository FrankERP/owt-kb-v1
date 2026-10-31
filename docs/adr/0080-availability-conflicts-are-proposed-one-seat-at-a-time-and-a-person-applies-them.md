# ADR-0080: Availability conflicts are proposed one seat at a time, and a person applies them

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
  protection. All seats or none — except that an instrument or FOH seat nobody passes is proposed
  EMPTY («queda vacío»; Frank, 2026-10-31: «si no hay nadie para cubrir Bass, se puede quedar
  vacío»), so a person in Lead and Bass still gets a Lead proposal; a voice seat always needs a
  person. A worship-night song lead gets no pick («song_lead»). A service the
  board cannot edit, a month without its fairness record, or no rules: «sin revisar».
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
  other people — each move an email once published. One seat changes exactly two people.
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

Undoing it: set `AVAILABILITY_SWEEP_DISABLED=1` to stop the sweeps; the panel still reads. Removing
the feature means deleting the four routes, the two triggers and the writer (pinned in
`serviceCommitCallers.test.ts`); the records are internal and can stay.
