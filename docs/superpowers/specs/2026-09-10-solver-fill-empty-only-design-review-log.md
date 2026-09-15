# Review log — «Solo llenar vacíos» (pinned assignments in the CP-SAT solver)

Artifact: `2026-09-10-solver-fill-empty-only-design.md`
Skill: `.agents/skills/adversarial-plan-review/` (vendored copy of the canonical skill).
**Status: open — eleven rounds, no approval yet.** The mechanism was rewritten twice: once
after round 2 (onto pins-as-fixed-variables) and once after round 6 (onto soft rules).
**Round 7 verified the rewritten mechanism sound** and found its two blockers elsewhere.
Current canonical digest `e054bb8e…`, commit `67c5f8f3`.

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
| 8 | `3f8490496bc16f37…` | `6bbc15dd` | CHANGES_REQUIRED | yes (1 blocker, reproduced) |
| 9 | `774c27754f3f79ea…` | `3a206274` | CHANGES_REQUIRED | yes (1 blocker, reproduced) |
| 10 | `71d9f0c7e86b6b4f…` | `64ee73b2` | CHANGES_REQUIRED | yes (1 blocker, reproduced) |
| 11 | `77f8f6f4f29ec277…` | `cf193fe2` | CHANGES_REQUIRED | yes (3 blockers, all client-side) |

Commit hashes for rounds 1–10 are the pre-rewrite ones. The branch was rewritten on
2026-09-14 to strip `Co-Authored-By` trailers that CLAUDE.md forbids; file contents are
byte-identical, so every digest above still verifies against the corresponding tree.

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

## Round 8 — the fairness adjustment was the wrong one, and provably so

The reviewer built their own prototype of §5 against a copy of the solver and ran it. Byte
identity with no pins, the pinned-only `KeyError` guard and the union-after-`pools` placement
all confirmed independently. One blocker.

**§5.1's hard-spread SUBTRACTION over-served the pinned member, and its stated justification
was false.** The spec bounded `total_vars[p] - n[p]` by `gmax`/`gmin` and called the resulting
over-service "the price of never failing the month". There is no such price. The upper bounds
of the two forms are algebraically identical — `t[p] - n[p] <= gmax` ⟺ `t[p] <= gmax + n[p]` —
but the lower bounds are not: subtraction forces `t[p] >= gmin + n[p]`, i.e. a **full
solver-chosen share on top of the pins**, while per-person slack asks only
`t[p] >= gmin - n[p]`. Slack's feasible set is a strict superset, so it cannot fail a month
subtraction solves.

Reproduced by the author on an independent fixture (12 people, 4 weeks, 2 Saturdays, seed
fixed, no DSL rules; baseline spread 4–5, Sunday leads 2/2/2/2):

| Pins | Subtraction | Per-person slack |
|---|---|---|
| Rachel → `Sun.Lead` W1–3 | **7** total, **4 of 8** Sunday leads, `sun_bgv` tier relaxed to 2 | **5** total, **3** Sunday leads (exactly her pins), every tier at 1 |
| Vale → `Sun.Choir` W1–4 | **8** total against everyone else's 4 | ≤ 5, baseline distribution preserved |

The author's numbers are worse than the reviewer's on the same shape. In product terms: the
admin seats Rachel to lead three Sundays, turns on «Solo llenar vacíos», and Auto hands her
the fourth Sunday plus three more services — the opposite of what the feature means.

Everything subtraction was introduced to protect was re-verified on the slack build: no
fall-through to the fairness-free `stage_a` (no reported limit equal to `len(slots) + 1`), the
52-pin round-trip still identical at 52/52, byte identity on three seeds, and both round-6
reproductions still solving and naming the correct relaxed rule. Slack is better on every axis
measured, including the one subtraction existed for.

**Fixed**, and it settles a semantic the spec had never stated: **a pinned service counts
toward that person's share**. §12's ADR records subtraction as a rejected alternative with the
numbers above, since it is the form a reader will re-derive.

