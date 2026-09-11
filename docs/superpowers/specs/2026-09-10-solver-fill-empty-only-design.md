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
| Global fairness is a **hard** constraint, `gmax - gmin <= fairness_limit`, and the relaxation loop offers only tiers 1 and 2 | `:794`, `solve_schedule:1101-1115` |
| Fairness **slack** already exists as the escape valve, and absence already uses it: `combined_slack = fairness_slack + absence_slack` feeds `global_slack` | `:1063-1066`, `:790-793` |
| Per-role spread has the same shape with its own `role_fairness_slack`, over `overall_role_vars` which already includes `hist_role` | `:812-843` |
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

- **E1 — What the switch preserves: everything on the board.** With «Solo llenar vacíos»
  on, every occupied voice cell on a weekend column is pinned regardless of how it got
  there — a human pick or a previous Auto. Frank chose this over "preserve only manual
  picks". The consequence is deliberate: re-running Auto on a full month does nothing until
  something is cleared. Clearing is the re-roll.
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

So the solver unions the pinned names into `all_people` after the pool exclusivity guard —
which compares the three pools against each other (`:453-454`) and is unaffected — and adds
them to **no** pool, so `is_eligible` still keeps them out of every candidate list the pin
did not grant. They are then **excluded from the global and per-role fairness groups**: the
solver cannot choose them anywhere, so including them would let a person it has no power
over set `gmin` and cap everyone else.

**Fairness: the hard spread is over the seats the solver chose.** A pin is a service the
solver did not choose, so it must not be able to make the month infeasible — and the global
spread is *hard*, with only tiers 1 and 2 (`:794`, `:1120-1133`). The hard comparison
therefore runs over each person's **solver-chosen** count, `total_vars[p]` minus their pin
count, and the same subtraction is made in the per-role spread. Pins still reach the
optimiser through `ov_total` (`:777-781`), which feeds the soft `overall_spread` at `:949`,
so the solver still *compensates* — a person the admin pinned four times is already ahead,
and the objective pushes the remaining seats toward everyone else.

**Not fairness slack, which looks right and is not.** Routing pins through `combined_slack`
(`:1065-1066`) is the obvious move and it fails: giving most people slack empties the
`strict` group, and `solve_schedule:1072-1074` then resets `strict` to everyone and sets
`relaxed = {}` — discarding every pin's slack, **every absence's slack, and every authored
`fairness_slack N` rule**. A reviewer reproduced exactly that on a 12-person month (34, 30
and 26 pins all collapse `strict` to zero), including the Stage-A fairness-free fallback
this paragraph exists to prevent, and it regresses shipped absence behaviour on every pinned
run. §11 carries a guard that reaches that branch.

### 5.2 The five exemptions where a rule would contradict a pin

E3 says the pin wins. Each exemption is scoped to the pinned assignment itself. The list is
the product of executing the mechanism against the real solver, not of reading it — the first
four were derived by reading and the fifth, which breaks the feature's headline use case on
the rules the team runs today, was not.

| Rule | Exemption |
|---|---|
| Week exclusion (availability), `:679-690` | Not applied to the slots of a pinned (P, R, W). Every **other** slot that week stays excluded, so pinning someone into Sunday does not make them available for Saturday. |
| Pair exclusion, `:711-722` | Skipped for a (week, service) where **both** sides are pinned. With one side pinned the rule keeps full force and pushes the other person out — which is the wanted behaviour. |
| Consecutive, `:744-751` | Skipped when the person is pinned in both weeks for matching roles. |
| DSL count rules, `:886-897` | For `<=` and `==`, the bound becomes `max(rule.value, pinned_count)` so the pins themselves cannot be infeasible. |
| **Any "at least one of these" requirement whose row the pins have filled** | Skipped for that row and week. See below — this is the exemption the first draft missed, and it is the one that breaks the headline use case. |

**The saturated-row family.** Rows grow to `max(default, pins)`, which fits the pins but
leaves **no headroom**: when pins fill a row, the solver cannot place anyone else in it. Every
hard constraint of the shape "at least one X must appear in this row and week" is then
unsatisfiable. There are three instances, and the first fires on the shipped rule set:

- **Weekly presence** (`:732-742`). `any_of(Hugo, Jakey) on Sun.BGV each_week` is a rule the
  team runs today (`solverConfigDefaults.ts:95-97`). Take a solved board, hand-swap Jakey out
  of one week's Sun.BGV for somebody else — the manual correction this whole feature exists
  to preserve — turn the switch on, press Auto, and the month returns `ok: false`. Reproduced.
- **The Saturday dedicated-lead anchor** (`:705-709`). Pin both `Sat.Lead` seats of a week
  with non-dedicated leads, which the picker permits, and `sum(dedicated_terms) >= 1` cannot
  hold. Reproduced.
- **DSL `>=` count rules** (`:894-895`). An earlier draft of this spec said "`>=` needs
  nothing: pins only help satisfy it", which is false in the crowding direction:
  `Niza Sun.Choir >= 3` with the Choir rows pinned full is infeasible. Reproduced.

