# Review log — `2026-10-15-member-calendar-feed-design.md`

Written after the loop ended; never shown to a reviewer. **Approval is not authorization to
implement**; implementation still needs the five gates and one fresh code review of the merge
range before any merge to `main` (CLAUDE.md §Review policy).

## Tier

**Critical**, derived from the ladder, not raised or lowered: the artifact opens a new
unauthenticated route whose only gate is a secret — an auth/security/secret boundary — and adds a
production writer (the rotation's counter). Requirement: two sequential fresh `APPROVED` verdicts
on byte-identical bytes.

## Rounds

| Round | Reviewed digest (SHA-256) | Verdict | Streak |
|---|---|---|---|
| 1 | `dc07b2ea1b1546a11bfa0ce0f12eb2abaadfef8d9807014cd86393e61e29b904` | CHANGES_REQUIRED (substantive) | 0 |
| 2 | `30f68420d7c3ac6e992a77ced07df3198dccddaf3c9d5d77ef6392de7e6d1b29` | APPROVED | 1 |
| 3 | `30f68420d7c3ac6e992a77ced07df3198dccddaf3c9d5d77ef6392de7e6d1b29` (same snapshot) | APPROVED | 2 — requirement met |

Every reviewer was a fresh instance, run one at a time, given only the reviewer brief, the
immutable snapshot path and digest, evidence pointers and Frank's original request. The canonical
file and the snapshot digests matched before and after each verdict. One substantive round; the
churn cap was not approached.

## Round 1 blockers

1. **Anonymous requests cost Sanity reads before any secret check, and grow an unbounded cache.**
   The draft order was member access → generation read → HMAC, forced because the token covered a
   generation only the server knew. Verified: `getMemberAccess` reads through `serverClient`
   (`useCdn:false`) and caches every caller-supplied id in a module-level `Map` with no eviction
   (`app/utils/memberAccess.ts:11,66`); the dataset is on the Free plan and shared with production.
   **Fixed:** the generation travels in the URL, the HMAC is verified with zero I/O first, one
   combined read follows, and `getMemberAccess` is not used. CF2 now asserts zero Sanity requests
   for every pre-signature refusal.
2. **No path to verify a real calendar client; dev is behind Deployment Protection.** Verified:
   `docs/MCP.md` («Adding the connector»): outside servers carry neither the bypass header nor the
   cookie. **Fixed:** a «Verification beyond unit tests» section (independent parser check, a dev
   fetch with the bypass header, a production acceptance step with Google and an iPhone) and a
   Preview line in the panel.

Non-blocking items adopted in the same edit: refuse (503) a throwing read or a malformed stored
counter; the reason for the dotted id written down; refresh PT3H, an edge cache and a request
budget; the duplicate-events copy for members who used the download. Declined: naming
`buildRuns`/`normalizeMedleyTags` (the feed marks a medley song per line and groups nothing).

## Rounds 2 and 3

No blockers. Non-blocking notes (both rounds converged on the first two):

- The edge cache key includes the raw query and spelling, so «96 a day» was not a bound — adopted
  (post-approval change 1, and the cache lengthened to an hour, change 2).
- The generation is shared by dev and production — adopted as a stated residual and panel copy (3).
- Kids-only rotate — adopted (4). CF9 and folding — clarified (5). Google mobile and the iOS
  WebView `webcal://` — copy and an acceptance check (6). Rollback answers 307, not 404 — wording (7).
  First instrument seat only — stated (8).
- Quota: the Sanity Free plan's request quota was not verified by any round or by the author; the
  restated worst case (~3.8k/day) is to be compared against the project's usage page after release.

## Post-approval changes

Listed in the spec's «Post-approval changes» section, items 1–8. **None of them was reviewed** —
approval covers digest `30f68420…1b29` only. They narrow behaviour (fewer accepted URLs, a longer
cache, one more 403) or change copy; the merge-range code review covers their implementation.

## Author-side process notes

- Draft implementation was written in the working tree while rounds 2–3 ran, to save wall-clock.
  Reviewers were told to judge the plan, not the draft; the draft follows the reviewed design plus
  the post-approval changes above.
