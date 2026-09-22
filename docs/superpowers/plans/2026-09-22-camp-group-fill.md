# Fill a group of special services together — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A stored-mode «Llenar especiales…» action that fills the empty Lead, BGV and instrument seats of a ticked group of special services, balancing load inside the group only.

**Architecture:** A pure `fillSpecialGroup` (new `app/components/admin/groupFill.ts`) runs the two existing local fillers on the group's cells alone — `fillColumn` for voices, `fillInstruments` (given a new optional `fillColumns`) for instruments — with `columns = group` and `savedWindow = []`, then merges the result back into the grid. `MonthGenerator` stored mode gets a button and an inline picker panel; the result flows through the existing `handleCellsChange` and the existing «Guardar». No writer, schema or solver change.

**Tech Stack:** Next.js 16, React 19, TypeScript, Vitest + Testing Library (jsdom). Node 22.

**Spec:** `docs/superpowers/specs/2026-09-22-camp-group-fill-design.md` — read it first.

## Global Constraints

- **Spanish UI.** Copy verbatim: «Llenar especiales…», «Llenar especiales» (region label), «Llenar vacíos», «Cancelar», «Este mes no tiene servicios especiales.», «Espera a que termine la operación en curso.», «Las reglas compartidas no están cargadas.», «Especiales llenados. Revisa y guarda.», «Quedaron N lugar(es) sin cubrir en los especiales. Revisa y guarda.»
- **Only EMPTY seats are filled.** Never move an occupant. Never vacate anything in group mode.
- **Inside the group fill, nothing outside the group counts:** `columns = group`, `savedWindow = []`, cells = the group's cells only.
- **The solver is never called.** No change to `serializeStoredColumn`, `/api/admin/roles/**`, the Sanity schema, `draftTargetKey`/`buildColumns`/E3, or `fillInstruments`' behaviour when `fillColumns` is absent.
- **No write until «Guardar».** The fill only changes grid cells, through `handleCellsChange`.
- **House components:** `Button` (`app/components/ui/Button.tsx`) and `Checkbox` for every new control; no new inline-class `<button>`.
- **Gates before claiming done:** `npx tsc --noEmit`, `npm test`, `npx eslint .` with 0 errors.
- **Conventional commits, NO `Co-Authored-By` or AI attribution trailer** (CLAUDE.md overrides the harness reminder).
- Branch `claude/camp-group-fill` in worktree `vibrant-noyce-683c5a`.

---

### Task 1: `fillInstruments` fills an explicit column list

**Files:**
- Modify: `app/components/admin/instrumentFill.ts` (`FillInstrumentsInput`, ~:54-64; `fillInstruments`, ~:113-180)
- Test: `app/components/admin/__tests__/instrumentFill.test.ts`

**Interfaces:**
- Produces: `FillInstrumentsInput.fillColumns?: GridColumn[]` — when present, exactly those columns are filled, in the given order, and no cell is vacated.

- [ ] **Step 1: Write the failing test**

Append to `app/components/admin/__tests__/instrumentFill.test.ts`:

```ts
describe("fillInstruments — explicit fillColumns (group fill)", () => {
  const SET_A = col("2026-03-18", "special_role");
  const SET_B = col("2026-03-19", "special_role");
  const SET_C = col("2026-03-20", "special_role");

  it("fills exactly the given columns, specials included, alternating in the given order", () => {
    const out = fillInstruments({
      columns: [SET_A, SET_B, SET_C],
      fillColumns: [SET_A, SET_B, SET_C],
      rows: ROWS,
      cells: [],
      members: [p("a", "Ana", ["Keys"]), p("b", "Beto", ["Keys"])],
      savedWindow: [],
    });
    expect([SET_A, SET_B, SET_C].map((c) => occupantsOf(out.cells, c.columnId, KEYS).join(","))).toEqual(["a", "b", "a"]);
  });

  it("vacates nothing — a stale auto cell elsewhere survives by reference", () => {
    const staleAuto = cell(COLS[0].columnId, KEYS, ["z"], "auto");
    const out = fillInstruments({
      columns: [SET_A],
      fillColumns: [SET_A],
      rows: ROWS,
      cells: [staleAuto],
      members: [p("a", "Ana", ["Keys"])],
      savedWindow: [],
    });
    expect(out.cells.find((c) => c.columnId === COLS[0].columnId && c.rowId === KEYS)).toBe(staleAuto);
    expect(occupantsOf(out.cells, SET_A.columnId, KEYS)).toEqual(["a"]);
  });

  it("without fillColumns, specials are still skipped (default unchanged)", () => {
    const out = run([p("a", "Ana", ["Keys"])], [], [...COLS, SET_A]);
    expect(occupantsOf(out.cells, SET_A.columnId, KEYS)).toEqual([]);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run app/components/admin/__tests__/instrumentFill.test.ts`