All three surfaced as `diagnose_infeasibility`'s generic message, which names a missing Lead
— the wrong cause — leaving the admin with no way to find the offending cell. So each is
skipped when its row is saturated by pins, on the same principle as the other four
exemptions, and §6 gains a notice naming the rule that was set aside.

**One consultation of the same exclusions that is easy to miss.** Weekly presence filters
its terms through `excluded_pwr` (`:727-741`), which is built from the same week-exclusion
rules. A pinned person who is unavailable would be filtered out of the terms they are
supposed to satisfy, so `excluded_pwr` excludes pinned triples too. Same principle as the
first row of the table, applied at its second call site.

`compute_absence_slack` (`:513`) is deliberately **not** adjusted: a pinned unavailable
person keeps the slack their absences earn them. It is slack they may not need, which is
harmless, and removing it would be a second rule about the same fact.

### 5.3 The response

`build_schedule_view` needs no change — pinned people are in `assignments` because they have
variables. `total_counts` / `role_counts` likewise include them.

**`origin` must not be restamped.** `applySolveResponse` writes `origin: "auto"` on every
cell it touches (`plannerModel.ts:930-935`). `origin` is per **cell**, so a cell holding one
pinned person and one solver pick is a real and common case, and there is no origin that
describes it. The rule is therefore: a cell that contains **any** pinned occupant keeps the
`origin` it had. This is what keeps §7's count of hand-placed seats honest. It does not
affect the instrument filler, whose ownership test is scoped to `instrumento:` rows
(`instrumentFill.ts:87`) which `applySolveResponse` never writes — a claim an earlier draft
of this spec got wrong in the other direction.

**Occupant order is not preserved.** `build_schedule_view` sorts each role's names (`:1168`)
and `applySolveResponse` rebuilds `occupants` from that list, so a pinned cell's occupants
come back alphabetised. The cell is therefore not byte-identical across a run even when its
membership is unchanged. That is acceptable — nothing downstream reads occupant order — but
it is why §11 asserts the occupant **set** and the `origin`, never the array.

**`unfilled_seats` renumbering.** Rows that grew have more slots, so `slot_index` shifts.
The client maps an unfilled entry by role and week, never by index (`:958-986`), so the
shift is invisible — but the count per row changes, and the tests pin that.

## 6. Conflicts: named on the board, never blocking

Computed on the client when the person is seated. Five cases:

| Case | Copy | Who renders it |
|---|---|---|
| The person marked that date unavailable | ⚠ Nombre: marcó que no puede este día — se va a respetar tu decisión | **New.** Nothing renders this today — see below. |
| A hard rule separates them from someone else in that service | ⚠ Nombre y Otro: una regla los separa — se va a respetar tu decisión | The existing violation marker, `ruleViolationsForColumn` |
| They are not in the pool that role draws from | ⚠ Nombre: no está en el pool de Lead — se va a respetar tu decisión | **New** |
| More people are pinned in the row than it has seats | ⚠ 3 personas fijadas en una fila de 2 lugares | **New** |
| The same person is pinned twice in one service | ⚠ Nombre está fijado dos veces en este servicio — solo se respeta el primero | **New**, and §4 says why it should be unreachable |
| The pins fill a row that a rule requires someone specific in | ⚠ Llenaste BGV del 13 sep y una regla pide a Hugo o Jakey ahí — se va a respetar tu decisión | **New**, §5.2 |

**The availability notice is genuinely new, and it is the one the requirement named.** It
does not exist today in any form: `blockingReasons` reads `PersonRestriction.weekExclusions`,
which are admin-authored rules (`ruleEnforcement.ts:372-383`), while member-declared
availability lives in `member.unavailableDates` and only becomes a DSL string inside
`buildSolveRequest` (`plannerModel.ts:796-806`). The two never meet, and the cell card
renders no availability line at all (`PlannerGrid.tsx:2861-2891`). Assuming the existing
amber covered it would have shipped E3's *guaranteed* collision silent.

**No consecutive-rule notice.** The rules panel cannot author a `!consecutive` clause
(`restrictionToDs`, `plannerModel.ts:572-599`), so a notice for it would be unreachable code
describing a rule no admin can create. §5.2 still exempts the constraint, because the DSL
parser accepts the form and a hand-edited document could carry one.

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
the discarded seats were placed by hand. A service-level clear is immediate; re-running Auto
is the undo.

No item is called «Todo», because none of them clears everything: FOH always survives (E6).
A label that promised more than it does is a defect this repo keeps recording.

**A clear routes through `handleCellsChange`.** Create mode derives `drafts` there
(`MonthGenerator.tsx:2467-2487`); a clear that called `setCells` directly would empty the
grid while «Crear N borradores» still posted the people just removed. The same pass drops
any `unfilled` marker on a cleared cell, which would otherwise outlive the seat it described —
and that is **new behaviour in a shared handler**: `handleCellsChange` does not touch
`unfilled` today, so the change is visible to every other caller and belongs in its own
review.

