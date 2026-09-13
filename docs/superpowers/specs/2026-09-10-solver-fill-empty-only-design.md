# «Solo llenar vacíos» — pinned assignments in CP-SAT — design spec

**Date:** 2026-09-10 · **Status:** Decisions E1–E8 approved in chat by Frank 2026-09-10; adversarial review in progress · **Risk tier:** **critical**

Critical, derived from the ladder: the request contract and the hard constraints of a
production solver change. Requirement: **two sequential fresh `APPROVED` verdicts on
byte-identical text**.

Delivery 1 (declared instruments and automatic instrument fill) shipped 2026-09-10 in
PR #57 and is independent; nothing here changes it.

**Two scope notes, both recorded during review rather than written up front.**

*The scope split (2026-09-10).* Frank asked that this also work on already-created draft
services. That half turned out to be a second design problem rather than a missing
paragraph — stored columns are keyed by Sanity `_id` while unfilled markers are emitted with
a `create:` prefix, and the calendar state the request is built from belongs to create mode
— so it would have arrived undesigned behind a half that had been reviewed. Frank chose to
split it (§14). This spec is create mode only.

*The mechanism rewrite (2026-09-10).* Two review rounds rejected an earlier design in which
a pinned seat was **removed** from the solver's slot list and the pinned person re-entered
as a constant. That made every interaction with the model a manual offset: round 1 found
four that had been missed, and round 2 found two more plus a reproduced regression — a
pinned person with no candidacies forced `total_vars` to zero, which pinned `gmin` to zero
and capped every other member at one or two services for the whole month. The mechanism
below fixes the variable to 1 instead, which makes those interactions automatic. §5 records
what that buys and what it still costs.

## 1. The brief

Frank, during delivery 1's brainstorm: «me gustaría tener una opción para que el solver
llene únicamente los espacios vacíos, en vez de sobre escribir todo». Today «Generar mes»
rewrites every solvable voice row on every weekend column, so a manual correction survives
exactly until the next Auto. He also asked for a delete control with a menu offering every
level of granularity, and for it to work on already-created draft services; that last half
is deferred to its own delivery for the reason recorded above.

## 2. What the repo says today

Every row verified against the tree at `ae792034`, which is unchanged in `gcf/` and
`plannerModel.ts` at the commit this spec sits on.

| Fact | Where |
|---|---|
| Decision variables `x[(person, slot.key)]` exist **only** for people in `candidates[slot.key]`, which `build_candidate_map` fills from `is_eligible` | `gcf/owt_solver_v2.py:637-640`, `:564-582` |
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
| Availability is **not** a block in the picker — it is a `+10` sort penalty, so an admin can and does seat an unavailable member | `candidateRanking.ts:211`, `:246` |
| The picker DOES block the same person twice in one service, same category | `candidateRanking.ts:196-204` |
| `applySolveResponse` REPLACES a solvable cell — it rebuilds `occupants` with no merge and stamps `origin: "auto"` | `plannerModel.ts:925-936` |
| `mapUnfilledSeats` maps an unfilled entry by role and week, never by slot index | `:958-986` |
| Auto is create-mode only | `PlannerGrid.tsx:1997` |
| The Auto confirmation says it will replace every voice assignment the solver can resolve | `PlannerGrid.tsx:2035-2040` |
| Member-declared availability is **not** rendered on a cell — `blockingReasons` reads admin-authored `weekExclusions`, a different thing; the only availability signal is a transient drag toast | `ruleEnforcement.ts:372-383`, `PlannerGrid.tsx:2861-2891`, `:1177-1186` |
| The rules panel cannot author a `!consecutive` clause — `restrictionToDs` never emits one | `plannerModel.ts:572-599` |
| Create mode derives `drafts` inside `handleCellsChange`; a cell change that bypasses it renders one thing and posts another | `MonthGenerator.tsx:2467-2487` |
| Local development runs the repo's own solver directly, bypassing the deployed one | `app/api/admin/solve/route.ts:69-108` |
| `Menu`, `CueDialog`, `Button`, `Switch` exist as house primitives | `app/components/ui/` |
| `weekForColumn` maps a weekend column to the solver's 1-based week; a special returns `null` | `plannerModel.ts:845-858` |
| Cloud Build deploys `gcf/**` on `main`; Vercel deploys the app from the same branch | `cloudbuild.yaml:3` |

