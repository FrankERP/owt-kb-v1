# Fill a group of special services together, in stored mode — design

**Date:** 2026-09-22 · **Status:** released to production 2026-09-23 (PR #91) · **Risk tier:** standard
(client-side fill feeding the existing, unchanged stored-mode save; see §8) ·
**Builds on:** `2026-09-22-same-day-specials-design.md` (PR #90, `special_role.time`) ·
**Motivating event:** Campamento 2–4 October 2026.

## 1. Problem

The six camp sets can now be created as empty `special_role` documents with a name and a
time, from `/admin` stored mode («+ Nuevo servicio»). Frank wants the app to fill them:

- **Every set gets its own roster.** Leaders, voices and some instruments (Keys and Drums
  named) rotate across the sets.
- **The camp is filled apart from the general roles.** Who served on October's Sundays must
  not decide who leads the 12:30 set, and the camp must not weigh on any ordinary weekend.
- **The group is whoever goes to the camp** — option (a) in chat: availability plus Tipo.
  People who are not going are marked unavailable for 2–4 October; Tipo already decides
  who may take each seat. No attendee list.

What stands in the way today, read from the code:

1. **Stored mode has no Auto.** The «🤖 Auto-asignar con Solver» button renders in the
   month CREATE flow only (`PlannerGrid.tsx`, `mode === "create"`). The stored grid is a
   manual editor. *(An earlier chat message said Auto fills specials in stored mode. That
   was wrong.)*
2. **The create flow drafts one special per date**, on purpose (E3, E19; spec
   `2026-09-22-same-day-specials-design.md` §2 «Amendment»). It cannot draft five
   Saturday sets.
3. **The local fillers' load is month-wide.** `fillColumn` (`localFill.ts`) ranks with
   `windowRoles = [...savedWindow, ...cellsToParticipantRoles(working, columns, members)]`
   — the 56-day saved window plus every column in the grid, weekends included.
4. **The instrument filler skips specials.** `fillInstruments` (`instrumentFill.ts`) fills
   weekend columns only; its seat count spans every cell it is given.

## 2. Decision

A new stored-mode action, **«Llenar especiales…»**, fills the EMPTY Lead, BGV and
instrument seats of a group of stored `special_role` columns that the admin ticks in a
dialog. The group is chosen per run and is not persisted. Inside the fill, the only load
that counts is the group's own; the saved window and every column outside the group are
invisible to it. The fill changes grid cells and nothing else: the admin reviews the
result and saves with the existing «Guardar», which PATCHes each changed column through
the unchanged full-array serializer.

The solver is not involved (ADR-0010 stands: a special is never sent to CP-SAT).

### Rejected

- **A persisted `event` field on `special_role`** (floated in chat). It would repeat the
  whole write-path plumbing `time` just went through — parser, fingerprint, PATCH
  set/unset, serializer, header, composer — ten days before the camp, and six hand-typed
  copies of one event name split silently on a typo. What it would buy over a per-run
  group is §6's residual leak, which is small. Revisit if events become routine.
- **Re-keying the create flow to draft several specials per date.** E19: a name-bearing
  draft identity re-mints ids on rename and posts a duplicate document.
- **Excluding every special from month-wide load.** That reverses ADR-0010 decision 3 for
  every vigil and midweek service to fix one event. The group scope achieves the
  separation only where it is asked for.

## 3. The group

- **Chosen per run.** The dialog lists every stored `special_role` column of the open
  month whose admission is `approved` (a read-only column is never offered), as
  `fecha · nombre · hora`, in the grid's order (date, then `compareServiceTime`). All are
  ticked by default; Frank unticks what is not part of the event. Weekend columns are
  never listed — October's Sunday at Tepepan stays an ordinary `sunday_role`.
- **Membership of the pool** is the existing eligibility, unchanged: `rankCandidates`'s
  `eligible` verdict. That already means right Tipo for the seat, not unavailable on the
  set's date, not blocked by a shared rule (`solverConfig` pairs, restrictions), and not
  already in the same category on that set. Unavailability is a hard block for the fill
  and stays selectable by hand — today's behaviour.

## 4. The fill

Pure function `fillSpecialGroup` in a new module `app/components/admin/groupFill.ts`:

```ts
fillSpecialGroup(input: {
  group: GridColumn[];           // the ticked special columns
  rows: GridRow[];
  cells: GridCell[];             // the WHOLE grid
  members: RankMember[];
  config: SolverConfig;          // required — no fill against rules nobody loaded
}): { cells: GridCell[]; unfilled: { columnId: string; rowId: string }[] }
```

1. **Order** the group by date, then `compareServiceTime(time)`. Chronological order is
   what makes the rotation and the instrument alternation read in set order.
2. **Scope.** `groupIds = new Set(group.map(c => c.columnId))`; `inGroup = cells.filter(c
   => groupIds.has(c.columnId))`. Everything below runs on `inGroup` with
   `columns = group` and `savedWindow = []`, so load is appearances inside the group only.
3. **Voices.** For each group column in order: `fillColumn({ column, columns: group,
   rows, cells: working, members, savedWindow: [], config })`. It already fills only up to
   each row's target and keeps every existing occupant (Lead and BGV,
   `AUTO_FILL_ROW_IDS`); Coro stays manual on specials, as today.
4. **Instruments.** `fillInstruments` gains an optional `fillColumns?: GridColumn[]`.
   Absent, it behaves exactly as today (weekend columns, vacate the weekend's previous
   auto instrument cells). Present, it fills exactly those columns in the given order and
   **vacates nothing**. Its seat count (`seatCounts`) and alternation (`playedPrevious`)
   already read only the cells they are handed, so passing `inGroup` scopes both to the
   camp. Instrument rows with zero declarers stay manual, as today.
5. **Merge** the group's cells back over the grid by `(columnId, rowId)`; every cell
   outside the group survives by reference.
6. **Report** the fillers' `unfilled` entries.

**Only empty seats are filled.** A seat Frank pinned — Paquito, or anyone — is an
occupant and is never moved; the fill rotates everything else around it (ADR-0010: a
local fill never consumes a human choice). FOH stays manual (Raúl on audio is typed by
hand). Pressing «Llenar especiales…» again fills whatever is still empty; it does not
re-roll earlier picks. To re-roll, close the planner without saving («Cerrar de todos modos») and fill again.

## 5. UI

- **Button** «Llenar especiales…» in the stored-mode toolbar beside «+ Nuevo servicio».
  Disabled, with its reason shown as a line under the toolbar (a disabled house `Button` shows no tooltip), while `storedMutationLocked`, while stored editing
  is blocked (`storedEditBlocked`, which already folds in the capability gate and
  `rulesBlocked`), while `solverConfig` is `null`, or when the month has no approved
  special column.
- **Picker panel**, inline, the same pattern as «Limpiar mes»'s confirmation (the planner
  is a full-width panel and uses no `CueDialog`): a `role="region"` labelled «Llenar
  especiales», focus moved into it on open and back to the trigger on close, Escape closes
  it before it could close the editor. It holds the list of §3 as `Checkbox` rows,
  «Llenar vacíos» and «Cancelar» (`Button`). «Llenar vacíos» is disabled with nothing
  ticked.
