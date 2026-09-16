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

`SolveResponse` gains **three** fields, all absent-means-nothing so an old client is unaffected:
`pinned_honored?: number` — the handshake (the client spec §7), **derived from the solved
assignment and never echoed from `len(pin_set)`**: a pin counts only if that person actually
holds a slot of that role in that week in the returned solution. An echo would satisfy E8's
letter and prove nothing. **It is emitted on EVERY response of the new solver, `0` when there
are no pins** — never conditionally. §9's only deploy check asserts its *presence* on a pinless
smoke request and makes absence the revert trigger, so conditional emission would fail every
healthy deploy and instruct reverting it. "Absent means nothing" describes an **old** solver,
not a pinless request. **Even derived it is weaker than the name suggests:** a pin is a hard
`== 1`, so any solution the solver returns at all satisfies every pin and the derived count can
never come back short. Its real signal is the field's **presence**, which is how the client
detects a solver predating this change that ignored `pinned` (E8); the per-pin roster check the
client also runs is what catches a solver honouring *a* pin count rather than *these* pins.

**`pin_violations?: string[]`** — the rules the solver had to relax to honour the pins. The
client spec's §4 renders them; §5.2 explains why they exist and how an entry is derived.

**`violation_ceiling_proven?: boolean`** — `true` **iff all three hold**: Stage A returned
`OPTIMAL`, the violation-only solve returned `OPTIMAL`, **and the returned month came from Stage
B rather than the `stage_a` fall-through**. `false` otherwise.

The third condition is not redundant and an earlier draft omitted it. The ladder can exhaust or
run out of the 40 s budget and return `stage_a` itself (`:1124-1125`, `:1137`) — which was built
before `violation_target` existed and carries no `n_viol <= violation_target` constraint — so its
assignment-derived `pin_violations` can exceed the proven minimum even when both solves proved
theirs. Reporting `true` there would suppress the client's caveat and tell the admin the
relaxation set is known minimal when it is not, which is precisely the false assurance this field
exists to prevent. §6 notes the fall-through is a field-mostly case because CI runs on faster
hardware, so the suite must force it deliberately (§7). Gating on the third solve alone is
not enough, and the reason is exact: it minimises `n_viol` **subject to `weighted_empty <=
empty_target`**, and `empty_target` comes from Stage A. If Stage A stopped at `FEASIBLE`, its
`empty_target` can exclude the true optimum — Stage A returns `n_viol=1, weighted_empty=0` while
`n_viol=0, weighted_empty=5` was available — and the third solve then proves a minimum *inside a
box that was itself suboptimal*, reporting `OPTIMAL` for a ceiling of 1 when zero rules needed
relaxing. The client would suppress its caveat and the admin would be told a relaxation was
forced that was not.

Dropping `weighted_empty <= empty_target` from the third solve is **not** the fix: a lower
`violation_target` unreachable at that fill level makes every Stage B tier infeasible and drops
the month onto the fairness-free `stage_a`, which is worse than the defect.
Absent means the solver predates this field, which an old client already treats as "no pin
support at all". **The client shows the ordinary `pin_violations` notices either way and adds
one line when it is `false`**: the relaxations listed may be more than the pins strictly forced.
It never blocks and never discards the month.

This field exists because the minimal ceiling is the **sole** containment for making six rule
families soft month-wide on the strength of one pin — the decision the ADR-0010 box below says
Frank has not ruled on. Without the field, a slack ceiling is invisible and §5.2's
assignment-side reporting would quietly do double duty as a correctness claim. And it must ship
**now**: the Cloud Function is the one artifact with no `preview` rehearsal and an irreversible
release (§9), so adding it later costs a second production-first solver release plus a second
client release.

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

**The service token is `Sun` / `Sat`, not `Sunday` / `Saturday`** — because it must match the
`pinned.role` field this same contract defines (`Sun.Lead`, `Sat.BGV`), which is the identifier a
reader of a `pin_violations` entry will compare it against. **The response is not uniform and
this spec does not make it so:** `unfilled_seats` already emits `Sunday` / `Saturday`
(`owt_solver_v2.py:987-990`), so both vocabularies cross the boundary today. An earlier draft
justified the choice by claiming uniformity, which was simply false; the real reason is
role-field agreement, and changing `unfilled_seats` is out of scope. The solver's internal
`SUNDAY_SERVICE` / `SATURDAY_SERVICE` constants are `"Sunday"` / `"Saturday"`
(`owt_solver_v2.py:66-67`) and must be **mapped**, not interpolated.

**`<person>` comes from the parsed rule object, never from `source`, because `source` drops it.**
`restrictionToDs` emits one line per member with the name prefixed **once**
(`plannerModel.ts:572-585`) and `parse_dsl_rules` splits on `&` storing `source=clause`
(`:312`, `:409`), so every clause after the first is subject-elided. Executed against the
shipped parser:

```
'Gaby !in Sat.* & !in Sun.Choir & Sun.BGV <= 2 & fairness_slack 1'
    -> DslCountRule(person='Gaby', source='Sun.BGV <= 2')     # name GONE
'Hugo Sun.BGV <= 2'
    -> DslCountRule(person='Hugo', source='Hugo Sun.BGV <= 2')
'Gaby !in Sat.* & !consecutive on *.Lead'
    -> DslConsecutiveRule(person='Gaby', source='!consecutive on *.Lead')  # name GONE
```

The shipped Gaby seed is the first shape — `restrictionToDs` emits `excludedPatterns`, then **`weekExclusions`**, then caps, then fairness (`plannerModel.ts:572-585`), so the production line is exactly the one
quoted above, and §7's literal must be authored in that order, so without the explicit person the production notice would
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

