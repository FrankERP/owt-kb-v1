# Review log — 2026-11-12-lead-pastor-message-design.md

**Tier: critical.** The plan changes a production writer and its trust boundary: the lead's proposal POST gains
a field, and the admin proposal-approval writer gains a post-commit write to a second document
(`serviceThread`). Derived from the ladder ("changes a production/server writer or mutation trust boundary"),
not raised or lowered. Two sequential fresh approvals on identical bytes were required.

| Round | Digest (SHA-256) | Verdict | Streak |
|---|---|---|---|
| 1 | `b95f911be91ab114d7f7e690d0079c9562be845878b1fb0bc44b148f5a668cef` | CHANGES_REQUIRED | 0 |
| 2 | `11a216412fc9f3afd8c3ae8b53204c10403584e775417a8130392dc2757285c8` | APPROVED | 1 |
| 3 | `11a216412fc9f3afd8c3ae8b53204c10403584e775417a8130392dc2757285c8` | APPROVED | 2 — met |

Each round ran a brand-new reviewer with only the brief, the immutable snapshot, the evidence pointers and
Frank's verbatim requirement. Rounds ran one at a time.

## Round 1 — blockers

1. **The lead's field stays editable, and promises publication, in exactly the state where the copy keeps the
   existing message** (reopen → the lead corrects it → re-approve, `kept_existing`), and /admin is not told.
   *Verified:* `proposalWriteRequest.ts` allows approve from `changes_requested` and reopen from `approved`.
   **Fixed:** the copy reports `same`/`kept_existing`; the approve response BODY carries it (the route returns
   only `body`, verified at `app/api/admin/proposals/[id]/route.ts`), and /admin toasts it; the lead's help text
   says «no lo reemplaza» when the service already has one; the dialog offers «Usar» whenever a non-draft
   proposal's text differs.
2. **`getSharedProposal` (the editor's own hand-written read) was not in the plan**; with an unconditional set it
   would blank the lead's text on every save. *Verified:* `app/(client)/me/propose/[roleId]/page.tsx` query lacks
   it. **Fixed:** named, with a round-trip test and a query pin.

Substantive round count: 1 (cap is 2). Round 1's non-blocking notes adopted into round 2: approve `body`,
mandatory caller pin, trimmed copy, non-draft «Usar», MCP wording, the 15 November fix stated as done with
existing tools.

## Rounds 2 and 3

No blockers. Non-blocking notes adopted AFTER the final approval are listed in the plan's «Post-approval
changes (UN-REVIEWED)» section; declined: a "dismiss" for «Usar» (cosmetic; documented instead).

## Author-side process notes

- Round 1's blocker 2 was a premise the author assumed (that the editor read through `PROPOSAL_PROJECTION`)
  without checking — exactly the class this review exists to catch.

Approval is not authorization to implement; implementation gets the one merge-range code review and the gates.
