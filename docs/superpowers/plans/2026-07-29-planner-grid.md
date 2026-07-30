# C · Planificador (planner grid) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task.

> **Rewritten from scratch 2026-07-29** after five rounds of adversarial review. The previous version was patched round by round and its decisions drifted out of sync with the tasks implementing them — three of round 5's six blockers were that drift, and one was a safety hole a patch had introduced. Every decision below is stated in exactly one place; where a task appears to contradict a decision, the decision governs and the task is wrong.

**Goal:** Replace `MonthGenerator`'s draft-card preview with one grid — dates across, seats down — where every cell is editable and **Auto** runs the existing solver across the voice rows.

**Architecture:** A regression harness first pins the create path. Then one pure module (`plannerModel`) owns the grid shape and both translations to and from the solver's wire format, and one component (`PlannerGrid`) renders it. `MonthGenerator` keeps its config step, rule builder, preflight plumbing and `handleConfirm`.

**Tech Stack:** Next.js 16, React 19, TypeScript, Tailwind, vitest (`environment: "node"`, per-file `@vitest-environment jsdom` for components), existing `/api/admin/solve`.

**Source spec:** [`docs/superpowers/specs/2026-07-29-service-team-editor-design.md`](../specs/2026-07-29-service-team-editor-design.md) §5.
**Predecessor:** Plan 1 (A · Tablero) is merged; `seatModel` and `candidateRanking` are reused **unchanged**.

## Global Constraints

- Done gate: `npx tsc --noEmit`, `npm test`, `npx eslint .` with **0 errors** (92 warnings are a deliberate backlog).
- Spanish UI copy.
- Dates at local noon: `new Date(iso.slice(0,10)+"T12:00:00")`. Never bare `new Date(iso)`.
- Timezone America/Mexico_City.
- Sanity array-of-object writes need a `_key` per item.
- Conventional commits; body explains the why. Never add AI/Claude attribution or `Co-Authored-By` trailers.
- Branch off `main`; never commit to `main` directly.

---

## Load-bearing facts

Every one verified against source, or against the production dataset read-only. Breaking any is a regression, not a UI change.

**The solver**
1. Voices only, 3–6 weeks — `gcf/owt_solver_v2.py:37`, `:449`.
2. Voice seats are multi-occupant: per week 2 × `Sun.Lead`, 3 × `Sun.BGV`, 3 × `Sun.Choir`, and on Saturday weeks 2 × `Sat.Lead`, 3 × `Sat.BGV` — `:547-561`. **No `Sat.Choir`.**
3. No pre-assignment field — `ScheduleConfig` `:87-107`. Pins *are* expressible by composition (`P !in week k <role>` for every k≠w, plus `P <role> >= 1`, hard at `:886-897`) — see D1 for why that is rejected, not impossible.
4. One slot per person per service per week, enforced internally — `:754-764`.
5. People are identified by NAME; pools must be mutually exclusive (`:454`); an unknown DSL name raises (`:280`, `:288`).
6. Response is per-week, 1-based, Saturdays nested in the week object — `:1141-1169`, `app/api/admin/solve/route.ts:30-33`.
7. The dataclass field is `weekends_w_sat` (`:90`) but **the JSON key is `weekends_with_saturday`**, read at `:1195` with a silent `[]` default — drift yields a month with zero Saturday assignments and no error. `buildSolveRequest` must return a literal typed `SolveRequest` so `tsc` catches it.
8. `weekends_with_saturday` holds 1-based **week indexes, not dates** — `:185-194`, `app/api/admin/solve/route.ts:12`.
9. **History is weighted, newest heaviest: 10, 6, 3** — `:70`, `:485-492`. `payload.history = solverHistory.slice(-3)` (`MonthGenerator.tsx:1311-1314`).

