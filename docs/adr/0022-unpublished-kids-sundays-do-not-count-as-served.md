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

## Consequences

- A month must be **published** to affect fairness. Saving drafts forever leaves the
  clock reading "nunca" for everyone — visible on the board, which labels it.
- The `[0...HISTORY_WEEKS]` slice got more honest as a side effect: an abandoned
  draft used to consume a history slot and push a real prior Sunday out of the window.
- Zero live impact at the time of writing — the dataset holds **0** `kidsSchedule`
  documents, so nothing was mis-counted yet. This is a fix landed before the first
  real month, not a repair of existing data.
- If the Kids team ever adopts a workflow where serving happens without publishing,
  this decision is wrong and should be revisited — the trigger is a manager asking
  why a pair that clearly served still reads «nunca».
