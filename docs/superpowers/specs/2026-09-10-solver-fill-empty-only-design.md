# «Solo llenar vacíos» — pinned assignments in CP-SAT — design spec

**Date:** 2026-09-10 · **Status:** Decisions E1–E8 approved in chat by Frank 2026-09-10; adversarial review pending · **Risk tier:** **critical**

Critical because two of the ladder's triggers are present. The request contract and the
hard constraints of a production solver change, and a new per-column gate decides whether
an automated filler may rewrite a stored role document — a gate whose failure mode is
overwriting a service the team has already seen. Requirement: **two sequential fresh
`APPROVED` verdicts on byte-identical text**.

Delivery 1 (declared instruments and automatic instrument fill) shipped 2026-09-10 in
PR #57 and is independent; nothing here changes it.

**Scope split, 2026-09-10.** Frank asked that this also work on already-created draft
services. The round-1 review showed that half is not a missing paragraph but a second
design problem — stored columns are keyed by Sanity `_id` while unfilled markers are emitted
with a `create:` prefix, and the calendar state the request is built from belongs to create
mode — so it would arrive undesigned behind a half that had been reviewed. Frank chose to
split it (§14). This spec is create mode only; stored drafts get their own spec and their
own review.

## 1. The brief

Frank, during delivery 1's brainstorm: «me gustaría tener una opción para que el solver
llene únicamente los espacios vacíos, en vez de sobre escribir todo». Today «Generar mes»
rewrites every solvable voice row on every weekend column, so a manual correction survives
exactly until the next Auto. He also asked for a delete control with a menu offering every
level of granularity. He also asked for it to work on already-created draft services; that
half is deferred to its own delivery for the reason recorded above.

## 2. What the repo says today

Every row verified against the tree at `ae792034`.

| Fact | Where |
|---|---|
| Decision variables `x[(person, slot.key)]` exist **only** for people in `candidates[slot.key]`; a pin for anyone else has no variable to set | `gcf/owt_solver_v2.py:637-640`, `build_candidate_map` `:564-582` |
| Seats are positional and interchangeable — `Sun.Lead` #1 and #2 are the same role; the response serializes names into per-role lists | `build_slots` `:547-562`, `build_schedule_view` `:1142` |
| The DSL cannot express a pin: it has week-scoped ABSENCE (`!in week n`), month-scoped counts, and group weekly presence — no week-scoped "must serve" | `docs/SOLVER_AND_INFRA.md:37-44`, `parse_dsl_rules` `:227` |
| `solve_from_dict` reads every field with `data.get(...)`, so an **unknown key is silently ignored** | `gcf/owt_solver_v2.py:1194-1213` |
| Stage A raises on infeasibility and `diagnose_infeasibility` only knows how to talk about a missing mandatory lead | `:1117-1119`, `:1005` |
| History already enters the model as a **constant offset**, not a variable: `ov_total == total_vars[p] + hist_total[p]` | `:772-776` |
| Member unavailability is compiled into hard `!in week n Sun.*` / `Sat.*` DSL rules inside the same request | `plannerModel.ts:777-804` |
| Availability is **not** a block in the picker — it is a `+10` sort penalty, so an admin can and does seat an unavailable member | `candidateRanking.ts:200`, `:246` |
| Auto is create-mode only; the button is gated on `mode === "create"` | `PlannerGrid.tsx:1997` |
| A **draft service notifies nobody**: "A draft service queues nothing: it is admin-only until it is published, and publishing is what announces it" | `serviceMutationSideEffects.ts:335-345`, `:181-191` |
| Stored mode **stages** edits and writes them on an explicit «Guardar N servicios», per document, revision-guarded | `MonthGenerator.tsx:3893`, `touchedStoredRoleIds` `:1774`, `serializeStoredColumn` `:1791` |
| A stored column already carries its publication state, grandfathered: `published: role.published !== false` | `storedRoleReadModel.ts:120` |
| «Limpiar mes» already exists and means something else — it DELETES stored services from Sanity through `DELETE /api/admin/roles/[id]` | `clearMonthModel.ts:2-12` |
| `Menu`, `CueDialog` and `Button` exist as house primitives since M1 | `CLAUDE.md` Reusable utils |
| `weekForColumn` maps a weekend column to the solver's 1-based week; a special returns `null` | `plannerModel.ts:845-858` |
| `unfilled_seats` strings are `W{week} {service} {role_type} #{slot_index}` | `gcf/owt_solver_v2.py:987-990` |