**The existing component**
10. Saturday↔week is **adjacency on Sundays**, both directions: request `weekends_with_saturday = [i+1 for each sundayDates[i] whose previous day is a selected Saturday]` (`MonthGenerator.tsx:1242-1252`); response week `n`'s Saturday is `subtractDay(sundayDates[n-1])`, kept only if it is a selected Saturday of the month (`:1364-1377`). A positional fallback fires when no Saturday is adjacent to any Sunday (`:1249-1251`).
11. `weeks = sundayDates.length`, **unconditional on the Domingos toggle** (`:1240`). Unchecking Domingos still solves; Sunday drafts are dropped by `if (sundays && sunDate)` at **`:1351`** — that single line is the only thing keeping Sunday services out of the create path.
12. `activeSatDates` is appended in click order, not sorted (`:1539-1541`).
13. The `🤖 Auto-asignar con Solver` toggle (`:1554`) gates the whole solver branch (`:1230-1236`), and `gateBlocked` guards the solve (`:1228`).
14. `handlePreview` does five things beyond sending pools: `extraSupport` injection (`:1266-1279`), synthesised `!in week N Sun.*/Sat.*` availability rules (`:1281-1302`), the "Debes seleccionar al menos un líder de domingo" refusal (`:1317-1320`, also 400 at `app/api/admin/solve/route.ts:129-131`), fairness-history persistence keyed `${year}-${month}` (`:1179-1189`, `:1383-1385`), and the "No disponibles este mes" notices (`:1622-1643`).
15. Availability rules loop `allPoolIds` (`:1288`). `extraSupport` members end up **in** the `support` pool, so a rule naming them would not raise — the real consequence is that a DSL-named non-pool member is schedulable while unavailable.
16. Creation is preflight-gated and idempotent: filter on `creatable` (`:1411-1414`), **re-observe at confirm and abort the batch on any drop** (`:1420-1431`), `runDraftCreateBatch` with stable per-draft `creationRequestId` (`:1440-1459`), only confirmed successes marked `exists` (`:1465-1466`).
17. **With `preflight` supplied, the candidate filter ignores `exists` entirely** (`:1413`); `!d.exists` is only the standalone fallback. `Props.preflight` is optional (`:70`).
18. `preflights` is keyed by `draft.localId` (`:1485-1490`).
19. A new preview mints fresh `creationRequestId`s (`:1354`, `:1369`; `monthDraftCreate.ts:8`). A stale id against a changed roster surfaces as `idempotency_mismatch` (`roleWriteRequest.ts:697`).
20. Footer buttons: `handleConfirm(false)` labelled **`Crear ${toCreate.length} borrador(es)`** and `handleConfirm(true)` labelled **`Crear y publicar`** (`:1698-1703`) — the second shares the first's first word. `gateBlocked` refuses both (`:1407`).
21. `published: true` on create makes the month member-visible **and queues assignment emails** (`app/api/admin/roles/route.ts:264-286`).
22. Coro checkboxes render for Saturday drafts today (`:1031`), and merged option A spreads `...VOICE_SEATS` for every service type (`SeatBoard.tsx:80-85`).

