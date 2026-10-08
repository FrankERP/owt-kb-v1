# ADR-0046: Auto sends no fairness history; an exact count leaves its role's band

**Date:** 2026-09-30 · **Status:** Accepted, amended under v3 by ADR-0050

> **Numbering.** ADR numbers follow the order records reach `main`; this is the next free
> number on `main` when written. Amends ADR-0042 (the history is still derived and shown, but
> no longer sent), ADR-0038 (its deferred follow-on — a sequential objective — is not built) and
> ADR-0004 (it rejected raising the function's CPU; the 1-worker setting stands).

## Context

Frank reported Auto giving two Sundays to two lead-only members while others led none (October
2026). Offline reproductions of the real requests (2026-09-29, pinned ortools) showed:

- **The history never shaped a roster.** With three derived months the objective's weight ladder
  bounds ~4.9e19 against CP-SAT's 4.6e18, so every optimising pass ran with no objective
  (`objective_skipped`, every run measured — ADR-0038). The roster was an arbitrary legal draw.
- **When it did run, it fought how Frank plans.** A prototype that made the objective fit gave
  the lead with zero weighted Sunday history two Sundays in 23/23 runs. That lead is an
  occasional one — ticked in the Sunday pool some months and not others, as intended — and the
  history read her rare Sundays as leads she was owed.
- **The double Sundays came from the band, not the history.** One member's `Sun.Lead >= 2`
  sat inside the Sun.Lead band; with more Sunday leads than seats someone is at 0, so the band
  had to allow 2 for everyone. With no history and that member outside the band: nobody else on
  two Sundays and no back-to-back Sundays, 10/10 runs (was 16 doubles in 10 runs).

## Decision

1. **The planner sends `history: []`** (`SOLVER_SENDS_HISTORY = false`,
   `app/components/admin/solverHistorySource.ts`). Auto reads no history at solve time and never
   refuses over a failed read; the grid shows no «Historial» line. The display read (the «sin
   Lead en …» panel) and the confirm-time `localStorage` dual-write are unchanged. The solver
   balances **within the month**; who leads across months is Frank's pool checkboxes.
2. **A person whose count for one role is fixed by an exact rule (`X Sun.Lead == 2`) leaves that
   role's Sun.Lead / Sun.BGV band** (`gcf/owt_solver_v2.py`, `exact_count_roles`). Only `==`, and
   only when exactly one of the rule's roles is one the person can hold (so `*.Lead == 2` counts
   for a member barred from Saturdays); a `>=` is a floor, and leaving the band would lift its
   ceiling.
3. **The solver function gets 1 vCPU** (`cloudbuild.yaml`, `scripts/deploy-solver-gcf.sh`).
   With the objective now running, a solve is a few seconds on a Mac; production measured ~4×
   the Mac at 0.33 vCPU plus 11–19 s cold starts, against the route's 60 s.

## Rejected

- **Sequential lexicographic objective («Fix B»)** — solve the eight tiers one at a time so the
  history fits. Measured exact (20/20) and affordable, but it exists only to make the history
  count, and the history is what produced the unwanted doubles. The spec stays on branch
  `claude/solver-sequential-objective-spec`, unmerged, for the day cross-month balance is wanted.
- **Keep the history, fix only the band.** The objective still overflows — nothing changes on a
  real month but the banner.
- **Count Saturday leads as Sunday history.** Tried: it moved the rest to other people
  (one frequent lead got 0 every run) and still weighted occasional leaders against the pool.
- **A role-scoped «Exenta» in the UI** (`fairness_exempt on Sun.Lead`). Works for the band, but
  it is a second knob per person; an exact count already says "this number is decided".

## Consequences

- No automatic compensation across months: a lead who sits out in October is not favoured in
  November. The «sin Lead en …» panel and the checkboxes are the tools for that.
- `objective_skipped` should become rare; «Sin optimizar» stays wired for when it happens.
- A `>=` count on a role still widens that role's band (by design) — use `==` for a member
  whose count is decided. Frank's `Sun.Lead >= 2` becomes `== 2` in the rules: in the member's
  rule, the cap «Dom Lead» (`Sun.Lead`) with «=» 2. «Lead (ambos)» (`*.Lead`) also counts, but
  only for a member barred from Saturdays — for one who can lead both days it fixes the sum,
  not the Sunday count (`exact_count_roles`).
- Known limit, not reproduced: under pins the count rules go soft; if an excluded member's `==`
  is the rule the pins force to break, nothing else bounds their count that month.
- Undoing: flip `SOLVER_SENDS_HISTORY` to `true` (the ADR-0042 path, still tested) — and expect
  `objective_skipped` on every history-bearing month again unless the sequential objective ships.
- MCP P4's `solve_month` mirrors Auto, so it sends no history either (P4 plan, post-approval
  change 13).

## Under v3 (2026-10-09, ADR-0050)

Since 2026-10-09 Auto runs solver v3 (ADR-0054). v2, the rollback engine, keeps this record
unchanged — `SOLVER_SENDS_HISTORY = false`, `exact_count_roles` and every consequence above — and
nothing above changes. Under v3:

- **Balances with a denominator replace `history: []`.** Each person carries a balance per line,
  measured against the eligibility recorded for each month (ADR-0050), so an occasional leader's
  rare Sundays are no longer read as Sundays owed.
- **Decision 2 generalises to set-asides.** Every exact `==` count fixes that person's seats for
  the role and sets them aside from the line's balance; an exact-count lead is outside both monthly
  caps.
- Decision 3 (1 vCPU) holds for both functions.
