# Implementation log — Kids ministry scheduling (P1 + P2)

Running record of what landed, and of the observations each worker surfaced that
the **fresh code review of the merge range must look at**. The plan review of P1
ended with **no approval** (see `…-p1-ministry-auth-review-log.md`), which makes
that diff review the primary gate rather than a secondary one.

## Commits

| Plan | Task | Commit | What |
|---|---|---|---|
| P1 | 1 | `478f1df6` | `app/ministries.ts` — registry, `normalizeMinistries` (the READ rule), `validateMinistryWrite` (the WRITE rule) |
| P1 | 2 | `55b8a6b3` | `ministries` + `managesMinistries` on `teamMembers` |
| P1 | 3 | `3a5d0ca2` | `getMemberAccess` carries both, fail-closed `[]` for a missing member |
| P1 | 3b | `b26e36a9` | JWT/session carry ministries; `NavMenu` filters by ministry |
| P1 | 4 | `7e69af57` | `requireMinistryMember` / `requireMinistryManager` + 10-case matrix |

## Carried into the code review

Each item was raised by the worker who implemented the surrounding code, verified
as non-blocking at the time, and deliberately not fixed in place.

1. **Stale `ministries` on a revoked token** (`auth.ts:247`). The revocation early
   return builds `{ ...token, sanityId: undefined, role: undefined }` and leaves
   `ministries`/`managesMinistries` behind. Harmless *today* because `proxy.ts` and
   both guards treat that token as unauthenticated and the session copy authorizes
   nothing — but it is the same "render-only or it's a bug" dependency as the
   impersonation lag. If anything ever authorizes off the session copy, this and the
   `trigger === "update"` lag become privilege bugs together.

2. **`requireMinistryManager("worship")` is effectively a super-admin check.**
   `MANAGEABLE_MINISTRY_IDS` is `["kids"]`, so nobody can hold
   `managesMinistries: ["worship"]`. Intended per ADR/Task 1's comment, but the call
   shape reads like a ministry check and is not one. Confirm no call site expects
   otherwise.

3. **Guards are only as strong as their call sites.** Nothing enforces that a NEW
   worship surface calls `requireWorshipPage`. The Task 6 enumeration is a
   point-in-time audit, not a standing guard. Worth considering whether a lint rule or
   a route-inventory test should exist (out of scope for this delivery).

4. **`teamMembers` is not in `PROTECTED_STUDIO_TYPES`** (`app/utils/studioProtection.ts:45-58`),
   so both new fields — including `managesMinistries` — are editable by anyone with
   Sanity project write access, around the "super-admin only" rule. Not a regression:
   `role` has had this property all along. Recorded, not fixed; a separate decision.

5. **Session types say `string[]`, the snapshot returns `MinistryId[]`.** Deliberate —
   it avoids importing an app type into the global `.d.ts`, and the narrower type
   assigns cleanly. Consumers wanting narrowing go through `getMemberAccess`, which is
   also the only authoritative source.

6. **Field placement in the Studio form.** The two new fields sit between `disabled`
   and `themePref`, grouping them with the other auth fields. Cosmetic; flagged to
   Frank.

7. **`colour-inventory.json` fixture churn.** Adding a file under `app/**` moves its
   `filesScanned` count. P1 Task 1 regenerated it (220 → 221) with
   `node scripts/colour-inventory.mjs` after confirming the cause by stashing. Any
   further count movement in this branch should be attributable the same way — a colour
   ROW moving would be a different thing entirely and is not expected from this work.

## Deferred, with a trigger

- **Worship setlist PUSH notifications reach Kids-only volunteers.**
  `serviceMutationSideEffects.ts:671` fetches every member; `notifyTargets.ts:40`
  defaults an unset preference to `"all"`. Zero exposure today (native apps unshipped)
  and spec §2 forbids touching notification code in this delivery. **Trigger: must be
  fixed before the mobile app ships.**