## 3. Decisions

- **E1 — What the switch preserves: everything on the board, instruments included.** With
  «Solo llenar vacíos» on, every occupied voice cell on a weekend column is pinned regardless
  of how it got there — a human pick or a previous Auto — and the instrument filler is told
  to keep its own previous picks as well. Frank chose this over "preserve only manual picks",
  and confirmed the instrument half on 2026-09-12. The consequence is deliberate: re-running
  Auto on a full month does nothing until something is cleared. Clearing is the re-roll.

  The instrument half is not free, and an earlier draft of this spec left it out while
  claiming it was already handled. `fillInstruments` runs at **every** exit of `handleAuto`,
  inside `applySpecialFill` (`MonthGenerator.tsx:2984-2986`), and it opens by calling
  `vacateAutoInstrumentCells` (`instrumentFill.ts:119`), which empties every weekend
  instrument cell whose `origin === "auto"` (`:85-90`). Only `origin: "manual"` picks survive
  it. So without this decision, pressing Auto twice with the switch on would leave the voices
  untouched and re-roll the drums and the keys — and §7's dialog would be promising to fill
  only the empty seats while doing exactly that. `fillInstruments` therefore takes the switch
  as an input and skips the vacate when it is on, which is the one-line version of "preserve
  everything on the board".
- **E2 — The switch is OFF by default.** Auto behaves exactly as it does today until the
  admin turns it on.
- **E3 — When a pin contradicts a rule, the pin wins, and the conflict is shown.** A
  non-blocking amber notice, never a refusal. Frank: «gana el pin, pero sigue mostrando el
  aviso acerca del conflicto, no es algo que bloquea». One collision is *guaranteed*, not
  hypothetical: availability compiles to a hard `!in week n` rule while the picker lets an
  admin seat that same person anyway.
- **E4 — A pin is a fixed variable, not a removed seat.** See §5.
- **E5 — Conflicts are computed on the client**, so the notice appears when the person is
  seated rather than when Auto runs. The solver is not asked to explain conflicts.
- **E6 — One «Borrar» button with a menu**, at two scopes across the categories Auto and the
  instrument filler can rebuild. FOH is never cleared in bulk: nothing refills it, so
  clearing it is guaranteed rework.
- **E7 — Auto and the clears stay where Auto already lives: create mode.** This delivery
  does not move that gate, and nothing in it reads or writes a stored role document, so no
  published service can be touched by construction rather than by a check.
