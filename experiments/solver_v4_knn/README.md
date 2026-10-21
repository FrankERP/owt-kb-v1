# Solver v4 «KNN» prototype — experiment, not shipped

Frank's idea (2026-10-21): choose who serves the way a KNN picks neighbours, the distance being how
much each person has served. This folder is the multidimensional version of that idea, measured
against solver v3 with v3's own acceptance world and independent checker. Nothing here is deployed,
imported by the app, or run in CI.

## What v4 does (`knn_v4.py`)

A greedy fill, one seat at a time, most-constrained seat first. Each candidate is ranked by a sort
key compared left to right (priorities, never weighted sums — weights are what broke v2, ADR-0038):

1. does not make one of her own minimum / exact rules impossible;
2. urgency of an obligation this seat meets (minimum or exact rule, cadence «on», compensation
   Saturday, voice floor, DL floor, presence rule) = need ÷ chances left;
3. does not leave another open seat without enough candidates;
4. debt on the seat's line (carried + planned share − received, floor seats set aside);
5. future scarcity spared (how many open seats she is one of few able to fill and would lose);
6. Total debt (ADR-0058's share, summed over lines);
7. seeded tie-break.

Hard filters: one seat per service, eligibility, `<=`/`==` caps, pairs, consecutive rules, cadence,
presence kept meetable; protections (1 Lead a month, no consecutive Sundays) are relaxed only when a
seat would otherwise stay empty. `improve=True` adds a local search (hand a seat over or trade two
seats when nothing gets worse and the balance improves): that is beyond the KNN idea.

It reuses v3's request parsing, facts, planned shares and rule instances on purpose — the decision
method is what is under test — and answers with v3's `Report`, so `acceptance/checker.py` judges
both engines with one ruler.

## Run

    python experiments/solver_v4_knn/compare.py --seeds 5 --chain-seeds 3 --out experiments/solver_v4_knn/results.json
    python experiments/solver_v4_knn/variants.py 5

Needs `ortools==9.15.6755` (gcf_v3/requirements.txt). About two minutes.

## Results (fictitious world `gcf_v3/acceptance/world_realistic.json`, 2026-10-21)

`results.txt`, `variants.txt`, raw figures in `results.json`. Balances are in seats; Σ² is the sum of
squared balances after the plan (lower is fairer).

| | v3 | v4 | v4 + swaps |
| --- | --- | --- | --- |
| Nov+Dec: empty seats / rules broken / protections missed | 0 / 0 / 0 | 0 / 0 / 0 | 0 / 0 / 0 |
| Nov+Dec: Σ² per line | 4.26 | 4.85 (+14 %) | 4.77 (+12 %) |
| Nov+Dec: Σ² Total | 3.12 | 4.15 (+33 %) | 3.82 (+22 %) |
| 12-month chain: breaks / misses in the year | 0 / 0 | 0 / 0 | 0 / 0 |
| 12-month chain: worst cumulative balance | 1.65 | 2.56 | 1.94 |
| 12-month chain: 95th percentile | 1.46 | 1.32 | 1.35 |
| Scenario set P (15, excluding P15's timeout) | 15 | 13 | 13 |

v4 fails P4 (one consecutive Sunday more than needed, pins crowd the month) and P8 (one Choir seat
left empty when two people are away). The one-dimension version (fewest participations so far):
Σ² 67.65 per line, 3.2 rules broken and 1 protection missed per run.

Not yet run on real data: the captured production requests live on Frank's machine.
