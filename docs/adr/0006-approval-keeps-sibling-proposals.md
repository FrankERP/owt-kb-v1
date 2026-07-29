# ADR-0006: Approving a proposal keeps the other proposals

**Date:** 2026-07-24 (reverses a 2026-07-01 decision) · **Status:** Accepted

## Context

When several co-leads build proposals for the same service and one is approved,
what happens to the others? On 2026-07-01 approval deleted them, on the
reasoning that they "lingered as stale duplicates."

## Decision

Approval deletes nothing. `app/api/admin/proposals/[id]/route.ts` contains no
delete path, and that absence is deliberate.

## Rejected

**Deleting the siblings on approval** — the previous behaviour, removed in
`2102582`:

> The hidden deletion of sibling proposals for the same service is removed —
> losing a co-lead's draft was never part of approving one.

Silently destroying a teammate's work as a side effect of an unrelated action is
the wrong trade, whatever it does for tidiness.

## Consequences

Superseded proposals accumulate and have to be cleaned up deliberately, or left
alone. Two scripts still implement the **rejected** behaviour and would look
like they were restoring intended function:

- `scripts/cleanup-superseded-proposals.mjs`
- `scripts/migrate-shared-proposals.mjs` (a completed one-shot migration)

Don't run either against production expecting it to be a no-op.

Separately: `scripts/lib/proposalRank.mjs` (`advancementRank`, `approved`
highest) is kept **deliberately separate** from the `/me` display order
(`orderProposals`, `approved` lowest). The inverse ordering is the point —
merging them for DRY would have deleted the live-setlist proposal during the
migration, which was caught in review.
