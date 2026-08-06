# ADR-0010: Fill special services locally; move the rules to Sanity

**Date:** 2026-08-01 · **Status:** Accepted · P6 implemented 2026-08-03 (seeded 2026-08-02)

> **2026-08-05 UI supersession:** `SeatBoard`/Tablero is no longer mounted;
> `PlannerGrid` is the sole free-form roster editor. References below to two
> manual surfaces describe the historical system that motivated this ADR. The
> core decisions remain active: specials stay out of CP-SAT, shared rules remain
> authoritative in Sanity, and automatic local fill cannot consume a human
> override. The new one-service composer is manual-only and does not auto-fill.

## Context

Special services (`special_role` — vigils, conferences, midweek nights) were
added to the month planner. The user's requirement for the whole feature was
one sentence:

> "I need some rules enforced in specials, specially that exclude two people
> from being together" — and "it has to be hard because if it's soft in fairness
> it will always choose people like Frank, Mkz or Gaby who tend to have 1 or 2
> participations a month."

Three things had to be decided, and none of them will be visible in the code
that resulted.

## Decision

**1. A special is never sent to the solver.** `gcf/owt_solver_v2.py` handles the
five weekend voice role types only. Specials are auto-filled by
`app/components/admin/localFill.ts` — greedy, single-column, one-pass, no
backtracking — and the rules are enforced locally by
`app/components/admin/ruleEnforcement.ts`, which is also what makes a manual
pick a hard block on BOTH manual surfaces — `PlannerGrid.tsx` and, since
9e0f703, `SeatBoard.tsx`'s service editor — and, once seated, what re-checks the
column (E13). Week exclusions are the one asymmetry: the board edits a single
service and has no Sunday spine, so there is no week to match.

**2. The rules move to Sanity. DONE.** One singleton document
(`sanity/schemas/solverConfig.ts`, fixed `_id: solverConfig`), seeded to
production 2026-08-02 from the live browser capture and made authoritative by
the cutover. `ServicesPanel` mounts `useSolverConfig` once and threads the one
controller to `MonthGenerator` and both `SeatBoard` mounts, so the two surfaces
cannot hold different rules. The browser key is neither read nor written any
more, and the rule panel's copy was revised in the same change.

Three properties of that cutover are worth knowing before touching it:

- **A save is EXPLICIT** ("Guardar reglas"). Persistence used to be an
  unconditional effect on every config change; a POST per keystroke thrashes the
  route's `_rev` check, so an admin would lose their own edits to their own
  concurrency guard. The cost is stated on screen: an unsaved rule hard-blocks
  in the planner and nowhere else.
- **"Document absent" and "read failed" are different states and never collapse
  into one `??`.** Absent falls back to `DEFAULT_SOLVER_CONFIG` **in memory
  only**; a failed read shows the error and refuses to save. The union enforces
  it structurally — `_rev` exists on `ready` alone, so a save from any other
  state is unspellable rather than merely discouraged, and the route refuses a
  CREATE as a second, independent lock.
- **An absent document still gives the Tablero nothing.** `enforceableConfig`
  hands over a config only in `ready`, which preserves that surface's
  long-standing behaviour of enforcing nothing rather than hard-blocking against
  rules nobody wrote. The planner deliberately differs (it has always shown and
  enforced the sample rules when there were none), and the panel's copy says
  which of the two states it is in rather than claiming parity.

**3. A special counts toward the local `load` signal, and is excluded from
persisted solver history.** `cellsToParticipantRoles` (`plannerModel.ts`) feeds
every column, specials included, into `rankCandidates`' `load`;
`historyEntryFromDrafts` deliberately does not record specials in
`owt_solver_history_v2`.

## Rejected

**Extending CP-SAT to specials.** Possible, and costed: a special has no week
number (`weekForColumn` returns `null` by construction), so the solver's
positional `1..N` week spine — which every DSL `week N` rule, every fairness
term and the whole `schedule` response shape are indexed by — would need a
second, non-positional axis. Add to that the Cloud Run round trip and a
solve that 400s below three Sundays (`buildSolveRequest`), for a service that
holds two seats. Not taken. **Do not "fix" the greedy local filler by pointing
it at the solver** — the filler is not a degraded solver, it is a different
mechanism for a different shape of problem, and the confirmation copy in
`PlannerGrid` names it as one.

**Leaving the rules in `localStorage`.** The alternative that was rejected —
and, until the cutover, what the code actually did. Per-browser storage cannot
make "hard" true:

- A second admin's browser holds a different set of rules, or none. Two people
  planning the same month enforce different constraints, silently.
- Clearing site data deletes every rule with no trace.
- **Even inside ONE browser the two surfaces could disagree.** The interim state
  read the same key on both, but "does this browser hold the team's rules?" had
  to be guessed by comparing the stored value against the shipped defaults
  (`isFirstRunSolverSeed`) — every admin who had merely OPENED the generator had
  those defaults persisted. Safe, and unpleasant: the generator hard-blocked
  against six sample restrictions while the Tablero enforced nothing. The
  cutover retired the heuristic by making the server state the fact: `ready` vs
  `absent`. The asymmetry itself survives on purpose, one state narrower.

