# ADR-0010: Fill special services locally; move the rules to Sanity

**Date:** 2026-08-01 · **Status:** Accepted (P6 decided, implementation pending)

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
pick a hard block in `PlannerGrid.tsx` and, once seated, what re-checks the
column (E13).

**2. The rules move to Sanity.** Decided here, **implemented separately** — as
of this ADR the config still lives in `localStorage` under
`owt_solver_config_v3`, and the rule panel's own copy in `MonthGenerator.tsx`
says so, correctly. Revise that copy in the same change that lands the move.

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

**Leaving the rules in `localStorage`.** This is what the code does *today*, and
it is the alternative that was rejected, not the one that was chosen. Per-browser
storage cannot make "hard" true:

- The second surface that enforces rules (`SeatBoard`, the single-service
  editor) has no access to the config at all, so the same pick is refused in the
  planner and allowed one screen away.
- A second admin's browser holds a different set of rules, or none. Two people
  planning the same month enforce different constraints, silently.
- Clearing site data deletes every rule with no trace.

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
- **A human may override a hard block; the automation may not.** `PlannerGrid`'s
  "Asignar de todos modos" is a second, separate action on a blocked candidate,
  recorded in `GridCell.overrides` and rendered as a persistent "regla anulada"
  marker. `localFill.ts` has no path to it. That asymmetry is the requirement:
  what was rejected was automation quietly preferring the protected people, not
  a person making a deliberate exception. Do not "simplify" it by letting the
  filler consume an override, and do not fold the override into the primary
  candidate row — a one-click override is the mis-click that seats exactly the
  pair a rule exists to keep apart.
