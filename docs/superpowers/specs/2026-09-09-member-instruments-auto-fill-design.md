# Declared instruments and automatic instrument fill — design spec

**Date:** 2026-09-09 · **Status:** Approved in chat by Frank 2026-09-09 (decisions D1–D6 below); written spec pending his review · **Risk tier:** standard
(a new optional field on `teamMembers`, a pure client-side filler, and a one-off
guarded backfill script; no production writer contract, serializer, auth boundary or
concurrency protocol changes — the solver is NOT touched). Pipeline: this spec → user
review → implementation plan → gates → fresh code review of the diff.

This is **delivery 1 of 2**. Delivery 2 — a «Solo llenar vacíos» switch for the voice
solver via pinned assignments in CP-SAT — is a separate spec with its own review and its
own Cloud Build deploy. Nothing here depends on it.

## 1. The brief

Frank's ask: the month generator should fill the instrument seats (he named pianos and
drums) automatically, alternating the players across services so that no two players of
the same instrument differ by more than one participation. To know who can take which
seat, each member of Tipo `instrumento` declares the instrument(s) they play.

## 2. What the repo says today

| Fact | Where |
|---|---|
| The seat vocabulary already exists and is closed against duplicates, not growth: `Bass`, `Keys`, `Drums`, `EG`, `AG`; piano is `Keys` | `app/components/admin/seatModel.ts:35-48` |
| A role document stores instruments as `instruments[]{ instrument, person }`; one seat per instrument name, no occupant cap, and 18 services run two drummers on one `Drums` seat | `sanity/schemas/sunRole.ts:56-82`, `seatModel.ts:57-66` |
| The CP-SAT solver knows five VOICE roles only (`ROLE_ORDER`); instruments and FOH are manual by design (D5) | `gcf/owt_solver_v2.py:37`, `candidateRanking.ts:7-11` |
| The only greedy filler is `localFill.ts`, and it fills `lead`/`bgv` on SPECIALS only (ADR-0010) | `app/components/admin/localFill.ts` |
| `handleAuto` overwrites every solvable voice row on every weekend column, then calls `applySpecialFill` on every exit, success or failure | `MonthGenerator.tsx:2964-3060` |
| Eligibility for an instrument seat is `memberType.includes("instrumento")` and nothing finer | `seatModel.ts:86`, `candidateRanking.ts:186` |
| Tipo is the ONLY eligibility axis; a second axis was removed after it drifted across three selection surfaces | ADR-0029 |
| Instrument participation is measured in WEEKS (`instrWeeks`: Saturday and Sunday of one weekend count once) | `app/utils/computeParticipation.ts:83` |
| `rankCandidates` already reads `unavailableDates` and `alreadyAssigned`; a member may hold a voice AND an instrument seat on the same service (D4: Frank, Mkz) | `candidateRanking.ts:171-190` |
| No member document carries any per-instrument information today | `sanity/schemas/worshipTeam.ts` |

## 3. Decisions (from the brainstorm, 2026-09-08/09)

- **D1 — Scope of the fill:** every instrument seat (`Keys`, `Drums`, `Bass`, `EG`, `AG`, and
  any future one) for which at least one member declares that instrument. Not only
  pianos and drums. A single declared bassist is simply seated every time.
- **D2 — Fairness unit and window:** per **service** (Saturday and Sunday are two
  participations), counting **only inside the month being generated**. Not the
  weekend-based `instrWeeks` and not the saved history window. Consequence, accepted:
  the participation sidebar keeps showing `instrWeeks`, so the number the filler balances
  and the number the team sees are different measures. Not changed by this delivery.
- **D3 — Trigger:** inside «Generar mes», after the solver's voice roster is applied.
  Fills **empty** instrument seats only; manual assignments stay and count toward the
  balance. No separate button.
- **D4 (kept) — Voice + instrument on the same service stays legal.** A member the solver
  seated as Lead/BGV/Coro is still a candidate for an instrument seat that day.
- **D5 — Backfill from history:** a one-off script derives each member's declared
  instruments from the seats they have actually held, dry-run first, `--apply` only with
  Frank's explicit consent.
- **D6 — Storage contract:** absent or empty `instruments` means "declares nothing".
  The filler never seats such a member; the manual picker still lists them for every
  instrument seat, marked as undeclared, so a human can override. This is a
  *refinement* of the `instrumento` Tipo — it is read only where a seat of that category
  is already in play — not a second eligibility axis (ADR-0029 §Decision).

## 4. Data: `teamMembers.instruments`

### 4.1 Schema (`sanity/schemas/worshipTeam.ts`)

```ts
{
  name: "instruments",
  title: "Instrumentos",
  type: "array",
  of: [{ type: "string" }],
  options: { list: [Bass, Keys, Drums, EG, AG], layout: "grid" },
  hidden: ({ document }) => !document?.memberType?.includes("instrumento"),
  description: "Qué instrumentos toca. Solo se lee para plazas de instrumento; vacío = no se asigna en automático.",
}
```

