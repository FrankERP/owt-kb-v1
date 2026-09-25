# ADR-0040: MCP reads mirror the readiness loader and the publish check instead of widening them

**Date:** 2026-09-25 · **Status:** Accepted

> **The number is provisional.** ADR numbers follow the order in which records reach `main`.
> 0040 was the next free number on every branch and worktree on 2026-09-25, but this record ships
> with P1 (`claude/mcp-p1-reads`, not yet merged). If another ADR reaches `main` first, renumber
> this one and the two file headers that link it.

## Context

P1 of the MCP connector adds seven read-only tools. `get_service` and `list_services` must report
exactly what `POST /api/admin/roles/publish-ready` would decide (spec I4), and every `_rev` they
return must come from the same rows as the content beside it (spec I7). Both pieces of logic that
answer those questions belong to a production writer:

- **`loadServiceReadinessSources()`** (`app/utils/publishReadyBundle.ts`) runs the seven canonical
  builders plus the follow-up member read, then returns only the readiness summary. It throws away
  the raw rows and the member map. The publish-ready route imports it.
- **The per-service refusal verdict** is written inline in the route itself
  (`app/api/admin/roles/publish-ready/route.ts:173-216`). Nothing exports it.

P1 is standard tier only because it changes no existing export of a module a production writer
imports. The plan calls this the additive-only rule
(`docs/superpowers/plans/2026-09-24-owt-mcp-p1-reads.md`, «Status and contract»). Widening the
loader, or pulling the verdict out of the route, would each change a writer. That is critical-tier
work, and it does not belong in a phase that only reads.

## Decision

Keep two MCP-owned copies, and pin each one to its original.

- **D1: the snapshot.** `app/mcp/reads/serviceSnapshot.ts`'s `loadServiceSnapshot()` copies the
  loader's orchestration line for line: the same builders, the same client per read and the same
  per-domain failure isolation. It also keeps the rows the original discards.
- **D2: the publish check.** `app/mcp/reads/publishRefusal.ts`'s `publishRefusalFor()` copies the
  route's per-service verdict. It leaves out `stale_revision` and `blocker_set_changed`, which only
  exist relative to what a POST asserts.

**Three pins** hold the copies to the originals:

1. `app/mcp/reads/__tests__/serviceSnapshotMirror.test.ts` is a **text pin**. Comments are
   stripped and whitespace is collapsed. The span from `await Promise.all([` to the end of the
   readiness object must then read the same in both loaders. Any edit to either side fails it,
   including one the fixtures happen not to exercise.
2. `serviceSnapshotParity.test.ts` checks **snapshot parity**. It runs both loaders over identical
   fixture responses: a clean catalogue, an empty one, and each domain failed in turn. It demands
   deep-equal `ServiceReadinessSources` and the same `assembleService` readiness for every role.
3. `publishRefusalParity.test.ts` checks **route parity**. It runs the real route handler, one
   ready-mode POST per fixture service, and demands the route's refusal reasons in the route's
   order. This parity is behavioural and limited to the fixtures: a refusal the route gains that no
   fixture triggers passes it. **A new route refusal must be added to `publishRefusal.ts` and to the
   fixture matrix together.**

**The one place the copy deliberately sees more.** The snapshot also keeps `setlistDrafts`: each raw
setlist draft's `_type` + `week`. This field sits outside the mirrored span and outside parity. The
setlist writer finds an overlay by target (`_type` + `week`, `rawSetlistDraftsForWeekQuery`).
Readiness (`buildSetlistTargets`) matches a draft by base id instead. So when a week's canonical
setlist has a legacy id, a draft over that week is invisible to readiness and to publish, but the
editor still refuses it. `get_service` reports that week as `draft_overlay` with a Spanish note,
and readiness is left as it is. Aligning the two means changing `buildSetlistTargets`, which is
also writer-imported. That work is tracked in
[issue #97](https://github.com/FrankERP/owt-kb-v1/issues/97).

## Rejected

- **Widening `loadServiceReadinessSources()` to return the rows.** This is the obvious move, and it
  changes an export the publish-ready route imports. It would make P1 critical tier just to read
  data.
- **Exporting the route's verdict, or moving it into a module the route calls.** Either way the
  production writer route gets edited. That consolidation is P3's job, done at critical tier
  (plan D2).
- **A new join builder in `serviceReadQueries.ts`**, as the roadmap suggested. Content would then
  come from a different query than readiness. I4 and I7 would stop holding by construction, and
  would need proof instead (plan D1).

## Consequences

- **Exits.** D2 ends at **P3**, which merges the copy with the publish-ready route at critical tier
  (plan D2 and its Handoff). **P3 does not retire D1**: the plan hands the snapshot to **P4** as a
  reusable read of the whole service catalogue. D1 goes away only through a **critical-tier
  widening** of the original loader.
- **Never consolidate either copy in a routine cleanup.** `/loop /improve` hunts for duplication,
  and these two copies are duplicates on purpose. "Deduplicating" either one is exactly the
  writer-export change or writer-route edit this record defers to a critical-tier review. If
  someone tries, the three pins fail, and the mirror pin's message says where the change belongs.
- **Cost.** About 60 lines of orchestration and the verdict exist twice. Any change to the
  original loader or to the route's verdict must be mirrored in the same commit.