Non-blocking, all nine adopted and each re-checked first. The one worth naming: §8 claimed the
create-mode restriction was "structural, not a gate that could be got wrong" — false.
`handleCellsChange` runs `setCells(next)` **and** `setTouchedStoredRoleIds(...)` before its
stored-mode early return (`MonthGenerator.tsx:2467-2483`), so a «Borrar» rendered without a
`mode === "create"` guard would stage emptied seats on real service documents for the next
Save. §11 now asserts that neither control renders in stored mode. The rest: the mandatory lead
goes soft month-wide once any pin exists, so `diagnose_infeasibility`'s remedy text moves into
§6's copy; a `Sat.*` pin on a week with no Saturday gets a `ValueError`; the menu gains
«Instrumentos del mes»; one pin per *occupant*, not per cell; the handshake must not fire on an
empty board; the CI step pins python 3.12; `cloudbuild.yaml` is at the repo root; and §11's
skewed-pin case now asserts the distribution, not only that nothing was relaxed — which is the
assertion that would have caught this blocker.

**Pattern across 6–8.** Round 6 killed the exemption enumeration, round 7 cleared the mechanism
and found a client field and a CI gap, round 8 found the last piece of the mechanism that was
carried over unexamined from the rejected design. Each round's finding has been further from
the core and closer to the ordinary surface of a spec.

## Round 9 — a waiver written as a repeal

One blocker, reproduced on four seeds, and it is the first one whose defect was **only in the
prose**: the author's own verified solver patch already scoped the violation booleans per
week, but the spec described a weaker design — and the implementer follows the spec.

**§5.2 said "relaxing a rule switches it off for the month"** and defended that with a
measurement taken on a **count** rule (`Gaby Sun.BGV <= 1` staying at its bound after
relaxation). The reviewer showed the evidence does not generalise, and why it is structural:
`role_spread_vars` puts per-role counts in the objective (`:812-843`, `:956`), so a relaxed
count cap is still pulled back — but **nothing in the objective mentions pairings or group
presence**. A month-wide boolean on those families leaves the solver free to break them
anywhere. Reproduced against the shipped solver by deleting one rule at a time (seeds 7, 42,
101, 2024): pair rule off → the pair appears together in weeks with no pin; presence off →
gaps in weeks the admin never touched.

It would also have been **invisible**. `blockingReasons` evaluates restrictions and pair
conflicts only and never presence rules (`ruleEnforcement.ts:217`, `:346-412`), so a broken
presence rule renders nothing on the grid. The only signal would have been one amber line
naming a rule with no week, under a switch whose own copy promises it only fills empty seats.

**Fixed:** each boolean is scoped to the constraint **instance** — rule × week for presence,
rule × week × service for pairs, rule × week-pair for consecutive, week × service for the
mandatory lead, week for the Saturday anchor. DSL count rules keep one boolean per rule, and
the spec now says why that is not an inconsistency: `role_vars` are month totals, so the rule
has exactly one instance and no week to narrow to. Entries for per-week families carry their
week and, for pairs, their service — which is what lets §6 say «en la semana 3» instead of
implying a month-long repeal, and what §11 now asserts discriminatingly (the old
`len(pin_violations) == 1` assertion passes under both designs).

Author's verification after the fix: the presence gap lands in week 3 alone on four seeds
while the rule keeps holding in weeks 1, 2 and 4.

Six non-blocking items adopted. The one worth naming: **§11's byte-identity guard is the
easiest assertion in the spec to write vacuously** — `assert solve(cfg) == solve(cfg)` against
the new solver passes trivially, and it is what §13's whole rollback story rests on. It now
compares against a frozen golden captured against today's code and committed with the CI step,
which §13's step-zero ordering already makes natural. The rest: the completeness claim is
scoped to the boolean path (candidacy-granted rules never reach `pin_violations`); a month
infeasible for its own reasons gets a copy form that does not blame a pin; a timed-out pinned
month reads as a degraded-fairness month rather than an error; the optimise branch gains no
violation term (the ceiling is a constraint, and a new priority tier would multiply an already
~3.8e20 top weight); `pinned_honored` is counted after the solver's own dedup.