- **Result.** The grid updates in place; the filled columns become dirty, so the existing
  «Guardar» and close-without-saving paths apply unchanged. Seats left empty are merged into the
  existing `unfilled` state (dropping this group's previous entries first, so a second
  run cannot double-count) and a notice says how many remained: «Quedaron N lugares sin
  cubrir en los especiales.» Zero writes happen until «Guardar».

## 6. Separation, stated precisely

**Inside the fill:** nothing outside the group counts. Not October's weekends, not other
specials, not the 56-day saved window.

**Around it, unchanged and already true:**
- The weekend CP-SAT solve never sees a special: its history is
  `owt_solver_history_v2`, which excludes specials (ADR-0010 decision 3), and stored-mode
  saves write no solver history at all.
- The weekend instrument filler counts only the cells of the month it is creating.

**Residual, accepted:** `savedWindowFor` selects saved roles by date, so for about eight
weeks the camp sets appear in the saved window of later months. That moves the load
number the manual picker shows and the order in which a later month's own specials are
auto-filled. It does not reach CP-SAT or weekend instruments. A persisted event marker
would be needed to exclude it (§2 «Rejected»).

## 7. Notifications

Saving seats on a **published** special sends assignment notices, one per document
(`docs/NOTIFICATIONS.md` «Landmines»). Fill and save while the sets are unpublished,
review, then publish; publishing notifies each seated member per set.