**Identity, and pools.** Pins name people by resolved `member_name`, as the rest of the request
does. **Two members sharing a `member_name` would silently swap a pinned occupant for their
namesake** — `applySolveResponse` maps returned names back to ids through `nameToId`
(`plannerModel.ts:924-928`) and nothing solver-side can see the collision. Pre-existing for the
solver's own picks and unchanged here, but its consequence is new: a hand-placed seat the admin
asked to preserve would come back as a different person. Fixing it needs a stable identifier in
the request contract and is deliberately out of this scope; named because this delivery is what
makes it matter. A pinned person **is not added to any pool**. `all_people` is derived from the
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
| `cur_sun_lead_spread <= sun_lead_limit` (`:865`) | `:861-863` | same, with their **Sunday-service** pin count |
| `cur_sun_bgv_spread <= sun_bgv_limit` (`:882`) | `:878-880` | same, with their **Sunday-service** pin count |

**The per-role slack is keyed on the SERVICE a pin occupies, not on the role it names — and
keying it on the role is what an earlier draft got wrong.** The per-service occupancy limit
(`:754-765`) gives each person one seat per service per week, so a pin in *any* Sunday role
zeroes them in *every other* Sunday role that week. Counting only `Sun.Lead` pins toward the
`Sun.Lead` spread therefore gives a lead-pool member pinned into Choir **zero** slack on the very
spread their pins tighten.

Measured on the fixture below, four pins in a Sunday row, every week:

| Pinned person | Role-keyed slack (rejected) | Service-keyed slack |
|---|---|---|
| A Sunday-lead-pool member (Hugo, Rachel), **three-seat row** (`Sun.BGV`, `Sun.Choir`) | **collapse on all four seeds** — fairness-free `stage_a`, a member on zero services | `ok`, everyone 4–5 |
| The same member in the **two-seat** `Sun.Lead` row | `ok` — measured **not** to discriminate | `ok`, everyone 4–5 |
| A support member (Vale, Gaby) | `ok` | `ok` |

So the discriminator was never the row's seat count — it was **whether the pinned person is in
the Sunday-lead pool**, and the role-keyed form is the bug. Byte-identity on three seeds, the
52-pin round-trip, the relaxation reproductions and the pinned-only guard were all re-run on the
service-keyed form and are unchanged.

**Cross-role displacement is WHY the slack is service-keyed, and an earlier draft ruled it
benign.** A pin in role R forces the person to zero in every *other* role of that service
(`:754-765`). That draft kept the per-role slack keyed on R and called the effect "notice quality
rather than collapse — tier 2 absorbed it in every case built". Executed, it was neither: for a
Sunday-lead-pool member it collapsed the ladder to the fairness-free `stage_a` on every seed,
leaving a member on zero services. §5.1's table now keys the slack on the **service**, which
removes it. What remains is genuinely notice quality — a pin can still move a flag for a reason
unrelated to loosening — and §4's decision to leave the flags alone contains that.

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

**What the slack DOES deliver, measured across pin loads.**

> **The fixture, stated so the numbers are reproducible** — an earlier draft gave the table with
> none, and a reviewer running the repo's `make_config` (Saturdays on weeks 2 and 4, `BASE_RULES`)
> could not reproduce it even though its baseline spread coincidentally matches. Every row below
> is: `sunday_leads=[Hugo, Niza, Lucia, Rachel]`, `saturday_leads=[Tono]`,
> `support=[Jakey, Gaby, Liu, Marianne, Vale, Dani, Pau]`, `weeks=4`,
> `weekends_with_saturday=[1,2,3,4]`, **`dsl_restrictions=[]`**, `solver_max_time_seconds=5`,
> seeds 1 / 7 / 42 / 2024 — 52 slots, baseline totals
> `[4,4,4,4,4,4,4,4,5,5,5,5]`, limits `(1,1,1)`. The rows below held identically on all four
> seeds.

| Pinned row | 1 pin | 2 pins | 3 pins | 4 pins (every week) |
|---|---|---|---|---|
| `Sun.Lead` | others 4–5 | others 4–5 | others 4–5 | others 4–5 |
| `Sun.BGV` | others 4–5 | others 4–5 | others 4–5 | others 4–5 |
| `Sun.Choir` | others 4–5 | others 4–5 | others 4–5 | others 4–5 |

**With the service-keyed slack there is no saturation threshold on this fixture** — lead-pool and
support members alike, all three rows, all four seeds. An earlier draft tabulated a collapse at
four pins on the three-seat rows and built a §7 guard on "row width"; that collapse was the
role-keyed bug above, and it fired only for lead-pool members, which is why the table and the
`Vale → Sun.Choir W1–4` row three paragraphs up contradicted each other on the same scenario.

**The invariant worth asserting is about everyone else — inside the fairness groups.** The
un-pinned members **who are in the global fairness groups** stay inside the un-pinned baseline
spread. Stated unconditionally: with the service-keyed slack there is no threshold on this
fixture to scope it by.

**An un-pinned `fairness_exempt` member is NOT protected, and the shipped seed has two.** The
model bounds `gmax - gmin` over the fairness *group*; an exempt member is outside it and carries
no bound at all, so displacement lands on them first. Measured on the fixture above with one
exempt member and a **single** pin on someone else: they went 3→2 and 4→3 on two of four seeds,
while every fairness-group member stayed 4–5. `solverConfigDefaults.ts` marks **Frank and Mkz**
exempt in production, so this is the real roster, not a constructed case. An earlier draft
promised "pinning someone does not wreck the rest of the month" without this carve-out; the
promise holds for the group and not for the exempt. §7 asserts it over the group and asserts
nothing about exempt members, and the honest summary is: **a pin can cost an exempt member a
service, and that is the same displacement an ordinary hard rule would cause.**

