# «Solo llenar vacíos» (delivery 3) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** An admin can run Auto in create mode with «Solo llenar vacíos» on: every voice seat already on the board is sent to the solver as a pin, instruments are completed without re-seating, the solver's give-ups are named, and a «Borrar» menu clears voices/instruments per service or for the month.

**Architecture:** Three new pure modules (`pinModel.ts`, `pinViolations.ts`, `clearCells.ts`) plus two small pure changes in `plannerModel.ts` (`solverPools` extracted from `buildSolveRequest`; `applySolveResponse` keeps waivers on pinned cells). `MonthGenerator` gets ONE shared solve seam (`prepareSolve` + `runSolve`) that both Auto paths call, owns the switch state, the month-clear `CueDialog` and the undo toast. `PlannerGrid` stays provider-free and presentational: it renders the switch, the notice list, the pin-conflict chips and the «Borrar» menus from props.

**Tech Stack:** Next.js 16 / React 19 client components, TypeScript, vitest + @testing-library/react (jsdom), the house UI primitives (`Button`, `Switch`, `Menu`/`MenuItem`/`MenuHeader`, `CueDialog`, `useToast`).

**Spec:** `docs/superpowers/specs/2026-09-29-planner-trailing-saturday-and-fill-empty-design.md` — §0 (today's code), §3 (delivery 3), §4 (docs), §5 (out of scope). Frank approved it 2026-09-29 («lgtm»). Delivery 2 (the trailing Saturday in the planner) is NOT in this plan: it waits for delivery 1 (the solver) to deploy.

## Global Constraints

- Risk tier **standard** (spec header). Pipeline: implement → four gates → fresh diff review → re-verify fixes → `preview` → PR → `main`.
- Four gates, all must pass before claiming done: `npx tsc --noEmit`, `npm test`, `npx eslint .` with **0 errors**. (No `gcf/**` change here, so the python gate is not triggered.)
- **Switch off, or zero pins ⇒ the request carries NO `pinned` key and is byte-identical to today's** (spec §3.2; the MCP P4 plan relies on it).
- **E2:** the switch is off by default, component state, never persisted.
- **E7:** create mode only. Nothing in stored mode changes.
- Pins name people by exact `member_name` (ADR-0041). At most **100** distinct pins (`PINNED_CAP`, `gcf/owt_solver_v2.py`).
- The solver REFUSES two different pins for one person in one service (`parse_pins`, `gcf/owt_solver_v2.py:345-349`) — the Lead → BGV → Coro dedupe is a correctness requirement.
- Handshake copy, verbatim: «El solver no respetó los lugares fijados; no se aplicó nada.» Set directly, never through `solverRefusalMessage`.
- New controls use `Button` (CLAUDE.md: the ONLY button). `PlannerGrid`'s existing raw `<button>`s are backlog, not precedent.
- `CueDialog` is mounted with `open={x}`, never a literal `open` (`cueDialogMount.test.ts` baseline is 5 and only ratchets down).
- `motion` is not imported outside `app/components/ui/**`.
- Spanish UI copy; conventional commits (`feat(planner): …`), body explains the why. **Never** add AI/Claude attribution or `Co-Authored-By` trailers (CLAUDE.md overrides any tool default).
- Do not touch `gcf/**`, the solve route, or the MCP P4 plan (spec §5).

## Execution notes

- **Work in a separate worktree** (`EnterWorktree`), branch `claude/fill-empty-only` created from `claude/trailing-saturday` (which carries the two specs and this plan). The primary `app-outage-b00569` worktree is being read by the solver-spec adversarial review, whose packet states that tree's code equals `main` 1d50f9f3 — do not change code there. Populate `node_modules` with `cp -Rc` from a worktree whose lockfile matches (memory: the primary checkout's `node_modules` is stale for MCP deps) and symlink `.env.local` (`ln -s ../../../.env.local .env.local`).
- Run single test files with `npx vitest run <path>`; the whole suite with `npm test`.

## Deviations from the spec, stated