The `list` is built from `DEFAULT_INSTRUMENT_SEATS` so the two vocabularies cannot drift
(a test pins this). Studio schema deploy is part of the delivery (`sanity:deploy-schema`).

### 4.2 Write boundary (`app/api/admin/members/[id]/route.ts`, `app/api/admin/members/route.ts`)

`instruments` is accepted as `string[]`, each value passed through `normalizeSeatName`,
unknown names **rejected with 400** naming the offending value (the seat list is closed
for members even though it is open for services — a typo here would silently make a
member unschedulable). Duplicates collapse. An array is stored as sent, including `[]`
(unlike `ministries`, an explicit empty is a legitimate "declares nothing"). Not
ministry-scoped: the field is meaningful for worship only, but a kids-only member simply
never has `instrumento` in Tipo, so nothing reads it.

### 4.3 Reads

Every projection that already selects `memberType` for the planner and the admin panel
also selects `instruments`: `app/api/admin/members/route.ts`, `app/api/admin/roles/[id]/route.ts`,
`MonthGenerator.tsx`'s member fetch, `AdminPanel.tsx`. `RankMember` gains
`instruments?: string[]`. The `/me` page does not show it (not in scope).

### 4.4 Admin UI (`app/components/admin/AdminPanel.tsx`, member form)

A checkbox grid «Instrumentos» rendered directly under the Tipo grid, visible only while
`instrumento` is ticked. Unticking `instrumento` keeps the stored value (so re-ticking
restores it) but the PATCH still sends it unchanged — the form never clears a field the
admin did not touch. The member list shows the declared instruments as small chips next
to the Tipo chips.

## 5. Backfill: `scripts/backfill-member-instruments.mjs`

Reads every `sunday_role`, `saturday_role` and `special_role` (drafts excluded, `published`
irrelevant — a seat once held is evidence either way), groups
`instruments[].instrument` by `person._ref`, normalizes with the same `normalizeSeatName`
table (duplicated in the script, since `.mjs` cannot import the TS module; a test asserts
the two tables agree), and proposes a set per member.

- **Dry-run (default):** prints one row per member with Tipo `instrumento`: name, proposed
  set, per-instrument count of services backing it, and the current stored value. Members
  who held instrument seats but lack the `instrumento` Tipo are listed in a separate
  «no se escribe» section so Frank can fix Tipo first if he wants them.
- **`--apply`:** writes `instruments` only to members that (a) have Tipo `instrumento` and
  (b) have NO stored `instruments` field. Never touches a member with a value, even `[]`.
  Idempotent: a second run writes nothing.
- Runs as `node --env-file=.env.local scripts/backfill-member-instruments.mjs [--apply]`
  with the existing write token; no new secret.
- Recorded in the `scripts/` catalog in `docs/SOLVER_AND_INFRA.md` as one-shot, like
  `backfill-legacy-seat-arrays.mjs`.

## 6. The filler: `app/components/admin/instrumentFill.ts`

A pure module beside `localFill.ts`, with the same shape of contract, and — like it — never
to be described as the solver in the UI.

### 6.1 Input / output

```ts
export interface FillInstrumentsInput {
  columns: GridColumn[];   // the whole grid, all column types
  rows: GridRow[];
  cells: GridCell[];       // post-solve, post-special-fill grid
  members: RankMember[];
}
export interface FillInstrumentsResult {
  cells: GridCell[];       // merged; untouched cells survive by reference
  unfilled: { columnId: string; rowId: string }[];  // one per seat left empty
}
export function fillInstruments(input): FillInstrumentsResult;
```

### 6.2 Algorithm

