# ADR-0076: Setlist proposals are decided from the chat through one planner in two modes

**Date:** 2026-10-28 · **Status:** Accepted

> **Numbering.** 0076 because records are numbered in the order they reach `main`; the solver-ops
> record that holds 0076 on `preview` becomes 0077 there when this one merges (as ADR-0073).

## Context

Phase 3 of Frank's «Quiero poder hacer todo lo que hago en la página como admin, pero desde el chat»
(2026-10-21; plan approved under the critical tier, 2026-10-27,
`docs/superpowers/plans/2026-10-27-owt-mcp-admin-parity-f3a-proposal-review.md`). `/admin`'s
Propuestas decides a lead's setlist proposal through `PATCH /api/admin/proposals/[id]`: «Aprobar»
writes the proposal's songs and team note over the live setlist in one transaction and queues the
setlist email (ADR-0054: the whole worship team when nothing was live); «Solicitar cambios» and
«Reabrir» move the proposal and notify its lead. There is no «reject»: «Solicitar cambios» is it.

Two things made a naïve chat path wrong, both found in the plan review:

- The weekend target loader (`loadWeekendCoordination` → `resolveOwnedCoordination`) COMMITS a
  maintenance bootstrap (`bootstrapLegacyLock`) on a legacy role with no lock. A "read-only" check
  that reused it would write.
- The approve's email audience depends on the setlist the outbox will compare against, which is the
  FIRST `before` of the pending notice's debounce window, not the live list.

## Decision

- The route's body moved into `app/utils/proposalReviewCommit.ts` (ADR-0043's `CommitOutcome`
  shape) as `reviewProposal(id, raw, actor)`, in the same statement order; the route keeps the
  session, the content-editor refusal and the JSON parse. The existing route tests passed unchanged
  and a route-vs-commit parity test pins the bodies.
- **One planner, two modes.** `planProposalReview(id, request, "write" | "peek")` is the writer's whole
  prefix after the request parse: load, drift, receipt and retry rules, readiness, target (the check's
  arguments are parsed by its own strict schema). `reviewProposal` runs it in
  `"write"`; the chat's check runs it in `"peek"`, which reports the proposal's `_rev` instead of
  asserting it and uses `peekWeekendCoordination` / `peekOwnedCoordination`, which report
  `needsBootstrap` instead of running the bootstrap. Peek is a separate exported function, so the
  swap, unpublish and copy callers keep the result type they narrow on. Peek alone also reads the live
  setlist's `team_notes` by id and revision (the loaders' shared projections do not carry it), so the
  check can say which note an approval replaces or blanks; the write adds no read.
- Two tools: `check_setlist_proposal_review` (read-only) answers what the decision would do (songs,
  the live setlist it replaces, the team note it copies, who is told) plus `rev` and a one-line
  `line`; `review_setlist_proposal` takes both, re-renders the line from a fresh peek and refuses a
  different one before calling the writer, which asserts `rev`. The line starts with the action and
  ends with the songs or the note, so a `rev` checked for one action cannot pass for another and the
  note Frank saw is the note written.
- The acting member is the bearer's (`principalOf(ctx).sub`), never an argument; no principal refuses
  before any read (`approvedBy: null` from the chat would hide who decided).
- Who is told comes from the shared report layer (`app/mcp/writes/reports.ts`): the forecast reads
  the pending outbox notice's `before` when there is one, and the eligibility rule is one function
  (`setlistNoticeEligible`) that `setlistUpsert` itself calls.
- The chat follows the panel's client gates: a note is required for «Solicitar cambios», optional for
  «Reabrir», refused for «Aprobar»; `reconcile_target` is not exposed.

## Rejected

- **Reusing the writing loaders in the check.** They commit on a legacy weekend role.
- **A `mode` parameter widening `resolveOwnedCoordination`'s result.** Every other caller would have
  to narrow a new case it can never get.
- **`rev` alone, or a phase-2 HMAC token.** `rev` binds the content but not the action; a token binds
  nothing the line does not, since the proposal is one document and the line is a pure render of it.
  Neither stops a model that skips Frank's word: the description's rule (show it, wait for his yes,
  ADR-0072) is the guard either way.
- **Refusing past services** like the deletes (ADR-0072). `/admin` decides them; two answers to
  «¿puedo aprobar esto?» would be worse. A past approval sends no email.
- **Tools that call the route over HTTP.** The bearer is not a NextAuth session (ADR-0043, ADR-0073).

## Consequences

- A change to a proposal rule is a change to `proposalReviewCommit.ts`, seen by `/admin` and the chat
  alike; `serviceCommitCallers.test.ts` pins both callers and the protected-write audit lists the
  module.
- The chat trims the «Solicitar cambios» note; the panel sends it untrimmed, so the two surfaces'
  retry fingerprints differ by surrounding whitespace (a repeat from the other surface writes again).
- Approving is not undone from the chat: «Reabrir» does not restore the replaced setlist (Studio's
  3-day history is the only undo), and the answers say so.