**Pattern across 6–9.** Round 6 killed the exemption enumeration; round 7 cleared the mechanism
analytically and found a client field and a CI gap; round 8 found the last unexamined piece
carried over from the rejected design; round 9 found a place where the prose understated the
mechanism that was actually built. The defects are moving from the design into the description
of it.

## Round 10 — the round-9 fix was the blocker

One blocker, reproduced, and it lands squarely on what round 9 had just mandated.

Round 9 correctly rejected `assert solve(cfg) == solve(cfg)` as vacuous and required a
**frozen literal golden** instead. Round 10 showed a frozen golden is not reproducible either:
`solver.parameters.max_time_in_seconds` (`:963-966`) is **wall clock**, so a fixed seed fixes
the search *order*, not where it stops. The returned incumbent depends on how many nodes the
machine got through.

Reproduced by the author against the repo's own `make_config` fixture, varying only the budget:

| Seed | 9 s | 8 s | 7 s | 6 s | 5 s | 4 s | 3 s |
|---|---|---|---|---|---|---|---|
| 1 | = | = | = | = | = | = | = |
| 42 | = | = | = | = | = | = | = |
| 7 | = | = | **X** | **X** | **X** | **X** | **X** |
| 2024 | = | = | = | = | = | = | **X** |

A golden captured on a developer's machine would fail or flake on `ubuntu-latest` — and the
pressure at §13's step zero would point straight back at the tautology round 9 forbade. The
reviewer also caught the conflation underneath it: §13 said "by the byte-identity property the
deployed solver behaves exactly as it does today", but what `soft = bool(pin_set)` buys is an
identical **model and search**, not identical **output**, which is not a property this solver
has ever had.

**Fixed with two guards, both measured before writing them.**

1. **A structural fingerprint, now the primary guard.** SHA-256 over the ordered `x` keys, the
   per-slot candidate lists and the `rand_w` draw sequence — all built before any solve and
   seeded only by `config.seed` (`:571`, `:633`, `:946`). Measured identical at a 10 s and a
   3 s budget on all four seeds **including seed 7**, and distinct between seeds. It also
   catches §13's actual named hazard (`build_slots` losing its `Sun.BGV`/`Sun.Choir`
   interleave) directly, rather than through the board that hazard happens to perturb.
2. **The output golden, with a checkable precondition.** Instrument `CpSolver.Solve` and assert
   the **returning** solve reports `OPTIMAL`. Measured: seeds 1, 42 and 2024 do; seed 7 returns
   `FEASIBLE` — and seed 7 is exactly the budget-dependent one. The precondition disqualifies
   the bad fixture automatically instead of relying on a seed chosen by luck.

§13 now claims model identity rather than output identity.

Six non-blocking items adopted, two of them substantive. **`excluded_pwr` is not scoped for a
pin** (`:728-731`): a pinned member who is also week-excluded is dropped from the weekly-presence
terms even though their pin satisfies the rule, so E3's *headline* case would have shown a
spurious «Se dejó de aplicar una regla…». (This was raised as non-blocking in round 6 and never
applied — a dropped item that took four rounds to resurface.) And **§10's premise was false**:
the infeasibility diagnostic does not reach the admin today either — the route answers `422`
(`app/api/admin/solve/route.ts:138`) and `handleAuto` parses the body only when `res.ok`
(`MonthGenerator.tsx:3058-3065`), so it is dead text in the app. The rest: §6's
over-pinned-row notice is dropped (§5.1 grows the row and the grid already paints `+N`); the
`builtin:` markers create a new date-formatting site that takes CLAUDE.md's noon-pinned parse;
the switch state is owned by `MonthGenerator`, whose three consumers are the ones that matter;
and the priority weight is ~9.6e16, not ~3.8e20.

The reviewer also flagged, correctly, that the churn cap's state is **not visible from the
spec** — a fresh reviewer cannot tell whether the go-aheads exist. The spec now opens with a
pointer to this log, which records that Frank authorised every round past the cap individually
and in advance.

**Pattern across 6–10.** Round 6 killed the exemption enumeration; 7 cleared the mechanism and
found a client field and a CI gap; 8 found the last unexamined piece of the rejected design; 9
found prose describing something weaker than what was built; 10 found that round 9's own remedy
did not hold. That last one is the signal worth watching: for the first time the defect was
introduced by the previous round's fix — the failure mode CLAUDE.md records for the 15- and
19-round loops.

