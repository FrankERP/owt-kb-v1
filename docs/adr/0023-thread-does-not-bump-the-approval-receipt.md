# ADR-0023: The message thread does not bump `APPROVAL_RECEIPT_VERSION`

**Date:** 2026-08-26 · **Status:** Accepted · **Amended 2026-08-27** — the mirror was removed, and the receipt count corrected from 13 to 6

## Context

Release 2 added `messages[]` to `setlistProposal` and mirrored it into
`lead_notes` / `admin_notes`. Child B removed that write on 2026-08-27, so both
fields are now a frozen archive (`docs/DATA_MODEL.md`); the decision below is
unaffected, because it turns on what the receipt fingerprints, not on who writes
the legacy fields. Two constants sit next to that field and look
like they should move with it:

```ts
export const APPROVAL_RECEIPT_VERSION = 1;              // proposalWriteRequest.ts
export const APPROVAL_APP_MARKER = "owt-kb-v1/a2-approval-1";
```

Their doc-comment says *"Bump when the fingerprinted shape changes, so old
digests can never collide."* A proposal's shape did change. The obvious reading
is that both must be bumped.

## Decision

**Neither is bumped.** They stay at `1` / `a2-approval-1`.

The rule is about what an approval **fingerprints**, not about what the document
holds. `canonicalizeApprovalInput` covers exactly the inputs an approval
publishes into the live setlist — `serviceType`, `serviceDate`, `serviceRef`,
`setlistTargetKey`, the ordered songs, and `teamNotes`. It has never contained
`lead_notes` or `admin_notes`, and it does not contain `messages`. The private
conversation is not published to anyone, so it cannot change what an approval
means.

`transitionFingerprint` reuses both constants, so this decision covers it too.

## Rejected

**Bumping "to be safe."** It is not safe, it is destructive. Every proposal in
production carries an `approval_receipt` fingerprinted at version 1. Bumping
invalidates all of them at once, and the receipt is what makes a retried
approval a **no-write success** rather than a second publish: `decideApprovalReceipt`
compares the stored receipt against a freshly computed one, and a mismatch is
refused as `receipt_mismatch`. Invalidating the set converts every historical
approval from "verifiably already done" into "cannot be verified", to record a
change that the fingerprint does not observe.

**On SIX documents, not thirteen.** An earlier version of this line said 13, which
is the number of APPROVED proposals — not the number carrying an
`approval_receipt`. Counted against production on 2026-08-27:
`count(*[_type == "setlistProposal" && defined(approval_receipt)])` = **6**, against
13 approved. The gap is approvals that predate the receipt mechanism, and it does
not weaken the argument: six unverifiable approvals is still a worse outcome than
the one this ADR declines to record.

**Adding `messages` to the fingerprint** so the two move together. That would
make an approval's identity depend on the conversation around it — a lead
posting a question after approval would change the approved setlist's
fingerprint, and the receipt for a publish that already happened would stop
matching. It couples a chat channel to a publication receipt for no gain.

## Consequences

A reader who finds the field list and the doc-comment side by side will suspect
a missed bump. This file is the answer, and it is linked from the constants.

The cost is that "the fingerprinted shape changed" now has to be checked against
`canonicalizeApprovalInput` rather than against the schema. That is the correct
check and always was; the thread just made the distinction visible.

**If someone undoes this** and bumps the version, every production
`approval_receipt` stops matching, retried approvals stop being recognised as
already-done, and `refuses an approved proposal with no verifiable receipt`
starts firing on real history. There is no migration back — the old digests
cannot be recomputed under a new version.
