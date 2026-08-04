# Month grid as the editing surface — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task.

**Status:** draft, four open questions answered with the user 2026-08-03, not yet reviewed.

**Goal.** Make the three-column planner grid the way services are edited. An **"Editar mes"** button on Servicios opens the existing layout against *stored* services. The Tablero (`SeatBoard`) is retired. The grid gains swap — whole teams or individual roles — between services.

**Why this is riskier than the grid that already exists.** Everything shipped so far on this surface **creates**. This plan **edits**, and there is existing data to destroy. Two paths make it dangerous:

- Editing a **published** service calls `notifyRoleAssignments` (`app/api/admin/roles/[id]/route.ts:296`), which emails the team. A month grid can change six services in one sitting.
- Every write is revision-guarded (`ifRevisionId`, `:235`) and returns `stale_revision` (`:186`, `:207`, `:286`). Six services means six revisions to hold, and a partial failure must not leave the admin guessing.

The calendar/specials plan for this same surface took 11 adversarial rounds and caught ~20 blockers, several of which wrote wrong data. Assume this one is worse.

---

## Load-bearing facts

Verified against source. Breaking any is a regression, not a UI change.

**The grid cannot edit today**
1. `PlannerGrid`'s only notion of a stored service is `createBlockFor(c) → "existing" | "created" | null` (`PlannerGrid.tsx:167`) — a reason to **refuse** a column, not a way to load one. No `_rev`, no PATCH, no read of stored assignments.
2. Everything the grid produces goes through the create path (`monthDraftCreate.ts`).

**What the Tablero uniquely does, and therefore what must find a home**
3. **Changes a service's type** — `Domingo / Sábado / Especial` (`SeatBoard.tsx:483-490`).
4. **Changes the date** — `type="date"` (`:497`).
5. **Names/renames a special** — `service_name` (`:231`, `:443`).

**What survives the Tablero's removal, because it lives on the card**
6. **Deletion** — `ServicesPanel.tsx:1597` (`Eliminar servicio`), `DELETE` at `:712`.
7. **Copy instruments to another day** — `:858`, server-side under a capability gate.
8. Publish / unpublish / `Publicar listos` / `Publicar todos` — `:1350`, `:985`, `:1001`.

**Swap is already built server-side — this is the plan's biggest de-risking**
9. `POST /api/admin/roles/swap` accepts exactly two shapes (`swap/route.ts:44-59`): `{ kind: "team", roles: [{id, rev}, {id, rev}] }` and `{ kind: "seat", source: {roleId, rev, path, itemKey}, target: {…} }`.
10. It **derives the written assignments from the CURRENT stored roles** — a replacement team payload is never accepted. A seat swap addresses items by stored `_key`, never a rendered index, and sets only the person reference, so `_key`, instrument label and FOH label are preserved: *the person moves, the seat does not*.
11. A team swap exchanges exactly the five seat fields, leaving identity, date, service name, publication state, songs and team notes untouched.
12. It asserts **every** involved revision and coordination token in **one transaction**, and covers weekend↔weekend, weekend↔special and special↔special.
13. `ServicesPanel.tsx:807` already calls it, so there is a working client precedent to copy.

**The write path**
14. `PATCH /api/admin/roles/[id]` guards with `ifRevisionId(role._rev)` (`:235`) and rejects with `stale_revision` (`:186`, `:207`, `:286`).
15. There is a **lock** mechanism beyond the document revision — `lockRev` / `ownedLock` (`:184-188`), asserted separately.
16. `notifyRoleAssignments` fires post-commit from the edit route (`:296`), inside `after()`.

---

## Decisions

| # | Decision |
|---|---|
| **E1** | **The grid loads stored services into cells.** This is the whole build: a read path the grid has never had, keyed to each column's service, carrying `_rev` per service. |
| **E2** | **The three orphaned operations move to the column header**, since all three answer "what service is this?": type, date, and a special's name. |
| **E3** | **Moving a service to a date OUTSIDE the displayed month is not supported.** A month grid cannot express it. This is a capability lost with the Tablero and must be stated in the UI, not discovered. |
| **E4** | **Swap wires to the existing route (facts 9–13). Do not reimplement it, and do not build a replacement-payload path** — the route refuses one by design, and that refusal is what makes swap safe. |
| **E5** | **Deletion, copy-instruments and publish stay on the card.** They are already there and are not part of this plan. |
| **E6** | **Editing is explicit-save, not per-keystroke** — matching what the rules panel just learned. A POST per change would thrash the revision guard and lose edits to its own concurrency check. |

---

## Answered 2026-08-03 with the user — these were the open questions