1. **Spec §3.4's «Copiar a todo el mes» same-service double is unreachable for voice rows.** `PlannerGrid` wires `onCopy` only when `row.category !== "voz"` (`PlannerGrid.tsx`, `RowGroup` call site), and the picker/drag refuse a same-category double (D6/C2). The dedupe is tested at the pure level with constructed doubles (Lead + BGV, and one member twice in one cell — the shape the stored section swap can create, DD10).
2. **Handshake refusal still runs `applySpecialFill`** (with the switch's no-vacate flag), because spec §0 records that every post-history exit calls it once and E5 says specials fill even when the solve fails. «no se aplicó nada» refers to the solver's result; the copy stays verbatim. A test pins that voices are untouched and instruments still complete.
3. **The global «Borrar» button's «Este servicio» section** acts on the column whose picker is open; with no cell open that section is not shown. Each column header carries its own service-scoped menu (spec: «The same menu sits in each column header»).
4. **The pin-conflict chip reuses the Tipo-mismatch tint** (`border-warning-strong/50 bg-warning-strong/10`), placed after Tipo mismatch and before over-target in ADR-0045's precedence, with its own words line under the cell. No new colour pairing enters the grid.
5. **`AutoState.notice` (one string) becomes `notices?: string[]` in this delivery**, because delivery 3 may ship before delivery 2 (spec §2.3 order: floors, then delivery 2's, then delivery 3's).
6. **The undo toast lives 10 s** (spec gives no duration) and is withdrawn on any Auto run, on a month/year change, and guarded by a generation counter so a stale click does nothing.

## File structure

| File | Responsibility |
|---|---|
| `app/components/admin/pinModel.ts` (new) | Board → pins (`collectPins`), the five Spanish pre-fetch refusals (`pinRefusal`), the handshake (`pinHandshakeHolds`), board conflicts (`pinConflicts`), dropped-duplicate notices, `emptyVoiceSeats`, seat/date labels. Pure. |
| `app/components/admin/pinViolations.ts` (new) | Parse ADR-0041's six `pin_violations` forms, map them back to the config's rules, and word them. Pure. |
| `app/components/admin/clearCells.ts` (new) | «Borrar»: plan a clear (scope × categories, live counts, approximate hand-placed count), apply it, restore it. Pure. |
| `app/components/admin/plannerModel.ts` | `solverPools` (extracted, pure refactor), `resolvedCapValue` + exported `resolvedNameOrRaw`, `applySolveResponse({ pinnedCellKeys })`. |
| `app/components/admin/MonthGenerator.tsx` | The shared seam, the switch state, locking, pin wiring, board conflicts, clear handlers, the month `CueDialog`, the undo toast. |
| `app/components/admin/PlannerGrid.tsx` | `AutoState.notices`, the switch, the switch-on confirm copy, pin-conflict chips, the «Borrar» menus. Stays provider-free. |
| `app/components/admin/__tests__/providersHarness.tsx` (new) | `AdminProviders` (`CueDialogProvider` + `ToastProvider`) for suites that render `MonthGenerator`. |
| `app/components/admin/__tests__/plannerWiringHarness.tsx` (new) | Shared `Gen` (with providers), fixtures and DOM helpers for the new wiring suites. |
| `app/components/admin/__tests__/pinSolveHarness.ts` (new) | `stubSolve`, `echoPins`, `emptySchedule` — solve stubs that record bodies. |
| Tests (new) | `pinModel.test.ts`, `pinViolations.test.ts`, `clearCells.test.ts`, `solverPools.test.ts`, `fillEmpty.wiring.test.tsx`, `fillEmpty.local.test.tsx`, `plannerClear.wiring.test.tsx`; additions to `PlannerGrid.test.tsx` and `plannerModel.test.ts`. |
| Docs | `docs/SOLVER_AND_INFRA.md`, `docs/MONTH_GRID_EDITING.md`, `docs/UTILITIES_AND_COMPONENTS.md`, `CLAUDE.md` (Reusable utils). No ADR for delivery 3 (spec §4: the one ADR is delivery 2's). |

---

### Task 1: Providers for the MonthGenerator suites

`MonthGenerator` will call `useToast()` and mount a `CueDialog` (Task 10). Both throw outside their providers (`Toast.tsx:43-47`, `CueDialogProvider.tsx:29-33`), and ten suites render it bare. This task wraps them first, as its own commit, so the feature commits never mix harness churn with behaviour.

**Files:**
- Create: `app/components/admin/__tests__/providersHarness.tsx`
- Modify (test harness only): `MonthGenerator.create.test.tsx`, `MonthCalendar.test.tsx`, `localFill.wiring.test.tsx`, `instrumentFill.wiring.test.tsx` (each: its `function Gen`), `MonthGenerator.storedMove.test.tsx`, `MonthGenerator.stored.test.tsx`, `MonthGenerator.ruleEdit.test.tsx`, `participationAlongside.test.tsx`, `MonthGenerator.derivedHistory.test.tsx` (each: every `render(` of `<MonthGenerator`), all under `app/components/admin/__tests__/`.

**Interfaces:**
- Produces: `AdminProviders({ children })` — `CueDialogProvider` › `MotionProvider` › `ToastProvider`, the nesting `app/utils/Provider.tsx:45-47` uses.

- [ ] **Step 1: Create the harness**

```tsx
// app/components/admin/__tests__/providersHarness.tsx
//
// Test-only providers for suites that render `MonthGenerator` — NOT a test file.
// Production mounts these app-wide (`app/utils/Provider.tsx`); `useToast` and
// `CueDialog` throw without theirs. Same nesting as production: dialogs, then
// motion (the toast's exit is an `m.*` animation — `Toast.test.tsx` wraps it
// the same way), then toasts.
import type { ReactNode } from "react";

import { CueDialogProvider } from "../../ui/CueDialogProvider";
import { MotionProvider } from "../../ui/MotionProvider";
import { ToastProvider } from "../../ui/Toast";

export function AdminProviders({ children }: { children: ReactNode }) {
  return (
    <CueDialogProvider>
      <MotionProvider>
        <ToastProvider>{children}</ToastProvider>
      </MotionProvider>
    </CueDialogProvider>
  );
}
```

- [ ] **Step 2: Wrap the four `Gen` helpers**

In `MonthGenerator.create.test.tsx`, `MonthCalendar.test.tsx`, `localFill.wiring.test.tsx` and `instrumentFill.wiring.test.tsx`, add the import and change `Gen`'s return (the function body is otherwise unchanged):

```tsx
import { AdminProviders } from "./providersHarness";
// …
  return (
    <AdminProviders>
      <MonthGenerator {...props} rules={rules} />
    </AdminProviders>
  );
```

- [ ] **Step 3: Wrap every direct render**

In the other five files, every `render(<MonthGenerator …/>)` / `render(\n <MonthGenerator …` gets RTL's wrapper option; `rerender` keeps the wrapper, so rerender calls stay as they are:

```tsx
import { AdminProviders } from "./providersHarness";
// …
const view = render(<MonthGenerator {...props} storedSource={storedSource} />, { wrapper: AdminProviders });
```

Sites today (verify with `grep -n "render(" <file>`): `storedMove` :156; `stored` :196, :440, :532, :633, :677, :749, :922, :1194, :1266; `ruleEdit` :50; `participationAlongside` :296, :605; `derivedHistory` :163, :178. If `MonthCalendar.test.tsx` renders `MonthGenerator` anywhere outside `Gen`, wrap that too.

- [ ] **Step 4: Run the ten suites**

Run: `npx vitest run app/components/admin/__tests__/MonthGenerator app/components/admin/__tests__/MonthCalendar.test.tsx app/components/admin/__tests__/localFill.wiring.test.tsx app/components/admin/__tests__/instrumentFill.wiring.test.tsx app/components/admin/__tests__/participationAlongside.test.tsx`
Expected: PASS, same counts as before the change. A failure here means a provider changes behaviour (e.g. `CueDialogProvider`'s inert handling, or `MotionProvider` now animating something a test asserted synchronously) — stop and report it rather than editing assertions. If only `MotionProvider` causes it, drop it from `AdminProviders` and, in Task 10, wrap just the «Borrar» suite's `Gen` in it.

- [ ] **Step 5: Commit**

```bash
git add app/components/admin/__tests__/providersHarness.tsx app/components/admin/__tests__/*.test.tsx
git commit -m "test(planner): render MonthGenerator inside the app's dialog, motion and toast providers" -m "MonthGenerator is about to raise a toast and mount a CueDialog, and both throw outside their providers. Production mounts them app-wide; the suites now do too, in the same nesting, before any feature code depends on it."
```

---

### Task 2: `solverPools` and `resolvedCapValue` — pure refactor

The board's pin conflicts (Task 9) must judge «outside the pools the request sends» with the request's own pool names. They are computed inside `buildSolveRequest`; extract them so there is one computation. `isSaturdayFloor` and the violation mapper (Task 5) need the same relative-cap arithmetic; extract it too. **No behaviour change**: the existing `plannerModel.test.ts` and `saturdayFloors.test.ts` are the guard.

**Files:**
- Modify: `app/components/admin/plannerModel.ts` (`resolvedNameOrRaw`, `isSaturdayFloor`, `buildSolveRequest` pool section)
- Create: `app/components/admin/__tests__/solverPools.test.ts`

**Interfaces:**
- Produces:
  - `export interface SolverPools { sundayLeadNames: string[]; saturdayLeadNames: string[]; supportNames: string[]; extraSupport: string[]; requestMemberIds: Set<string>; dslBlockedByTipo: string[] }`
  - `export function solverPools(config: SolverConfig, members: RankMember[]): SolverPools`
  - `export function resolvedCapValue(cap: RestrictionCap, weeks: number): number`
  - `export function resolvedNameOrRaw(name: string, members: RankMember[]): string` (was private; unchanged body)

- [ ] **Step 1: Write the failing test**

```ts
// app/components/admin/__tests__/solverPools.test.ts
import { describe, expect, it } from "vitest";

import type { RankMember } from "../candidateRanking";
import { buildSolveRequest, resolvedCapValue, solverPools, type SolverConfig } from "../plannerModel";

const m = (id: string, name: string, memberType: string[], alias?: string): RankMember =>
  ({ _id: id, member_name: name, alias, memberType } as RankMember);

const ANA = m("ana", "Ana Karen Villalobos", ["voz", "sunday_lead"], "Ana");
const BETO = m("beto", "Alberto Ruiz Cano", ["voz", "saturday_lead", "sunday_lead"], "Beto");
const LU = m("lu", "María Lucía Estrada", ["voz", "support"], "Lucía");
const NIZA = m("niza", "Nizarindani Cruz Ávila", ["voz"], "Niza"); // no pool subtype: injected when a rule names her
const members = [ANA, BETO, LU, NIZA];

const config: SolverConfig = {
  sundayLeads: ["ana", "beto"],
  saturdayLeads: ["beto"],
  support: ["lu"],
  restrictions: [{ id: "r1", person: "Niza", excludedPatterns: ["Sun.Lead"], fairness: "none", fairnessSlack: 0, weekExclusions: [], caps: [] }],
  conflicts: [],
  presence: [],
};

describe("solverPools", () => {
  it("returns the names buildSolveRequest sends, deduplicated by pool priority", () => {
    const pools = solverPools(config, members);
    expect(pools.sundayLeadNames).toEqual(["Ana Karen Villalobos", "Alberto Ruiz Cano"]);
    expect(pools.saturdayLeadNames).toEqual([]); // Beto is already a Sunday lead
    expect(pools.supportNames).toEqual(["María Lucía Estrada"]);
    expect(pools.extraSupport).toEqual(["Nizarindani Cruz Ávila"]);
    expect([...pools.requestMemberIds]).toEqual(["ana", "beto", "lu", "niza"]);
    expect(pools.dslBlockedByTipo).toEqual([]);

    const built = buildSolveRequest({
      config, members, sundayDates: ["2026-03-01", "2026-03-08", "2026-03-15", "2026-03-22"],
      activeSatDates: [], historyEntries: [], year: 2026, month: 3,
    });
    if (!built.ok) throw new Error(built.reason);
    expect(built.request.sunday_leads).toEqual(pools.sundayLeadNames);
    expect(built.request.saturday_leads).toEqual(pools.saturdayLeadNames);
    expect(built.request.support).toEqual([...pools.supportNames, ...pools.extraSupport]);
  });

  it("names a rule's person who has no Tipo at all", () => {
    const pools = solverPools(config, [ANA, BETO, LU, { ...NIZA, memberType: [] }]);
    expect(pools.dslBlockedByTipo).toEqual(["Niza"]);
  });
});

describe("resolvedCapValue", () => {
  it("resolves a relative cap as max(0, weeks - offset), an absolute one as its value", () => {
    const cap = { id: "c", pattern: "Sat.*", op: "==" as const, value: 1, relative: false, relOffset: 2 };
    expect(resolvedCapValue(cap, 4)).toBe(1);
    expect(resolvedCapValue({ ...cap, relative: true, relOffset: 2 }, 4)).toBe(2);
    expect(resolvedCapValue({ ...cap, relative: true, relOffset: 6 }, 4)).toBe(0);
  });
});
```

- [ ] **Step 2: Run it to see it fail**

Run: `npx vitest run app/components/admin/__tests__/solverPools.test.ts`
Expected: FAIL — `solverPools` / `resolvedCapValue` are not exported.

- [ ] **Step 3: Extract**

In `plannerModel.ts`:

1. Export `resolvedNameOrRaw` (add `export`, and one line to its doc comment: *"Also the spelling `pinViolations.ts` maps solver sources back through — the request wrote them with it."*).
2. Add `resolvedCapValue` next to `isSaturdayFloor` and make `isSaturdayFloor` call it:

```ts
/** A cap's value as the solver resolves it: `max(0, weeks - offset)` for a relative cap. */
export function resolvedCapValue(cap: RestrictionCap, weeks: number): number {
  return cap.relative ? Math.max(0, weeks - cap.relOffset) : cap.value;
}

export function isSaturdayFloor(cap: RestrictionCap, weeks: number): boolean {
  if (!SATURDAY_ONLY_PATTERNS.has(cap.pattern) || cap.op === "<=") return false;
  return resolvedCapValue(cap, weeks) >= 1;
}
```

3. Add `SolverPools`/`solverPools` above `buildSolveRequest`. Its body is `buildSolveRequest`'s current pool section MOVED verbatim — from `const eligibleForPool = …` through the `for (const name of allDslPersons)` loop — **with every existing comment block carried along with the code it annotates**, plus the `allPoolIds` construction renamed `requestMemberIds` (same insertion order — the availability rules are emitted in that order, so it is part of the request's bytes):

```ts
/** The pool names a solve request sends, and who else it names. See `buildSolveRequest`. */
export interface SolverPools {
  sundayLeadNames: string[];
  saturdayLeadNames: string[];
  supportNames: string[];
  /** DSL-named people absent from every pool, appended to `support`. */
  extraSupport: string[];
  /** Every member id the request names, in the order availability rules are emitted. */
  requestMemberIds: Set<string>;
  /** Rule persons with NO Tipo at all — `buildSolveRequest` refuses when non-empty. */
  dslBlockedByTipo: string[];
}

export function solverPools(config: SolverConfig, members: RankMember[]): SolverPools {
  const idToName = (id: string) => memberIdToName(id, members);
  const eligibleForPool = (id: string, subtype: PoolSubtype) =>
    memberFitsPoolSubtype(members.find((x) => x._id === id), subtype);
  const inPool = (ids: string[], subtype: PoolSubtype) =>
    ids.filter((id) => eligibleForPool(id, subtype));

  const sundayLeadNames = inPool(config.sundayLeads, "sunday_lead").map(idToName);
  const sundaySet = new Set(sundayLeadNames);
  const saturdayLeadNames = inPool(config.saturdayLeads, "saturday_lead").map(idToName).filter((n) => !sundaySet.has(n));
  const satSet = new Set([...sundayLeadNames, ...saturdayLeadNames]);
  const supportNames = inPool(config.support, "support").map(idToName).filter((n) => !satSet.has(n));
  const poolNames = new Set([...sundayLeadNames, ...saturdayLeadNames, ...supportNames]);

  const extraSupport: string[] = [];
  const allDslPersons = [
    ...config.restrictions.map((r) => r.person),
    ...config.conflicts.flatMap((r) => [r.personA, r.personB]),
    ...config.presence.flatMap((r) => r.persons),
  ];
  const dslBlockedByTipo: string[] = [];
  const injectedMemberIds = new Set<string>();
  for (const name of allDslPersons) {
    const r = resolveToMemberName(name, members);
    const resolved = "resolved" in r ? r.resolved : r.unresolved;
    if (poolNames.has(resolved)) continue;
    const named = "resolved" in r ? members.find((x) => x.member_name === r.resolved) : undefined;
    if (named && (named.memberType ?? []).length === 0) {
      const shown = displayMemberName(named);
      if (!dslBlockedByTipo.includes(shown)) dslBlockedByTipo.push(shown);
      continue;
    }
    if (!extraSupport.includes(resolved)) extraSupport.push(resolved);
    if (named) injectedMemberIds.add(named._id);
  }

  const requestMemberIds = new Set([
    ...inPool(config.sundayLeads, "sunday_lead"),
    ...inPool(config.saturdayLeads, "saturday_lead"),
    ...inPool(config.support, "support"),
    ...injectedMemberIds,
  ]);

  return { sundayLeadNames, saturdayLeadNames, supportNames, extraSupport, requestMemberIds, dslBlockedByTipo };
}
```

4. In `buildSolveRequest`, replace the moved section with one destructure and keep everything after it; the refusal, the availability loop (now over `requestMemberIds`), the request literal and the Sunday-leads refusal are unchanged:

```ts
  const { sundayLeadNames, saturdayLeadNames, supportNames, extraSupport, requestMemberIds, dslBlockedByTipo } =
    solverPools(config, members);
  if (dslBlockedByTipo.length > 0) {
    return {
      ok: false,
      reason:
        `${dslBlockedByTipo.join(", ")} no tiene «Tipo», así que no puede servir, pero todavía hay reglas del solver que lo nombran. `
        + "Borra esas reglas (o devuélvele un Tipo) antes de generar el mes.",
    };
  }
  // (availability comment block unchanged)
  const availabilityRules: string[] = [];
  for (const memberId of requestMemberIds) {
    // … unchanged loop body …
  }
```

`idToName` in `buildSolveRequest` becomes unused — delete it there (it lives in `solverPools`).

- [ ] **Step 4: Run the guards**

Run: `npx vitest run app/components/admin/__tests__/solverPools.test.ts app/components/admin/__tests__/plannerModel.test.ts app/components/admin/__tests__/saturdayFloors.test.ts app/components/admin/__tests__/MonthGenerator.create.test.tsx`
Expected: PASS, with `plannerModel.test.ts` and the create suite at their previous counts.

- [ ] **Step 5: Commit**

```bash
git add app/components/admin/plannerModel.ts app/components/admin/__tests__/solverPools.test.ts
git commit -m "refactor(planner): one computation of the request's pool names" -m "The board's pin conflicts must judge 'outside the pools the request sends' with the request's own names. solverPools is buildSolveRequest's pool section moved verbatim; resolvedCapValue is isSaturdayFloor's arithmetic, which the violation mapper needs too. No request byte changes."
```

---

### Task 3: `pinModel.ts` — board → pins, refusals, handshake, conflicts

**Files:**
- Create: `app/components/admin/pinModel.ts`
- Test: `app/components/admin/__tests__/pinModel.test.ts`

**Interfaces:**
- Consumes: `weekForColumn`, `isSolvable`, `GridCell`/`GridColumn`/`GridRow` (plannerModel); `displayName`, `RankMember` (candidateRanking); `SolveRequest`/`SolveResponse` (solve route).
- Produces (exact):
  - `type PinRole = NonNullable<SolveRequest["pinned"]>[number]["role"]`
  - `interface Pin { week: number; role: PinRole; person: string }`
  - `interface PinSeat { columnId: string; rowId: string; memberId: string; occurrence: number }`
  - `interface DroppedPin extends PinSeat { person: string; kept: PinSeat }`
  - `interface CollectedPins { pins: Pin[]; seats: PinSeat[]; pinnedCellKeys: Set<string>; dropped: DroppedPin[]; unresolved: PinSeat[]; unnamed: PinSeat[] }`
  - `const PINNED_CAP = 100`, `const PIN_HANDSHAKE_REFUSAL: string`
  - `pinSeatKey(seat: PinSeat): string` → `` `${columnId}|${rowId}|${memberId}#${occurrence}` ``
  - `dayLabel(iso: string): string` → `"4 oct"`; `serviceDayLabel(type: "sunday_role" | "saturday_role", iso: string): string` → `"domingo 4 oct"`
  - `seatLabel(seat: Pick<PinSeat, "columnId" | "rowId">, columns: GridColumn[], rows: GridRow[]): string` → `"Lead del domingo 4 oct"`
  - `collectPins(input: { cells: GridCell[]; columns: GridColumn[]; rows: GridRow[]; members: RankMember[]; sundayDates: string[] }): CollectedPins`
  - `pinRefusal(input: { collected: CollectedPins; columns: GridColumn[]; rows: GridRow[]; members: RankMember[]; weekendsWithSaturday: number[]; poolNames: string[] }): string | null`
  - `pinHandshakeHolds(response: SolveResponse, pins: Pin[]): boolean`
  - `type PinConflictKind = "unavailable" | "outsidePool" | "duplicate"`
  - `pinConflicts(input: { collected: CollectedPins; columns: GridColumn[]; members: RankMember[]; pools: { sundayLeads: string[]; saturdayLeads: string[]; support: string[] } }): Map<string, PinConflictKind[]>` (keyed by `pinSeatKey`)
  - `droppedPinNotices(input: { dropped: DroppedPin[]; columns: GridColumn[]; rows: GridRow[]; members: RankMember[] }): string[]`
  - `emptyVoiceSeats(input: { cells: GridCell[]; columns: GridColumn[]; rows: GridRow[]; sundayDates: string[] }): number`

- [ ] **Step 1: Write the failing tests**

```ts
// app/components/admin/__tests__/pinModel.test.ts
import { describe, expect, it } from "vitest";

import type { SolveResponse } from "@/app/api/admin/solve/route";
import type { RankMember } from "../candidateRanking";
import { buildColumns, buildRows, createColumnId, type GridCell } from "../plannerModel";
import {
  PINNED_CAP,
  collectPins,
  dayLabel,
  droppedPinNotices,
  emptyVoiceSeats,
  pinConflicts,
  pinHandshakeHolds,
  pinRefusal,
  pinSeatKey,
  seatLabel,
  serviceDayLabel,
  type Pin,
} from "../pinModel";

const SUNDAYS = ["2026-03-01", "2026-03-08", "2026-03-15", "2026-03-22", "2026-03-29"];
const TIPO = ["voz", "sunday_lead", "saturday_lead", "support"];
const m = (id: string, member_name: string, alias?: string, extra: Partial<RankMember> = {}): RankMember =>
  ({ _id: id, member_name, alias, memberType: TIPO, ...extra } as RankMember);

const ANA = m("ana", "Ana Karen Villalobos", "Ana");
const BETO = m("beto", "Alberto Ruiz Cano", "Beto");
const LU = m("lu", "María Lucía Estrada", "Lucía");
const members = [ANA, BETO, LU];
const rows = buildRows();
// Sundays 1 and 8 March, Saturday 7 March (week 2's), and a special on Wed 4 March.
const columns = buildColumns({
  sundayDates: SUNDAYS.slice(0, 2),
  activeSatDates: ["2026-03-07"],
  specials: [{ date: "2026-03-04", name: "Vigilia" }],
});
const SUN1 = createColumnId("sunday_role", "2026-03-01");
const SAT2 = createColumnId("saturday_role", "2026-03-07");
const SUN2 = createColumnId("sunday_role", "2026-03-08");
const SPECIAL = createColumnId("special_role", "2026-03-04");

const cell = (columnId: string, rowId: string, ids: string[], extra: Partial<GridCell> = {}): GridCell => ({
  columnId, rowId, occupants: ids.map((memberId) => ({ memberId })), origin: "manual", ...extra,
});
const collect = (cells: GridCell[], who = members) =>
  collectPins({ cells, columns, rows, members: who, sundayDates: SUNDAYS });

describe("labels", () => {
  it("writes dates the way the grid headers read, without Intl", () => {
    expect(dayLabel("2026-10-04")).toBe("4 oct");
    expect(serviceDayLabel("saturday_role", "2026-10-31")).toBe("sábado 31 oct");
    expect(seatLabel({ columnId: SUN1, rowId: "coro" }, columns, rows)).toBe("Coro del domingo 1 mar");
  });
});

describe("collectPins", () => {
  it("pins every occupied voice seat on a column Auto writes, never a special, an instrument or FOH", () => {
    const got = collect([
      cell(SUN1, "lead", ["ana"]),
      cell(SUN1, "coro", ["lu"], { origin: "auto" }),
      cell(SAT2, "bgv", ["beto"]),
      cell(SPECIAL, "lead", ["beto"]),
      cell(SUN1, "instrumento:Drums", ["beto"]),
      cell(SUN1, "foh:Console", ["lu"]),
    ]);
    expect(got.pins).toEqual<Pin[]>([
      { week: 1, role: "Sun.Lead", person: "Ana Karen Villalobos" },
      { week: 1, role: "Sun.Choir", person: "María Lucía Estrada" },
      { week: 2, role: "Sat.BGV", person: "Alberto Ruiz Cano" },
    ]);
    expect([...got.pinnedCellKeys]).toEqual([`${SUN1}|lead`, `${SUN1}|coro`, `${SAT2}|bgv`]);
    expect(got.dropped).toEqual([]);
  });

  it("keeps ONE seat per person per service — Lead before BGV before Coro, then occupant order — and reports the rest", () => {
    // The solver REFUSES two different pins for one person in one service (parse_pins).
    const got = collect([
      cell(SUN2, "coro", ["ana"]),
      cell(SUN2, "bgv", ["ana", "beto"]),
      cell(SUN2, "lead", ["beto", "beto"]), // one member twice in one cell (DD10)
    ]);
    expect(got.pins).toEqual<Pin[]>([
      { week: 2, role: "Sun.Lead", person: "Alberto Ruiz Cano" },
      { week: 2, role: "Sun.BGV", person: "Ana Karen Villalobos" },
    ]);
    expect(got.dropped.map((d) => [d.rowId, d.memberId, d.occurrence, d.kept.rowId])).toEqual([
      ["lead", "beto", 1, "lead"],
      ["bgv", "beto", 0, "lead"],
      ["coro", "ana", 0, "bgv"],
    ]);
  });

  it("lets the same person hold the Saturday and the Sunday of one week — two services", () => {
    const got = collect([cell(SAT2, "lead", ["ana"]), cell(SUN2, "lead", ["ana"])]);
    expect(got.pins.map((p) => p.role)).toEqual(["Sat.Lead", "Sun.Lead"]);
  });

  it("sets aside an occupant who resolves to no member, and one whose member_name is empty", () => {
    const got = collect([cell(SUN1, "lead", ["ghost"]), cell(SUN1, "bgv", ["lu"])], [ANA, BETO, { ...LU, member_name: "  " }]);
    expect(got.pins).toEqual([]);
    expect(got.unresolved).toEqual([{ columnId: SUN1, rowId: "lead", memberId: "ghost", occurrence: 0 }]);
    expect(got.unnamed).toEqual([{ columnId: SUN1, rowId: "bgv", memberId: "lu", occurrence: 0 }]);
  });
});

describe("pinRefusal", () => {
  const base = { columns, rows, members, weekendsWithSaturday: [2], poolNames: members.map((x) => x.member_name) };

  it("is null for a clean board", () => {
    expect(pinRefusal({ ...base, collected: collect([cell(SUN1, "lead", ["ana"])]) })).toBeNull();
  });

  it("names the cell of an occupant who is no longer a member", () => {
    expect(pinRefusal({ ...base, collected: collect([cell(SUN1, "lead", ["ghost"])]) })).toBe(
      "No se puede usar «Solo llenar vacíos»: en Lead del domingo 1 mar hay alguien que ya no está en la lista de miembros. Quítalo de ese lugar y vuelve a intentarlo.",
    );
  });

  it("names the cell of a member with no member_name", () => {
    const who = [ANA, BETO, { ...LU, member_name: "" }];
    expect(pinRefusal({ ...base, members: who, collected: collect([cell(SUN1, "bgv", ["lu"])], who) })).toBe(
      "No se puede usar «Solo llenar vacíos»: Lucía (en BGV del domingo 1 mar) no tiene nombre en su ficha. Complétalo en Miembros o quítalo de ese lugar.",
    );
  });

  it("refuses more than PINNED_CAP distinct pins rather than dropping any", () => {
    const many = Array.from({ length: PINNED_CAP + 1 }, (_, i) => m(`p${i}`, `Persona ${i}`));
    const cols = buildColumns({ sundayDates: SUNDAYS, activeSatDates: [], specials: [] });
    const cells = cols.flatMap((c, w) => [cell(c.columnId, "coro", many.slice(w * 21, w * 21 + 21).map((x) => x._id))]);
    const collected = collectPins({ cells, columns: cols, rows, members: many, sundayDates: SUNDAYS });
    expect(collected.pins.length).toBe(PINNED_CAP + 1);
    expect(pinRefusal({ ...base, columns: cols, members: many, collected })).toBe(
      "No se puede usar «Solo llenar vacíos»: hay 101 lugares de voz ocupados y el solver acepta hasta 100. Borra algunos o apaga «Solo llenar vacíos».",
    );
  });

  it("refuses a Saturday pin on a week the request does not send", () => {
    expect(pinRefusal({ ...base, weekendsWithSaturday: [], collected: collect([cell(SAT2, "lead", ["ana"])]) })).toBe(
      "No se puede usar «Solo llenar vacíos»: Lead del sábado 7 mar no se envía al solver este mes. Quítalo de ese lugar o apaga «Solo llenar vacíos».",
    );
  });

  it("refuses a pinned-only spelling that differs from a pool name only in case or spaces", () => {
    const hugo = m("hugo2", " hugo villa", "Hugo 2");
    const who = [...members, hugo];
    expect(pinRefusal({
      ...base, members: who, poolNames: [...base.poolNames, "Hugo Villa"],
      collected: collect([cell(SUN1, "lead", ["hugo2"])], who),
    })).toBe(
      "No se puede usar «Solo llenar vacíos»: « hugo villa» (en Lead del domingo 1 mar) solo se distingue de «Hugo Villa» por mayúsculas o espacios, y el solver no puede saber cuál es cuál. Corrige el nombre en Miembros.",
    );
    // A pin on a pool member's exact name is always fine, whatever its spelling.
    expect(pinRefusal({
      ...base, members: who, poolNames: [...base.poolNames, " hugo villa"],
      collected: collect([cell(SUN1, "lead", ["hugo2"])], who),
    })).toBeNull();
  });
});

describe("pinHandshakeHolds", () => {
  const pins: Pin[] = [
    { week: 1, role: "Sun.Lead", person: "Ana Karen Villalobos" },
    { week: 2, role: "Sat.BGV", person: "Alberto Ruiz Cano" },
  ];
  const good: SolveResponse = {
    ok: true,
    pinned_honored: 2,
    schedule: {
      "1": { Sunday: { Lead: ["Ana Karen Villalobos"], BGV: [], Choir: [] } },
      "2": { Sunday: { Lead: [], BGV: [], Choir: [] }, Saturday: { Lead: [], BGV: ["Alberto Ruiz Cano"] } },
    },
  };

  it("holds when the count matches and every pin is in the schedule by exact name", () => {
    expect(pinHandshakeHolds(good, pins)).toBe(true);
  });

  it("fails on a missing pinned_honored, a short count, or a name the schedule lacks", () => {
    expect(pinHandshakeHolds({ ...good, pinned_honored: undefined }, pins)).toBe(false);
    expect(pinHandshakeHolds({ ...good, pinned_honored: 1 }, pins)).toBe(false);
    expect(pinHandshakeHolds({
      ...good,
      schedule: { ...good.schedule, "1": { Sunday: { Lead: ["ana karen villalobos"], BGV: [], Choir: [] } } },
    }, pins)).toBe(false);
  });
});

describe("pinConflicts", () => {
  it("flags an unavailable occupant, one outside the pools the request sends for that role, and a dropped duplicate", () => {
    const who = [{ ...ANA, unavailableDates: ["2026-03-01"] }, BETO, LU];
    const collected = collect([cell(SUN1, "lead", ["ana", "lu"]), cell(SUN1, "bgv", ["ana"])], who);
    const got = pinConflicts({
      collected, columns, members: who,
      pools: { sundayLeads: ["Ana Karen Villalobos"], saturdayLeads: [], support: ["María Lucía Estrada"] },
    });
    expect(got.get(pinSeatKey({ columnId: SUN1, rowId: "lead", memberId: "ana", occurrence: 0 }))).toEqual(["unavailable"]);
    // Lucía is support: a Sunday Lead seat is outside what the request sends for Sun.Lead.
    expect(got.get(pinSeatKey({ columnId: SUN1, rowId: "lead", memberId: "lu", occurrence: 0 }))).toEqual(["outsidePool"]);
    expect(got.get(pinSeatKey({ columnId: SUN1, rowId: "bgv", memberId: "ana", occurrence: 0 }))).toEqual(["duplicate"]);
  });

  it("counts Sunday leads as Saturday-lead candidates, and any sent pool for BGV/Coro", () => {
    const collected = collect([cell(SAT2, "lead", ["ana"]), cell(SUN1, "coro", ["beto"])]);
    const got = pinConflicts({
      collected, columns, members,
      pools: { sundayLeads: ["Ana Karen Villalobos"], saturdayLeads: [], support: ["Alberto Ruiz Cano"] },
    });
    expect(got.size).toBe(0);
  });
});

describe("droppedPinNotices", () => {
  it("says where each dropped duplicate was kept", () => {
    const collected = collect([cell(SUN2, "lead", ["ana"]), cell(SUN2, "bgv", ["ana"]), cell(SUN1, "coro", ["lu", "lu"])]);
    expect(droppedPinNotices({ dropped: collected.dropped, columns, rows, members })).toEqual([
      "Lucía estaba dos veces en Coro del domingo 1 mar; se fijó una sola vez.",
      "Ana estaba en dos lugares del domingo 8 mar; se fijó solo en Lead.",
    ]);
  });
});

describe("emptyVoiceSeats", () => {
  it("counts target minus occupants on the voice seats Auto writes", () => {
    // Sunday: Lead 2, BGV 3, Coro 3 (8); Saturday: Lead 2, BGV 3 (5). Two Sundays + one Saturday = 21.
    expect(emptyVoiceSeats({ cells: [], columns, rows, sundayDates: SUNDAYS })).toBe(21);
    expect(emptyVoiceSeats({
      cells: [cell(SUN1, "lead", ["ana", "beto", "lu"]), cell(SUN1, "bgv", ["lu"]), cell(SPECIAL, "lead", ["ana"])],
      columns, rows, sundayDates: SUNDAYS,
    })).toBe(21 - 2 - 1);
  });
});
```

Note the `droppedPinNotices` expectation lists SUN1 first: `collectPins` walks `columns`, which `buildColumns` sorts by date (1 Mar before 8 Mar).

- [ ] **Step 2: Run to see it fail**

Run: `npx vitest run app/components/admin/__tests__/pinModel.test.ts`
Expected: FAIL — `../pinModel` does not exist.

- [ ] **Step 3: Write `pinModel.ts`**

```ts
// app/components/admin/pinModel.ts
//
// «Solo llenar vacíos» — the pure half (spec 2026-09-29-planner-trailing-saturday-and-fill-empty
// §3.2). With the switch on, every occupied voice seat on a column Auto writes becomes a pin
// (ADR-0041): hand-placed or from an earlier Auto alike (Frank, 2026-09-29: «Todo lo que ya
// está»). This module turns the board into the `pinned` array, refuses in Spanish before the
// fetch whatever the solver would refuse in English, checks the handshake, and computes what the
// board shows about each pin. No React, no network.

import type { SolveRequest, SolveResponse } from "@/app/api/admin/solve/route";
import { displayName, type RankMember } from "./candidateRanking";
import { isSolvable, weekForColumn, type GridCell, type GridColumn, type GridRow } from "./plannerModel";

export type PinRole = NonNullable<SolveRequest["pinned"]>[number]["role"];

export interface Pin {
  week: number;
  role: PinRole;
  person: string;
}

/** One occupant copy on the board: the cell, the member, and which copy of them in that cell. */
export interface PinSeat {
  columnId: string;
  rowId: string;
  memberId: string;
  /** Earlier copies of the same member in this cell — DD10 lets a member sit twice in one cell. */
  occurrence: number;
}

/** A seat not sent because its person already holds a seat of the same service. */
export interface DroppedPin extends PinSeat {
  person: string;
  /** The seat of that service the person keeps. */
  kept: PinSeat;
}

export interface CollectedPins {
  /** Distinct `(person, role, week)`, one per person per service, in board order. */
  pins: Pin[];
  /** The seat each pin came from, parallel to `pins`. */
  seats: PinSeat[];
  /** `${columnId}|${rowId}` of every cell holding a seat in `seats` (`applySolveResponse`). */
  pinnedCellKeys: Set<string>;
  dropped: DroppedPin[];
  /** Occupants whose id resolves to no member. */
  unresolved: PinSeat[];
  /** Members whose `member_name` is empty once trimmed. */
  unnamed: PinSeat[];
}

/** The solver's own cap (`PINNED_CAP`, `gcf/owt_solver_v2.py`): over it the request is refused. */
export const PINNED_CAP = 100;

/** Set directly under Auto, never through `solverRefusalMessage` (spec §3.2, E8). */
export const PIN_HANDSHAKE_REFUSAL = "El solver no respetó los lugares fijados; no se aplicó nada.";

/** The spec's precedence: one seat per person per service, Lead first, then BGV, then Coro. */
const VOICE_ROW_ORDER = ["lead", "bgv", "coro"] as const;

const ROLE_FOR: Record<"sunday_role" | "saturday_role", Partial<Record<string, PinRole>>> = {
  sunday_role: { lead: "Sun.Lead", bgv: "Sun.BGV", coro: "Sun.Choir" },
  saturday_role: { lead: "Sat.Lead", bgv: "Sat.BGV" },
};

const SHORT_MONTHS = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"];

const cellKeyOf = (columnId: string, rowId: string) => `${columnId}|${rowId}`;

export const serviceOfRole = (role: PinRole): "Sun" | "Sat" => (role.startsWith("Sun") ? "Sun" : "Sat");

export function pinSeatKey(seat: Pick<PinSeat, "columnId" | "rowId" | "memberId" | "occurrence">): string {
  return `${seat.columnId}|${seat.rowId}|${seat.memberId}#${seat.occurrence}`;
}

/** `2026-10-04` → `4 oct`. String arithmetic on the ISO date — no `Date`, no Intl. */
export function dayLabel(iso: string): string {
  return `${Number(iso.slice(8, 10))} ${SHORT_MONTHS[Number(iso.slice(5, 7)) - 1]}`;
}

export function serviceDayLabel(type: "sunday_role" | "saturday_role", iso: string): string {
  return `${type === "sunday_role" ? "domingo" : "sábado"} ${dayLabel(iso)}`;
}

/** `Lead del domingo 4 oct` — what a Spanish refusal points the admin at. */
export function seatLabel(seat: Pick<PinSeat, "columnId" | "rowId">, columns: GridColumn[], rows: GridRow[]): string {
  const column = columns.find((c) => c.columnId === seat.columnId);
  const label = rows.find((r) => r.id === seat.rowId)?.label ?? seat.rowId;
  if (!column || column.type === "special_role") return label;
  return `${label} del ${serviceDayLabel(column.type, column.date)}`;
}

export function collectPins(input: {
  cells: GridCell[];
  columns: GridColumn[];
  rows: GridRow[];
  members: RankMember[];
  /** The FULL month spine (`sundayDatesFull`) — week numbers are positional over it (E21). */
  sundayDates: string[];
}): CollectedPins {
  const { cells, columns, rows, members, sundayDates } = input;
  const byKey = new Map(cells.map((c) => [cellKeyOf(c.columnId, c.rowId), c]));
  const out: CollectedPins = { pins: [], seats: [], pinnedCellKeys: new Set(), dropped: [], unresolved: [], unnamed: [] };
  const keptInService = new Map<string, PinSeat>(); // `${person}|${week}|${Sun|Sat}` → kept seat

  for (const column of columns) {
    if (column.type === "special_role") continue;
    const week = weekForColumn(column, sundayDates);
    if (week == null) continue; // not a column Auto writes
    for (const rowId of VOICE_ROW_ORDER) {
      const row = rows.find((r) => r.id === rowId);
      const role = ROLE_FOR[column.type][rowId];
      if (!row || !role || !isSolvable(row, column)) continue;
      const cell = byKey.get(cellKeyOf(column.columnId, rowId));
      if (!cell) continue;
      cell.occupants.forEach((occupant, index) => {
        const occurrence = cell.occupants.slice(0, index).filter((o) => o.memberId === occupant.memberId).length;
        const seat: PinSeat = { columnId: column.columnId, rowId, memberId: occupant.memberId, occurrence };
        const member = members.find((x) => x._id === occupant.memberId);
        if (!member) {
          out.unresolved.push(seat);
          return;
        }
        if (!member.member_name.trim()) {
          out.unnamed.push(seat);
          return;
        }
        // Exact `member_name` — `memberIdToName`'s answer for a member that exists. The
        // solver accepts a pool member's exact spelling, trailing space and all.
        const person = member.member_name;
        const serviceKey = `${person}|${week}|${serviceOfRole(role)}`;
        const kept = keptInService.get(serviceKey);
        if (kept) {
          out.dropped.push({ ...seat, person, kept });
          return;
        }
        keptInService.set(serviceKey, seat);
        out.pins.push({ week, role, person });
        out.seats.push(seat);
        out.pinnedCellKeys.add(cellKeyOf(column.columnId, rowId));
      });
    }
  }
  return out;
}

const REFUSAL = "No se puede usar «Solo llenar vacíos»";

/**
 * Everything the solver would refuse about `pinned`, refused here first, in Spanish and
 * naming the cell (spec §3.2), so its English text never has to explain them. First
 * refusal wins, in the order below.
 */
export function pinRefusal(input: {
  collected: CollectedPins;
  columns: GridColumn[];
  rows: GridRow[];
  members: RankMember[];
  /** The request's `weekends_with_saturday`. */
  weekendsWithSaturday: number[];
  /** Every name in the request's three pools (`sunday_leads`, `saturday_leads`, `support`). */
  poolNames: string[];
}): string | null {
  const { collected, columns, rows, members, weekendsWithSaturday, poolNames } = input;
  const where = (seat: PinSeat) => seatLabel(seat, columns, rows);

  const ghost = collected.unresolved[0];
  if (ghost) {
    return `${REFUSAL}: en ${where(ghost)} hay alguien que ya no está en la lista de miembros. Quítalo de ese lugar y vuelve a intentarlo.`;
  }
  const unnamed = collected.unnamed[0];
  if (unnamed) {
    const who = members.find((x) => x._id === unnamed.memberId)?.alias?.trim() || "Un miembro";
    return `${REFUSAL}: ${who} (en ${where(unnamed)}) no tiene nombre en su ficha. Complétalo en Miembros o quítalo de ese lugar.`;
  }
  if (collected.pins.length > PINNED_CAP) {
    return `${REFUSAL}: hay ${collected.pins.length} lugares de voz ocupados y el solver acepta hasta ${PINNED_CAP}. Borra algunos o apaga «Solo llenar vacíos».`;
  }
  const satWeeks = new Set(weekendsWithSaturday);
  const offWeek = collected.pins.findIndex((p) => serviceOfRole(p.role) === "Sat" && !satWeeks.has(p.week));
  if (offWeek !== -1) {
    return `${REFUSAL}: ${where(collected.seats[offWeek])} no se envía al solver este mes. Quítalo de ese lugar o apaga «Solo llenar vacíos».`;
  }
  // `validate_config` (gcf/owt_solver_v2.py): a PINNED-ONLY name that differs from another
  // name only in case or surrounding spaces is refused; a pin on a pool member's exact name
  // never is.
  const pool = new Set(poolNames);
  const pinnedOnly = [...new Set(collected.pins.map((p) => p.person))].filter((n) => !pool.has(n));
  const spellings = new Map<string, string[]>();
  for (const name of [...pool, ...pinnedOnly]) {
    const k = name.trim().toLowerCase();
    spellings.set(k, [...(spellings.get(k) ?? []), name]);
  }
  for (const name of pinnedOnly) {
    const group = spellings.get(name.trim().toLowerCase()) ?? [];
    if (group.length < 2) continue;
    const other = group.find((n) => n !== name) ?? name;
    const seat = collected.seats[collected.pins.findIndex((p) => p.person === name)];
    return `${REFUSAL}: «${name}» (en ${where(seat)}) solo se distingue de «${other}» por mayúsculas o espacios, y el solver no puede saber cuál es cuál. Corrige el nombre en Miembros.`;
  }
  return null;
}

/**
 * E8: a success is applied only if the solver says it honoured every pin AND the schedule
 * shows each one, by EXACT name. Deliberately not `applySolveResponse`'s alias-tolerant,
 * case-insensitive `nameToId`: a pin is a promise about one spelling.
 */
export function pinHandshakeHolds(response: SolveResponse, pins: Pin[]): boolean {
  if (typeof response.pinned_honored !== "number" || response.pinned_honored !== pins.length) return false;
  const schedule = response.schedule ?? {};
  return pins.every((pin) => {
    const week = schedule[String(pin.week)];
    const service = serviceOfRole(pin.role) === "Sun" ? week?.Sunday : week?.Saturday;
    const field = pin.role.slice(4) as "Lead" | "BGV" | "Choir";
    const names = (service as Record<string, string[] | undefined> | undefined)?.[field];
    return Array.isArray(names) && names.includes(pin.person);
  });
}

export type PinConflictKind = "unavailable" | "outsidePool" | "duplicate";

/**
 * What the board says about a seat that will be pinned (spec §3.3, E3/E5) — the pin wins, so
 * these are shown, never blocking. Keyed by `pinSeatKey`.
 */
export function pinConflicts(input: {
  collected: CollectedPins;
  columns: GridColumn[];
  members: RankMember[];
  /** The request's pools: `sunday_leads`, `saturday_leads`, `support` (injected names included). */
  pools: { sundayLeads: string[]; saturdayLeads: string[]; support: string[] };
}): Map<string, PinConflictKind[]> {
  const { collected, columns, members, pools } = input;
  const out = new Map<string, PinConflictKind[]>();
  const add = (seat: PinSeat, kind: PinConflictKind) => {
    const key = pinSeatKey(seat);
    out.set(key, [...(out.get(key) ?? []), kind]);
  };
  const sunLead = new Set(pools.sundayLeads);
  const satLead = new Set([...pools.sundayLeads, ...pools.saturdayLeads]);
  const anyPool = new Set([...pools.sundayLeads, ...pools.saturdayLeads, ...pools.support]);
  collected.pins.forEach((pin, i) => {
    const seat = collected.seats[i];
    const column = columns.find((c) => c.columnId === seat.columnId);
    const member = members.find((x) => x._id === seat.memberId);
    if (column && (member?.unavailableDates ?? []).includes(column.date)) add(seat, "unavailable");
    const pool = pin.role === "Sun.Lead" ? sunLead : pin.role === "Sat.Lead" ? satLead : anyPool;
    if (!pool.has(pin.person)) add(seat, "outsidePool");
  });
  for (const d of collected.dropped) add(d, "duplicate");
  return out;
}

/** One line per seat left out as a duplicate, for the notice list under Auto. */
export function droppedPinNotices(input: {
  dropped: DroppedPin[];
  columns: GridColumn[];
  rows: GridRow[];
  members: RankMember[];
}): string[] {
  const { dropped, columns, rows, members } = input;
  return dropped.map((d) => {
    const member = members.find((x) => x._id === d.memberId);
    const who = member ? displayName(member) : d.person;
    if (d.kept.rowId === d.rowId) {
      return `${who} estaba dos veces en ${seatLabel(d, columns, rows)}; se fijó una sola vez.`;
    }
    const column = columns.find((c) => c.columnId === d.columnId);
    const day = column && column.type !== "special_role" ? serviceDayLabel(column.type, column.date) : d.columnId;
    const keptLabel = rows.find((r) => r.id === d.kept.rowId)?.label ?? d.kept.rowId;
    return `${who} estaba en dos lugares del ${day}; se fijó solo en ${keptLabel}.`;
  });
}

/** The confirm dialog's count: target minus occupants, over the voice seats Auto writes. */
export function emptyVoiceSeats(input: {
  cells: GridCell[];
  columns: GridColumn[];
  rows: GridRow[];
  sundayDates: string[];
}): number {
  const { cells, columns, rows, sundayDates } = input;
  const byKey = new Map(cells.map((c) => [cellKeyOf(c.columnId, c.rowId), c]));
  let n = 0;
  for (const column of columns) {
    if (column.type === "special_role" || weekForColumn(column, sundayDates) == null) continue;
    for (const row of rows) {
      if (!isSolvable(row, column) || row.target == null) continue;
      n += Math.max(0, row.target - (byKey.get(cellKeyOf(column.columnId, row.id))?.occupants.length ?? 0));
    }
  }
  return n;
}
```

- [ ] **Step 4: Run to see it pass**

Run: `npx vitest run app/components/admin/__tests__/pinModel.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add app/components/admin/pinModel.ts app/components/admin/__tests__/pinModel.test.ts
git commit -m "feat(planner): turn the board into solver pins, and refuse what the solver would" -m "With «Solo llenar vacíos» every occupied voice seat on a column Auto writes becomes a pin. One seat per person per service (the solver refuses two), Lead before BGV before Coro. What the solver would refuse in English is refused first in Spanish, naming the cell."
```

---

### Task 4: `applySolveResponse` keeps waivers on pinned cells

**Files:**
- Modify: `app/components/admin/plannerModel.ts` (`applySolveResponse`)
- Test: `app/components/admin/__tests__/plannerModel.test.ts` (append a `describe`)

**Interfaces:**
- Produces: `applySolveResponse(input: { …existing…; pinnedCellKeys?: ReadonlySet<string> })`. Absent ⇒ byte-identical to today.

- [ ] **Step 1: Write the failing test** (append to `plannerModel.test.ts`; reuse that file's imports, adding `createColumnId`, `buildColumns`, `buildRows`, `applySolveResponse` if not already imported)

```ts
describe("applySolveResponse under pins (spec §3.2 Waivers)", () => {
  const sundays = ["2026-03-01", "2026-03-08", "2026-03-15", "2026-03-22"];
  const cols = buildColumns({ sundayDates: sundays, activeSatDates: [], specials: [] });
  const SUN1 = createColumnId("sunday_role", "2026-03-01");
  const who = [
    { _id: "ana", member_name: "Ana Karen Villalobos", alias: "Ana", memberType: ["voz", "sunday_lead"] },
    { _id: "beto", member_name: "Alberto Ruiz Cano", alias: "Beto", memberType: ["voz", "support"] },
  ];
  const previous = [{
    columnId: SUN1, rowId: "lead", occupants: [{ memberId: "ana" }, { memberId: "beto" }], origin: "manual" as const,
    overrides: ["ana", "beto"], overrideReasons: { ana: "Regla: excluido de Sun.Lead", beto: "Regla: excluido de *.Lead" },
  }];
  const response = {
    ok: true,
    schedule: { "1": { Sunday: { Lead: ["Ana Karen Villalobos"], BGV: [], Choir: [] } } },
  };

  it("keeps origin and the waivers of the occupants that came back, on a cell that sent a pin", () => {
    const out = applySolveResponse({
      response, previousCells: previous, columns: cols, rows: buildRows(), sundayDates: sundays,
      activeSatDates: [], members: who, pinnedCellKeys: new Set([`${SUN1}|lead`]),
    });
    expect(out.cells.find((c) => c.columnId === SUN1 && c.rowId === "lead")).toEqual({
      columnId: SUN1, rowId: "lead", occupants: [{ memberId: "ana" }], origin: "manual",
      overrides: ["ana"], overrideReasons: { ana: "Regla: excluido de Sun.Lead" },
    });
  });

  it("writes the cell exactly as today without pinnedCellKeys", () => {
    const out = applySolveResponse({
      response, previousCells: previous, columns: cols, rows: buildRows(), sundayDates: sundays,
      activeSatDates: [], members: who,
    });
    expect(out.cells.find((c) => c.columnId === SUN1 && c.rowId === "lead")).toEqual({
      columnId: SUN1, rowId: "lead", occupants: [{ memberId: "ana" }], origin: "auto",
    });
  });
});
```

- [ ] **Step 2: Run to see it fail**

Run: `npx vitest run app/components/admin/__tests__/plannerModel.test.ts -t "under pins"`
Expected: FAIL — the first case gets `origin: "auto"` and no waivers.

- [ ] **Step 3: Implement**

Add the input field (with its doc) and replace the `byKey.set(...)` at the end of the row loop:

```ts
  /**
   * «Solo llenar vacíos» (spec 2026-09-29 §3.2): the cells that sent at least one pin, by
   * `${columnId}|${rowId}` (`CollectedPins.pinnedCellKeys`). Such a cell keeps its `origin`,
   * `overrides` and `overrideReasons`, pruned to the occupants that came back. Absent ⇒
   * every solvable cell is rewritten as `origin: "auto"`, exactly as before pins existed.
   */
  pinnedCellKeys?: ReadonlySet<string>;
```

```ts
      const key = `${column.columnId}|${row.id}`;
      const next: GridCell = {
        columnId: column.columnId,
        rowId: row.id,
        occupants: ids.map((memberId) => ({ memberId })),
        origin: "auto",
      };
      const prev = byKey.get(key);
      if (prev && pinnedCellKeys?.has(key)) {
        next.origin = prev.origin;
        const back = new Set(ids);
        const overrides = (prev.overrides ?? []).filter((id) => back.has(id));
        if (overrides.length > 0) {
          next.overrides = overrides;
          const reasons: Record<string, string> = {};
          for (const id of overrides) {
            const reason = prev.overrideReasons?.[id];
            if (reason !== undefined) reasons[id] = reason;
          }
          if (Object.keys(reasons).length > 0) next.overrideReasons = reasons;
        }
      }
      byKey.set(key, next);
```

and destructure `pinnedCellKeys` with the other inputs.

- [ ] **Step 4: Run to see it pass**

Run: `npx vitest run app/components/admin/__tests__/plannerModel.test.ts`
Expected: PASS (whole file).

- [ ] **Step 5: Commit**

```bash
git add app/components/admin/plannerModel.ts app/components/admin/__tests__/plannerModel.test.ts
git commit -m "feat(planner): a pinned cell keeps its origin and waivers through a solve" -m "A seat the admin kept with «Asignar de todos modos» comes back from the solver as a pin; rewriting the cell as origin auto would silently turn that exception into a fresh violation."
```

---

### Task 5: `pinViolations.ts` — name what the solver gave up

**Files:**
- Create: `app/components/admin/pinViolations.ts`
- Test: `app/components/admin/__tests__/pinViolations.test.ts`

**Interfaces:**
- Consumes: `capLabel`, `resolvedCapValue`, `resolvedNameOrRaw`, `saturdayForWeek`, `SolverConfig` (plannerModel); `parsePattern` (ruleEnforcement); `Pin`, `serviceDayLabel`, `serviceOfRole` (pinModel).
- Produces:
  - `type ParsedViolation` (six kinds below)
  - `parsePinViolation(entry: string): ParsedViolation | null`
  - `pinViolationNotices(input: { violations: string[]; ceilingProven: boolean | undefined; config: SolverConfig; members: RankMember[]; pins: Pin[]; sundayDates: string[] }): string[]`

Facts the parser rests on (`gcf/owt_solver_v2.py`): entries are `<person>: <source>` (count, `:1262`), `W<n>: <source>` (presence, `:1087`), `W<n> <Sun|Sat>: <source>` (pair, `:1055`), `W<n>-<n+1> <person>: <source>` (consecutive, `:1104`), `builtin:mandatory_lead:W<n>:<Sun|Sat>` (`:968`), `builtin:sat_anchor:W<n>` (`:1033`). `source` is the raw DSL clause AFTER `resolve_dsl_templates` (a number, never `{weeks-N}`); in an `&` chain only the FIRST clause carries the person's name (`:428-540`). `SolverConfig` has no consecutive rule form, so a consecutive entry always renders the generic line.

- [ ] **Step 1: Write the failing test**

```ts
// app/components/admin/__tests__/pinViolations.test.ts
import { describe, expect, it } from "vitest";

import type { RankMember } from "../candidateRanking";
import type { SolverConfig } from "../plannerModel";
import type { Pin } from "../pinModel";
import { parsePinViolation, pinViolationNotices } from "../pinViolations";

const SUNDAYS = ["2026-10-04", "2026-10-11", "2026-10-18", "2026-10-25"];
const members = [
  { _id: "andy", member_name: "Andrea Solís", alias: "Andy", memberType: ["voz", "support"] },
  { _id: "tay", member_name: "Taylor Ríos", alias: "Tay", memberType: ["voz", "support"] },
  { _id: "vale", member_name: "Valeria Paz", alias: "Vale", memberType: ["voz", "support"] },
] as RankMember[];
const config: SolverConfig = {
  sundayLeads: [], saturdayLeads: [], support: ["andy", "tay", "vale"],
  restrictions: [{
    id: "r", person: "Andy", excludedPatterns: ["Sun.BGV"], fairness: "none", fairnessSlack: 0, weekExclusions: [],
    caps: [
      { id: "c1", pattern: "Sun.*", op: "==", value: 1, relative: false, relOffset: 2 },
      { id: "c2", pattern: "Sat.BGV", op: ">=", value: 0, relative: true, relOffset: 2 },
    ],
  }],
  conflicts: [{ id: "k", personA: "Andy", personB: "Tay", pattern: "*.*" }],
  presence: [{ id: "p", persons: ["Tay", "Vale"], pattern: "Sun.BGV" }],
};
const pin = (week: number, role: Pin["role"], person: string): Pin => ({ week, role, person });
const notices = (violations: string[], pins: Pin[], ceilingProven: boolean | undefined = true) =>
  pinViolationNotices({ violations, ceilingProven, config, members, pins, sundayDates: SUNDAYS });

describe("parsePinViolation", () => {
  it("reads the six forms and nothing else", () => {
    expect(parsePinViolation("builtin:mandatory_lead:W2:Sun")).toEqual({ kind: "mandatoryLead", week: 2, service: "Sun" });
    expect(parsePinViolation("builtin:sat_anchor:W3")).toEqual({ kind: "satAnchor", week: 3 });
    expect(parsePinViolation("W1-2 Andrea Solís: Andrea Solís !consecutive on *.Lead"))
      .toEqual({ kind: "consecutive", week: 1, person: "Andrea Solís", source: "Andrea Solís !consecutive on *.Lead" });
    expect(parsePinViolation("W2 Sat: Andrea Solís !with Taylor Ríos on *.*"))
      .toEqual({ kind: "pair", week: 2, service: "Sat", source: "Andrea Solís !with Taylor Ríos on *.*" });
    expect(parsePinViolation("W4: any_of(Taylor Ríos,Valeria Paz) on Sun.BGV each_week"))
      .toEqual({ kind: "presence", week: 4, source: "any_of(Taylor Ríos,Valeria Paz) on Sun.BGV each_week" });
    expect(parsePinViolation("Andrea Solís: Sun.* == 1")).toEqual({ kind: "count", person: "Andrea Solís", source: "Sun.* == 1" });
    expect(parsePinViolation("builtin:something_new:W1")).toBeNull();
    expect(parsePinViolation("W1-3 Andrea Solís: x")).toBeNull();
    expect(parsePinViolation("no separator")).toBeNull();
  });
});

describe("pinViolationNotices", () => {
  it("names a count rule as the rules card does, whether or not its clause carries the person's name", () => {
    expect(notices(["Andrea Solís: Andrea Solís !in Sun.BGV & Sun.* == 1"], [])).toEqual([
      "El solver dejó de cumplir una regla para acomodar lo que ya estaba puesto (Andrea Solís: Andrea Solís !in Sun.BGV & Sun.* == 1).",
    ]); // not a count clause the config can produce — generic
    expect(notices(["Andrea Solís: Andrea Solís Sun.* == 1"], [pin(1, "Sun.Lead", "Andrea Solís")])).toEqual([
      "No se cumplió «Sun.* == 1» de Andy — por lo que ya estaba puesto.",
    ]);
    // A relative cap arrives resolved: {weeks-2} is 2 in a four-Sunday month; the card says sem−2.
    expect(notices(["Andrea Solís: Sat.BGV >= 2"], [pin(1, "Sun.Lead", "Andrea Solís")])).toEqual([
      "No se cumplió «Sat.BGV >= sem−2» de Andy — lo cedió el solver para acomodar lo que ya estaba puesto.",
    ]);
  });

  it("names a pair rule with its service and date, and judges it caused by a pin of either person that week", () => {
    expect(notices(["W2 Sat: Andrea Solís !with Taylor Ríos on *.*"], [pin(2, "Sat.BGV", "Taylor Ríos")])).toEqual([
      "No se cumplió «Andy ≠ Tay en *.*» (sábado 10 oct) — por lo que ya estaba puesto.",
    ]);
  });

  it("names a presence rule with its week", () => {
    expect(notices(["W4: any_of(Taylor Ríos,Valeria Paz) on Sun.BGV each_week"], [])).toEqual([
      "No se cumplió «Tay, Vale en Sun.BGV c/sem» (semana 4) — lo cedió el solver para acomodar lo que ya estaba puesto.",
    ]);
  });

  it("words the builtins by service and date", () => {
    expect(notices(["builtin:mandatory_lead:W2:Sun", "builtin:sat_anchor:W3"], [])).toEqual([
      "El domingo 11 oct quedó sin líder — lo cedió el solver para acomodar lo que ya estaba puesto.",
      "El sábado 17 oct quedó sin líder de sábado — lo cedió el solver para acomodar lo que ya estaba puesto.",
    ]);
  });

  it("renders a consecutive entry, which no planner rule produces, as the generic line and never «dos semanas seguidas»", () => {
    const [line] = notices(["W4-5 Andrea Solís: Andrea Solís !consecutive on Sat.*"], []);
    expect(line).toBe(
      "El solver dejó de cumplir una regla para acomodar lo que ya estaba puesto (W4-5 Andrea Solís: Andrea Solís !consecutive on Sat.*).",
    );
    expect(line).not.toContain("seguidas");
  });

  it("adds one caveat line when the ceiling was not proven, and none when there is nothing to report", () => {
    expect(notices([], [], false)).toEqual([
      "Puede que el solver haya cedido más reglas de las necesarias: no alcanzó a comprobarlo.",
    ]);
    expect(notices([], [], true)).toEqual([]);
    expect(notices([], [], undefined)).toEqual([]);
  });
});
```

- [ ] **Step 2: Run to see it fail**

Run: `npx vitest run app/components/admin/__tests__/pinViolations.test.ts`
Expected: FAIL — module missing.

- [ ] **Step 3: Write `pinViolations.ts`**

```ts
// app/components/admin/pinViolations.ts
//
// What the solver set aside to honour the pins (ADR-0041 `pin_violations`), in the admin's
// words (spec 2026-09-29 §3.3). Each entry is parsed per its six forms, mapped back to the rule
// in the config it came from, and named the way the rules card names it. An entry that does not
// parse or match renders one generic line — never dropped.

import type { RankMember } from "./candidateRanking";
import {
  capLabel,
  resolvedCapValue,
  resolvedNameOrRaw,
  saturdayForWeek,
  type SolverConfig,
} from "./plannerModel";
import { serviceDayLabel, serviceOfRole, type Pin } from "./pinModel";
import { parsePattern } from "./ruleEnforcement";

export type ParsedViolation =
  | { kind: "count"; person: string; source: string }
  | { kind: "presence"; week: number; source: string }
  | { kind: "pair"; week: number; service: "Sun" | "Sat"; source: string }
  | { kind: "consecutive"; week: number; person: string; source: string }
  | { kind: "mandatoryLead"; week: number; service: "Sun" | "Sat" }
  | { kind: "satAnchor"; week: number };

export function parsePinViolation(entry: string): ParsedViolation | null {
  let m = /^builtin:mandatory_lead:W(\d+):(Sun|Sat)$/.exec(entry);
  if (m) return { kind: "mandatoryLead", week: Number(m[1]), service: m[2] as "Sun" | "Sat" };
  m = /^builtin:sat_anchor:W(\d+)$/.exec(entry);
  if (m) return { kind: "satAnchor", week: Number(m[1]) };
  if (entry.startsWith("builtin:")) return null;
  m = /^W(\d+)-(\d+) (.+?): (.+)$/.exec(entry);
  if (m) {
    return Number(m[2]) === Number(m[1]) + 1
      ? { kind: "consecutive", week: Number(m[1]), person: m[3], source: m[4] }
      : null;
  }
  m = /^W(\d+) (Sun|Sat): (.+)$/.exec(entry);
  if (m) return { kind: "pair", week: Number(m[1]), service: m[2] as "Sun" | "Sat", source: m[3] };
  m = /^W(\d+): (.+)$/.exec(entry);
  if (m) return { kind: "presence", week: Number(m[1]), source: m[2] };
  m = /^(.+?): (.+)$/.exec(entry);
  if (m) return { kind: "count", person: m[1], source: m[2] };
  return null;
}

const CAUSED = " — por lo que ya estaba puesto.";
const CEDED = " — lo cedió el solver para acomodar lo que ya estaba puesto.";
const CAVEAT = "Puede que el solver haya cedido más reglas de las necesarias: no alcanzó a comprobarlo.";
const generic = (entry: string) =>
  `El solver dejó de cumplir una regla para acomodar lo que ya estaba puesto (${entry}).`;

/** A count clause's tail; the person's name, when the clause carries one, sits before it. */
const COUNT_TAIL = /(?:^|\s)(\S+)\s*(==|>=|<=)\s*(\d+)\s*$/;
const PAIR = /^(.+?)\s+!with\s+(.+?)\s+on\s+(\S+)\s*$/;
const PRESENCE = /^any_of\((.+)\)\s+on\s+(\S+)\s+each_week\s*$/i;
const ROW_OF_FIELD: Record<string, string> = { Lead: "lead", BGV: "bgv", Choir: "coro" };

/** Whether `pattern` binds the role a pin holds — the rules card's own parser (`parsePattern`). */
function patternBindsRole(pattern: string, role: Pin["role"]): boolean {
  const parsed = parsePattern(pattern);
  if (!parsed) return false;
  const service = serviceOfRole(role);
  return parsed.rows.includes(ROW_OF_FIELD[role.slice(4)]) && (parsed.service === "*" || parsed.service === service);
}

export function pinViolationNotices(input: {
  violations: string[];
  /** `violation_ceiling_proven`; `false` adds one caveat line. */
  ceilingProven: boolean | undefined;
  config: SolverConfig;
  members: RankMember[];
  pins: Pin[];
  /** The FULL month spine — week numbers are positional over it. */
  sundayDates: string[];
}): string[] {
  const { violations, ceilingProven, config, members, pins, sundayDates } = input;
  const res = (name: string) => resolvedNameOrRaw(name, members);
  const weeks = sundayDates.length;
  const dayOf = (week: number, service: "Sun" | "Sat") => {
    const iso = service === "Sun" ? sundayDates[week - 1] : saturdayForWeek(week, sundayDates);
    return iso ? serviceDayLabel(service === "Sun" ? "sunday_role" : "saturday_role", iso) : null;
  };
  const tail = (caused: boolean) => (caused ? CAUSED : CEDED);

  const lines = violations.map((entry) => {
    const v = parsePinViolation(entry);
    if (!v) return generic(entry);
    switch (v.kind) {
      case "count": {
        const t = COUNT_TAIL.exec(v.source);
        if (!t || /[!&]/.test(v.source)) return generic(entry);
        const [, pattern, op, n] = t;
        for (const r of config.restrictions) {
          if (res(r.person) !== v.person) continue;
          const cap = r.caps.find((c) => c.pattern === pattern && c.op === op && resolvedCapValue(c, weeks) === Number(n));
          if (!cap) continue;
          const caused = pins.some((p) => p.person === v.person && patternBindsRole(pattern, p.role));
          return `No se cumplió «${capLabel(cap)}» de ${r.person}${tail(caused)}`;
        }
        return generic(entry);
      }
      case "pair": {
        const p = PAIR.exec(v.source);
        const day = dayOf(v.week, v.service);
        if (!p || !day) return generic(entry);
        const [, a, b, pattern] = p;
        const rule = config.conflicts.find((c) =>
          c.pattern === pattern
          && ((res(c.personA) === a && res(c.personB) === b) || (res(c.personA) === b && res(c.personB) === a)));
        if (!rule) return generic(entry);
        const caused = pins.some((x) => x.week === v.week && serviceOfRole(x.role) === v.service && (x.person === a || x.person === b));
        return `No se cumplió «${rule.personA} ≠ ${rule.personB} en ${rule.pattern}» (${day})${tail(caused)}`;
      }
      case "presence": {
        const p = PRESENCE.exec(v.source);
        if (!p) return generic(entry);
        const names = p[1].split(",").map((s) => s.trim()).filter(Boolean);
        const pattern = p[2];
        const rule = config.presence.find((r) => {
          const mine = r.persons.map(res);
          return r.pattern === pattern && mine.length === names.length && mine.every((x) => names.includes(x));
        });
        if (!rule) return generic(entry);
        const caused = pins.some((x) => x.week === v.week && names.includes(x.person));
        return `No se cumplió «${rule.persons.join(", ")} en ${rule.pattern} c/sem» (semana ${v.week})${tail(caused)}`;
      }
      case "consecutive":
        // `SolverConfig` has no consecutive rule form: nothing to name it after.
        return generic(entry);
      case "mandatoryLead": {
        const day = dayOf(v.week, v.service);
        if (!day) return generic(entry);
        const lead = v.service === "Sun" ? "Sun.Lead" : "Sat.Lead";
        const caused = pins.some((x) => x.week === v.week && x.role === lead);
        return `El ${day} quedó sin líder${tail(caused)}`;
      }
      case "satAnchor": {
        const day = dayOf(v.week, "Sat");
        if (!day) return generic(entry);
        const caused = pins.some((x) => x.week === v.week && x.role === "Sat.Lead");
        return `El ${day} quedó sin líder de sábado${tail(caused)}`;
      }
    }
  });
  if (ceilingProven === false) lines.push(CAVEAT);
  return lines;
}
```

Check against the first count expectation: `"Andrea Solís !in Sun.BGV & Sun.* == 1"` contains `!` and `&`, so it is generic — the solver never emits that shape (it splits on `&` before recording `source`); the guard keeps a malformed entry from being mis-named.

- [ ] **Step 4: Run to see it pass**

Run: `npx vitest run app/components/admin/__tests__/pinViolations.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add app/components/admin/pinViolations.ts app/components/admin/__tests__/pinViolations.test.ts
git commit -m "feat(planner): name the rules the solver set aside to honour pins" -m "pin_violations arrive in the solver's grammar with DSL sources. Each is mapped back to the rule in the config and named as the rules card shows it, with its service and date; an entry that does not match renders one generic line rather than disappearing."
```

---

### Task 6: `clearCells.ts` — the pure half of «Borrar»

**Files:**
- Create: `app/components/admin/clearCells.ts`
- Test: `app/components/admin/__tests__/clearCells.test.ts`

**Interfaces:**
- Produces:
  - `type ClearWhat = "voices" | "instruments" | "both"`
  - `type ClearScope = { kind: "month" } | { kind: "service"; columnId: string }`
  - `interface ClearPlan { cellKeys: Set<string>; seats: number; handPlacedApprox: number }`
  - `CLEAR_WHAT_LABEL: Record<ClearWhat, string>` → `"Voces" | "Instrumentos" | "Voces e instrumentos"`
  - `planClear(input: { cells: GridCell[]; rows: GridRow[]; columns: GridColumn[]; scope: ClearScope; what: ClearWhat }): ClearPlan`
  - `applyClear(cells: GridCell[], plan: ClearPlan): GridCell[]`
  - `restoreCleared(live: GridCell[], prior: GridCell[], columns: GridColumn[]): GridCell[]`
  - `dropClearedMarkers<T extends { columnId: string; rowId: string }>(markers: T[], plan: ClearPlan): T[]`

- [ ] **Step 1: Write the failing test**

```ts
// app/components/admin/__tests__/clearCells.test.ts
import { describe, expect, it } from "vitest";

import { buildColumns, buildRows, createColumnId, type GridCell } from "../plannerModel";
import { applyClear, dropClearedMarkers, planClear, restoreCleared } from "../clearCells";

const cols = buildColumns({ sundayDates: ["2026-03-01", "2026-03-08"], activeSatDates: [], specials: [{ date: "2026-03-04", name: "Vigilia" }] });
const rows = buildRows();
const SUN1 = createColumnId("sunday_role", "2026-03-01");
const SUN2 = createColumnId("sunday_role", "2026-03-08");
const SPECIAL = createColumnId("special_role", "2026-03-04");
const cell = (columnId: string, rowId: string, ids: string[], origin: GridCell["origin"] = "auto", extra: Partial<GridCell> = {}): GridCell =>
  ({ columnId, rowId, occupants: ids.map((memberId) => ({ memberId })), origin, ...extra });

const board: GridCell[] = [
  cell(SUN1, "lead", ["ana"], "manual", { overrides: ["ana"], overrideReasons: { ana: "Regla: x" } }),
  cell(SUN1, "coro", ["lu", "beto"]),
  cell(SUN1, "instrumento:Drums", ["paco"]),
  cell(SUN1, "foh:Console", ["zoe"], "manual"),
  cell(SUN2, "bgv", ["beto"], "manual"),
  cell(SPECIAL, "lead", ["ana"]),
];

describe("planClear", () => {
  it("scopes to one service and counts its seats, never FOH", () => {
    const voices = planClear({ cells: board, rows, columns: cols, scope: { kind: "service", columnId: SUN1 }, what: "voices" });
    expect([...voices.cellKeys]).toEqual([`${SUN1}|lead`, `${SUN1}|coro`]);
    expect(voices.seats).toBe(3);
    expect(voices.handPlacedApprox).toBe(1);
    expect(planClear({ cells: board, rows, columns: cols, scope: { kind: "service", columnId: SUN1 }, what: "instruments" }).seats).toBe(1);
    expect(planClear({ cells: board, rows, columns: cols, scope: { kind: "service", columnId: SUN1 }, what: "both" }).seats).toBe(4);
  });

  it("covers every column of the month, specials included", () => {
    const month = planClear({ cells: board, rows, columns: cols, scope: { kind: "month" }, what: "voices" });
    expect(month.seats).toBe(5);
    expect(month.handPlacedApprox).toBe(2);
  });
});

describe("applyClear / restoreCleared / dropClearedMarkers", () => {
  const plan = planClear({ cells: board, rows, columns: cols, scope: { kind: "service", columnId: SUN1 }, what: "voices" });

  it("empties exactly the planned cells and their waivers, leaving every other cell by reference", () => {
    const next = applyClear(board, plan);
    expect(next[0]).toEqual({ columnId: SUN1, rowId: "lead", occupants: [], origin: "empty" });
    expect(next[1]).toEqual({ columnId: SUN1, rowId: "coro", occupants: [], origin: "empty" });
    for (const i of [2, 3, 4, 5]) expect(next[i]).toBe(board[i]);
  });

  it("puts back only the cleared cells' prior state onto the live array", () => {
    const cleared = applyClear(board, plan);
    const live = cleared.map((c) => (c.columnId === SUN2 && c.rowId === "bgv" ? { ...c, occupants: [{ memberId: "ana" }] } : c));
    const prior = board.filter((c) => plan.cellKeys.has(`${c.columnId}|${c.rowId}`));
    const restored = restoreCleared(live, prior, cols);
    expect(restored.find((c) => c.columnId === SUN1 && c.rowId === "lead")).toEqual(board[0]);
    expect(restored.find((c) => c.columnId === SUN2 && c.rowId === "bgv")?.occupants).toEqual([{ memberId: "ana" }]);
  });

  it("never restores a cell whose column is no longer on the grid", () => {
    const prior = board.filter((c) => plan.cellKeys.has(`${c.columnId}|${c.rowId}`));
    expect(restoreCleared([], prior, [])).toEqual([]);
  });

  it("drops the unfilled markers of the cleared cells only", () => {
    const markers = [{ columnId: SUN1, rowId: "coro" }, { columnId: SUN1, rowId: "coro" }, { columnId: SUN2, rowId: "lead" }];
    expect(dropClearedMarkers(markers, plan)).toEqual([{ columnId: SUN2, rowId: "lead" }]);
  });
});
```

- [ ] **Step 2: Run to see it fail**

Run: `npx vitest run app/components/admin/__tests__/clearCells.test.ts`
Expected: FAIL — module missing.

- [ ] **Step 3: Write `clearCells.ts`**

```ts
// app/components/admin/clearCells.ts
//
// «Borrar» (spec 2026-09-29 §3.1 E6, §3.2): clear voices, instruments or both, for one service or
// the whole month. FOH is never cleared in bulk — nothing refills it. Pure: `MonthGenerator` owns
// the confirm, the undo and the setters.

import type { GridCell, GridColumn, GridRow } from "./plannerModel";

export type ClearWhat = "voices" | "instruments" | "both";
export type ClearScope = { kind: "month" } | { kind: "service"; columnId: string };

export interface ClearPlan {
  /** `${columnId}|${rowId}` of every cell the clear empties. */
  cellKeys: Set<string>;
  /** Occupants removed — the live count every menu item shows. */
  seats: number;
  /**
   * Occupants in cells whose `origin` is `"manual"`. Approximate both ways: `origin` is per
   * cell, so an Auto pick in a hand-edited cell counts and a hand pick left in an Auto cell
   * does not — the dialog says «aproximadamente».
   */
  handPlacedApprox: number;
}

export const CLEAR_WHAT_LABEL: Record<ClearWhat, string> = {
  voices: "Voces",
  instruments: "Instrumentos",
  both: "Voces e instrumentos",
};

const keyOf = (c: { columnId: string; rowId: string }) => `${c.columnId}|${c.rowId}`;

function clears(row: GridRow, what: ClearWhat): boolean {
  if (row.category === "voz") return what !== "instruments";
  if (row.category === "instrumento") return what !== "voices";
  return false; // FOH
}

export function planClear(input: {
  cells: GridCell[];
  rows: GridRow[];
  columns: GridColumn[];
  scope: ClearScope;
  what: ClearWhat;
}): ClearPlan {
  const { cells, rows, columns, scope, what } = input;
  const rowById = new Map(rows.map((r) => [r.id, r]));
  const inScope = scope.kind === "month" ? new Set(columns.map((c) => c.columnId)) : new Set([scope.columnId]);
  const plan: ClearPlan = { cellKeys: new Set(), seats: 0, handPlacedApprox: 0 };
  for (const cell of cells) {
    const row = rowById.get(cell.rowId);
    if (!row || !inScope.has(cell.columnId) || !clears(row, what) || cell.occupants.length === 0) continue;
    plan.cellKeys.add(keyOf(cell));
    plan.seats += cell.occupants.length;
    if (cell.origin === "manual") plan.handPlacedApprox += cell.occupants.length;
  }
  return plan;
}

/** Empties the planned cells and their waivers; every other cell survives by reference. */
export function applyClear(cells: GridCell[], plan: ClearPlan): GridCell[] {
  return cells.map((c) =>
    plan.cellKeys.has(keyOf(c)) ? { columnId: c.columnId, rowId: c.rowId, occupants: [], origin: "empty" as const } : c,
  );
}

/** «Deshacer»: re-applies ONLY the cleared cells' prior state onto the live array. */
export function restoreCleared(live: GridCell[], prior: GridCell[], columns: GridColumn[]): GridCell[] {
  const onGrid = new Set(columns.map((c) => c.columnId));
  const back = new Map(prior.filter((c) => onGrid.has(c.columnId)).map((c) => [keyOf(c), c]));
  const next = live.map((c) => back.get(keyOf(c)) ?? c);
  const present = new Set(live.map(keyOf));
  for (const [key, c] of back) if (!present.has(key)) next.push(c);
  return next;
}

/** A cleared cell is empty by the admin's choice, so its «Sin cubrir» markers go with it. */
export function dropClearedMarkers<T extends { columnId: string; rowId: string }>(markers: T[], plan: ClearPlan): T[] {
  return markers.filter((u) => !plan.cellKeys.has(keyOf(u)));
}
```

- [ ] **Step 4: Run to see it pass**

Run: `npx vitest run app/components/admin/__tests__/clearCells.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add app/components/admin/clearCells.ts app/components/admin/__tests__/clearCells.test.ts
git commit -m "feat(planner): plan, apply and undo a «Borrar» of voices or instruments" -m "E1 makes Auto keep everything on the board, so re-shuffling Auto's own picks means clearing them first. FOH is never cleared in bulk because nothing refills it."
```

---

### Task 7: One solve seam for both Auto paths, and a notice list — no behaviour change

Both Auto paths each have their own `buildSolveRequest`, fetch, 422 parse and `applySolveResponse` (spec §0). Delivery 3 must add pins, the handshake and the no-vacate flag to ONE place. This task only moves code; the whole planner suite is the guard.

**Files:**
- Modify: `app/components/admin/MonthGenerator.tsx` (`autoNotice` state, `handleAuto`, `solveWithDerivedHistory`, `autoState`, the reset at ~:2726)
- Modify: `app/components/admin/PlannerGrid.tsx` (`AutoState`, the notice render)

**Interfaces:**
- Produces (MonthGenerator-internal): `interface PreparedSolve { request: SolveRequest; notices: string[] }`, `prepareSolve(config: SolverConfig, historyEntries: SolverHistoryEntry[]): PreparedSolve | null` (synchronous; runs every pre-fetch refusal exit itself and returns `null`), `runSolve(config: SolverConfig, prepared: PreparedSolve, historyMonths?: string): Promise<void>` (fetch → exits). Neither touches `autoPending`: the per-browser path raises it only after its synchronous pre-flight, the derived path before the history read (keep both).
- Produces (PlannerGrid): `AutoState.notices?: string[]` replaces `notice?: string | null`.

- [ ] **Step 1: `AutoState` and its render (PlannerGrid)**

```ts
export interface AutoState {
  pending: boolean;
  error: string | null;
  /**
   * Non-blocking notes about the last Auto run, rendered IN ORDER and never replaced by a
   * later write in the same run (spec 2026-09-29 §2.3): Saturday floors left out, then the
   * trailing Saturday (delivery 2), then «Solo llenar vacíos» (duplicates, give-ups, caveat).
   */
  notices?: string[];
  disabledReason: string | null;
}
```

Replace the single `autoState.notice` paragraph with:

```tsx
        {mode === "create" && (autoState.notices ?? []).length > 0 && (
          <div className="basis-full space-y-1" data-auto-notices="">
            {(autoState.notices ?? []).map((line, i) => (
              <p key={i} className="font-body text-xs text-warning-strong">{line}</p>
            ))}
          </div>
        )}
```

- [ ] **Step 2: The state (MonthGenerator)**

```ts
  /** Notes about the last Auto run, in order (`AutoState.notices`); shown, never silent. */
  const [autoNotices, setAutoNotices] = useState<string[]>([]);
```

Replace every `setAutoNotice(null)` with `setAutoNotices([])` (the step reset at ~:2726 and both Auto entry points), and `autoState` becomes:

```ts
  const autoState: AutoState = { pending: autoPending, error: autoError, notices: autoNotices, disabledReason: gateBlocked };
```

Add `import type { SolveRequest, SolveResponse } from "@/app/api/admin/solve/route";` (extend the existing type import).

- [ ] **Step 3: The seam (MonthGenerator), placed right after `applySpecialFill`**

```ts
  /** What `prepareSolve` hands `runSolve`: the request, and the notices already shown. */
  interface PreparedSolve {
    request: SolveRequest;
    /** Shown before the fetch; `runSolve` appends, never replaces (spec §2.3). */
    notices: string[];
  }

  /**
   * THE seam both Auto paths share, first half (spec 2026-09-29 §3.2 «One seam, both paths»):
   * everything synchronous before the fetch. Reads `cells`, `columns`, `rows` and the rest from
   * the render it was defined in — for the derived path that is the latest render, because it
   * is reached through `solveWithDerivedHistoryRef`. Runs every pre-fetch refusal exit itself
   * (each calls `applySpecialFill` once) and returns `null` for them.
   *
   * Owns no `autoPending`: the per-browser path raises it only AFTER this returns (it has
   * nothing to wait for), the derived path before its history read. Keep that asymmetry.
   */
  function prepareSolve(config: SolverConfig, historyEntries: SolverHistoryEntry[]): PreparedSolve | null {
    setAutoError(null);
    setAutoNotices([]);
    const built = buildSolveRequest({
      config,
      members,
      sundayDates: sundayDatesFull,
      activeSatDates,
      historyEntries,
      year,
      month,
    });
    if (!built.ok) {
      // Pre-flight refusal (fact 14) — never reaches the network. E5: "a month with no
      // Sunday leads must still fill its specials". The specials never needed the solver.
      setAutoError(built.reason);
      applySpecialFill(config, cells);
      return null;
    }
    const notices: string[] = [];
    const floors = omittedCapsNotice(built.omittedCaps);
    if (floors) notices.push(floors);
    setAutoNotices(notices);
    return { request: built.request, notices };
  }

  /**
   * The seam's second half: the fetch and every exit after it. Owns the fetch per CLAUDE.md's
   * client-mutation invariant (try/catch, check `res.ok`, never close-as-success on failure);
   * the caller owns `autoPending` and its `finally`.
   *
   * @param historyMonths the derived path's window label (R14). Absent ⇒ the per-browser path,
   *   whose diagnostics carry `history_runs_used` instead.
   */
  async function runSolve(config: SolverConfig, prepared: PreparedSolve, historyMonths?: string) {
    try {
      const res = await fetch("/api/admin/solve", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(prepared.request),
      });
      let response: SolveResponse | null = null;
      if (res.ok) {
        response = await res.json();
      } else if (res.status === 422) {
        // The solver's refusal — its body carries the reason (`solverRefusalMessage`).
        response = await res.json().catch(() => null);
      }
      if (!res.ok || !response || !response.ok || !response.schedule) {
        // The solver answered, and said no. A short-staffed month is its NORMAL failure
        // (D15); the specials still fill.
        setAutoError(solverRefusalMessage(response?.error));
        applySpecialFill(config, cells);
        return;
      }
      const applied = applySolveResponse({
        response,
        previousCells: cells,
        columns,
        rows,
        sundayDates: sundayDatesFull,
        activeSatDates,
        members,
      });
      setUnresolvedNames(applied.unresolvedNames);
      setDiagnostics(historyMonths === undefined
        ? {
            fairness_relaxed: response.fairness_relaxed,
            sun_lead_fairness_relaxed: response.sun_lead_fairness_relaxed,
            sun_bgv_fairness_relaxed: response.sun_bgv_fairness_relaxed,
            history_runs_used: response.history_runs_used,
          }
        : {
            // No `history_runs_used`: it is always 3 on a derived history (R4). The months
            // THIS solve read are what the admin needs to see.
            fairness_relaxed: response.fairness_relaxed,
            sun_lead_fairness_relaxed: response.sun_lead_fairness_relaxed,
            sun_bgv_fairness_relaxed: response.sun_bgv_fairness_relaxed,
            history_months: historyMonths,
          });
      // Success. `applied.cells`, never the pre-solve `cells`: the latter would throw away the
      // weekend roster this call just produced. `applySpecialFill` owns all three setters from
      // here. `sundayDatesFull` resolves the positional week (E21); `selectedSundays` filters
      // the markers down to columns that exist.
      applySpecialFill(
        config,
        applied.cells,
        mapUnfilledSeats(response.unfilled_seats ?? [], sundayDatesFull, activeSatDates, selectedSundays),
      );
      // Fairness history is NOT persisted here — a solve merely proposes a schedule;
      // `handleConfirm` persists it from what the create batch actually committed.
    } catch {
      // The network threw — a solve failure like any other; E5 says the specials fill.
      setAutoError("Error de red al llamar al solver.");
      applySpecialFill(config, cells);
    }
  }
