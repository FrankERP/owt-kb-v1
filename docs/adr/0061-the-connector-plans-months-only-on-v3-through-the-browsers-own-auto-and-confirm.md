# ADR-0061: The connector plans months only on v3, through the browser's own Auto and confirm

**Date:** 2026-10-20 · **Status:** Accepted

> **Numbering.** Written as the next free number on `preview` at the time (0059 and 0060 were
> taken there by the day rail and the admin assistant). ADR numbers follow the order records reach
> `main`; renumber if another record lands first.

## Context

MCP P4 gives the claude.ai connector two tools: `solve_month` (plan one or two months) and
`apply_schedule` (create the plan as draft services). The 2026-09-28 P4 plan was written for
solver v2. Production moved to v3 on 2026-10-15 (ADR-0056), and v3's Auto is a different
contract: a fresh fairness ledger read, stored services sent fixed, counted specials pre-filled, and
a confirm that writes every month's eligibility record (`fairnessMonth`, ADR-0050) in one PUT
before any draft (ADR-0053). Re-implementing that on the server would be a second contract to keep
in step with the browser's, and the old plan's v2 parity work (history derivation, positional
weeks, a lease between revise and apply) would buy nothing under v3.

Two measurements framed the platform choice: v3 solved the real Nov + Dec request in ~2 s, and the
solve route answered in 6.8 s in production; a draft create takes 1.2–2.4 s. `/api/mcp` runs with
`maxDuration = 60` on Hobby.

Plan: `docs/superpowers/plans/2026-10-20-owt-mcp-p4-v3-solve-apply.md` (critical tier, approved
2026-10-20).

## Decision

- **v3 only (D2).** Both tools refuse `engine_not_v3` before any read unless
  `resolveSolverEngine(process.env) === "v3"`. On Production the override is ignored, so a
  flip-back to v2 disables them by itself (and the fairness PUT would refuse anyway).
- **The same functions, not a second implementation (D3, D4).** `solve_month` runs
  `planV3Month` (`app/utils/v3MonthPlan.ts`), which composes exactly the functions `/admin` →
  «Generar mes» calls: `preReadRefusals`, `runV3Auto`, `buildV3SolveRequest`, the moved
  `settleV3AutoResult`/`runLocalFills`, `freezeConfirmEntries`, `cellsToDrafts`,
  `monthTargetPreflight` over `integrityQueueFor`. `apply_schedule` runs `runV3ConfirmAttempt`
  itself, with server transports: the records through `commitFairnessMonths` (actor `route`,
  `recordedBy` the grant's member id) and each draft through `createRole`
  (`app/utils/roleCreateCommit.ts`, the roles POST's own domain body). Always `published: false`:
  nobody is notified. A parity test (`monthToolParity.test.tsx`) runs both surfaces over one groq-js
  dataset and demands byte-identical solve bodies and identical PUT and create bodies.
- **No Fluid compute; a time budget instead (D1, D5).** A solve has a 52 s soft deadline: its
  timeout is `min(45 s, 52 s − elapsed − 4 s)`, and under 10 s left the solver is not called
  (`time_budget`). An apply is bounded by its cut-offs: no create starts after 40 s (the rest is
  «pendiente» and the next call continues) and no sweep after 45 s; its reads and its one PUT run
  uncut, and a call killed there is safe to repeat.
- **A proposal is a private, expiring record with no lease (D6).** `mcpProposal.<handle>` (a
  26-character unguessable handle, 7-day expiry) holds the frozen entries and drafts as one JSON
  payload under a SHA-256 digest, bound to the caller's origin and member id, plus a mutable
  `state` = `{ recordsDone, created }`. Every `state` write merges by union under `ifRevisionId`.
  Nothing on a failed solve is stored (D8).
- **A lost target refuses the whole apply (D7).** Before any write, apply re-reads everything:
  a pending draft that is no longer creatable, a special stored on a pending special's date, or any
  change to the horizon's stored services refuses the call («vuelve a correr solve_month»), as the
  browser's fresh-preflight abort does. Changed rules refuse too (D11).
- **Its own creates are recognised by their receipt.** A draft whose role carries
  `creationReceiptId === receiptIdForRequestId(draft.creationRequestId)` is created, whatever
  `state` says. That id is stamped only by that draft's own create transaction, so a lost answer, a
  killed call or a failed `state` save never causes a second create.

## Rejected

- **Fluid compute.** It existed in the old plan because v2 took 7–15 s warm and the apply loop
  needed ~130 s. Under v3 a solve fits easily and an apply that runs out of time finishes in the
  next call. Fluid would change every function's concurrency (shared module state across
  invocations) and needed a dashboard re-cap of 44 routes to avoid a 30× duration window that
  Hobby cannot monitor. Real risk for no measured need.
- **A v2 path.** v2 is the rollback engine (ADR-0056). Supporting it would double the parity
  surface, which is how the 2026-09-28 plan became obsolete.
- **A lease (the old plan's W1–W7).** It serialized `revise_proposal` against apply. Without
  revise, the only shared mutable data is a set of facts that only grow; a union of two applies'
  facts is always true, and every domain write is replay-safe on its own (creation receipts, the
  PUT's `unchanged`). Two concurrent applies of one proposal create nothing twice
  (`applySchedule.test.ts`, «concurrency»).
- **Skip the lost target and create the rest** (the original spec). Under v3 the plan is a whole:
  a date taken by someone else changes the fixed services the solver balanced around, and the
  frozen eligibility records belong to that plan. Re-solving costs seconds and the new solve takes
  the new service as fixed. Frank chose to refuse and re-solve (2026-10-20, Q2).
- **Recognising own creates by a mark the proposal wrote.** A mark written before a post (or before
  a PUT that then failed) proves nothing about who holds the date; the receipt id does.

## Consequences

- `/admin`'s planner moved its inline helpers into neutral modules (`plannerCalendar.ts`,
  `plannerMonth.ts`, `v3Board.ts`, `monthPreflight.ts`) and the roles POST delegates to
  `roleCreateCommit` (ADR-0043's pattern). Changing one of them changes both surfaces, which is the
  point; the parity test fails if their inputs drift.
- `fairnessMonthCommit` has a second caller (ADR-0050's executor is still the one writer).
- **Two gaps shared with the browser, accepted:** seat edits inside a stored service between solve
  and apply go undetected (only the set of stored services is checked), and two *different*
  proposals for one horizon applied at once can interleave when their frozen entries are identical
  (the second PUT answers `unchanged`).
- A `solve_month` failure leaves nothing to finish by hand: the browser fills uncounted specials on
  a failed run, the connector stores nothing (D8, a declared difference Frank confirmed).
- **Undoing it** means removing the two tools and their registrations, the `mcpProposal` type and
  store, and the caller pins; `roleCreateCommit` and the neutral moves can stay, since `/admin` now
  uses them.
