# Drag a person between seats on the month grid — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task.

**Status:** draft, not yet reviewed.
**Risk tier:** **CRITICAL** — see "Risk classification" below. Two sequential fresh approvals on byte-identical text.

## The request, in the user's words

> "I want to add a button or a mechanism that allows me to grab somebody that is already assigned in another position in the same role, and put them on the position I'm editing (or that I have selected/clicked) on the grid."

> "Do you think a button for this would be best or could we implement something drag and drop? So I can change to anywhere on the grid, and if a constraint exists against the move I'm doing then just prompt an alert with option to force the change or desist because of the constraint/rule."

> "Dropping onto a cell that's already at target will add the person and mark amber."

**The problem it solves.** Moving Gaby from BGV to LEAD of the same service today means: close the picker, open the BGV cell, remove her, reopen LEAD, add her. The picker shows her as `Ya asignado en Bgv` and refuses the pick, with no path to relocate.

## Risk classification — CRITICAL, and why

This is UI on top of an already-approved writer, which the review skill would normally classify **standard**. It is classified **critical** deliberately, on one hazard:

**A move implemented as add-without-remove writes the same person into a service twice.** `canonicalRefs` preserves genuine duplicates, `normalizeRefs` does not dedupe, and `seatFields` mints one `_key` per entry — so a duplicate `_ref` reaches Sanity, is double-counted by `computeParticipation`, and is notified per seat. This is the exact failure class already fought on this surface. The payload the client sends is therefore a data-safety contract, not merely a rendering concern.

If review concludes the hazard is structurally impossible, the tier can be argued down — but it is not assumed.

---

## Load-bearing facts

Verified against source.

1. **A cell is mutated only through `withUpdatedCell`** (`PlannerGrid.tsx:292-298`), which takes a complete `memberIds` array for one `(rowId, columnId)` plus an optional `addOverride`. A drag touching two cells is therefore **two** calls, and they must be applied to one `cells` value — not sequentially against stale state.
2. **`toggleCandidate` (`:607-613`) is the existing pick path.** It reads the current occupants, and removal is `current.filter(id => id !== memberId)`. Drag-move can reuse this shape rather than inventing a mutation.
3. **D6, stated in the file's own header (`:20-23`):** *"No cell ever refuses an occupant for reasons of count, and none ever replaces one — replacement is what evicted a drummer in a shipped bug, on 18 services running two drummers on one Drums seat. A manual pick still refuses a same-category double."* Drop-onto-at-target therefore **already** has the behaviour the user asked for: it adds and shows amber.
4. **Two distinct block reasons**, and they are not equally forceable:
   - `blockedReason` — `Ya asignado en {seat}` (`candidateRanking.ts:195`), the same-category double-duty block.
   - `ruleBlockedReason` — `Regla: no puede coincidir con {name}` (`ruleEnforcement.ts:408`), the conflict rule.
5. **Stored mode tracks changes per role** via `touchedStoredRoleIds` (`MonthGenerator.tsx:1561`) diffed against `baselineByRole` (`:1575`). A cross-service drag touches **two** roles and must mark both, or one half of the move never saves.
6. **The grid scrolls horizontally**, and columns can be off-screen.
7. The app ships as a **Capacitor iOS wrap** (WebKit), where touch drag competes with that scroll.

---

## Decisions

| # | Decision |
|---|---|
| **D1** | **A drag is a MOVE: remove from source and add to target in ONE `cells` update.** Never add-then-remove, never two updates against stale state. This is the whole of the critical hazard — an add-only path writes a duplicate `_ref` that reaches Sanity. |
| **D2** | **The same-category double-duty block dissolves by construction and is NEVER forced.** A move cannot double someone — they leave the source seat. There is no "force" for `blockedReason`, because D6 calls it a data error rather than a judgement call. |
| **D3** | **Only a rule conflict raises the prompt.** Force / desist, per the user's ask. This reuses the meaning of the shipped "Asignar de todos modos" override, so a forced drop must record the waived rule exactly as that override does — the marker, the rule-scoping, and clearing on removal. |
| **D4** | **Dropping onto an at-target cell ADDS and marks amber** (the user's decision). This is already D6's behaviour; the drag must not introduce a replace path. |
| **D5** | **Drag works anywhere on the grid** — within a service and across services. A cross-service move marks **both** roles touched (fact 5). |
| **D6** | **Keyboard parity is required, not optional.** Drag-and-drop is not keyboard-operable, and this surface has had deliberate keyboard work. The accessible equivalent is the button the user originally proposed: on a candidate blocked by `blockedReason`, an action that performs the same move. |

---

## Open questions

**O1 — Does a drag onto an occupied cell ever mean swap?** D4 settles at-target as "add". But two people dragging past each other is a common intent, and the grid already has a column-level swap. State whether seat-level swap-by-drag is in scope or explicitly out.

**O2 — Touch behaviour on the iOS wrap.** Long-press-to-lift is the usual answer, but it competes with the grid's horizontal scroll (fact 6, 7). Decide whether drag is desktop-only at first, with the keyboard/button path serving touch.

**O3 — Auto-scroll while dragging.** Dragging to an off-screen column needs edge auto-scroll. Confirm whether that is in scope or whether the first version only supports visible columns.

---

## Tasks

### Task 1 — Pin what must not move
Tests only, against current code. Pin: `withUpdatedCell`'s single-call contract; that a manual pick refuses a same-category double; that an at-target cell **adds** rather than replaces (the two-drummer invariant, already pinned at `PlannerGrid.test.tsx:315` and `:292` — extend rather than duplicate); and that stored mode marks a role touched on any cell change. Prove each fails when inverted.

### Task 2 — The move primitive
A pure function taking `(cells, source: {rowId, columnId, memberId}, target: {rowId, columnId})` and returning one new `cells` array with the member removed from source and added to target. **No React, no drag.** This is where D1 lives, and it is the only place a duplicate could be introduced — pin that the member appears exactly once across the whole returned array.

### Task 3 — Rule evaluation for a proposed move
Given a proposed move, return whether it is clean, or blocked by a rule and by which one. Reuse `ruleEnforcement.evaluate` against the target cell's post-move state. Must NOT consult `blockedReason` — D2 says double-duty is resolved by the move itself.

### Task 4 — The drag interaction
Pointer-based drag on desktop, with drop targets at cell granularity. Answer O2 and O3 before building. The prompt from D3 appears only for a rule conflict.

### Task 5 — Keyboard parity (D6)
The accessible path: on a candidate blocked by `blockedReason`, an action that performs the same move through the Task 2 primitive. Not a second mechanism — the same primitive, a different trigger.

### Task 6 — Stored-mode wiring (fact 5)
A cross-service drag marks both roles touched. Verify a save afterwards emits PATCHes for both, and that an unchanged service still emits none — a false positive notifies the team about a service nobody edited.

---

## Global constraints

- Done gate per task: `npx tsc --noEmit`, `npm test`, `npx eslint .` at **0 errors** (90 warnings are a deliberate backlog).
- Spanish UI copy. 44px touch targets. Dates `YYYY-MM-DD` at local noon.
- Sanity array-of-object writes need a `_key` per item.
- **Never** add AI/Claude attribution or a `Co-Authored-By` trailer.
- Prove tests discriminate by mutation. ~30 tests in this project have shipped unable to fail.
- Any new `position: fixed` surface (a drag ghost, the prompt) needs a portal and a real-Safari check — a fixed element under an ancestor combining `isolation: isolate` with `overflow: hidden` is clipped in WebKit and not in Chromium.
