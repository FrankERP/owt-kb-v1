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
| P2 | 6-UI | `7a394ef0`, `af977ae2` | `buildPlannerView` (the view layer), then the planner rebuilt on it: desktop rotation board + bench, phone Sunday cards + seat picker, `kids-planner` theme-gallery fixture |
| P2 | 6-UI | `f79749c0` | Planner amber and blocked states raised to WCAG AA |
| P2 | 6-UI | `d86a41ce`, `b51823b2`, `5072e490` | Bench scoped to the MONTH, not to its first Sunday — two groups per room, then the fix for the two findings that review raised, then its own review's LOW items (see below) |
| — | follow-up | `faff6660` | **«Otra opción»** — an optional `seed` on `RotationInput` with a bounded fairness slack, `proposalFingerprint`, a seed/`exclude` search in `POST /api/kids/generate`, and the planner button. Seed 0 stays byte-identical to the prior behaviour. **ADR-0021.** Not a planned task: the engine is deterministic by design, so the planner had exactly one answer per month and no way to ask for a second |

One of those hashes moved after the fact. The row above cited `e4c20233` for the
planner rebuild; that commit was rewritten and is no longer an ancestor of `main`
— `af977ae2` is the same work, and the only difference between the two is this
file. Every other hash in the table was re-derived against the object database and
is an ancestor of `main`. Worth stating rather than silently correcting: a commit
table nobody re-derives is a table that quietly stops being true — which this one
proved twice, since the heading below kept citing the dead hash for weeks.

### The bench, and why the first cut of it was wrong

The rebuild shipped a bench anchored to `sundays[0]` — every fact on it described
the first Sunday while the list read as month-wide. It survived the plan review, the
code review of the rebuild, and three weeks of use, because nothing about it looks
wrong in a diff: `buildSeatView(anchor, room)` is a correct call to a correct
function. It went wrong at the seam between what the function answers (one Sunday)
and what the surface claims (a month).

What it cost, once someone actually planned a month on it: a pair the generator
placed on the 20th still read as free, and a pair away on the 1st was un-draggable
for all four Sundays. Both were reported as "la banca no funciona".

The fix (`d86a41ce`) makes the bench month-scoped and splits each room into "Falta
colocar" and "Ya en el mes". Its own review (`b51823b2`) then caught the same class
of error one level down — a pair away EVERY Sunday kept `block: null`, so the
month-scoped list recommended a pair that could not serve any Sunday, and a placed
chip dragged with `from: null`, which ADDED a second turn instead of moving one.
Three passes, each finding the previous one's blind spot, none of them findable by
reading the plan.

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

## Planner UI rebuild (`af977ae2`) — three things for the code review

1. **It is not purely presentational, and the two exceptions are deliberate.** The
   admin page's GROQ gained a `history` field and `loadMonth` now also fetches
   `HISTORY_MONTHS` (3) preceding months through the SAME `?month=` endpoint. Every
   "hace 3 semanas" and every "le toca" is measured from prior Sundays; with
   `history: []` the board opens asserting that all twelve pairs have never served,
   which is a confident wrong answer rather than a missing one. A failed history
   read does **not** fail the month — it shows a toast, because the degraded state
   is invisible otherwise.
2. **`canPlace` deliberately overrides one of `SeatView`'s own verdicts.** A drag
   that moves a pair out of another seat on the SAME Sunday reads as
   `{ kind: "seated" }`, because the view is built from pre-move state. The same
   update vacates the source seat, so the server's "one seat per pair per Sunday"
   invariant still holds after it. Pinned by a test that also asserts the same drag
   from the BENCH stays refused.
3. **The gallery fixture uses PLACEHOLDER pair names, against the brief's request
   for the real twelve.** `/theme-gallery/**` is public and prerendered (ADR-0017);
   twelve pairs is twenty-four real first names published to the anonymous
   internet, and the repo already removed six from `PlannerFixture` for exactly this
   reason. `themeGallery.test.ts` now pins the kids placeholder set the same way. If
   Frank wants the real roster there, it is one edit in two files — but it should be
   a decision, not a default.

Colour inventory regenerated after this landed: the ONLY diff is
`filesScanned: 237 → 243` (six new `app/components/kids/**` files). `literalRows`
held at 316 — the rebuild introduced no literal colour.

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

## Client choice: `operationalClient` vs `serverClient` for kids reads

Task 7's implementer flagged that `serverClient` runs the default `raw` perspective at
this `apiVersion`, so a `drafts.kidsSchedule-…` authored in Studio would surface
alongside its published twin. Member-facing kids reads therefore use
`operationalClient` (`perspective: "published"`), matching how `/me` and `/schedule`
read services.