**Surrounding code and data**
23. The generator mounts at `ServicesPanel.tsx:1712` in `<Modal wide>` without `ownScroll`, so the body scrolls; `Modal` passes `mode="sheet"` → `CueDialog` `max-w-4xl`, `max-h-[min(86svh,52rem)]` (`CueDialog.tsx:95-99`, `:126-131`). **`CueDialog` has no size above `lg`, and `ownScroll` exists only on `Modal`.**
24. `rankCandidates` derives **both** `load` and `recent` from one `windowRoles` argument (`candidateRanking.ts:101`, `:104-111`); `recent` takes `[...new Set(weekKeys)].sort().slice(-weeks)` with `weeks` defaulting to 4 (`:87`); sort order is driven by `load` (`:156`). `MonthGenerator`'s role prop is `ExistingRole { _id; _type; date }` — **no assignments**. `ServicesPanel` holds full `ServiceRole[]` and gives `SeatBoard` a 56-day anchored slice (`ServicesPanel.tsx:114-137`).
25. `summarizeUnfilledSeats` returns `{week, service, labels}` with the role collapsed to Spanish and **no date**; `SEAT_RE` matches the trailing `#N` **without capturing it** (`unfilledSeats.ts:30`, `:32-62`).
26. `copiar instrumentos a otro día` copies between **existing** services server-side under a capability gate with revision guards (`ServicesPanel.tsx:811-849`). Not part of the preview; not replaced here.
27. `DayCard` is today the only surface flagging one person twice across Lead/BGV/Coro (`DayCard.tsx:68-75`, `:234-236`).
28. The iOS build is an **online wrap** of the hosted app (`capacitor.config.ts:25-28`), so `title` never fires on touch.
29. No `MonthGenerator` test exists.
30. **Production (read-only GROQ):** 18 of 27 role docs hold **two `Drums` slots with two different people**, 13 of them `published: true`, spanning 2026-06-07 → 2026-08-30. Every service is exactly L2/B3/C3 (Saturdays C0). Instrument spellings are already the 5 canonical ones; **0** members lack `memberType`. Spec §8's two data prerequisites are therefore already satisfied.

---

## Decisions

Each is stated here once. Tasks implement them; where a task seems to disagree, this table wins.

| # | Decision |
|---|---|
| **D1** | **Auto overwrites every voice cell it can address. There is no pinning.** Pins are expressible (fact 3) but rejected: each pin adds an exclusion per remaining week, cannot target a slot index, and an over-constrained model fails *infeasible* rather than degrading — on a solver budgeted to 40 s on a fractional vCPU. Confirmed with the user after the possibility was established. |
| **D2** | Auto confirms first, naming what it replaces. Hand edits after a run persist until the next run. |
| **D3** | **Every cell is multi-occupant** (`memberIds: string[]`) — voice, instrument and FOH alike. Two drummers on one `Drums` seat is the normal case on 18 services (fact 30). |
| **D4** | The grid operates on **uncreated drafts only**. Editing existing services is A · Tablero's job. |
| **D5** | Instrument and FOH rows are always manual and say so persistently, so a blank Bass row after Auto never reads as a solver failure. |
| **D6** | **Capacity is Auto's fill target, never a limit.** No cell ever refuses an occupant and **no cell ever replaces one** — replacement is exactly what evicted a drummer in `c2b2fa7`. Warnings fire on **solvable rows only**: a `target: 1` warning on instrument rows would fire on two-thirds of services. |
| **D7** | **Cell density:** alias-only (`dn`), at most 2 names, then **`+N` as a focusable control that opens the cell**. Never a `title` hover hint — the iOS build is a web wrap (fact 28), so hover hides the very information the user said was hidden. |
| **D8** | The window is the **calendar month**, so `weeks` ∈ {4,5} and `solvableWindow`'s 3–6 guard is a defensive assert. Resolves spec §12's open item. |
| **D9** | **Unchecking Domingos keeps today's behaviour: the solve still runs on the full Sunday list, and no Sunday service is rendered *or created*.** The rendered column set is an **explicit input** to both `applySolveResponse` and `cellsToDrafts` — never inferred from `sundayDates`. Today `MonthGenerator.tsx:1351` is the only guard (fact 11); losing it would create Sunday services the admin excluded and, via `Crear y publicar`, email the team about them (fact 21). |
| **D10** | **The grid does not live in a dialog.** `CueDialog` stops at `max-w-4xl` and August 2026 is 10 columns (Sun 2/9/16/23/30 + Sat 1/8/15/22/29) — ~75 px each, in a box that also scrolls vertically. A wider size token is **rejected**: still too narrow, and widening a shared token risks every other dialog. The generator becomes a **full-width panel inside the Servicios tab**. `ownScroll` is irrelevant once it leaves `Modal` (fact 23). This is the decision that answers "I have to scroll through a really small window". |
| **D11** | A Coro row **renders on Saturday columns as non-solvable**, not omitted. The solver has no `Sat.Choir` (fact 2), but both current surfaces allow a Saturday Coro (fact 22), and D5's persistent manual label already prevents the "reads as solver failure" confusion. Omitting the row would remove a capability. |
| **D12** | **`load` from the union (saved window + in-grid drafts); `recent` from the saved window only.** Implemented as **two `rankCandidates` calls merged** — one with the union for order and `load`, one with the saved window for `recent` — so `candidateRanking.ts` is **not modified**. A single concatenated call would make `slice(-4)` return the grid's own future weeks and the strip would stop showing history (fact 24). |
| **D13** | **Auto is the only caller of `/api/admin/solve`.** `Previsualizar →` builds an empty grid; the `🤖 Auto-asignar con Solver` toggle is retired (fact 13) because the grid always offers Auto. `gateBlocked` guards Auto, as it guards the solve today. Consequence: two of Task 1's tests are **expected to be rewritten** in Task 4, not to pass unchanged. |
| **D14** | **A month's Auto run must not be fed its own previous result.** `payload.history` excludes the entry whose key equals the window's own `${year}-${month}`. Without this, pressing Auto twice hands run 1's counts back at weight 10 (fact 9) and systematically penalises exactly the people run 1 chose — and D1/D2 make "press Auto, adjust, press Auto again" the primary loop. |