```

- [ ] **Step 4: Both paths call it**

`handleAuto`, after the derived hand-off (its leading config check and comments unchanged):

```ts
    const prepared = prepareSolve(config, solverHistory);
    if (!prepared) return;
    setAutoPending(true);
    try {
      await runSolve(config, prepared);
    } finally {
      setAutoPending(false);
    }
```

`solveWithDerivedHistory`, after the `!history.ok` exit (unchanged):

```ts
    const prepared = prepareSolve(config, history.data.entries);
    if (!prepared) return;
    await runSolve(config, prepared, historyMonthsLabel(history.data.months));
```

Delete the now-duplicated bodies. `handleAutoDerived` is unchanged. Keep the existing doc comments on `handleAuto`/`solveWithDerivedHistory`; update `handleAuto`'s «It is also the only caller of `applySpecialFill`» sentence to «Through `prepareSolve`/`runSolve` it is, with the derived path, the only caller of `applySpecialFill`».

- [ ] **Step 5: Run the planner suites and the type check**

Run: `npx tsc --noEmit && npx vitest run app/components/admin/__tests__`
Expected: PASS at the same counts. In particular `instrumentFill.wiring.test.tsx`'s «Este mes no tiene sábados…» `getByText` still passes — each notice is its own `<p>`.

- [ ] **Step 6: Commit**

```bash
git add app/components/admin/MonthGenerator.tsx app/components/admin/PlannerGrid.tsx
git commit -m "refactor(planner): one solve seam for both Auto paths, and a notice list" -m "The per-browser and derived paths each built, fetched, parsed and applied on their own. Pins, the handshake and the no-vacate flag have to live in one place, so the two paths now share prepareSolve and runSolve; pending stays with each caller. AutoState.notice becomes an ordered list for the notices delivery 3 appends."
```

---

### Task 8: The switch, and pins in the request

**Files:**
- Modify: `app/components/admin/MonthGenerator.tsx` (state, `applySpecialFill`, `prepareSolve`, `runSolve`, the derived `!history.ok` exit, the `PlannerGrid` props)
- Modify: `app/components/admin/PlannerGrid.tsx` (`fillEmpty` prop, the switch)
- Create: `app/components/admin/__tests__/pinSolveHarness.ts`, `app/components/admin/__tests__/plannerWiringHarness.tsx`, `app/components/admin/__tests__/fillEmpty.wiring.test.tsx`, `app/components/admin/__tests__/fillEmpty.local.test.tsx`

**Interfaces:**
- Consumes: Tasks 3, 4, 5, 7.
- Produces:
  - PlannerGrid prop `fillEmpty?: { enabled: boolean; onChange: (next: boolean) => void; emptyVoiceSeats: number }` — omitted ⇒ no switch.
  - `PreparedSolve` gains `pinned: CollectedPins | null; fillEmpty: boolean`.
  - `applySpecialFill(config, baseCells, solverUnfilled?, fillEmpty = false)`.

- [ ] **Step 1: Write the test harnesses**

```ts
// app/components/admin/__tests__/pinSolveHarness.ts
//
// Solve stubs for the «Solo llenar vacíos» suites — NOT a test file. `stubSolve` records every
// solve body and answers it with `respond`; the fairness-history read is answered ahead of it
// (`stubFetchWithHistory`), so the per-browser suite can use it too (it never reads history).
import { vi } from "vitest";