## 3. Decisions

- **E1 — What the switch preserves: everything on the board.** With «Solo llenar vacíos»
  on, every occupied voice cell is pinned regardless of how it got there — a human pick, a
  previous Auto, or a stored draft loaded from Sanity. Frank chose this over "preserve only
  manual picks" (2026-09-10). The consequence is deliberate: re-running Auto on a full
  month does nothing until something is cleared. Clearing is the re-roll.
- **E2 — The switch is OFF by default.** Auto behaves exactly as it does today until the
  admin turns it on. No existing flow changes silently.
- **E3 — When a pin contradicts a rule, the pin wins, and the conflict is shown.** The
  board is a fact the human created; the solver works around it. The conflict is surfaced
  as a non-blocking amber notice, never a refusal. Frank, 2026-09-10: «gana el pin, pero
  sigue mostrando el aviso acerca del conflicto, no es algo que bloquea». This matters
  because one collision is *guaranteed*, not hypothetical: availability compiles to a hard
  `!in week n` rule while the picker lets an admin seat that same person anyway.
- **E4 — A pinned seat is not a seat.** The solver is never offered it, so no rule can
  break it. See §5.
- **E5 — Conflicts are computed on the client.** The grid already holds the rules, the
  availability and the pools, so the notice appears when the person is seated, not when
  Auto runs. The solver is not asked to explain conflicts.
- **E6 — One «Borrar» button with a menu**, at two scopes (the focused service, the month)
  across the categories the solver and the instrument filler can rebuild. FOH is never
  cleared in bulk: nothing refills it, so clearing it is guaranteed rework.
- **E7 — Auto and the clears stay where Auto already lives: create mode.** The Auto button
  is gated on `mode === "create"` (`PlannerGrid.tsx:1997`) and this delivery does not move
  that gate. Extending both to stored draft services is a separate delivery (§14). Nothing
  here reads or writes a stored role document, so no published service can be touched by
  construction rather than by a check.
- **E8 — The response must prove the pins were honored.** A silently-ignoring old solver
  is a real deployment state, not a hypothetical. See §9.

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
the board. A new DSL form would make an ephemeral fact durable, show pins in the rules
list, and put them through the name-validation path that 422s on an unknown person. The
third option — leave the solver alone and merge in the client, keeping manual cells and
taking the solver's output only for empty ones — is rejected outright: the solver would not
know about the pins, could seat the same person twice in one service, and would compute
fairness over a roster nobody will use.

**Identity, and why a pin never widens a pool.** Pins name people the way the rest of the
request does, by resolved `member_name` via `memberIdToName`. A pinned person must exist in
`all_people` so the counts can see them — but they must **not** be injected into a pool the
way DSL-named people are. `validate_config` sets `pools["Sun.BGV"] = pools["Sat.BGV"] =
pools["Sun.Choir"] = set(all_people)` (`gcf/owt_solver_v2.py:458-464`), so injecting a
person makes them a candidate for BGV and Coro in every service of the month, and the
global fairness spread then actively pushes the solver to seat them elsewhere.

The reachable harm is precise. The documented way to stop scheduling someone is to clear
their Tipo (CLAUDE.md, ADR-0029); that removes them from the picker but leaves them seated
in drafts already built. E1 would pin that seat, injection would make them a candidate
everywhere, and the next Auto would spread them across the month — the app undoing an
admin's deliberate removal. The DSL precedent does not cover this: a DSL name is a rule an
admin wrote, and `buildSolveRequest` already refuses a Tipo-less DSL name
(`plannerModel.ts:766-777`).

So the request carries pinned-only people in `all_people` and the solver subtracts them
from every pool. They are counted, never chosen.

## 5. The solver: a pinned seat is not a seat

A pinned seat produces no slot, so no `x` variable exists for it and no constraint can
touch it. That is what makes E3 true by construction rather than by care.

**It does not fall out for free.** Every mechanism in `create_model_and_solve` that
iterates slots or counts people has to be told about the pins, and the table below is the
complete enumeration — not an illustration. An implementation that handles the mandatory
lead and stops has broken at least four hard rules.

