# Pinned assignments in the CP-SAT solver — design spec (solver half)

**Date:** 2026-09-15 · **Status:** split out of `2026-09-10-solver-fill-empty-only-design.md`
after eleven adversarial review rounds; **carries the critical contract** · **Risk tier:**
**critical**

Critical, derived from the ladder and not adjusted: this changes the request contract and the
hard constraints of a **production solver** that is deployed by an irreversible remote release
action (a Cloud Build trigger on `main` filtered to `gcf/**`) and that serves **both**
environments from one Cloud Function — the solver half never reaches `preview` first.
Requirement: **two sequential fresh `APPROVED` verdicts on byte-identical text.**

## 0. Why this file exists

The original spec covered the solver contract **and** the whole admin UI — the switch, the
«Borrar» menu, the conflict notices, the toasts — in one critical-tier artifact. Eleven review
rounds later the split was forced by the evidence rather than chosen for tidiness:

- **Rounds 10 and 11 found nothing in the solver mechanism.** Both reviewers patched a copy of
  `owt_solver_v2.py` and executed it; both confirmed pins are honoured, fairness does not
  collapse, a pinned-only person is safe, and a full-board pin set reproduces the un-pinned
  roster exactly.
- **Round 11's three blockers were all UI contract**: a label promising a guarantee the default
  configuration breaks, a clear with no undo behind a false mitigation, and an ambiguous
  marker-dropping pass. CLAUDE.md's own retier note says that class belongs to the **diff
  review**, not to plan review — "Child E ran 19 plan-review rounds and the post-merge *code*
  review still found three control-flow bugs."
- **Round 10 found a defect introduced by round 9's fix**, which is the churn signature
  CLAUDE.md records for the 15- and 19-round loops whose real remedy was a restructure.

So the critical contract is reviewed here, alone, at a fraction of the surface. The client half
moves to `2026-09-15-fill-empty-only-client-design.md` as **standard-risk** work — spec, Frank's
review, implementation, and a fresh code review of the diff.

**Ordering:** this half ships first and must be live before the client half sends a single pin.
See §9.

## 1. The brief

Frank, during delivery 1's brainstorm: «me gustaría tener una opción para que el solver llene
únicamente los espacios vacíos, en vez de sobre escribir todo». Today «Generar mes» rewrites
every solvable voice row on every weekend column, so a manual correction survives exactly until
the next Auto.

**This file's job is the part of that the solver owns**: accept a set of already-decided seats,
honour every one of them, fill the rest as well as it can, and say what it had to give up to do
it. What the admin sees and clicks is the client half's problem.

Delivery 1 (declared instruments and automatic instrument fill) shipped 2026-09-10 in PR #57
and is independent; nothing here changes it.

**The mechanism rewrite (2026-09-10).** Two review rounds rejected an earlier design in which a
pinned seat was **removed** from the solver's slot list and the pinned person re-entered as a
constant. That made every interaction with the model a manual offset: round 1 found four that
had been missed, and round 2 found two more plus a reproduced regression — a pinned person with
no candidacies forced `total_vars` to zero, which pinned `gmin` to zero and capped every other
member at one or two services for the whole month. The mechanism below fixes the variable to 1
instead, which makes those interactions automatic. §3 records what that buys and what it still
costs.

> **Review state.** The ledger for all eleven rounds on the combined spec — including the two
> mechanism rewrites and Frank's explicit per-round go-ahead for every round past the churn cap
> — is in `2026-09-10-solver-fill-empty-only-design-review-log.md`. A reviewer who wants to know
> whether the cap was respected should read it there; it is deliberately not summarised here, so
> that no round sees a prior verdict.

## 2. What the repo says today

Every row verified against the tree at `ae792034`, which is unchanged in `gcf/` and
`plannerModel.ts` at the commit this spec sits on.

| Fact | Where |
|---|---|
| Decision variables `x[(person, slot.key)]` exist **only** for people in `candidates[slot.key]`, which `build_candidate_map` fills from `is_eligible` | `gcf/owt_solver_v2.py:638-641`, `:564-582` |
| Seats are positional and interchangeable — `Sun.Lead` #1 and #2 are the same role; the response serializes names into per-role lists | `build_slots:547-562`, `build_schedule_view:1142` |
| `all_people` is **derived from the three pools** and guarded by a mutual-exclusivity check; there is no `all_people` input field | `validate_config:452-454` |
| `_eq(model, v, [])` forces the variable to `0` — a person with no candidacies counts as zero, not as absent | `:586-587` |
| Global fairness is a **hard** constraint, `gmax - gmin <= fairness_limit` | `:794` |
| **Two more spreads are hard and easy to miss**: `cur_sun_lead_spread <= sun_lead_limit` and `cur_sun_bgv_spread <= sun_bgv_limit` | `:865`, `:882` |
| The relaxation loop is a **four-deep nest** over `sl_limit`, `sb_limit`, `g_limit` and `opt in (True, False)`, not a single ladder; falling through returns the fairness-free `stage_a` | `solve_schedule:1120-1133`, `:1137` |
| On an `optimize=False` pass `create_model_and_solve` sets **no objective at all** — the `elif optimize:` branch is skipped and nothing is minimised | `:899-903` |
| Fairness **slack** already exists as the escape valve, and absence already uses it: `combined_slack = fairness_slack + absence_slack` feeds `global_slack` | `:1063-1066`, `:790-793` |
| A **soft** per-role spread also exists, over `overall_role_vars` which already includes `hist_role`, and only enters the objective | `:812-843`, `:956` |
| A soft consecutive-repeat penalty is built from `x` terms and is **on by default** — the client never sends the flag | `:905-927`, `:1211-1213` |
| The DSL cannot express a pin: week-scoped ABSENCE, month-scoped counts, group weekly presence, and nothing that says "must serve" | `docs/SOLVER_AND_INFRA.md:37-44`, `parse_dsl_rules:227` |
| `solve_from_dict` reads every field with `data.get(...)`, so an **unknown key is silently ignored** | `:1194-1213` |
| Member unavailability is compiled into hard `!in week n Sun.*` / `Sat.*` DSL rules inside the same request | `plannerModel.ts:796-806` |
| Local development runs the repo's own solver directly, bypassing the deployed one | `app/api/admin/solve/route.ts:69-108` |
| Cloud Build deploys `gcf/**` on `main`; Vercel deploys the app from the same branch | `cloudbuild.yaml:4-6` |


## 3. Decisions

Of the eight decisions Frank approved on 2026-09-10, these four bind the solver. The other four
(E1, E2, E6, E7 — what the switch preserves, its default, the «Borrar» menu, and create-mode
scope) are the client half's and are recorded there.

- **E3 — When a pin contradicts a rule, the pin wins, and the conflict is shown.** A
  non-blocking amber notice, never a refusal. Frank: «gana el pin, pero sigue mostrando el
  aviso acerca del conflicto, no es algo que bloquea». One collision is *guaranteed*, not
  hypothetical: availability compiles to a hard `!in week n` rule while the picker lets an
  admin seat that same person anyway.

- **E4 — A pin is a fixed variable, not a removed seat.** See §5.

- **E5 — Conflicts are computed on the client**, so the notice appears when the person is
  seated rather than when Auto runs. The solver is not asked to explain conflicts.

- **E8 — The response must prove the pins were honored.** A silently-ignoring old solver is
  a real deployment state. The refusal itself is client behaviour — see the client spec's §7.

## 4. The request contract

`SolveRequest` (`app/api/admin/solve/route.ts:10`) gains one optional field:

```ts
  /**
   * Seats already occupied on the board that the solver must treat as settled.
   * Optional and absent-means-empty, so a request without it behaves exactly as
   * it does today. One entry per person per role per week.
   */
  pinned?: Array<{
    week: number;                 // 1-based, from weekForColumn
    role: "Sun.Lead" | "Sat.Lead" | "Sun.BGV" | "Sat.BGV" | "Sun.Choir";
    person: string;               // resolved member_name, as every other name in the request
  }>;
```

`service` is deliberately not a field: the role already encodes it (`Sun.*` / `Sat.*`), and
a second source for the same fact is a second thing to keep in step.

`SolveResponse` gains two fields, both absent-means-nothing so an old client is unaffected:
`pinned_honored?: number` (the handshake, the client spec §7) and **`pin_violations?: string[]`** — the rules
the solver had to relax to honour the pins. the client spec's §4 renders them; §5.2 explains why they exist.

**`pin_violations` grammar, specified rather than exemplified.** This half ships first and
irreversibly, the client renders an unknown marker with a generic fallback, and a mismatch
between the two would show that generic line forever with both suites green — so the strings
are a contract, not illustrations:

**This table is the single normative statement of the grammar.** Nowhere else in this file, and
nothing in the client spec, may spell a marker differently; both cite here.

| Family | Entry |
|---|---|
| DSL count rule | `<person>: <source>` |
| Weekly presence | `W<n>: <source>` |
| Pair exclusion | `W<n> <Sun\|Sat>: <source>` |
| Consecutive | `W<n>-<n+1> <person>: <source>` — `n` is the earlier week of the pair |
| Mandatory lead | `builtin:mandatory_lead:W<n>:<Sun\|Sat>` |
| Saturday anchor | `builtin:sat_anchor:W<n>` |

**The service token is `Sun` / `Sat`, not `Sunday` / `Saturday`.** Every other identifier that
crosses this boundary already uses the short form — the `pinned.role` field, `Sun.Lead`,
`Sat.BGV`, `mapUnfilledSeats`' keys — so one vocabulary rather than two. The solver's internal
`SUNDAY_SERVICE` / `SATURDAY_SERVICE` constants are `"Sunday"` / `"Saturday"`
(`owt_solver_v2.py:66-67`) and must be **mapped**, not interpolated.

**`<person>` comes from the parsed rule object, never from `source`, because `source` drops it.**
`restrictionToDs` emits one line per member with the name prefixed **once**
(`plannerModel.ts:572-585`) and `parse_dsl_rules` splits on `&` storing `source=clause`
(`:312`, `:409`), so every clause after the first is subject-elided. Executed against the
shipped parser:

```
'Gaby !in Sat.* & !in Sun.Choir & fairness_slack 1 & Sun.BGV <= 2'
    -> DslCountRule(person='Gaby', source='Sun.BGV <= 2')     # name GONE
'Hugo Sun.BGV <= 2'
    -> DslCountRule(person='Hugo', source='Hugo Sun.BGV <= 2')
'Gaby !in Sat.* & !consecutive on *.Lead'
    -> DslConsecutiveRule(person='Gaby', source='!consecutive on *.Lead')  # name GONE
```

The shipped Gaby seed is the first shape (`solverConfigDefaults.ts:64-71` puts
`excludedPatterns` before the cap), so without the explicit person the production notice would
read «Se dejó de aplicar una regla … «Sun.BGV <= 2»» — whose cap, nobody can say — and two
members capped on the same pattern would produce byte-identical entries. Count rules are the
only family with no week, so this would strip the last discriminator from the weakest entry.
Pair rules are exempt: the parser rejects an elided `!with` outright, so both names are always
in `source`. Presence rules carry their names inside `any_of(…)`.

**`resolve_dsl_templates` runs before parsing** (`:197-218`), so a `{weeks-2}` template never
reaches `source` — an entry shows the resolved number. §7's literals assert the resolved form.

§7 asserts each form against a literal, **and against a rule authored in the seed's merged
shape**, not a standalone one — a standalone rule keeps its name by accident and would pass
while production's entry is nameless. The client's own spec asserts its generic fallback for an
unknown `builtin:` marker, so the two suites together pin both sides of the boundary.

**The three existing `*_fairness_relaxed` fields are NOT additive, and their meaning shifts.**
`fairness_relaxed`, `sun_lead_fairness_relaxed` and `sun_bgv_fairness_relaxed` are derived from
the tier the ladder reached (`:1224-1226`) and drive a visible chip («Equidad relajada»,
`PlannerGrid.tsx:2073-2075`). Under pins the spread those tiers bound is over **slack-adjusted**
counts, so the flags keep their literal meaning — "the ladder had to loosen a limit" — while no
longer implying the *realized* distribution is balanced.

They are deliberately **left as they are**. Redefining a field an already-deployed client reads
is exactly the silent-contract-change this section exists to avoid, and the honest signal the
admin needs is the distribution, not the tier. §7 therefore asserts the **realized spread**,
never the flag, and the client spec is where any new notice belongs.

**Why a top-level field and not a DSL clause.** The DSL lives in a solver-config document
shared across admins and rendered in the rules panel; pins are per-run state derived from
the board. A new DSL form would make an ephemeral fact durable, show pins in the rules list,
and put them through the name-validation path that 422s on an unknown person. The third
option — leave the solver alone and merge in the client — is rejected outright: the solver
would not know about the pins, could seat the same person twice in one service, and would
compute fairness over a roster nobody will use.

**Identity, and pools.** Pins name people by resolved `member_name`, as the rest of the
request does. A pinned person **is not added to any pool**. `all_people` is derived from the
three pools behind a mutual-exclusivity guard (`:452-454`), so injecting a name there would
both trip that guard and — because `pools["Sun.BGV"]`, `["Sat.BGV"]` and `["Sun.Choir"]` are
`set(all_people)` — make the person a candidate for BGV and Coro in every service of the
month. That is the reachable harm the earlier design had: the documented way to stop
scheduling someone is to clear their Tipo (ADR-0029), which removes them from the picker but
leaves them seated in a month already built; pinning that seat must not hand them the rest
of the month back.

Instead the pin itself grants candidacy, and only where it points. See §5.1.

**What the client must not send.** Two pins for the same person in the same service are
unsatisfiable together (one slot per service per week per person, `:754-765`). The picker
already blocks that arrangement (`candidateRanking.ts:196-204`), so it cannot arise from
normal use, but `buildSolveRequest` deduplicates by person-and-service anyway, keeps the
first, and reports the rest as a conflict (the client spec §4). Pins are also deduplicated outright before
the handshake count is taken.


## 5. The solver: a pin is a fixed variable

For each pin (person P, role R, week W):

```python
model.Add(sum(x[(P, s.key)] for s in slots if s.week == W and s.role_type == R) == 1)
```

Pinned at the **role and week**, not at a slot index, because slots within a role are
interchangeable and pinning to an index would break that symmetry for nothing.

**What this buys, and it is the point of the rewrite.** P now has real variables, so every
mechanism that counts people or iterates slots sees the pin with no further code:
participation counts and the global spread, `role_vars` and the per-role spread, DSL count
rules, the Saturday dedicated-lead anchor, weekly presence, `filled` and `weighted_empty`,
the per-service occupancy limit, the soft consecutive-repeat penalty, and
`build_schedule_view`, so the response carries the pinned people back and the client's
replace semantics stays correct. The rejected design had to restate each of those by hand
and got two of them wrong twice.

### 5.1 The four changes that make a pin possible

