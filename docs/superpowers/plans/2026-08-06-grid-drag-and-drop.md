# Implementation Plan: move a person between seats by dragging on the month grid

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task.

**Status:** `READY_FOR_ADVERSARIAL_REVIEW`. No unresolved blocking unknowns.
**Risk tier:** **CRITICAL** — two sequential fresh approvals on byte-identical text. Rationale below; a reviewer may argue it down with evidence.
**Authorization:** this document does not authorize implementation.

## Original request

> "I want to add a button or a mechanism that allows me to grab somebody that is already assigned in another position in the same role, and put them on the position I'm editing (or that I have selected/clicked) on the grid."

> "Do you think a button for this would be best or could we implement something drag and drop? So I can change to anywhere on the grid, and if a constraint exists against the move I'm doing then just prompt an alert with option to force the change or desist because of the constraint/rule."

> "Dropping onto a cell that's already at target will add the person and mark amber."

## Planning frame

**Primary outcome.** An admin editing the month grid can move a person from one seat to another — within a service or across services — by dragging, with a force/desist prompt when a rule stands against the move, and an equivalent keyboard-reachable action.

**Intended operator.** A worship-team admin using the month grid at desktop width.

**Current behaviour and the gap.** Moving Gaby from BGV to LEAD of the same service requires: close the picker → open the BGV cell → remove her → reopen LEAD → add her. The picker shows her as `Ya asignado en Bgv` and refuses the pick outright, offering no path to relocate. Nothing in the UI moves a person.

**Invariants that must remain true.**
- **D6:** no cell refuses an occupant for reasons of count, and none ever replaces one (`PlannerGrid.tsx:20-23`). Replacement is what evicted a drummer on 18 shipped services.
- A person appears **at most once** in a service's assignments. Duplicates survive the whole write path (see Risk).
- Stored mode emits a PATCH and a notification only for services actually changed.
- `saturdarSongs` untouched; `_key` per Sanity array item; member-facing reads keep `published != false`.

**In scope.** Drag-move within and across services at desktop width; a rule-conflict prompt with force/desist; a keyboard/touch-reachable equivalent; stored-mode change tracking for both affected services.

**Out of scope (non-goals).** Seat-level swap by drag (D7); touch drag (D8); edge auto-scroll during a drag (D9); any change to the swap route, the PATCH writer, or what counts as a change on save.

**Acceptance criteria** — each is measurable and owned by a task below.
1. After a drag, the moved member appears **exactly once** across the entire `cells` array. *(T2)*
2. A drag from BGV to LEAD of the same service leaves BGV with one fewer occupant and LEAD with one more, in a single state update. *(T2)*
3. Dropping onto a cell already at target **adds** and renders the existing amber over-target treatment; no occupant is displaced. *(T1, T4)*
4. A move whose target has no rule conflict completes with **no prompt**. *(T3, T4)*
5. A move blocked by a rule raises the prompt; desist leaves `cells` byte-identical; force completes the move and records the waived rule exactly as the shipped override does. *(T3, T4)*
6. A same-category double is **never** offered a force path. *(T3)*
7. A cross-service drag marks **both** roles touched; a save then PATCHes both, and services untouched by the drag emit no PATCH and no notification. *(T6)*
8. Every drag outcome is reachable without a pointer. *(T5)*

**Dependencies and affected boundaries.** `PlannerGrid` (cell rendering and the pick path), `plannerModel` (cell shape), `ruleEnforcement` (conflict evaluation), `MonthGenerator` (stored-mode change tracking). No server route changes.

---

## Risk classification — CRITICAL, and why

Normally this would be **standard**: UI on top of an already-approved writer. It is raised deliberately on one hazard.

**A move implemented as add-without-remove writes the same person into a service twice.** `canonicalRefs` preserves genuine duplicates, `normalizeRefs` does not dedupe, and `seatFields` mints one `_key` per entry — so a duplicate `_ref` reaches Sanity, is double-counted by `computeParticipation`, and is notified per seat. The client payload is therefore a data-safety contract feeding a destructive full-array PATCH, not a rendering concern.