Expected: FAIL — TypeScript/vitest reports `fillColumns` unknown, or the first two cases leave the special empty.

- [ ] **Step 3: Implement**

In `FillInstrumentsInput`, change the `columns` doc comment and add the new field after it:

```ts
  /** The whole grid, every column type. Only weekend columns are filled unless `fillColumns` names others. */
  columns: GridColumn[];
  /**
   * GROUP FILL (`groupFill.ts`). When present, fill EXACTLY these columns, in
   * this order — specials included — and vacate nothing: a stored-mode group
   * fill must never undo a pick it did not make. Absent ⇒ today's behaviour:
   * weekend columns by date, their previous auto instrument cells vacated first.
   */
  fillColumns?: GridColumn[];
```

In `fillInstruments`, replace the three lines that build `weekend`, `weekendIds` and `working` with:

```ts
  const weekend = columns.filter(isWeekend).sort((a, b) => a.date.localeCompare(b.date));
  const targets = input.fillColumns ?? weekend;
  let working = input.fillColumns
    ? input.cells
    : vacateAutoInstrumentCells(input.cells, new Set(weekend.map((c) => c.columnId)));
```

and change the loop header `for (const column of weekend) {` to `for (const column of targets) {`.

- [ ] **Step 4: Run the tests**

Run: `npx vitest run app/components/admin/__tests__/instrumentFill.test.ts app/components/admin/__tests__/instrumentFill.wiring.test.tsx`
Expected: PASS — the three new cases and every existing one.

- [ ] **Step 5: Commit**

```bash
git add app/components/admin/instrumentFill.ts app/components/admin/__tests__/instrumentFill.test.ts
git commit -m "feat(admin): fillInstruments can fill an explicit column list without vacating"
```

---

### Task 2: `fillSpecialGroup`

**Files:**
- Create: `app/components/admin/groupFill.ts`
- Test: `app/components/admin/__tests__/groupFill.test.ts`

**Interfaces:**
- Consumes: `fillColumn` (`localFill.ts`), `fillInstruments` + `fillColumns` (Task 1), `compareServiceTime` (`app/utils/serviceTime.ts`), `GridColumn.time?`.
- Produces:
  - `orderGroup(group: GridColumn[]): GridColumn[]` — date, then `compareServiceTime(time)`, then `columnId`.
  - `fillSpecialGroup(input: { group: GridColumn[]; rows: GridRow[]; cells: GridCell[]; members: RankMember[]; config: SolverConfig }): { cells: GridCell[]; unfilled: { columnId: string; rowId: string }[] }`

- [ ] **Step 1: Write the failing tests**