**For the code review:** Task 5's admin-facing `GET /api/kids/schedules` uses
`serverClient`. For an admin surface, seeing unpublished work is arguably correct — but
under `raw` a draft and its published version are two documents, and the planner grid
would show the Sunday twice. These documents are app-written so drafts should not exist,
which makes it low-likelihood rather than impossible. Worth a look.

## ⚠ ACTION AT CYCLE CLOSE — regenerate the colour inventory

`app/utils/__tests__/__fixtures__/colour-inventory.json` was regenerated by Task 7
**while Task 6's four files were untracked in the working tree**, so its `filesScanned:
235` counts files that commit had not yet committed. That commit is therefore not
self-consistent in isolation; it becomes correct once Task 6 lands. The count moved
230 → 234 → 235 within five minutes of parallel work.

**Regenerate once more after the last `app/**` file lands, and confirm the diff is only
counts — a new literal colour ROW means someone bypassed the tokens.** Task 7's three
new rows are all `stroke="currentColor"` SVG attributes (category 8, disposition B),
which is the correct pattern per the `var()`-in-SVG landmine.

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

## «Otra opción» (`faff6660` → `721062c4` → `4a69453b`) — the review chain

The follow-up that gave the planner more than one answer per month. Recorded here
because its lesson is not about the feature: **every substantive defect in this
cycle was found by MEASUREMENT, and none by reading.**

Five vacuous tests, in three separate discoveries:

1. **Two of mine, before the first commit.** The test for "an alternative still
   differs once history exists" passed against a ties-only implementation twice.
   First fixture: 4 Sundays, which leaves 8 of the 12 pairs never-served and tied
   in the enseñanza pool. Second: fingerprint only the room seats, where 4 pairs
   over 4 Sundays *is* saturated — still passed, because the enseñanza-first rule
   pulls the teaching pair out of its own room that Sunday, so a tied enseñanza
   seat leaks variety into the rooms. It took twelve Sundays and zero ties
   anywhere before `SLACK_GENERATIONS = 1` finally failed it.
2. **One of mine, found by the fresh review.** ADR-0021 credited the "never
   re-seats the most recently served pair" test with bounding `SLACK_GENERATIONS`
   from above. It cannot: that guarantee lives in the `- 1` of
   `Math.min(SLACK_GENERATIONS, generations.length - 1)`, so it holds at 2, at 999
   and at `Infinity`. The reviewer did not argue this — they set the constant to
   999 and reported the suite green at 4062/4062. A documented guard that does not
   exist is worse than none: it invites the change it claims to prevent.
3. **Two more, found by the re-verify.** The fix for the sticky-exhaustion finding
   was correct and completely unpinned — the route test asserted only "greater
   than 1" while the planner test hard-coded the offset in its own mock, so
   `requestedSeed + MAX_SEED_ATTEMPTS → requestedSeed + 1` kept all 95 tests
   green. Same for `MAX_SEED`.

**The re-verify step earned its place again.** The fixing commit closed all seven
findings *and* introduced a new defect on the feature's primary error path — the
exhausted toast read "Muévela a mano", a pronoun whose only candidate antecedent
was the plural "opciones". Written fast, under pressure, by the author the review
had just corrected. Exactly the case CLAUDE.md's re-verify rule describes.

Non-blocking findings from the re-verify were fixed inline and dispositioned
without a fresh round, per the 2026-08-19 retier.

### Left alone deliberately

- At `requestedSeed === MAX_SEED` the exhausted resume clamps to itself, so
  repeated asks re-search one window. Reaching it through the UI needs ~7.5e14
  clicks; recorded, not guarded.

## Deferred, with a trigger

- **The generate route's history read is not `published`-gated.**
  `app/api/kids/generate/route.ts` selects prior Sundays on `date < $firstSunday`
  alone, while CLAUDE.md requires kids reads to use the stricter `published ==
  true`. **Pre-existing — «Otra opción» did not introduce it** — but that history
  seeds the fairness clock, so an unpublished draft Sunday now also shapes every
  seeded variant. Surfaced by the code review of `faff6660` and left out of that
  diff on purpose: it is a draft-gating decision, not an alternatives one, and it
  needs its own answer to "can a `kidsSchedule` draft exist at all, given the
  write route mints `published`?" **Trigger: Frank's call, before the Kids team
  starts publishing months.**

- **Worship setlist PUSH notifications reach Kids-only volunteers.**
  `serviceMutationSideEffects.ts:671` fetches every member; `notifyTargets.ts:40`
  defaults an unset preference to `"all"`. Zero exposure today (native apps unshipped)
  and spec §2 forbids touching notification code in this delivery. **Trigger: must be
  fixed before the mobile app ships.**