| Mechanism (`gcf/owt_solver_v2.py`) | Pin treatment |
|---|---|
| Decision vars `x` `:637-640`, `filled` `:644-652` | None needed: a pinned seat is not a slot. |
| Mandatory lead, `>= 1` per service `:654-659` | Enforced only when the service has no pinned lead. |
| `weighted_empty` `:661-676` | None needed: it sums over slots, and a pinned seat is not one, nor is it empty. |
| Week exclusions (availability) `:679-690` | Not applied to a pinned person-week. This is E3 made explicit — the admin already overrode availability in the picker — and it is the one relaxation in this table. |
| Saturday dedicated lead `:692-708` | Satisfied by a pinned dedicated lead. Without this the rule forces a *second* dedicated lead into the leftover seat, or goes infeasible when no other is eligible. |
| Pair exclusion `:711-722` | A pinned A forces every term of B to `0` in that service. The rule keeps its full force with one side fixed. |
| Weekly presence `any_of … each_week` `:727-741` | Satisfied for a week in which a group member is pinned into a matching role. |
| Consecutive `:744-751` | A pin in week W forbids the person's matching-role vars in W±1, and a pin in both W and W+1 is a conflict the client reports (§6), never an infeasibility. |
| One slot per service per person `:754-765` | A pinned person's vars in that service are forced to `0`. |
| `total_vars` `:770-774` | **Pins are NOT added here.** See below. |
| `ov_total` `:776-780` | Pins are added here, beside `hist_total`. Its domain grows to `total_slots + max_hist_total + max_pins`. |
| Global fairness spread `:783-797` | Unchanged — it reads `total_vars`. |
| `overall_spread` `:799+` and the objective | Sees the pins through `ov_total`. |
| Per-role spread `:860-884` | Unchanged — it reads `role_vars`, the solver's own choices. |
| DSL count rules `:886-897` | The cap on the solver's additions becomes `max(0, cap - pinned_count_for_that_role)`, so the month's real total never exceeds the admin's cap. A cap the pins alone already exceed is reported by the client (§6), never enforced into infeasibility. |
| `build_schedule_view` `:1142` | Pinned people are emitted in their role lists. See §5.1. |
| `total_counts` / `role_counts` `:983-986` | Include the pins, so the response is self-consistent with the roster it reports. |

**Why pins go into `ov_total` and not `total_vars`.** They are different shapes, and the
first draft of this spec got that wrong. `total_vars` feeds `model.Add(gmax - gmin <=
fairness_limit)` at `:795` — a **hard** constraint whose only tiers are 1 and 2
(`solve_schedule` `:1101-1115`). A half-filled month is this feature's entire use case, and
pinned counts there are routinely spread by three or more across the fairness group, so
pins in `total_vars` would make every Stage B tier infeasible and quietly return the
fairness-free Stage A result after burning the 40-second budget. `hist_total` enters
`ov_total` instead, which feeds `overall_spread`, a **soft** objective term at `:949`.
Pins belong with history: for this month's purposes they are already-decided fact, and they
should *inform* the optimiser without being able to make it fail.

### 5.1 The response must carry the pins back

`applySolveResponse` REPLACES a solvable cell — `occupants: ids.map(...)` for every row and
column the response names, with no merge against `previousCells`
(`plannerModel.ts:925-936`). Since a pinned person has no variables, they are absent from
`result.assignments` and therefore from the view, so a solver that merely "honoured" the
pins would hand back a roster that the client then writes over the pinned cells — deleting
exactly what the switch promised to keep, while `pinned_honored` reported success.

Therefore `build_schedule_view` emits pinned people in their role lists alongside the
solver's own picks, and the client's replace semantics stays untouched.

**`origin` is preserved, not restamped.** `applySolveResponse` writes `origin: "auto"`
today. A pinned cell whose occupant set comes back unchanged keeps the `origin` it had, or
a seat the admin placed by hand would be relabelled as the solver's — which would corrupt
both §7's count of hand-placed seats and `instrumentFill.ts`'s `origin === "auto"`
ownership test, whose whole job is telling its own picks from a human's.

**`unfilled_seats` renumbering.** Pins shrink the slot list, so `slot_index` shifts. The
client maps an unfilled entry to a row and a date, never to an index (`mapUnfilledSeats`,
`plannerModel.ts:958`), so the shift is invisible — but the count per row changes, and the
tests pin that.

## 6. Conflicts: named on the board, never blocking

Computed on the client, when the person is seated, by the machinery that already exists
(`ruleEnforcement.ts`, `rankCandidates`, the pool definitions). Four cases, each rendered
as an amber line on the cell in the shape ADR-0029 and the «Regla anulada» marker already
established — the colour says something is wrong, the line says who and what:

| Case | Copy |
|---|---|
| The person marked that date unavailable | ⚠ Nombre: marcó que no puede este día — se va a respetar tu decisión |
| A hard rule separates them from someone else in that service | ⚠ Nombre y Otro: una regla los separa — se va a respetar tu decisión |
| They are not in the pool that role draws from | ⚠ Nombre: no está en el pool de Lead — se va a respetar tu decisión |
| More people are pinned in the row than it has seats | ⚠ 3 personas fijadas en una fila de 2 lugares |
| The pins alone meet or exceed a hard DSL cap for that role | ⚠ Nombre ya tiene 2 lugares fijados en Lead y una regla le pone tope de 2 |
| The same person is pinned in consecutive weeks against a `!consecutive` rule | ⚠ Nombre: una regla le prohíbe semanas seguidas en BGV — se va a respetar tu decisión |

**How this composes with the amber already on the board.** `ruleViolationsForColumn`
(`ruleEnforcement.ts:479+`) already renders a violation for a seated pair conflict, and the
«Regla anulada» marker already records a deliberate override. These notices do not add a
second line for a fact already shown: where an existing marker covers the case, the pin
notice is that marker, and only the cases the existing machinery cannot express — the pool
mismatch, the over-pinned row, the cap, the consecutive pair — add a line of their own.

None of these blocks Auto, and none of them blocks saving. They exist so that a roster that
contradicts the rules is never silent.

## 7. The switch and the «Borrar» menu

**The switch.** A `Switch` labelled «Solo llenar vacíos» beside the Auto button, off by
default, with a one-line explanation: «Auto respeta lo que ya está puesto y solo llena los
lugares vacíos.» Its state is component state, not persisted — a per-run choice.

**The menu.** One `Button` labelled «Borrar» opening a `Menu`, with a live count on every
item so the admin sees what they are about to lose:

- **Este servicio** — Voces · Instrumentos · Voces e instrumentos
- **Todo el mes** — Voces del mes · Voces e instrumentos del mes

No item is called «Todo», because none of them clears everything: FOH always survives
(E6). A label that promised more than it does is the defect this repo keeps recording.

The same menu appears in each column's header with the scope fixed to that service. Only
the month-level items confirm, through `CueDialog`, and the confirmation names the count,
says FOH is preserved, says nothing is written until save, and separately counts how many
of the seats being discarded were placed by hand. A service-level clear is immediate;
re-running Auto is the undo.

**The Auto confirmation copy changes with the switch.** Today it reads «Esto reemplazará
toda asignación de voz (Lead, BGV, Coro) que el solver pueda resolver en este mes»
(`PlannerGrid.tsx:2035-2040`), which becomes false the moment the switch is on. With it on
the dialog says instead that Auto will fill only the empty seats and names how many. A
label that promises more than it does is the defect this spec already cites once.

**Naming.** Not «Limpiar mes», which already means deleting stored services from Sanity
(`clearMonthModel.ts`). «Borrar» here empties seats on the board and writes nothing by
itself.

**FOH** is absent from every bulk item by design (E6). It is still cleared one person at a
time in the picker, as today.

## 8. Where Auto and the clears are available

Create mode only, which is where Auto already lives (`PlannerGrid.tsx:1997`). The clears
are offered on the same columns Auto is, and both act on grid state alone: a create-mode
column has no stored document behind it, so nothing in this delivery can reach a service
the team has already seen. That safety property is structural, not a gate that could be got
wrong.

Nothing reaches Sanity until the existing «Crear N borradores» runs, unchanged.

## 9. The version handshake

`solve_from_dict` reads with `data.get(...)`, so a solver that predates this change accepts
a request carrying `pinned` and **ignores it silently**, returning a full roster that
overwrites the very seats the switch promised to keep. The solver and the app deploy
through different pipelines from the same merge — Cloud Build for `gcf/`, Vercel for the
app — so this state exists in the window between them, and again on any rollback of one but
not the other.

`SolveResponse` therefore gains `pinned_honored?: number`, the count of pins the solver
actually consumed. When the switch is on and pins were sent, the client **refuses to apply
the voice roster** from a response whose `pinned_honored` does not equal the number of pins
sent, and reports «El solver no respetó los lugares fijados; no se aplicó nada». Refusing is
correct here even though §6 never blocks: §6 is about the admin's own contradictions, this
is about a solver that did not do what it was asked.

