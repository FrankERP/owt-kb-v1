# ADR-0024: Read state belongs on neither `setlistProposal` nor `teamMembers`

**Date:** 2026-08-26 · **Status:** Accepted

## Context

The thread shipped with **no unread indicator**. Frank asked for one and chose
real read marks over a derived "there are messages newer than your last visit"
signal, which is weaker and lies in exactly the case that matters — someone who
opened the page without reading.

Real read marks need per-viewer, per-thread state. The two documents already in
hand are the obvious homes, and both are wrong.

## Decision

**Read state is deferred, and when it lands it goes on neither of these two
documents.** Not on `setlistProposal`, not on `teamMembers`.

The thread ships with no unread affordance at all rather than with a cheap one
in the wrong place. A derived indicator was rejected on the same grounds it
always is: it reports "new since you last loaded", which is not what a person
means by unread.

## Rejected

**`setlistProposal.readBy[]`** — an array of `{person, at}` on the proposal.
This is the tempting one because the thread already lives there. It makes every
reader a **writer of a protected document**. `setlistProposal` is guarded by
`PROTECTED_RUNTIME_WRITERS`, its writers assert observed revisions, and
`approval_receipt` / `last_transition` are fingerprinted against its content.
Opening a page would move `_rev` — which, per Child A §5, 409s every open lead
editor and trips the admin's fail-closed review lock. Reading someone's message
would invalidate an in-flight approval. It also grows without bound on the one
document type whose payload already worried us (`PROPOSAL_PROJECTION` backs an
all-proposals read).

**`teamMembers.readProposals{}`** — a map on the member. `teamMembers` is
protected too, and it is the document the auth layer reads on every request
through `isMemberActive`'s 30-second cache. Writing it on page view puts a write
in the hot path of authentication. It also makes a member's document grow with
every proposal they ever open, and `notifPrefs` lives there — a field CLAUDE.md
already restricts to a single resolver precisely because casual writes to that
document are dangerous.

## Consequences

The thread has no unread badge, and that is visible: someone must open a
proposal to find out whether anything was said. Child B's pushes narrow it —
you learn a message exists from the notification — but they do not mark it read.

**What this costs the eventual implementation:** a third document type, or a
different store. That is the point of writing this down; the cheap options are
cheap because they put a high-frequency, low-value write onto documents whose
whole design assumes writes are rare, guarded, and revision-asserted.

**If someone undoes this** and adds `readBy[]` to the proposal, the first
symptom will not look like a data problem: leads will start getting spurious
409s on save, and admins will find Aprobar disabled for no visible reason,
because a page view now moves the revision their protocol is built on.