**Skipped columns are pinned like any other.** Auto deliberately ignores `skippedColumnIds`
(`MonthGenerator.tsx:2940-2945`); cells sitting on a skipped column are still occupied, so
the switch pins them. Intended, and stated because the alternative reading is just as
plausible.

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
runs the specials and instrument fillers (`MonthGenerator.tsx:2957-2994`). The refusal exit
does the same: the solver's voice roster is discarded, the local fillers still run, the error
line carries the message. "Nothing is applied" means the voice roster, not the setters.

**Local development cannot exercise this.** `callLocalSolver` spawns the repo's own
`gcf/owt_solver_v2.py` (`app/api/admin/solve/route.ts:69-108`), which always understands
`pinned`. The refusal path is provable only by the unit test in §11, and that is where it is
required.

## 10. Error handling

- A pinned person who resolves to no member cannot be pinned; `buildSolveRequest` already
  refuses a request naming an unresolvable person and that refusal is reused verbatim.
- A pin naming a week outside the month is a client bug, and the solver refuses it the way
  it already refuses an out-of-range week exclusion (`:679-683`): a `ValueError` naming the
  week, surfaced through the solver's ordinary error path.
- Stage A can still be infeasible for reasons unrelated to pins (no available lead). The
  diagnostic is unchanged. §5.1 and §5.2 together are what keep pins from being a new cause:
  rows grow rather than overflow, candidacy is granted rather than assumed, contradicting
  rules are exempted, and slack absorbs the fairness cost.
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
- **Fairness does not collapse, on a case that reaches the dangerous branch.** The guard pins
  enough of the month that a slack-based design would empty the `strict` group
  (`solve_schedule:1072-1074`) — twenty-six or more pins on a twelve-person month is the
  reproduced threshold — and asserts `fairness_relaxed: false`, a global spread over the
  solver's own choices matching the un-pinned baseline, and that an unavailable member's
  absence slack still applies. A guard that only pins a few seats passes under both designs
  and proves nothing.
- **A saturated row does not fail the month.** With `any_of(Hugo, Jakey) on Sun.BGV` in the
  rules, pin that row full for one week with neither of them: the month still solves. Same
  for both Saturday lead seats pinned with non-dedicated leads, and for a `>=` count rule
  whose row is pinned full.
- **A pinned person in no pool does not crash.** The reproduced `KeyError` at `:982`, kept as
  a guard: they are seated at their pin, appear nowhere else, and appear in `total_counts`.
- A pinned dedicated Saturday lead satisfies the anchor with no second dedicated lead forced
  in; a pinned group member satisfies weekly presence; a pinned assignment counts toward a
  DSL cap and the solver adds no more than the cap allows.
- Over-pinning a row is accepted: the row grows, nothing is dropped, no infeasibility.
- A request with no `pinned` key produces byte-identical output to today, on a fixed seed.

**Client.** `buildSolveRequest` emits one pin per occupied voice cell on a weekend column
when the switch is on, none when it is off, and none from a special column; it deduplicates
by person-and-service and reports the duplicate. The four new conflict notices render — the
availability one especially, since nothing renders it today — and none disables Auto or save.
The §9 refusal discards the voice roster, still runs the local fillers, and shows the
message. A cell holding a pinned occupant keeps its `origin`. The clears route through
`handleCellsChange`, empty exactly the rows their item names, never FOH, and drop the stale
`unfilled` markers; «Todo el mes» counts every column of the preview.

**Gates.** `npx tsc --noEmit`, `npm test`, `npx eslint .` with 0 errors, plus the solver's
own suite.

## 12. Documentation in the same delivery

`docs/SOLVER_AND_INFRA.md` — the `pinned` field, the fixed-variable mechanism, the three
enabling changes, the five exemptions, the handshake. `docs/MONTH_GRID_EDITING.md` — the
switch, the menu, the confirmation copy. One ADR: **pins are fixed variables with scoped
candidacy and fairness slack, not removed seats with constant offsets** — recording the
rejected design and the reproduced fairness collapse that ended it, so nobody re-derives the
elegant-looking version. No new secret or env var, so `docs/SECRETS.md` is untouched.

## 13. Rollout

The solver must be able to honor pins **before** the app can send them, or §9's refusal is
the only thing standing between an admin and a silent overwrite. Therefore: merge the solver
change first and confirm Cloud Build deployed it, then merge the app change. The
`preview`-first push order applies to the app half as usual, and the dev alias is verified by
`alias` + `githubCommitSha` before the PR to `main`.

**Said out loud: one Cloud Function serves both environments.** The solver half never reaches
`preview` first, so "merge the solver first" means it is live in production before any human
has watched it work. That is inherent to the existing architecture, not introduced here, and
what makes it safe is the guard §11 requires: a request with no `pinned` key must produce
byte-identical output to today on a fixed seed. Until the app starts sending pins, the
deployed change is inert for everyone.

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

Also out: pins for instrument or FOH seats — the instrument filler is client-side and
already leaves occupied cells alone. Any change to publication, to «Limpiar mes», or to the
participation sidebar. Persisting the switch across sessions. Auto on published services, in
any form or delivery.
