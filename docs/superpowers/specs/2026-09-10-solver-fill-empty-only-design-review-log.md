# Review log — «Solo llenar vacíos» (pinned assignments in the CP-SAT solver)

Artifact: `2026-09-10-solver-fill-empty-only-design.md`
Skill: `.agents/skills/adversarial-plan-review/` (vendored copy of the canonical skill).
**Status: open — seven rounds, no approval yet.** The mechanism was rewritten twice: once
after round 2 (onto pins-as-fixed-variables) and once after round 6 (onto soft rules).
**Round 7 verified the rewritten mechanism sound** and found its two blockers elsewhere.
Current canonical digest `3f849049…`, commit `5e640764`.

Approval is not authorization to implement. Implementation still requires the plan, the three
gates, and a fresh code review of the diff.

## Risk tier

**Critical**, derived from the ladder: the artifact changes `gcf/owt_solver_v2.py`, which is
deployed by an irreversible remote release action (a Cloud Build trigger on `main`, filtered
to `gcf/**`) and serves **both** environments from one Cloud Function — the solver half never
reaches `preview` first. Requirement for approval: two sequential fresh `APPROVED` verdicts on
byte-identical text.

## Rounds

| Round | Reviewed digest (SHA-256, prefix) | Commit | Verdict | Substantive? |
|---|---|---|---|---|
| 1 | — | `1299b678` | CHANGES_REQUIRED | yes (5 blockers) |
| 2 | — | `8339d914` | CHANGES_REQUIRED | yes |
| 3 | — | `81591979` | CHANGES_REQUIRED | yes |
| 4 | — | `c9cc50bd` / `f5aff11e` | CHANGES_REQUIRED | yes (4 blockers) |
| 5 | — | `37cd3876` | CHANGES_REQUIRED | yes (2 blockers, one root cause) |
| 6 | `3d99b384566d7987…` | `3193b2c4` | CHANGES_REQUIRED | yes (1 blocker, reproduced) |
| 7 | `da922d6afb21fb47…` | `6bf8e4a4` | CHANGES_REQUIRED | yes (2 blockers, both verified) |

Every round used a brand-new `skeptical-reviewer` dispatch given only the reviewer brief, an
immutable snapshot whose digest was verified equal to the canonical file before dispatch, the
repository path, the evidence pointers and the user's original wording. No reviewer saw this
log, a prior verdict or a rebuttal. **From round 3 onward every reviewer patched a copy of
`owt_solver_v2.py` and executed it**; so did the author, for every fix after round 5.

Frank authorised rounds 3, 4, 5 and 6 individually, each in advance.

## The through-line: one wrong idea, three deaths

Rounds 3–6 were not four unrelated defects. They were the same idea failing four times: **that
the spec could name, in advance, which rules a pin would break.**

- **Round 3–4** — the exemption list was keyed on *row saturation* (a pinned row has no spare
  capacity). Broken by the per-service occupancy limit (`:754-765`): pinning someone into
  `Sun.Lead` removes them from every other Sunday role that week, in a row nowhere near full.
- **Round 5** — re-keyed onto *satisfiability*, stated as a four-case account of how a member
  of a group can be blocked (pinned elsewhere in the service, week-excluded, row full, already
  pinned in). Broken with **one pin** on the shipped rules.
- **Round 6** — broken again, twice, by mechanisms no account over *candidacy* can see:
  - a DSL `<= N` cap whose budget the pins consume — `Hugo Sun.BGV <= {weeks-2}` (the cap
    shape the seed already uses for Gaby, `solverConfigDefaults.ts:70`) with Hugo pinned into
    `Sun.BGV` weeks 1–2 and Jakey out weeks 3–4. `max(rule.value, pinned_count)` leaves the
    bound at 2 and changes nothing. Raising the cap makes the identical pin set solve.
  - a pair-exclusion rule with a pinned counterpart. A pair rule is a model constraint
    (`:711-722`), not a candidacy filter.

  Worse than failing: §10 left `diagnose_infeasibility` unchanged *because* the completeness
  was believed, so the admin was shown "a mandatory Lead seat cannot be filled … Leads are
  available, so a hard restriction is over-constraining the model" — the wrong cause, with no
  mention of the pin that caused it.

