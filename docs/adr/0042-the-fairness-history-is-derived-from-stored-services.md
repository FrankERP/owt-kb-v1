# ADR-0042: The solver's fairness history is derived from stored role documents, not `localStorage`

**Date:** 2026-09-25 · **Status:** Accepted

> **The number is final.** ADR numbers follow the order in which records reach `main`. PR #102
> ("solver-pinned-assignments") merged first and took 0041, so this record was renumbered to
> 0042 during release prep. Delivery 1 (`claude/mcp-p2-solver-history`) reached `main`
> 2026-09-26 (PR #104, `24209e11`), carrying this file as 0042 — dormant behind
> `SOLVER_HISTORY_SOURCE = "local"`; production behaviour is unchanged until Frank cuts over.

## Context

`owt_solver_history_v2` is a browser-local key holding the last six months' seat counts,
written only from `MonthGenerator`'s create-mode confirm and read into every solve. ADR-0010
already named this a gap ("shared rules, not shared fairness history") and left it out of
scope. It has six concrete defects: **(a)** confirming the rest of a month in a later session
replaces the whole month's entry, discarding what an earlier session wrote; **(b)** later
swaps and stored-mode edits are never reflected — the recorded counts drift from what is
actually seated; **(c)** `historyForRequest` excludes only the month being solved, so a
future month's entry can leak into the solver's input; **(d)** eviction keeps the six most
recently *written* entries, not the six calendar-latest months; **(e)** entries written
before 2026-07-30 recorded the raw solver response, zero rows included; **(f)** a «Historial»
chip deletes any entry with one click, no confirmation.

## Decision

**The history is derived on the server from canonical `sunday_role`/`saturday_role`
documents**, never read from or written to `localStorage` as a source of truth
(`app/utils/solverHistory.ts`, `solverHistoryRead.ts`). Specifically:

- **Stored state counts.** Each seat counts the member stored in it *at derivation time* —
  after every swap and stored-mode edit — not who a create-mode dialog first proposed. This
  fixes (a), (b) and (e).
- **Prior-month drafts count; the target month and every later month never do.** A month
  planned but not yet published is still assigned duty the next month must weigh; the month
  being solved, and anything after it, must never leak in. This fixes (c).
- **The window is exactly the three calendar months before the target**, oldest first, with
  an empty entry when a month has no weekend services — never "the six most recently
  written." This fixes (d). **(f)** is closed separately, at cutover, by the chips becoming
  read-only (see Consequences) — a derived month has nothing left to delete.
- **Members are keyed by their current `member_name`**, matching how the solver itself
  matches history to its pools. A rename now carries its history forward instead of losing
  it; a dangling seat reference, a duplicate name, or two weekend documents targeting one date
  are dropped from the count and **reported** as diagnostics, never silently absorbed.
- **This ratifies ADR-0010 Decision 3**: a `special_role` is still never counted. Nothing
  about where the history comes from changes that specials stay out of the solver's history.
- **The history is shared, not per-browser.** One derivation, one server-callable builder
  (`loadSolverHistory`), one admin route (`GET /api/admin/solver-history`) — every admin, and
  later the MCP connector's `solve_month`, solves against the same numbers. Two admins in two
  browsers can no longer disagree about the past.
- **The cutover is staged and reversible.** Delivery 1 ships every piece of this
  *dormant*, gated by a code constant, `SOLVER_HISTORY_SOURCE: "local" | "derived"`
  (`app/components/admin/solverHistorySource.ts`), shipped as `"local"`: production behaviour
  is unchanged until Frank flips it — under `"local"` the planner writes `localStorage`
  exactly as it always has. **Once the switch is `"derived"`** (Delivery 2), the planner
  solves against the derived history, but every confirm **also** writes `localStorage`,
  built fresh from `localStorage`'s own prior contents rather than from the in-memory
  (now derived) state — the dual-write that keeps the rollback target current. It stops
  only once one real month has been solved and created on derived history with no rollback
  (Delivery 3, the dual-write stop point).

**The H3 narrowing is stated here, as R16 requires.** The roadmap's H3 asked for
*every* difference between the old and new history to be individually explained. A
document's creation fingerprint can prove its stored seats are unchanged since creation; it
cannot prove what changed inside an edited document, and a deleted or moved document leaves
nothing left to test. The diff tool (`scripts/solver-history-diff.ts`) therefore classifies
every difference into one of **three** verdicts — `explained`, `unverified`, or `bug` — rather
than two, and Frank accepts or rejects the `unverified` total **as a total, by class**, not
difference by difference, before deciding on cutover (Gate C).

## Rejected

- **Keeping `localStorage`.** ADR-0010 already named the per-browser gap; a per-browser store
  cannot make a shared fairness signal true — two admins or devices solve against different
  histories, and clearing site data deletes a month's history with no trace.
- **A stored history document ("storing a history anywhere").** Would need its own schema and
  migration, and a second value that can drift from the role documents already holding the
  truth. Nothing is gained by writing down a number they can always recompute.
- **Counting what was created rather than what is stored.** Today's behaviour, and defect (b):
  a swap or stored-mode edit after the create-mode confirm leaves the history describing a
  schedule nobody actually ran.
- **Excluding drafts.** A planned-but-unpublished month is still real assigned duty; excluding
  it would have the next month's fairness treat it as never having happened.
- **H3 as "every difference individually proven."** A fingerprint proves only whole-document
  equivalence. Demanding individual proof for a changed or deleted document asks for evidence
  that cannot exist; `unverified` is the honest alternative to faking a proof or blocking on
  the unprovable.

## Consequences

- **R17's known limitation.** The history only ever feeds the solver's fairness *objective* —
  never the hard fill constraints — and ADR-0038 records that this objective's priority ladder
  overflows CP-SAT's integer ceiling once history offsets are added, so most real months
  already run unoptimised (`objective_skipped: true`) on `main`, before this change. In the
  steady state this delivery therefore changes the history's **source**, not, by itself, the
  schedules the solver produces. Fixing the ceiling is separate follow-on work, tracked as
  **issue #94** ("Solver: the fairness objective is skipped in most real months, so history
  has no effect"), out of scope here by Frank's decision of 2026-09-23.
- **The manual month exclusion is lost with the read-only chips.** Today's «×» lets an admin
  drop one history entry by hand before solving. A derived month cannot be meaningfully
  deleted — it would simply reappear on the next fetch — so after cutover the chips become
  read-only and that override is gone. This is part of what Frank decides at the cutover gate
  (R14), not an oversight.
- **Rollback before and after P4.** Before the dual-write stops (Delivery 3), rollback is a
  one-line flip of the switch back to `"local"`: `localStorage` has been kept current the
  whole time, so nothing is lost. After Delivery 3 removes the dual-write and
  `historyEntryFromDrafts`, rolling back needs new implementation work, not a flag flip. Once
  the MCP connector's `solve_month` (P4) ships against the derived builder, rolling back also
  withdraws that tool, since it has no local-history fallback of its own.
