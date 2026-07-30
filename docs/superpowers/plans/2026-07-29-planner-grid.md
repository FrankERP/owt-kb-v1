# C · Planificador (planner grid) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task.

**Goal:** Replace `MonthGenerator`'s draft-card preview with one grid — dates across, seats down — where every cell is editable by hand and **Auto** runs the existing solver across the voice rows for the whole window.

**Architecture:** A regression harness first pins the create path that must not break. Then one pure module (`plannerModel`) holds the grid shape and the two translations to and from the solver's wire format, and one component (`PlannerGrid`) renders it. `MonthGenerator`'s config step, rule builder, preflight and create path are kept; the preview's rendering and the solver call's payload construction move.

**Tech Stack:** Next.js 16, React 19, TypeScript, Tailwind, vitest (node env; `@vitest-environment jsdom` per component test file), existing `/api/admin/solve`.

**Source spec:** [`docs/superpowers/specs/2026-07-29-service-team-editor-design.md`](../specs/2026-07-29-service-team-editor-design.md) §5.
**Predecessor:** Plan 1 (A · Tablero) is merged; `seatModel` and `candidateRanking` are reused.

## Global Constraints

- Done gate: `npx tsc --noEmit`, `npm test`, `npx eslint .` with **0 errors** (92 warnings are a deliberate backlog).
- Spanish UI copy.
- Dates at local noon: `new Date(iso.slice(0,10)+"T12:00:00")`. Never bare `new Date(iso)`.
- Timezone America/Mexico_City; "today" via `toLocaleDateString("sv",{timeZone:"America/Mexico_City"})`.
- Sanity array-of-object writes need a `_key` per item.
- Conventional commits; body explains the why. Never add AI/Claude attribution or `Co-Authored-By` trailers.
- Branch off `main`; never commit to `main` directly.

---

## Load-bearing facts, verified against source