import type { SolveRequest, SolveResponse } from "@/app/api/admin/solve/route";
import { stubFetchWithHistory } from "./derivedHistoryHarness";

type Schedule = NonNullable<SolveResponse["schedule"]>;
export type Respond = (body: SolveRequest, call: number) => SolveResponse & { status?: number };

/** Every week of the request, every seat empty. */
export function emptySchedule(body: SolveRequest): Schedule {
  const out: Schedule = {};
  for (let w = 1; w <= body.weeks; w++) {
    out[String(w)] = {
      Sunday: { Lead: [], BGV: [], Choir: [] },
      ...(body.weekends_with_saturday.includes(w) ? { Saturday: { Lead: [], BGV: [] } } : {}),
    };
  }
  return out;
}

/** A pin-aware solver that seats exactly the pins and nothing else. */
export function echoPins(body: SolveRequest): SolveResponse {
  const schedule = emptySchedule(body);
  for (const p of body.pinned ?? []) {
    const week = schedule[String(p.week)];
    const service = (p.role.startsWith("Sun") ? week.Sunday : week.Saturday) as Record<string, string[]>;
    service[p.role.slice(4)].push(p.person);
  }
  return {
    ok: true, schedule, pinned_honored: (body.pinned ?? []).length,
    pin_violations: [], violation_ceiling_proven: body.pinned ? true : undefined, unfilled_seats: [],
  };
}

