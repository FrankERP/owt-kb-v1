# Solver v3: balance each person's Total after the roles — design spec

**Date:** 2026-10-20 · **Status:** self-reviewed, waiting on Frank · **Decision record:**
[ADR-0058](../../adr/0058-solver-v3-balances-the-total-after-the-roles.md)

Amends the C5 spec (`2026-10-05-solver-v3-c5-solver-function-design.md`) §7.1 and §12.4, and the
parent fairness spec's D3 and F1 (`2026-10-05-solver-v3-fairness-design.md`): Total stops being
display-only.

## Original request

Frank, after the first production Nov + Dec 2026 runs, asked why some members got far more
seats in total than others, and whether it is fairer to share seats per role or to share every
seat so that the number of participations evens out. The answer he accepted («Me gusta, hagamos
el cambio»): both, in that order. First even per role, as today; then, among the plans that are
already even per role, the one that leaves each person's Total closest to what is owed to them.
Total is proportional to availability, not identical. He chose to hold November and December
until this ships, and wants the roster out this week.

## 1. Problem

v3 balances each line (DL, SL, BGV, each presence sub-line, CORO) in its own stage pair and
fixes it before the next (§7.1). Total is the sum of the lines and is enforced only through the
voice floor (parent F1, D3). Each line rounds on its own, so the same person can collect the
rounding seat on several lines while another collects none: every line is within a seat, and the
Totals are not.

Measured on the four production Nov + Dec 2026 requests captured from Frank's runs
(2026-10-16 and three on 2026-10-20; aggregates only, C5-17), Total `after` per non-exempt person:

| Run | Σ after² (hundredths²) | Spread (max − min) | People ≥ 1 seat off |
|---|---|---|---|
| 10-16 | 75 757 | 222 | 2 |
| 10-20 #1 | 74 741 | 213 | 3 |
| 10-20 #2 | 73 653 | 249 | 2 |
| 10-20 #3 | 71 283 | 256 | 2 |

Each line was fair; the Totals were not.

## 2. Decision

Two stages after every per-line pair and before `tiebreak`:

| # | Stage `id` | Objective |
|---|---|---|
| after the last `balance_sq:<line>` | `balance_max:TOTAL` | Minimise M, with M ≥ K_p − 100·n_p for every p in the Total stage set |
| next | `balance_sq:TOTAL` | Minimise Σ_p (K_p − 100·n_p)² over the same set |
| last | `tiebreak` | Unchanged |

- **K_p** = the planned shares of all her lines over the horizon, summed exactly and rounded once
  to hundredths (the Total tab's share, LG-14, with the plan's share in place of the realised one,
  as every line stage uses the planned share).
- **No carried balance in K_p.** Each line's carried balance is repaid by that line's own stage, so
  Total evens out what this plan hands out and each line keeps its own debt. Counting carried
  balances in Total as well lets Total pay a line's debt on another line while the line stage still
  owes it; on the 12-month acceptance chains (§5) that pushed two floor people's per-line cumulative
  balance to 2.44 and −2.12 seats, outside the floor proof's ±2, with no gain on Total over this
  design.
- **The trade-off this accepts.** When a line stage repays an old debt with a seat this plan would
  otherwise have tied, Total sees that person ahead in this plan and, on another line's tie, gives
  the other tied person that line's odd seat: the old debt moves to the other line instead of
  leaving Total (a constructed case: `test_a_repaid_line_debt_can_move_to_another_line`). The next
  plan's line stage owes it there. Measured over 12 chained cells of 12 months (§5), Total balances
  drift no more than when carried balances are counted, and less than on `main`.
- **n_p** = the sum of her received seats over every line (`model.n`, the §6.6 mirror of the shared
  formula: presence seats on their sub-line, floor-seat deductions, set-asides excluded). It is the
  Total tab's `seats`.
- **The Total stage set** = every person in some line's stage set (§7.1) who is not `exempt`
  (parent D13, F8: «Exenta» removes her from Total).
- Both stages are solved and fixed like every other (§7.1, §7.3); a stage with no terms is
  `proven` with value 0.

**Why after, not before or instead of, the lines.** The per-line stages are fixed first, so every
per-line objective value is exactly today's. The two new stages choose only among plans that are
already even per role, which is where today's rounding pile-ups live: who gets a line's extra seat
when several people are tied on it. Measured, the per-line stage values were identical in all four
runs, with and without the new stages (§5).

