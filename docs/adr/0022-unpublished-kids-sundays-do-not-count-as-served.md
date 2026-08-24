# ADR-0022: An unpublished Kids Sunday does not count as served

**Date:** 2026-08-21 · **Status:** Accepted

## Context

Two reads answer "how long since this pair served this seat": the generator's
history read in `app/api/kids/generate/route.ts`, which seeds the fairness clock,
and the planner page's `history` projection, which renders every «le toca» and
«hace 3 semanas» label. Both shipped filtering on date alone, with no `published`
clause — a deviation from CLAUDE.md's rule that kids reads use `published == true`,
surfaced by the code review of the «Otra opción» work and deferred out of that diff.

It is not obviously a bug, which is why it needed deciding rather than patching.
CLAUDE.md's rule is written about **member-facing** reads, and neither of these is
one: both sit behind `requireMinistryManager("kids")`. A fairness clock asking
"did this pair serve?" is a different question from "may this person see this?",
and the two can legitimately want different answers.

## Decision

Both history reads filter `published == true`. **An unpublished Sunday is a
proposal, not a fact.**

The planner page's sibling `schedules` projection and the whole of
`app/api/kids/schedules/route.ts` stay UNGATED, deliberately: those are the month
being edited and its writer. An editor that could not see its own drafts could not
show the work the planner exists to do, and the PUT must read a draft in order to
publish it.

`draftGatingCoverage.test.ts` now scans `kidsSchedule` alongside the three worship
role types, requiring the stricter `published == true` spelling, with exemptions
keyed by file AND by projection name — the planner page holds one group of each
kind, so a file-level exemption would shield both.

## Rejected

**Counting every saved Sunday, published or not** — the shipped behaviour, and the
one you get by reading the rule as "member-facing only, so this is out of scope".

It fails on the ordinary case rather than an exotic one, because **drafts are the
default**: `PUT /api/kids/schedules` mints `published: false`, and «Guardar
borradores» is a first-class button next to «Publicar». So a month that was built,
saved, and then abandoned or superseded is a normal artifact of using the planner —
and under the old behaviour every pair named in that dead draft was recorded as
having served. They would then be skipped for weeks by a clock nobody can see,
with no way to tell from any screen why their turn never comes.

The symmetric risk is real and was weighed: if the team serves a month without ever
publishing it, the clock goes blind and pairs repeat. That case is self-correcting
and visible — `/kids` and `/me` show only `published == true`, so an unpublished
month means volunteers could not see their assignments in the app at all. Publishing
is already required for the app to be useful; not publishing means the app was not
being used that month, and not counting it is right.

Between "silently penalise pairs for a draft nobody acted on" and "ignore a month
the app never showed anyone", the second is both less likely and easier to notice.

**Gating only the generator, not the planner page.** The labels and the plan come
from two different queries. If they disagree, the board tells the admin «le toca» for
a pair the generator will not pick, and neither surface can reveal the disagreement.
Pinned by a test that asserts both carry the filter.

**Gating only the server reads.** The first version of this change did exactly that
and was wrong on the dominant path — caught in review, not by the tests. The planner's
`history` state arrives gated from the page query but is **refilled by `loadMonth`
from `GET /api/kids/schedules`**, the editor's endpoint, which returns drafts by
design. The gate therefore survived until the first month navigation, which is the
first thing an admin does, since the point is to plan an upcoming month. `KidsPlanner`
now re-applies the filter at the single `useMemo` every path feeds through. The
client-side check is not belt-and-braces; without it the server-side one is decorative.

Pinned by two pairs of tests in `kidsPlanner.test.tsx`, and the second pair exists
because the first is not enough: the `initialHistory` tests cover the server-rendered
path, and a change that drops `published` inside `loadMonth` leaves them green while
the board reads «nunca» for everybody. Both pairs carry a published-side negative
control, which is the half that catches that mutation.

### What "the two agree" does and does not mean

They agree on the `published` clause, which is what this ADR is about. They do **not**
share a window: the generator reads `[0...HISTORY_WEEKS]` (16 Sundays, no lower bound),
the planner page reads `HISTORY_MONTHS` (3 calendar months, so 12–14 Sundays depending
on the months). A pair whose last turn falls in that gap has a real `lastServed` in the
generator and reads «nunca» on the board. The gap now moves with the data as well as
the calendar: the generator's slice counts 16 *published* Sundays, so on a sparsely
published history it reaches further back than 16 weeks. Pre-existing, low impact —
both orderings put such a pair at the front — but it is a real difference, and the
claim in the code comments is about the filter only.

### What this decision does not address: the perspective

Both clock reads use `serverClient`, which sets no `perspective`, so at this repo's
`apiVersion` they run **raw** and can see `drafts.kidsSchedule-…` overlays. `/kids`
uses `operationalClient` precisely to avoid that, and `kidsSchedule` is not in
`PROTECTED_TYPES`, so no audit covers the gap. A Studio-authored draft overlay of a
published Sunday would be returned *alongside* the published document — double-counting
it and consuming two of the 16 history slots — and an overlay carrying `published: true`
passes this ADR's filter untouched. Exposure today is negligible (`kidsSchedule` is
read-only in Studio per `studioProtection.ts`), and it is entirely pre-existing. It is
named here rather than fixed because this ADR now asserts that the clock counts only
Sundays that were actually served, and that claim is true on the `published` axis only.

## Consequences

- A month must be **published** to affect fairness. Saving drafts forever leaves the
  clock reading "nunca" for everyone — visible on the board, which labels it.
- **Planning ahead of publishing loses the month in between**, and this is the one
  consequence that bites a reasonable workflow rather than a careless one. Build
  September, save drafts, then plan October before September is published: October's
  clock cannot see September at all, so a pair can be seated two months running and
  neither screen contradicts it — the board and the generator agree, which is exactly
  what this ADR asked for. The mitigation is procedural, not code: **publish month N
  before generating N+1.** The trigger to revisit is a manager asking why a pair they
  just scheduled still reads «nunca». Weighed and accepted rather than overlooked: the
  alternative is a "count drafts, but only recent ones" rule with a second threshold
  to get wrong, and the abandoned-draft case it would re-open is the more common one.
- The `[0...HISTORY_WEEKS]` slice got more honest as a side effect: an abandoned
  draft used to consume a history slot and push a real prior Sunday out of the window.
- Zero live impact on release. Counted read-only against the production dataset on
  **2026-08-24**, immediately before the merge: **0** `kidsSchedule` documents (12
  `kidsPair`). So nothing had been mis-counted and no pair's clock moves — this is a
  fix landed before the first real month, not a repair of existing data. The count is
  dated on purpose: the code review flagged that the original claim was written on
  2026-08-21 and was not verifiable from the repository, and both `preview` and `main`
  write the real dataset, so a Sunday drafted in between would have made the release
  something other than a no-op.
- If the Kids team ever adopts a workflow where serving happens without publishing,
  this decision is wrong and should be revisited — the trigger is a manager asking
  why a pair that clearly served still reads «nunca».