```ts
// app/components/admin/__tests__/groupFill.test.ts
//
// The stored-mode group fill (spec 2026-09-22-camp-group-fill-design.md §4):
// load counts inside the group only, empty seats only, weekends invisible.
import { describe, expect, it } from "vitest";

import type { RankMember } from "../candidateRanking";
import { DEFAULT_SOLVER_CONFIG } from "../solverConfigDefaults";
import { buildRows, type GridCell, type GridColumn, type SolverConfig } from "../plannerModel";
import { fillSpecialGroup, orderGroup } from "../groupFill";

const ROWS = buildRows();
const KEYS = "instrumento:Keys";
const NO_RULES: SolverConfig = { ...DEFAULT_SOLVER_CONFIG, restrictions: [], conflicts: [], presence: [] };

const voz = (id: string, alias: string, unavailableDates: string[] = []): RankMember =>
  ({ _id: id, member_name: `${alias} Apellido`, alias, memberType: ["voz"], unavailableDates });
// Aliases sort in id order: a < b < … so a tie resolves to the lower letter.
const TEN = ["a", "b", "c", "d", "e", "f", "g", "h", "i", "j"].map((id) => voz(id, id.toUpperCase()));

const special = (id: string, date: string, time?: string): GridColumn =>
  ({ columnId: id, date, type: "special_role", serviceName: `Set ${id}`, ...(time ? { time } : {}) });
const SUNDAY: GridColumn = { columnId: "sun", date: "2026-10-04", type: "sunday_role" };

const cell = (columnId: string, rowId: string, ids: string[], origin: GridCell["origin"] = "manual"): GridCell =>
  ({ columnId, rowId, occupants: ids.map((memberId) => ({ memberId })), origin });
const occ = (cells: GridCell[], columnId: string, rowId: string) =>
  cells.find((c) => c.columnId === columnId && c.rowId === rowId)?.occupants.map((o) => o.memberId) ?? [];
const voices = (cells: GridCell[], columnId: string) => [...occ(cells, columnId, "lead"), ...occ(cells, columnId, "bgv")];

function fill(group: GridColumn[], cells: GridCell[] = [], members: RankMember[] = TEN, config: SolverConfig = NO_RULES) {
  return fillSpecialGroup({ group, rows: ROWS, cells, members, config });
}

describe("orderGroup", () => {
  it("orders by date, then time (absent last), whatever the input order", () => {
    const late = special("x", "2026-10-03", "18:30");
    const early = special("y", "2026-10-03", "09:00");
    const untimed = special("z", "2026-10-03");
    const friday = special("w", "2026-10-02", "18:45");
    expect(orderGroup([untimed, late, friday, early]).map((c) => c.columnId)).toEqual(["w", "y", "x", "z"]);
  });
});

describe("fillSpecialGroup — separation", () => {
  it("ignores a full Sunday: members who serve on it are still picked first inside the group", () => {
    const sundayCells = [cell("sun", "lead", ["a", "b"]), cell("sun", "bgv", ["c", "d", "e"])];
    const set = special("s1", "2026-10-03", "09:00");
    const out = fill([set], sundayCells);
    expect(occ(out.cells, "s1", "lead")).toEqual(["a", "b"]);
    expect(occ(out.cells, "s1", "bgv")).toEqual(["c", "d", "e"]);
  });

  it("returns every cell outside the group by reference, untouched", () => {
    const sundayLead = cell("sun", "lead", ["a", "b"]);
    const out = fill([special("s1", "2026-10-03")], [sundayLead]);
    expect(out.cells.find((c) => c.columnId === "sun" && c.rowId === "lead")).toBe(sundayLead);
  });

  it("ignores non-special columns passed in the group", () => {
    const out = fill([SUNDAY]);
    expect(out.cells).toEqual([]);
    expect(out.unfilled).toEqual([]);
  });
});

describe("fillSpecialGroup — rotation", () => {
  const FIVE = ["09:00", "12:30", "14:45", "18:30", "20:45"].map((t, i) => special(`s${i}`, "2026-10-03", t));

  it("balances voice appearances inside the group to within one", () => {
    const out = fill(FIVE);
    const counts = TEN.map((m) => FIVE.filter((c) => voices(out.cells, c.columnId).includes(m._id)).length);
    expect(Math.max(...counts) - Math.min(...counts)).toBeLessThanOrEqual(1);
    for (const c of FIVE) expect(voices(out.cells, c.columnId)).toHaveLength(5);
  });

  it("fills in set order: the 09:00 set gets the first picks even when passed last", () => {
    const out = fill([FIVE[3], FIVE[0]]);
    expect(voices(out.cells, "s0").sort()).toEqual(["a", "b", "c", "d", "e"]);
    expect(voices(out.cells, "s3").sort()).toEqual(["f", "g", "h", "i", "j"]);
  });

  it("keeps a pinned occupant, and the pin counts toward group load", () => {
    const pinned = cell("s0", "lead", ["j"]);
    const out = fill([FIVE[0], FIVE[1]], [pinned]);
    expect(occ(out.cells, "s0", "lead")).toContain("j");
    expect(voices(out.cells, "s1")).not.toContain("j");
  });
});

describe("fillSpecialGroup — eligibility", () => {
  it("never picks an unavailable member or a wrong-Tipo member", () => {
    const set = special("s1", "2026-10-03");
    const members = [
      voz("a", "A", ["2026-10-03"]),
      ...TEN.slice(1),
      { _id: "keys", member_name: "Keys Player", alias: "K", memberType: ["instrumento"], instruments: ["Keys"] } as RankMember,
    ];
    const out = fill([set], [], members);
    expect(voices(out.cells, "s1")).not.toContain("a");
    expect(voices(out.cells, "s1")).not.toContain("keys");
  });

  it("never seats a forbidden pair in the same set", () => {
    const members = [voz("lu", "Lucía"), voz("ni", "Niza"), voz("p1", "Pepe"), voz("p2", "Quique"), voz("p3", "Rita"), voz("p4", "Sara")];
    const config: SolverConfig = { ...NO_RULES, conflicts: [{ id: "c", personA: "Lucía", personB: "Niza", pattern: "*.LeadBGV" }] };
    const sets = [special("s1", "2026-10-03", "09:00"), special("s2", "2026-10-03", "12:30")];
    const out = fill(sets, [], members, config);
    for (const s of sets) {
      const v = voices(out.cells, s.columnId);
      expect(v.includes("lu") && v.includes("ni")).toBe(false);
    }
  });
});

describe("fillSpecialGroup — instruments", () => {
  it("fills Keys on every set, alternating between two players inside the group", () => {
    const players: RankMember[] = [
      { _id: "k1", member_name: "Ana Teclas", alias: "Ana", memberType: ["instrumento"], instruments: ["Keys"] },
      { _id: "k2", member_name: "Beto Teclas", alias: "Beto", memberType: ["instrumento"], instruments: ["Keys"] },
    ];
    const sets = ["09:00", "12:30", "18:30"].map((t, i) => special(`s${i}`, "2026-10-03", t));
    const out = fill(sets, [], [...TEN, ...players]);
    expect(sets.map((s) => occ(out.cells, s.columnId, KEYS).join(","))).toEqual(["k1", "k2", "k1"]);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run app/components/admin/__tests__/groupFill.test.ts`
