# ADR-0078: Nobody sings and plays on one service unless marked «Canta y toca a la vez»

**Date:** 2026-10-29 · **Status:** Accepted

## Context

The Sunday of 2026-11-29 was published with Tony in **Coro** and on **Drums**. Auto runs in two
steps: solver v3 seats the voices (it knows no instruments, D5), then `instrumentFill.ts` seats the
instruments through `rankCandidates`. Its C2 block only refused a second seat in the SAME
category, because the planner's design (D4) allowed voz + instrumento outright: Frank (Lead + EG)
and Mkz (Lead + Bass) lead while they play. So the filler gave the drums to the Coro singer, and
nothing — picker, grid, Servicios, publish — said a word. In every roster stored from 2026-07 to
2026-12, the only voz + instrumento pairs are Frank's and Mkz's Leads, plus Tony's 2026-11-29.

## Decision

A member may hold a voice seat and an instrument seat on one service **only if marked «Canta y toca
a la vez»** (`singsAndPlays: true` on `teamMembers`, absent = no). Frank chose this on 2026-10-29
over two narrower rules (below). The ONE predicate is `seatsClash` (`app/components/admin/seatModel.ts`):
same category always clashes; voz + instrumento clashes unless marked; FOH beside either is
unchanged. `rankCandidates` uses it for C2, so the picker, the drag gate, `instrumentFill`,
`localFill`, the v3 counted-specials pre-fill and the MCP editors' judges all refuse it with
«Ya asignado en …» (a voice + instrument refusal also names the Miembros checkbox, `clashReason`); `PlannerGrid` flags an already-seated clash with ⚠ on both cells. The flag is
edited in Miembros (super-admin; `PATCH /api/admin/members/[id]`, absent = untouched) and in
the Studio, and `adminMembersQuery` carries it to every planner and MCP reader. The flag stays stored when a Tipo is
unticked, like `instruments`, so re-ticking Voz or Instrumento restores the member's setting rather
than silently dropping it; without both Tipos the member cannot hold both seats anyway.

## Rejected

- **Only a Lead may also play** (BGV and Coro never with an instrument): fits today's data, but
  would let a drummer lead from the kit unasked, and a new singer-guitarist would be allowed with
  no one deciding it.
- **Only Coro may not play**: closes Tony's case and nothing else.
- **Teach solver v3 the instrument seats** (per-service eligibility without the voice roles): the
  v3 request's eligibility feeds the cadence and the eligibility records the confirm writes to the
  fairness ledger (ADR-0050), so it is a production writer's contract — and in Auto the instruments
  are seated after the solve anyway, which is where the bug was. A drummer pinned before Auto who
  the solver still puts in Coro is caught by the grid's ⚠ instead.

## Consequences

- Until Frank and Mkz are marked, Auto leaves them off EG/Bass on a service where they lead (the
  filler reports the seat empty if nobody else declares it), and the grid flags the stored months
  where they do both. Marking them is a production write, done once with consent.
- **Server writers (2026-10-31, plan `docs/superpowers/plans/2026-10-30-server-seat-clash-guard.md`):**
  roles create, PATCH, swap and copy-instruments refuse a clashing pair the write ADDS
  (`addedSeatClashes`), judged per role with the member's current flag, before any write stage —
  `400 invalid_request`, `details.seatClashes` with a built sentence that every refusal surface
  prints. A diff, not the result, on purpose: a roster that already holds a clash (a flag unticked
  later) still takes unrelated edits, and removing one side of it is always allowed. The month
  confirm (v3 and v2) refuses a draft with a clash before writing the fairness records, so the
  pinned-drummer case above no longer reaches the server. Studio and publishing remain open: a
  Studio edit runs no server rule, and publish-ready writes no seats. Pairs are keyed by seat
  label, so an OLD clash on an instrument or FOH slot reads as added if the write relabels that
  slot to a name `normalizeSeatName` maps elsewhere, or re-sends a stored slot that had no label:
  accepted, it only touches a roster that already holds a clash, and the refusal names the pair.
  The confirm's pre-check reads seats with `roleSeats.ts`'s `normalizeSeats`, split out of
  `roleWriteRequest.ts` so no `node:crypto` reaches the planner bundle (`roleSeatsClientSafe.test.ts`).
- The member-facing ⚠ (DayCard's `hasDuplicate`, `/schedule`'s `serviceConflicts`) still counts a
  name twice within ONE section only, so a voice + instrument clash shows there as clean; the
  planner grid is where it is flagged. Teaching those surfaces the flag is left open.
- The MCP refusal code stays `same_category_double` (a wire name); its sentence is the planner's.
- Undoing this (allowing voz + instrumento for everyone) reopens the 2026-11-29 bug.
