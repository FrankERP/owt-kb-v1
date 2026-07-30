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
7. **`weekends_w_sat` is a list of 1-based WEEK INDEXES, not dates** (`:185-194`, `app/api/admin/solve/route.ts:12`).
8. **The Saturday↔week rule is ADJACENCY on Sundays, both directions.** Request: `weekends_with_saturday = [i+1 for each sundayDates[i] whose previous day is a selected Saturday]` (`MonthGenerator.tsx:1242-1252`). Response: week `n`'s Saturday is `subtractDay(sundayDates[n-1])`, kept only if that date is a selected Saturday of the month (`:1364-1377`). There is also a positional fallback at `:1249-1251` that fires when no Saturday is adjacent to any Sunday.
9. **Creation is preflight-gated and idempotent.** `handleConfirm` (`MonthGenerator.tsx:1404`): filters on `preflight(...)==="creatable"` (`:1411-1414`), **re-observes at confirm time and aborts on any drop** (`:1420-1431`), posts via `runDraftCreateBatch` with stable per-draft `creationRequestId` (`:1440-1459`), marks only confirmed successes `exists` (`:1465-1466`).
10. **`preflights` is keyed by `draft.localId`** (`:1485-1490`).
11. **`handlePreview` does five things beyond sending pools:** injects `extraSupport` for DSL-named people absent from pools (`:1266-1279`); synthesises `!in week N Sun.*/Sat.*` from `unavailableDates` (`:1281-1302`); refuses with "Debes seleccionar al menos un líder de domingo" (`:1317-1320`, also 400'd at `app/api/admin/solve/route.ts:129-131`); persists a fairness history entry keyed `${year}-${month}` and feeds `history` back (`:1179-1189`, `:1311-1314`, `:1383-1385`); and builds the "No disponibles este mes" notices (`:1622-1643`).
12. **`weeks = sundayDates.length`, unconditional on the Domingos toggle** (`:1240`).
13. **`activeSatDates` is appended in click order, not sorted** (`:1539-1542`).
14. **Voice seats are uncapped today** in both surfaces (`MonthGenerator.tsx:1029-1031`; `seatModel.ts:26-32`, `max: null` with the recorded reason "an invented cap would silently block a legitimately large Coro").
15. **`rankCandidates` derives `load` and `recent` entirely from `windowRoles`** (`candidateRanking.ts:82`, `:101`, `:104-111`). `MonthGenerator`'s role prop is `ExistingRole { _id; _type; date }` (`:24`) — **no assignment data**. `SeatBoard` receives a bounded, anchored slice (`ServicesPanel.tsx:114-130`, `CANDIDATE_LOAD_WINDOW_DAYS = 56`).
16. **`copiar instrumentos a otro día` copies between EXISTING services** server-side under a capability gate with revision guards (`ServicesPanel.tsx:811-849`). Not part of the preview; not replaced here.
17. **`DayCard` is today the only surface flagging one person twice across Lead/BGV/Coro** (`DayCard.tsx:69-75`, `:234-236`).
18. **`unfilled_seats` strings carry week/service/role/index and parse** (`app/utils/unfilledSeats.ts:30`).
19. **There is no `MonthGenerator` test today.**

## Decisions

| # | Decision |
|---|---|
| D1 | **Auto overwrites every voice cell in the window; there is no pinning.** Pins are expressible by composition (fact 3) but rejected: each pin adds an exclusion rule per remaining week, cannot target a slot index, and an over-constrained model fails as *infeasible* rather than degrading — on a solver already budgeted to 40 s on a fractional vCPU (`:104-107`). Confirmed with the user after the possibility was established. |
| D2 | Auto asks for confirmation first, naming what it will replace. Hand edits after a run persist until the next run. |
| D3 | Cells are **multi-occupant** — `memberIds: string[]` — per fact 2, matching `SeatBoard`'s `Record<seatId, memberId[]>`. |
| D4 | The grid operates only on **uncreated drafts**. Editing existing services is A · Tablero's job. |
| D5 | Instrument and FOH rows are always manual, and say so persistently, so a blank Bass row after Auto never reads as a solver failure. |
| D6 | **Capacity is Auto's fill target, never a manual limit.** Voice rows warn above 2/3/3 and never refuse (fact 14 — refusing would cap Coro at 3 in the creation path while the Tablero accepts more). Single-occupant instrument/FOH cells **replace** on selection, matching `SeatBoard.tsx:112-115`. |
| D7 | **Cell density:** a cell renders alias-only (`dn`), at most 2 names, then `+N`. The full list is in the cell's title and in the click-through panel. The original complaint was a cramped window; 9 columns × 3 names is the risk this guards. |
| D8 | The window is the **calendar month**, so `weeks` is always 4 or 5 and `solvableWindow`'s 3–6 guard is a defensive assert, not a reachable path. Resolves spec §12's open item. |
| D9 | With **Domingos unchecked** there are no Sundays, `weeks` is 0, and Auto is disabled with that reason. Saturdays alone cannot be solved (fact 8 — Saturdays are addressed relative to Sundays). |

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

**Tests — each must fail if the behaviour is removed:**
- Only `creatable` targets are posted; a `blocked` one is not.
- A candidate that stops being `creatable` between preview and confirm **aborts the whole batch** and posts nothing; the error names how many dates dropped.
- Each posted draft carries its own stable `creationRequestId`; a retry after a failure re-posts the failed draft **with the same id** and does not re-post the succeeded one.
- Only confirmed successes are marked `exists`.
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
- `buildSolveRequest({ config, members, sundayDates, activeSatDates, history }): { ok: true; request: SolveRequest } | { ok: false; reason: string }`
- `applySolveResponse({ response, rows, sundayDates, activeSatDates, members }): { cells: GridCell[]; unresolvedNames: string[]; counts: { total_counts; role_counts } | null }`
- `cellsToDrafts(cells, previous): DraftCard[]`
- `solvableWindow(sundayDates): { ok: boolean; weeks: number; reason: string | null }`
- `unaddressableDates(sundayDates, activeSatDates): string[]`
- `weekendWeekIndexes(sundayDates, activeSatDates): number[]`
- `saturdayForWeek(n, sundayDates, activeSatDates): string | null`

**Tests:**

*Shape*
- `buildRows`: Lead/BGV/Coro `solvable: true` with `target` 2/3/3; instrument and FOH rows `solvable: false`, `target: 1`. `target` is Auto's fill target, not a limit (D6).
- A cell holds several members; `cellsToDrafts` round-trips a Sunday with 2 Leads, 3 BGVs and 3 Coro into the draft's five seat arrays unchanged, and back.

*Saturday mapping — fact 8, both directions, adjacency not position*
- **February 2026** (Feb 1 Sunday, Feb 28 Saturday): with all Saturdays selected, `weekendWeekIndexes` returns `[2,3,4]`; `saturdayForWeek(2,…)` is `"2026-02-07"` (**not** `"2026-02-14"`, which is what indexing `activeSatDates` positionally would give); `unaddressableDates` returns exactly `["2026-02-28"]`.
- `activeSatDates` supplied out of order (fact 13) produces the same result as sorted input.
- A month where no Saturday is adjacent to any Sunday exercises the positional fallback (fact 8, `:1249-1251`); the test states what it produces, and `unaddressableDates` reports every Saturday the response cannot address rather than dropping them silently.

*Request construction — fact 11*
- Every person named in any DSL rule but absent from all three pools is injected into `support`; the default config (whose rules name Frank, Mkz, Gaby, Lucía, Liu, Marianne, Hugo, Niza, Jakey — `MonthGenerator.tsx:160-209`) yields a request the solver accepts. Omitting this is a 422.
- A member unavailable on a Sunday in the window yields `!in week N Sun.*`; the Saturday case yields `Sat.*`.
- Pools are mutually exclusive after construction (fact 5).
- No Sunday leads selected → `ok: false` with the Spanish reason, **no API call**.
- `weeks` outside 3–6 → `ok: false` (D8 makes this defensive).

*Response mapping*
- Only `solvable` rows are written; a response naming a non-solvable row is ignored and reported.
- Every written cell has `origin: "auto"`; instrument and FOH cells are untouched (D5).
- An unmatched name leaves the cell empty and appears in `unresolvedNames`.
- `counts` carries `total_counts`/`role_counts` through, so Task 4 can persist history (fact 11).

*Stability*
- `cellsToDrafts` preserves `localId`, `creationRequestId`, `exists` and `skipped` across repeated calls for the same date and type (fact 10 — a fresh `localId` makes every `preflights.get` miss, so nothing is creatable and the result is "0 por crear"; a lost `exists` re-opens an already-created date for posting).

---

### Task 3: `PlannerGrid` — the grid component

**Files:** Create `app/components/admin/PlannerGrid.tsx`; test `app/components/admin/__tests__/PlannerGrid.test.tsx` (jsdom).

**Props include `windowRoles: ParticipantRole[]`** — fact 15. `MonthGenerator` does not have this today; Task 4 threads it from `ServicesPanel`, which already holds full `ServiceRole[]`. Anchor rule for a grid with no single date: **one window anchored at the first Sunday of the month, reaching back `CANDIDATE_LOAD_WINDOW_DAYS`**, reused for every column, so ranking is stable across the month rather than shifting per column.

**Requirements, each asserted:**
- Rows from `buildRows`, columns from the window's dates. Horizontal scroll on the grid container only; no scroll region nested in another.
- Clicking a cell opens the ranked list via `rankCandidates`, with `assigned` built from **that date's whole column**, so the same-category rule holds per service and fact 17's duplicate detection is carried into the grid.
- **A member who served recently sorts below one who did not** — the test that would fail if `windowRoles` were passed empty (fact 15's silent failure).
- Above `target`, a voice cell warns and still accepts (D6). A single-occupant cell replaces (D6).
- Cells render alias-only, at most 2 names, then `+N`, with the full list in `title` (D7).
- **Auto** disabled with a visible reason when `solvableWindow` says no, or when Domingos is unchecked (D9).
- **Auto confirms first** (D2), naming that it replaces every voice assignment in the window — including columns that cannot be created, since the solver cannot skip a week (fact 2) and will consume fairness budget for them.
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

**Decide with the user, and record here before starting:**
- Whether the grid replaces the `Vista` (DayCard) preview or sits beside it. If `Vista` goes, fact 17's duplicate detection is already covered by Task 3's per-column `assigned`.
- Whether whole-day swap (`handleCardSwap`) becomes a column swap or is dropped. Do not drop it silently.

---

## Open questions for the user

1. The two Task 4 decisions above.
2. `seatModel.ts` still has `max: null` for voice seats. D6 keeps the grid consistent with that by warning rather than refusing, so nothing is blocked — but if Frank wants a real soft maximum, it belongs in `seatModel` so both surfaces read one source.
