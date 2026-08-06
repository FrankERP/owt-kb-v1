# Implementation Plan: move a person between seats by dragging on the month grid

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task.

**Status:** `READY_FOR_ADVERSARIAL_REVIEW`. No unresolved blocking unknowns.
**Risk tier:** **CRITICAL** — two sequential fresh approvals on byte-identical text.
**Authorization:** this document does not authorize implementation.

## Original request

> "I want to add a button or a mechanism that allows me to grab somebody that is already assigned in another position in the same role, and put them on the position I'm editing (or that I have selected/clicked) on the grid."

> "Do you think a button for this would be best or could we implement something drag and drop? So I can change to anywhere on the grid, and if a constraint exists against the move I'm doing then just prompt an alert with option to force the change or desist because of the constraint/rule."

> "Dropping onto a cell that's already at target will add the person and mark amber."

## Planning frame

**Primary outcome.** An admin editing the month grid can move a person from one seat to another — within a service or across services — by dragging, with a force/desist prompt when a *rule* stands against the move, and an equivalent keyboard-reachable action.

**Intended operator.** A worship-team admin using the month grid at desktop width.

**Current behaviour and the gap.** Moving Gaby from BGV to LEAD of the same service requires: close the picker → open the BGV cell → remove her → reopen LEAD → add her. The picker shows her as `Ya asignado en Bgv` and refuses the pick outright, offering no path to relocate. Nothing in the UI moves a person.

**Invariants that must remain true.**
- **D6:** no cell refuses an occupant for reasons of count, and none ever replaces one (`PlannerGrid.tsx:20-23`). Replacement is what evicted a drummer on 18 shipped services.
- A person appears **at most once within a single cell**, and **at most once per seat category within a service**. Cross-category double duty (voz + instrumento) is legitimate and shipped — Frank and Mkz do it (`candidateRanking.ts:186-187`). A person may of course appear in many columns across a month.
- Stored mode emits a PATCH and a notification only for services actually changed.
- `saturdarSongs` untouched; `_key` per Sanity array item; member-facing reads keep `published != false`.

**In scope.** Drag-move within and across services at desktop width; refusal of the three structural constraints below; a force/desist prompt for the one forceable constraint; a keyboard/touch-reachable equivalent; verification that stored-mode change tracking covers both affected services.

**Out of scope (non-goals).** Seat-level swap by drag (D7); touch drag (D8); edge auto-scroll during a drag (D9); any change to the swap route, the PATCH writer, `withUpdatedCell`'s signature, or what counts as a change on save.

**Acceptance criteria** — each is measurable and owned by a task below.
1. After any drag, the moved member appears **at most once within each cell**, and the source cell no longer contains them. A fixture in which the target cell **already holds the member** is included. *(T2)*
2. A drag from BGV to LEAD of the same service leaves BGV with one fewer occupant and LEAD with one more, in a single `onCellsChange`. *(T2)*
3. Dropping onto a cell already at target (over-capacity, not over-duplicate) **adds** and renders the existing amber over-target treatment; no occupant is displaced. *(T1, T4)*
4. A move violating none of the four constraints completes with **no prompt**. *(T3, T4)*
5. A move blocked by a **rule conflict** raises the prompt; desist leaves `cells` byte-identical; force completes the move and records the waived rule through `withUpdatedCell`'s `addOverride`, in the same single update. *(T2, T3, T4)*
6. Each of the three **non-forceable** constraints (C1 duplicate-in-cell, C2 same-category double in the target service, C3 seat `memberType`) refuses the drop and is **never** offered a force path. Each has its own fixture, including the cross-service C2 case: Gaby in BGV of week 1 dragged to Lead of week 2 while already in BGV of week 2. *(T3)*
7. A cross-service drag marks **both** roles touched; a save then PATCHes both, and services untouched by the drag emit no PATCH and no notification. *(T6)*
8. Every drag outcome is reachable without a pointer. *(T5)*
9. A drag is impossible while `mutationLocked` — the source is not draggable, rather than the drop silently reverting. *(T4)*

**Dependencies and affected boundaries.** `PlannerGrid` (cell rendering and the pick path), `plannerModel` (cell shape), `ruleEnforcement` (conflict evaluation), `candidateRanking` (the constraint definitions being reused), `MonthGenerator` (stored-mode change tracking). No server route changes.

---

## Risk classification — CRITICAL, and why