**Candidacy, scoped to the pin.** `build_candidate_map` adds P to `candidates[slot.key]`
for the slots of (R, W) and **nowhere else**. P gains no candidacy in any other role, week
or service, so a pinned person who is in no pool — or whose Tipo was cleared — is seated
exactly where the admin seated them and nowhere else.

The union **re-sorts**: `all_people` is `sorted(...)` at `:452`, and every downstream
variable-creation loop plus `build_candidate_map`'s `rng.shuffle(people)` (`:571`) reads it in
order. Appending without re-sorting would shift the board for reasons unrelated to the pins.

**Rows grow to fit their pins.** `build_slots` emits `max(default_seats, pins_for(R, W))`
slots. Pin three leads where there are two seats and the row grows to three; it never
shrinks. This is the inverse of the rejected design and it is why over-pinning cannot be an
infeasibility.

**Pinned-only people join `all_people`, and leave the fairness groups.** A pinned person who
is in no pool is absent from `all_people`, which is derived from the pools alone (`:452`).
That is not a nuisance: `assignments` is seeded `{p: [] for p in all_people}` (`:979`) and
then appended to per solved variable (`:982`), so such a person raises `KeyError`, escapes
`solve_from_dict`'s `except (ValueError, RuntimeError)` (`:1216`), and reaches the admin as
"Solver service returned HTTP 500". The same omission silently skips them at every other
site keyed on `all_people` rather than on `x`: `total_counts` and `role_counts` (`:983-985`),
the per-service occupancy limit (`:755`), `total_vars` / `overall_total_vars` (`:772-781`),
`role_vars` (`:822`), and the soft consecutive penalty (`:907`).

So the solver unions the pinned names into `all_people` **after `pools` has been
constructed** (`:458-464`), and into no pool. The placement is the whole of it and an earlier
draft got it wrong: three of the five pool entries are literally `set(all_people)`, so a union
placed after the exclusivity guard at `:453-454` — which is *before* `pools` is built — makes
the person a BGV and Coro candidate in every service of the month. Reproduced: one pin became
four services. Built in the right order, `pools` is derived from the three pool lists only,
`is_eligible` keeps the person out of every candidate list the pin did not grant, and the
exclusivity guard is untouched because it compares the three lists against each other. They are then **excluded from the global and per-role fairness groups**: the
solver cannot choose them anywhere, so including them would let a person it has no power
over set `gmin` and cap everyone else.

**Fairness: every HARD spread gives each person slack equal to their pin count.**
A pin is a service the solver did not choose, so it must not be able to make the month
infeasible. There are **three** hard spreads, not one, and missing two of them is how a
three-pin action collapsed a whole month in review:

| Hard guard | Where the change lands | With pins |
|---|---|---|
| Global, `gmax - gmin <= fairness_limit` (`:794`) | the per-person loops at `:788-790` **and `:791-793`** | `total_vars[p] <= gmax + n[p]`, `>= gmin - n[p]` |
| `cur_sun_lead_spread <= sun_lead_limit` (`:865`) | `:861-863` | same, with their `Sun.Lead` pin count |
| `cur_sun_bgv_spread <= sun_bgv_limit` (`:882`) | `:878-880` | same, with their `Sun.BGV` pin count |

**A third mechanism the table does not name: cross-role displacement.** A pin in role R forces
the person to zero in every *other* role of that service (`:754-765`), while the per-role slack
is keyed on R alone. So twelve `Sun.Choir` pins move `sun_bgv_fairness_relaxed` for a reason
that has nothing to do with loosening anything. It is notice quality rather than collapse — tier
2 absorbed it in every case built, including pins owning a whole role — and §4's decision to
leave the flags alone is what contains it. Named so a reader does not read the table as
exhaustive.

The **Where** column names the per-person loops, not the `<= limit` lines: the limit lines are
where the spread is *bounded*, the loops are where each person is tied to `gmax`/`gmin`. The
second global loop (`:791-793`) is the one a reader skips — it handles exactly the people who
already carry absence slack, so missing it mis-bounds the population §7's heavy-pin-load
test exists to check. The slack **adds** to theirs; it does not replace it.

The **soft** terms are deliberately left alone and keep seeing the totals: `ov_total`
(`:777-781`) feeding `overall_spread` at `:949`, and `role_spread_vars` over
`overall_role_vars` (`:812-843`) feeding the objective at `:956`. So the preference ordering
stays aware of who is already ahead, and — unlike the rejected form below — it is actually
allowed to act on it.

**Rejected: subtracting the pin count instead (`total_vars[p] - n[p]` bounded by
`gmax`/`gmin`).** It looks equivalent and is not. The upper bounds are literally identical
(`t[p] - n[p] <= gmax` ⟺ `t[p] <= gmax + n[p]`), but the lower bounds are not: subtraction
forces `t[p] >= gmin + n[p]` — the pinned person must take a full solver-chosen share **on top
of** their pins — while slack asks only `t[p] >= gmin - n[p]`, letting the pins count as part
of what they have already served. Slack's feasible set is therefore a strict **superset**, so
it can never fail a month subtraction solves, and the fairness-collapse protection this whole
paragraph exists for is not weakened by a single case.

Measured, twelve-person month, seed-fixed, no rules — the baseline spread is 4–5:

| Pins | Subtraction | Slack |
|---|---|---|
| Rachel → `Sun.Lead` W1–3 | Rachel **7** total and **4 of 8** Sunday leads; `sun_bgv` tier needlessly relaxed to 2 | Rachel **5** total, **3** Sunday leads — exactly her pins; every tier stays at 1 |
| Vale → `Sun.Choir` W1–4 | Vale **8** total against everyone else's 4 | Vale ≤ 5; baseline distribution preserved |

Subtraction means: the admin seats Rachel to lead three Sundays, turns the switch on, and Auto
hands her the fourth Sunday **plus three more services**. That is not a trade, it is the
opposite of what «llenar solo los vacíos» means — what is already on the board is service the
person has performed. §8's ADR records subtraction as the rejected alternative with these
numbers, because it is the form a reader will re-derive.

**What the hard guard actually promises, which is less than an earlier draft claimed.** That
draft said "a pinned service counts toward that person's share — pin someone into many services
and the solver gives them correspondingly less elsewhere." **That is a tendency of the soft
objective, not a property of the model, and the spec must not state it as one.** The hard
upper bound is `t[p] <= gmax + n[p]`: it *permits* a pinned person a full solver-chosen share
**on top of** their pins. The only thing holding them down is `overall_spread` in the
objective.

And that containment is removable by a rule the shipped seed already uses. `fairness_exempt`
takes a person out of the fairness groups entirely (`solverConfigDefaults.ts` marks Frank and
Mkz exempt), which drops them from the soft term too. Measured on a twelve-person month whose
baseline gives Rachel 6: make Rachel `fairness_exempt`, pin her into `Sun.Choir` twice, and she
comes back with **8** — the two pins bought her nothing and she took a full share besides. The
same month with Rachel not exempt holds her at 5.

So the honest statement is: **a pin never forces the solver to give that person *more* — and
never guarantees it gives them less.** For a person inside the fairness groups the objective
does pull them back toward their share, which the un-exempt row above shows. For an exempt
person there is nothing to pull. §7 asserts the realized distribution in both configurations
rather than claiming a bound the model does not carry, and §8's ADR records the limit of the
guarantee alongside the rejected subtraction.

**Rejected as the fix: capping the upper bound at `max(gmax, n[p])`.** It is the obvious
repair — a pinned person may never exceed the fair share unless their own pins already do —
and it *was implemented and run*. It does contain the exempt case, but it does not address the
ladder behaviour below, and it adds an `AddMaxEquality` per pinned person to the hardest
constraint in the model for a guarantee the objective already delivers wherever anyone is
watching. Not adopted; recorded so the next reader does not spend the same afternoon.