Expected: FAIL — cannot resolve `../groupFill`.

- [ ] **Step 3: Implement**

```ts
// app/components/admin/groupFill.ts
//
// The stored-mode GROUP fill for special services (spec
// 2026-09-22-camp-group-fill-design.md). Not the solver, and never described as
// one: it runs the two existing local fillers — `fillColumn` for Lead/BGV and
// `fillInstruments` for instrument rows — on the GROUP'S CELLS ALONE, with
// `columns = group` and `savedWindow = []`. That scoping is the whole feature:
// inside the fill, the only load that exists is appearances inside the group, so
// a camp rotates among whoever goes and the month's weekends weigh nothing.
//
// Empty seats only. Every occupant already in a group cell — a pin — is kept and
// counts toward group load; nothing is vacated. Cells outside the group are
// returned by reference.

import { compareServiceTime } from "@/app/utils/serviceTime";
import type { RankMember } from "./candidateRanking";
import { fillInstruments } from "./instrumentFill";
import { fillColumn } from "./localFill";
import type { GridCell, GridColumn, GridRow, SolverConfig } from "./plannerModel";

type Seat = { columnId: string; rowId: string };

/** Set order: date, then clock time (absent last), then id for determinism. */
export function orderGroup(group: GridColumn[]): GridColumn[] {
  return [...group].sort(
    (a, b) =>
      a.date.localeCompare(b.date) ||
      compareServiceTime(a.time, b.time) ||
      a.columnId.localeCompare(b.columnId),
  );
}

const key = (c: Pick<GridCell, "columnId" | "rowId">) => `${c.columnId}\u0000${c.rowId}`;

export function fillSpecialGroup(input: {
  group: GridColumn[];
  rows: GridRow[];
  cells: GridCell[];
  members: RankMember[];
  config: SolverConfig;
}): { cells: GridCell[]; unfilled: Seat[] } {
  const group = orderGroup(input.group.filter((c) => c.type === "special_role"));
  if (group.length === 0) return { cells: input.cells, unfilled: [] };

  const ids = new Set(group.map((c) => c.columnId));
  let working = input.cells.filter((c) => ids.has(c.columnId));
  const unfilled: Seat[] = [];

  for (const column of group) {
    const out = fillColumn({
      column,
      columns: group,
      rows: input.rows,
      cells: working,
      members: input.members,
      savedWindow: [],
      config: input.config,
    });
    working = out.cells;
    unfilled.push(...out.unfilled);
  }

  const instr = fillInstruments({
    columns: group,
    fillColumns: group,
    rows: input.rows,
    cells: working,
    members: input.members,
    savedWindow: [],
    config: input.config,
  });
  working = instr.cells;
  unfilled.push(...instr.unfilled);

  // Merge: group cells replace their originals in place; new group cells append.
  const filled = new Map(working.map((c) => [key(c), c]));
  const merged = input.cells.map((c) => {
    if (!ids.has(c.columnId)) return c;
    const next = filled.get(key(c));
    filled.delete(key(c));
    return next ?? c;
  });
  return { cells: [...merged, ...filled.values()], unfilled };
}
```

- [ ] **Step 4: Run the tests**

Run: `npx vitest run app/components/admin/__tests__/groupFill.test.ts app/components/admin/__tests__/localFill.test.ts app/components/admin/__tests__/instrumentFill.test.ts`
Expected: PASS. If the forbidden-pair case fails because `DEFAULT_SOLVER_CONFIG` lacks a field the rule engine reads, build `NO_RULES` from the full default and only override `restrictions`/`conflicts`/`presence` (as written); do not weaken the assertion.

- [ ] **Step 5: Commit**

```bash
git add app/components/admin/groupFill.ts app/components/admin/__tests__/groupFill.test.ts
git commit -m "feat(admin): fillSpecialGroup — fill a group of specials with load scoped to the group"
```