Normally this would be **standard**: UI on top of an already-approved writer. It is raised deliberately because the client payload is a data-safety contract, not a rendering concern.

**Nothing downstream dedupes.** `serializeStoredColumn` maps occupants straight through (`plannerSaveModel.ts:81-88`); `normalizeRefs` is a `filter`, not a `Set` (`roleWriteRequest.ts:95-98`); `seatFields` mints a fresh `_key` per entry, so two identical `_ref`s become two valid Sanity array items (`roleWriteRequest.ts:154-162`); `reconcileOccupants` maps positionally without deduping (`plannerModel.ts:65-75`). The only same-column duplicate detector, `categoryDuplicatesForColumn`, renders a `⚠` and **blocks nothing** (`PlannerGrid.tsx:345-377`, consumed for display only at `:1700`, `:1715`). A duplicate therefore reaches Sanity, is double-counted by `computeParticipation`, and is notified per seat.

Every constraint in this plan exists to keep a bad payload from being constructed, because nothing after the grid will catch it.

---

## Evidence

| Fact | Source | Implication |
|---|---|---|
| Nothing between the grid and Sanity dedupes; the duplicate warning is display-only. | `plannerSaveModel.ts:81-88`; `roleWriteRequest.ts:95-98`, `:154-162`; `plannerModel.ts:65-75`; `PlannerGrid.tsx:345-377`, `:1700` | The grid is the last line of defence. Drives the tier and C1/C2. |
| A cell is mutated only through `withUpdatedCell(cells, rowId, columnId, memberIds, addOverride?)`; three call sites, all funnelling into one `onCellsChange`. | `PlannerGrid.tsx:292-298`, `:613`, `:664`, `:915` | The move composes this function; it does not replace it. |
| `addOverride` is "the ONLY way an entry is created" and carries the **rule waived**, not just the person; `withUpdatedCell` writes and prunes `overrides`/`overrideReasons` together so a reason can never outlive its seating. | `PlannerGrid.tsx:286-298` | A forced move must pass `addOverride` through, and a hand-rolled mutation would leave a stale override that silences E13's re-flag. |
| D6 is stated in the file header and already pinned by tests. | `PlannerGrid.tsx:20-23`; `PlannerGrid.test.tsx:292`, `:315` | Drop-onto-at-target already behaves as the user asked. Extend those pins; do not duplicate them. |
| `blockedReason` = `Ya asignado en {seat}`, raised when a member holds **another seat of the same category** in that column. | `candidateRanking.ts:190-195` | Defines C2. It is scoped to the column, so it must be re-evaluated against the **target** column, not the source. |
| Seat `memberType` eligibility is enforced in **exactly one place** — the picker's candidate filter. Nothing in `plannerSaveModel.ts` or `roleWriteRequest.ts` checks it. | `candidateRanking.ts:185`; `seatModel.ts:29-31`, `:71`, `:76` | Defines C3. A drag that skips the picker skips the only gate. |
| `ruleBlockedReason` = `Regla: no puede coincidir con {name}`, from `evaluate`. | `candidateRanking.ts:202`; `ruleEnforcement.ts:407` | The only forceable constraint. |
| `evaluate` takes `assigned` as a caller-supplied list. | `ruleEnforcement.ts:285-311` | A proposed post-move state needs no rule-engine change — assumption confirmed. |
| Stored-mode change tracking **already** diffs every column between old and new `cells` and marks each changed one. `columnId === role._id`. | `MonthGenerator.tsx:2118-2128`; `storedRoleReadModel.ts:114` | T6 is **verification, not wiring** — provided the drag is a single `onCellsChange`. |
| `storedMutationLocked` guards `handleCellsChange` by dropping the write silently. | `MonthGenerator.tsx:2117` | Not a data hazard, but a drop would appear to succeed and revert. Drives acceptance 9. |
| HTML5 drag-and-drop already has a precedent in this codebase. | `SetlistEditor.tsx:335-339` | T4 must state whether it reuses that idiom or introduces pointer events. |
| The grid scrolls horizontally; columns can be off-screen. | `PlannerGrid.tsx` grid container | Bounds D9. |
| The app ships as a Capacitor iOS wrap (WebKit). | `capacitor.config.ts` | Touch drag competes with that scroll; bounds D8. |

---

## The four constraints

The drag must evaluate all four against the **proposed post-move state of the target column**. Three refuse; one prompts.

