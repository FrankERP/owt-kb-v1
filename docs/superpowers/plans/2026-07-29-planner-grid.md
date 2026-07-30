# C · Planificador (planner grid) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task.

**Goal:** Replace `MonthGenerator`'s draft-card preview with one grid — dates across, seats down — where every cell is editable by hand and **Auto** runs the existing solver across the voice rows for the whole window.

**Architecture:** One new pure module (`plannerModel`) holds the grid shape, cell state, and the two translations to and from the solver's wire format. One new component (`PlannerGrid`) renders it. `MonthGenerator`'s config step, rule builder, preflight and create path are kept; the preview step's rendering and the solver call's payload construction move.

**Tech Stack:** Next.js 16, React 19, TypeScript, Tailwind, vitest (node env; jsdom for the component), existing `/api/admin/solve`.

**Source spec:** [`docs/superpowers/specs/2026-07-29-service-team-editor-design.md`](../specs/2026-07-29-service-team-editor-design.md) §5.
**Predecessor:** Plan 1 (A · Tablero) is merged; `seatModel` and `candidateRanking` are reused here.

## Global Constraints

- Done gate: `npx tsc --noEmit`, `npm test`, `npx eslint .` with **0 errors** (92 warnings are a deliberate backlog).
- Spanish UI copy.
- Dates at local noon: `new Date(iso.slice(0,10)+"T12:00:00")`. Never bare `new Date(iso)`.
- Timezone America/Mexico_City; "today" via `toLocaleDateString("sv",{timeZone:"America/Mexico_City"})`.
- Sanity array-of-object writes need a `_key` per item.
- Conventional commits; body explains the why. Never add AI/Claude attribution or `Co-Authored-By` trailers.
- Branch off `main`; never commit to `main` directly.

---

## Load-bearing facts, all verified against the source

Breaking any of these is a safety or correctness regression, not a UI change.

1. **The solver is voices-only and needs 3–6 weeks.** `gcf/owt_solver_v2.py:37` (`ROLE_ORDER`), `:449`. No concept of instruments or FOH.
2. **Voice seats are MULTI-OCCUPANT.** `build_slots` (`owt_solver_v2.py:547-561`) emits per week: 2 × `Sun.Lead`, 3 × `Sun.BGV`, 3 × `Sun.Choir`, and on Saturday weeks 2 × `Sat.Lead`, 3 × `Sat.BGV`. Response fields are arrays.
3. **THE SOLVER CANNOT ACCEPT PINNED ASSIGNMENTS.** `ScheduleConfig` (`owt_solver_v2.py:87-107`) has no pre-assignment field, and the DSL supports only negative and aggregate forms — the exhaustive list is the error text at `:433-439` (`!in`, `!in week n`, count caps, `!with`, `!consecutive`, `fairness_exempt`, `fairness_slack`, `any_of(...) each_week`). There is no positive per-week placement construct.
4. **The solver enforces one slot per person per service per week** internally (`:754-764`). Any client-side merge of solver output with hand-set cells can violate this and produce the same-category double booking that `candidateRanking` blocks (`candidateRanking.ts:134-137`).
5. **The solver identifies people by NAME** and requires mutually exclusive pools (`:452-454`); an unknown name in a DSL rule raises (`:282-288`).
6. **The response is per-week, 1-based**, with Saturdays nested in the same week object (`owt_solver_v2.py:1142-1169`, `app/api/admin/solve/route.ts:30-33`).
7. **Creation is preflight-gated and idempotent.** `handleConfirm` (`MonthGenerator.tsx:1404`) filters on `preflight(...)==="creatable"` (`:1411-1414`), **re-observes every candidate at confirm time and aborts the batch on any drop** (`:1420-1431`), then posts through `runDraftCreateBatch` with a stable per-draft `creationRequestId` (`:1440-1459`), marking only confirmed successes `exists` (`:1465-1466`).
8. **`preflights` is keyed by `draft.localId`** (`MonthGenerator.tsx:1485-1490`), and `handleConfirm` reads `preflights.get(d.localId)`.
9. **The solver call today does four things beyond sending the pools** (`handlePreview`, `MonthGenerator.tsx:1266-1302`, `:1383-1385`): injects `extraSupport` for every person named in a DSL rule but absent from a pool; synthesises `!in week N Sun.*/Sat.*` availability rules from `unavailableDates`; persists a fairness history entry to localStorage and feeds `history` back; and builds the month's "No disponibles este mes" notices (`:1622-1643`).
10. **`copiar instrumentos a otro día` copies between two EXISTING services** server-side under a capability gate with revision guards (`ServicesPanel.tsx:811-849`). It is not part of the preview and this plan does not replace it.
11. **`DayCard` is today the only surface flagging one person twice across Lead/BGV/Coro** (`DayCard.tsx:234-236`, `:297-310`).