**A heavy pin load can still collapse the fairness ladder, and that is PRE-EXISTING
behaviour rather than something pins introduce.** Pinning one person into all four Sundays of a
four-week month drives every Stage B tier infeasible and returns the fairness-free `stage_a`
(reported limit `len(slots) + 1`), with the month spreading 1–8 instead of 4–5. The threshold
is sharp: three pins solve at tier 1, four collapse.

Before treating that as a defect of this design, it was checked against the shipped solver with
**no pins at all**: `Rachel Sun.Choir >= 4`, an ordinary DSL floor expressing the same
occupancy, produces the identical collapse — limit `len(slots) + 1`, spread 0–8. So a pin
behaves exactly like the equivalent hard rule, which is the property this design wants; the
ladder's inability to hold a tier when one person occupies every Sunday is older than this
delivery and out of its scope.

**The consequence for §7 is the part that matters:** "no reported limit equals `len(slots) + 1`"
is **not** a valid pass condition for a heavy-pin fairness guard, because the shipped solver
already fails it on the equivalent rule. §7's guard is therefore **differential** — the pinned
month must match the month the equivalent DSL rule produces — which tests the property this
design actually owns instead of a bound neither version has.

Reproduced in review before the two per-role guards were named: pinning one person into
`Sun.Lead` for three weeks drove every Stage B tier infeasible, `solve_schedule:1137` returned
the fairness-free `stage_a`, and the resulting board gave one member zero services while
another took half the Sunday leads — with the pins honoured, so the handshake passed and the
client applied it. The fingerprint of that failure is a reported limit of `len(slots) + 1`
(`big`, `:1094`), which §7 asserts against.

**Not fairness slack, which looks right and is not.** Routing pins through `combined_slack`
(`:1065-1066`) is the obvious move and it fails: giving most people slack empties the
`strict` group, and `solve_schedule:1072-1074` then resets `strict` to everyone and sets
`relaxed = {}` — discarding every pin's slack, **every absence's slack, and every authored
`fairness_slack N` rule**. A reviewer reproduced exactly that on a 12-person month (34, 30
and 26 pins all collapse `strict` to zero), including the Stage-A fairness-free fallback
this paragraph exists to prevent, and it regresses shipped absence behaviour on every pinned
run. §7 carries a guard that reaches that branch.

**The `strict` collapse branch must exclude pinned-only people too.** `:1072-1074` rebuilds
`strict` from `all_people` when it falls below two — and `all_people` now contains the
pinned-only names this section removed from the fairness groups. A literal implementation
would let a person the solver has no power over set `gmin`, on exactly the thin-roster months
where the fallback fires. The rebuild is therefore over `all_people` minus the pinned-only
set, and §7 asserts it on a month that reaches the branch.

### 5.2 How a pin beats a rule: the rules go soft, nobody enumerates

E3 says the pin wins. **Three drafts tried to deliver that by predicting which rules a pin
would break, and all three were wrong** — review killed each one by executing it against the
real solver. The list was keyed first on row saturation, then on a four-case account of how a
person can be blocked; each time a reviewer found another mechanism the list did not contain.
The last two, both reproduced:

- **A DSL `<=` cap whose budget the pins consume.** `Hugo Sun.BGV <= {weeks-2}` (the cap
  shape the seed already uses for Gaby, `solverConfigDefaults.ts:70`) plus
  `any_of(Hugo, Jakey) on Sun.BGV each_week` and Jakey unavailable weeks 3–4. Pin Hugo into
  `Sun.BGV` for weeks 1 and 2 — an admin saying "Hugo sings BGV the first two Sundays" — and
  the bound is spent, so he cannot cover the weeks Jakey is out. `max(rule.value, pinned_count)`
  leaves the bound at 2 and changes nothing.
- **A pair-exclusion rule with a pinned counterpart.** `A !with P on *.Choir` with P pinned
  and B week-excluded kills `any_of(A, B)`. A pair rule is a model constraint (`:711-722`),
  so no predicate over *candidacy* can see it.

**So the mechanism stops predicting.** When the request carries pins, every constraint a pin
could contradict becomes **soft**: it keeps a boolean that is 1 only when the constraint is
being broken, and the solver minimises how many it breaks, strictly above every other
objective. The pin wins by construction. There is no list to complete, and a rule form nobody
has thought of yet is covered the moment it is built this way.

**Each boolean is scoped to the constraint INSTANCE, not to the rule.** The booleans are
created inside the same loops that build the constraints, so a rule that produces one
constraint per week produces one boolean per week. Nothing else would be safe: relaxing an
authored rule for the whole month would break it in services the admin never pinned.

| Constraint | Where | One `v` per | Soft form under pins |
|---|---|---|---|
| At least one Lead per service | `:655-660` | week × service | `sum(filled) >= 1 - v` |
| Dedicated Saturday lead anchor | `:705-709` | week | `sum(dedicated_terms) >= 1 - v` |
| Weekly presence, `any_of(…) each_week` | `:732-742` | rule × week | `sum(terms) >= 1 - v` |
| Pair exclusion | `:711-722` | rule × week × service | `sum(lt) + sum(rt) <= 1 + v·n` |
| Consecutive | `:744-752` | rule × week pair | `sum(w1) + sum(w2) <= 1 + v·n` |
| DSL count rules, all three operators | `:886-897` | **rule** — see below | `expr >= value - v·B` and/or `expr <= value + v·B`, one `v` per rule so an `==` reports as one relaxed rule rather than two halves |

**Each entry must identify its instance, not just its rule.** A pair rule produces one boolean
per week **per service**, so `W3: A !with B on *.Lead` alone is ambiguous between the Sunday
and the Saturday of that week — two different waivers collapsing into one line the admin
cannot act on. The entry carries the service too, in §4's grammar and only there, and §7 asserts that two
relaxed instances of one rule produce two distinct entries.

**Why the count rules are the exception, and it is not an inconsistency.** A DSL count rule is
built over `role_vars`, which are **month totals** (`:822`), so the rule has exactly one
instance. There is no week to narrow it to. Every other family is per-week by construction,
and each gets the narrowest scope that exists.

**This is the difference between a waiver and a repeal, and the spec previously got it
wrong.** An earlier draft said "relaxing a rule switches it off for the month" and defended it
with a measurement taken on a **count** rule — the only family the objective pulls back on its
own, because `role_spread_vars` puts per-role counts in the objective (`:812-843`, `:956`).
Nothing in the objective mentions pairings or group presence, so a month-wide boolean on those
leaves the solver free to break them anywhere. Reproduced: `any_of(Hugo, Jakey) on Sun.BGV
each_week` with Jakey out in week 3 and a pin occupying Hugo that week — under month-wide
scope the rule also fails in weeks the admin never touched; under instance scope the gap is in
week 3 alone, on four seeds. And it would have been **invisible**: `blockingReasons` evaluates
restrictions and pair conflicts only and never presence (`ruleEnforcement.ts:217`, `:346-412`),
so the grid renders nothing for a broken presence rule.

So a `pin_violations` entry for a per-week family **carries its week** — `W3: any_of(Hugo,
Jakey) on Sun.BGV each_week` — which is also what lets the client spec's §4 say «en la semana 3» instead of
implying the whole month. A count rule's entry carries no week, correctly, because it has
none.