1. **Solver is voices-only, 3–6 weeks.** `gcf/owt_solver_v2.py:37` (`ROLE_ORDER`), `:450`.
2. **Voice seats are MULTI-OCCUPANT.** `build_slots` (`:547-561`): per week 2 × `Sun.Lead`, 3 × `Sun.BGV`, 3 × `Sun.Choir`; on Saturday weeks 2 × `Sat.Lead`, 3 × `Sat.BGV`. Response fields are arrays.
3. **The solver has no pre-assignment field.** `ScheduleConfig` (`:87-107`). Pins are nonetheless *expressible by composition* — `P !in week k <role>` for every k≠w (`:259`, patterns include role types at `:59-65`) plus `P <role> >= 1`, a hard constraint (`:887-897`). See D1 for why this is rejected rather than impossible.
4. **One slot per person per service per week** is enforced internally (`:754-764`), so any client merge of solver output with hand-set cells can produce the same-category double booking `candidateRanking` blocks (`candidateRanking.ts:134-137`).
5. **People are identified by NAME**; pools must be mutually exclusive (`:452-454`); an unknown name in a DSL rule raises (`:278-280`).
6. **Response is per-week, 1-based**, Saturdays nested in the week object (`:1131-1169`, `app/api/admin/solve/route.ts:30-33`).
7. **`weekends_with_saturday` is a list of 1-based WEEK INDEXES, not dates** (`:185-194`, `app/api/admin/solve/route.ts:12`). The Python dataclass field is `weekends_w_sat` (`owt_solver_v2.py:90`) but the **JSON key is `weekends_with_saturday`**, read at `:1195` as `data.get("weekends_with_saturday", [])` — a **silent `[]` default**, so any drift yields a month with zero Saturday assignments and no error. `buildSolveRequest` must return a literal typed `SolveRequest` so `tsc` catches the drift.
8. **The Saturday↔week rule is ADJACENCY on Sundays, both directions.** Request: `weekends_with_saturday = [i+1 for each sundayDates[i] whose previous day is a selected Saturday]` (`MonthGenerator.tsx:1242-1252`). Response: week `n`'s Saturday is `subtractDay(sundayDates[n-1])`, kept only if that date is a selected Saturday of the month (`:1364-1377`). There is also a positional fallback at `:1249-1251` that fires when no Saturday is adjacent to any Sunday.
9. **Creation is preflight-gated and idempotent.** `handleConfirm` (`MonthGenerator.tsx:1404`): filters on `preflight(...)==="creatable"` (`:1411-1414`), **re-observes at confirm time and aborts on any drop** (`:1420-1431`), posts via `runDraftCreateBatch` with stable per-draft `creationRequestId` (`:1440-1459`), marks only confirmed successes `exists` (`:1465-1466`).
10. **`preflights` is keyed by `draft.localId`** (`:1485-1490`).
11. **`handlePreview` does five things beyond sending pools:** injects `extraSupport` for DSL-named people absent from pools (`:1266-1279`); synthesises `!in week N Sun.*/Sat.*` from `unavailableDates` (`:1281-1302`); refuses with "Debes seleccionar al menos un líder de domingo" (`:1317-1320`, also 400'd at `app/api/admin/solve/route.ts:129-131`); persists a fairness history entry keyed `${year}-${month}` and feeds `history` back (`:1179-1189`, `:1311-1314`, `:1383-1385`); and builds the "No disponibles este mes" notices (`:1622-1643`).
12. **`weeks = sundayDates.length`, unconditional on the Domingos toggle** (`:1240`). Unchecking Domingos with the solver on therefore **works today**: the solve runs on the real Sunday list, Sunday drafts are dropped by `if (sundays && sunDate)` (`:1351`) and Saturday drafts are kept (`:1364-1377`). Saturdays are addressable precisely *because* they are indexed relative to Sundays.
13. **`activeSatDates` is appended in click order, not sorted** (`:1539-1542`).
14. **NO seat is capped, in any category.** `MonthGenerator.tsx:1029-1031`; `seatModel.ts` — every `SeatDef` carries `max: null`. Instrument seats briefly carried `max: 1`; that shipped as a data-loss bug and was reverted in `c2b2fa7`.
14b. **The team runs TWO DRUMMERS on one `Drums` seat.** Verified by read-only GROQ against production: 18 of 27 role documents hold two `Drums` slots with two different people — every service from 2026-06-07 to 2026-08-30, 13 of them `published: true`. Both members are typed `instrumento`, so this is a modelling fact, not an eligibility question. `monthDraftCreate.ts:57` keeps both slots and `SlotEditor2` (`MonthGenerator.tsx:1032`) can create them today.
15. **`rankCandidates` derives `load` and `recent` entirely from `windowRoles`** (`candidateRanking.ts:82`, `:101`, `:104-111`). `MonthGenerator`'s role prop is `ExistingRole { _id; _type; date }` (`:24`) — **no assignment data**. `SeatBoard` receives a bounded, anchored slice (`ServicesPanel.tsx:114-130`, `CANDIDATE_LOAD_WINDOW_DAYS = 56`).
16. **`copiar instrumentos a otro día` copies between EXISTING services** server-side under a capability gate with revision guards (`ServicesPanel.tsx:811-849`). Not part of the preview; not replaced here.
17. **`DayCard` is today the only surface flagging one person twice across Lead/BGV/Coro** (`DayCard.tsx:69-75`, `:234-236`).
18. **`unfilled_seats` strings parse to week/service/role** (`app/utils/unfilledSeats.ts:30`). `SEAT_RE` matches the trailing `#N` but does **not capture** it, so a seat string resolves to a row and a date, never to a specific occupant slot.
19. **There is no `MonthGenerator` test today.**
20. **The generator's surface is a `max-w-4xl` dialog whose body scrolls.** `ServicesPanel.tsx:1713` mounts it in `<Modal wide>` **without** `ownScroll`, so the body is an `overflow-y-auto` container (`:195-206`); `Modal` → `CueDialog size="lg"` → `max-w-4xl`, `max-h-[min(86svh,52rem)]` (`CueDialog.tsx:95-98`, `:126-131`). `CueDialog` has no size above `lg`.
21. **`published: true` on create makes the month member-visible AND queues assignment emails** (`app/api/admin/roles/route.ts:268-285`). The preview footer calls `handleConfirm(false)` and `handleConfirm(true)` (`MonthGenerator.tsx:1698-1703`), and `gateBlocked` refuses both (`:1407`).
22. **The solver has no `Sat.Choir`** (`:547-561`), so a Coro row can never be filled on a Saturday column.

## Decisions

| # | Decision |
|---|---|
| D1 | **Auto overwrites every voice cell in the window; there is no pinning.** Pins are expressible by composition (fact 3) but rejected: each pin adds an exclusion rule per remaining week, cannot target a slot index, and an over-constrained model fails as *infeasible* rather than degrading — on a solver already budgeted to 40 s on a fractional vCPU (`:104-107`). Confirmed with the user after the possibility was established. |
| D2 | Auto asks for confirmation first, naming what it will replace. Hand edits after a run persist until the next run. |
| D3 | **Every cell is multi-occupant** — `memberIds: string[]` — voice *and* instrument *and* FOH. Fact 14b: two drummers on one `Drums` seat is the normal case on 18 services. The write path already supports it (`SeatBoard.tsx:167-174` flat-maps one slot per occupant), and `cellsToDrafts` must too. |
| D4 | The grid operates only on **uncreated drafts**. Editing existing services is A · Tablero's job. |
| D5 | Instrument and FOH rows are always manual, and say so persistently, so a blank Bass row after Auto never reads as a solver failure. |
| D6 | **Capacity is Auto's fill target, never a limit, in any category.** Rows warn above their target and always accept. No cell ever replaces an existing occupant — that behaviour is exactly what evicted a drummer in `c2b2fa7`. An occupant leaves only when someone removes them. |
| D7 | **Cell density:** a cell renders alias-only (`dn`), at most 2 names, then **`+N` as a focusable control that opens the cell** — not a `title` hover hint. The iOS build is an online wrap of the hosted app (`capacitor.config.ts` `server.url`), so `title` never fires on touch and a hover-only affordance hides the very information the user said was hidden. |
| D8 | The window is the **calendar month**, so `weeks` is always 4 or 5 and `solvableWindow`'s 3–6 guard is a defensive assert, not a reachable path. Resolves spec §12's open item. |
| D9 | **Unchecking Domingos keeps working exactly as it does today** (fact 12): `sundayDates` is computed for the solve regardless of the toggle, Auto runs, Saturday columns are filled, and Sunday columns are simply not rendered. The previous draft of this plan claimed `weeks` would be 0 and disabled Auto — that contradicted fact 12 and would have removed a working capability. |
| D10 | **The grid does not live in the dialog.** `CueDialog` stops at `max-w-4xl` (fact 20) and August 2026 is **10 columns** (Sun 2/9/16/23/30 + Sat 1/8/15/22/29) — roughly 75 px each after the row gutter, in a box that also scrolls vertically. A wider size token was considered and rejected: still too narrow at 10 columns, and widening a shared token risks every other dialog. The generator mounts as a **full-width panel inside the Servicios tab**. This is the decision that answers "I have to scroll through a really small window", so it is settled **before** Task 3, not deferred to Task 4. |
| D11 | **Row applicability is per column type.** A Coro row renders only on Sunday columns (fact 22 — the solver has no `Sat.Choir`, so a Saturday Coro cell could never be filled and would read as the solver failure D5 exists to prevent). |
| D12 | **Ranking sees the grid's own drafts — for `load` only.** `rankCandidates` derives both `load` and `recent` from `windowRoles` (fact 15), and `recent` takes `[...new Set(weekKeys)].sort().slice(-weeks)` with `weeks` defaulting to 4 (`candidateRanking.ts:87`, `:104`). Concatenating the grid's 4–5 future weeks onto the history window would make `slice(-4)` return *the grid's own weeks*, and the strip would stop showing history entirely. So: **`load` from the union (saved window + in-grid drafts), `recent` from the saved window only.** |

---

## File Structure

| File | Responsibility |
|---|---|
| `app/components/admin/__tests__/MonthGenerator.create.test.tsx` | **Create (Task 1).** Locks the create path before anything moves. |
| `app/components/admin/plannerModel.ts` | **Create (Task 2).** Rows, cells, `buildSolveRequest`, `applySolveResponse`, `cellsToDrafts`. Pure. |
| `app/components/admin/PlannerGrid.tsx` | **Create (Task 3).** Renders the grid; decides nothing. |
| `app/components/admin/MonthGenerator.tsx` | **Modify (Task 4).** Preview renders `PlannerGrid`; payload construction moves; `DraftCardEditor` retired. |
| `docs/UTILITIES_AND_COMPONENTS.md` | **Modify (Task 4).** |

---

### Task 1: Regression harness for the create path

Fact 19: there is no `MonthGenerator` test. Everything in fact 9 is safety-critical and about to be disturbed. Pin it **before** touching anything, so later tasks have a net rather than a promise.

**Files:** Create `app/components/admin/__tests__/MonthGenerator.create.test.tsx` (jsdom, mocked `fetch`, injected `preflight`).

Task 4 deletes `DraftCardEditor` and rewrites the preview, and declares this harness its acceptance test. For "must still pass unchanged" to be realizable, these tests query **only** by accessible role/name on affordances that survive the rewrite — `Previsualizar →`, `Crear`, `Crear y publicar`, `Cancelar` — and never by a `DraftCardEditor` internal.

**Tests — each must fail if the behaviour is removed:**
- Only `creatable` targets are posted; a `blocked` one is not.
- A candidate that stops being `creatable` between preview and confirm **aborts the whole batch** and posts nothing; the error names how many dates dropped.
- Each posted draft carries its own stable `creationRequestId`; a retry after a failure re-posts the failed draft **with the same id** and does not re-post the succeeded one.
- Only confirmed successes are marked `exists`.
- **"Crear" posts `published: false` for every draft in the batch; "Crear y publicar" posts `published: true`** (fact 21). This is the highest-blast-radius parameter in the create path — `published: true` makes the month member-visible *and* queues assignment emails — and Task 4 treats this harness as its acceptance test, so a mis-wired flag would otherwise be unprotected while the footer is rewired.
- `gateBlocked` refuses `handleConfirm` outright and posts nothing (`MonthGenerator.tsx:1407`).
- "Debes seleccionar al menos un líder de domingo" refuses before any `/api/admin/solve` call (fact 11).
- A successful solve writes a fairness history entry under `${year}-${month}`; a second solve in the same month **replaces** it rather than appending (fact 11 — last-write-wins is the existing behaviour and must stay deliberate).

---

### Task 2: `plannerModel` — grid shape and solver translation

**Files:** Create `app/components/admin/plannerModel.ts`; test `app/components/admin/__tests__/plannerModel.test.ts`.

**Produces:**
- `type CellOrigin = "manual" | "auto" | "empty"`
- `interface GridCell { date: string; rowId: string; memberIds: string[]; origin: CellOrigin }`
- `interface GridRow { id: string; label: string; category: SeatCategory; solvable: boolean; target: number | null }`
- `buildRows({ instrumentSeats, fohSeats }): GridRow[]`
- `seatDefForRow(row: GridRow): SeatDef` — `rankCandidates` takes a `SeatDef` and filters on `seat.memberType` (`candidateRanking.ts:79`, `:127`), which `GridRow` does not carry. Map via `VOICE_SEATS` / `instrumentSeatDef` / `fohSeatDef` rather than re-deriving.
- `buildSolveRequest({ config, members, sundayDates, activeSatDates, history }): { ok: true; request: SolveRequest } | { ok: false; reason: string }`
- `applySolveResponse({ response, previousCells, rows, sundayDates, activeSatDates, members }): { cells: GridCell[]; unresolvedNames: string[]; counts: { total_counts; role_counts } | null }` — **takes the current grid and returns the MERGED grid.** Without `previousCells` it has no instrument or FOH cells to preserve, the D5 test below can only assert the absence of an input that never existed, and the natural implementation returns a voice-only grid that wipes every hand-entered Bass/Keys/Drums/Console cell in the month on one Auto press.
- `cellsToDrafts(cells, previous, existingRoles): DraftCard[]` — `exists` and `skipped` seed from `existingRoles` today (`MonthGenerator.tsx:1208-1209`, `:1355-1356`, `:1370-1371`), and `Props.preflight` is optional (`:70`) with `!d.exists` as the standalone fallback (`:1413`, `:1494`). Without `existingRoles` an already-created date arrives un-skipped and posts again.
- `solvableWindow(sundayDates): { ok: boolean; weeks: number; reason: string | null }`
- `unaddressableDates(sundayDates, activeSatDates): string[]`
- `mapUnfilledSeats(seats, sundayDates, activeSatDates): { date: string; rowId: string }[]` — `summarizeUnfilledSeats` (`unfilledSeats.ts:32-62`) returns `{week, service, labels}` with the role already collapsed to Spanish and no date, so the grid cannot place them. Extend `unfilledSeats.ts` to expose the role rather than re-implementing `SEAT_RE` in the component (CLAUDE.md: don't reinvent shipped utils). Note `SEAT_RE` matches the trailing `#N` without capturing it, so a seat resolves to a row and a date, never to an occupant slot.
- `weekendWeekIndexes(sundayDates, activeSatDates): number[]`
- `saturdayForWeek(n, sundayDates, activeSatDates): string | null`

**Tests:**

*Shape*
- `buildRows`: Lead/BGV/Coro `solvable: true` with `target` 2/3/3; instrument and FOH rows `solvable: false`, `target: 1`. `target` is Auto's fill target, never a limit, in any category (D6).
- A Coro row is applicable to Sunday columns only (D11); an instrument or FOH row is applicable to both.
- `cellsToDrafts` round-trips a Sunday with 2 Leads, 3 BGVs and 3 Coro into the draft's five seat arrays unchanged, and back.
- **`cellsToDrafts` round-trips ONE `Drums` row holding TWO members into TWO `instruments[]` slots**, both with `instrument: "Drums"` (fact 14b). This is the normal case on 18 production services; a model that collapses it is a create-path regression.

*Saturday mapping — fact 8, both directions, adjacency not position*
- **February 2026** (Feb 1 Sunday, Feb 28 Saturday): with all Saturdays selected, `weekendWeekIndexes` returns `[2,3,4]`; `saturdayForWeek(2,…)` is `"2026-02-07"` (**not** `"2026-02-14"`, which is what indexing `activeSatDates` positionally would give); `unaddressableDates` returns exactly `["2026-02-28"]`.
- `activeSatDates` supplied out of order (fact 13) produces the same result as sorted input.
- The positional fallback (fact 8, `:1249-1251`) is reachable only when the single selected Saturday is a month-final unadjacent one. Assert the concrete outcome rather than characterising it: the fallback asks the solver to staff week 1's Saturday, whose date resolves out of month and is discarded at `:1366` — so fairness is consumed for a service that is never created. The test asserts exactly that, and that `unaddressableDates` reports the date rather than dropping it silently.

*Request construction — fact 11*
- Every person named in any DSL rule but absent from all three pools is injected into `support`; the default config (whose rules name Frank, Mkz, Gaby, Lucía, Liu, Marianne, Hugo, Niza, Jakey — `MonthGenerator.tsx:160-209`) yields a request in which **every DSL-named person appears in exactly one pool**. That is the shape assertion a unit test can make; "the solver accepts it" cannot be asserted without running the solver. Omitting the injection is a 422 in production.
- A member unavailable on a Sunday in the window yields `!in week N Sun.*`; the Saturday case yields `Sat.*`.
- **Only POOL members generate availability rules.** `MonthGenerator.tsx:1288` loops `allPoolIds`; a rule naming a non-pool member makes the solver raise "unknown person" (`gcf/owt_solver_v2.py:278-280`) and 422 the whole month. Test that an unavailable non-pool member produces no rule.
- Pools are mutually exclusive after construction (fact 5).
- No Sunday leads selected → `ok: false` with the Spanish reason, **no API call**.
- `weeks` outside 3–6 → `ok: false` (D8 makes this defensive).

*Response mapping*
- Only `solvable` rows are written; a response naming a non-solvable row is ignored and reported.
- Every written cell has `origin: "auto"`.
- **Instrument and FOH cells survive a run byte-for-byte.** Seat `Drums` with two members on two dates, run `applySolveResponse`, assert both cells return with the same `memberIds` and `origin: "manual"`, and that only voice cells changed. Same failure class as the eviction fixed in `c2b2fa7`, at month scale.
- An unmatched name leaves the cell empty and appears in `unresolvedNames`.
- `counts` carries `total_counts`/`role_counts` through, so Task 4 can persist history (fact 11).

*Stability*
- **A new Auto run mints new `creationRequestId`s**, matching today's behaviour (`handlePreview` mints fresh ids at `:1354`, `:1369`; `monthDraftCreate.ts:8` — "only a genuinely new preview mints new ids"). Reusing an id across a changed roster surfaces as `idempotency_mismatch` (`roleWriteRequest.ts:696-698`). Ordinary re-renders do not mint.
- `cellsToDrafts` preserves `localId`, `creationRequestId`, `exists` and `skipped` across repeated calls for the same date and type (fact 10 — a fresh `localId` makes every `preflights.get` miss, so nothing is creatable and the result is "0 por crear"; a lost `exists` re-opens an already-created date for posting).

---

### Task 3: `PlannerGrid` — the grid component

**Files:** Create `app/components/admin/PlannerGrid.tsx`; test `app/components/admin/__tests__/PlannerGrid.test.tsx` (jsdom).

**Props include `windowRoles: ParticipantRole[]`** — fact 15. `MonthGenerator` does not have this today; Task 4 threads it from `ServicesPanel`, which already holds full `ServiceRole[]`. Anchor rule for a grid with no single date: **one window anchored at the first Sunday of the month, reaching back `CANDIDATE_LOAD_WINDOW_DAYS`**, reused for every column, so ranking is stable across the month rather than shifting per column.

**Ranking must also see the grid's own drafts** (D12). The component synthesises the current cells into `ParticipantRole` shape and concatenates them with the saved window before calling `rankCandidates`. Without this, the assignments just made in columns 1–4 are invisible while filling column 5 and the same person tops the list five times — the precise signal the grid exists to give.

**Requirements, each asserted:**
- Rows from `buildRows`, columns from the window's dates. Horizontal scroll on the grid container only; no scroll region nested in another.
- Clicking a cell opens the ranked list via `rankCandidates`, with `assigned` built from **that date's whole column**, so the same-category rule holds per service and fact 17's duplicate detection is carried into the grid.
- **A member who served recently sorts below one who did not** — the test that would fail if `windowRoles` were passed empty (fact 15's silent failure).
- **A member assigned earlier in THIS grid sorts below one who was not** — the test that would fail if D12's in-grid synthesis were dropped.
- **The `recent` strip still shows history, not the grid.** Assert the *contents* of `recent` for a member who served historically but appears nowhere in the grid: their strip is non-empty. Sort-order tests cannot catch this, because ordering is driven by `load` (`candidateRanking.ts:156`), so both tests above pass while the strip is silently wrong.
- **Column sizing, asserted the way jsdom can.** vitest runs `environment: "node"` with per-file jsdom and no browser mode, and jsdom performs no layout — `getBoundingClientRect`, `offsetWidth`, `clientWidth` are all zero — so a pixel budget is unimplementable as a unit test. Assert instead: the grid container carries `overflow-x-auto`; every column carries a `min-w` class so columns scroll rather than compress; no scroll region is nested inside another (the invariant `SeatBoard.test.tsx:146-156` pins by class containment). The 10-column appearance is checked once by screenshot in Task 4 and the result recorded there.
- **Warnings fire on solvable rows only.** `target: 1` on an instrument row would warn on the two-drummer setup, i.e. on 18 of 27 services (fact 14b) — a warning that is right two-thirds of the time is noise. Non-solvable rows carry no threshold.
- Above `target`, a voice cell warns and still accepts (D6). **No cell ever replaces an existing occupant** — a test seats two people on one `Drums` row, adds a third, and asserts all three survive (fact 14b, and the bug fixed in `c2b2fa7`).
- A Coro row is not rendered on Saturday columns (D11).
- Cells render alias-only, at most 2 names, then `+N`, with the full list in `title` (D7).
- **Auto** disabled with a visible reason when `solvableWindow` says no.
- **Domingos unchecked, Saturdays selected: Auto is ENABLED**, the run produces Saturday cells, and no Sunday column renders (D9, fact 12). A positive test, not an absence — an earlier draft disabled Auto here and would have shipped a regression.
- **Auto confirms first** (D2), naming that it replaces every voice assignment **the solver can address** — an unaddressable Saturday (Feb 28 in Task 2's fixture) is never in the response and its cells are untouched, so the copy must not overstate its reach — including columns that cannot be created, since the solver cannot skip a week (fact 2) and will consume fairness budget for them.
- After a run, instrument and FOH rows carry a persistent "asignación manual" label (D5).
- `unresolvedNames` and `unfilled_seats` surface against the row and date they concern (fact 18), not as a bare count.
- Diagnostics still surfaced: `fairness_relaxed`, `sun_lead_fairness_relaxed`, `sun_bgv_fairness_relaxed`, `history_runs_used`.
- **Each date column shows its `TargetPreflight` state and reasons** (`PREFLIGHT_COPY`, `describePreflightReason`) — `handleConfirm`'s abort says "revisa la vista previa", which points at nothing without per-column state.
- A date in `unaddressableDates` renders an explicit "fuera del alcance de Auto" marker.
- A per-column skip control, replacing `DraftCardEditor`'s per-draft skip.
- Instrument/FOH rows can be **added and removed** within the grid, reusing `normalizeSeatName` and the case-insensitive duplicate rejection `SeatBoard` already implements.
- Copy across dates for instrument/FOH rows, **within the grid's own drafts only**. It does not replace `/api/admin/roles/copy-instruments` (fact 16), which stays untouched.

---

### Task 4: Mount in `MonthGenerator`, retire `DraftCardEditor`

**Files:** Modify `app/components/admin/MonthGenerator.tsx`, `app/components/admin/ServicesPanel.tsx` (thread `windowRoles`), `docs/UTILITIES_AND_COMPONENTS.md`.

**Scope:** the solver call's payload construction moves out of `handlePreview` into `plannerModel`; the config step, `RuleBuilder`, preflight plumbing and `handleConfirm` stay.

- Task 1's harness must still pass **unchanged** — it is the acceptance test for this task.
- Persist the fairness history entry from `applySolveResponse`'s `counts` (fact 11), keyed `${year}-${month}`, replacing on re-run.
- The "No disponibles este mes" notices still render.
- Thread `windowRoles` from `ServicesPanel` (fact 15).
- **Give the grid a surface that fits it** (D10, fact 20). Today the generator mounts in a `max-w-4xl` dialog whose body scrolls, which at 10 columns leaves ~75 px per column inside a box that scrolls in both axes. Either add a size token above `lg` to `CueDialog` — checking no other dialog's width changes — or mount the generator outside the dialog. Pass `ownScroll` so the body does not scroll behind the grid's own horizontal scroll. A test asserts no scroll region is nested inside another, matching the invariant `SeatBoard` already carries.

**Decide with the user, and record here before starting:**
- Whether the grid replaces the `Vista` (DayCard) preview or sits beside it. If `Vista` goes, fact 17's duplicate detection is already covered by Task 3's per-column `assigned`.
- Whether whole-day swap (`handleCardSwap`) becomes a column swap or is dropped. Do not drop it silently.

---

## Open questions for the user

1. The two Task 4 decisions above (Vista vs grid; whole-day swap).
2. D10 offers two ways to give the grid room — a new `CueDialog` size above `lg`, or moving the generator out of the dialog entirely. The second is more work and a bigger visual change; the first may still be too narrow at 10 columns. Worth a look at a mockup before Task 4.

## Settled since earlier drafts

- Soft maximum per seat: **not needed**. D6 makes capacity advisory in every category, so nothing is ever blocked or dropped, and `seatModel` keeps `max: null` throughout. The cap that briefly existed on instrument seats shipped as a data-loss bug (`c2b2fa7`).
- Members with no `memberType`: resolved — only the `Claude Service Account` remains, so spec §8.2 needs no action.
