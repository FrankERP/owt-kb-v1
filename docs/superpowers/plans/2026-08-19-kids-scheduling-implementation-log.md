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
| P1 | 5 | `dfa7e2d9` | Admin ministry editing — touched-field-only, normalized seeding, `handleAdd` wiring, zero-ministry block (24 new tests) |
| P2 | 1 | `40a1afcd`, `34c61a3c` | `kidsPair` + `kidsSchedule` schemas, registered; validation callbacks typed |
| P2 | 2+3 | `30453dab` | Kids domain types + deterministic rotation engine (9 tests) |

## Plan defects the implementers caught

Worth recording separately from code observations: these are places the **plan itself**
was wrong or self-contradictory, found by the worker executing it. Same defect class the
review rounds kept surfacing, which is evidence the class outlived the review.

- **P1 Task 5 Step 4 contradicted its own prose.** The sample code sent the ministry
  arrays only when `touchedMinistryFields.has(...)`, while the paragraph below said
  "On CREATE sending the arrays unconditionally is fine and desirable". Taken literally
  the sample would have made Step 4b's `handleAdd` change dead code again — a create
  where the admin accepts the default `["worship"]` touches nothing. The worker
  implemented `!initial || touched`, which satisfies both statements, and pinned the
  create path with a test.
- **P1 Task 5's email-prefs line citations drifted by one** (`:242-248` / `:249-252`,
  not `:242-247` / `:248-252`). Every other line number in that task verified correct.

## Facts for the planner UI (P2 Tasks 5-6)

- `planKidsMonth`'s base case yields `ensenanza = c1,c2,c3,c4` and
  `chiquitos = c2,c1,c4,c3` over four Sundays — the enseñanza-first rule displacing each
  room's next pair, which is the behaviour the Kids team described.
- **The unfillable-seat diagnostic interpolates the RAW ISO date**
  (`"Sin parejas disponibles para RG Chiquitos el 2026-09-06"`), because formatting it
  would need `new Date(iso)`, which the timezone invariant forbids in that layer. If the
  planner wants a Spanish long date, **format at render time** from the `date` field.
- Fairness category keys are `"ensenanza"` and `` `room:${seat}` ``, keyed off the SEAT.

## Repo guards that caught the plan being wrong

These are the strongest evidence that the repo's own invariant tests are doing real
work — each one blocked a defect the plan would otherwise have shipped:

- **`protectedReadAudit.ts`** — the plan told the Kids generate route to read worship
  roles through `serverClient`; role types must go through `operationalClient`.
- **`draftGatingCoverage.test.ts`** — the plan's `assignedMemberRefsQuery` call omitted
  `published != false`. Without it the Kids planner would have been the surface that
  revealed a DRAFT worship roster.
- **GROQ has no boolean default** — `"published": published` projects `null`, not
  `false`, for a document lacking the field, handing the UI a third state. The routes
  use `coalesce(published, false)`; the plan was corrected before Task 7 was dispatched
  (`32d976ae`) so the mistake could not repeat.
- **`agentDocsParity.test.ts`** caught `AGENTS.md` drifting from `CLAUDE.md` when the
  workflow amendments landed, and again constrained the Task 8 auth-section edit.

## Pre-existing doc drift, NOT fixed here

`CLAUDE.md`'s Domain-docs line and `docs/agents/domain.md` both point at a root
`CONTEXT.md` that **does not exist**. Unrelated to this delivery and deliberately left
alone rather than fixed mid-cycle; worth a decision (write it, or drop the reference).

## Coverage gap recorded in ADR-0020

Nothing enumerates which pages must call `requireWorshipPage`. `worshipPageGate.test.ts`
tests the gate's behaviour, not its adoption, so a NEW worship page added later is
ungated by default and no test complains. ADR-0020 states this in its Consequences. A
route-inventory guard would close it; out of scope for this delivery.

## Operational note

`node scripts/colour-inventory.mjs` regenerates the whole artifact, and while several
workers are editing `app/components/**` it also rewrites `line` numbers in rows those
workers own. Those columns are asserted nowhere (the guard excludes `line`), but
committing them would fold someone else's pending work into your commit. The P2 worker
hand-edited the `filesScanned` count instead — the right call. Expect this again if the
fixture needs regenerating while other work is in flight.

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