**Nothing is claimed about the pinned person's own total** — the paragraphs above explain why the model does not bound
it, and review measured the counterexample: on the repo's own fixture with `BASE_RULES`, a member
whose baseline is 6, pinned into `Sun.Lead` for three weeks, came back at **8** — which is why
§7 asserts nothing about it. The group invariant above is the promise a pin should keep — pinning someone does
not wreck the rest of the month — and it is what §7 asserts.

**What the rejected role-keyed form did, kept because §7 uses it as a control.** Under it, a
**Sunday-lead-pool** member pinned four times into a three-seat Sunday row drove every Stage B
tier infeasible and returned the fairness-free `stage_a` (reported limit `len(slots) + 1`),
spreading the month 1–8 with a member on zero services — on all four seeds. A support member in
the same rows was fine, which is why two earlier drafts misread the discriminator as the row's
seat count. **The service-keyed form removes it entirely**, and §7 runs the role-keyed version as
a failing control precisely so the guard cannot go green on the broken design.

**A pin is NOT equivalent to the corresponding hard DSL rule, and an earlier draft claimed it
was.** `Rachel Sun.Choir >= 4` with no pins also collapses, which is where that claim came from
— but the two differ everywhere short of collapse, and they differ *by design*: §5.1 gives a
pinned person per-person slack on all three hard spreads, and a DSL rule gets none. Measured
side by side, the reported tiers, the realized spread and the person's total all diverge on
every seed tried. **A pin buys fairness treatment an ordinary rule does not — that is what the
slack is for**, and §7 must not assert an equality the mechanism is built to break.

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
where the fallback fires. **`relaxed` needs the same exclusion** (`:1070-1071`, feeding
`global_fairness_slack` at `:791-793`): a pinned-only person carrying an absence exclusion lands
there, and `total_vars[p] >= gmin - slack` against their pin-count total would pull `gmin` down
and cap the whole group. The rebuild is therefore over `all_people` minus the pinned-only set, and §7 asserts it on a month that reaches the branch.

### 5.2 How a pin beats a rule: the rules go soft, nobody enumerates

E3 says the pin wins. **Three drafts tried to deliver that by predicting which rules a pin
would break, and all three were wrong** — review killed each one by executing it against the
real solver. The list was keyed first on row saturation, then on a four-case account of how a
person can be blocked; each time a reviewer found another mechanism the list did not contain.
The last two, both reproduced:

- **A DSL `<=` cap whose budget the pins consume.** `Hugo Sun.BGV <= {weeks-2}` (the cap
  shape the seed already uses for Gaby, `solverConfigDefaults.ts:70`) plus
  `any_of(Hugo,Jakey) on Sun.BGV each_week` and Jakey unavailable weeks 3–4. Pin Hugo into
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
| Pair exclusion | `:711-722` | rule × week × service | `sum(lt) + sum(rt) <= 1 + v·n`, **`n = len(lt) + len(rt) - 1`** |
| Consecutive | `:744-752` | rule × week pair | `sum(w1) + sum(w2) <= 1 + v·n` with **`n = len(w1) + len(w2) - 1`** — its own lists, not the pair rule's; too small a big-M here is a silent infeasibility on a pinned month, the one failure §6 promises cannot happen |
| DSL count rules, all three operators | `:886-897` | **rule** — see below | `expr >= value - v·B` and/or `expr <= value + v·B`, one `v` per rule so an `==` reports as one relaxed rule rather than two halves. **`B = max(rule.value, total_slots)`** — the slot count alone suffices for `<=` but not for `>=`, whose bound can exceed it |

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
leaves the solver free to break them anywhere. Reproduced: `any_of(Hugo,Jakey) on Sun.BGV
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
`(p, week, role) not in excluded_pwr or (p, role, week) in pin_set` — the two tuple orders are deliberate and different: `excluded_pwr` is keyed `(person, week, role_type)` (`:728-731`), `pin_set` `(person, role, week)`, and §7 asserts the pinned
unavailable group member produces an **empty** `pin_violations`. The Saturday anchor's
`available_dedicated` (`:701-704`) derives from the same rules and takes the same scoping.

**A family that is NOT in the table, and a reader will look for it.** `!in <pattern>`
exclusions and pool membership are not constraints at all — they are enforced structurally by
`is_eligible` inside `build_candidate_map` (`:221-222`), so a variable is never created. §5.1's
"the pin grants candidacy, and only where it points" therefore overrides them by construction,
with no boolean and no `pin_violations` entry. Nothing is lost on the board: `blockingReasons`
already renders `excludedPatterns` (`ruleEnforcement.ts:363-368`) and the client spec preserves
the waiver. Named here so the absence reads as a decision rather than an omission.

Two constraints stay hard, and neither can be contradicted by a pin. The **per-service
occupancy limit** (`:754-765`) is what a pin means — one seat per service — and §4 rejects
the only arrangement that could fight it. The **week exclusion** (`:679-690`) is not made
soft but scoped: it is simply not applied to the pinned (P, R, W)'s own row that week. Every
other slot that week stays excluded, so pinning someone into Sunday does not make them
available for Saturday. That is exact rather than a guess, which is why it needs no boolean.

**How a `pin_violations` entry is determined — from the ASSIGNMENT, never from the boolean.**
This is normative and it is not an implementation detail. Every formula in the table above is
one-directional: `sum(terms) >= 1 - v` and `sum(lt) + sum(rt) <= 1 + v·n`, **`n = len(lt) + len(rt) - 1`** each permit `v = 1`
on a constraint that holds. Reading the report off `solver.Value(v)` would therefore name rules
that were never broken.

So after the solve, each relaxable instance is **re-evaluated against the returned
assignment**, and an entry is emitted only for instances that actually fail. The booleans exist
to make the model feasible; they are not the report.

**The ceiling is made PROVABLY MINIMAL before it is used, by its own solve.** Stage A minimises
`(max_weighted_empty + 1) · n_viol + weighted_empty`, and if it times out its violation count is
an upper bound with slack. So between Stage A and Stage B there is a third, cheap solve:
minimise `n_viol` alone, subject to `weighted_empty <= empty_target`. It is the **full assignment model** — every `x`, `filled`, occupancy and `weighted_empty <=
empty_target` constraint is still there — with a far simpler objective: no seeded tie-break weights and no
fairness *objective*, just `sum(violations)` — **and it passes `big` for `fairness_limit`,
`sun_lead_limit` and `sun_bgv_limit`, as Stage A does**, since `create_model_and_solve` builds
the three hard spreads unconditionally from those parameters. Anything tighter silently inflates
`violation_target` or makes the solve infeasible. **The expectation is that
it proves optimality where the full objective does not, and that expectation is NOT yet
measured.** It is the one claim in this section with no number behind it, and it decides how
often the sole containment is actually proven on a 5 s / 0.33-vCPU pass. §7 measures it as a
required case before implementation is called done; if it turns out to time out routinely, the
containment is `violation_ceiling_proven: false` most of the time and that is a design signal,
not a detail. Its value becomes
`violation_target`, and its solver status is recorded.

**Why that matters more than it looks.** Without it the ceiling has slack, and **no Stage B
pass pulls `n_viol` down**: half the ladder runs `optimize=False` with no objective at all
(`:899-903`), and the optimising half carries no violation term by design. Any feasible solution
up to the ceiling is returned — including one that breaks an authored rule **in a week with no
pin**. E3 authorises *the pin* to beat a rule. It does not authorise the solver to set a rule
aside in a service the admin never touched, and the client's copy («… para respetar lo que
fijaste») would assert a cause that is false in exactly that case.

**The `stage_a` fall-through escapes the ceiling, and the field is what makes that visible.**
When the ladder exhausts or the 40 s budget runs out, `solve_schedule` returns `stage_a` itself
(`:1124-1125`, `:1137`) — and `stage_a` was built before `violation_target` existed, so it
carries no `n_viol <= violation_target` constraint. Its assignment-derived `pin_violations` can
therefore exceed the violation-only solve's minimum. Narrow, and CI is faster than production so
it is a field-mostly case, but it means "Stage B never returns more violations than the
violation-only solve found" is true of Stage B and **not** of the fall-through. A returned
`stage_a` therefore reports `violation_ceiling_proven: false` regardless of what either solve
achieved — which is §4's third condition, and the reason it has one. The field answers "is this
month's relaxation set known minimal?", not "did some solve prove optimality".

**If the violation-only solve itself times out**, `violation_target` stays Stage A's value and
the month is still returned — but the response says so, so the honest report of §5.2's
assignment-side derivation is not quietly doing double duty as a correctness claim. §7 asserts
the minimal ceiling on a fixture capped short enough that Stage A alone would leave slack.

> **RULED by Frank, 2026-09-16: keep the soft relaxation as designed.** ADR-0010 records his
> requirement in his own words, for the pair-exclusion family this design relaxes: *"it has to
> be hard because if it's soft in fairness it will always choose people like Frank, Mkz or Gaby
> who tend to have 1 or 2 participations a month."* He asked for whichever design **preserves
> the behaviour he expects**, and the two reconcile exactly — on the word ADR-0010 itself
> emphasises:
>
> **Nothing here is ever relaxed for fairness.** ADR-0010's fear is a rule traded away to
> flatten participation counts, which is what "soft in fairness" means: the rule enters an
> objective and loses to a cheaper assignment. In this design a rule can be set aside for
> **one reason only** — a pin has made it unsatisfiable — and three properties enforce that:
> the violation count is minimised **strictly above** every fairness term (§5.2's objective);
> the ceiling is **proven minimal** by its own solve before Stage B may use it, and says so
> through `violation_ceiling_proven`; and the fairness ladder **cannot buy a tighter spread by
> breaking one more rule**, because the ceiling is a constraint rather than an objective term.
> A rule the pins do not force stays as hard as it is today.
>
> The rejected alternative — a pair-rule carve-out that keeps `!with` hard — was considered and
> refused on E3: it would make the month **fail** rather than honour a pin the admin placed,
> which is the opposite of «gana el pin, no es algo que bloquea». §8's ADR records this ruling,
> cites ADR-0010, and states the reconciliation above so nobody re-derives the carve-out.

**And the ceiling bounds the model, never the report.** An earlier draft implied `n_viol <=
violation_target` makes the boolean reading safe, on the argument that Stage B's feasible set is
a subset of Stage A's, so its minimum violation count is at least Stage A's count and the ceiling
forces equality. **That argument held only while Stage A proved optimality** — which is why the
violation-only solve above now sets `violation_target` instead, and why
`violation_ceiling_proven` reports whether it succeeded. The rest of this paragraph describes
the regime that remains when it does not: a 5 s cap on a ~0.33-vCPU container, with the violation
booleans added. When Stage A returns `FEASIBLE`, `k` is an upper bound with slack, no Stage B
pass minimises `n_viol` (the optimise branch deliberately carries no violation term), and the
returning pass may spend that slack breaking constraints that did not need breaking — including
an authored rule in a week with no pin, the precise failure the instance-scoping paragraph
exists to prevent.

Evaluating against the assignment does not prevent that; it makes it **honest**. The admin sees
a notice for every rule that actually gave, and never one for a rule that held. §7 asserts both
directions on a fixture where the solve is capped short enough to leave the ceiling slack — a
guard that a fast CI machine would otherwise pass vacuously.

**Two plumbing facts the prose implied without stating.** `SolveResult` gains the Stage A
violation count **and each solve's status** (Stage A's and the violation-only solve's) —
and `solve_schedule` must additionally record **whether the returned result is the `stage_a`
fall-through**, which is §4's third input and lives in `solve_schedule` rather than in any single
solve, so `violation_target` can travel into Stage B the way `weighted_empty_used`
already carries `empty_target`; and `solve_from_dict`'s response dict (`:1222-1232`) gains
`pinned_honored`, `pin_violations` **and `violation_ceiling_proven`** — all three, since that
dict is the only place any of them can reach the client.

**The objective.** Stage A minimises `(max_weighted_empty + 1) · n_viol + weighted_empty`,
so breaking one fewer rule always beats filling any number of seats. Stage A's violation
count then travels into Stage B as a ceiling (`violation_target`), so the fairness ladder can
never buy a tighter spread by breaking one more rule.

**The ceiling is a constraint, not an objective term, and that is load-bearing.** Half of
Stage B's passes run with `optimize=False`, where `create_model_and_solve` sets no objective
at all (`:899-903`) — and the optimising half carries **no violation term either** (below). So
"the solver minimises violations above everything else" is true of **Stage A alone**; on every
Stage B pass only the ceiling holds. `model.Add(n_viol
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

**The violation count is unweighted, so a leaderless service costs the same as one relaxed
cap.** `(max_weighted_empty + 1) · n_viol` dominates, so breaking `builtin:mandatory_lead` once
beats breaking two count rules — even though the first leaves a service with no leader and the
second merely loosens two bounds. Contrived to reach (it needs a month where those are the only
two ways out), visible when it happens (the marker plus a «Sin cubrir» seat), and strictly
better than today's hard `RuntimeError`. Left unweighted, because any weighting is a judgement
about which of the admin's rules matters more and the spec has no basis for one. Stated rather
than hidden.

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

**With no pins, none of this is built — `n_viol` included, and that one is the trap.** The
natural implementation defines `n_viol = NewIntVar(...)` plus its `_eq` unconditionally, since
`violations` is simply empty when `soft` is false. That adds **a variable and a constraint to the
pinless Stage A model**, which reddens §7's byte-identity fingerprint on every seed — and §7 and
§9 both forbid re-capturing a red fingerprint inside the solver PR, so the delivery stalls until
someone diagnoses it. `n_viol` is not a boolean, so "no boolean exists" does not cover it, and
"emitted unconditionally at model-build time" is said of the *ceiling*, not of this. **`n_viol`
and its `_eq` are built only when `soft`.** This is the benign-looking cause that actually fires;
the two §9 names (`gmax + 0`, the interleave) do not — `model.Add(t <= g + 0)` was verified to
serialise byte-identically to `model.Add(t <= g)`.

`soft = bool(pin_set)`; every constraint above is
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

**A pinned cell keeps its waivers — stated here for the reason it exists, with the client spec
canonical.** The hazard is a consequence of this half's mechanism, so the reasoning belongs
below; the normative rule, the copy and the tests live in the client spec. A duplicated
normative rule across two files is the drift shape this repo keeps paying for.
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
- **A malformed `pinned` entry is refused as a `ValueError`, not left to become a 500.** A
  non-dict entry, a missing key, a non-integer `week` or a non-string `person` raises
  `TypeError`/`KeyError`, which escapes `solve_from_dict`'s `except (ValueError, RuntimeError)`
  (`:1216`) and reaches the admin as «Solver service returned HTTP 500». `pinned` is validated
  for shape before it is used, and every rejection below is a `ValueError`.
- **`pinned` longer than the cap is REJECTED with a `ValueError`, never truncated.** The other
  budget knobs clamp (`_clamp`, `:1183-1184`), and an earlier draft described this cap "the way
  the other budget knobs already are" — which would silently drop pins past the limit. Those are
  seats the admin asked to keep; dropping them surfaces as a refused Auto through the client's
  per-pin roster check, a confusing failure for a request the solver could have refused by name. `build_slots` emits `max(default, pins_for(R, W))`, so slots — and
  with them `x` — grow linearly with the array, on what §6 itself calls a public HTTP endpoint
  behind an API key. **The cap is 100**, and the reasoning an earlier draft gave for a larger one was measured false.
  That draft claimed 200 kept `compute_priority_weights` — degree-8 in `overall_limit`
  (`:585-593`) — under the int64 ceiling. It does not: on the shipped 12-person roster the top
  weight crosses 2⁶³ at about **70 slots**, and at 200 pins `total_slots` reaches ~275 for a top
  weight around 4.4e23.

  **And the real binding limit is already reached today, with no pins at all — but the trigger is
  NOT the slot count.** Measured on the shipped solver: a **five-week month with a Saturday every
  week (65 slots) returns `MODEL_INVALID` on its optimising pass**, and the ladder falls through
  to the objective-less passes without saying so — statuses `['OPTIMAL', 'MODEL_INVALID',
  'OPTIMAL']`. So does a **five-week / three-Saturday month at 55 slots**, while a **six-week /
  six-Saturday month at 78 slots does not**. It is not monotone in `total_slots`, so the ~70-slot
  figure above is where the top *weight* crosses 2⁶³ and is **not** the trigger — the binding
  check is ortools' objective-domain overflow, which depends on the whole coefficient set.
  Whoever writes the fix PR should start there, not from a slot threshold. That is a
  **pre-existing defect, not introduced here** (four- and six-week fixtures did not reproduce
  it). **Frank approved fixing it, 2026-09-16, as its own change** — and the ordering is
  load-bearing: any fix touches `compute_priority_weights`, which changes the Stage A model, which
  **changes §7's byte-identity golden**. So the overflow fix ships **first**, on its own, with the
  golden re-captured in that PR under §7's rule (its diff is `gcf/**`-only and it is not this
  delivery); this delivery then rebaselines on it. Landing them together would put a real
  behaviour change and a golden re-capture in the same PR, which is precisely what §7 forbids.
  Out of *this file's* scope — but this delivery adds a new lever on
  `total_slots` through row growth. **What the cap buys is a bounded array, and nothing more** —
  it does *not* keep a month out of the overflow regime, since 100 pins in one (role, week) take
  a four-week month from 42 to ~139 slots, well past the ~70 where the top weight crosses 2⁶³.
  Two separate problems: the overflow is reachable today with no pins, and the cap bounds what a
  caller can allocate. Recorded here so the next
  person to see an unexplained fairness result on a five-week month has the thread. The pools are unbounded today for the same reason and
  that is pre-existing; this spec does not widen it further.
