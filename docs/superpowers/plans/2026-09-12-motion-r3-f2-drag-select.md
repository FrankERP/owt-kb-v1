# R3 F2 — Drag-select in the availability grid — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** In `/me`'s twelve-month grid, a member presses «Seleccionar fechas», drags across the days they will miss, releases, and writes one «Razón» for the whole range — with the next month fading in underneath as the finger nears the bottom of the page.

**Architecture:** A pure selection model (`dragSelect.ts`) the grid drives with pointer events under pointer capture; the existing `applyRange` on `useAvailability` commits the range, and the panel's single `NotePopover` learns to edit a range (same note on every day). The «Rango…» date fields move inside the grid as the keyboard/VoiceOver path; the panel's «Rango…» button goes.

**Tech Stack:** React 19 pointer events (no `motion` — the grid is not under `app/components/ui/**`), Tailwind, vitest + RTL. Haptics via `haptic()`.

**Spec:** `docs/superpowers/specs/2026-09-08-premium-motion-design.md` Part XII (R3), subsection F2 to be written in Task 3. Frank's words (2026-09-12): "range selection was a held click dragged through the calendar … a shadow of the next month appears underneath and the closer the user gets the more solid and selectable it becomes … once the selection is done the Razón pop-up shows"; "make the page not scrollable [while selecting] … make sure we won't trigger the selection a long press activates … a button to activate this mode".

## Global Constraints