| # | Decision |
|---|---|
| **E7** | **Notify ONLY the services actually modified**, and let the existing debounce do the summarising. The grid opens the whole month but most columns will be untouched, so the save must diff against what it loaded and fire nothing for an unchanged service. **No batching mechanism needs building:** `NOTIFY_DEBOUNCE_MINUTES` defaults to **15** and `NOTIFY_MAX_WINDOW_MINUTES` to 60 (`app/utils/outboxNotice.ts:97-98`), so several modified services already collapse into one summary email per person. The user asked for exactly the behaviour that ships today. **The risk is the inverse of what it first appeared:** not "six emails", but a *false* notification for a service the admin merely looked at — so the change-detection is the load-bearing part, not the fan-out. |
| **E8** | **One `Guardar` for the month, with a change summary before committing.** On partial failure the screen states exactly which services committed and which did not, and leaves the failed ones still editable. The create path already behaves this way and is the precedent to copy. |
| **E9** | **Only services that already exist get a column — plus an explicit "create one service" action from the same screen, filled MANUALLY.** Not empty columns for every date. The new service is created empty and its seats are filled by hand with the picker that already exists, which already enforces the rules. **Solver auto-fill for a single service is explicitly OUT OF SCOPE** — see "Deferred" below. This keeps the plan to paths that already exist: creating is the POST the grid already uses, and filling is the picker the grid already has. |
| **E10** | **A service outside the displayed month is reached by navigating the grid to that month.** The month picker already exists; nothing extra is built, and E3's stated loss is narrower than it first looked. |

## Tasks

Ordering is by risk: the read path before the write path, and swap last because it is the only part with a proven server-side contract.

### Task 1 — Pin what must not move
Tests only, against current code. The create path must still work identically when the grid gains a second mode. Pin: `createBlockFor`'s refusal reasons; the draft-identity key; `cellsToDrafts`' output for a create; the participation counts (month scope, the `service_name` dedup key, the `creatableColumns` filter). Prove each fails when inverted.

### Task 2 — The read path
Load stored services for a month into `GridCell[]`, carrying `_rev` per service. Decide and pin how a cell knows which service it belongs to and what happens when a date has none. Do **not** write anything yet.

### Task 3 — Create one service from the edit view (E9)
Pick a date and type (and a name, if special), create it, and it becomes a column you fill by hand. **No solver.** Both halves already exist — the POST is the create path the grid already uses, and the picker already enforces the rules — so this is wiring plus the conflict cases: a date that already holds a service of that type, and a special whose `special_role:${date}:${normalized name}` identity collides with a stored one.

### Task 4 — Column-header operations (E2)
Type, date, and special name. Each has a conflict case that must be refused with a stated reason, not silently dropped: switching to a type that already exists on that date; moving onto an occupied date; renaming a special to a name already used on the same date (the server's identity is `special_role:${date}:${normalized name}`).

### Task 5 — The write path (E6, E7, E8)
PATCH per service with `ifRevisionId`, plus the separate lock assertion (fact 15). Explicit save with a change summary (E8). Partial failure must leave the admin knowing exactly which services committed and leave the rest editable.

**The change-detection is the dangerous part, not the writing.** Per E7 a service that was merely displayed must produce no PATCH and no notification. Diff against what was loaded, not against a fresh fetch — and remember `_key`s and array order are not stable proxies for "changed". A false positive emails the team about a service nobody edited.

### Task 6 — Swap (E4)
Wire both shapes to `/api/admin/roles/swap`, copying the client precedent at `ServicesPanel.tsx:807`. Team swap between two columns; seat swap between two cells. The route derives from stored state, so the grid must send **identifiers and revisions**, never a roster.

### Task 7 — Retire the Tablero
Only after 1–6 are proven. Delete `SeatBoard` and its mounts; verify nothing else imports it. This also retires its open a11y question and the rail-behind-the-scrim problem (the Tablero rail sits at `z-40` behind `CueDialog`'s `z-[90]` scrim, so clicking it dismisses the dialog).

---

## Deferred — not in this plan

**Solver auto-fill for a single service.** Scoped out with the user 2026-08-03. The ask was for it to account for the month's existing assignments so it does not hand the same people another turn — which is a different request shape from anything that exists: `buildSolveRequest` is per-month, and CP-SAT is given a whole month's slots at once. The local greedy filler built for specials (`localFill.ts`) is probably the better fit for one service than a CP-SAT round trip, since it already ranks by load, enforces the rules hard, and re-evaluates per placement. Worth its own plan when it comes up; nothing here should foreclose it.

---

## Global constraints

- Done gate per task: `npx tsc --noEmit`, `npm test`, `npx eslint .` at **0 errors** (91 warnings are a deliberate backlog).
- Spanish UI copy. Dates `YYYY-MM-DD` at local noon, never bare `new Date(iso)`. 44px touch targets.
- Sanity array-of-object writes need a `_key` per item.
- **Never** add AI/Claude attribution or a `Co-Authored-By` trailer.
- Prove tests discriminate by mutation. This project has shipped ~30 tests that could not fail; assume yours can too until shown otherwise.
- The app also ships as a Capacitor iOS wrap (WebKit). A `position: fixed` element under an ancestor combining `isolation: isolate` with `overflow: hidden` is clipped in real Safari and **not** in Chromium — this cost a dozen diagnostic rounds. Any new fixed surface needs a portal and a real-Safari check.