## 8. Risk tier

Standard. The fill is client-side and only changes grid cells. The write path is the
existing stored-mode save — `serializeStoredColumn`, `PATCH /api/admin/roles/[id]` —
unchanged by this delivery; a client consumer of an already-approved writer stays
standard. `fillInstruments`' default behaviour is pinned by its existing tests. Pipeline:
spec → plan → implement → gates → fresh code review of the diff → fix → re-verify →
`preview` → verify alias → PR.

## 9. Tests

- `groupFill`:
  - Two specials plus one Sunday column in the grid, the Sunday full of people: the group
    fill ignores the Sunday's load (a member who serves every Sunday is still picked
    first when they are the least-loaded inside the group).
  - Five sets and ten voice members: each member's voice appearances (Lead + BGV) differ
    by at most one across the group. Lead and BGV share one Tipo (`voz`) and one load
    (`computeParticipation`'s `total`), so the balance is per person, not per seat.
  - A pinned occupant is kept and still counts toward group load.
  - An unavailable member is never picked; a wrong-Tipo member is never picked.
  - A forbidden pair from `solverConfig` never shares a set.
  - Instruments: Keys and Drums filled on every set with declarers, balanced within the
    group, with no-back-to-back when the pool allows it.
  - Cells outside the group are returned by reference, untouched.
  - Group order is date then time, whatever order the columns arrive in.
- `instrumentFill`: `fillColumns` present fills a special column and vacates nothing;
  absent, every existing test passes unchanged.
- `MonthGenerator` stored mode: the button's disabled states; the panel lists only
  approved specials, all ticked; unticking one leaves it untouched; a fill marks the
  columns dirty and writes nothing until «Guardar».
- Gates: `npx tsc --noEmit`, `npm test`, `npx eslint .` with 0 errors.

## 10. Docs in the same delivery

- ADR-0010: a dated note under its 2026-08-05 supersession — stored mode now has an
  explicit, per-run group fill for specials; still local, still never the solver, still
  empty seats only.
- CLAUDE.md «Reusable utils»: `fillSpecialGroup` (`groupFill.ts`) as the ONLY
  stored-mode filler, with the group-scoped load rule. AGENTS.md mirrors it
  (`agentDocsParity.test.ts`).
- No new env var or secret; `docs/SECRETS.md` untouched.

## 11. Rollout

Branch `claude/camp-group-fill`, stacked on `claude/campamento-sets-app-d5466d`
(PR #90), so #90 can ship on its own. After release: mark who is NOT going unavailable for
2–4 October, create the six sets, pin the fixed seats, «Llenar especiales…» with the six
ticked, review, «Guardar», build the setlists, publish.

## 12. Opening a month that has no services yet

Added 2026-09-22 at Frank's request: he wants to create the camp sets in October without
generating the month with the solver first.

**Today:** «Editar mes» and «+ Nuevo» (`ServicesPanel`) open the stored editor on the one
selected month pill, or on the current month when none or several are selected. The pills
are built only from months that already hold a service (`allMonths` from `roles`), so an
empty October has no pill and the editor falls back to September. The composer then
bounds its date to September on purpose (`min`/`max` of the open month).

**Change:** the upcoming pills always include the current month and the next two, empty or
not — a pure `upcomingMonthPills(roleMonths, currentYM, ahead = 2)` in
`app/components/admin/monthPills.ts`, with `addMonths(ym, n)` beside it. Selecting an
empty month shows «No hay servicios en {mes}. «+ Nuevo» crea el primero en este mes.»,
and «+ Nuevo» opens the stored editor on that month with the composer, exactly as for a
month that already has services. Nothing is generated and the solver is not called.

**Later, when October IS generated** with «📅 Generar mes»: the camp sets already hold
Saturday 3, and the create flow does not see stored specials when it drafts weekends, so
Saturday 3 must be left unticked there by hand. Sunday 4 generates normally.