The mitigation is D1 plus acceptance criterion 1. **If a reviewer establishes that the single-update primitive makes the hazard structurally impossible, the tier can be argued down to standard** — it is not assumed either way.

---

## Evidence

| Fact | Source | Implication |
|---|---|---|
| A cell is mutated only through `withUpdatedCell(cells, rowId, columnId, memberIds, addOverride?)`. | `PlannerGrid.tsx:292-298` | A drag touches two cells, so it is two mutations that must resolve against **one** `cells` value, not two sequential calls against stale state. |
| `toggleCandidate` is the existing pick path; removal is `current.filter(id => id !== memberId)`. | `PlannerGrid.tsx:607-613` | Drag-move reuses this shape rather than inventing a mutation. |
| D6 is stated in the file header and already pinned by tests. | `PlannerGrid.tsx:20-23`; `PlannerGrid.test.tsx:292`, `:315` | Drop-onto-at-target already behaves as the user asked. Extend those pins; do not duplicate them. |
| `blockedReason` = `Ya asignado en {seat}` — the same-category double-duty block. | `candidateRanking.ts:195` | Resolved by a move, never forced. |
| `ruleBlockedReason` = `Regla: no puede coincidir con {name}` — the conflict rule. | `ruleEnforcement.ts:408` | The only forceable constraint. |
| Stored mode diffs `touchedStoredRoleIds` against `baselineByRole`. | `MonthGenerator.tsx:1561`, `:1575` | A cross-service drag must mark **both** roles or half the move never saves. |
| The grid scrolls horizontally; columns can be off-screen. | `PlannerGrid.tsx` grid container | Bounds D9. |
| The app ships as a Capacitor iOS wrap (WebKit). | `capacitor.config.ts` | Touch drag competes with that scroll; bounds D8. |

---

## Decisions

| # | Decision | Rationale |
|---|---|---|
| **D1** | A drag is a **MOVE**: remove from source and add to target in **one** `cells` update. Never add-then-remove; never two updates against stale state. | The entire critical hazard. An add-only path writes a duplicate `_ref` that reaches Sanity. |
| **D2** | The same-category double-duty block **dissolves by construction and is never forced**. | A move cannot double someone — they leave the source seat. D6 calls a double a data error, not a judgement call. |
| **D3** | **Only a rule conflict raises the prompt** (force / desist). A forced drop records the waived rule exactly as the shipped "Asignar de todos modos" override does — same marker, same rule-scoping, cleared on removal. | Keeps the prompt meaningful rather than something learned to click through, and reuses a mechanism already reviewed. |
| **D4** | Dropping onto an **at-target** cell **adds** and marks amber. | The user's decision, and already D6's behaviour. The drag must not introduce a replace path. |
| **D5** | Drag works **anywhere on the grid** — within a service and across services. A cross-service move marks both roles touched. | The user's ask. |
| **D6** | **Keyboard parity is required.** The accessible equivalent is a "traer aquí" action on a candidate blocked by `blockedReason`, driving the same primitive. | Drag is not keyboard-operable, and this surface has had deliberate keyboard work. Also serves touch under D8. |
| **D7** | **No seat-level swap by drag.** Swapping two people is two drags. | The grid already has a column-level swap backed by an atomic revision-guarded route. A second swap with different semantics is a new concurrency surface for a case two drags cover. |
| **D8** | **Desktop drag only.** Touch is served by D6's action. | Touch drag needs long-press-to-lift, which fights the grid's horizontal scroll — building a second interaction to dodge a conflict the button already avoids. |
| **D9** | **Visible columns only.** Scroll first, then drag. | Edge auto-scroll during a drag is fiddly and additive later; excluding it changes nothing else in this plan. |

## Assumptions