---

## File Structure

| File | Responsibility |
|---|---|
| `app/components/admin/__tests__/MonthGenerator.create.test.tsx` | **Create (Task 1).** Pins the create path before anything moves. |
| `app/components/admin/plannerModel.ts` | **Create (Task 2).** Rows, columns, cells, both wire translations. Pure. |
| `app/utils/unfilledSeats.ts` | **Modify (Task 2).** Expose the role so seats can be placed on the grid. |
| `app/components/admin/PlannerGrid.tsx` | **Create (Task 3).** Renders; decides nothing. |
| `app/components/admin/MonthGenerator.tsx` | **Modify (Task 4).** Grid replaces the preview; payload construction moves; `DraftCardEditor` and `useSolver` retired. |
| `app/components/admin/ServicesPanel.tsx` | **Modify (Task 4).** Mount as a full-width panel (D10); thread `windowRoles`. |
| `docs/UTILITIES_AND_COMPONENTS.md` | **Modify (Task 4).** |

`app/components/admin/candidateRanking.ts` and `seatModel.ts` are **reused unchanged** (D12).

---

### Task 1: Regression harness for the create path

Fact 29: nothing tests this today, and everything in fact 16 is safety-critical and about to be disturbed.

**Files:** Create `app/components/admin/__tests__/MonthGenerator.create.test.tsx` (jsdom, mocked `fetch`, injected `preflight`).

Query only by accessible role and name, using the **real** labels (fact 20): match the create button as `/^Crear \d+ borrador/` and the publish button as the exact string `"Crear y publicar"`. A bare `/Crear/` matches both.