- **E8 — The response must prove the pins were honored.** A silently-ignoring old solver is
  a real deployment state. See §9.

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
`pinned_honored?: number` (§9's handshake) and **`pin_violations?: string[]`** — the rules
the solver had to relax to honour the pins, each as that rule's own `source` string, the same
text the rules panel shows. §6 renders them; §5.2 explains why they exist.

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
first, and reports the rest as a conflict (§6). Pins are also deduplicated outright before
the count of §9 is taken.

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

**Fairness: every HARD spread is over the seats the solver chose; the soft ones see totals.**
A pin is a service the solver did not choose, so it must not be able to make the month
infeasible. There are **three** hard spreads, not one, and missing two of them is how a
three-pin action collapsed a whole month in review:

| Hard guard | Where | With pins |
|---|---|---|
| Global, `gmax - gmin <= fairness_limit` | `:794` | over `total_vars[p]` **minus** that person's pin count |
| `cur_sun_lead_spread <= sun_lead_limit` | `:865` | over `role_vars[(p,"Sun.Lead")]` **minus** their `Sun.Lead` pin count |
| `cur_sun_bgv_spread <= sun_bgv_limit` | `:882` | over `role_vars[(p,"Sun.BGV")]` **minus** their `Sun.BGV` pin count |

The **soft** terms are deliberately left alone and keep seeing the totals: `ov_total`
(`:777-781`) feeding `overall_spread` at `:949`, and `role_spread_vars` over
`overall_role_vars` (`:812-843`) feeding the objective at `:956`. Subtracting in the soft terms as well
would leave the objective blind to the pins entirely; leaving them alone is what keeps the
*preference* ordering aware of who is already ahead.

**But the soft preference does not win, and the ADR must say so.** The hard spreads now run over
solver-chosen seats, so a pinned person looks to them as though they have served nothing and
is pushed *up* toward parity on top of their pins. Measured in review: three pins on one
member took her from five total services to six while the rest sat at four. That is the price
of never failing the month, it is the right trade, and it is the opposite of what a reader
expects from "the soft terms still see the totals" — the hard spread overrides the soft
preference every time — so §12's ADR records it plainly rather than leaving it to be
rediscovered as a bug.

Reproduced in review before the two per-role guards were named: pinning one person into
`Sun.Lead` for three weeks drove every Stage B tier infeasible, `solve_schedule:1137` returned
the fairness-free `stage_a`, and the resulting board gave one member zero services while
another took half the Sunday leads — with the pins honoured, so §9's handshake passed and the
client applied it. The fingerprint of that failure is a reported limit of `len(slots) + 1`
(`big`, `:1094`), which §11 asserts against.

**Not fairness slack, which looks right and is not.** Routing pins through `combined_slack`
(`:1065-1066`) is the obvious move and it fails: giving most people slack empties the
`strict` group, and `solve_schedule:1072-1074` then resets `strict` to everyone and sets
`relaxed = {}` — discarding every pin's slack, **every absence's slack, and every authored
`fairness_slack N` rule**. A reviewer reproduced exactly that on a 12-person month (34, 30
and 26 pins all collapse `strict` to zero), including the Stage-A fairness-free fallback
this paragraph exists to prevent, and it regresses shipped absence behaviour on every pinned
run. §11 carries a guard that reaches that branch.

**The `strict` collapse branch must exclude pinned-only people too.** `:1072-1074` rebuilds
`strict` from `all_people` when it falls below two — and `all_people` now contains the
pinned-only names this section removed from the fairness groups. A literal implementation
would let a person the solver has no power over set `gmin`, on exactly the thin-roster months
where the fallback fires. The rebuild is therefore over `all_people` minus the pinned-only
set, and §11 asserts it on a month that reaches the branch.

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

| Constraint | Where | Soft form under pins |
|---|---|---|
| At least one Lead per service | `:654-659` | `sum(filled) >= 1 - v` |
| Dedicated Saturday lead anchor | `:705-709` | `sum(dedicated_terms) >= 1 - v` |
| Weekly presence, `any_of(…) each_week` | `:732-742` | `sum(terms) >= 1 - v` |
| Pair exclusion | `:711-722` | `sum(lt) + sum(rt) <= 1 + v·n` |
| Consecutive | `:744-751` | `sum(w1) + sum(w2) <= 1 + v·n` |
| DSL count rules, all three operators | `:885-896` | `expr >= value - v·B` and/or `expr <= value + v·B`, **one `v` per rule** so an `==` reports as one relaxed rule rather than two halves |

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

**Relaxing a rule switches it off for the month, not by the minimum amount.** This is the
same deliberately over-broad choice the earlier draft made for count rules, kept for the same
reason: narrowing a rule per row silently changes what the admin's rule means. In practice
the ordinary objective still holds the result at the bound — measured: `Gaby Sun.BGV <= 1`
with Gaby pinned into `Sun.BGV` twice relaxes the cap and gives her exactly her two pinned
weeks, not more — but that is the objective's doing and the spec claims no guarantee. §11
asserts the observed behaviour rather than a bound.

**With no pins, none of this is built.** `soft = bool(pin_set)`; every constraint above is
emitted exactly as it is today and no boolean exists. That is what keeps §13's byte-identity
property true, and it was verified on three seeds.

**Yes, the mandatory lead is in the table.** It is the one constraint the solver is otherwise
built never to relax, and this is E3 applied honestly: if the admin has pinned every
lead-pool member into other roles of that service, the service genuinely has no lead. The
seat is left empty and reported through `unfilled_seats` like any other shortfall, which is
the signal the planner already renders — instead of failing the whole month over a roster
the admin built on purpose.

**What this buys §6 and §10.** The solver returns `pin_violations`, the rules it actually
relaxed, each as the rule's own `source` string. So the conflict notice stops being a client
guess about what *might* clash and becomes a report of what *did* — and §10's claim that a
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

**The clears must drop them.** The same field cuts the other way in §7: a cleared cell keeps
no occupants, so a surviving waiver would silently pre-sanction whoever lands there next —
the precise failure `overrideReasons` was added to prevent. Clearing a cell clears its
`overrides` and `overrideReasons` with it.

**`origin` must not be restamped.** `applySolveResponse` writes `origin: "auto"` on every
cell it touches (`plannerModel.ts:930-935`). `origin` is per **cell**, so a cell holding one
pinned person and one solver pick is a real and common case, and there is no origin that
describes it. The rule is therefore: a cell that contains **any** pinned occupant keeps the
`origin` it had. This is what keeps §7's count of hand-placed seats honest. It does not
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
it is why §11 asserts the occupant **set** and the `origin`, never the array.

**`unfilled_seats` renumbering.** Rows that grew have more slots, so `slot_index` shifts.
The client maps an unfilled entry by role and week, never by index (`:958-986`), so the
shift is invisible — but the count per row changes, and the tests pin that.

## 6. Conflicts: named on the board, never blocking

Computed on the client when the person is seated. Six cases:

| Case | Copy | Who renders it |
|---|---|---|
| The person marked that date unavailable | ⚠ Nombre: marcó que no puede este día — se va a respetar tu decisión | **New.** Nothing renders this today — see below. |
| A hard rule separates them from someone else in that service | ⚠ Nombre y Otro: una regla los separa — se va a respetar tu decisión | The existing violation marker, `ruleViolationsForColumn` |
| They are not in the pool that role draws from | ⚠ Nombre: no está en el pool de Lead — se va a respetar tu decisión | **New** |
| More people are pinned in the row than it has seats | ⚠ 3 personas fijadas en una fila de 2 lugares | **New** |
| The same person is pinned twice in one service | ⚠ Nombre está fijado dos veces en este servicio — solo se respeta el primero | **New**, and §4 says why it should be unreachable |
| A rule had to be set aside to honour the pins | ⚠ Se dejó de aplicar una regla para respetar lo que fijaste: «Hugo Sun.BGV <= 2» | **New**, and it is **reported by the solver**, not guessed by the client — one line per entry in `pin_violations` (§5.2) |

**The availability notice is genuinely new, and it is the one the requirement named.** It
does not exist today in any form: `blockingReasons` reads `PersonRestriction.weekExclusions`,
which are admin-authored rules (`ruleEnforcement.ts:372-383`), while member-declared
availability lives in `member.unavailableDates` and only becomes a DSL string inside
`buildSolveRequest` (`plannerModel.ts:796-806`). The two never meet, and the cell card
renders no availability line at all (`PlannerGrid.tsx:2861-2891`). Assuming the existing
amber covered it would have shipped E3's *guaranteed* collision silent.

**The rule-set-aside notice is the solver's, and that is the point.** An earlier draft had
the client predict which rule a pin would clash with, from the rules it could see. It cannot
see enough — a pair rule and a count cap are model constraints, and three review rounds each
found another case the prediction missed (§5.2). Now the solver reports what it actually
relaxed and the client renders that list verbatim. A rule form added later needs no client
change to be named correctly.

**No notice for the two built-in requirements.** The dedicated-Saturday-lead anchor and the
mandatory lead are built into the solver rather than authored, so there is no rule to name in
the copy. **And the solver cannot name them the way an authored rule names itself:** it works
in 1-based week indices and has no calendar at all (`build_slots:547-562`), so it can produce
no «13 sep». They therefore reach `pin_violations` as machine markers — `builtin:mandatory_lead:W3:Sun`,
`builtin:sat_anchor:W3` — which the client is the only thing that can turn into a date, and
which §6 renders as «Se dejó abierto el lugar de líder del 13 sep» rather than as a rule name.

An authored rule's entry is its `source` string and the client renders it verbatim; a builtin's
is a marker the client localises. That split is the whole reason `pin_violations` carries
strings with a prefix rather than free text, and §11 asserts a client that meets an
**unknown** `builtin:` marker renders a generic line instead of the raw token. Setting either aside is silent — with one exception that carries the signal anyway:
a lead seat skipped under §5.2 is reported through `unfilled_seats` and renders as «Sin
cubrir» on the cell, which is the planner's existing language for a seat nobody filled.
Inventing a name for a rule the admin cannot see or edit would be worse than the silence.

**No consecutive-rule notice.** The rules panel cannot author a `!consecutive` clause
(`restrictionToDs`, `plannerModel.ts:572-599`), so a notice for it would be unreachable code
describing a rule no admin can create. §5.2 still makes the constraint soft, because the DSL
parser accepts the form and a hand-edited document could carry one — and if one ever does,
the solver names it in `pin_violations` without any client change.

Where an existing marker already renders the fact, these notices **are** that marker; only
the five marked "New" add a line of their own.

## 7. The switch and the «Borrar» menu

**The switch.** A `Switch` labelled «Solo llenar vacíos» beside the Auto button, off by
default, explained in one line: «Auto respeta lo que ya está puesto y solo llena los lugares
vacíos.» Component state, not persisted — a per-run choice.

**The menu.** One `Button` labelled «Borrar» opening a `Menu`, with a live count on every
item so the admin sees what they are about to lose:

- **Este servicio** — Voces · Instrumentos · Voces e instrumentos
- **Todo el mes** — Voces del mes · Voces e instrumentos del mes

The same menu appears in each column's header with the scope fixed to that service. Only the
month-level items confirm, through `CueDialog`, naming the count, saying FOH is preserved,
saying nothing is written until «Crear N borradores», and separately counting how many of
the discarded seats were placed by hand — a figure that is **approximate in both directions,
and the dialog's wording must not promise otherwise**. It over-reports because §5.3 keeps a
cell's `origin` when it holds any pinned occupant, so the solver's own picks inside a cell the
admin started count as hand-placed. It also **under-reports**: `withAutoCell` stamps
`origin: "auto"` on a cell a human partly filled (`localFill.ts:211-221`, and its own comment
says so), so a special's Lead seat the admin seeded and the filler then topped up reads as
zero hand-placed. The count is a hint about scale, not a guarantee, and the copy says
«aproximadamente» rather than asserting a number. A service-level clear is immediate; re-running Auto
is the undo.

**Specials are in «Todo el mes», and their un-refillable rows are not.** E6's principle is
that clearing what nothing refills is guaranteed rework, and two rows on a special column meet
that description: its **Coro**, which `fillColumn` never touches (`AUTO_FILL_ROW_IDS = ["lead",
"bgv"]`, `localFill.ts:79`), and **every instrument cell**, since `fillInstruments` iterates
weekend columns only (`instrumentFill.ts:117`). So a month-level clear empties a special's Lead
and BGV — which the local filler does rebuild — and leaves its Coro, instruments and FOH alone.
Stated rather than left to the reader, because «Todo el mes» reads like "everything" and E6
already committed to not clearing what will not come back.

No item is called «Todo», because none of them clears everything: FOH always survives (E6).
A label that promised more than it does is a defect this repo keeps recording.

**A clear routes through `handleCellsChange`.** Create mode derives `drafts` there
(`MonthGenerator.tsx:2467-2487`); a clear that called `setCells` directly would empty the
grid while «Crear N borradores» still posted the people just removed. The same pass drops
any `unfilled` marker on a cleared cell, which would otherwise outlive the seat it described —
and that is **new behaviour in a shared handler**: `handleCellsChange` does not touch
`unfilled` today, and every manual edit routes through it. Dropping a marker whose cell was
just emptied is right for every caller, not only for the clears, so it ships here rather
than in a separate delivery — but it is called out because the blast radius is wider than
the feature that motivates it, and §11 covers the manual-edit path as well as the clear.

**And it makes the displayed count fall as empty seats rise, which is intended.** `unfilled`
is one entry per missing SLOT, so a Coro cell holding one of three carries two markers.
Emptying that cell by hand drops both, and «Lugares sin cubrir (faltó gente)»
(`PlannerGrid.tsx:2096`) counts down while three seats are now empty. That is correct for
what the label says — those seats are empty because a human emptied them, not because
nobody was available — but it looks like a bug to anyone reading the number alone, so §11
asserts it deliberately rather than leaving it to be "fixed" later.

**Skipped columns are pinned like any other.** Auto deliberately ignores `skippedColumnIds`
(`MonthGenerator.tsx:2940-2945`); cells sitting on a skipped column are still occupied, so
the switch pins them. Intended, and stated because the alternative reading is just as
plausible.

**Both sentences of the Auto confirmation change, not just the voice one.** The dialog also
says «Las asignaciones manuales de instrumentos y FOH no se tocan» (`PlannerGrid.tsx:2033-2034`),
which under the switch understates the guarantee: no instrument assignment is touched, manual
or not (E1). With the switch off that sentence stays exactly as it is.

**The Auto confirmation copy changes with the switch.** Today it reads «Esto reemplazará
toda asignación de voz (Lead, BGV, Coro) que el solver pueda resolver en este mes»
(`PlannerGrid.tsx:2035-2040`), which becomes false the moment the switch is on. With it on
the dialog says Auto will fill only the empty seats, and names how many.

**Naming.** Not «Limpiar mes», which already means deleting stored services from Sanity
(`clearMonthModel.ts`). «Borrar» here empties seats on the board and writes nothing by
itself.

## 8. Where Auto and the clears are available

Create mode only, which is where Auto already lives (`PlannerGrid.tsx:1997`). Both act on
grid state alone: a create-mode column has no stored document behind it, so nothing in this
delivery can reach a service the team has already seen. That safety property is structural,
not a gate that could be got wrong. Nothing reaches Sanity until the existing «Crear N
borradores» runs, unchanged.

## 9. The version handshake

`solve_from_dict` reads with `data.get(...)`, so a solver that predates this change accepts
a request carrying `pinned` and **ignores it silently**, returning a full roster that
overwrites the very seats the switch promised to keep. The solver and the app deploy through
different pipelines from the same merge — Cloud Build for `gcf/`, Vercel for the app — so
this state exists in the window between them, and again on any rollback of one but not the
other.

`SolveResponse` gains `pinned_honored?: number`, the count of pin constraints the solver
added. When the switch is on and pins were sent, the client **refuses to apply the voice
roster** unless both hold:

1. `pinned_honored` equals the number of pins sent, and
2. every pin appears in the returned roster for its own week and role.

The second check is free — the client already holds the response — and is strictly stronger
than the count, which cannot distinguish "honoured mine" from "honoured that many". On
failure it reports «El solver no respetó los lugares fijados; no se aplicó nada». Refusing is
correct here even though §6 never blocks: §6 is about the admin's own contradictions, this is
about a solver that did not do what it was asked.

**The refusal is an exit of `handleAuto` and obeys that function's contract.** Every exit
calls `applySpecialFill` exactly once, which owns `setCells`/`setUnfilled`/`setDrafts` and
runs the specials and instrument fillers (`MonthGenerator.tsx:2954-2999`). The refusal exit
does the same: the solver's voice roster is discarded, the local fillers still run, the error
line carries the message. "Nothing is applied" means the voice roster, not the setters.

**Local development cannot exercise this.** `callLocalSolver` spawns the repo's own
`gcf/owt_solver_v2.py` (`app/api/admin/solve/route.ts:69-108`), which always understands
`pinned`. The refusal path is provable only by the unit test in §11, and that is where it is
required.

## 10. Error handling

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
  overflow, candidacy is granted only where the pin points, and the hard spreads run over
  solver-chosen counts so fairness cannot fail either.
  **This is the third answer to this question and the first one that is not an argument.**
  The two before it asserted completeness for an enumerated exemption list; review broke the
  first with one pin and the second with two, and in both cases the admin was shown the
  mandatory-lead diagnostic — naming the wrong cause and never mentioning the pin that caused
  it. That misdirection is the reason this bullet is not simply "add the pins to
  `diagnose_infeasibility`": a diagnostic for a failure that no longer happens is dead code,
  and the failure not happening is what the admin actually needs.
- **Two pins for one person in one service** are refused by the solver with a `ValueError`
  naming the person and the service, not left to produce two `== 1` constraints against the
  `<= 1` occupancy limit and kill the month with a generic diagnostic. The client already
  prevents the arrangement (§4) and the picker prevents it upstream; this is the cheap
  backstop that turns a month-wide failure into a message.
- The client-mutation invariant is unchanged: the Auto fetch keeps its try/catch/finally, its
  `res.ok` check and its loading-flag reset.
- A clear never fails: it is local state.

## 11. Testing

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
    — the reproduced collapse. **Size the lead pool so the tier is genuinely satisfiable**:
    with the hard spread over solver-chosen seats, three pins out of eight `Sun.Lead` slots
    leave five for everyone else while the pinned person's own adjusted count is 0, so on a
    thin pool `sl_limit = 1` can be unsatisfiable with nothing wrong. The discriminating
    assertion is the second one, not the first. Assert `sun_lead_fairness_relaxed: false` and that no reported
    limit equals `len(slots) + 1`, which is the fingerprint of the fall-through to `stage_a`.
    Repeat for `Sun.BGV`. A version of the mechanism that subtracts pins only from the global
    spread fails this and passes a whole-month guard.
  - *Heavy pin load.* Twenty-six or more pins on a twelve-person month, the threshold at which
    a slack-based design empties the `strict` group (`solve_schedule:1072-1074`): assert
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
- A request with no `pinned` key produces byte-identical output to today, on a fixed seed.

**Client.** `buildSolveRequest` gains the grid inputs it needs — `cells`, `columns` and
`rows` — and derives each pin's week from `weekForColumn(column, sundayDatesFull)`, the
**full** month spine and never the admin's selection, which is the E21 hazard
`applySolveResponse` and `mapUnfilledSeats` both document at length. **A weekend column whose
`weekForColumn` returns `null` contributes no pins** — an unaddressable Saturday
(`computeUnaddressableDates`, `MonthGenerator.tsx:2183`) is a weekend column, so the
special-column filter does not catch it, and a pin with a null week would reach the solver's
range check as a `ValueError` that fails the whole month over a column nobody can fill anyway.
Asserted, because the filter that looks sufficient is not. It emits one pin per
occupied voice cell on a weekend column when the switch is on, none when it is off, and none
from a special column; it deduplicates
by person-and-service and reports the duplicate. The four new conflict notices render — the
availability one especially, since nothing renders it today — and none disables Auto or save.
The §9 refusal discards the voice roster, still runs the local fillers, and shows the
message. **A cell holding a pinned occupant keeps its `origin`, its `overrides` and its
`overrideReasons`** — the discriminating case is a waived pair rule: waive «Frank !with Gaby»
on a weekend Lead cell, run Auto with the switch on, and assert the marker still reads «regla
anulada» (`overridden: true`) rather than turning red, and that the partner does not flag
either. Assert too that a waiver for someone the solver did NOT return is pruned, and that a
cleared cell keeps no waivers at all. The clears route through
`handleCellsChange`, empty exactly the rows their item names, never FOH, and drop the stale
`unfilled` markers — asserted for a manual edit too, not only for a clear, since the handler
is shared. The new marker-dropping pass sits **after** `handleCellsChange`'s stored-mode early
return (`MonthGenerator.tsx:2480-2483`) — create mode only, matching D-scope — and a test
covers a stored-mode call to prove the handler is untouched there. «Todo el mes» counts every
column of the preview, specials included, per §7.

**Instruments are frozen by the switch (E1).** With the switch on, two consecutive Autos
leave every `origin: "auto"` instrument cell byte-identical; with it off, the second Auto
re-rolls them exactly as it does today. This is the guard for the one-line vacate gate, and
it is the assertion that would have caught the claim §14 used to make.

**Gates, and one of them does not exist yet.** `npx tsc --noEmit`, `npm test`, `npx eslint .`
with 0 errors — and **`pytest gcf/`, which no CI job runs today.**

That is a blocker for this delivery rather than a nicety. `.github/workflows/ci.yml:36-52`
runs types, vitest and eslint and nothing else; `package.json` has no python script; and
`gcf/cloudbuild.yaml` is a single `gcloud functions deploy` step with no test before it. So
`gcf/test_owt_solver_v2.py` runs only when a human remembers, and the `gates` check that
CLAUDE.md makes the merge condition for `main` proves **nothing whatsoever** about a
`gcf/**`-only PR. A code review of the diff cannot execute it either.

Everything §13 leans on lives in that unrun file: the byte-identity assertion, the
fairness-collapse guards, the rules-stay-hard control, the pinned-only `KeyError` guard. §13
says the solver ships to production first, without preview, and that "what makes it safe is
the guard §11 requires" — and the rollback story is the same property. An unenforced guard is
an intention, and CLAUDE.md draws that exact line: *"that property is what makes it a control
rather than an intention."*

**So this delivery adds the gate, in the same change and before the solver merges.** A step in
the existing `gates` job (`setup-python`, `pip install -r gcf/requirements.txt pytest`,
`pytest gcf/`) rather than a second workflow, so one required check still means "everything
passed" and a `gcf/**`-only PR cannot go green on a job that never looked at it. The
byte-identity and inertness assertions are the ones that must be inside it; §13's rollout
order starts *after* it is green on `main`.

## 12. Documentation in the same delivery

`docs/SOLVER_AND_INFRA.md` — the `pinned` field, the fixed-variable mechanism, the enabling
changes, the soft-relaxation objective, `pin_violations`, the handshake.
`docs/MONTH_GRID_EDITING.md` — the switch, the menu, the confirmation copy, and the rule that
a pinned cell keeps its waivers. `docs/CI.md` — the new python step in `gates`, what it runs
and why a `gcf/**`-only PR needs it. One ADR: **pins
are fixed variables with scoped candidacy, hard spreads over solver-chosen seats, and every
contradictable rule made soft under a violation-minimising objective** — recording the
rejected remove-the-seat design and the reproduced fairness collapse that ended it, the
rejected fairness-slack answer and the `strict`-collapse branch that killed it, **and the two
rejected enumerations of exemptions — keyed on row saturation, then on a four-case
satisfiability predicate — with the one-pin and two-pin reproductions that killed them.**
That last entry is the ADR's real payload: the enumeration is the design a reader will
re-derive, because it looks cheaper than making six constraints soft, and it failed three
times. Five rejected designs, each with the execution that disproved it. Record the bounded
compensation §5.1 measures alongside them. No new secret or env var, so `docs/SECRETS.md` is untouched.

## 13. Rollout

**Step zero: the python gate lands first.** §11's byte-identity and inertness assertions are
what make a production-first solver merge safe, and nothing runs them today (see §11's Gates).
So the CI step ships and is green on `main` **before** the solver change is merged — otherwise
the rollout's own safety argument rests on a file no gate reads.

The solver must then be able to honor pins **before** the app can send them, or §9's refusal is
the only thing standing between an admin and a silent overwrite. Therefore: merge the solver
change and confirm Cloud Build deployed it, then merge the app change. The
`preview`-first push order applies to the app half as usual, and the dev alias is verified by
`alias` + `githubCommitSha` before the PR to `main`.

**The byte-identity property has a hidden dependency: `build_slots` must keep emitting
`Sun.BGV` and `Sun.Choir` interleaved** (`:554-555`). Rewriting that loop per role — the
obvious tidy-up when adding the `max(default, pins)` count — changes the insertion order of
`x`, hence the seeded `rand_w` tie-break at `:946`, hence the board, for every un-pinned
month. §11's byte-identity test catches it, and it is named here so that nobody "fixes" the
loop later without understanding why it is shaped that way.

**Said out loud: one Cloud Function serves both environments.** The solver half never reaches
`preview` first, so "merge the solver first" means it is live in production before any human
has watched it work. That is inherent to the existing architecture, not introduced here, and
what makes it safe is the guard §11 requires: a request with no `pinned` key must produce
byte-identical output to today on a fixed seed. Until the app starts sending pins, the
deployed change is inert for everyone.

**Rollback is one-sided, and that is the point.** Reverting the app commit is sufficient: the
app stops sending `pinned`, and by the byte-identity property the deployed solver then
behaves exactly as it does today. The solver half needs no revert and must not be reverted in
a hurry — a rollback of the app alone is complete, and rolling back the Cloud Function while
a pinned app is still live would make §9's refusal fire on every Auto instead.

## 14. Out of scope

**Auto and the clears on already-created draft services — deferred to its own spec.** It
needs a stored-mode request builder (the weeks and Saturdays a stored month actually has,
not the create-mode calendar state), a column mapping in both directions (stored columns are
keyed by the Sanity `_id` at `storedRoleReadModel.ts:113` while `mapUnfilledSeats` emits a
`create:` prefixed id at `plannerModel.ts:1023`, so today every unfilled marker would address
a column that does not exist and vanish silently), an explicit treatment of published
services sitting inside the same month, and an answer for the fairness history, which a
stored-mode save does not record today — only `handleConfirm` does
(`MonthGenerator.tsx:3262`). That list is the starting point for its brainstorm.

Also out: **solver** pins for instrument or FOH seats. The solver knows five voice roles and
nothing else, and instruments are filled client-side; E1 keeps the instrument filler's own
picks by switching off its vacate, which needs no pin and no solver change. FOH is untouched
either way, as nothing fills it automatically.

Also out: any change to publication, to «Limpiar mes», or to the participation sidebar. Persisting the switch across sessions. Auto on published services, in
any form or delivery.