export function stubSolve(respond: Respond) {
  const bodies: SolveRequest[] = [];
  const fetchMock = vi.fn(async (url: string, init?: { body?: string }) => {
    if (url === "/api/admin/solve") {
      const body = JSON.parse(init?.body ?? "{}") as SolveRequest;
      bodies.push(body);
      const { status = 200, ...payload } = respond(body, bodies.length);
      return { ok: status >= 200 && status < 300, status, json: async () => payload };
    }
    if (url === "/api/admin/roles") return { ok: true, status: 200, json: async () => ({}) };
    throw new Error(`unexpected fetch to ${url}`);
  });
  stubFetchWithHistory(fetchMock);
  return { fetchMock, bodies };
}
```

```tsx
// app/components/admin/__tests__/plannerWiringHarness.tsx
//
// Shared by the «Solo llenar vacíos» and «Borrar» wiring suites — NOT a test file. `Gen`,
// fixtures and DOM helpers as `instrumentFill.wiring.test.tsx` defines them, plus the switch.
import { fireEvent, screen, within } from "@testing-library/react";

import MonthGenerator from "../MonthGenerator";
import type { SolverConfigController } from "../solverConfigSource";
import { AdminProviders } from "./providersHarness";
import { readyRules } from "./rulesHarness";

const DEFAULT_RULES = readyRules();