## Round 11 — the solver is settled; every blocker was on the client

The reviewer patched a scratch copy of the solver and re-derived §5's headline claims
independently: baseline totals 3–4 with no tier relaxed; Rachel pinned three times ends at 4
total with a `Sun.Lead` count equal to her pin count exactly; a pinned-only person seated only
at the pin with no `KeyError`; a 42-pin full board byte-identical to the un-pinned solve. They
also walked every `model.Add` and confirmed §5.2's table is complete. **Two consecutive rounds
have now found nothing in the solver mechanism.**

All three blockers were client-side, and the first two were promises the spec made that the
code would not keep.

1. **The conflict notices promised a guarantee the default configuration breaks.** Cases 1–3
   ended «— se va a respetar tu decisión», unconditionally. But E2 makes the switch **off by
   default**, and §7 had enumerated the switch's consumers exhaustively without including the
   notices. With the switch off `applySolveResponse` replaces the cell wholesale
   (`plannerModel.ts:929-936`) and the Auto dialog says so itself
   (`PlannerGrid.tsx:2035-2040`). So on the **default** path an admin would seat an unavailable
   member, read a brand-new signal telling them their decision is safe, press Auto, and lose
   the person. §7's own sentence convicts it: "A label that promised more than it does is a
   defect this repo keeps recording." **Fixed:** the fact renders unconditionally, the
   guarantee clause only with the switch on; the notices become the fourth consumer of the
   switch state, which is why it is owned by `MonthGenerator`. §11 asserts both renderings of
   the same cell.

2. **«Re-running Auto is the undo» was false, and it was the entire safety argument for an
   immediate, unconfirmed clear.** `applySolveResponse` has no memory of what a cell held, a
   cleared cell contributes no pins, and there is no undo stack anywhere in the planner
   (grepped). One menu click destroyed a whole service's hand-placed voice **and instrument**
   picks irrecoverably — the exact loss E1 exists to prevent. **Fixed:** the clear raises a
   `useToast` with its documented `action` («Deshacer») holding the previous `cells` array,
   which `handleAuto` already has in hand as `previousCells` (`MonthGenerator.tsx:3072`), so it
   is a closure rather than new bookkeeping. A toast rather than a dialog, because confirming
   every single-service clear would make the common action tedious.

3. **The `unfilled`-marker pass admitted a reading that destroys the short-staffing signal.**
   "Drops any marker on a cleared cell", in a handler that receives the whole `next` array
   (`MonthGenerator.tsx:2466`) — so the natural implementation keys on **state**, and a seat
   that was never filled because nobody was available also reads as empty. The first unrelated
   manual edit anywhere in the grid would wipe every legitimate marker and zero «Lugares sin
   cubrir (faltó gente)». **Fixed:** keyed on the **transition** (had occupants, now has none),
   diffing against `cells`, with the discriminating assertion added to §11 — the old assertions
   passed under both readings.

Six non-blocking items adopted. Two were the spec catching itself out: §10's two-pin
`ValueError` rationale claimed a better message, which contradicts §10's own finding three
bullets earlier that no solver error text reaches the admin; and `violation_target` bounds the
**count** of relaxed instances, not which ones, so §6 can name a rule that another
equally-optimal solution would have kept. Also: the int64 argument is about the objective's max
value rather than the tier weight; `compute_absence_slack` is a fourth week-exclusion-derived
site, left unscoped deliberately; a `builtin:` marker for a deselected Sunday renders the week
ordinal; and the CI step pins `pythonpath` rather than relying on pytest's import-mode default.

**Pattern across 6–11.** 6 killed the exemption enumeration; 7 cleared the mechanism and found
a client field and a CI gap; 8 found the last unexamined piece of the rejected design; 9 found
prose weaker than the build; 10 found that 9's own remedy did not hold; 11 found nothing in the
solver at all and three things in the UI contract. The centre of gravity has moved off the
mechanism entirely.