- **A `pinned` entry naming an unknown `role`** is refused with a `ValueError` naming it. The
  typed client cannot produce one, but the route validates only `sunday_leads?.length`
  (`app/api/admin/solve/route.ts:129-131`) and the function is a public HTTP endpoint behind an
  API key — and an unknown role reaches the same `model.Add(0 == 1)` as the case below, by the
  same route, since `slots if s.role_type == R` is simply empty. The three rejections are one
  guard.
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
  returns the fairness-free `stage_a` silently (`:1124-1125`, `:1137`). The violation booleans,
  the extra objective tier **and the violation-only solve's own draw on the same 40 s** move
  that budget — the third solve is small, but it is a third solve, and CI runs on a faster machine than
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
  - *Skewed partial pin — assert what happens to EVERYONE ELSE.* One person pinned into
    `Sun.Lead` for three weeks and nothing else. **Assert that the un-pinned members who are in
    the global fairness groups keep their totals inside the un-pinned baseline's spread** — the
    population matters: an un-pinned `fairness_exempt` member is outside every bound, and review
    measured one losing a service to a **single** pin. Assert nothing about exempt members. Use
    §5.1's stated fixture, which the table there now names in full. That is the property §5.1's slack delivers and the
    one an admin cares about: pinning someone does not wreck the rest of the month. Measured, it
    holds at one, two and three pins on every row.

    **Assert nothing about the pinned person's own total.** §5.1 is explicit that
    `t[p] <= gmax + n[p]` permits more and that `fairness_exempt` removes the only thing holding
    them down; §5.2 refuses to assert a count-rule containment number for the same reason. A
    guard on that number contradicts both and would drift on an ortools bump.

    **Assert nothing about the three `*_fairness_relaxed` flags either**, in this guard or any
    other — §4 is normative on that, and §5.1's cross-role displacement paragraph shows pins move
    them for reasons unrelated to any loosening.
  - *Saturation is row-dependent, and the test names the row AND the fixture.* Use §5.1's
    fixture verbatim. Four pins in each Sunday row, every week, run **twice: once for a
    Sunday-lead-pool member and once for a support member.** Both must come back with the
    fairness group inside the baseline spread and no reported limit equal to `len(slots) + 1`.

    **The lead-pool half is the whole test, and the control runs only on the three-seat rows.**
    An earlier draft asserted a *collapse* keyed on the row's seat count. The real discriminator
    is **pool membership** — the support half passes even under the broken role-keyed slack, so a
    suite written from that draft would have been green on a design that put a member on zero
    services. Run the lead-pool case against the **role-keyed** slack as a control on `Sun.BGV`
    and `Sun.Choir`, where it must fail. **Do not run the control on `Sun.Lead`:** measured, the
    two-seat row does not collapse under either form, so a control there fails to fail — and the
    pressure at that moment is to weaken the control, which is the exact failure §7 exists to
    prevent.

    **Do NOT assert equivalence with the corresponding DSL rule.** `<person> Sun.Choir >= 4`
    collapses on this fixture with no pins at all, and short of that the two diverge on tiers,
    spread and totals on every seed — by design, since a pin carries slack a rule never gets.
  - *Heavy pin load.* Twenty-six or more pins on a twelve-person month, the threshold at which
    routing pins through `combined_slack` would empty the `strict` group
    (`solve_schedule:1072-1074`) — note this is the **rejected** design's failure, not the
    per-person slack on the hard guards, which never touches `combined_slack`. Assert that an
    unavailable member's absence slack still applies and that the run returns `ok: true`; assert
    no flag and no tier, for the reason above.
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

  **Every such case must be one where the violated instance is FORCED**, as the
  Jakey-unavailable-in-W3 case is. §4 discloses that `violation_target` bounds the count and
  not the identity, so a case with two equally-minimal violation sets would flake on the seed.
  A test author adding a case must check that the named instance is the only one that can give.

  | Blocking mechanism | Case |
  |---|---|
  | Per-service occupancy | One of `any_of(Hugo,Jakey)` pinned into `Sun.Lead` that week, the other unavailable — the round-5 one-pin reproduction |
  | A count cap whose budget the pins spend | `Hugo Sun.BGV <= {weeks-2}` with Hugo pinned into `Sun.BGV` twice and Jakey out the other weeks — the round-6 two-pin reproduction |
  | A pair rule with a pinned counterpart | `A !with P on *.Choir`, P pinned, B week-excluded — the round-6 one-pin reproduction |
  | Week exclusion on the partner | The Saturday anchor with the only dedicated Saturday lead pinned into `Sat.BGV` |
  | Row capacity | A row pinned full (the original saturation case, kept) |
  | An unreachable `>=` / `==` bound | The named person pinned elsewhere for enough weeks; assert the rule is relaxed for the month, not narrowed |
  | Nothing left to lead with | Every lead-pool member pinned into other roles of one service; assert `ok: true`, the lead seat in `unfilled_seats`, and no exception |