**Four things are derived from the week-exclusion rules; three are scoped for pins and one is
deliberately not.** `compute_absence_slack` (`:538-541`) still grants a pinned-but-unavailable
person a service of absence slack for a service they are now serving, so their fairness slack
becomes pin-slack + 1. Left alone on purpose — slack only ever loosens a bound, so the effect
is invisible — but named here because it is the fourth site and a reader who finds it will
otherwise assume it was missed.

**`excluded_pwr` is scoped for a pin too, and missing it would make E3's headline case lie.**
Weekly presence filters its terms through `excluded_pwr` (`:728-731`, `:739`), which is derived
from the week-exclusion rules **unconditionally**. So pinning an unavailable member who is also
in an `any_of(…) each_week` group drops them from the presence terms even though their pin
satisfies the rule — the constraint then relaxes and the client spec's §4 shows «Se dejó de aplicar una regla…»
on the one path the feature exists for. The filter therefore reads
`(p, week, role) not in excluded_pwr or (p, role, week) in pin_set`, and §7 asserts the pinned
unavailable group member produces an **empty** `pin_violations`. The Saturday anchor's
`available_dedicated` (`:701-704`) derives from the same rules and takes the same scoping.

Two constraints stay hard, and neither can be contradicted by a pin. The **per-service
occupancy limit** (`:754-765`) is what a pin means — one seat per service — and §4 rejects
the only arrangement that could fight it. The **week exclusion** (`:679-690`) is not made
soft but scoped: it is simply not applied to the pinned (P, R, W)'s own row that week. Every
other slot that week stays excluded, so pinning someone into Sunday does not make them
available for Saturday. That is exact rather than a guess, which is why it needs no boolean.

**The objective.** Stage A minimises `(max_weighted_empty + 1) · n_viol + weighted_empty`,
so breaking one fewer rule always beats filling any number of seats. Stage A's violation
count then travels into Stage B as a ceiling (`violation_target`), so the fairness ladder can
never buy a tighter spread by breaking one more rule.

**The ceiling is a constraint, not an objective term, and that is load-bearing.** Half of
Stage B's passes run with `optimize=False`, where `create_model_and_solve` sets no objective
at all (`:899-903`) — so "the solver minimises violations above everything else" is true of
Stage A and of the optimising passes, and on the rest only the ceiling holds. `model.Add(n_viol
<= violation_target)` is therefore emitted unconditionally at model-build time, exactly where
`empty_target` already is (`:677-678`), never inside an objective branch.

**`violation_target` bounds the count, not the identity.** When more than one
minimum-cardinality set of violations exists, Stage B may spend its budget on a different
instance than Stage A did — possibly one in a week with no pin — because the optimising branch
carries no violation term. The month is equally good by every measure the model has, but the client spec's §4's
notice would then name a rule that was, in another equally-optimal solution, applicable. The
honest reading of "the fairness ladder can never buy a tighter spread by breaking one more
rule" is that it cannot break *more*; which ones it breaks is not pinned. Stated rather than
fixed: pinning identity would need a second ceiling per instance and buys nothing the admin
can act on.

**And the optimise branch gains no violation term.** The ceiling is a constraint, which is the
whole reason it works on the objective-less passes; adding a priority tier above `Sun.Lead`
instead would multiply `compute_priority_weights`' top weight — measured ~9.6e16 on a realistic
four-week month — by `overall_limit + 1` again, reaching ~5.1e18. The relevant bound is not that
weight but the objective's maximum **value**: at `n_viol > 1` a tier that size overflows int64
(9.2e18) rather than merely approaching it. The ceiling-only design avoids the question. The prose above invites that tidy-up; this
sentence forecloses it.

**Within its instance, a relaxed constraint is off rather than loosened by the minimum
amount.** For the per-week families the instance *is* the minimum scope, so there is nothing
further to narrow. For a count rule the instance is the month, and the bound genuinely stops
binding — but the ordinary objective still holds the result there, because per-role counts are
in it: measured, `Gaby Sun.BGV <= 1` with Gaby pinned into `Sun.BGV` twice relaxes the cap and
gives her exactly her two pinned weeks, not more, on four seeds. That is the objective's doing
and the spec claims no guarantee.

**So §7 does NOT assert that number.** The near neighbour shows why: `Gaby Sun.BGV <=
{weeks-2}`, the shape the shipped seed actually uses (`solverConfigDefaults.ts:70`), with three
pins gave Gaby **four** `Sun.BGV` — one more than her pins — on a solve that returned
`FEASIBLE` rather than `OPTIMAL`. Production runs a 5 s cap on ~0.33 vCPU, where optimality is
less likely still, so an assertion on a value the model does not bound would drift on any
ortools bump. §7 asserts only what the model guarantees: the pins are honoured and the rule
appears in `pin_violations`.

**With no pins, none of this is built.** `soft = bool(pin_set)`; every constraint above is
emitted exactly as it is today and no boolean exists. That is what keeps §9's byte-identity
property true, and it was verified on three seeds.

**Yes, the mandatory lead is in the table.** It is the one constraint the solver is otherwise
built never to relax, and this is E3 applied honestly: if the admin has pinned every
lead-pool member into other roles of that service, the service genuinely has no lead. The
seat is left empty and reported through `unfilled_seats` like any other shortfall, which is
the signal the planner already renders — instead of failing the whole month over a roster
the admin built on purpose.

**What this buys the notice and §6.** The solver returns `pin_violations`, the rules it actually
relaxed, each as the rule's own `source` string. So the conflict notice stops being a client
guess about what *might* clash and becomes a report of what *did* — and §6's claim that a
pin cannot make the model infeasible stops being an argument about a predicate's completeness
and becomes a property of the model's shape.

**Executed, not reasoned.** All three reproductions above, the round-5 one-pin case, the
byte-identity check on three seeds, a 52-pin full-board round-trip (`pinned_honored` 52/52,
roster identical, `pin_violations` empty), a one-service clear that moved only that service's
rows, the skewed pin load, and the pinned-only person were each run against a patched copy of
`owt_solver_v2.py` before this section was written. Under the previous draft's rules-stay-hard
behaviour, each reproduction returns the mandatory-lead diagnostic, which is the wrong cause;
under this one, each solves and names the rule it relaxed.

### 5.3 The response

`build_schedule_view` needs no change — pinned people are in `assignments` because they have
variables. `total_counts` / `role_counts` likewise include them.

**A pinned cell keeps its waivers, and this is a data-loss bug the switch creates.**
`applySolveResponse` rebuilds each cell as `{columnId, rowId, occupants, origin}`
(`plannerModel.ts:929-936`), dropping `overrides` and `overrideReasons` — the record of which
rule the admin waived for which member, whose own doc-comment says it lives on the cell
precisely because the cell "survives a re-render, a step round-trip **and a re-solve**"
(`plannerModel.ts:95-121`).

Today that drop is correct by accident. The solver enforces pair rules, week exclusions and
`!on` exclusions **hard**, so it can never hand back the rule-violating seat the admin waived:
the person does not come back, and pruning a waiver for someone who is not there is right.

**§5.2 inverts exactly that.** Those rules go soft and the pin grants candidacy, so the waived
seat *is* returned — into a cell rebuilt without its waiver. `ruleViolationsForColumn` then
takes the `waived === undefined` path (`ruleEnforcement.ts:535-536`) and reports
`{ overridden: false }`: a fresh red violation where the admin had already decided, on a seat
they did not touch. It cascades — the sanctioned seat is no longer removed from `sanctionFree`
(`:542`), so the **partner** of a waived pair flags too. Reachable from both override paths on
a weekend voice cell in create mode («Asignar de todos modos», `PlannerGrid.tsx:3046-3057`;
`moveGate.ts:342` → `applyMove(…, addOverride)`).