| Assumption | Impact if false | Validation |
|---|---|---|
| `withUpdatedCell` is the only path that mutates a cell. | A second path could add without removing, reintroducing the duplicate. | T1 pins it; grep for other writers to `cells`. |
| Rule evaluation against a *proposed* post-move state needs no new inputs beyond what `evaluate` already takes. | T3 grows into a rule-engine change rather than a caller. | T3 establishes this before building. |
| The existing over-target amber path needs no change for a dropped occupant. | T4 gains display work not budgeted here. | T1 pins current behaviour; T4 verifies against it. |
| Marking both roles touched is sufficient for a cross-service save. | Half a move silently fails to persist. | T6 verifies through a real save, not a unit assertion. |

## Open questions — all resolved

O1 (swap by drag), O2 (touch), O3 (auto-scroll) were blocking and were resolved with the user on 2026-08-06 as D7, D8 and D9.

---

## Scope test — why this is one plan, not several

The six tasks are sequential layers of a single outcome, not separable deliverables. T2's primitive has no user-visible value alone; T4's drag is unsafe without T2's single-update guarantee; T5 is the same primitive under a different trigger. Splitting would produce intermediate states that are either unusable (a primitive nothing calls) or unsafe (a drag without the duplicate guard). The coupling is retained deliberately, per the scope test.

## Tasks

Each task ends in a safe state: the feature is inert until T4 wires the interaction, so T1–T3 can land without changing behaviour.

### T1 — Pin what must not move
Tests only, against current code. Pin `withUpdatedCell`'s single-call contract; that a manual pick refuses a same-category double; that an at-target cell **adds** rather than replaces (extend `PlannerGrid.test.tsx:292`/`:315` rather than duplicating); that stored mode marks a role touched on any cell change. Prove each fails when inverted.
*Safe end state:* no production change. *Rollback:* revert the commit.

### T2 — The move primitive (acceptance 1, 2)
A pure function `(cells, source: {rowId, columnId, memberId}, target: {rowId, columnId}) → cells`, removing from source and adding to target in one returned array. No React, no drag. **The only place a duplicate could be introduced** — pin that the member appears exactly once across the whole result.
*Safe end state:* exported, uncalled. *Rollback:* delete the module.

### T3 — Rule evaluation for a proposed move (acceptance 4, 5, 6)
Given a proposed move, return clean, or blocked-by-rule with which rule. Reuse `ruleEnforcement.evaluate` against the target's post-move state. **Must not consult `blockedReason`** — D2.
*Safe end state:* pure, uncalled. *Rollback:* delete the module.

### T4 — The drag interaction (acceptance 3, 5)
Pointer drag at desktop width, drop targets at cell granularity, prompt only on a rule conflict. Any new `position: fixed` surface — drag ghost, prompt — needs a portal and a real-Safari check: a fixed element under an ancestor combining `isolation: isolate` with `overflow: hidden` is clipped in WebKit and not in Chromium.
*Safe end state:* first point at which behaviour changes. *Rollback:* revert; T2/T3 remain inert.

### T5 — Keyboard and touch parity (acceptance 8)
The "traer aquí" action on a `blockedReason`-blocked candidate, driving T2's primitive. Not a second mechanism.
*Safe end state:* additive. *Rollback:* revert.

### T6 — Stored-mode wiring (acceptance 7)
A cross-service drag marks both roles touched. Verify through a real save that both PATCH and that untouched services emit neither PATCH nor notification — a false positive notifies the team about a service nobody edited.
*Safe end state:* completes the feature. *Rollback:* revert; drag then persists only same-service moves, which is incorrect — so T6 must land with T4.

## Global constraints

- Done gate per task: `npx tsc --noEmit`, `npm test`, `npx eslint .` at **0 errors** (90 warnings are a deliberate backlog).
- Spanish UI copy. 44px touch targets. Dates `YYYY-MM-DD` at local noon.
- **Never** add AI/Claude attribution or a `Co-Authored-By` trailer.
- Prove tests discriminate by mutation. ~30 tests in this project have shipped unable to fail.
