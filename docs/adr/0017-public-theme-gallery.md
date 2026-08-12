# ADR-0017: Serve the theme gallery without a session

**Date:** 2026-08-12 · **Status:** Accepted — supersedes the gating decision in [Child A2](../superpowers/plans/2026-08-08-light-mode-A2-rendering.md)

## Context

`/theme-gallery/[theme]/[fixture]` renders the app's real components — the swatch
set, an open `CueDialog`, a full-screen `PlannerGrid` — in both themes, from
hardcoded fixtures. It exists to make theme work reviewable.

Child A2 put it behind the session middleware. That was a deliberate choice, and A2
left three assertions in `app/utils/__tests__/themeGallery.test.ts` to stop anyone
undoing it casually, including one commented *"If the gallery ever needs a
`PUBLIC_ROUTES` entry, the placement is wrong — that entry is the signal, not the
fix."* The tripwire worked: it forced this record.

**What changed is not the route. It is that a verification agent now exists that
cannot log in.** `visual-verifier` is forbidden from entering credentials — a
permanent, correct constraint — so it can measure exactly one route in this app,
`/auth/signin`. Everything else is verifiable only by a human with a phone. Its two
dispatches left 11 of 13 placeholder sites, `CueDialog`, the full-screen planner
and every admin surface unmeasured.

**A2's reason was cost and tier, not a property of the route.** Its own plan says
gating let it drop four containment mechanisms — an env flag, a `SECRETS.md` entry,
a build-time refusal, a `PUBLIC_ROUTES` entry — that "existed only to contain an
unauthenticated route", and that this "drops this child to Standard". That is a
reasonable trade for a route nobody needed to reach anonymously. It stopped being
the right trade when something needed to.

## Decision

`theme-gallery(?:/|$)` is excluded from `MIDDLEWARE_MATCHER`, in both copies
(`app/utils/routeMatcher.ts` and the inline literal in `proxy.ts`, which Next
requires to be statically analyzable). `PUBLIC_ROUTES` in
`app/utils/__tests__/routeMatcher.test.ts` gains `"/theme-gallery/sample/sample"`.

The anchor is deliberate: it opens the segment and its children. `/theme-gallery-secrets`
stays gated, and a test asserts that.

## Rejected

**Placing the gallery under `/auth/`**, which the matcher already excludes and which
would need no matcher edit at all. A2 recorded this alternative and it is the more
tempting one, because it looks like it avoids touching the auth boundary.

**It produces identical exposure.** The middleware does not run for `/auth/*`
either. It is the same decision reached by placement instead of by regex — so it
avoids *looking* like the security question is being asked, rather than avoiding the
question. A2 saw this: *"Both placements need no matcher edit, so 'no matcher edit'
justified neither."*

Between two routes to the same exposure, this takes the one that is **visible in the
auth boundary**: a named alternation, a `PUBLIC_ROUTES` entry someone must review,
and this record.

**Keeping it gated and provisioning credentials for the agent** was not seriously
available. Entering credentials is the one thing `visual-verifier`'s charter
forbids, and a second read-only login path is itself a secret/auth-boundary change
with a `docs/SECRETS.md` entry — strictly more surface than opening a page that
reads nothing.

## Consequences

**What is exposed:** the app's visual design, its component layouts, its colour
system, and — served in the page's client chunk — the planner's rule logic
(`ruleEnforcement`, `seatModel`, `moveGate`, `serviceIntegrityQueue`). That is a
real disclosure and is recorded as one.

**What is not:** any data. The gallery's entire runtime import closure contains no
Sanity client, no session helper, no `process.env` and no `fetch` — the single edge
into server code is an `import type` at `plannerModel.ts:34`, erased at build. It is
statically prerendered with `dynamicParams = false`, so there is no runtime request
path. Its fixtures carry placeholder names; six real team members' first names were
removed in `2183b3d`, before this decision was taken, so the choice could be made on
its merits.

**The marginal disclosure is smaller than it appears.** `_next/static` is already
excluded from the matcher, so the entire client bundle — every component, the whole
colour system — is world-readable today. What this adds is a *rendered, browsable*
view of it.

**`dynamicParams = false` is now security-relevant.** It is what stops an arbitrary
`[theme]` string being reflected into the root `className`. That was true before, on
a members-only route; it now applies to the anonymous internet. A future "let the
gallery accept any theme string, it's just a class" is no longer a convenience
change. `themeGallery.test.ts` guards it.

**The inertness guard is the whole argument, and it is one level deep.** It checks
`layout.tsx`, `page.tsx` and the three fixtures for session reads, fetches, Sanity
clients and env access. It would **not** catch a fixture importing a component that
fetches. Today that gap is bounded — every API route stays gated, so a client-side
fetch from an anonymous visit gets a 307, not data — but a **server-side** read
would bake real data into public prerendered HTML, where a 307 is irrelevant.

**Rollback** is removing the alternation from both matcher copies and the
`PUBLIC_ROUTES` entry. One line each; the route 307s again immediately.