So the rule is: **a cell that contains any pinned occupant keeps its `origin`, its `overrides`
and its `overrideReasons`** — the waivers pruned to the occupants that actually came back,
exactly as `withUpdatedCell` already prunes them (`PlannerGrid.tsx:452-465`; reuse that logic
rather than restating it). This is E1 read honestly: «preserves EVERYTHING already on the
board» includes the decisions the admin recorded about the board, not only the names on it.

**The clears must drop them.** The same field cuts the other way in the client spec's §5: a cleared cell keeps
no occupants, so a surviving waiver would silently pre-sanction whoever lands there next —
the precise failure `overrideReasons` was added to prevent. Clearing a cell clears its
`overrides` and `overrideReasons` with it.

**`origin` must not be restamped.** `applySolveResponse` writes `origin: "auto"` on every
cell it touches (`plannerModel.ts:930-935`). `origin` is per **cell**, so a cell holding one
pinned person and one solver pick is a real and common case, and there is no origin that
describes it. The rule is therefore: a cell that contains **any** pinned occupant keeps the
`origin` it had. This is what keeps the client spec's hand-placed count honest. It does not
affect the instrument filler, whose ownership test is scoped to `instrumento:` rows
(`instrumentFill.ts:87`) which `applySolveResponse` never writes — a claim an earlier draft
of this spec got wrong in the other direction.

**`known` is built after the union.** `known = set(all_people)` (`:466`) feeds both
`parse_dsl_rules` call sites (`:467`, `:1059`), so building it after the union is what lets a
DSL clause name a pinned-only person without a 422 — and, more importantly, keeps the two
sites from ending up with different sets.

**Pins are derived through `isSolvable(row, column)`**, the same test `applySolveResponse`
uses to decide which cells it rewrites (`plannerModel.ts:919`). The set of cells that gets
pinned and the set that gets overwritten are then the same set by construction, rather than
two role maps that can drift apart.

**Occupant order is not preserved.** `build_schedule_view` sorts each role's names (`:1168`)
and `applySolveResponse` rebuilds `occupants` from that list, so a pinned cell's occupants
come back alphabetised. The cell is therefore not byte-identical across a run even when its
membership is unchanged. That is acceptable — nothing downstream reads occupant order — but
it is why §7 asserts the occupant **set** and the `origin`, never the array.

**`unfilled_seats` renumbering.** Rows that grew have more slots, so `slot_index` shifts.
The client maps an unfilled entry by role and week, never by index (`:958-986`), so the
shift is invisible — but the count per row changes, and the tests pin that.


## 6. Error handling

- **The pin path needs its own refusal — there is nothing to reuse.** An earlier draft said
  `buildSolveRequest` "already refuses a request naming an unresolvable person"; it does not.
  It *injects* unresolvable DSL names into `support` (`plannerModel.ts:747-768`) and refuses
  only a member with no Tipo, while `memberIdToName` falls back to the raw `_id` (`:569`). A
  pin whose occupant id resolves to no member would therefore travel as an `_id`-shaped name
  the solver has never heard of. The pin path refuses, naming the cell.
- A pin naming a week outside the month is a client bug, and the solver refuses it the way
  it already refuses an out-of-range week exclusion (`:679-683`): a `ValueError` naming the
  week, surfaced through the solver's ordinary error path.
- Stage A can still be infeasible for reasons unrelated to pins (no available lead in a
  month nobody pinned). The diagnostic is unchanged, and under §5.2 that is a **property of
  the model's shape rather than a claim about a predicate**: every constraint a pin could
  contradict carries a violation boolean, so a pinned model is feasible whenever the un-pinned
  one is — the solver can always pay the rules and seat the pins. Rows grow rather than
  overflow, candidacy is granted only where the pin points, and each person's hard spreads
  carry slack equal to their pin count so fairness cannot fail either.
  **This is the third answer to this question and the first one that is not an argument.**
  The two before it asserted completeness for an enumerated exemption list; review broke the
  first with one pin and the second with two, and in both cases the admin was shown the
  mandatory-lead diagnostic — naming the wrong cause and never mentioning the pin that caused
  it. That misdirection is the reason this bullet is not simply "add the pins to
  `diagnose_infeasibility`": a diagnostic for a failure that no longer happens is dead code,
  and the failure not happening is what the admin actually needs.
- **Once ANY pin exists, the mandatory-lead constraint is soft for the whole month**, not only
  where the pins are — `soft = bool(pin_set)` is model-wide. So a lead shortfall in week 4,
  caused by nothing but absences, no longer raises: it comes back as
  the `builtin:mandatory_lead` marker §4 specifies and a «Sin cubrir» seat — strictly better than today's
  failure. **And nothing is lost, because `diagnose_infeasibility`'s actionable half never
  reached the admin in the first place.** An earlier draft implied it did. It does not: the
  route answers `422` (`app/api/admin/solve/route.ts:138`) and `handleAuto` parses the body
  only when `res.ok` (`MonthGenerator.tsx:3058-3065`), so `response` is `null` and the admin
  already sees the generic «El solver no encontró solución.» The diagnostic is dead text in
  the app today. the client spec's copy for the marker carries the remedy, which is the first time that
  advice reaches anyone.
- **A `Sat.*` pin on a week with no Saturday service** is refused with a `ValueError` naming the
  week. Unreachable from this client (`weekendWeekIndexes` and `weekForColumn` use the same
  adjacency test, `plannerModel.ts:488-494`, `:845-858`), but the two obvious readings of
  `max(default_seats, pins_for(R, W))` fail in two different bad ways — one emits
  `model.Add(0 == 1)` and kills the month with a generic diagnostic, the other invents a
  Saturday and `build_schedule_view` raises a `KeyError` at `:1147-1148`. Cheaper to reject.