---

### Task 3: «Llenar especiales…» in stored mode

**Files:**
- Modify: `app/components/admin/MonthGenerator.tsx` — imports (~:1-60), state near `clearPending` (~:1750-1768), Escape effect (~:1999-2012), a new handler beside `handleCellsChange` (~:2475), the stored toolbar box (~:3504-3515), the panel beside the «Limpiar mes» panel (~:3852).
- Test: `app/components/admin/__tests__/MonthGenerator.stored.test.tsx`

**Interfaces:**
- Consumes: `fillSpecialGroup`, `orderGroup` (Task 2); existing `storedColumns`, `storedMutationLocked`, `storedEditBlocked`, `solverConfig`, `rows`, `cells`, `members`, `handleCellsChange`, `setUnfilled`, `setSaveNotice`, `fmtDate`, `Checkbox`.

- [ ] **Step 1: Write the failing tests**

In `MonthGenerator.stored.test.tsx`: add `within` to the `@testing-library/react` import; give `renderStored` a `members` option — add `members?: ComponentProps<typeof MonthGenerator>["members"];` to its options type and pass `members={options.members ?? members}`. Then append:

```tsx
describe("MonthGenerator — «Llenar especiales…»", () => {
  const voz = ["v1", "v2", "v3", "v4", "v5"].map((id) => ({ _id: id, member_name: id, memberType: ["voz"] }));
  const emptySet = (id: string, time: string) => role({
    _id: id, _rev: `rev-${id}`, _type: "special_role", date: "2026-02-14",
    service_name: `Campamento ${time}`, time,
    leads: [], bgvs: [], chorus: [], instruments: [], foh: [],
  });

  it("is disabled with its reason when the month has no special", () => {
    renderStored([role()], { members: voz });
    const trigger = screen.getByRole("button", { name: "Llenar especiales…" }) as HTMLButtonElement;
    expect(trigger.disabled).toBe(true);
    expect(trigger.title).toBe("Este mes no tiene servicios especiales.");
  });

  it("lists the month's specials all ticked, fills their empty seats locally, and writes nothing until Guardar", () => {
    const fetchMock = vi.fn(async () => response());
    vi.stubGlobal("fetch", fetchMock);
    renderStored([role(), emptySet("set-a", "09:00"), emptySet("set-b", "12:30")], { members: voz });

    fireEvent.click(screen.getByRole("button", { name: "Llenar especiales…" }));
    const panel = screen.getByRole("region", { name: "Llenar especiales" });
    const boxes = within(panel).getAllByRole("checkbox") as HTMLInputElement[];
    expect(boxes.map((b) => b.checked)).toEqual([true, true]);
    expect(within(panel).queryByText(/Domingo/)).toBeNull();

    fireEvent.click(within(panel).getByRole("button", { name: "Llenar vacíos" }));
    expect(screen.queryByRole("region", { name: "Llenar especiales" })).toBeNull();
    expect((screen.getByRole("button", { name: "Guardar 2 servicios" }) as HTMLButtonElement).disabled).toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("leaves an unticked special untouched", () => {
    renderStored([emptySet("set-a", "09:00"), emptySet("set-b", "12:30")], { members: voz });
    fireEvent.click(screen.getByRole("button", { name: "Llenar especiales…" }));
    const panel = screen.getByRole("region", { name: "Llenar especiales" });
    fireEvent.click(within(panel).getAllByRole("checkbox")[1]!);
    fireEvent.click(within(panel).getByRole("button", { name: "Llenar vacíos" }));
    expect(screen.getByRole("button", { name: "Guardar 1 servicio" })).toBeTruthy();
  });

  it("Escape closes the panel before it could close the editor", () => {
    const { onClose } = renderStored([emptySet("set-a", "09:00")], { members: voz });
    fireEvent.click(screen.getByRole("button", { name: "Llenar especiales…" }));
    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByRole("region", { name: "Llenar especiales" })).toBeNull();
    expect(onClose).not.toHaveBeenCalled();
  });
});
```

(`ServiceRole` gained `time?` in PR #90's branch; the fixture's `time` is valid.)

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run app/components/admin/__tests__/MonthGenerator.stored.test.tsx`
Expected: FAIL — no «Llenar especiales…» button.

- [ ] **Step 3: Implement**

Imports: add `import Button from "@/app/components/ui/Button";` if absent, and `import { fillSpecialGroup, orderGroup } from "./groupFill";`.

State, next to the `clearPending` block:

```tsx
  // «Llenar especiales…» (stored mode): an inline picker, the same pattern as
  // «Limpiar mes». The group is chosen per run and never persisted (spec
  // 2026-09-22-camp-group-fill-design.md §3).
  const [groupFillOpen, setGroupFillOpen] = useState(false);
  const [groupFillPicked, setGroupFillPicked] = useState<Set<string>>(new Set());
  const groupFillTriggerRef = useRef<HTMLButtonElement>(null);
  const groupFillRegionRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!groupFillOpen) return;
    groupFillRegionRef.current?.focus();
  }, [groupFillOpen]);
