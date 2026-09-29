# The planner: the trailing Saturday and «Solo llenar vacíos» — design spec (deliveries 2 and 3)

**Date:** 2026-09-29 · **Status:** draft for Frank's review · **Risk tier: standard** — client
consumers of solver contracts that are released (ADR-0041) or reviewed at critical tier in the
companion. Pipeline: this spec (self-reviewed, then Frank's review) → implement → four gates →
fresh diff review → re-verify fixes → `preview` → PR → `main`.

**Supersedes** `2026-09-15-fill-empty-only-client-design.md`. A 2026-09-29 audit found 25
confirmed drifts between that spec and today's code (two Auto paths, the 422 body now shown, a
single-line notice slot, duplicate occupants, the trailing Saturday); this file carries its
decisions forward and replaces its mechanics. Companion: `2026-09-29-solver-trailing-saturday-design.md`.

Contracts, not prescriptions: what the planner must do; helpers and line numbers belong to the plan.

## 0. What the code does today (verified 2026-09-29, `main` 1d50f9f3)

- **Two Auto paths.** `SOLVER_HISTORY_SOURCE = "derived"` in production: `handleAuto` hands off to
  `handleAutoDerived`, which reads the fairness history (≤ 20 s) and then runs
  `solveWithDerivedHistory` through a ref, so it reads `cells`/`solverConfig` from the LATEST render.
  The per-browser path in `handleAuto` is the rollback. Each path has its own `buildSolveRequest`,
  fetch, 422 parse and `applySolveResponse`.
- **Exits.** Every post-history exit calls `applySpecialFill` once; the derived path's month-changed
  and null-config exits call nothing.