A rule the user described as hard cannot depend on which browser is open.

## Consequences

- **The two fairness signals now disagree, by design, permanently.** A special
  raises a member's `load` inside the planner (so the filler and the candidate
  list spread work correctly across a month that contains one) and contributes
  nothing to the history the solver is fed next month. Both are deliberate: the
  in-grid signal is about this month's balance, the persisted one is about what
  CP-SAT should treat as served weekend duty. A later reader who notices the
  mismatch will be tempted to "fix" it in one direction — either direction is a
  behaviour change, not a bug fix.
- **`owt_solver_history_v2` stays in `localStorage` even after the rules move.**
  Decision 2 shares the rules, not the fairness history, so two admins still
  solve against different history. Pre-existing and out of scope here, but it
  makes "shared rules" narrower than it sounds.
- **Caps and presence rules are enforced by CP-SAT only.** They reach the solver
  for Sundays and Saturdays and are checked nowhere else — not on a special, not
  on a manual pick. `ruleEnforcement.ts` lists both as deliberate non-goals and
  the rule panel says so on screen. Adding them locally means deciding what a
  month-scoped statement means against a month that has not been committed yet.
- **A human may override a hard block; the automation may not — on BOTH
  surfaces.** "Asignar de todos modos" is a second, separate action on a
  rule-blocked candidate, in `PlannerGrid`'s picker and in `SeatBoard`'s roster.
  The blocked row itself stays inert in both, and in both the seating is recorded
  with the RULE it waived and rendered as a persistent "Regla anulada — {person}:
  {rule}" marker rather than going silently green. Only `ruleBlockedReason` is
  overridable: a same-category double (`blockedReason`, D6) is a data error, not
  a judgement call, and is refused identically either way. `localFill.ts` has no
  path to any of it — `fillColumn` only ever appends, never writes an override
  and never reads one as permission. That asymmetry is the requirement: what was
  rejected was automation quietly preferring the protected people, not a person
  making a deliberate exception. Do not "simplify" it by letting the filler
  consume an override, and do not fold the override into the primary candidate
  row — a one-click override is the mis-click that seats exactly the pair a rule
  exists to keep apart.

  The two surfaces differ in **how long the record lives**, because their state
  differs and nothing was invented to hide it. The planner's override rides in
  `GridCell.overrides`/`overrideReasons` and lasts as long as the draft; the
  board's rides in component state keyed by seat, and ends when the dialog
  closes, because a service document has no field for it. The board loses a
  marker on reopen and nothing else: no surface re-checks who is ALREADY seated
  there (`evaluate` self-exempts occupants, so there is no E13 on the board), so
  a forgotten override cannot turn into a false accusation. Giving it a longer
  life is a schema field and a migration on the SERVICE document — deliberately
  not taken by the rules cutover, which touched only the rule set, and still not
  something to bolt on.

  **Why the Tablero has it at all.** Task 9 extended the hard blocks to that
  surface without the override, and against the live rule set that left an admin
  editing a *Saturday* service unable to seat Frank, Mkz or Gaby in any voice
  row, with no escape but deleting the rule globally in "Generar mes" — which
  also changes the solver for every future month. One of those three is the user
  who asked for the override.

---

## 2026-08-06 — the Tablero's source is gone, not merely unmounted

The 2026-08-05 note above recorded that `SeatBoard`/Tablero was no longer
mounted. The source, its tests and its dependencies have now been deleted:
`SeatBoard.tsx`, `SeatBoard.test.tsx` and `ParticipationRail.tsx` are removed,
and `enforceableConfig` in `solverConfigSource.ts` went with them — it existed
only to give that surface a narrower rules contract and had no other caller.

**Everything above stays as written.** It is the decision history of a system
that had two manual surfaces, and the reasoning only makes sense in those terms.
Read the passages about "both surfaces", the Tablero's override, and
`enforceableConfig` as describing why the shared rule set is shaped the way it
is — not as a description of what ships.

What is still true, and now has one surface instead of two:

- Specials stay out of CP-SAT; local fill is manual-triggered and appends only.
- The shared rules live in one Sanity document and are authoritative.
- `ready` vs `absent` remains the distinction that stops a transient read
  failure from enforcing `DEFAULT_SOLVER_CONFIG` against the team. With
  `enforceableConfig` gone, the structural guarantee is carried entirely by
  `_rev` existing on `ready` alone: a save from any other state is unspellable.
- The human override on a rule-blocked candidate lives in `PlannerGrid`'s
  picker, riding in `GridCell.overrides`/`overrideReasons` for the life of the
  draft. The board's shorter-lived, component-state variant is gone with the
  board; no schema field was added, and none is needed.

The **two-drummer invariant** (D6 — no cell ever replaces an occupant) was the
one piece of Tablero coverage worth checking before deletion. It is pinned on
the grid at `PlannerGrid.test.tsx` ("a non-solvable Drums cell with two
occupants never replaces a third addition"), and structurally by
`seatModel.ts`'s `max: null` and its test. No coverage was lost.
