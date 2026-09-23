# Review log — `2026-09-22-worship-night-song-leads.md` (adversarial plan review)

Written after the loop ended; never shown to a reviewer. **Approval is not authorization to
implement** — implementation still requires gates plus a fresh code review of the diff.

## Tier

**Critical**, for the slice Tasks 2, 3, 4 and 8, derived from the ladder (not raised or
lowered): Task 3 changes the setlist writer's full-array song serializer and adds a member
reference validated against another field; Task 4 changes the approval writer's song rows;
Task 8 changes the notification snapshot the outbox writer stores and the flush comparison;
Task 2 is the shared rule module those call. Tasks 1, 5, 6, 7, 9 are standard (additive
create-time field in the shape PR #90 already used for `time`; planner, UI, member reads) and
were context for the reviewers only.

## Rounds

| Round | Reviewed digest (SHA-256) | Plan commit | Verdict | Streak |
|---|---|---|---|---|
| 1 | `050ba5cb5b8d9cdaeb5439e54ef0f1fc1dd8e60887125bce629363efb15648d6` | `424727d5` | CHANGES_REQUIRED (1 blocker) | reset → 0 |
| 2 | `cca34f00a36e833a63f339fa70fc33f59ca363632340bb1c2b747a3eba556094` | `de4694df` | APPROVED | 1 |
| 3 | `cca34f00a36e833a63f339fa70fc33f59ca363632340bb1c2b747a3eba556094` (same snapshot) | `de4694df` | APPROVED | 2 — requirement met |

Every round used a fresh `skeptical-reviewer` (opus), one at a time, given only the reviewer
brief, the immutable snapshot path and digest, the spec, evidence pointers and Frank's
requirement. Rounds 2 and 3 reviewed the byte-identical snapshot; canonical and snapshot digests
were verified equal before and after each verdict.

**Approved digest:** `cca34f00a36e833a63f339fa70fc33f59ca363632340bb1c2b747a3eba556094`.

## Round 1 — blocker and disposition

1. **The flush side dropped leaders from the stored snapshot.** `outboxSweep.ts`'s
   `normalizeSnapshotRows` (lines 271–278) rebuilds each stored `beforeSongs` row with only
   `_key`/`ref`/`key`/`group`, while the live side (`songRowsFrom(role.songs)` via the raw
   `ROLE_QUERY`) would carry `leads`. On a worship night with leaders, a no-op save would email
   «El setlist cambió», and clearing every leader would not email at all (spec §8).
   **Fixed** in `de4694df`: Task 8 now changes `normalizeSnapshotRows` to keep `leads` and adds
   four `outboxSweep.test.ts` cases (no change → no email; leader changed; all cleared; name read
   fails → email without names). **Evidence checked:** `outboxSweep.ts:271-278` and `:394`
   (`classifySetlist({ …, before: normalizeSnapshotRows(notice.before?.beforeSongs) })`), and
   `ROLE_QUERY` at `:234-236` projecting raw `songs`. Substantive — counted 1 toward the churn
   cap (cap never reached).

Non-blocking items adopted in the same fix (reviewed in rounds 2–3): the leader check moved
after the observed-target comparison (a stale editor gets the 409 reload path); the Studio
schema gains `leads` on the special's inline `setlist_song`; the leader-name read is
best-effort; spec §13 records `Select` instead of `Menu`.

## Rounds 2 and 3 — no blockers

Both reviewers independently verified, among others: only two code paths write a special's
`songs` (setlist PUT, approval), both revision-guarded on the role they validated against; the
approval fingerprint hashes `songId`/`playKey`/`medleyTag` only; the queue and flush snapshots
are symmetric, with `leads` absent when empty so older notices compare unchanged; the leader
read sits before the send-budget clock; only `SetlistEditor` calls the PUT and
`ProposalEditor` sends explicit row fields.

## Non-blocking items after the final approval

**Adopted — post-approval, UN-REVIEWED** (marked in the plan, covered only by the
implementation's code review):

- `notificationOutboxSchema.test.ts` pins the snapshot row's fields; Task 8 updates it on
  purpose to include `leads`.
- Task 8's commit now includes `outboxSweep.test.ts` and the schema test.
- Task 3 names the existing `buildSetlistSongDocs`/`buildProposalSongDocs` test call sites that
  need `leadIds: []`.
- `formatLeadNames` skips nullish entries (an unresolved dereference).
- `sortedLeadIds` in `songLeads.ts` is the one normalizer for snapshot leader ids, used by both
  `songRowsFrom` and `normalizeSnapshotRows` (the plan had re-implemented it inline).
- `leadRosterOf` keeps a Lead member with no name as «Sin nombre» instead of dropping them (the
  editor would otherwise block a save the server accepts).
- The editor explains a `songs[…].leadIds` 400 on a set with no saved songs (no revision to go
  stale there) as «Cambió quién está en Lead mientras editabas. Recarga el setlist.»
- ADR-0036 notes that `leads` are strong references, so a member who still leads a song cannot
  be deleted in Studio.

**Not adopted:**

- *Require the `leadIds` key on every row of a worship-night PUT* (so an old editor tab cannot
  wipe leaders). Declined: it changes the approved writer contract after approval; worship nights
  only exist after this deploy, so the exposure is an admin tab opened before the deploy and
  used on a set created after it, by a small admin team. Recorded as an accepted risk.
- *Mark leader-only changes per row in the email.* Deferred; the email already names the
  leaders of every song.
- *Email leader order is sorted by id, cards use stored order.* Accepted cosmetic difference.
- *A route-level test that the PUT/approval `before` snapshot carries `leads`.* The chain is
  tested piecewise and end to end at the sweep; not added.

## Process notes (author side)

- The round-1 blocker was an author omission: the plan edited the queue-side builder and the
  comparator but not the flush-side reader of the same stored rows — the twin of a changed
  section, the defect class the skill warns about.
- The plan's first draft left the build red between Tasks 3 and 4; caught in self-review before
  round 1 (a one-line compatibility change moved into Task 3).
- No reviewer claim was accepted without checking the cited lines.