**Tests:**
- Only `creatable` targets are posted; a `blocked` one is not.
- A candidate that stops being `creatable` between preview and confirm **aborts the whole batch**, posts nothing, and reports how many dates dropped.
- Each posted draft carries its own stable `creationRequestId`.
- **Retry, in standalone mode** (`preflight` undefined, where `!d.exists` is the component's own rule — fact 17): after one failure, retrying re-posts the failed draft with the same id and does not re-post the succeeded one. With a `preflight` mock supplied this assertion would only test the mock, since the filter ignores `exists`.
- Only confirmed successes are marked `exists`.
- `Crear N borrador(es)` posts `published: false`; `Crear y publicar` posts `published: true`, for every draft in the batch (fact 21).
- `gateBlocked` refuses `handleConfirm` and posts nothing (fact 20).

**Two further tests are written here and are expected to be REWRITTEN in Task 4** (D13 moves the solve from `Previsualizar →` to Auto). They are written now because they pin behaviour that must survive the move, and Task 4 must demonstrate it did:
- "Debes seleccionar al menos un líder de domingo" refuses before any `/api/admin/solve` call (fact 14).
- A successful solve writes a fairness-history entry under `${year}-${month}`, replacing rather than appending (fact 14).

---

### Task 2: `plannerModel` — grid shape and solver translation

**Files:** Create `app/components/admin/plannerModel.ts`; modify `app/utils/unfilledSeats.ts`; test `app/components/admin/__tests__/plannerModel.test.ts`.

**Produces:**
- `type CellOrigin = "manual" | "auto" | "empty"`
- `interface GridCell { date: string; rowId: string; memberIds: string[]; origin: CellOrigin }`
- `interface GridRow { id: string; label: string; category: SeatCategory; solvable: boolean; target: number | null }`
- `interface GridColumn { date: string; type: "sunday_role" | "saturday_role" }`
- `buildRows({ instrumentSeats, fohSeats }): GridRow[]`
- `buildColumns({ sundayDates, activeSatDates, includeSundays }): GridColumn[]` — **the explicit column set of D9.**
- `seatDefForRow(row): SeatDef` — `rankCandidates` needs a `SeatDef` and filters on `memberType` (fact 24), which `GridRow` lacks. Map via `VOICE_SEATS` / `instrumentSeatDef` / `fohSeatDef`.
- `buildSolveRequest({ config, members, sundayDates, activeSatDates, history }): { ok: true; request: SolveRequest } | { ok: false; reason: string }`
- `applySolveResponse({ response, previousCells, columns, rows, sundayDates, activeSatDates, members }): { cells; unresolvedNames; counts }` — **takes the current grid and the column set; returns the MERGED grid.**
- `cellsToDrafts(cells, columns, previous, existingRoles): DraftCard[]`
- `solvableWindow(sundayDates)`, `unaddressableDates(sundayDates, activeSatDates)`, `weekendWeekIndexes(...)`, `saturdayForWeek(n, ...)`
- `mapUnfilledSeats(seats, sundayDates, activeSatDates): { date: string; rowId: string }[]`
- `historyForRequest(entries, year, month): SolverHistoryEntry[]` — **D14's exclusion.**

**Tests:**

*Shape*
- Lead/BGV/Coro `solvable: true`, `target` 2/3/3; instrument and FOH `solvable: false`, `target: 1` (advisory only — D6).
- A Coro row is present on Saturday columns as **non-solvable** (D11), not absent.
- `cellsToDrafts` round-trips a Sunday with 2 Leads, 3 BGVs and 3 Coro through the five seat arrays unchanged.
- **`cellsToDrafts` round-trips ONE `Drums` row holding TWO members into TWO `instruments[]` slots**, both `instrument: "Drums"` (fact 30, D3).

*Column set — D9's safety property*
- `buildColumns({ includeSundays: false })` yields Saturday columns only.
- **`cellsToDrafts` with Sundays excluded yields ZERO `sunday_role` drafts**, even though `sundayDates` is fully populated for the solve. This is the create-path assertion; asserting only that Sunday columns do not render would pass while the create path posts them (facts 11, 21).

*Saturday mapping — adjacency, not position (fact 10)*
- **February 2026** (Feb 1 Sunday, Feb 28 Saturday), all Saturdays selected: `weekendWeekIndexes` → `[2,3,4]`; `saturdayForWeek(2)` → `"2026-02-07"` (positional indexing would wrongly give `"2026-02-14"`); `unaddressableDates` → `["2026-02-28"]`.
- `activeSatDates` supplied out of order (fact 12) gives the same result as sorted input.
- The positional fallback (fact 10) is reachable only when the single selected Saturday is a month-final unadjacent one. Assert the concrete outcome: it asks the solver to staff week 1's Saturday, whose date resolves out of month and is discarded at `:1366` — fairness consumed for a service never created — and `unaddressableDates` reports it.

*Request construction (fact 14)*
- Every DSL-named person absent from all pools is injected into `support`, so **every DSL-named person appears in exactly one pool**. That is the shape a unit test can assert; "the solver accepts it" cannot be asserted without running the solver. Omitting the injection is a 422 in production.
- A **pool** member unavailable on a Sunday in the window yields `!in week N Sun.*`; the Saturday case yields `Sat.*`. A **non-pool** member yields none — the rules loop `allPoolIds` (fact 15). Record the consequence in a comment: a DSL-named non-pool member is therefore schedulable while unavailable. Do not "fix" that by widening the loop without deciding it separately.
- Pools are mutually exclusive (fact 5).
- No Sunday leads selected → `ok: false` with the Spanish reason and **no API call**.
- The returned object is a literal typed `SolveRequest`, so a rename of `weekends_with_saturday` is a `tsc` error rather than a silent empty month (fact 7).
- **`historyForRequest` excludes the window's own `${year}-${month}` entry** (D14): given entries for the current month and two priors, only the two priors are sent.

*Response mapping*
- Only `solvable` rows are written, and only on columns present in the column set.
- Every written cell has `origin: "auto"`.
- **Instrument and FOH cells survive byte-for-byte:** seat `Drums` with two members on two dates, run `applySolveResponse`, assert both cells return with the same `memberIds` and `origin: "manual"`, and that only voice cells changed. Without `previousCells` this test would assert the absence of an input that never existed.
- An unmatched name leaves the cell empty and appears in `unresolvedNames`.
- `counts` carries `total_counts`/`role_counts` out so Task 4 can persist history.
- `mapUnfilledSeats` places each seat on a row and a date. It resolves to a row, never an occupant slot — `SEAT_RE` does not capture `#N` (fact 25). Extend `unfilledSeats.ts` to expose the role rather than re-implementing the regex.

*Stability*
- `cellsToDrafts` preserves `localId`, `creationRequestId`, `exists` and `skipped` across repeated calls for the same date and type. A fresh `localId` makes every `preflights.get` miss, so nothing is creatable and the result is "0 por crear" (fact 18); a lost `exists` re-opens an already-created date (fact 17 — seeded from `existingRoles`, which is why it is a parameter).
- A **new Auto run** mints new `creationRequestId`s, matching today (fact 19). Ordinary re-renders do not.

---

### Task 3: `PlannerGrid` — the grid component

**Files:** Create `app/components/admin/PlannerGrid.tsx`; test `app/components/admin/__tests__/PlannerGrid.test.tsx` (jsdom).

**Ranking (D12).** Two `rankCandidates` calls, merged: one with `[...savedWindow, ...inGridDrafts]` supplying order and `load`, one with `savedWindow` alone supplying `recent`. `candidateRanking.ts` is not modified.

**Requirements, each asserted:**
- Rows from `buildRows`, columns from `buildColumns`. The grid container carries `overflow-x-auto`; every column carries a `min-w` class so columns scroll rather than compress; **no scroll region is nested inside another** (assert by class containment, as `SeatBoard.test.tsx:146-155` does). jsdom performs no layout — `getBoundingClientRect` and `offsetWidth` are 0 — so a pixel budget is not assertable here; the 10-column appearance is checked once by screenshot in Task 4.
- Clicking a cell opens the ranked list, `assigned` built from **that date's whole column**, so the same-category rule holds per service and fact 27's duplicate detection is carried into the grid.
- **A member who served recently sorts below one who did not** — fails if the saved window were empty.
- **A member assigned earlier in THIS grid sorts below one who was not** — fails if D12's union were dropped.
- **The `recent` strip still shows history:** assert the *contents* of `recent` for a member who served historically but appears nowhere in the grid — non-empty. Sort-order tests cannot catch this; order is driven by `load` (fact 24).
- Above `target`, a **solvable** cell warns and still accepts. Non-solvable rows carry no threshold (D6).
- **No cell ever replaces an occupant:** seat two members on one `Drums` cell, add a third, assert all three survive (D6, `c2b2fa7`).
- Cells render alias-only, at most 2 names, then **`+N` as a focusable control that opens the cell** — assert it is keyboard-reachable and that no `title` carries the hidden names (D7).
- **Auto** disabled with a visible reason when `solvableWindow` says no, or when `gateBlocked` (D13).
- **Domingos unchecked, Saturdays selected: Auto is ENABLED**, produces Saturday cells, and renders no Sunday column (D9).
- **Auto confirms first** (D2), naming that it replaces every voice assignment **the solver can address** — an unaddressable Saturday is never in the response and its cells are untouched, so the copy must not overstate its reach.
- After a run, instrument and FOH rows carry a persistent "asignación manual" label (D5).
- `unresolvedNames` and `mapUnfilledSeats` output surface against the row and date they concern.
- Diagnostics still surfaced: `fairness_relaxed`, `sun_lead_fairness_relaxed`, `sun_bgv_fairness_relaxed`, `history_runs_used`.
- **Each date column shows its `TargetPreflight` state and reasons** (`PREFLIGHT_COPY`, `describePreflightReason`) — `handleConfirm`'s abort says "revisa la vista previa", which points at nothing without per-column state.
- A date in `unaddressableDates` renders an explicit "fuera del alcance de Auto" marker.
- A per-column skip control, replacing `DraftCardEditor`'s per-draft skip.
- Instrument/FOH rows can be added and removed, reusing `normalizeSeatName` and `SeatBoard`'s case-insensitive duplicate rejection.
- Copy across dates for instrument/FOH rows, **within the grid's own drafts only** — it does not replace `/api/admin/roles/copy-instruments` (fact 26).

---

### Task 4: Mount as a full-width panel; retire `DraftCardEditor` and `useSolver`

**Files:** Modify `app/components/admin/MonthGenerator.tsx`, `app/components/admin/ServicesPanel.tsx`, `docs/UTILITIES_AND_COMPONENTS.md`.

- **Mount the generator as a full-width panel in the Servicios tab, not in `Modal`/`CueDialog`** (D10, fact 23). Confirm no other dialog changes.
- **Auto becomes the only caller of `/api/admin/solve`** (D13). `Previsualizar →` builds an empty grid; retire the `useSolver` toggle; `gateBlocked` guards Auto.
- Persist the fairness-history entry from `applySolveResponse`'s `counts`, keyed `${year}-${month}`, replacing on re-run — and send `historyForRequest`'s filtered list, never the raw one (D14).
- Thread `windowRoles` from `ServicesPanel` (fact 24) as a 56-day slice anchored at the month's first Sunday.
- The "No disponibles este mes" notices still render (fact 14).
- **Task 1's harness must still pass**, except its two solver-driven tests, which are rewritten to drive Auto instead of `Previsualizar →` (D13). Show that the rewritten versions pin the same behaviour.
- Record the 10-column screenshot (Task 3) here.

**Decide with the user, and record here before starting:**
- Whether the grid replaces the `Vista` (DayCard) preview or sits beside it. If `Vista` goes, fact 27's duplicate detection is already covered by Task 3's per-column `assigned`.
- Whether whole-day swap (`handleCardSwap`) becomes a column swap or is dropped. Do not drop it silently.

---

## Open questions for the user

1. The two Task 4 decisions above.

## Settled

- **Pins:** rejected with reasons (D1) — not impossible, but over-constraining and infeasibility-prone.
- **Soft maximum per seat:** not needed. D6 makes capacity advisory, so nothing is blocked or dropped; `seatModel` keeps `max: null`.
- **Spec §8 data prerequisites:** already satisfied in production (fact 30) — neither cleanup script is needed.