export function Gen({
  rules = DEFAULT_RULES,
  ...props
}: Omit<React.ComponentProps<typeof MonthGenerator>, "rules"> & { rules?: SolverConfigController }) {
  return (
    <AdminProviders>
      <MonthGenerator {...props} rules={rules} />
    </AdminProviders>
  );
}

const m = (id: string, member_name: string, alias: string, memberType = ["voz"]) => ({ _id: id, member_name, alias, memberType });
export const ANA = m("ana", "Ana Karen Villalobos", "Ana", ["voz", "sunday_lead"]);
export const LUCIA = m("lucia", "María Lucía Estrada", "Lucía");
export const BETO = m("beto", "Alberto Ruiz Cano", "Beto");
export const SUNDAYS = ["2026-03-01", "2026-03-08", "2026-03-15", "2026-03-22", "2026-03-29"];
export const RODRI = { ...m("rodri", "Rodrigo Lara Peña", "Rodri", ["instrumento"]), instruments: ["Drums"] };
export const PACO = { ...m("paco", "Francisco Ibarra", "Paco", ["instrumento"]), instruments: ["Drums"] };

export function setMonthYear(container: HTMLElement, month: number, year: number) {
  fireEvent.change(container.querySelector("select") as HTMLSelectElement, { target: { value: String(month) } });
  fireEvent.change(container.querySelector('input[type="number"]') as HTMLInputElement, { target: { value: String(year) } });
}

export function deselectAll(container: HTMLElement, kind: "sunday" | "saturday") {
  const dates = Array.from(container.querySelectorAll(`[data-day-kind="${kind}"]`)).map((el) => el.getAttribute("data-date"));
  for (const date of dates) {
    const cell = container.querySelector(`[data-date="${date}"]`);
    if (cell?.getAttribute("data-selected") === "true") fireEvent.click(cell);
  }
}

export function selectSundayLead(container: HTMLElement, displayName: string) {
  const heading = Array.from(container.querySelectorAll("p")).find((p) => p.textContent === "Líderes Domingo")!;
  const pool = heading.closest("div")!.parentElement as HTMLElement;
  const label = within(pool).getByText(displayName).closest("label") as HTMLElement;
  fireEvent.click(within(label).getByRole("checkbox"));
}

export const preview = () => fireEvent.click(screen.getByRole("button", { name: /Previsualizar/ }));

export function runAuto() {
  fireEvent.click(screen.getByRole("button", { name: /Auto-asignar/ }));
  fireEvent.click(screen.getByRole("button", { name: "Confirmar" }));
}

export const fillEmptySwitch = () => screen.getByRole("switch", { name: "Solo llenar vacíos" });

export const cellAt = (container: HTMLElement, rowId: string, date: string) =>
  container.querySelector(`[data-row-id="${rowId}"][data-date="${date}"]`) as HTMLElement;
```

- [ ] **Step 2: Write the failing wiring tests (derived path)**

```tsx
/** @vitest-environment jsdom */
// app/components/admin/__tests__/fillEmpty.wiring.test.tsx
//
// «Solo llenar vacíos» WIRED, on the shipped derived path (spec 2026-09-29 §3.4). The pure
// halves are pinned in pinModel/pinViolations; this proves MonthGenerator sends the pins,
// checks the handshake, keeps instruments and names what the solver gave up.
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { DEFAULT_SOLVER_CONFIG } from "../solverConfigDefaults";
import { PIN_HANDSHAKE_REFUSAL } from "../pinModel";
import { echoPins, emptySchedule, stubSolve, type Respond } from "./pinSolveHarness";
import {
  ANA, BETO, Gen, LUCIA, PACO, RODRI, SUNDAYS, cellAt, deselectAll, fillEmptySwitch, preview, runAuto,
  selectSundayLead, setMonthYear,
} from "./plannerWiringHarness";
import { readyRules } from "./rulesHarness";

afterEach(() => { cleanup(); vi.unstubAllGlobals(); });
beforeEach(() => { localStorage.clear(); });

const MEMBERS = [ANA, LUCIA, BETO, RODRI, PACO];
const TODAY_KEYS = ["weeks", "weekends_with_saturday", "sunday_leads", "saturday_leads", "support", "dsl_rules", "history"];

/** The first Auto of a test: Ana leads week 1, Lucía sings BGV in week 2. */
const firstRoster: Respond = (body) => {
  const schedule = emptySchedule(body);
  schedule["1"].Sunday.Lead = ["Ana Karen Villalobos"];
  schedule["2"].Sunday.BGV = ["María Lucía Estrada"];
  return { ok: true, schedule, pinned_honored: 0, pin_violations: [], unfilled_seats: [] };
};

function setup(respond: Respond, members = MEMBERS, rules?: ReturnType<typeof readyRules>) {
  const stub = stubSolve(respond);
  const view = render(<Gen rules={rules} members={members} existingRoles={[]} onClose={vi.fn()} onCreated={vi.fn()} />);
  setMonthYear(view.container, 3, 2026);
  deselectAll(view.container, "saturday");
  selectSundayLead(view.container, "Ana");
  preview();
  return { ...view, ...stub };
}

describe("«Solo llenar vacíos» — the request", () => {
  it("is off by default and sends no `pinned` key — the request is today's", async () => {
    const { bodies } = setup(firstRoster);
    expect(fillEmptySwitch().getAttribute("aria-checked")).toBe("false");
    runAuto();
    await waitFor(() => expect(bodies).toHaveLength(1));
    expect(Object.keys(bodies[0])).toEqual(TODAY_KEYS);
  });

  it("with the switch on and an empty board sends no `pinned` key either", async () => {
    const { bodies } = setup(echoPins);
    fireEvent.click(fillEmptySwitch());
    runAuto();
    await waitFor(() => expect(bodies).toHaveLength(1));
    expect(Object.keys(bodies[0])).toEqual(TODAY_KEYS);
  });

  it("pins exactly the occupied voice seats, by member_name, and applies the echoed roster", async () => {
    const { bodies, container } = setup((body, call) => (call === 1 ? firstRoster(body, call) : echoPins(body)));
    runAuto();
    await waitFor(() => expect(cellAt(container, "lead", SUNDAYS[0]).textContent).toContain("Ana"));
    fireEvent.click(fillEmptySwitch());
    runAuto();
    await waitFor(() => expect(bodies).toHaveLength(2));
    expect(bodies[1].pinned).toEqual([
      { week: 1, role: "Sun.Lead", person: "Ana Karen Villalobos" },
      { week: 2, role: "Sun.BGV", person: "María Lucía Estrada" },
    ]);
    expect(Object.keys(bodies[1])).toEqual([...TODAY_KEYS, "pinned"]);
    await waitFor(() => expect(cellAt(container, "bgv", SUNDAYS[1]).textContent).toContain("Lucía"));
    expect(screen.queryByText(PIN_HANDSHAKE_REFUSAL)).toBeNull();
  });
});

describe("«Solo llenar vacíos» — the handshake", () => {
  const liar = (patch: (r: ReturnType<typeof echoPins>) => ReturnType<typeof echoPins>): Respond =>
    (body, call) => {
      if (call === 1) return firstRoster(body, call);
      const r = patch(echoPins(body));
      r.schedule!["3"].Sunday.Lead = ["Alberto Ruiz Cano"]; // what must NOT be applied
      return r;
    };

  for (const [name, respond] of [
    ["pinned_honored is missing", liar((r) => ({ ...r, pinned_honored: undefined }))],
    ["pinned_honored is short", liar((r) => ({ ...r, pinned_honored: 1 }))],
    ["a pinned name is missing from the schedule", liar((r) => {
      r.schedule!["2"].Sunday.BGV = [];
      return r;
    })],
  ] as const) {
    it(`refuses and applies no voices when ${name} — instruments still complete, as on every exit`, async () => {
      const { container } = setup(respond);
      runAuto();
      await waitFor(() => expect(cellAt(container, "lead", SUNDAYS[0]).textContent).toContain("Ana"));
      fireEvent.click(fillEmptySwitch());
      runAuto();
      await waitFor(() => expect(screen.getByText(PIN_HANDSHAKE_REFUSAL)).toBeTruthy());
      expect(cellAt(container, "lead", SUNDAYS[2]).textContent).not.toContain("Beto");
      expect(cellAt(container, "bgv", SUNDAYS[1]).textContent).toContain("Lucía");
      expect(cellAt(container, "instrumento:Drums", SUNDAYS[0]).textContent).toMatch(/Paco|Rodri/);
      expect(screen.queryByText(/Motivo del solver/)).toBeNull();
    });
  }
});

describe("«Solo llenar vacíos» — instruments are completed, never re-seated", () => {
  it("leaves every instrument cell byte-identical across a second Auto, even when a re-seat would pick someone else", async () => {
    const { container, rerender } = setup(echoPins);
    fireEvent.click(fillEmptySwitch());
    runAuto();
    await waitFor(() => expect(cellAt(container, "instrumento:Drums", SUNDAYS[2]).textContent).toMatch(/Paco|Rodri/));
    const drumsWeek3 = cellAt(container, "instrumento:Drums", SUNDAYS[2]).textContent ?? "";
    const seated = drumsWeek3.includes("Paco") ? PACO : RODRI;
    // Make the week-3 drummer unavailable: a re-seat (the vacate path) would now pick the other one.
    const members = MEMBERS.map((x) => (x._id === seated._id ? { ...x, unavailableDates: [SUNDAYS[2]] } : x));
    const before = SUNDAYS.map((d) => cellAt(container, "instrumento:Drums", d).outerHTML);
    rerender(<Gen members={members} existingRoles={[]} onClose={vi.fn()} onCreated={vi.fn()} />);
    runAuto();
    await waitFor(() => expect(screen.queryByText("Calculando...")).toBeNull());
    expect(SUNDAYS.map((d) => cellAt(container, "instrumento:Drums", d).outerHTML)).toEqual(before);
  });
});

describe("«Solo llenar vacíos» — what the admin is told", () => {
  it("shows the left-out Saturday floor AND the solver's give-ups, in that order, and marks the leaderless seat", async () => {
    const rules = readyRules({
      ...DEFAULT_SOLVER_CONFIG,
      restrictions: [
        ...DEFAULT_SOLVER_CONFIG.restrictions,
        {
          id: "beto-sat", person: "Beto", excludedPatterns: [], fairness: "none", fairnessSlack: 0, weekExclusions: [],
          caps: [{ id: "c1", pattern: "Sat.*", op: "==", value: 1, relative: false, relOffset: 2 }],
        },
      ],
    });
    // Ana — the only lead — is pinned into week 1; week 2 comes back leaderless.
    const { container } = setup((body, call) => {
      if (call === 1) return firstRoster(body, call);
      return {
        ...echoPins(body),
        pin_violations: ["builtin:mandatory_lead:W2:Sun"],
        violation_ceiling_proven: false,
        unfilled_seats: ["W2 Sunday Sun.Lead #1", "W2 Sunday Sun.Lead #2"],
      };
    }, MEMBERS, rules);
    runAuto();
    await waitFor(() => expect(cellAt(container, "lead", SUNDAYS[0]).textContent).toContain("Ana"));
    fireEvent.click(fillEmptySwitch());
    runAuto();
    await waitFor(() => expect(screen.getByText(/quedó sin líder/)).toBeTruthy());
    const lines = Array.from(container.querySelectorAll("[data-auto-notices] p")).map((p) => p.textContent);
    expect(lines).toEqual([
      "Este mes no tiene sábados que Auto pueda cubrir, así que no se aplicó «Sat.* == 1» a Beto.",
      "El domingo 8 mar quedó sin líder — lo cedió el solver para acomodar lo que ya estaba puesto.",
      "Puede que el solver haya cedido más reglas de las necesarias: no alcanzó a comprobarlo.",
    ]);
    expect(cellAt(container, "lead", SUNDAYS[1]).textContent).toContain("Sin cubrir");
  });
});
```

Each handshake case breaks exactly one condition (the count's presence, its value, or one name) and adds a week-3 Beto that must NOT reach the grid.

- [ ] **Step 3: Write the failing per-browser test**

```tsx
/** @vitest-environment jsdom */
// app/components/admin/__tests__/fillEmpty.local.test.tsx
//
// The per-browser Auto path (the rollback, `SOLVER_HISTORY_SOURCE = "local"`) goes through the
// same seam: a pre-fetch pin refusal reaches the admin there too, and nothing is sent.
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../solverHistorySource", () => ({ SOLVER_HISTORY_SOURCE: "local" }));

import { emptySchedule, stubSolve } from "./pinSolveHarness";
import {
  ANA, BETO, Gen, LUCIA, SUNDAYS, cellAt, deselectAll, fillEmptySwitch, preview, runAuto, selectSundayLead, setMonthYear,
} from "./plannerWiringHarness";

afterEach(() => { cleanup(); vi.unstubAllGlobals(); });
beforeEach(() => { localStorage.clear(); });

describe("«Solo llenar vacíos» on the per-browser path", () => {
  it("refuses in Spanish, naming the cell, and never calls the solver", async () => {
    const { bodies } = stubSolve((body) => {
      const schedule = emptySchedule(body);
      schedule["1"].Sunday.BGV = ["Alberto Ruiz Cano"];
      return { ok: true, schedule, unfilled_seats: [] };
    });
    const props = { existingRoles: [], onClose: vi.fn(), onCreated: vi.fn() };
    const view = render(<Gen members={[ANA, LUCIA, BETO]} {...props} />);
    setMonthYear(view.container, 3, 2026);
    deselectAll(view.container, "saturday");
    selectSundayLead(view.container, "Ana");
    preview();
    runAuto();
    await waitFor(() => expect(cellAt(view.container, "bgv", SUNDAYS[0]).textContent).toContain("Beto"));
    // Beto leaves the members list (e.g. the ministry-scoped read): his seat no longer resolves.
    view.rerender(<Gen members={[ANA, LUCIA]} {...props} />);
    fireEvent.click(fillEmptySwitch());
    runAuto();
    await waitFor(() => expect(screen.getByText(
      "No se puede usar «Solo llenar vacíos»: en BGV del domingo 1 mar hay alguien que ya no está en la lista de miembros. Quítalo de ese lugar y vuelve a intentarlo.",
    )).toBeTruthy());
    expect(bodies).toHaveLength(1);
  });
});
```

- [ ] **Step 4: Run to see them fail**

Run: `npx vitest run app/components/admin/__tests__/fillEmpty.wiring.test.tsx app/components/admin/__tests__/fillEmpty.local.test.tsx`
Expected: FAIL — no element with role `switch` named «Solo llenar vacíos».

- [ ] **Step 5: The switch (PlannerGrid)**

Add the prop to `PlannerGridProps`:

```ts
  /**
   * «Solo llenar vacíos» (create mode, spec 2026-09-29 §3). Omitted ⇒ no switch. `MonthGenerator`
   * owns the state (E2: per run, never persisted); this renders it and words the confirm.
   */
  fillEmpty?: { enabled: boolean; onChange: (next: boolean) => void; emptyVoiceSeats: number };
```

Destructure it, add `const fillEmptyLabelId = useId();` with the component's other hooks (import `useId` from React and `Switch` from `@/app/components/ui/Switch`), and render right after the Auto button:

```tsx
        {mode === "create" && fillEmpty && (
          <span className="inline-flex items-center gap-2">
            <Switch
              size="sm"
              checked={fillEmpty.enabled}
              onChange={fillEmpty.onChange}
              disabled={autoState.pending}
              aria-labelledby={fillEmptyLabelId}
            />
            <span id={fillEmptyLabelId} className="font-label text-xs uppercase tracking-widest text-ink-muted">
              Solo llenar vacíos
            </span>
          </span>
        )}
```

- [ ] **Step 6: The flag, the pins and the handshake (MonthGenerator)**

State, with the other Auto state:

```ts
  /** E2 — «Solo llenar vacíos»: off by default, per run, never persisted. */
  const [fillEmptyOnly, setFillEmptyOnly] = useState(false);
```

Imports:

```ts
import {
  PIN_HANDSHAKE_REFUSAL,
  collectPins,
  droppedPinNotices,
  emptyVoiceSeats,
  pinHandshakeHolds,
  pinRefusal,
  type CollectedPins,
} from "./pinModel";
import { pinViolationNotices } from "./pinViolations";
```

`applySpecialFill` gains a fourth parameter and uses the existing no-vacate path (doc comment: add «@param fillEmpty «Solo llenar vacíos»: instruments are completed on the weekend columns in date order and nothing is vacated — `fillInstruments`' `fillColumns` path, no second flag.»):

```ts
  function applySpecialFill(
    config: SolverConfig,
    baseCells: GridCell[],
    solverUnfilled?: { columnId: string; rowId: string }[],
    fillEmpty = false,
  ) {
    // … unchanged up to the instrument fill …
    const weekendInDateOrder = columns
      .filter(c => c.type === "sunday_role" || c.type === "saturday_role")
      .sort((a, b) => a.date.localeCompare(b.date));
    const instr = fillInstruments({
      columns,
      ...(fillEmpty ? { fillColumns: weekendInDateOrder } : {}),
      rows,
      cells: next,
      members,
      savedWindow,
      config,
    });
    // … unchanged …
  }
```

`PreparedSolve` gains two fields:

```ts
    /** The pins sent, or `null` when the switch is off or the board had none (no `pinned` key). */
    pinned: CollectedPins | null;
    /** The switch as it stood in THIS render — the same one `cells` came from. */
    fillEmpty: boolean;
```

`prepareSolve`: read the switch once at the top (`const fillEmpty = fillEmptyOnly;`), pass `undefined, fillEmpty` to the `!built.ok` exit's `applySpecialFill`, and replace its tail (from `const notices` to the return) with:

```ts
    const notices: string[] = [];
    const floors = omittedCapsNotice(built.omittedCaps);
    if (floors) notices.push(floors);
    let pinned: CollectedPins | null = null;
    if (fillEmpty) {
      const collected = collectPins({ cells, columns, rows, members, sundayDates: sundayDatesFull });
      const refusal = pinRefusal({
        collected,
        columns,
        rows,
        members,
        weekendsWithSaturday: built.request.weekends_with_saturday,
        poolNames: [...built.request.sunday_leads, ...built.request.saturday_leads, ...built.request.support],
      });
      if (refusal) {
        // Refused before the fetch, in Spanish, naming the cell (spec §3.2).
        setAutoError(refusal);
        applySpecialFill(config, cells, undefined, fillEmpty);
        return null;
      }
      notices.push(...droppedPinNotices({ dropped: collected.dropped, columns, rows, members }));
      // Zero pins OMITS `pinned`: the request is byte-identical to the switch off (MCP P4).
      if (collected.pins.length > 0) pinned = collected;
    }
    setAutoNotices(notices);
    return {
      request: pinned ? { ...built.request, pinned: pinned.pins } : built.request,
      notices,
      pinned,
      fillEmpty,
    };