| # | Constraint | Detection | On violation |
|---|---|---|---|
| **C1** | The target cell already contains the dragged member. | Membership test on the target cell. | **Refuse.** Not a no-op-and-move: removing them from the source would silently delete an assignment the operator did not ask to drop. Show "Ya está en esta casilla". |
| **C2** | The member would hold **two seats of the same category** in the target service. | The `blockedReason` rule (`candidateRanking.ts:190-195`) re-evaluated against the **target** column post-move. | **Refuse**, with the picker's wording. `PlannerGrid.tsx:22-23` calls this a data error, not a judgement call. |
| **C3** | The member's `memberType` does not include the target seat's. | `candidateRanking.ts:185`'s filter, applied to the target seat. | **Refuse.** The picker would never have listed them; a drag must not be a weaker gate than the picker. |
| **C4** | A configured rule forbids the pairing. | `ruleEnforcement.evaluate` against the target column post-move. | **Prompt** — force or desist. The only forceable one. |

C2 is the constraint that a naive "a move can't double someone, they leave the source" argument misses: that reasoning holds only when source and target share a column. Across services the source is a different column, so the target service can already hold the member in the same category.

## Decisions

| # | Decision | Rationale |
|---|---|---|
| **D1** | A drag is a **MOVE**: remove from source and add to target in **one** `cells` update, composing `withUpdatedCell` twice over one array. Never add-then-remove; never two updates against stale state; never a hand-rolled mutation. | The hazard the tier is set on. It also keeps `withUpdatedCell`'s override pruning, which a bespoke mutation would lose. |
| **D2** | Three of the four constraints (C1, C2, C3) **refuse the drop and are never forceable**. Only C4 prompts. | Two are data errors the file header already classifies as such; the third is an eligibility gate the picker enforces and nothing downstream re-checks. |
| **D3** | A forced C4 drop records the waived rule via `withUpdatedCell`'s `addOverride`, in the same single update — the same marker and rule-scoping as the shipped "Asignar de todos modos", cleared on removal. | Reuses a reviewed mechanism, and keeps the prompt meaningful rather than something learned to click through. |
| **D4** | Dropping onto an **at-target** cell (over capacity, not over duplicate) **adds** and marks amber. | The user's decision, and already D6's behaviour. Distinct from C1: C1 is the same *person* twice, this is one more person than the seat wants. |
| **D5** | Drag works **anywhere on the grid** — within a service and across services. | The user's ask. Cross-service is precisely why C2 must be re-evaluated on the target. |
| **D6** | **Keyboard parity is required.** The accessible equivalent is a "traer aquí" action on a candidate blocked by `blockedReason`, driving the same primitive. | Drag is not keyboard-operable, and this surface has had deliberate keyboard work. Also serves touch under D8. |
| **D7** | **No seat-level swap by drag.** Swapping two people is two drags. | The grid already has a column-level swap backed by an atomic revision-guarded route. A second swap with different semantics is a new concurrency surface for a case two drags cover. |
| **D8** | **Desktop drag only.** Touch is served by D6's action. | Touch drag needs long-press-to-lift, which fights the grid's horizontal scroll — a second interaction built to dodge a conflict the button already avoids. |
| **D9** | **Visible columns only.** Scroll first, then drag. | Edge auto-scroll during a drag is fiddly and additive later; excluding it changes nothing else in this plan. |

## Assumptions

| Assumption | Impact if false | Validation |
|---|---|---|
| Composing `withUpdatedCell` twice over one array preserves its override-pruning contract in both cells. | A stale `overrides` entry survives on the source and silences E13's re-flag if that person is seated there again. | T2 pins the source cell's overrides after a move, including a forced one. |
| Rule evaluation against a *proposed* post-move state needs no new inputs beyond what `evaluate` already takes. | T3 becomes a rule-engine change rather than a caller. | Confirmed at `ruleEnforcement.ts:285-311`; T3 re-checks before building. |
| The create-mode path (`cellsToDrafts`) tolerates the drag exactly as the stored path does. | A duplicate or ineligible seating could reach a newly created service by a path this plan only verified for stored mode. | T2's constraint fixtures are mode-independent; **T6 additionally exercises one drag in create mode** before the feature is called done. |
| The existing over-target amber path needs no change for a dropped occupant. | T4 gains display work not budgeted here. | T1 pins current behaviour; T4 verifies against it. |
| Stored-mode change tracking already covers both columns of a cross-service drag. | Half a move silently fails to persist. | Confirmed at `MonthGenerator.tsx:2118-2128`; T6 verifies through a real save rather than a unit assertion. |

