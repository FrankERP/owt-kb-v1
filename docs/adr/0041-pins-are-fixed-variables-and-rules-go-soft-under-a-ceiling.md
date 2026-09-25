# ADR-0041: Pins are fixed variables, and the rules they contradict go soft under a proven ceiling

**Date:** 2026-09-25 · **Status:** Accepted

## Context

«Solo llenar vacíos» needs the CP-SAT solver (`gcf/owt_solver_v2.py`) to take seats already on
the board as settled, fill the rest, and say what it had to give up. Frank's decision E3: when a
pin contradicts a rule, **the pin wins** and the conflict is shown, never a refusal. One
collision is guaranteed: availability compiles to a hard `!in week n` rule while the picker lets
an admin seat that person anyway.

The design went through 24 adversarial review rounds (11 on a combined spec, 13 on the solver
half). **Rejections 1–6 below were each killed by executing the design against the real
solver**, not by argument; rejection 7 is Frank's ruling on E3. Spec: `docs/superpowers/specs/2026-09-15-solver-pinned-assignments-design.md`.

## Decision

- A pin `(P, R, W)` is `sum(x[P, slots of (R, W)]) == 1`. The pin grants candidacy in that
  (role, week) only, appended after the seeded shuffle; rows grow to `max(default, pins)`;
  pinned-only names join `all_people` after `pools` is built and stay out of every fairness
  group.
- Each person gets **slack** equal to their pin count on the three hard spreads — global, and
  for `Sun.Lead`/`Sun.BGV` their pins in the Sunday **service** (`pin_slack`).
- Under pins, six constraint families (mandatory lead, Saturday anchor, weekly presence, pair,
  consecutive, DSL count) get **one violation boolean per instance**. A violation-only
  **solve 0** runs first; its minimum is a hard `n_viol <= violation_target` on Stage A and every
  Stage B pass, the `stage_a` fall-through included (`solve_schedule`).
- `pin_violations` is re-evaluated against the returned assignment, never read off the
  booleans. `violation_ceiling_proven` reports whether solve 0 proved its minimum.
- None of it is built without pins (`relaxation_enabled`), so a pinless request builds the
  pre-pin Stage A model byte for byte (`gcf/test_inertness.py`).

## Rejected

1. **Remove the pinned seat and re-add the person as a constant.** Every interaction with the
   model became a manual offset; round 1 found four missed, round 2 two more plus a reproduced
   regression — a pinned person with no candidacies forced `total_vars` to 0, pinned `gmin` to 0
   and capped everyone else at one or two services for the month.
2. **Route pins through `combined_slack`.** Giving most people slack empties `strict`, and the
   collapse branch then resets `strict` to everyone and `relaxed = {}` — discarding every pin's,
   every absence's and every authored `fairness_slack`. Reproduced at 34, 30 and 26 pins on a
   12-person month.
3. **Subtract the pin count** (`t[p] - n[p]` bounded by `gmax`/`gmin`). The upper bounds are
   identical, the lower ones are not: subtraction forces `t >= gmin + n`, a full solver-chosen
   share on top of the pins. Measured: Rachel pinned to three Sunday leads came back with **7**
   services against a 4–5 baseline and **4 of 8** Sunday leads; slack gave her 5 and exactly her
   3 leads.
4. **Key the per-role slack on the pin's role, not its service.** One seat per service means a
   pin in any Sunday role zeroes the person in every other Sunday role, so a lead-pool member
   pinned into BGV or Choir got no slack on the spread the pin tightens: the ladder fell through
   to the fairness-free `stage_a` with a member on **zero** services, on four seeds. Kept as a
   failing control in `test_pinned_assignments.py`.
5. **Enumerate which rules a pin would break.** Keyed first on row saturation, then on a
   four-case satisfiability predicate. Review broke the first with one pin and the second with
   two — a count cap whose budget the pins spend, and a pair rule with a pinned counterpart that
   no predicate over candidacy can see — and both times the admin would have been shown the
   mandatory-lead diagnostic, the wrong cause. Making the families soft covers rule forms
   nobody has thought of yet.
6. **Cap a pinned person's upper bound at `max(gmax, n[p])`.** Built and run; it contains the
   `fairness_exempt` case but not the ladder behaviour, and adds an `AddMaxEquality` per pinned
   person to the hardest constraint for a guarantee the objective already delivers. Not adopted.
7. **A pair-rule carve-out that keeps `!with` hard** (ADR-0010's family). It makes the month
   fail rather than honour a pin the admin placed — the opposite of E3.

## Consequences

- **ADR-0010 is reconciled, not overridden** (Frank's ruling, 2026-09-16: keep the soft
  relaxation, «que mantenga el comportamiento que espero»). His requirement was that a rule is
  never traded for fairness. Solve 0 fixes the NUMBER of rules set aside before any fairness
  term exists, and it is a constraint thereafter: the count is never increased for fairness.
  That holds even when solve 0 finds nothing in time: Stage A's own count then becomes Stage B's
  ceiling (added by Frank's decision on the code review, 2026-09-25, after a measured case where
  Stage B otherwise broke three or four rules in weeks nobody pinned). Only solve 0 can report
  the count as proven minimal, through `violation_ceiling_proven`.
  What fairness still decides is **which** instance gives among sets of the same minimal size —
  possibly one in a week with no pin. Stated, not fixed: pinning identity needs a ceiling per
  instance and buys nothing an admin can act on.
- **What a pin does not promise.** Nothing bounds the pinned person's own total
  (`t <= gmax + n` permits a full share on top; `fairness_exempt` removes the soft pull — Rachel
  exempt came back with 8 against a baseline of 6). An un-pinned exempt member is outside every
  bound; one pin cost one a service in review.
- **The violation count is unweighted**, so one leaderless service costs the same as one relaxed
  cap. Any weighting would be a judgement about which rule matters more.
- **Measured 2026-09-25** (laptop, 1 worker, 5 s cap): solve 0 `OPTIMAL` on every blocking-
  mechanism case × 3 seeds, a 52-pin full board and 30 pins on 12 people, in 4–6 ms. Without the
  ceiling, Stage B dropped the Saturday anchor in weeks nobody pinned; with it, never.
- **Undoing any one piece has a test waiting**: the fingerprint for the pinless path, the
  role-keyed and rules-stay-hard controls, the instance-scoping cases and the pinned-only guard.
- Pins name people by `member_name`; two members sharing one would swap a pinned occupant for
  the namesake. Pre-existing for the solver's own picks, newly consequential here, out of scope.