- **Two pins for one person in one service** are refused by the solver with a `ValueError`
  naming the person and the service, not left to produce two `== 1` constraints against the
  `<= 1` occupancy limit. **What that buys is a fast, cheap failure, not a better message** —
  the bullet above establishes that no solver error text reaches the admin today, so this
  `ValueError` lands as the same «El solver no encontró solución.» Worth having anyway; the
  benefit is stated honestly rather than as an admin-facing improvement. The client already
  prevents the arrangement (the client spec's request builder) and the picker prevents it upstream; this is the cheap
  backstop that turns a month-wide failure into a message.
- **A timed-out pinned month looks like a fairness-free month, not like an error.**
  `solver_total_budget_seconds` is 40 on a ~0.33-vCPU container, and Stage B's exhaustion path
  returns the fairness-free `stage_a` silently (`:1124-1125`, `:1137`). The violation booleans
  and the extra objective tier move that budget, and CI runs on a faster machine than
  production, so §7's `len(slots) + 1` fingerprint can pass in CI and fire in the field. The
  admin sees a legal, pin-honouring month with a wide spread and the existing degraded-fairness
  notice — which is the right outcome, and is stated here so it is not read as a new bug.
- The client-mutation invariant is unchanged: the Auto fetch keeps its try/catch/finally, its
  `res.ok` check and its loading-flag reset.
- A clear never fails: it is local state.


## 7. Testing, the gate, and the rollout

**Solver (`gcf/test_owt_solver_v2.py`).** These are the claims §5 makes, each as an
executable test, because the rejected design's failures were all claims that read correctly
and behaved otherwise:

- A pinned person appears in the roster for their week and role, and `pinned_honored` equals
  the pin count.
- A pin on an **unavailable** person succeeds, while the same request without the pin
  excludes them — E3's guaranteed collision, end to end. In the same month, that person is
  NOT auto-seated on the other service of that weekend.
- A pinned person who is in **no pool** is seated at their pin and appears nowhere else in
  the month. Run with and without the pin and diff the rosters.
- **Fairness does not collapse, on cases that DISCRIMINATE.** Two guards, because a guard
  that passes under a broken design proves nothing, and the first version of this section
  shipped exactly such a guard:
  - *Skewed partial pin.* One person pinned into `Sun.Lead` for three weeks and nothing else
    — the reproduced collapse. **Assert the realized distribution, never the flag**: the pinned
    person's total lands within the un-pinned baseline's spread rather than above it, and their
    `Sun.Lead` count equals their pin count. The three `*_fairness_relaxed` fields are not a
    pass condition (§4 says why their meaning shifts under pins), and neither is the
    `len(slots) + 1` fingerprint — the shipped solver already reports it for an equivalent hard
    rule with no pins.
    Repeat for `Sun.BGV`. A version of the mechanism that gives slack only on the global
    spread fails this and passes a whole-month guard.
    **Assert the distribution too, not only that nothing was relaxed:** the pinned person's
    total must land within the un-pinned baseline's spread rather than above it, and their
    `Sun.Lead` count must equal their pin count. Measured on the fixture, the rejected
    subtraction form gives 7 total and 4 of 8 Sunday leads where the baseline is 4–5 and 2 —
    it passes a relaxation-only guard and fails this one, which is the whole point.
  - *A pin behaves like the equivalent hard rule — the DIFFERENTIAL guard.* Pin one person
    into every Sunday of a four-week month, and separately solve the same month with
    `<person> Sun.Choir >= 4` and no pins at all. **Assert the two months match.** Both collapse
    the fairness ladder to `stage_a`, and that is the point: the ladder's behaviour when one
    person occupies every Sunday predates this delivery, so the property worth testing is
    equivalence, not balance. A guard written as "the pinned month keeps its fairness tier"
    fails on correct behaviour; this one fails only if pins and rules diverge.
  - *The share guarantee has a limit, and the test states it.* Two runs on the same month: the
    pinned person inside the fairness groups (the objective pulls them back toward their share)
    and the same person `fairness_exempt` (nothing pulls). Assert the second takes **more** than
    the first and that this is expected — it is what stops a later reader "fixing" the exempt
    case into a bound the model does not carry.
  - *Heavy pin load.* Twenty-six or more pins on a twelve-person month, the threshold at which
    routing pins through `combined_slack` would empty the `strict` group
    (`solve_schedule:1072-1074`) — note this is the **rejected** design's failure, not the
    per-person slack on the hard guards, which never touches `combined_slack`: assert
    `fairness_relaxed: false`, a global spread over the solver's own choices matching the
    un-pinned baseline, and that an unavailable member's absence slack still applies.
- **No rule fails the month, and the cases are keyed on the BLOCKING MECHANISM, not on a
  list of requirements.** Two test-design points, each earned by a round that passed over a
  real defect:
  - A pin set drawn from the solver's own output satisfies every rule by construction, so it
    passes over any broken relaxation. Every case starts from a solved month and **moves one
    person from the role the solver chose into another role of the same service**, which is
    what an admin actually does.
  - Enumerating the *requirements* is what a previous suite did, and it passed over three
    reproductions because the gap was in the *mechanisms that block a group member*. So the
    cases below are one per mechanism, and each asserts `ok: true`, every pin honoured, and
    that `pin_violations` names **exactly** the rule that had to give.

  | Blocking mechanism | Case |
  |---|---|
  | Per-service occupancy | One of `any_of(Hugo, Jakey)` pinned into `Sun.Lead` that week, the other unavailable — the round-5 one-pin reproduction |
  | A count cap whose budget the pins spend | `Hugo Sun.BGV <= {weeks-2}` with Hugo pinned into `Sun.BGV` twice and Jakey out the other weeks — the round-6 two-pin reproduction |
  | A pair rule with a pinned counterpart | `A !with P on *.Choir`, P pinned, B week-excluded — the round-6 one-pin reproduction |
  | Week exclusion on the partner | The Saturday anchor with the only dedicated Saturday lead pinned into `Sat.BGV` |
  | Row capacity | A row pinned full (the original saturation case, kept) |
  | An unreachable `>=` / `==` bound | The named person pinned elsewhere for enough weeks; assert the rule is relaxed for the month, not narrowed |
  | Nothing left to lead with | Every lead-pool member pinned into other roles of one service; assert `ok: true`, the lead seat in `unfilled_seats`, and no exception |

- **A relaxation stays inside its own week.** The discriminating case, and the one the
  existing assertions miss: `any_of(Hugo, Jakey) on Sun.BGV each_week` with Jakey unavailable
  in week 3 and a pin occupying Hugo that week. Assert `pin_violations` is exactly
  `["W3: any_of(Hugo, Jakey) on Sun.BGV each_week"]` **and that the rule still holds in weeks
  1, 2 and 4**. A month-wide boolean passes `len(pin_violations) == 1` and fails this — which
  is why the count assertion alone is not enough. Repeat for a pair rule (same week, same
  service) and for consecutive.
- **The relaxation is minimal in count, and the objective is what keeps the amount small.**
  Assert that a month needing one rule relaxed relaxes exactly one — `len(pin_violations) == 1`
  — and that Stage B never returns more violations than Stage A found, which is the
  `violation_target` ceiling. Separately assert the measured amount case: `Gaby Sun.BGV <= 1`
  with two pins on that row gives her exactly two, not more. That last one is an observation,
  not a bound, and the test says so in its name.
- **A rules-stay-hard control.** The same three reproductions with the violation booleans
  disabled must fail — this is what proves the tests discriminate. Without it, a suite that
  tests only the passing path cannot tell a working relaxation from a vacuous one, which is
  precisely how the previous suite passed over all three.
- **A pinned person in no pool does not crash, and gains nothing.** The reproduced `KeyError`
  at `:982`, kept as a guard: they are seated at their pin, appear nowhere else in the month,
  and their `total_counts` equals their pin count exactly. That last assertion is what catches
  the union being placed before `pools` is built, which granted one pinned person three extra
  services in review.
- A pinned dedicated Saturday lead satisfies the anchor with no second dedicated lead forced
  in; a pinned group member satisfies weekly presence; a pinned assignment counts toward a
  DSL cap and the solver adds no more than the cap allows.
- Over-pinning a row is accepted: the row grows, nothing is dropped, no infeasibility.
- **Inertness for a request with no `pinned` key — two guards, because this solver does not
  have reproducible output and a golden alone would be a flaky lie.**

  *The trap, measured.* `solver.parameters.max_time_in_seconds` (`:963-966`) is **wall clock**,
  so a fixed seed fixes the search *order*, not where it stops. Run the repo's own
  `make_config` fixture at falling budgets: seeds 1 and 42 are stable from 3 s to 10 s, seed
  2024 changes at 3 s, and **seed 7 returns a different schedule at every budget below 8 s**.
  A golden captured on a developer's machine would fail or flake on `ubuntu-latest`, and the
  obvious escape under that pressure is the tautology `assert solve(cfg) == solve(cfg)`, which
  passes against the new solver and proves nothing. So:

  1. **A structural fingerprint, and this is the primary guard.** A SHA-256 over the ordered
     `x` keys — every `(person, slot.key)` in insertion order — plus the per-slot candidate
     lists and the `rand_w` draw sequence. All of it is built before any solve and depends only
     on `config.seed` (`:571`, `:633`, `:946`), so it is machine-independent by construction:
     measured identical at a 10 s and a 3 s budget on all four seeds, **including seed 7**,
     while distinct between seeds. It also catches §9's actual named hazard — `build_slots`
     losing its interleaved `Sun.BGV`/`Sun.Choir` emission — **directly** rather than through
     the board it happens to perturb. Frozen literal, committed with the CI step, three seeds.
  2. **An output golden, on fixtures whose time limit provably never binds.** The precondition
     is checkable and it discriminates: instrument `CpSolver.Solve` and assert the **returning**
     solve reports `OPTIMAL`. Measured on the repo fixture — seeds 1, 42 and 2024 return
     `OPTIMAL`; seed 7 returns `FEASIBLE`, and seed 7 is exactly the budget-dependent one. A
     fixture that returns `FEASIBLE` is disqualified as a golden, and the test says so with an
     assertion rather than a comment. (The `INFEASIBLE` statuses in between are the fairness
     ladder probing tiers — normal, and not the returning solve.)

**Gates, and one of them does not exist yet.** `npx tsc --noEmit`, `npm test`, `npx eslint .`
with 0 errors — and **`pytest gcf/`, which no CI job runs today.**

That is a blocker for this delivery rather than a nicety. `.github/workflows/ci.yml:36-52`
runs types, vitest and eslint and nothing else; `package.json` has no python script; and
`cloudbuild.yaml` (repo root, not `gcf/`) is a single `gcloud functions deploy` step with no
test before it. So
`gcf/test_owt_solver_v2.py` runs only when a human remembers, and the `gates` check that
CLAUDE.md makes the merge condition for `main` proves **nothing whatsoever** about a
`gcf/**`-only PR. A code review of the diff cannot execute it either.

Everything §9 leans on lives in that unrun file: the byte-identity assertion, the
fairness-collapse guards, the rules-stay-hard control, the pinned-only `KeyError` guard. §9
says the solver ships to production first, without preview, and that "what makes it safe is
the guard §7 requires" — and the rollback story is the same property. An unenforced guard is
an intention, and CLAUDE.md draws that exact line: *"that property is what makes it a control
rather than an intention."*

**So this delivery adds the gate, in the same change and before the solver merges.** A step in the existing `gates` job — `setup-python` pinned to **3.12**, matching the function's
`--runtime=python312` (`cloudbuild.yaml`), then `pip install -r gcf/requirements.txt pytest`
and `pytest gcf/` — rather than a second workflow, so one required check still means
"everything passed" and a `gcf/**`-only PR cannot go green on a job that never looked at it.
Budget: the existing solver suite runs ~17 s and the new pin cases add to it, against the
job's `timeout-minutes: 15`, with pip cached the way `npm ci` already is. If it ever crowds
the job the answer is to split the workflow, never to drop the step.

**Pin the import path rather than relying on pytest's defaults.** `gcf/test_owt_solver_v2.py`
imports `owt_solver_v2` bare, which resolves today only because `gcf/` has no `__init__.py` and
pytest prepends the test file's directory to `sys.path`. That is import-mode behaviour, not a
guarantee; the CI step sets it explicitly (`pythonpath = gcf` in the config, or an equivalent
`rootdir`) so a future pytest default cannot break the gate that everything else rests on. The
byte-identity and inertness assertions are the ones that must be inside it; §9's rollout
order starts *after* it is green on `main`.

## 8. Documentation in the same delivery

`docs/SOLVER_AND_INFRA.md` — the `pinned` field, the fixed-variable mechanism, the enabling
changes, the soft-relaxation objective, `pin_violations`, and the `pinned_honored` contract.
`docs/CI.md` — the new python step in `gates`, what it runs and why a `gcf/**`-only PR needs it.

One ADR: **pins are fixed variables with scoped candidacy, per-person pin slack on the hard
spreads, and every contradictable rule made soft under a violation-minimising objective** —
recording the rejected remove-the-seat design and the reproduced fairness collapse that ended
it; the rejected fairness-slack answer routed through `combined_slack` and the `strict`-collapse
branch that killed it; the rejected pin-count **subtraction** on the hard spreads with the
measured numbers that killed it (a member pinned three times took 7 services against a 4–5
baseline, and 4 of 8 Sunday leads); and **the two rejected enumerations of exemptions** — keyed
on row saturation, then on a four-case satisfiability predicate — with the one-pin and two-pin
reproductions that killed them.

That last entry is the ADR's real payload: the enumeration is the design a reader will
re-derive, because it looks cheaper than making six constraints soft, and it failed three
times. Five rejected designs, each with the execution that disproved it. Record the bounded
compensation §5.1 measures alongside them. No new secret or env var, so `docs/SECRETS.md` is
untouched.

## 9. Rollout

**Step zero: the python gate lands first.** §7's byte-identity and inertness assertions are
what make a production-first solver merge safe, and nothing runs them today (see §7's Gates).
So the CI step ships and is green on `main` **before** the solver change is merged — otherwise
the rollout's own safety argument rests on a file no gate reads.

The solver must then be able to honor pins **before** the app can send them, or the client spec's §7 refusal is
the only thing standing between an admin and a silent overwrite. Therefore: merge the solver
change and confirm Cloud Build deployed it, then merge the app change. The
`preview`-first push order applies to the app half as usual, and the dev alias is verified by
`alias` + `githubCommitSha` before the PR to `main`.

**The byte-identity property has a hidden dependency: `build_slots` must keep emitting
`Sun.BGV` and `Sun.Choir` interleaved** (`:554-555`). Rewriting that loop per role — the
obvious tidy-up when adding the `max(default, pins)` count — changes the insertion order of
`x`, hence the seeded `rand_w` tie-break at `:946`, hence the board, for every un-pinned
month. §7's byte-identity test catches it, and it is named here so that nobody "fixes" the
loop later without understanding why it is shaped that way.

**Said out loud: one Cloud Function serves both environments.** The solver half never reaches
`preview` first, so "merge the solver first" means it is live in production before any human
has watched it work. That is inherent to the existing architecture, not introduced here, and
what makes it safe is the guard §7 requires: a request with no `pinned` key must produce
byte-identical output to today on a fixed seed. Until the app starts sending pins, the
deployed change is inert for everyone.

**Rollback is one-sided, and that is the point.** Reverting the app commit is sufficient: the
app stops sending `pinned`, `soft = bool(pin_set)` is then false, and the deployed solver
builds **the same model and runs the same search** as today.

**Say it as model identity, not output identity.** This solver has never had reproducible
output across machines — its time limit is wall clock (`:963-966`), so where the search stops
depends on the box. What the change buys is that a pinless request constructs an identical
model and an identical search order; the schedule that comes back is then as reproducible as
it ever was, which on a fixture whose limit binds is not very. §7's two guards are shaped to
prove exactly that property and no more, which is why the fingerprint is the primary one. The solver half needs no revert and must not be reverted in
a hurry — a rollback of the app alone is complete, and rolling back the Cloud Function while
a pinned app is still live would make the client spec's refusal fire on every Auto instead.

## 10. Out of scope

**Everything the admin sees and clicks** — the «Solo llenar vacíos» switch, the «Borrar» menu,
the conflict notices, the undo toast, the waiver-preservation rule in `applySolveResponse`, the
`unfilled`-marker pass, and the instrument freeze — lives in
`2026-09-15-fill-empty-only-client-design.md`. That half consumes this contract and cannot ship
before it.

**Auto and the clears on already-created draft services** remain deferred to their own delivery,
for the reasons the combined spec recorded: stored columns are keyed by the Sanity `_id` while
unfilled markers carry a `create:` prefix, and the calendar state a request is built from belongs
to create mode.