## Open questions — all resolved

O1 (swap by drag), O2 (touch), O3 (auto-scroll) were blocking and were resolved with the user on 2026-08-06 as D7, D8 and D9.

---

## Scope test — why this is one plan, not several

The six tasks are sequential layers of a single outcome, not separable deliverables. T2's primitive has no user-visible value alone; T4's drag is unsafe without T2's single-update guarantee and T3's constraint gate; T5 is the same primitive under a different trigger. Splitting would produce intermediate states that are either unusable (a primitive nothing calls) or unsafe (a drag without the constraint gate). The coupling is retained deliberately, per the scope test.

## Tasks

The feature is inert until T4 wires the interaction, so T1–T3 can land without changing behaviour.

### T1 — Pin what must not move
Tests only, against current code. Pin `withUpdatedCell`'s single-call contract and its override pruning; that a manual pick refuses a same-category double; that an at-target cell **adds** rather than replaces (extend `PlannerGrid.test.tsx:292`/`:315` rather than duplicating); that stored mode marks a role touched on any cell change. Prove each fails when inverted.
*Safe end state:* no production change. *Rollback:* revert the commit.

### T2 — The move primitive (acceptance 1, 2, 5)
`(cells, source: {rowId, columnId, memberId}, target: {rowId, columnId}, addOverride?) → cells`. It **composes `withUpdatedCell` twice over one array** — source minus the member, target plus the member, `addOverride` forwarded to the target call — and returns one array for one `onCellsChange`. The `addOverride` parameter is not optional to the design: without it a forced C4 move would need a second update, which is the exact anti-pattern D1 forbids.

Fixtures must include: target already holds the member (C1 — refused upstream, but the primitive must not produce `[X, X]` if called); a forced move, asserting the target's `overrideReasons` carries the waived rule and the source's overrides are pruned.
*Safe end state:* exported, uncalled. *Rollback:* delete the module.

### T3 — The constraint gate (acceptance 4, 5, 6)
Given a proposed move, return one of: clean; refused-with-reason (C1, C2, C3); or prompt-with-rule (C4). **C2 must be evaluated against the target column's post-move state**, reusing `candidateRanking`'s same-category logic rather than re-implementing it — evaluating the source instead is the failure this constraint exists to catch. C3 reuses the picker's `memberType` filter. Fixtures per acceptance 6, including the cross-service C2 case.
*Safe end state:* pure, uncalled. *Rollback:* delete the module.

### T4 — The drag interaction (acceptance 3, 5, 9)
Pointer drag at desktop width, drop targets at cell granularity, refusals surfaced inline, prompt only on C4. State explicitly whether this reuses `SetlistEditor.tsx:335-339`'s HTML5 drag idiom or introduces pointer events, and why. Sources are non-draggable while `mutationLocked`. Any new `position: fixed` surface — drag ghost, prompt — needs a portal and a real-Safari check: a fixed element under an ancestor combining `isolation: isolate` with `overflow: hidden` is clipped in WebKit and not in Chromium.
*Safe end state:* first point at which behaviour changes. *Rollback:* revert; T2/T3 remain inert.

### T5 — Keyboard and touch parity (acceptance 8)
The "traer aquí" action on a `blockedReason`-blocked candidate, driving T2's primitive through T3's gate. Not a second mechanism, and not a path around the constraints.
*Safe end state:* additive. *Rollback:* revert.

### T6 — End-to-end verification (acceptance 7)
Change tracking is already all-columns (`MonthGenerator.tsx:2118-2128`), so this is verification, not wiring: confirm through a real save that a cross-service drag PATCHes both services and that untouched services emit neither PATCH nor notification — a false positive notifies the team about a service nobody edited. Also exercise one drag in **create mode** to close the `cellsToDrafts` assumption.
*Safe end state:* completes the feature. *Rollback:* revert T4 — T2/T3 are then inert.

## Global constraints

- Done gate per task: `npx tsc --noEmit`, `npm test`, `npx eslint .` at **0 errors** (90 warnings are a deliberate backlog).
- Spanish UI copy. 44px touch targets. Dates `YYYY-MM-DD` at local noon.
- **Never** add AI/Claude attribution or a `Co-Authored-By` trailer.
- Prove tests discriminate by mutation. ~30 tests in this project have shipped unable to fail.