```

`runSolve`: pass `undefined, prepared.fillEmpty` to both failure exits' `applySpecialFill(config, cells, …)`; right after the refusal branch and before `applySolveResponse`, add the handshake exit; pass `pinnedCellKeys`; append the give-ups; pass the flag on success:

```ts
      if (prepared.pinned && !pinHandshakeHolds(response, prepared.pinned.pins)) {
        // E8: nothing of the solver's result is applied. Set directly — never through
        // `solverRefusalMessage`; the two are exclusive per run. Specials and instruments
        // still complete, as on every exit (spec §0).
        setAutoError(PIN_HANDSHAKE_REFUSAL);
        applySpecialFill(config, cells, undefined, prepared.fillEmpty);
        return;
      }
      const applied = applySolveResponse({
        response,
        previousCells: cells,
        columns,
        rows,
        sundayDates: sundayDatesFull,
        activeSatDates,
        members,
        pinnedCellKeys: prepared.pinned?.pinnedCellKeys,
      });
      // … setUnresolvedNames / setDiagnostics unchanged …
      if (prepared.pinned) {
        setAutoNotices([
          ...prepared.notices,
          ...pinViolationNotices({
            violations: response.pin_violations ?? [],
            ceilingProven: response.violation_ceiling_proven,
            config,
            members,
            pins: prepared.pinned.pins,
            sundayDates: sundayDatesFull,
          }),
        ]);
      }
      applySpecialFill(
        config,
        applied.cells,
        mapUnfilledSeats(response.unfilled_seats ?? [], sundayDatesFull, activeSatDates, selectedSundays),
        prepared.fillEmpty,
      );
```

In `solveWithDerivedHistory`, the `!history.ok` exit becomes `applySpecialFill(config, cells, undefined, fillEmptyOnly);` (same render as `cells`, via the ref).

Pass the prop to `PlannerGrid`:

```tsx
          fillEmpty={storedMode ? undefined : {
            enabled: fillEmptyOnly,
            onChange: (next) => { if (!autoPending) setFillEmptyOnly(next); },
            emptyVoiceSeats: emptyVoiceSeats({ cells, columns, rows, sundayDates: sundayDatesFull }),
          }}
```

- [ ] **Step 7: Run to see them pass, then the planner suites**

Run: `npx vitest run app/components/admin/__tests__/fillEmpty.wiring.test.tsx app/components/admin/__tests__/fillEmpty.local.test.tsx`
Expected: PASS.
Run: `npx tsc --noEmit && npx vitest run app/components/admin/__tests__`
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add app/components/admin/MonthGenerator.tsx app/components/admin/PlannerGrid.tsx app/components/admin/__tests__/pinSolveHarness.ts app/components/admin/__tests__/plannerWiringHarness.tsx app/components/admin/__tests__/fillEmpty.wiring.test.tsx app/components/admin/__tests__/fillEmpty.local.test.tsx
git commit -m "feat(planner): «Solo llenar vacíos» sends the board as pins" -m "With the switch on, every occupied voice seat on a column Auto writes is pinned, the solver's result is applied only if its handshake shows every pin by exact name, pinned cells keep their waivers, instruments are completed without re-seating, and what the solver gave up is named. Off, or with nothing on the board, the request is exactly today's."
```

---

### Task 9: Locking while pending, the confirm copy, and pin conflicts on the board

**Files:**
- Modify: `app/components/admin/MonthGenerator.tsx` (`createAutoLocked`, `handleCellsChange`, `mutationLocked` prop, `pinBoard`, `pinConflicts` prop)
- Modify: `app/components/admin/PlannerGrid.tsx` (confirm copy, `pinConflicts` prop through `RowGroup` to `GridCellView`)
- Test: `app/components/admin/__tests__/fillEmpty.wiring.test.tsx` (append), `app/components/admin/__tests__/PlannerGrid.test.tsx` (append)

**Interfaces:**
- Consumes: `collectPins`, `pinConflicts`, `pinSeatKey`, `PinConflictKind` (Task 3); `solverPools` (Task 2).
- Produces: PlannerGrid prop `pinConflicts?: ReadonlyMap<string, PinConflictKind[]>` keyed by `pinSeatKey`.

- [ ] **Step 1: Write the failing tests**

Append to `fillEmpty.wiring.test.tsx`:

```tsx
describe("«Solo llenar vacíos» — locked while Auto is pending", () => {
  it("disables the switch and every cell during the history read, and a click there cannot change the pins sent", async () => {
    const { bodies } = stubSolve((body, call) => (call === 1 ? firstRoster(body, call) : echoPins(body)));
    // Hold the NEXT history read open (the Auto one), then let it through.
    const answered = globalThis.fetch;
    let release!: () => void;
    const gate = new Promise<void>((r) => { release = r; });
    let hold = false;
    vi.stubGlobal("fetch", async (input: unknown, init?: unknown) => {
      if (hold && typeof input === "string" && input.startsWith("/api/admin/solver-history?")) await gate;
      return (answered as (i: unknown, n?: unknown) => Promise<unknown>)(input, init);
    });
    const view = render(<Gen members={MEMBERS} existingRoles={[]} onClose={vi.fn()} onCreated={vi.fn()} />);
    setMonthYear(view.container, 3, 2026);
    deselectAll(view.container, "saturday");
    selectSundayLead(view.container, "Ana");
    preview();
    runAuto();
    await waitFor(() => expect(cellAt(view.container, "lead", SUNDAYS[0]).textContent).toContain("Ana"));

    fireEvent.click(fillEmptySwitch());
    hold = true;
    runAuto();
    await waitFor(() => expect(screen.getByText("Calculando...")).toBeTruthy());
    expect((fillEmptySwitch() as HTMLButtonElement).disabled).toBe(true);
    expect((cellAt(view.container, "bgv", SUNDAYS[3]).querySelector("[data-cell-action]") as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(fillEmptySwitch()); // disabled: nothing happens

    release();
    await waitFor(() => expect(bodies).toHaveLength(2));
    expect(bodies[1].pinned).toEqual([
      { week: 1, role: "Sun.Lead", person: "Ana Karen Villalobos" },
      { week: 2, role: "Sun.BGV", person: "María Lucía Estrada" },
    ]);
    await waitFor(() => expect(screen.queryByText("Calculando...")).toBeNull());
    expect(fillEmptySwitch().getAttribute("aria-checked")).toBe("true");
  });
});

describe("«Solo llenar vacíos» — pin conflicts on the board", () => {
  it("names an unavailable pinned occupant on the chip and under the cell, only while the switch is on", async () => {
    const away = { ...LUCIA, unavailableDates: [SUNDAYS[1]] };
    const { container } = setup(firstRoster, [ANA, away, BETO, RODRI, PACO]);
    runAuto();
    await waitFor(() => expect(cellAt(container, "bgv", SUNDAYS[1]).textContent).toContain("Lucía"));
    const chip = () => cellAt(container, "bgv", SUNDAYS[1]).querySelector('[data-occupant="lucia"]') as HTMLElement;
    expect(chip().getAttribute("aria-label")).not.toContain("fijo");
    fireEvent.click(fillEmptySwitch());
    expect(chip().getAttribute("aria-label")).toContain("(fijo: no disponible ese día)");
    expect(cellAt(container, "bgv", SUNDAYS[1]).textContent).toContain("Lucía: marcó este día como no disponible");
  });
});
```

