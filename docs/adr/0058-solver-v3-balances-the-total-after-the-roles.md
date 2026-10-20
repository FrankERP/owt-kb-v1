# ADR-0058: Solver v3 balances each person's Total after the roles

**Date:** 2026-10-20 · **Status:** Accepted

## Context

v3 balances each line (Dom Lead, Sáb Lead, BGV, each presence sub-line, Coro) in its own
most-owed + sum-of-squares stage pair, fixed before the next (ADR-0051, C5 §7.1). Total was the
sum of the lines, enforced only through the voice floor (parent fairness spec D3). Every line
rounds on its own, so one person could take the rounding seat on several lines while another
took none. On the four production Nov + Dec 2026 requests captured from Frank's runs, every line
was within a seat, yet two or three people per run ended more than a full seat away from their
Total share (Σ after² 71–76 thousand hundredths²). Frank asked for the Totals to even out too,
in proportion to availability.

## Decision

Two stages run after every per-line pair and before the tie-break: `balance_max:TOTAL` (minimise
the most-owed person's Total) and `balance_sq:TOTAL` (minimise the sum of squares of the Total
deviations), solved and fixed like the others (`gcf_v3/owt_v3/solver.py`, `model.py`). K is the
person's planned share summed over her lines and rounded once; n is her received seats over every
line; exempt people are outside the set. **No carried balance enters K**: each line's own stage
repays its carried balance, so Total only evens out what the current plan hands out. Because the
line stages are fixed first, every per-line objective value is exactly what it was: the new stages
choose only among plans already even per role. Spec:
`docs/superpowers/specs/2026-10-20-solver-v3-total-balance-design.md`.

`FAIRNESS_TOLERANCE` was re-measured by C5 §12.4's procedure on the `full` matrix with the pair:
47 (one person-line whose floor status flipped), so it is 50, up from 35. The gap's distribution is
otherwise unchanged (mean 3.04 against 3.06, 99th percentile 21 against 21).

## Rejected

- **Carried balances in Total** (the first prototype). Total then pays a line's debt on another line
  while the line stage still owes it. On 12 chained 12-month cells two floor people's per-line
  balance drifted to 2.44 and −2.12 seats, outside the floor proof's ±2 (`main`: 1.83; this design:
  1.89), and Total balances drifted no less than with this design (95th percentile 2.64 against
  2.71 seats; month-12 mean 0.86 both).
- **Total before the roles.** On the latest captured run it improves Total by 6 % over this
  order and raises the Coro line's largest debt from 0.35 to 1.35 seats.
- **Roles within ±1 seat, then Total, then the roles again.** Prototyped two ways; both gave this
  order's per-line and Total figures exactly. A tolerance to explain for no measurable gain.
- **Only Total.** Roles are not interchangeable, Lead's pool is small, and an identical Total is
  impossible under availability and eligibility.
- **Counting exact-rule or cadence set-asides in Total.** That redefines the ledger (ADR-0050) and
  the «Equidad» panel would stop showing what the solver evened out.

## Consequences

Σ after² on Total fell by 51–68 % on the four captured runs, with every stage `proven` and the C5
checker passing. A `>=` minimum rule still lifts its person above her Total share: rules outrank
every balance. Total debt left over from one plan is not chased by the next plan's Total stage, and
when a line stage repays an old debt, a tie on another line can move that debt there rather than
retire it; the line stage owes it in the next plan. Measured over 12 chained 12-month cells, Total
balances still drift less than on `main` (95th percentile 2.71 against 3.25 seats). Two more
stages cost tens of milliseconds. The stage ids reuse the `balance_*:{line}` templates, so the
wire, the code registry and the planner's parsers are unchanged. Undoing it means removing the pair and restoring the measured tolerance; nothing stored
depends on it.