```

Derived values, placed AFTER `storedColumns`, `storedEditBlocked` and `storedMutationLocked` are all defined (the last of them, `storedMutationLocked`, is at ~:1953):

```tsx
  const storedSpecialColumns = storedMode
    ? orderGroup(storedColumns.filter((c) => c.type === "special_role" && c.admission === "approved"))
    : [];
  const groupFillBlocked = storedMutationLocked
    ? "Espera a que termine la operación en curso."
    : storedEditBlocked
      ?? (solverConfig === null ? "Las reglas compartidas no están cargadas." : null)
      ?? (storedSpecialColumns.length === 0 ? "Este mes no tiene servicios especiales." : null);
```

Escape: in the keydown effect, directly after the `clearPending` line, add:

```tsx
      if (groupFillOpen) { setGroupFillOpen(false); groupFillTriggerRef.current?.focus(); return; }
```

and add `groupFillOpen` to that effect's dependency array.

Handlers, next to `handleCellsChange`:

```tsx
  function openGroupFill() {
    if (groupFillBlocked) return;
    setGroupFillPicked(new Set(storedSpecialColumns.map((c) => c.columnId)));
    setGroupFillOpen(true);
  }

  function closeGroupFill() {
    setGroupFillOpen(false);
    groupFillTriggerRef.current?.focus();
  }

  /**
   * The group fill: local, empty seats only, load scoped to the ticked group
   * (`groupFill.ts`). Routed through `handleCellsChange` so touched-role
   * tracking, dirtiness and «Guardar» behave exactly as for a hand edit —
   * nothing is written until the admin saves.
   */
  function handleGroupFill() {
    const config = solverConfig;
    if (!config || groupFillBlocked) return;
    const group = storedSpecialColumns.filter((c) => groupFillPicked.has(c.columnId));
    if (group.length === 0) return;
    const out = fillSpecialGroup({ group, rows, cells, members, config });
    handleCellsChange(out.cells);
    const groupIds = new Set(group.map((c) => c.columnId));
    setUnfilled((prev) => [...prev.filter((u) => !groupIds.has(u.columnId)), ...out.unfilled]);
    const n = out.unfilled.length;
    setSaveNotice(n === 0
      ? "Especiales llenados. Revisa y guarda."
      : `Quedaron ${n} lugar${n !== 1 ? "es" : ""} sin cubrir en los especiales. Revisa y guarda.`);
    closeGroupFill();
  }