Append to `PlannerGrid.test.tsx` (inside a new `describe`, using that file's `baseProps` and `render`):

```tsx
describe("«Solo llenar vacíos» — the confirm copy", () => {
  it("says what Auto will do with the switch on, and today's copy with it off", () => {
    const { rerender } = render(<PlannerGrid {...baseProps({ fillEmpty: { enabled: false, onChange: vi.fn(), emptyVoiceSeats: 7 } })} />);
    fireEvent.click(screen.getByRole("button", { name: /Auto-asignar/ }));
    expect(screen.getByText(/Esto reemplazará toda asignación de voz/)).toBeTruthy();
    rerender(<PlannerGrid {...baseProps({ fillEmpty: { enabled: true, onChange: vi.fn(), emptyVoiceSeats: 7 } })} />);
    expect(screen.getByText(/Solo se llenarán los 7 lugares de voz vacíos/)).toBeTruthy();
    expect(screen.getByText(/Los instrumentos vacíos se completan sin mover a nadie; FOH no se toca/)).toBeTruthy();
    expect(screen.queryByText(/Esto reemplazará toda asignación de voz/)).toBeNull();
  });

  it("disables the switch while Auto is pending", () => {
    render(<PlannerGrid {...baseProps({
      autoState: { pending: true, error: null, disabledReason: null },
      fillEmpty: { enabled: false, onChange: vi.fn(), emptyVoiceSeats: 0 },
    })} />);
    expect((screen.getByRole("switch", { name: "Solo llenar vacíos" }) as HTMLButtonElement).disabled).toBe(true);
  });
});
```

(If `baseProps` in `PlannerGrid.test.tsx` renders `mode="stored"` by default, pass `mode: "create"` in these calls — check the helper at `PlannerGrid.test.tsx:~90-110`.)

- [ ] **Step 2: Run to see them fail**

Run: `npx vitest run app/components/admin/__tests__/fillEmpty.wiring.test.tsx app/components/admin/__tests__/PlannerGrid.test.tsx`
Expected: FAIL — cells stay enabled while pending; no «fijo» in the aria-label; today's confirm copy with the switch on.

- [ ] **Step 3: Lock (MonthGenerator)**

Next to `storedMutationLocked`:

```ts
  /**
   * Spec §3.2 «Locking»: with «Solo llenar vacíos» on, an edit landing during the solve would
   * break «Auto respeta lo que ya está puesto», so the create grid is read-only while Auto is
   * pending. The switch itself and every «Borrar» are disabled on `autoPending` alone.
   */
  const createAutoLocked = !storedMode && autoPending && fillEmptyOnly;
```

`handleCellsChange`'s first line becomes `if (storedMutationLocked || createAutoLocked) return;`, and the grid prop `mutationLocked={storedMutationLocked || createAutoLocked}`.

- [ ] **Step 4: The confirm copy (PlannerGrid)**

Replace the confirm panel's first sentence (keep the `unaddressableDates` clause and the specials paragraph as they are):

```tsx
          <p className="font-body text-xs text-warning-soft">
            {fillEmpty?.enabled
              ? `Solo se llenarán los ${fillEmpty.emptyVoiceSeats} lugar${fillEmpty.emptyVoiceSeats !== 1 ? "es" : ""} de voz vacío${fillEmpty.emptyVoiceSeats !== 1 ? "s" : ""} (Lead, BGV, Coro); lo que ya está puesto se respeta y se envía al solver como fijo. Los instrumentos vacíos se completan sin mover a nadie; FOH no se toca.`
              : "Esto reemplazará toda asignación de voz (Lead, BGV, Coro) que el solver pueda resolver en este mes. Las asignaciones manuales de instrumentos y FOH no se tocan."}
            {unaddressableDates.length > 0 &&
              ` ${unaddressableDates.length} sábado(s) fuera del alcance de Auto no se tocarán.`}
          </p>
```

- [ ] **Step 5: Pin conflicts (MonthGenerator → PlannerGrid)**

MonthGenerator, after `savedWindow` (all hooks stay above the `step === "config"` early return):

```ts
  /** Spec §3.3 — what the board says about each seat that will be pinned; only with the switch on. */
  const pinBoard = useMemo(() => {
    if (storedMode || !fillEmptyOnly || !solverConfig) return undefined;
    const collected = collectPins({ cells, columns, rows, members, sundayDates: sundayDatesFull });
    const p = solverPools(solverConfig, members);
    return pinConflicts({
      collected,
      columns,
      members,
      pools: { sundayLeads: p.sundayLeadNames, saturdayLeads: p.saturdayLeadNames, support: [...p.supportNames, ...p.extraSupport] },
    });
  }, [storedMode, fillEmptyOnly, solverConfig, cells, columns, rows, members, sundayDatesFull]);
```

(import `pinConflicts` from `./pinModel`, `solverPools` from `./plannerModel`) and pass `pinConflicts={pinBoard}` to `PlannerGrid`.

PlannerGrid: add the prop

```ts
  /** «Solo llenar vacíos»: conflicts of each seat that will be pinned, by `pinSeatKey` (spec §3.3). */
  pinConflicts?: ReadonlyMap<string, PinConflictKind[]>;
```

thread it `PlannerGrid → RowGroup → GridCellView` as `pinConflicts` (same pattern as `violationsByColumnId`), and in `GridCellView`, inside the chip map after `occurrence` is computed:

```tsx
            const pinKinds = pinConflicts?.get(pinSeatKey({ columnId: column.columnId, rowId: row.id, memberId: id, occurrence })) ?? [];
```

Extend the chip's `aria-label` (after the Tipo clause, before the instrument clause) with:

```tsx
                }${pinKinds.map((k) => PIN_CONFLICT_ARIA[k]).join("")}${
```

and its tint chain (ADR-0045 precedence: conflict > Tipo > pin conflict > over target):

```tsx
                    : tipoMismatch || pinKinds.length > 0
                      ? "border-warning-strong/50 bg-warning-strong/10"
```

Add the words, after the undeclared-instrument lines:

```tsx
        {memberIds.flatMap((id, index) => {
          const occurrence = memberIds.slice(0, index).filter((x) => x === id).length;
          const kinds = pinConflicts?.get(pinSeatKey({ columnId: column.columnId, rowId: row.id, memberId: id, occurrence })) ?? [];
          return kinds.map((k) => (
            <p key={`pin-${id}-${occurrence}-${k}`} className={`font-body text-[9px] text-warning-strong ${CARD_STYLE.longText}`}>
              ⚠ {memberName(id)}: {PIN_CONFLICT_LINE[k](row.label)}
            </p>
          ));
        })}
```

with, at module level:

```ts
const PIN_CONFLICT_ARIA: Record<PinConflictKind, string> = {
  unavailable: " (fijo: no disponible ese día)",
  outsidePool: " (fijo: fuera de los grupos del solver)",
  duplicate: " (repetido en este servicio: no se fija)",
};
const PIN_CONFLICT_LINE: Record<PinConflictKind, (seat: string) => string> = {
  unavailable: () => "marcó este día como no disponible — Auto lo respetará como fijo",
  outsidePool: (seat) => `no está en los grupos del solver para ${seat} — Auto lo respetará como fijo`,
  duplicate: () => "ya está en otro lugar de este servicio — no se fija aquí",
};
```

(import `pinSeatKey` and `type PinConflictKind` from `./pinModel`.)

- [ ] **Step 6: Run to see them pass, then the planner suites**

Run: `npx vitest run app/components/admin/__tests__/fillEmpty.wiring.test.tsx app/components/admin/__tests__/PlannerGrid.test.tsx`
Expected: PASS.
Run: `npx tsc --noEmit && npx vitest run app/components/admin/__tests__`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add app/components/admin/MonthGenerator.tsx app/components/admin/PlannerGrid.tsx app/components/admin/__tests__/fillEmpty.wiring.test.tsx app/components/admin/__tests__/PlannerGrid.test.tsx
git commit -m "feat(planner): lock the grid during a fill-empty solve and show what each pin contradicts" -m "An edit landing mid-solve would break the promise that Auto keeps what is on the board. With the switch on, the confirm says what Auto will do, and a pinned seat that is unavailable, outside the pools, or a dropped duplicate is named on its chip — shown, never blocking (E3)."
```

---

### Task 10: «Borrar» — menus, the month confirm, and undo

**Files:**
- Modify: `app/components/admin/PlannerGrid.tsx` (`clear` prop, the global menu, the header menus)
- Modify: `app/components/admin/MonthGenerator.tsx` (`useToast`, clear handlers, the month `CueDialog`, undo)
- Test: `app/components/admin/__tests__/PlannerGrid.test.tsx` (append), `app/components/admin/__tests__/plannerClear.wiring.test.tsx` (new)

**Interfaces:**
- Consumes: `planClear`, `applyClear`, `restoreCleared`, `dropClearedMarkers`, `CLEAR_WHAT_LABEL`, `ClearScope`, `ClearWhat` (Task 6).
- Produces: PlannerGrid prop `clear?: { countFor: (scope: ClearScope, what: ClearWhat) => number; onClear: (scope: ClearScope, what: ClearWhat) => void; disabled: boolean }` — omitted ⇒ no «Borrar».

- [ ] **Step 1: Write the failing PlannerGrid tests**

Append to `PlannerGrid.test.tsx` (same `baseProps`; `mode: "create"` if needed):

```tsx
describe("«Borrar» menus", () => {
  const clear = (over: Partial<{ disabled: boolean }> = {}) => ({
    countFor: (scope: { kind: string }, what: string) => (scope.kind === "month" ? 10 : 2) + (what === "both" ? 1 : 0),
    onClear: vi.fn(),
    disabled: false,
    ...over,
  });

  it("offers the month's three items with live counts from the toolbar", () => {
    const c = clear();
    render(<PlannerGrid {...baseProps({ clear: c })} />);
    fireEvent.click(screen.getByRole("button", { name: "Borrar" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "Voces e instrumentos (11)" }));
    expect(c.onClear).toHaveBeenCalledWith({ kind: "month" }, "both");
  });

  it("puts a service-scoped menu in each column header", () => {
    const c = clear();
    const props = baseProps({ clear: c });
    render(<PlannerGrid {...props} />);
    const column = props.columns[0];
    fireEvent.click(screen.getByRole("button", { name: `Borrar en ${column.date}` }));
    fireEvent.click(screen.getByRole("menuitem", { name: "Instrumentos (2)" }));
    expect(c.onClear).toHaveBeenCalledWith({ kind: "service", columnId: column.columnId }, "instruments");
  });

  it("disables every «Borrar» while Auto is pending", () => {
    render(<PlannerGrid {...baseProps({ clear: clear({ disabled: true }) })} />);
    for (const b of screen.getAllByRole("button", { name: /^Borrar/ })) expect((b as HTMLButtonElement).disabled).toBe(true);
  });
});
```

- [ ] **Step 2: Write the failing wiring tests**

```tsx
/** @vitest-environment jsdom */
// app/components/admin/__tests__/plannerClear.wiring.test.tsx
//
// «Borrar» WIRED (spec 2026-09-29 §3.2): service items apply at once with «Deshacer»; month
// items confirm through a CueDialog and re-plan against the live cells; FOH is never cleared.
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { emptySchedule, stubSolve, type Respond } from "./pinSolveHarness";
import {
  ANA, BETO, Gen, LUCIA, PACO, RODRI, SUNDAYS, cellAt, deselectAll, preview, runAuto, selectSundayLead, setMonthYear,
} from "./plannerWiringHarness";

afterEach(() => { cleanup(); vi.unstubAllGlobals(); });
beforeEach(() => { localStorage.clear(); });

const roster: Respond = (body) => {
  const schedule = emptySchedule(body);
  schedule["1"].Sunday.Lead = ["Ana Karen Villalobos"];
  schedule["1"].Sunday.BGV = ["María Lucía Estrada"];
  schedule["2"].Sunday.BGV = ["Alberto Ruiz Cano"];
  return { ok: true, schedule, unfilled_seats: [] };
};

async function setup() {
  stubSolve(roster);
  const view = render(<Gen members={[ANA, LUCIA, BETO, RODRI, PACO]} existingRoles={[]} onClose={vi.fn()} onCreated={vi.fn()} />);
  setMonthYear(view.container, 3, 2026);
  deselectAll(view.container, "saturday");
  selectSundayLead(view.container, "Ana");
  preview();
  runAuto();
  await waitFor(() => expect(cellAt(view.container, "lead", SUNDAYS[0]).textContent).toContain("Ana"));
  return view;
}

describe("«Borrar» this service", () => {
  it("clears its voices at once, leaves instruments and other services, and «Deshacer» puts them back", async () => {
    const { container } = await setup();
    const drums = cellAt(container, "instrumento:Drums", SUNDAYS[0]).textContent;
    fireEvent.click(screen.getByRole("button", { name: `Borrar en ${SUNDAYS[0]}` }));
    fireEvent.click(screen.getByRole("menuitem", { name: "Voces (2)" }));
    expect(cellAt(container, "lead", SUNDAYS[0]).textContent).toContain("Sin asignar");
    expect(cellAt(container, "bgv", SUNDAYS[0]).textContent).toContain("Sin asignar");
    expect(cellAt(container, "bgv", SUNDAYS[1]).textContent).toContain("Beto");
    expect(cellAt(container, "instrumento:Drums", SUNDAYS[0]).textContent).toBe(drums);
    fireEvent.click(await screen.findByRole("button", { name: "Deshacer" }));
    expect(cellAt(container, "lead", SUNDAYS[0]).textContent).toContain("Ana");
    expect(cellAt(container, "bgv", SUNDAYS[0]).textContent).toContain("Lucía");
  });

  it("withdraws «Deshacer» once Auto has run", async () => {
    await setup();
    fireEvent.click(screen.getByRole("button", { name: `Borrar en ${SUNDAYS[0]}` }));
    fireEvent.click(screen.getByRole("menuitem", { name: "Voces (2)" }));
    expect(await screen.findByRole("button", { name: "Deshacer" })).toBeTruthy();
    runAuto();
    await waitFor(() => expect(screen.queryByRole("button", { name: "Deshacer" })).toBeNull());
  });
});

describe("«Borrar» the whole month", () => {
  it("confirms with the live count, keeps FOH, writes nothing, and clears what is on the grid WHEN confirmed", async () => {
    const { container } = await setup();
    fireEvent.click(screen.getByRole("button", { name: "Borrar" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "Voces (3)" }));
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByText(/Se quitarán 3 asignaciones de voces en todo el mes/)).toBeTruthy();
    expect(within(dialog).getByText(/FOH no se toca/)).toBeTruthy();
    expect(within(dialog).getByText(/Nada se guarda hasta que presiones «Crear \d+ borrador/)).toBeTruthy();

    // A live change while the dialog is open: the confirm must re-plan against it.
    fireEvent.click(cellAt(container, "coro", SUNDAYS[2]).querySelector("[data-cell-action]") as HTMLElement);
    fireEvent.click(screen.getByRole("button", { name: /Beto/ }));
    await waitFor(() => expect(within(dialog).getByText(/Se quitarán 4 asignaciones de voces/)).toBeTruthy());

    fireEvent.click(within(dialog).getByRole("button", { name: "Borrar" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    for (const d of SUNDAYS) {
      for (const row of ["lead", "bgv", "coro"]) expect(cellAt(container, row, d).textContent).toContain("Sin asignar");
    }
    expect(screen.queryByRole("button", { name: "Deshacer" })).toBeNull();
  });
});
```

The live-change step opens a picker behind the dialog. jsdom dispatches events on `inert` elements; if the picker click does not land in your environment, replace those two lines with a `rerender` that changes nothing about the plan and assert only the confirm-time clear — and record the substitution in the review.

- [ ] **Step 3: Run to see them fail**

Run: `npx vitest run app/components/admin/__tests__/PlannerGrid.test.tsx app/components/admin/__tests__/plannerClear.wiring.test.tsx`
Expected: FAIL — no «Borrar» button.

- [ ] **Step 4: The menus (PlannerGrid)**

Imports: `Menu, { MenuHeader, MenuItem }` from `@/app/components/ui/Menu`, `Button` from `@/app/components/ui/Button`, `CLEAR_WHAT_LABEL, type ClearScope, type ClearWhat` from `./clearCells`.

Prop:

```ts
  /**
   * «Borrar» (create mode, E6). Omitted ⇒ no menus. Counts are LIVE — `MonthGenerator` computes
   * them from the current cells on every render. `disabled` is true while Auto is pending.
   */
  clear?: {
    countFor: (scope: ClearScope, what: ClearWhat) => number;
    onClear: (scope: ClearScope, what: ClearWhat) => void;
    disabled: boolean;
  };
```

A module-level helper, used by both menus:

```tsx
const CLEAR_ITEMS: ClearWhat[] = ["voices", "instruments", "both"];

function ClearItems({ clear, scope }: { clear: NonNullable<PlannerGridProps["clear"]>; scope: ClearScope }) {
  return (
    <>
      {CLEAR_ITEMS.map((what) => {
        const n = clear.countFor(scope, what);
        return (
          <MenuItem key={what} danger disabled={clear.disabled || n === 0} onSelect={() => clear.onClear(scope, what)}>
            {`${CLEAR_WHAT_LABEL[what]} (${n})`}
          </MenuItem>
        );
      })}
    </>
  );
}
```

The toolbar menu, after the switch (create mode only). «Este servicio» is the open picker's column (deviation 3):

```tsx
        {mode === "create" && clear && (
          <Menu
            label="Borrar"
            align="start"
            trigger={<Button variant="ghost" size="md" disabled={clear.disabled}>Borrar</Button>}
          >
            <MenuHeader><span className="font-label text-[10px] uppercase tracking-widest text-mono-500">Todo el mes</span></MenuHeader>
            <ClearItems clear={clear} scope={{ kind: "month" }} />
            {openCell && (
              <>
                <MenuHeader>
                  <span className="font-label text-[10px] uppercase tracking-widest text-mono-500">
                    Este servicio · {columnById.get(openCell.columnId)?.date ?? ""}
                  </span>
                </MenuHeader>
                <ClearItems clear={clear} scope={{ kind: "service", columnId: openCell.columnId }} />
              </>
            )}
          </Menu>
        )}
```

`ColumnHeader` gets `clear?: PlannerGridProps["clear"]` (passed from the `columns.map`), rendered in create mode under the «Omitir» checkbox:

```tsx
      {!stored && clear && (
        <Menu
          label={`Borrar en ${column.date}`}
          align="start"
          trigger={
            <Button variant="ghost" size="sm" disabled={clear.disabled} aria-label={`Borrar en ${column.date}`}>
              Borrar
            </Button>
          }
        >
          <ClearItems clear={clear} scope={{ kind: "service", columnId: column.columnId }} />
        </Menu>
      )}
```

(Use the file's existing names for the open-cell state and the column lookup — `openCell` and `columnById` today.)

- [ ] **Step 5: Handlers, dialog and undo (MonthGenerator)**

Imports: `useToast` from `@/app/components/ui/Toast`, `CueDialog` from `@/app/components/ui/CueDialog`, and from `./clearCells`: `CLEAR_WHAT_LABEL, applyClear, dropClearedMarkers, planClear, restoreCleared, type ClearPlan, type ClearScope, type ClearWhat`.

Hooks, with the other state (above every early return):

```ts
  const { toast, dismiss } = useToast();
  /** «Borrar» todo el mes: open flag, and the payload that outlives the close (CueDialog exit). */
  const [monthClearOpen, setMonthClearOpen] = useState(false);
  const [monthClearWhat, setMonthClearWhat] = useState<ClearWhat>("voices");
  /**
   * «Deshacer» is withdrawn once Auto runs (spec §3.2) and when the month changes — a stale
   * undo would write another month's cells into this grid. The generation makes a click that
   * races the withdrawal a no-op.
   */
  const undoGeneration = useRef(0);
  const undoToastIds = useRef<string[]>([]);
  const withdrawUndos = useCallback(() => {
    undoGeneration.current += 1;
    for (const id of undoToastIds.current) dismiss(id);
    undoToastIds.current = [];
  }, [dismiss]);
  useEffect(() => withdrawUndos, [year, month, withdrawUndos]);
```

Handlers (after `handleCellsChange`):

```ts
  /** Applies a planned clear through `handleCellsChange` and drops the cleared cells' markers. */
  function applyPlannedClear(plan: ClearPlan, offerUndo: boolean) {
    const key = (c: { columnId: string; rowId: string }) => `${c.columnId}|${c.rowId}`;
    const prior = cells.filter((c) => plan.cellKeys.has(key(c)));
    const markers = unfilled.filter((u) => plan.cellKeys.has(key(u)));
    handleCellsChange(applyClear(cells, plan));
    setUnfilled((prev) => dropClearedMarkers(prev, plan));
    if (!offerUndo) return;
    const generation = undoGeneration.current;
    const id = toast({
      message: `Se borraron ${plan.seats} asignaci${plan.seats !== 1 ? "ones" : "ón"}.`,
      tone: "info",
      duration: 10_000,
      action: {
        label: "Deshacer",
        onClick: () => {
          if (generation !== undoGeneration.current) return;
          undoClearRef.current(prior, markers);
        },
      },
    });
    undoToastIds.current.push(id);
  }

  /** «Deshacer» — onto the LIVE cells of the latest render (through `undoClearRef`). */
  function undoClear(prior: GridCell[], markers: { columnId: string; rowId: string }[]) {
    if (autoPending) return;
    handleCellsChange(restoreCleared(cells, prior, columns));
    setUnfilled((prev) => [...prev, ...markers]);
  }
  const undoClearRef = useRef(undoClear);
  useLayoutEffect(() => {
    undoClearRef.current = undoClear;
  });

  function handleClear(scope: ClearScope, what: ClearWhat) {
    if (storedMode || autoPending) return;
    if (scope.kind === "month") {
      setMonthClearWhat(what);
      setMonthClearOpen(true);
      return;
    }
    const plan = planClear({ cells, rows, columns, scope, what });
    if (plan.seats > 0) applyPlannedClear(plan, true);
  }

  /** Re-planned against the LIVE cells at confirm, never the plan the dialog opened with. */
  function confirmMonthClear() {
    setMonthClearOpen(false);
    if (autoPending) return;
    const plan = planClear({ cells, rows, columns, scope: { kind: "month" }, what: monthClearWhat });
    if (plan.seats > 0) applyPlannedClear(plan, false);
  }
```

`handleAuto`: call `withdrawUndos();` right after its `if (!config) { … return; }` block, before the derived hand-off.

The `useRef`/`useLayoutEffect` pair for `undoClearRef` must sit above the `step === "config"` early return like every hook; place it next to `solveWithDerivedHistoryRef`.

Props to `PlannerGrid`:

```tsx
          clear={storedMode ? undefined : {
            countFor: (scope, what) => planClear({ cells, rows, columns, scope, what }).seats,
            onClear: handleClear,
            disabled: autoPending,
          }}
```

The dialog, right after `<PlannerGrid … />` inside the same `viewMode === "edit"` branch (mounted for the whole grid step in create mode; `open` drives it):

```tsx
      {!storedMode && (() => {
        const live = planClear({ cells, rows, columns, scope: { kind: "month" }, what: monthClearWhat });
        const label = CLEAR_WHAT_LABEL[monthClearWhat].toLowerCase();
        return (
          <CueDialog
            open={monthClearOpen}
            title={`Borrar ${label} de todo el mes`}
            label={`Borrar ${label} de todo el mes`}
            size="sm"
            onDismiss={() => setMonthClearOpen(false)}
          >
            <div className="space-y-3 p-6">
              <p className="font-body text-sm text-ink-muted">
                Se quitarán {live.seats} asignaci{live.seats !== 1 ? "ones" : "ón"} de {label} en todo el mes.
                {live.handPlacedApprox > 0 && ` Aproximadamente ${live.handPlacedApprox} se pusieron a mano.`}
              </p>
              <p className="font-body text-xs text-ink-muted/70">
                FOH no se toca. Nada se guarda hasta que presiones «Crear {toCreate.length} borrador{toCreate.length !== 1 ? "es" : ""}».
              </p>
              <div className="flex flex-wrap gap-2">
                <Button variant="danger" onClick={confirmMonthClear} disabled={live.seats === 0}>Borrar</Button>
                <Button variant="secondary" onClick={() => setMonthClearOpen(false)}>Cancelar</Button>
              </div>
            </div>
          </CueDialog>
        );
      })()}
```

`toCreate` must be defined before this JSX (it is, at ~:3752). If the lint config forbids IIFEs in JSX, lift `live`/`label` into two `const`s above the `return` of the grid step.

- [ ] **Step 6: Run to see them pass, then everything**

Run: `npx vitest run app/components/admin/__tests__/PlannerGrid.test.tsx app/components/admin/__tests__/plannerClear.wiring.test.tsx`
Expected: PASS.
Run: `npx tsc --noEmit && npm test && npx eslint .`
Expected: PASS, eslint 0 errors. `cueDialogMount.test.ts` still at baseline 5 (the new dialog uses `open={monthClearOpen}`). Any suite that throws «useToast must be used inside <ToastProvider>» is a `MonthGenerator` render Task 1 missed — wrap it the same way.

- [ ] **Step 7: Commit**

```bash
git add app/components/admin/MonthGenerator.tsx app/components/admin/PlannerGrid.tsx app/components/admin/__tests__/PlannerGrid.test.tsx app/components/admin/__tests__/plannerClear.wiring.test.tsx
git commit -m "feat(planner): «Borrar» voices or instruments per service or for the month" -m "E1 makes Auto keep everything already on the board, so clearing Auto's own picks is how an admin asks for a re-shuffle. A service clear applies at once with «Deshacer» (withdrawn once Auto runs); a month clear confirms with a live count and re-plans against the grid as it is when confirmed. FOH is never cleared in bulk."
```

---

### Task 11: Documentation, and the four gates on the final tree

**Files:**
- Modify: `docs/SOLVER_AND_INFRA.md`, `docs/MONTH_GRID_EDITING.md`, `docs/UTILITIES_AND_COMPONENTS.md`, `CLAUDE.md`

- [ ] **Step 1: `docs/SOLVER_AND_INFRA.md`**

In «Pinned assignments», replace «The client that sends pins («Solo llenar vacíos») is a separate delivery.» with: «The planner sends pins when «Solo llenar vacíos» is on — see «Before the request leaves the planner».» Append to «Before the request leaves the planner»:

```markdown
- **«Solo llenar vacíos» sends the board as pins** (`pinModel.ts`; spec
  `2026-09-29-planner-trailing-saturday-and-fill-empty-design.md` §3). With the switch on, every
  occupied Lead/BGV/Coro seat on a column Auto writes is a pin `{ week, role, person }`, by exact
  `member_name` — one per person per service (Lead before BGV before Coro; the solver refuses
  two), at most 100. What the solver would refuse in English (an occupant who is no longer a
  member, an empty `member_name`, more than 100, a Saturday week not sent, a pinned-only spelling
  that differs from a pool name only in case or spaces) is refused first in Spanish, naming the
  cell. **Off, or with nothing on the board, the request has no `pinned` key** and is exactly
  what it was before. A success is applied only if `pinned_honored` equals the pins sent and the
  schedule shows every pin by exact name; otherwise Auto says «El solver no respetó los lugares
  fijados; no se aplicó nada.». `pin_violations` are named as the rules card names them
  (`pinViolations.ts`); `violation_ceiling_proven: false` adds one caveat.
```

- [ ] **Step 2: `docs/MONTH_GRID_EDITING.md`**

Under «User-visible result», add:

```markdown
- **«Solo llenar vacíos»** (create mode, next to Auto; off by default, never remembered) makes
  Auto keep everything already on the board: occupied voice seats go to the solver as fixed,
  empty ones are filled around them, instruments are completed without moving anyone, FOH is
  untouched. While it runs with the switch on, the grid is read-only. Seats that contradict
  something — the person marked the day unavailable, is outside the solver's groups for that
  seat, or already sits elsewhere in the same service — are named on the chip; the seat still
  wins (E3). What the solver had to give up is listed under Auto.
- **«Borrar»** (create mode, next to Auto and in each column header) clears Voces, Instrumentos
  or both, for one service or the whole month. FOH is never cleared in bulk. A service clear
  applies at once with «Deshacer» (withdrawn once Auto runs); a month clear asks first, with a
  live count and an approximate count of hand-placed seats, and writes nothing until «Crear N
  borradores».
```

- [ ] **Step 3: `docs/UTILITIES_AND_COMPONENTS.md`**

Add three rows beside `plannerModel`, and extend its row:

```markdown
| `pinModel` | «Solo llenar vacíos»'s pure half: board → `pinned` (`collectPins`, one seat per person per service, Lead → BGV → Coro), the Spanish pre-fetch refusals (`pinRefusal`), the exact-name handshake (`pinHandshakeHolds`), board conflicts (`pinConflicts`), `emptyVoiceSeats`, and the `seatLabel`/`serviceDayLabel` wording. |
| `pinViolations` | Parses ADR-0041's six `pin_violations` forms and names each as the rules card does (`pinViolationNotices`); unmatched entries render one generic line. |
| `clearCells` | «Borrar»: `planClear` (scope × Voces/Instrumentos, live counts, approximate hand-placed), `applyClear`, `restoreCleared` (onto live cells, columns still on the grid only), `dropClearedMarkers`. FOH never. |
```

and to the `plannerModel` row: «`solverPools` is the ONE computation of the request's pool names (the board's pin conflicts read it); `applySolveResponse({ pinnedCellKeys })` keeps origin and waivers on cells that sent a pin.»

- [ ] **Step 4: `CLAUDE.md` Reusable utils**

Append after the `fillSpecialGroup`/`orderGroup` entry:

```markdown
`collectPins`/`pinRefusal`/`pinHandshakeHolds` (`app/components/admin/pinModel.ts` — the ONLY
board → solver-pins translation; exact `member_name`, one seat per person per service), `planClear`
(`app/components/admin/clearCells.ts` — «Borrar»; FOH is never cleared in bulk),
```

- [ ] **Step 5: The four gates on the final tree**

Run: `npx tsc --noEmit`
Expected: no output.
Run: `npm test`
Expected: all suites pass (report the count).
Run: `npx eslint .`
Expected: 0 errors (warnings are the backlog).
No `gcf/**` change — the python gate does not apply.

- [ ] **Step 6: Commit**

```bash
git add docs/SOLVER_AND_INFRA.md docs/MONTH_GRID_EDITING.md docs/UTILITIES_AND_COMPONENTS.md CLAUDE.md
git commit -m "docs(planner): «Solo llenar vacíos» and «Borrar»" -m "The solver doc no longer calls the pin client a separate delivery, the grid doc says what the switch and the clear do, and the new pure modules are listed where the next reader looks."
```

---

## After the plan (not tasks — the repo's release pipeline)

1. Fresh code review of the whole merge range (the code-review dispatch carries the docs-audit and worklog-completeness checklists); fix; re-verify the fix range and re-run the gates on the final tree. The last worklog entry before the merge must be a verification.
2. Merge the branch into `preview`, push, verify `dev-owt-backstage.vercel.app` is in the deployment's `alias` and `githubCommitSha` is the pushed commit. `preview` writes the REAL dataset — creating drafts there is a real write; the switch itself writes nothing.
3. PR to `main`, wait for `gates`, merge only with Frank's go-ahead for this PR; verify the production alias the same way.
4. The spec's MCP P4 amendment (§5) stays open: P4 must not be implemented until its plan is amended and re-reviewed.