The round-6 reviewer reached the design conclusion independently: *"this is the third round of
the same failure, which is itself evidence that enumeration is the wrong shape for this
predicate."*

## The rewrite (post-round-6, un-reviewed)

The enumeration is gone. Under pins, every constraint a pin can contradict carries a violation
boolean and Stage A minimises `(max_weighted_empty + 1) · n_viol + weighted_empty`, so
breaking one fewer rule beats filling any number of seats; Stage A's count becomes a ceiling
for Stage B. Six constraint families go soft (mandatory lead, Saturday anchor, weekly
presence, pair, consecutive, all three DSL count operators). Two stay hard and neither can be
contradicted by a pin: the per-service occupancy limit is *what a pin means*, and the week
exclusion is scoped to the pin's own row rather than relaxed. With no pins nothing of this is
emitted.

The solver returns `pin_violations`, so §6's conflict notice reports what was **actually**
relaxed instead of predicting what might clash — the client could never see enough to predict
it, which is the same root cause one layer up.

**Verified by execution before the section was written** (patched copy of `owt_solver_v2.py`,
scratch only):

| Property | Result |
|---|---|
| Byte identity with no `pinned` key, seeds 7 / 42 / 1234 | identical board, totals, unfilled |
| Round-6 repro (i), the `<=` cap | rules hard → `ok: false`; soft → solves, `pin_violations: ['Hugo Sun.BGV <= 2']`, 2/2 pins |
| Round-6 repro (ii), the pair rule | rules hard → `ok: false`; soft → solves, names the presence rule |
| Round-5 repro, one pin + absent partner | rules hard → `ok: false`; soft → solves, names the presence rule |
| 52-pin full-board round-trip | 52/52 honoured, roster identical, `pin_violations` empty |
| Clear one service, re-solve | only that service's rows moved |
| Skewed pin load (3 pins on one person) | totals 7 vs 4 — i.e. 4 solver-chosen each, the documented bounded compensation; no violations |
| Pinned-only person in no pool | seated at the pin only, `total_counts` = 1, no `KeyError` |
| Two pins, one person, one service | `ValueError` at the boundary |
| Relaxed cap overshoot | `Gaby Sun.BGV <= 1` + 2 pins → exactly 2, not more |

In all three reproductions the **rules-stay-hard control fails**, which is what makes the new
§11 cases discriminating — the previous suite drew its pins from the solver's own output,
which satisfies every rule by construction, and so passed over every reproduction.

## Churn cap

Four substantive rounds on this mechanism (3, 4, 5, 6); rounds 3–6 each ran on Frank's
explicit advance go-ahead. The round-6 remedy was a **rewrite, not a seventh round** — the
same call that CLAUDE.md records for the 15- and 19-round loops of 2026-08-11/12, made this
time on the third repetition rather than the fifteenth.

## Process failures on the author's side

- **The same idea was asserted four times.** Each round I repaired the *instance* the reviewer
  produced and left the *shape* alone, three times in a row. The reviewer named the shape
  before I did.
- **A completeness claim was load-bearing for a second section.** §10 skipped work
  (`diagnose_infeasibility`) *because* §5.2 claimed completeness, so the wrong claim did not
  merely fail — it removed the diagnostic that would have told the admin what happened.
- **A test suite built from the solver's own output cannot fail.** Round 5 caught it; the
  lesson generalises and is now stated in §11 as a test-design rule rather than a fix.
- Every reviewer claim was independently re-checked against the file or by execution before
  adoption; no citation was taken on faith.

## Post-round-6 changes (un-reviewed)

Everything in "The rewrite" above, plus round 6's six non-blocking items (commit `96ccb3eb`):
the §5.1 compensation sentence that contradicted the paragraph below it, the `strict`-collapse
rebuild excluding pinned-only people, the hand-placed count under-reporting as well as
over-reporting, the `unfilled` count falling as empty seats rise, the app-only rollback, and
three citation corrections. None of this has been through a review round.