## Decisions

| # | Decision |
|---|---|
| D1 | **Auto overwrites every voice cell in the window.** There is no pinning. Fact 3 makes solver-honoured pins impossible, and fact 4 makes a client-side merge unsafe. |
| D2 | Auto asks for confirmation first, naming what it will replace. Hand edits made *after* a run persist until the next run. |
| D3 | Cells are **multi-occupant** — `memberIds: string[]` — matching fact 2 and `SeatBoard`'s `Record<seatId, memberId[]>`. |
| D4 | The grid operates only on **uncreated drafts**, exactly as the preview does today. Editing existing services is A · Tablero's job. |
| D5 | Instrument and FOH rows are always manual. The grid says so in as many words, so a blank Bass row after Auto never reads as a solver failure. |

---

## File Structure

| File | Responsibility |
|---|---|
| `app/components/admin/plannerModel.ts` | **Create.** Grid rows and cells, `buildSolveRequest`, `applySolveResponse`, `cellsToDrafts`. Pure. |
| `app/components/admin/PlannerGrid.tsx` | **Create.** Renders the grid; decides nothing. |
| `app/components/admin/MonthGenerator.tsx` | **Modify.** Preview renders `PlannerGrid`; `handlePreview`'s payload construction moves into `plannerModel`; `DraftCardEditor` retired. |
| `docs/UTILITIES_AND_COMPONENTS.md` | **Modify.** Register the new modules. |

---

### Task 1: `plannerModel` — grid shape and solver translation

**Files:** Create `app/components/admin/plannerModel.ts`; test `app/components/admin/__tests__/plannerModel.test.ts`.

**Produces:**
- `type CellOrigin = "manual" | "auto" | "empty"`
- `interface GridCell { date: string; rowId: string; memberIds: string[]; origin: CellOrigin }`
- `interface GridRow { id: string; label: string; category: SeatCategory; solvable: boolean; capacity: number | null }`
- `function buildRows(input: { instrumentSeats: string[]; fohSeats: string[] }): GridRow[]`
- `function buildSolveRequest(input: { config: SolverConfig; members: MemberOption[]; sundayDates: string[]; activeSatDates: string[]; history: SolverHistoryEntry[] }): { ok: true; request: SolveRequest } | { ok: false; reason: string }`
- `function applySolveResponse(input: { response: SolveResponse; rows: GridRow[]; sundayDates: string[]; activeSatDates: string[]; members: MemberOption[] }): { cells: GridCell[]; unresolvedNames: string[] }`
- `function cellsToDrafts(cells: GridCell[], previous: DraftCard[]): DraftCard[]`
- `function solvableWindow(sundayDates: string[]): { ok: boolean; weeks: number; reason: string | null }`
- `function unaddressableDates(sundayDates: string[], activeSatDates: string[]): string[]`

**Behaviour to pin with tests — each of these is a named test:**

*Shape*
- `buildRows` marks Lead/BGV/Coro `solvable: true` with capacities 2, 3 and 3; every instrument and FOH row `solvable: false`, `capacity: 1`. Capacities come from fact 2, not from invention.
- A cell holds several members; `cellsToDrafts` round-trips a Sunday with 2 Leads, 3 BGVs and 3 Coro into the draft's five seat arrays unchanged, and back.

*Request construction — each of fact 9's four behaviours gets its own test*
- Every person named in any DSL rule but absent from all three pools is injected into `support`; a default config (whose seeded rules name Frank, Mkz, Gaby, Lucía, Liu, Marianne, Hugo, Niza, Jakey — `MonthGenerator.tsx:160-209`) produces a request the solver would accept. Omitting this is a 422.
- A member with `unavailableDates` covering a Sunday in the window yields the matching `!in week N Sun.*` rule; the Saturday case yields `Sat.*`.
- Pools are mutually exclusive after construction (fact 5).
- `solvableWindow` refuses a window outside 3–6 weeks with a Spanish reason and `buildSolveRequest` returns `ok: false` **without calling the API**.