Two details that decide whether the check works:

- **Pins are deduplicated before the count is taken.** The same person can legitimately
  appear once per row, but a duplicated occupant within one cell would inflate the sent
  count and fail the comparison on a correct solve.
- **The refusal is an exit of `handleAuto`, and obeys that function's contract.** Every
  exit calls `applySpecialFill` exactly once, which owns `setCells`/`setUnfilled`/`setDrafts`
  and also runs the specials and instrument fillers (`MonthGenerator.tsx:2940`). The refusal
  exit does the same: the voice roster is discarded, the local fillers still run, and the
  error line carries the message. "Leaves the board untouched" means the solver's voice
  output is not applied — not that the exit skips the setters, which would violate the
  documented contract.

## 10. Error handling

- A pinned person who resolves to no member cannot be pinned; `buildSolveRequest` already
  refuses a request naming an unresolvable person and that refusal is reused verbatim.
- Stage A can still be infeasible for reasons unrelated to pins (no available lead). The
  diagnostic is unchanged; pins cannot cause it, because they impose no constraint that can
  fail.
- The client-mutation invariant is unchanged: the Auto fetch keeps its try/catch/finally,
  its `res.ok` check and its loading-flag reset.
- A pin naming a week outside the month is a client bug, and the solver refuses it the
  way it already refuses an out-of-range week exclusion (`gcf/owt_solver_v2.py:679-683`):
  a `ValueError` naming the week, surfaced as the solver's ordinary error path.
- A clear never fails: it is local state.

## 11. Testing

**Solver (`gcf/test_owt_solver_v2.py`).** A pinned seat is not offered: the roster contains
the pinned person in that role and week, and the solver filled one fewer seat there. A pin
on an unavailable person succeeds while the same request without the pin excludes them —
the guaranteed collision of E3, proven end to end. A pinned lead satisfies the
mandatory-lead constraint with no lead slots left. Pinned assignments move the fairness
counts. Over-pinning a row is accepted and yields no slots. A request with no `pinned` key
produces byte-identical output to today, on a fixed seed.

**Client.** `buildSolveRequest` emits one pin per occupied voice cell on a weekend column
when the switch is on, none when it is off, and none from a special column. The four
conflict notices render and none of them disables Auto or save. The refusal of §9 leaves
cells untouched. The clears empty exactly the rows their item names and never FOH, and
«Todo el mes» counts every column of the preview.

**Gates.** `npx tsc --noEmit`, `npm test`, `npx eslint .` with 0 errors, plus the solver's
own suite.

## 12. Documentation in the same delivery

`docs/SOLVER_AND_INFRA.md` — the `pinned` field, the not-a-slot mechanism, the handshake.
`docs/MONTH_GRID_EDITING.md` — the switch, the menu, the per-column gate.
An ADR for the gate moving from panel mode to service publication state, and a second for
pins-as-constants over fixing variables and relaxing rules. No new secret or env var, so
`docs/SECRETS.md` is untouched.

## 13. Rollout

The solver must be able to honor pins **before** the app can send them, or §9's refusal is
the only thing standing between an admin and a silent overwrite. Therefore: merge the
solver change first and confirm Cloud Build deployed it, then merge the app change. The
`preview`-first push order applies to the app half as usual, and the dev alias is verified
by `alias` + `githubCommitSha` before the PR to `main`.

## 14. Out of scope

**Auto and the clears on already-created draft services — deferred to its own spec.** It
needs a stored-mode request builder (the weeks and Saturdays a stored month actually has,
not the create-mode calendar state), a column mapping in both directions (stored columns are
keyed by the Sanity `_id` at `storedRoleReadModel.ts:113` while `mapUnfilledSeats` emits
`create:${draftTargetKey(...)}` at `plannerModel.ts:1023`, so today every unfilled marker
would address a column that does not exist and vanish silently), an explicit treatment of
published services sitting inside the same month, and an answer for the fairness history,
which a stored-mode save does not record today — only `handleConfirm` does
(`MonthGenerator.tsx:3262`). That list is the starting point for its brainstorm.

Also out: pins for instrument or FOH seats — the instrument filler is client-side and
already leaves occupied cells alone. Any change to publication, to «Limpiar mes», or to the
participation sidebar. Persisting the switch across sessions. Auto on published services,
in any form or delivery.
