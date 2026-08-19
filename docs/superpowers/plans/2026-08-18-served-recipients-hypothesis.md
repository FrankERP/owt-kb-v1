# Incident hypothesis — setlist re-pend must skip already-attempted recipients

**Requirement:** No one should miss a notification on something new. Today Saturday 2026-08-22’s setlist notice is still `pending` after a dozen flushes; Sunday 2026-08-23 never starts; the same first two recipients are retried.

**Verified production shape:** `sweepOutbox` re-pends when the send budget stops, but `knownRecipients` is the intro-vs-diff set, not a skip list. Stage 7 still fans out to every live participant. Selection bounds the union of *all* recipients, so a 10-seat Saturday notice is always taken alone (`EMAIL_LIMIT=2`) and Sunday is always `deferred`.

**Change:** Persist `servedRecipients` (member ids this notice already *attempted*, success or fail — same no-retry rule as consume-on-fail). Subsequent sweeps drop those ids before grouping/sending, and selection counts only remaining live recipients. New live assignees not in `servedRecipients` still get the email. When remaining is empty, consume. Do not reuse `knownRecipients` as the skip list.

**Tests:** second-sweep skip; remaining-count selection so a second notice can be claimed; consume when all remaining were attempted.