- Gates in ONE `&&` chain with the commit (Node 22: `export PATH=~/.nvm/versions/node/v22.22.3/bin:$PATH`): `node scripts/colour-inventory.mjs && npx tsc --noEmit && npx vitest run && npx eslint .` (0 errors) then the commit. Every task runs the full suite.
- **The availability save contract is untouched** (`PATCH /api/me/availability`, `_rev`, wholesale arrays, 409 adopt + held conflict, one rebase). `useAvailability.ts` gains NOTHING in this plan — `applyRange`, `setNote`, `remove` already exist.
- **No long-press anywhere.** Selection mode is entered by a `Button` («Seleccionar fechas» ⇄ «Listo»); inside the mode a touch on a day starts the range immediately.
- While the mode is on, the months container carries `touch-action: none`, `user-select: none`, `-webkit-user-select: none`, `-webkit-touch-callout: none`, and cancels `contextmenu`. Outside the mode nothing changes for the page.
- No auto-scroll of the page during a drag. The next month appears as a "shadow" tile after the last visible month; it becomes selectable only when solid.
- Days before `todayIso` are never part of a range (preview or commit) — `applyRange` already skips them; the preview must too.
- `Button` for every button (the grid's existing hand-rolled `Anterior`/`Siguiente`/page-dot buttons are pre-existing exemptions — leave them), `Collapse` for the date-fields disclosure, `DateField` for the two dates, never a bare native input. No `Presence appear` above the fold.
- Spanish UI; conventional commits; no AI attribution; docs current in the same task.

---

### Task 1: Selection model + range note popover

**Files:**
- Create: `app/components/availability/dragSelect.ts`, `app/components/availability/__tests__/dragSelect.test.ts`
- Modify: `app/components/availability/NotePopover.tsx`, `app/components/__tests__/availabilityPopoverPosition.test.tsx` (add range cases; keep the existing ones byte-identical)

**Interfaces:**
- Produces (neutral module, no hooks):
  - `isoRange(a: string, b: string, todayIso: string): string[]` — every `YYYY-MM-DD` from `min(a,b)` to `max(a,b)` inclusive, local-noon loop (`new Date(iso.slice(0,10)+"T12:00:00")`, never bare), days `< todayIso` dropped, capped at 366 iterations. `isoRange("2026-09-15","2026-09-12","2026-09-13")` → `["2026-09-13","2026-09-14","2026-09-15"]`.
  - `shadowOpacity(distancePx: number, reach = 120): number` — `0` at or beyond `reach`, `1` at `0`, linear between, clamped; `NaN`/negative → `1`.
  - `isoFromPoint(x: number, y: number, doc: Pick<Document, "elementFromPoint"> = document): string | null` — `elementFromPoint(x,y)?.closest("[data-iso]")?.getAttribute("data-iso") ?? null`; an element whose closest `[data-iso]` host also carries `data-shadow="true"` and `data-solid="false"` returns `null` (a shadow that is not yet solid is not selectable).
  - `rangeLabel(first: string, last: string): string` — «del 12 al 15 de septiembre» when one month, «del 30 de octubre al 1 de noviembre» otherwise; `first === last` → `fmtDayLabel(first)` (imported from `NotePopover`). Local noon.
- `NoteAnchor` gains `isos?: string[]` (the range, ascending; `iso` stays the anchor/first day and the popover's positioning key). When `isos` has more than one day: the title is `rangeLabel(isos[0], isos.at(-1))`; the input's value is `notes.get(isos[0]) ?? ""`; typing calls `setNote(d, text)` for every `d` in `isos`; the remove button reads «Quitar estas fechas» and calls `remove(d)` for every `d`. Single-day behaviour unchanged.

- [ ] **Step 1: Failing tests** — `dragSelect.test.ts`: `isoRange` reversed args normalise; inclusive ends; past days dropped; same-day range; month/year crossing (`2026-12-30`→`2027-01-02`); cap (a 400-day span yields 366). `shadowOpacity(120)=0`, `(60)=0.5`, `(0)=1`, `(-5)=1`, `(300)=0`. `isoFromPoint` with a fake `elementFromPoint` returning a span inside a `[data-iso]` button → the iso; inside a `data-shadow="true" data-solid="false"` host → `null`; solid shadow → the iso; no host → `null`. `rangeLabel` three cases. `availabilityPopoverPosition.test.tsx`: render `NotePopover` with `popover={{ iso:"2026-09-12", isos:["2026-09-12","2026-09-13","2026-09-14"], x:0,y:0,above:false }}`, `notes` empty, spies for `setNote`/`remove` → title «del 12 al 14 de septiembre»; typing "viaje" calls `setNote` three times with "viaje"; «Quitar estas fechas» calls `remove` three times and closes.
- [ ] **Step 2: Run them, watch them fail.** `npx vitest run app/components/availability/__tests__/dragSelect.test.ts app/components/__tests__/availabilityPopoverPosition.test.tsx`
- [ ] **Step 3: Implement** `dragSelect.ts` (header comment: why pure — jsdom has no layout, so the drag's arithmetic is tested here and the grid only wires events) and the `NotePopover` range branch (a `days = popover.isos?.length ? popover.isos : [popover.iso]` local; everything else keys off `days`).
- [ ] **Step 4: Gates; commit** — `feat(availability): range-aware note popover and the drag-select model`

---

### Task 2: The grid: selection mode, drag, shadow month, date fields inside

**Files:**
- Modify: `app/components/availability/AvailabilityGrid.tsx`, `app/components/availability/MyAvailabilityPanel.tsx`, `app/components/availability/__tests__/myAvailabilityPanel.test.tsx`
- Create: `app/components/availability/__tests__/availabilityGridDrag.test.tsx`

**Interfaces:**
- Consumes: `isoRange`, `shadowOpacity`, `isoFromPoint`, `rangeLabel` from Task 1; `state.applyRange`, `state.todayIso`, `state.mark`; `openNote(iso, anchor, isos?)`.
- Produces: `AvailabilityGrid` prop `openNote: (iso: string, anchor: HTMLElement, isos?: string[]) => void` (the panel forwards `isos` into the `NoteAnchor`). `MyAvailabilityPanel` no longer renders a «Rango…» button or the `availability-range` Collapse — those move into the grid.

**Behaviour (the grid):**
- A `Button` above the month nav: «Seleccionar fechas» (`aria-pressed={selecting}`); while `selecting` it reads «Listo». Entering/leaving the mode calls `closeNote()` and clears any in-progress drag.
- Every day cell gets `data-iso={iso}` (past cells too — `isoRange` drops them). The months container (`div.grid`) gets, while `selecting`: `style={{ touchAction:"none", userSelect:"none", WebkitUserSelect:"none", WebkitTouchCallout:"none" }}`, `onContextMenu={e => e.preventDefault()}`, and the pointer handlers below. Outside the mode the cells keep today's `onClick` → `mark` + `openNote`. Inside the mode the cell `onClick` is a no-op (the pointer flow owns it).
- `onPointerDown` (container, `selecting` only, primary button): `iso = isoFromPoint(e.clientX, e.clientY)`; if `iso` and `iso >= todayIso`: `e.currentTarget.setPointerCapture(e.pointerId)`, `setDrag({ anchor: iso, current: iso })`, `void haptic("medium")`, `e.preventDefault()`.
- `onPointerMove` (while `drag`): `iso = isoFromPoint(...)`; if `iso` and `iso !== drag.current` → `setDrag({...drag, current: iso})`, `void haptic("selection")`. Also measure `distance = lastTileRef.current.getBoundingClientRect().bottom - e.clientY` and `setShadow(shadowOpacity(distance))` when `canNext`; `0` otherwise.
- `onPointerUp` / `onPointerCancel`: if `drag`: `days = isoRange(drag.anchor, drag.current, todayIso)`; if `days.length`: `applyRange(days[0], days.at(-1), true)`; if `drag.current` lies in the shadow month (`iso >= shadowMonthFirstIso`) → `setPage(page + 1)` BEFORE opening the popover (so its anchor cell is mounted) — open the note on the next frame with `requestAnimationFrame`, anchored to the cell `[data-iso="${days[0]}"]` found via `querySelector` on the container (fallback: the container itself); `openNote(days[0], anchorEl, days)`. Then `setDrag(null)`, `setShadow(0)`. `pointercancel` → `setDrag(null)`, `setShadow(0)`, no commit.
- Preview: while `drag`, cells whose iso is in `isoRange(drag.anchor, drag.current, todayIso)` (memoised per render) render a `pending` style: `bg-availability-fg/20 text-availability-soft ring-1 ring-availability-strong/50`. The first day additionally `ring-2`.
- Shadow month: when `canNext` and `shadow > 0`, render one extra month tile after the visible three (the first month of the next page) with `data-shadow="true" data-solid={shadow >= 1 ? "true" : "false"}`, `style={{ opacity: shadow }}`, `aria-hidden="true"`, its cells `tabIndex={-1}`; the tile has `data-iso` cells like any month so `isoFromPoint` resolves inside it once solid. `lastTileRef` points at the last VISIBLE month tile (not the shadow). `shadowMonthFirstIso` = that month's `YYYY-MM-01`.
- Escape while `drag` cancels it (no commit).
- Date fields: a small `Collapse` (`id="availability-range"`) under the mode button, opened by a `Button variant="ghost"` «Rango por fechas» (`aria-expanded`, `aria-controls`); inside, the exact Desde/Hasta `DateField`s, «Marcar»/«Quitar rango» and `canApplyRange` logic lifted VERBATIM from `MyAvailabilityPanel.tsx` (state moves with them). The panel's `toggleRange`/`applySpan`/range state/«Rango…» button are deleted; the recurring panel's mutual-exclusion logic loses its `setRangeOpen(false)` line. `myAvailabilityPanel.test.tsx`'s range cases: open «Ver calendario» first, then «Rango por fechas», then the same assertions.
- Copy under the mode button while `selecting`: «Arrastra sobre los días que no puedes. Suelta para escribir la razón.» (`font-body text-xs text-mono-500`).

- [ ] **Step 1: Failing tests** — `availabilityGridDrag.test.tsx` (stub `HTMLElement.prototype.setPointerCapture`/`releasePointerCapture` with `vi.fn()`; stub `document.elementFromPoint` per event to return the target cell; `vi.mock("@/app/utils/haptics")`): (a) without the mode, a cell click calls `mark` and `openNote(iso, cell)` with no `isos`; (b) after «Seleccionar fechas», `pointerDown` on the 12th then `pointerMove` resolving to the 15th then `pointerUp` → `applyRange("2026-09-12","2026-09-15",true)` once and `openNote("2026-09-12", el, ["2026-09-12",…,"2026-09-15"])`; the three cells carried the pending ring before release; (c) reversed drag (15th → 12th) commits the same range; (d) `pointercancel` commits nothing; (e) «Listo» leaves the mode and the container no longer has `touch-action: none`; (f) the shadow tile is absent at `shadow=0` and present with `data-solid="false"` after a `pointerMove` whose `clientY` sits 60 px above the mocked `lastTile` bottom (mock `getBoundingClientRect` on the ref'd tile) and `data-solid="true"` at 0 px; (g) a drag ending in the solid shadow month advances the page (the range label shows the next page's months). Mock `Date` to `2026-09-09`.
- [ ] **Step 2: Run, watch them fail.**
- [ ] **Step 3: Implement** per the behaviour above; keep the file's header comment honest (it now owns paging AND the selection gesture; every edit still goes through the hook).
- [ ] **Step 4: Move the date fields** into the grid; delete them from the panel; update `myAvailabilityPanel.test.tsx`.
- [ ] **Step 5: Gates; commit** — `feat(me): drag-select unavailable days in the calendar; the next month fades in as you reach it`

---

### Task 3: Docs + delivery

**Files:**
- Modify: `docs/MOTION.md` ("Me (R3)" → "F2" bullet: mode button instead of long-press, why; touch-action/user-select/callout; no auto-scroll; shadow month; range note), `docs/UTILITIES_AND_COMPONENTS.md` (rows: `AvailabilityGrid`, `NotePopover`, `MyAvailabilityPanel`; new `dragSelect.ts` row), spec Part XII "### F2 — drag-select (2026-09-12)" (Frank's ask verbatim, the rulings: mode button over long-press; shadow only at the page edge; no auto-scroll; date fields kept as the accessible path inside the grid; one note for the range), `CLAUDE.md`/`AGENTS.md` if `useAvailability`'s entry mentions the range panel.
- [ ] Gates; commit — `docs(motion): R3 F2 — drag-select`
- [ ] Delivery: whole-F2 review (fable) → fix → re-review; preview push; alias; dev-verify captures (mode on, with `--click "Seleccionar fechas"`; the date-fields disclosure); `me-after.png` refreshed; PR #65 comment; STOP for Frank's look.