```

Toolbar: in the stored box, wrap the existing «+ Nuevo servicio» `<button>` (the `!composerOpen` branch) so the two sit side by side:

```tsx
          {!composerOpen ? (
            <div className="flex flex-wrap gap-2">
              {/* existing «+ Nuevo servicio» <button> unchanged */}
              <Button
                ref={groupFillTriggerRef}
                variant="secondary"
                size="lg"
                onClick={openGroupFill}
                disabled={!!groupFillBlocked}
                title={groupFillBlocked ?? undefined}
              >
                Llenar especiales…
              </Button>
            </div>
          ) : (
```

Panel: directly before the «Limpiar mes» confirmation block:

```tsx
      {storedMode && groupFillOpen && (
        <div ref={groupFillRegionRef} tabIndex={-1} role="region" aria-label="Llenar especiales" className="rounded-lg border border-accent/20 bg-accent/5 px-3 py-2.5 space-y-2">
          <p className="font-body text-xs text-mono-300">
            Llena los lugares vacíos de Lead, BGV e instrumentos en los especiales marcados.
            {" "}Solo cuenta la carga dentro de este grupo; los fines de semana no pesan.
            {" "}Lo que ya está asignado no se mueve y nada se guarda hasta «Guardar».
          </p>
          {storedSpecialColumns.map((column) => (
            <Checkbox
              key={column.columnId}
              align="start"
              className="font-body text-xs text-mono-300"
              checked={groupFillPicked.has(column.columnId)}
              onChange={(event) => {
                const checked = event.target.checked;
                setGroupFillPicked((prev) => {
                  const next = new Set(prev);
                  if (checked) next.add(column.columnId); else next.delete(column.columnId);
                  return next;
                });
              }}
            >
              <span>{fmtDate(column.date)} · {column.serviceName}{column.time ? ` · ${column.time}` : ""}</span>
            </Checkbox>
          ))}
          <div className="flex gap-2">
            <Button variant="primary" size="lg" onClick={handleGroupFill} disabled={groupFillPicked.size === 0}>
              Llenar vacíos
            </Button>
            <Button variant="secondary" size="lg" onClick={closeGroupFill}>
              Cancelar
            </Button>
          </div>
        </div>
      )}
```

If `Button` does not forward `ref` to the `<button>` in this codebase, check its signature (`app/components/ui/Button.tsx`, it destructures `ref`) — it does, as a React 19 prop.

- [ ] **Step 4: Run tests and gates**

Run: `npx vitest run app/components/admin && npx tsc --noEmit && npx eslint app/components/admin`
Expected: PASS, tsc clean, 0 eslint errors. `inputFontSize.test.ts` excludes `admin/` by path.

- [ ] **Step 5: Commit**

```bash
git add app/components/admin/MonthGenerator.tsx app/components/admin/__tests__/MonthGenerator.stored.test.tsx
git commit -m "feat(admin): «Llenar especiales…» fills a ticked group of stored specials locally"
```

---

### Task 4: Open an empty upcoming month

**Files:**
- Create: `app/components/admin/monthPills.ts`
- Test: `app/components/admin/__tests__/monthPills.test.ts`
- Modify: `app/components/admin/ServicesPanel.tsx` — `futureMonths` (~:796), the month-filter render condition (~:1164), the empty state in the card list (~:1294)
- Test: `app/components/admin/__tests__/MonthGenerator.stored.test.tsx` (an empty month opens with a usable composer)

**Interfaces:**
- Produces: `addMonths(ym: string, n: number): string`, `upcomingMonthPills(roleMonths: string[], currentYM: string, ahead?: number): string[]`.

- [ ] **Step 1: Write the failing tests**

```ts
// app/components/admin/__tests__/monthPills.test.ts
import { describe, expect, it } from "vitest";
import { addMonths, upcomingMonthPills } from "../monthPills";

describe("addMonths", () => {
  it("shifts across year boundaries", () => {
    expect(addMonths("2026-09", 1)).toBe("2026-10");
    expect(addMonths("2026-11", 2)).toBe("2027-01");
    expect(addMonths("2026-12", 1)).toBe("2027-01");
    expect(addMonths("2026-01", 0)).toBe("2026-01");
  });
});

describe("upcomingMonthPills", () => {
  it("always offers the current month and the next two, plus every later month with services", () => {
    expect(upcomingMonthPills(["2026-08", "2026-09", "2027-02"], "2026-09")).toEqual([
      "2026-09", "2026-10", "2026-11", "2027-02",
    ]);
  });
  it("never offers a past month and never duplicates", () => {
    expect(upcomingMonthPills(["2026-07", "2026-10", "2026-10"], "2026-09")).toEqual(["2026-09", "2026-10", "2026-11"]);
  });
  it("offers the window even when no month has services", () => {
    expect(upcomingMonthPills([], "2026-12")).toEqual(["2026-12", "2027-01", "2027-02"]);
  });
});
```

Append to `MonthGenerator.stored.test.tsx`:

```tsx
describe("MonthGenerator — an empty month", () => {
  it("opens with zero services and a composer bounded to that month", () => {
    renderStored([role()], { initialMonth: "2026-10", openComposerInitially: true });
    expect(screen.getAllByText(/servicio/).length).toBeGreaterThan(0);
    const date = screen.getByLabelText("Fecha") as HTMLInputElement;
    expect(date.min).toBe("2026-10-01");
    expect(date.max).toBe("2026-10-31");
  });
});
```

(If `getByLabelText("Fecha")` is ambiguous in this harness, target the composer's field by its id, `#mg-create-date`, via `document.getElementById`.)

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run app/components/admin/__tests__/monthPills.test.ts app/components/admin/__tests__/MonthGenerator.stored.test.tsx`
Expected: `monthPills` FAILS (module missing). The stored case may already PASS — it pins that the editor works on an empty month, which this task relies on; if it fails, stop and report the failure instead of changing `MonthGenerator`.

- [ ] **Step 3: Implement**

```ts
// app/components/admin/monthPills.ts
//
// The Servicios panel's upcoming month pills. Built from the months that hold a
// service, PLUS the current month and the next `ahead` months even when empty —
// so a month can be opened in the stored editor and given its first service
// (the camp sets, spec 2026-09-22-camp-group-fill-design.md §12) without
// generating the whole month with the solver first.

/** "YYYY-MM" shifted by `n` months. */
export function addMonths(ym: string, n: number): string {
  const [y, m] = ym.split("-").map(Number);
  const index = y * 12 + (m - 1) + n;
  return `${Math.floor(index / 12)}-${String((index % 12) + 1).padStart(2, "0")}`;
}

export function upcomingMonthPills(roleMonths: string[], currentYM: string, ahead = 2): string[] {
  const out = new Set(roleMonths.filter((ym) => ym >= currentYM));
  for (let i = 0; i <= ahead; i++) out.add(addMonths(currentYM, i));
  return [...out].sort();
}
```

In `ServicesPanel.tsx`:
- import `{ upcomingMonthPills } from "./monthPills"`;
- replace `const futureMonths = allMonths.filter(ym => ym >= currentYM);` with `const futureMonths = upcomingMonthPills(allMonths, currentYM);`;
- change the month filter's condition `{canFilterMonths(sourceRecords) && allMonths.length > 0 && (` to `{canFilterMonths(sourceRecords) && (`;
- directly after the `No hay servicios próximos.` paragraph, add:

```tsx
          {selectedMonths.size === 1 && visibleCards.length === 0 && (
            <p className="font-body text-sm text-mono-500 text-center py-12">
              No hay servicios en {monthLabel}. «+ Nuevo» crea el primero en este mes.
            </p>
          )}
```

- [ ] **Step 4: Run tests and gates**

Run: `npx vitest run app/components/admin && npx tsc --noEmit && npx eslint app/components/admin`
Expected: PASS, tsc clean, 0 eslint errors.

- [ ] **Step 5: Commit**

```bash
git add app/components/admin/monthPills.ts app/components/admin/__tests__/monthPills.test.ts app/components/admin/ServicesPanel.tsx app/components/admin/__tests__/MonthGenerator.stored.test.tsx
git commit -m "feat(admin): offer the next months as pills even when empty, so a month opens without generating it"
```

---

### Task 5: Docs and full gates

**Files:**
- Modify: `docs/adr/0010-specials-fill-locally-not-in-the-solver.md` (the supersession note block at the top)
- Modify: `CLAUDE.md` and `AGENTS.md` («Reusable utils» — the two must stay byte-identical, `agentDocsParity.test.ts`)
- Modify: `docs/superpowers/specs/2026-09-22-camp-group-fill-design.md` (status)

- [ ] **Step 1: ADR-0010 note**

Directly after the existing `> **2026-08-05 UI supersession:** …` blockquote, add:

```markdown
> **2026-09-22 stored-mode group fill:** stored mode gains «Llenar especiales…»
> (`groupFill.ts`, spec `docs/superpowers/specs/2026-09-22-camp-group-fill-design.md`).
> It runs this ADR's local filler on a group of stored specials the admin ticks, with
> load scoped to that group only. Still local, still never the solver, still empty
> seats only; the one-service composer stays manual.
```

- [ ] **Step 2: CLAUDE.md + AGENTS.md**

In «Reusable utils», after the `rehearsalMixes.ts` entry's closing parenthesis and comma, insert (identically in both files):

```markdown
`fillSpecialGroup`/`orderGroup` (`app/components/admin/groupFill.ts` — the ONLY stored-mode
filler: a ticked group of special services, Lead/BGV via `fillColumn` and instruments via
`fillInstruments({ fillColumns })`, with `columns = group` and `savedWindow = []` so only
load inside the group counts; empty seats only, nothing vacated, nothing written until
«Guardar»),
```

- [ ] **Step 3: Spec status**

Change the spec's `**Status:** spec, pending Frank's read` to `**Status:** implemented on branch \`claude/camp-group-fill\`; not released`.

- [ ] **Step 4: Full gates**

Run: `npx tsc --noEmit && npm test && npx eslint .`
Expected: tsc clean; every test green (if `colourInventory.test.ts` reports `filesScanned` off by the new module, regenerate with `node scripts/colour-inventory.mjs` and include the fixture in the commit); eslint 0 errors.

- [ ] **Step 5: Commit**

```bash
git add docs/adr/0010-specials-fill-locally-not-in-the-solver.md CLAUDE.md AGENTS.md docs/superpowers/specs/2026-09-22-camp-group-fill-design.md app/utils/__tests__/__fixtures__/colour-inventory.json
git commit -m "docs: stored-mode group fill — ADR-0010 note, reusable-utils entry, spec status"
```

---

## After the tasks (coordinator)

Fresh whole-branch code review of the merge range (base = `claude/campamento-sets-app-d5466d` head, `07ccd1d9`) → fix → scoped re-review → gates on the final tree → merge into `preview`, verify the dev alias → PR to `main` stacked after #90.