1. Take the **weekend** columns (`sunday_role`, `saturday_role`) in date order.
   Specials are skipped (they stay manual, as their voices' Coro does).
2. For each column, for each row with id prefix `instrumento:` that `rowAppliesTo` the
   column and whose cell is **empty** (no occupants): the candidate pool is every member
   with `instrumento` in Tipo, the row's instrument in `instruments`, the date not in
   `unavailableDates`, and not already seated in **this row** on this column (they are
   not, the cell is empty — stated for the invariant). Being seated in a voice row or a
   different instrument row on the same column does NOT exclude (D4).
3. Order the pool by:
   1. **fewest instrument seats held this month** — counted over `working` (the grid as
      of this placement, manual occupants and this pass's own placements included), all
      instrument rows, weekend AND special columns, one per seat occupied;
   2. **did not play on the immediately previous weekend column** (any instrument row) —
      the alternation Frank asked for, so two equal-count players still swap;
   3. `member_name` `localeCompare("es")` — deterministic, so a re-run without changes
      reproduces the same roster.
4. Seat the first candidate with `origin: "auto"`, update `working`, continue. Target is
   1 per empty seat: a `Drums` row with two occupants already is not empty and is not
   touched; a row with zero gets exactly one.
5. An empty pool leaves the seat empty and pushes one `unfilled` entry. No relaxation, no
   second pass, no seating of an undeclared or unavailable member.

**Why the ≤1 bound holds:** with per-service counting and "fewest first", a player is
never chosen while another declared, available player of the same instrument has a
strictly lower count. The bound can only break where availability forces it (the
lower-count player was away), which is the correct exception.

DSL rules are not consulted: `ruleEnforcement` already documents that `*` never reaches
an instrument row, and no rule form names an instrument. Unchanged.

### 6.3 Insertion point (`MonthGenerator.tsx`)

`applySpecialFill(config, baseCells, solverUnfilled?)` is the single owner of
`setCells`/`setUnfilled`/`setDrafts` on every exit of `handleAuto`. `fillInstruments` runs
**inside it**, after the special loop and before the three setters, on the accumulated
cells, and its `unfilled` is concatenated with the special and solver ones. That way the
instrument fill happens on every exit (solver success, solver refusal, network throw),
exactly as the specials do today, with one owner of the three setters — the comment at
`MonthGenerator.tsx:2878` ("all three setters, at every exit") stays true.

The grid already marks every unfilled cell (`unfilledByKey`) and reports the total
(«Lugares sin cubrir (faltó gente): N»); instrument seats join both with no new UI.

## 7. Surfaces that learn the declared instrument

- **`rankCandidates`** (`candidateRanking.ts`): for a seat of category `instrumento`, a
  member whose `instruments` does not include the seat's label gets a new
  `undeclared: boolean` flag and sorts after declared candidates (a sort penalty, like
  availability — never a block, D6). The picker renders «sin declarar» on the row.
- **`occupantFitsSeat`** (`seatModel.ts`): takes the seat label as well as the category;
  for `instrumento` it answers `memberType ⊇ instrumento ∧ instruments ∋ label`. The
  PlannerGrid amber chip therefore also fires for "seated on Drums, does not declare
  Drums", naming the instrument. Voice and FOH behaviour unchanged.
- **`moveGate`**: unchanged. A drag target is judged by category; declared instrument is
  advisory, so a human may still drop an undeclared player on a seat and see the amber
  chip.

## 8. Error handling

- The filler is pure and cannot fail; a malformed member (missing `instruments`) is simply
  undeclared.
- The PATCH rejects unknown instrument names with 400 and the Spanish reason; the admin
  form surfaces it in its existing error line and resets its loading flag (the
  client-mutation invariant).
- The script refuses to run `--apply` without a write token, prints nothing destructive,
  and reports every write it made with the member name and the value written.

## 9. Testing

- `instrumentFill.test.ts`: balance ≤1 over a 5-Sunday month with 2 and 3 declared
  players; alternation when counts tie; unavailable player skipped and the bound
  broken only there; manual occupant respected and counted; a seat with two drummers
  untouched; empty pool → one `unfilled` entry per seat; specials never filled; voice
  seat on the same column does not exclude; deterministic re-run; untouched cells
  preserved by reference.
- `seatModel.test.ts`: the Studio `list` equals `DEFAULT_INSTRUMENT_SEATS`;
  `occupantFitsSeat` with label.
- `candidateRanking.test.ts`: `undeclared` flag and its sort position; no block.
- Members PATCH route test: normalization, 400 on unknown, `[]` stored.
- Script: a unit test over its pure grouping/normalization function with a fixture of
  role docs (the Sanity call is not exercised).
- Gates: `npx tsc --noEmit`, `npm test`, `npx eslint .` with 0 errors.
- Human-eyes on dev after the preview push (`dev-verify` for the planner grid and the
  member form), then the production alias check after the merge.

## 10. Documentation in the same delivery

- `CONTEXT.md`: the field, its contract, and that the instrument fill is local, not the
  solver.
- `docs/SOLVER_AND_INFRA.md`: filler section next to the specials filler; script in the
  catalog.
- `docs/adr/0029-…`: a short «Refinements» paragraph stating that `instruments` narrows
  the `instrumento` Tipo for instrument seats only and is read in exactly three places
  (`rankCandidates`, `occupantFitsSeat`, `fillInstruments`).
- No entry in `docs/SECRETS.md` — no new secret or env var.

## 11. Out of scope

- The «Solo llenar vacíos» switch for voices (delivery 2, pins in CP-SAT).
- Filling FOH seats, or instrument seats on specials.
- Showing declared instruments on `/me` or letting members edit them.
- Changing the participation sidebar from `instrWeeks` to per-service counts.
- Capacity guidance for two-occupant seats (existing behaviour kept).