- **Notices.** `AutoState.notice` is ONE string (PR #116), set to `omittedCapsNotice` before the fetch.
- **Refusals.** A 422 body now reaches the admin via `solverRefusalMessage` («… Motivo del solver: …»,
  English solver text).
- **Instruments.** `fillInstruments` vacates its own previous auto picks unless given `fillColumns`
  (then it fills exactly those columns and vacates nothing, PR #91).
- **Grid.** One member may sit twice in one cell (DD10); named chips (ADR-0045) carry per-occupant
  warnings in their aria-label; the create-mode grid stays editable while Auto is pending.

# Delivery 2 — the trailing Saturday becomes Auto's (after delivery 1 is deployed)

## 2.1 Decisions (Frank, 2026-09-29)

- **T1** — The trailing Saturday (last Sunday + 6, if still in the month) is staffed by the month it
  belongs to, as solver week `weeks + 1`.
- **T2** — It is preselected like every Saturday; deselecting it leaves it out.
- **T3** — Saturday minimums are judged **per person**: a Saturday-only floor (`isSaturdayFloor`) a
  person cannot reach this month is left out for that person, and the notice names them. This
  generalises PR #116's month-level rule (which becomes the case where everyone reaches zero).
- **T4** — Minimums that cannot all fit the month's Saturday seats: keep the floors of the people
  with FEWEST Saturdays in the derived history window, drop the rest, and name them.
- **T5** — If nobody in the Sunday-lead ∪ Saturday-lead pools can lead the trailing Saturday
  (unavailable that day, or excluded by a rule), it is not sent; the Sundays are solved and the
  Saturday stays manual, with a notice saying why.
- **T6** — `{weeks-N}` counts Sundays.

## 2.2 Contracts

- **One definition.** The trailing Saturday is computed from the month's FULL Sunday list
  (`sundayDatesFull`), never from the selected Sundays. `weekendWeekIndexes`, `saturdayForWeek`,
  `weekForColumn`, `applySolveResponse`, `mapUnfilledSeats`, `cellsToDrafts` and the pin mapping of
  delivery 3 all resolve it to week `weeks + 1` through that one definition, so a column, a seat, an
  unfilled marker and a pin can never disagree about its week.
- **When it is sent.** `weeks + 1` is in `weekends_with_saturday` iff the trailing Saturday is
  selected AND passes T5's lead check. The request is otherwise byte-identical to today's.
- **Availability.** A member unavailable on the trailing date gets `<name> !in week <weeks+1> Sat.*`
  — only when the trailing Saturday is sent, and never any rule derived from the next month's Sunday.
- **Per-person floors (T3/T4).** For each Saturday-only floor, a person's reachable Saturdays are the
  Saturdays sent this month minus the dates they are unavailable, minus week exclusions and
  `!in` patterns that cover the floor's roles. A floor above the person's reachable count is left out.
  The remaining floors must be jointly satisfiable against the Saturday seats (Lead floors against Lead
  seats a lead-pool member may take, BGV against BGV, `Sat.*` against either); when they are not,
  floors are kept in ascending order of the person's Saturday count in the derived history window
  (ties by name) while the kept set stays satisfiable, and the rest are left out. Everything left out
  travels in `omittedCaps` with its reason.
- **T5 lead check** uses the same eligibility the solver applies (pool membership after the Tipo
  filter, `!in` patterns, the date's availability, week exclusions); it is advisory — the solver
  remains the authority and its refusal still reaches the admin.
- **The «Fuera del alcance de Auto» surface.** Under T1 no real month has an unaddressable in-month
  Saturday; the badge, the confirm clause and the prop are removed, and D16's rationale is recorded as
  amended in the new ADR. (The confirm clause is already false today: instruments fill that column.)
- **Types.** `SolveResponse.schedule[w].Sunday` becomes optional.

## 2.3 Notices

`AutoState.notice` becomes a list, rendered in order under Auto, never replaced by a later write in the
same run: (1) floors left out, grouped by reason and named as the rules card names them (`capLabel`);
(2) the trailing Saturday not sent (T5) and why; (3) delivery 3's notices. PR #116's month-level
sentence remains the wording when no Saturday is sent at all.

## 2.4 Tests (vitest, derived-path harness `stubFetchWithHistory`)

- October 2026, only the 31st selected: `weekends_with_saturday` = `[5]`, the 31st's column maps to
  week 5, Tay's (unavailable) floor left out and named, Andy's and Vale's sent, the exclusion
  `… !in week 5 Sat.*` emitted, no rule for 1 Nov.
- All five Saturdays selected: `[1..5]`, every floor kept; T4 ordering with a crafted over-subscribed
  Saturday; a deselected trailing Saturday sends nothing new.
- T5: every lead candidate unavailable on the 31st → week 5 not sent, notice shown, Sundays solved.
- A month with no trailing Saturday: request byte-identical to `main`.
- `applySolveResponse`/`mapUnfilledSeats`/`cellsToDrafts` round-trip `schedule["5"]` with no Sunday.
- The removed badge: D16's pinned tests are updated with the amendment, not deleted silently.

# Delivery 3 — «Solo llenar vacíos» (independent of delivery 1; may ship first)

## 3.1 Decisions (Frank, 2026-09-10, re-confirmed 2026-09-29)

- **E1** — The switch preserves everything on the board, instruments included. **Every** occupied
  voice seat on a column Auto writes is sent as a pin — hand-placed or from a previous Auto (Frank,
  2026-09-29: «Todo lo que ya está») — and instrument seats are completed, never re-seated. Running
  Auto twice changes nothing; to re-shuffle Auto's own picks, clear them first with «Borrar».
- **E2** — The switch is off by default: a per-run choice, component state, not persisted.
- **E3** — When a pin contradicts a rule, the pin wins and the conflict is shown, never blocked.
- **E6** — One «Borrar» button with a menu, at two scopes — **Este servicio** and **Todo el mes** —
  each offering Voces · Instrumentos · Voces e instrumentos. FOH is never cleared in bulk (nothing
  refills it). The same menu sits in each column header, scoped to that service.
- **E7** — Create mode only.

## 3.2 Contracts

- **One seam, both paths.** Pin building, the request, the handshake and the instrument no-vacate are
  one shared step that both Auto paths call; the switch value and the pins are read inside the solve
  from the same render as `cells` (the derived path's ref), never from the moment Auto was pressed.
- **Locking.** While Auto is pending, the switch and every «Borrar» action are disabled, and — with the
  switch on — the create-mode grid is not editable, so «Auto respeta lo que ya está puesto» cannot be
  broken by an edit landing during the solve.
- **Pins.** From voice cells (Lead/BGV/Coro) of columns Auto writes (`weekForColumn` non-null — the
  trailing Saturday included once delivery 2 ships). Person = the member's `member_name` via
  `memberIdToName`. Deduplicated to distinct `(member_name, role, week)`. The same person in two seats
  of one service keeps the first by row order Lead → BGV → Coro, then occupant order; the others are
  dropped before sending and flagged on their seat. The switch off, or zero pins, OMITS `pinned` — the
  request is byte-identical to today's (the MCP P4 plan relies on this).
- **Refused before the fetch, in Spanish, naming the cell** (so the English solver text never has to
  explain them): an occupant id that resolves to no member; a member with an empty `member_name`; more
  than 100 distinct pins; two members whose names differ only in capitalisation or spacing where one is
  pinned-only; a Saturday pin on a week not sent (a deselected trailing Saturday).
- **Handshake (E8).** A success is applied only if `pinned_honored` is present and equals the number of
  distinct pins sent AND every pin appears in `schedule[week][Sunday|Saturday][Lead|BGV|Choir]` by exact
  name. Otherwise nothing is applied and Auto says «El solver no respetó los lugares fijados; no se
  aplicó nada.» (set directly, never through `solverRefusalMessage`; the two are exclusive per run).
- **Instruments.** With the switch on, `fillInstruments` runs with `fillColumns` = the weekend columns in
  date order — the existing no-vacate path, no second flag.
- **Waivers.** A cell containing any pinned occupant keeps its `origin`, `overrides` and
  `overrideReasons` (pruned to the occupants that came back) through `applySolveResponse`.
- **«Borrar».** Clears occupants and their waivers (`overrides`, `overrideReasons`) and drops the
  cleared cells' unfilled markers. Every item shows a live count. **Month** items confirm through a
  `CueDialog` — the count, FOH preserved, nothing written until «Crear N borradores», and an
  «aproximadamente» count of hand-placed seats (`origin` is per cell, so it is approximate both ways) —
  and re-plan against the LIVE cells when confirmed, never the plan captured when the dialog opened.
  **Service** items apply at once and raise a toast with «Deshacer», which re-applies only the cleared
  cells' prior state onto the live array through `handleCellsChange` and is withdrawn once Auto has run
  on that service.

## 3.3 What the admin is told

- **Pin conflicts, on the board, when the seat is filled** (client-computed, E3/E5): the occupant is
  unavailable that date; outside the pools the request sends for that role (Sat.Lead = Sunday ∪
  Saturday leads; BGV/Coro = any sent pool); a duplicate dropped. They tint the chip and join its
  aria-label in ADR-0045's precedence.
- **After Auto:** each `pin_violations` entry is parsed per ADR-0041's six forms, mapped back to the rule
  in the config and named as the rules card names it, with its week/service/date; an entry that does not
  parse or match renders one generic line. Whether a pin caused it is judged per family (count: a pin of
  that person on a matching role; pair: a pin of either person in that week+service; presence: a pin of a
  group member that week; consecutive: a pin of that person in either week; builtins: a pin in that
  service's Lead row). A consecutive Sun+Sat pin in one weekend reports two spans — the copy must not say
  «dos semanas seguidas». `violation_ceiling_proven: false` adds one caveat line. All of them append to
  the notice list (§2.3), after delivery 2's.
- **Confirm dialog, switch on:** all four parts say what Auto will do — voices fill empty seats only,
  instruments complete without re-seating, specials fill as today; the count is the empty voice seats on
  columns Auto writes.

## 3.4 Tests (vitest; Auto-driven cases on the derived path via `stubFetchWithHistory`, plus the refusal on the per-browser path)

- Switch off: request byte-identical to `main`, no `pinned` key. Switch on: pins exactly the occupied
  voice seats, deduped; a «Copiar a todo el mes» same-service double sends one and flags the other.
- Each pre-fetch refusal names its cell. The handshake refuses on a missing `pinned_honored`, a short
  count and a missing name, and applies nothing.
- Instruments: two Autos with the switch on leave instrument cells byte-identical.
- A switch-on month that also has left-out floors shows both notice groups.
- The switch and «Borrar» are disabled while pending; a toggle during the history read cannot change
  the pins sent.
- «Borrar»: each service and month item clears exactly its categories and their waivers, never FOH;
  the month confirm re-plans against live cells; «Deshacer» restores only the cleared service and is
  withdrawn after Auto.
- A switch-on month whose only lead is pinned elsewhere returns `ok: true` with
  `builtin:mandatory_lead` and a «Sin cubrir» lead seat, rendered.

# 4. Documentation (same delivery)

`docs/SOLVER_AND_INFRA.md` («Before the request leaves the planner»: trailing Saturday, per-person floors,
pins; drop «The client that sends pins … is a separate delivery»), `docs/MONTH_GRID_EDITING.md`,
`docs/UTILITIES_AND_COMPONENTS.md`, one ADR (next free number at merge time) recording T1 amending D16
and T3–T5, and the MCP P4 plan's needed amendment (below).

# 5. Out of scope, named

- **MCP P4** (`2026-09-28-owt-mcp-p4-solve-apply.md`, approved critical tier) mirrors
  `weekendWeekIndexes`/`unaddressableDates` and pins October's 31st as unaddressable; it must be amended
  and re-reviewed before P4 is implemented. Not edited here (its approval is on its current bytes).
- Stored-mode weekend Auto; the solver's English diagnostics; the objective overflow (fairness session).
- PR #116's documented «still hard» case — a Saturday minimum for someone unavailable on every Saturday
  the month sends — is no longer out of scope: T3 leaves that person's floor out and names them.