- **A relaxation stays inside its own week.** The discriminating case, and the one the
  existing assertions miss: `any_of(Hugo,Jakey) on Sun.BGV each_week` with Jakey unavailable
  in week 3 and a pin occupying Hugo that week. Assert `pin_violations` is exactly
  `["W3: any_of(Hugo,Jakey) on Sun.BGV each_week"]` **and that the rule still holds in weeks
  1, 2 and 4**. A month-wide boolean passes `len(pin_violations) == 1` and fails this — which
  is why the count assertion alone is not enough. Repeat for a pair rule (same week, same
  service) and for consecutive.
- **The relaxation is minimal in count, and the objective is what keeps the amount small.**
  Assert that a month needing one rule relaxed relaxes exactly one — `len(pin_violations) == 1`
  — and that Stage B never returns more violations than the **violation-only solve** found,
  which is what `violation_target` now carries (not Stage A's count). Assert
  `violation_ceiling_proven: true` on that fixture; on a second, capped short enough that the
  violation-only solve cannot prove its minimum, assert `false` with the month still returned;
  and on a **third**, force the `stage_a` fall-through — a tiny `solver_total_budget_seconds`, or
  a month whose every Stage B tier is infeasible — and assert `false` **even though both solves
  proved their minima**. That third case is §4's third condition; it is the one production
  reaches and CI does not by accident, and without it the suite passes on a response that lies. Separately assert the measured amount case: `Gaby Sun.BGV <= 1`
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

  1. **A structural fingerprint, and this is the primary guard.** A SHA-256 over
     **`str(model.Proto())`** — the protobuf's text format — for the **Stage A model**,
     constraints included and not only variables. An earlier draft hashed the ordered `x` keys,
     the per-slot candidate lists and the `rand_w` draws, which is variables only: a violation
     boolean or a soft-form constraint leaking into the pinless path would be invisible to it,
     and caught only by the weaker output golden.

     **The API matters and a previous draft named one that does not exist.** That draft said
     `model.Proto().SerializeToString()`. On ortools 9.15.6755 — the version
     `gcf/requirements.txt:4` pins, and the one the CI step installs — `CpModel.Proto()` returns
     a pybind `CpModelProto` with **no** `SerializeToString`; calling it raises `AttributeError`.
     The text format works and is what the guard uses. Recorded because the draft also attached
     a measurement to the non-existent call, in a section that closes with "Executed, not
     reasoned" — the failure this spec exists to prevent, committed by its own author.

     **Stage A only, deliberately.** The Stage B model is not a pure function of the seed:
     `empty_target = stage_a.weighted_empty_used` enters it (`:1116`, `:677-678`), and under pins
     `violation_target` adds a second such input. Both are machine-independent only while Stage A
     proves optimality — a precondition, not a construction. Stage A's model has neither
     dependency, so fingerprinting it alone is the honest guard.

     **How the test gets the model, since `create_model_and_solve` neither returns nor exposes
     it:** a five-line `CpSolver.Solve` monkeypatch in the test captures the model of the first
     solve (Stage A's), hashes it, and restores. Said here because §9's safety argument rests on
     this guard and "hash the Stage A model" is not actionable without it.

     **The residual gap, named:** with `pin_set` empty the violation booleans do not exist, so a
     violation term leaking into Stage B's optimise branch on the pinless path would add a zero
     coefficient that neither this fingerprint nor the output golden would notice. §7 closes it
     cheaply — on a pinless fixture, assert the returning pass's objective coefficient count
     against a frozen number, and assert `pin_violations` comes back absent or empty. Verified on ortools 9.15.6755:
     the Stage A hash is identical at 10 s, 5 s and 3 s budgets on seeds 1, 42, 2024 and 7, and
     distinct between seeds — All of it is built before any solve and depends only
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
     assertion rather than a comment.

     **`OPTIMAL` removes the wall clock, not every tie.** Two solutions can share an objective
     value and a different CPU or ortools build can return the other, so this guard is weaker
     than the fingerprint above and is the second one for a reason. Its golden is captured **on
     the CI runner**, not on a developer's machine — so that the first cross-machine flake is
     resolved by re-capturing rather than by deleting the guard §9's rollout rests on.

     **The precondition itself can redden the gate on a slow runner.** Seeds 1 and 2024 return
     `OPTIMAL` at the fixture's 10 s budget and `FEASIBLE` at 3 s, so a loaded `ubuntu-latest`
     at `num_search_workers=1` can trip the assertion for reasons unrelated to any change. The
     documented answer is to **raise the fixture's budget** — the assertion exists to keep the
     golden meaningful, not to measure the runner — and never to drop the assertion or the
     golden.

     **Who re-captures, and when — and NEVER in a PR that changes solver logic.** Both goldens
     live in `gates`, the required check for every PR in the repo, so a runner-image or ortools
     bump could red-gate unrelated work. The rule has exactly two legitimate causes: **a runner
     image bump, or an ortools pin bump**, each in a PR that changes **nothing else**, using the
     skipped-then-un-skipped procedure §9 uses for the first capture, with the commit message
     naming which.

     **A red fingerprint inside the solver PR is a FINDING, never a literal to update.** An
     earlier draft of this rule said "only in a PR whose diff is the bump itself or `gcf/**`" —
     and the solver PR *is* a `gcf/**` PR, so it authorised re-capturing the byte-identity guard
     inside the one change whose entire preview-less safety argument is that guard. The pressure
     is not hypothetical: this delivery restructures `build_slots`, `build_candidate_map`,
     `validate_config`'s `all_people`/`known`, and all three hard-spread loops, and several have
     benign-looking ways to perturb the Stage A proto — whether `gmax + n[p]` with `n[p] == 0`
     serialises identically to `gmax`, or the interleaved `Sun.BGV`/`Sun.Choir` emission §9 names
     below. A red fingerprint there means the pinless path changed, which is exactly what the
     guard is for; it gets explained, not re-captured. §9 repeats this, because §9 is what leans
     on it. (The `INFEASIBLE` statuses in between are the fairness
     ladder probing tiers — normal, and not the returning solve.)

**Gates, and one of them does not exist yet.** `npx tsc --noEmit`, `npm test`, `npx eslint .`
with 0 errors — and **`pytest gcf/`, which no CI job runs today.**

That is a blocker for this delivery rather than a nicety. `.github/workflows/ci.yml:42-55`
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
changes, the soft-relaxation objective, the violation-only solve, and all three response fields
— `pinned_honored`, `pin_violations` and `violation_ceiling_proven`, the last of which would
otherwise ship undocumented.
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

**This half touches an app file too, so `preview` still goes first.** `app/api/admin/solve/route.ts`
gains the `pinned` and response fields. Both are `export interface` and erased by `tsc`, so the
emitted route is byte-identical and the risk is nil — but CLAUDE.md's rule is "PUSH ORDER IS
`preview` FIRST, THEN `main`. Always", and narrowing it silently is how a rule stops being one.
The branch goes to `preview` and the dev alias is verified before the PR to `main`, which costs
nothing here. The **Cloud Function** is the part that genuinely cannot rehearse on `preview`;
that exemption is architectural and is what the rest of this section is about.

**The release order is CLAUDE.md's, and the code review is part of it.** This half reaches
production with no preview rehearsal, so it is the half that most needs the step stated rather
than assumed: `implement → gates green → FRESH CODE REVIEW on the merge range → fix →
RE-VERIFY the fix (scoped review of the fix range + gates re-run) → merge to main`. Plan
approval is not authorization to implement, and the last worklog entry before the merge must be
a verification, not a fix.

**How the first golden is captured**, since step zero adds the CI step and the golden in one PR:
land the step with the golden assertions **skipped**, read the fingerprint and the schedule out
of that first green run's log — **pytest captures stdout on passing tests, so the capture run
needs `-s` or a deliberate report file**, which is worth stating because the entire preview-less
safety argument routes through this one procedure — commit them as the literals, and un-skip in the same PR. The
golden is captured by the runner that will enforce it, never by a laptop.

**Step zero: the python gate lands first.** §7's byte-identity and inertness assertions are
what make a production-first solver merge safe, and nothing runs them today (see §7's Gates).
So the CI step ships and is green on `main` **before** the solver change is merged — otherwise
the rollout's own safety argument rests on a file no gate reads.

**Verifying the Cloud Build deploy, concretely — the repo has no procedure to inherit.**
CLAUDE.md's verification rule is Vercel-specific (alias + `githubCommitSha`), and
`docs/SOLVER_AND_INFRA.md:108-121` documents how the function deploys, not how to check that it
did. So the check is stated here and added to that doc in §8:

1. `gcloud functions describe owt-solver --gen2 --region=us-central1` and confirm the active
   revision's `updateTime` is after the merge — the analogue of reading the alias, not the build.
2. One **pinless** smoke request, asserting `ok: true` and the **presence** of
   `pinned_honored` in the response. Presence is the discriminator: an old revision answers the
   same request successfully and without the field, which is precisely the state §7's handshake
   exists to detect.

Never a bare HTTP reachability check, and never a `grep` loop over build logs — CLAUDE.md
records what those cost here.

**And the one condition under which the function IS reverted:** the smoke request fails or comes
back without `pinned_honored`, i.e. the deploy did not land. That is a broken deploy, not a bad
feature, and re-deploying the previous revision is the fix. A *behavioural* problem found later
is **not** a revert trigger — the app half is what gets reverted then (see the rollback
paragraph below), because reverting the function while a pinned app is live makes every Auto
fail the handshake.

The solver must then be able to honor pins **before** the app can send them, or the client spec's §7 refusal is
the only thing standing between an admin and a silent overwrite. Therefore: merge the solver
change and confirm Cloud Build deployed it, then merge the app change. The
`preview`-first push order applies to the app half as usual, and the dev alias is verified by
`alias` + `githubCommitSha` before the PR to `main`.

**And the goldens are not re-captured in this PR.** §7 states the rule; it is repeated here
because this is the change that will feel the pressure. A red fingerprint on the solver PR means
the pinless path moved — the one thing the preview-less release is betting did not happen — and
it is investigated, never cleared by updating the literal.

**The pin-granted candidate is APPENDED to the slot's candidate list**, after the shuffled
eligible names, never inserted into the shuffle. Like the interleave below, this cannot affect
the pinless path, so no guard covers it — and two implementations of a looser wording would
produce different boards from the same seed on pinned months.

**Row growth must keep the interleave, and the spec says how.** When `max(default, pins_for(R,W))`
makes `Sun.BGV` and `Sun.Choir` unequal, emit them in one loop up to the larger count, appending
each row's slot only while its own count allows — so the two stay interleaved exactly as
`:554-555` does today. The pinless path is unaffected either way, so no guard covers this; two
implementations of a looser wording would produce different boards from the same seed, which is
why it is pinned here rather than left to taste.

**The byte-identity property has a hidden dependency: `build_slots` must keep emitting
`Sun.BGV` and `Sun.Choir` interleaved** (`:554-555`). Rewriting that loop per role — the
obvious tidy-up when adding the `max(default, pins)` count — changes the insertion order of
`x`, hence the seeded `rand_w` tie-break at `:946`, hence the board, for every un-pinned
month. §7's byte-identity test catches it, and it is named here so that nobody "fixes" the
loop later without understanding why it is shaped that way.

**Said out loud: one Cloud Function serves both environments.** The solver half never reaches
`preview` first, so "merge the solver first" means it is live in production before any human
has watched it work. That is inherent to the existing architecture, not introduced here, and
what makes it safe is the guard §7 requires: a request with no `pinned` key must build a
byte-identical **model** to today on a fixed seed. Not identical *output* — the response dict
gains three fields, so the phrasing an earlier draft used here was definitionally false; the
rollback paragraph below states the property correctly. Until the app starts sending pins, the
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