*Response mapping*
- Solver week `n` maps to the nth Sunday; its Saturday to the date at position `n` in `weekends_with_saturday`.
- **Named fixtures for the hard calendars:** February 2026 (Feb 1 is a Sunday and Feb 28 a Saturday, so the trailing Saturday maps to no solver week) and a month starting mid-week. `unaddressableDates` returns exactly that trailing Saturday; the grid renders it explicitly (Task 2), never as a silent blank.
- A name in the response matching no member leaves the cell empty and is returned in `unresolvedNames` — never silently dropped.
- `applySolveResponse` writes only into `solvable` rows. A response naming a non-solvable row is ignored and reported.
- Every cell it writes has `origin: "auto"`; instrument and FOH cells are untouched (D5).

*Stability*
- `cellsToDrafts` preserves each draft's `localId` and `creationRequestId` across repeated calls for the same date and type (fact 8 — a fresh `localId` makes every `preflights.get` miss, so nothing is creatable and the result is "0 por crear").

---

### Task 2: `PlannerGrid` — the grid component

**Files:** Create `app/components/admin/PlannerGrid.tsx`; test `app/components/admin/__tests__/PlannerGrid.test.tsx` (jsdom).

**Requirements, each asserted by a test:**
- Renders `buildRows` output as rows and the window's dates as columns. Horizontal scroll lives on the grid container only; no scroll region nested inside another.
- Clicking a cell opens the ranked candidate list, reusing `rankCandidates`, with `assigned` built from **that date's whole column** so the same-category double-duty rule holds per service. This also carries fact 11's duplicate detection into the grid.
- A cell at capacity shows it; adding beyond capacity is refused with a reason rather than silently replacing.
- **Auto** is disabled with a visible reason when `solvableWindow` says no.
- **Auto asks first** (D2), naming that it will replace every voice assignment in the window. Cancelling changes nothing.
- After a run: voice cells show `auto` origin; **instrument and FOH rows carry a persistent "asignación manual" label** (D5) so a blank Bass row never reads as a solver failure.
- `unresolvedNames` and `unfilled_seats` are surfaced against the row and date they concern, not as a bare count. `unfilled_seats` strings carry a slot index (`"W2 Sunday Sun.Choir #2"`), so they resolve to a row+date, not to a single occupant.
- Solver diagnostics currently shown — `fairness_relaxed`, `sun_lead_fairness_relaxed`, `sun_bgv_fairness_relaxed`, `history_runs_used` — are still surfaced.
- **Each date column shows its `TargetPreflight` state and reasons** (`PREFLIGHT_COPY`, `describePreflightReason`), because `handleConfirm`'s abort message tells the admin to "revisa la vista previa" and without per-column state that instruction points at nothing.
- A date in `unaddressableDates` renders an explicit "fuera del alcance de Auto" marker.
- A per-column skip control, replacing `DraftCardEditor`'s per-draft skip.
- Instrument/FOH rows offer copy across dates **within the grid's own drafts**. This is a new draft-local convenience; it does **not** replace `/api/admin/roles/copy-instruments`, which operates on existing services and stays exactly as it is (fact 10).

---

### Task 3: Mount in `MonthGenerator`, retire `DraftCardEditor`

**Files:** Modify `app/components/admin/MonthGenerator.tsx`, `docs/UTILITIES_AND_COMPONENTS.md`.

**Scope correction:** the solver call's payload construction moves out of `handlePreview` into `plannerModel`. The config step, `RuleBuilder`, the preflight plumbing and `handleConfirm` stay.

**Must be preserved — each requires a TEST, not a traced read:**
- `handleConfirm`'s preflight filter, confirm-time re-observation, and batch abort when any candidate stops being creatable.
- `runDraftCreateBatch` with a stable per-draft `creationRequestId`; only confirmed successes marked `exists`, so a retry re-attempts exactly the failed drafts with their original ids.
- `localId` stability across grid edits (fact 8).
- The month's "No disponibles este mes" notices (fact 9) still render.

**Decide with the user before starting, and record the answer here:**
- Whether the grid replaces the `Vista` (DayCard) preview or sits beside it. If `Vista` goes, fact 11's duplicate detection must already be covered by Task 2's per-column `assigned`.
- Whether whole-day swap (`handleCardSwap`) becomes a column swap or is dropped. Do not drop it silently.
- What Auto does when "Domingos" is unchecked: today `weeks` is derived from the Sunday count unconditionally (`MonthGenerator.tsx:1238-1240`).

---

## Open questions for the user

1. The soft maximum per voice seat is still unresolved from Plan 1 (`SeatDef.max` is `null`). Task 1 sets grid capacities from the solver's real slot counts (2/3/3), which answers it for the grid but not for `SeatBoard`. Should `SeatBoard` adopt the same numbers?
2. The three Task 3 decisions above.