**What counts.** Total counts what the ledger counts (ADR-0050), so the solver evens out the
figure the «Equidad» panel shows. A presence seat and a seat a `>=` minimum forces count; a seat
an exact `==` rule or the «Mes por medio» cadence sets aside counts on neither side (C2 LG-9), as
today.

## 3. What does not change

- **The wire.** `CONTRACT` stays 3. The response gains two `stages` entries; their ids fall under the
  existing `balance_max:{line}` / `balance_sq:{line}` templates of `codes.json`, so the registry, the
  audit and C6's sync test need nothing. `TOTAL` is the name of the response's existing Total tab
  (`tabs.TOTAL`) and cannot collide with a line (`DL`, `SL`, `BGV`, `CORO`, `P:<id>`). The public
  label (§11.2) is the id itself.
- **The ledger, the records, the request, the confirm.** Nothing in `app/utils/fairness*` or the
  fairness golden fixture changes.
- **Determinism and settings** (§7.2, §10): same parameters, same per-stage limits, same 25 s budget.
- **The client.** Nothing parses stage ids; `v3Copy.ts` labels them. One copy line: `lineLabel`
  maps `TOTAL` to «Total», so the run panel reads «Equidad Total: el más pendiente» / «… reparto»
  (today's fallback would print «Equidad TOTAL»).

## 4. Rejected

- **Carried balances in Total.** Lets Total pay a line's debt on another line while the line still
  owes it (§2); broke the floor proof in 2 of 12 chained cells and gained nothing on Total (§5).
- **Total first, roles after** (Total stages before the line pairs). Measured on run #3: Total
  Σ after² 21 500 instead of 22 900 (6 % better), but the Coro line's largest debt rises from 0.35
  to 1.35 seats. Roles would bend for a small Total gain.
- **Each role within ±1 seat, then Total, then refine the roles.** Prototyped two ways (line
  most-owed fixed, Total, then line spread; and the same with every line capped at one seat above
  the fair figure): both gave exactly the strict order's per-line and Total figures on run #3. More
  code and a new tolerance to explain, for nothing measurable.
- **Only Total.** Roles are not worth the same, Lead has a small pool, and an identical Total is
  impossible with availability and eligibility limits (a member eligible for Coro only).
- **Counting seats set aside by an exact rule or the cadence in Total.** It changes the ledger's
  definition (ADR-0050, the golden fixture, the records already written) and the panel would stop
  showing what the solver evened out.
- **New stage codes** (`balance_total_max` …). A registry change, new copy and a sync-test change on
  both sides, for the same behaviour the existing templates already carry.

## 5. Evidence

**The four captured production requests** (the solver's own code, run locally with each request's
seed; aggregates only). None of them carries a balance (November 2026 is the balance start,
ADR-0055), so carrying or not makes no difference here:

| Run | Per-line stage values | Σ after² before → after | Spread | ≥ 1 seat off | New stages (status, det_milli) | C5 checker |
|---|---|---|---|---|---|---|
| 10-16 | identical | 75 757 → 28 825 | 222 → 159 | 2 → 0 | proven, 13 / 18 | ok, max gap 24 |
| 10-20 #1 | identical | 74 741 → 31 403 | 213 → 204 | 3 → 1 | proven, 13 / 13 | ok, max gap 23 |
| 10-20 #2 | identical | 73 653 → 35 834 | 249 → 217 | 2 → 1 | proven, 9 / 13 | ok, max gap 24 |
| 10-20 #3 | identical | 71 283 → 22 932 | 256 → 160 | 2 → 1 | proven, 17 / 4 | ok, max gap 20 |

The one case still more than a seat off in runs #1–#3 is a seat forced by a `>=` minimum rule,
which no stage below `rules` may break. `total_ms` stayed between 1.0 and 1.4 s.

**The `full` acceptance matrix** (136 runs on the fictitious world, 12-month chains):

| | `main` | Total with carried (rejected) | This design |
|---|---|---|---|
| Criteria failing | none | `C.s2` and `D.s2` floor proof, F13 | F13 only, at the old tolerance |
| Largest floor-person cumulative balance | 1.83 | 2.44 | 1.89 |
| Largest floor-person slope (seats/month) | 0.118 | 0.150 | 0.104 |
| F13 gap: max / mean / 99th pct / > 30 (of 4 859) | 35 / 3.06 / 21 / 6 | 36 / 3.00 / 20 / 7 | 47 / 3.04 / 21 / 9 |

Cumulative balances since the start of each chain, 12 chained cells (C and D, seeds 1–6, 12 months):

| | `main` | Total with carried (rejected) | This design |
|---|---|---|---|
| Per person-line, largest absolute cumulative: mean / 95th pct / max | 1.06 / 2.00 / 3.54 | 1.06 / 1.85 / 3.67 | 1.03 / 1.69 / 2.62 |
| Per person Total, largest absolute cumulative: mean / 95th pct / max | 1.63 / 3.25 / 4.43 | 1.51 / 2.64 / 4.53 | 1.48 / 2.71 / 3.64 |
| Per person Total, absolute cumulative at month 12: mean | 0.94 | 0.86 | 0.86 |
| Floor-person series breaking ±2 seats or slope 0.15 | 0 of 46 | 2 of 46 | 0 of 44 |

The 47 is one person-line in one chained cell whose floor status flipped (planned no, realised yes),
the cause §12.4 names. The distribution is otherwise `main`'s. By §12.4's own procedure (the
smallest multiple of 5 at or above the measured maximum; above 50 would be a finding)
`FAIRNESS_TOLERANCE` becomes 50 (C5 §12.4 Amendment T-1). The private re-run was not repeated; the
four real requests stay at 20–24.

## 6. Changes

- `gcf_v3/owt_v3/model.py`: `total_inputs()` → `[(person, K, n, U)]` for the Total stage set;
  `obj_balance_max` / `obj_balance_sq` reused unchanged (the sum of `n` becomes one bounded int var
  for the square table).
- `gcf_v3/owt_v3/solver.py`: `stage_ids` and `solve_problem` run the pair after the line loop. The
  `consecutive_last` harness order (run O) keeps `no_consecutive` after the line pairs and before
  the Total pair.
- `gcf_v3/owt_v3/constants.py`: `TOTAL_LINE = "TOTAL"`; `SOLVER_VERSION` 3.0.0 → 3.1.0 (behaviour
  change, same contract); `FAIRNESS_TOLERANCE` 35 → 50 (§5).
- `app/components/admin/v3Copy.ts`: `lineLabel("TOTAL")` → «Total».
- Docs: C5 spec §7.1 and §12.4 amendments, the parent spec's D3 and F1, the C6 spec's §7 line
  copy, `docs/SOLVER_AND_INFRA.md`,
  `CONTEXT.md` («Línea»), ADR-0058 and the ADR index.

## 7. Tests

- `gcf_v3/tests/test_stages.py`: the stage order ends `…, balance_sq:CORO, balance_max:TOTAL,
  balance_sq:TOTAL, tiebreak`; two members tied on one BGV seat and one Coro seat get one each on
  every seed 1–8, the per-line stage values equal a run without the pair, and without the pair the
  tie-break stacks both on one person on some seed (the test is not vacuous); K is the planned Total
  share, rounded once (thirds on two lines give 267, not 266), and n summed over the lines is the
  Total tab's seats; a carried balance does not enter K; the accepted trade-off of §2 (a repaid line
  debt moves to another line's tie) is pinned; an exempt person is outside the set; the Total ids
  are their own public labels. `test_main.py`: the ping's `solver_version`.
- `app/components/admin/__tests__/v3Copy.test.ts`: the Total line and stage labels.
- Gates: `npx tsc --noEmit`, `npm test`, `npx eslint .` (0 errors), and
  `python -m unittest discover -s gcf_v3 -t gcf_v3` (with the acceptance `ci` subset); the `full`
  matrix offline (§5).

## 8. Rollout and verification

The function deploys only from `main` (Cloud Build trigger `owt-solver-v3-deploy`, `gcf_v3/**`, C5
§11.3), and dev and production call the same function. So:

1. Gates, then one code review of the range (§Review policy).
2. Merge into `preview`, verify the dev alias: dev shows only the «Total» label; the function is
   unchanged until `main`.
3. PR to `main`, `gates` green, merge. Cloud Build redeploys `owt-solver-v3`.
4. Verify: the next Auto response's `build` is the merge commit, `solver_version` is 3.1.0 and its
   `stages` carry the Total pair, all `proven`; the C5 checker passes on that run's HAR; the Total
   figures are compared with run #3.
5. Frank confirms November and December; then the record read-back already planned for them.

**Rollback:** revert the merge on `main`; Cloud Build redeploys the previous solver. Nothing stored
depends on the objective, so a plan confirmed under either version stays valid.
