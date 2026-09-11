# «Solo llenar vacíos» — pinned assignments in CP-SAT — design spec

**Date:** 2026-09-10 · **Status:** Decisions E1–E8 approved in chat by Frank 2026-09-10; adversarial review pending · **Risk tier:** **critical**

Critical because two of the ladder's triggers are present. The request contract and the
hard constraints of a production solver change, and a new per-column gate decides whether
an automated filler may rewrite a stored role document — a gate whose failure mode is
overwriting a service the team has already seen. Requirement: **two sequential fresh
`APPROVED` verdicts on byte-identical text**.

This is **delivery 2 of 2**. Delivery 1 (declared instruments and automatic instrument
fill) shipped 2026-09-10 in PR #57 and is independent; nothing here changes it.

## 1. The brief

Frank, during delivery 1's brainstorm: «me gustaría tener una opción para que el solver
llene únicamente los espacios vacíos, en vez de sobre escribir todo». Today «Generar mes»
rewrites every solvable voice row on every weekend column, so a manual correction survives
exactly until the next Auto. He also asked for a delete control with a menu offering every
level of granularity, and for the whole thing to work on draft services, not only on a
month being previewed for the first time.

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
- **E7 — Auto and the clears are gated on the SERVICE's state, not the panel's mode.**
  They are available for a service that is a draft (`published === false`) and never for a
  published one. This replaces the create-mode-only rule. Frank asked for drafts explicitly
  on 2026-09-10 after the create-mode-only scope had been agreed; the gate moved rather
  than widening, because the earlier reason for the narrow scope — the fear of notifying
  the team — turned out not to apply to drafts.
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

**Identity.** Pins name people the way the rest of the request does, by resolved
`member_name` via `memberIdToName`. A pinned person who is in no pool is injected into
`support` exactly as DSL-named people already are (`buildSolveRequest`'s `extraSupport`),
so they exist in `all_people` and carry their own availability exclusions.

## 5. The solver: a pinned seat is not a seat

This is the whole mechanism, and its value is what it makes impossible.

**Slot construction.** `build_slots` emits, for each role and week, the seats that remain
after the pins: `max(0, seats_for_role - pins_for(role, week))`. Pinned seats never become
slots, so no `x` variable exists for them and no constraint can touch them.

**The pinned person enters as a constant, in exactly two places.**

1. **Participation count.** `total_vars[person]` gains the person's pin count for the
   month, the same shape `hist_total` already uses at `:772-776`. A pinned assignment is a
   real service and must weigh on fairness like one.
2. **Per-service occupancy.** The existing "one slot per service per week per person"
   constraint (`:754-765`) becomes, for a pinned person-service: the sum of their variables
   in that service is `0`. They are already seated there; the solver must not seat them
   again.

**What falls out with no further code.** No rule can break a pin, because a pin is not a
variable. A pinned seat never counts as empty, because it is not a slot and
`weighted_empty` sums over slots. Over-pinning is representable without error: pin three
leads where there are two seats and the role simply contributes no slots that week.

**The one constraint that needs an explicit offset.** "At least one Lead per service"
(`:654-659`) counts `filled` over lead slots. With a pinned lead there may be no lead slots
left to satisfy it. It becomes: enforce `sum(filled[lead slots]) >= 1` only when the
service has no pinned lead. A service whose lead is pinned already has one.

**What pins do NOT relax.** Rules keep governing every seat the solver still chooses. If A
is pinned and a pair rule separates A from B, B is pushed out of that service — the rule is
intact, it simply now has a fixed left-hand side. If two *pins* conflict with each other,
both stand, and the client's notice (§6) is the only consequence.

**`unfilled_seats` renumbering.** Pins shrink the slot list, so `slot_index` values shift.
The client maps an unfilled entry to a row and a date, never to an index
(`mapUnfilledSeats`, `plannerModel.ts:958`), so the shift is invisible — but the count per
row changes, and the tests pin that.

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

None of these blocks Auto, and none of them blocks saving. They exist so that a roster that
contradicts the rules is never silent.

## 7. The switch and the «Borrar» menu

**The switch.** A `Switch` labelled «Solo llenar vacíos» beside the Auto button, off by
default, with a one-line explanation: «Auto respeta lo que ya está puesto y solo llena los
lugares vacíos.» Its state is component state, not persisted — a per-run choice.

**The menu.** One `Button` labelled «Borrar» opening a `Menu`, with a live count on every
item so the admin sees what they are about to lose:

- **Este servicio** — Voces · Instrumentos · Voces e instrumentos
- **Todo el mes** (drafts only) — Voces del mes · Voces e instrumentos del mes

No item is called «Todo», because none of them clears everything: FOH always survives
(E6). A label that promised more than it does is the defect this repo keeps recording.

The same menu appears in each column's header with the scope fixed to that service. Only
the month-level items confirm, through `CueDialog`, and the confirmation names the count,
says FOH is preserved, says nothing is written until save, and separately counts how many
of the seats being discarded were placed by hand. A service-level clear is immediate;
re-running Auto is the undo.

**Naming.** Not «Limpiar mes», which already means deleting stored services from Sanity
(`clearMonthModel.ts`). «Borrar» here empties seats on the board and writes nothing by
itself.

**FOH** is absent from every bulk item by design (E6). It is still cleared one person at a
time in the picker, as today.

## 8. Where Auto and the clears are available

The gate is per column and has two conjuncts, both already computable:

1. `published === false` on the stored column (`storedRoleReadModel.ts:120`), which is the
   strict reading the repo's draft-gating rule requires — missing or `true` is
   member-visible and therefore out of bounds.
2. The existing stored-column admission check, unchanged, so a service whose data is
   incoherent stays read-only for this too.

A create-mode column has no stored document and is always eligible.

**A month mixes both.** «Todo el mes» means every DRAFT service of the month and says so in
those words; a published service is not counted, not cleared, and not touched by Auto. This
is the gate whose failure is worst — rewriting a roster the team has already seen — and it
is the first thing the adversarial review is asked to attack.

**Saving.** In stored mode Auto stages cells and marks those roles dirty; the admin commits
through the existing «Guardar N servicios», per document and revision-guarded. No new
writer is introduced, and nothing reaches Sanity on the Auto click itself.

## 9. The version handshake

`solve_from_dict` reads with `data.get(...)`, so a solver that predates this change accepts
a request carrying `pinned` and **ignores it silently**, returning a full roster that
overwrites the very seats the switch promised to keep. The solver and the app deploy
through different pipelines from the same merge — Cloud Build for `gcf/`, Vercel for the
app — so this state exists in the window between them, and again on any rollback of one but
not the other.

`SolveResponse` therefore gains `pinned_honored?: number`, the count of pins the solver
actually consumed. When the switch is on and pins were sent, the client **refuses to apply**
a response whose `pinned_honored` does not equal the number of pins sent, reports «El solver
no respetó los lugares fijados; no se aplicó nada» and leaves the board untouched. Refusing
is correct here even though §6 never blocks: §6 is about the admin's own contradictions,
this is about a solver that did not do what it was asked.

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
cells untouched. The clears empty exactly the rows their item names and never FOH. The
per-column gate: a published column offers neither Auto nor a clear, and «Todo el mes»
counts drafts only.

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

Pins for instrument or FOH seats — the instrument filler is client-side and already leaves
occupied cells alone. Any change to stored-mode publication, to «Limpiar mes», or to the
participation sidebar. Persisting the switch across sessions. Auto on published services,
in any form.