## Round 7 — the mechanism cleared; the blockers moved outward

**The rewrite held.** The reviewer did not re-execute the patched solver; instead they
constructed a **feasibility certificate** — pins set, every other `x` at 0 — and checked it
against every `model.Add` in `create_model_and_solve` (`:645-897`). The only hard survivors are
the `filled` definitions, the scoped week exclusions, the `<= 1` occupancy limit and the
pin-adjusted spreads, all satisfied at adjusted count 0. So a pin cannot make the month
infeasible, analytically and independently of the author's execution run. `isSolvable`
(`plannerModel.ts:374-380`) covers exactly the five pin roles, so the role union is complete.

Both blockers are in territory the first six rounds never reached, which is what a mechanism
being settled looks like.

1. **The switch destroys the admin's recorded rule waivers.** `applySolveResponse` rebuilds a
   cell as `{columnId, rowId, occupants, origin}` (`plannerModel.ts:929-936`), dropping
   `overrides` and `overrideReasons` — whose own doc-comment says they live on the cell
   because it survives "a re-render, a step round-trip **and a re-solve**". Today that drop is
   correct *by accident*: the solver enforces pair rules and exclusions hard, so the waived
   seat never comes back and pruning the waiver is right. §5.2 makes those rules soft and pins
   the seat, so it **does** come back, into a cell with no waiver —
   `ruleViolationsForColumn:535-536` takes the `waived === undefined` path and reports
   `{ overridden: false }`, a fresh red violation on a seat the admin already decided. It
   cascades: the sanctioned seat is no longer removed from `sanctionFree` (`:542`), so the
   partner of a waived pair flags too. Directly contradicts E1.
   **Fixed:** a pinned cell keeps `origin`, `overrides` and `overrideReasons`, pruned to the
   occupants that came back, reusing `withUpdatedCell`'s existing prune
   (`PlannerGrid.tsx:452-465`); the clears drop them, because a surviving waiver would
   pre-sanction the cell's next occupant. §11 gets the waived-pair assertion.

2. **§13's production-first rollout rested on a suite no gate runs.** `.github/workflows/ci.yml:36-52`
   runs `tsc`, `vitest`, `eslint` and nothing else; `package.json` has no python script;
   `gcf/cloudbuild.yaml` is a single `gcloud functions deploy` with no test step. So
   `gcf/test_owt_solver_v2.py` — holding the byte-identity guard, the fairness-collapse guards,
   the rules-stay-hard control and the pinned-only `KeyError` guard — runs only when a human
   remembers, and the `gates` check CLAUDE.md makes the merge condition for `main` proves
   nothing about a `gcf/**`-only PR. Meanwhile §13 ships the solver to production without
   preview *and* names that suite as what makes doing so safe. CLAUDE.md's own words:
   "that property is what makes it a control rather than an intention."
   **Fixed:** the delivery adds a `pytest gcf/` step to the existing `gates` job (not a second
   workflow, so one required check keeps meaning "everything passed"), and §13's rollout order
   now starts after that gate is green on `main`.

Non-blocking, all seven adopted and each re-checked first: the Stage B nest is four-deep and
its `optimize=False` passes set no objective at all (`:899-903`), so `violation_target` is
emitted as an unconditional constraint rather than an objective term; the solver has no
calendar (`build_slots:547-562`) so the two built-in requirements reach `pin_violations` as
`builtin:` markers the client localises, not as Spanish date strings; the `all_people` union
re-sorts; the clear menu's behaviour over special columns is stated (a special's Coro and its
instruments are never refilled, so they survive); a weekend column whose `weekForColumn` is
`null` contributes no pins; the skewed-pin fixture is sized so the tier is genuinely
satisfiable; the Auto confirmation's instrument sentence changes too; the marker-dropping pass
sits after `handleCellsChange`'s stored-mode early return.

**What round 7 says about the two earlier rewrites.** Rounds 3–6 all landed on §5.2. Round 7
found nothing there — the first round since round 2 that did not. Its findings are a client
field the spec never inventoried and a CI gap, i.e. the ordinary surface of a feature spec
rather than a mechanism defect.
