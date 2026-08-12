# Implementation Plan: serve the theme gallery without a session

## Original request

> "find what's gating the theme gallery" → "plan the matcher change"

`/theme-gallery/[theme]/[fixture]` returns `307` to sign-in. It is the one surface
in this repo built specifically to render **both themes with no session**, and it
is the only thing standing between an agent that cannot log in and a measured
verification of light mode across the app's real components.

No secrets, credentials or personal data appear in this plan.

## Status and contract

- **Document status:** Draft — not reviewed, not approved, not authorization to implement.
- **Risk tier: CRITICAL — two sequential fresh `APPROVED` verdicts on byte-identical text.**
  Not because it is large; it is a handful of characters. Because it moves an
  **auth/security boundary**: it removes a route from the set the session
  middleware protects, and CLAUDE.md names that category explicitly. A change that
  is one regex alternation wide and permanently public in effect is exactly the
  shape that should not be waved through.
- **Safe ending state:** `/theme-gallery/*` serves anonymously; **every other route
  is gated exactly as it is today**, proven by a guard that enumerates the whole
  app rather than by inspection.
- **Rollback:** remove the alternation from both copies of the matcher. One line
  each, instant, no data implications — the route simply 307s again.

## Why this is worth an auth-boundary change at all

`visual-verifier` cannot enter credentials, and that constraint is correct and
permanent. Today that means it can measure exactly **one** route — `/auth/signin`
— and everything else in the app is unverifiable by anything except a human with a
phone. Concretely, from its two dispatches: 11 of 13 placeholder sites unmeasured,
`CueDialog` unmeasured, the full-screen `PlannerGrid` unmeasured, every admin
surface unmeasured.

The gallery already renders those exact components — `CueDialog`,
`PlannerGrid` full-screen, the swatch set — in both themes, from fixtures. It was
built for this. It is simply behind the gate.

**This buys a permanent capability, not a one-off.** Every future colour or theme
change becomes machine-verifiable in both themes without a human or a credential.

## What ships

| # | Change | File |
|---|---|---|
| 1 | `theme-gallery(?:/\|$)` added to the matcher's negative lookahead | `app/utils/routeMatcher.ts` |
| 2 | **The identical edit**, byte-for-byte | `proxy.ts` |
| 3 | `/theme-gallery/…` added to `PUBLIC_ROUTES` with its reason | `app/utils/__tests__/routeMatcher.test.ts` |
| 4 | An ADR — an auth boundary moved deliberately | `docs/adr/00NN-public-theme-gallery.md` |
| 5 | Doc rows | `ROUTES.md`, `CLAUDE.md`/`AGENTS.md` if either enumerates public routes |

## The matcher is duplicated, and the duplication is load-bearing

`proxy.ts:38-44` carries the same string inline, because **Next.js requires a
statically-analyzable literal** and cannot resolve an imported constant.
`routeMatcher.test.ts:147` is a sync guard asserting the two are byte-identical.

So: **both copies move in the same commit, or the guard fails.** That guard is the
good outcome — it is what stops the two drifting into a state where the tested
matcher and the enforced matcher disagree, which would make every other assertion
in that file meaningless.

The exact insertion, into the existing alternation:

```
/((?!auth(?:/|$)|api/auth(?:/|$)|api/cron(?:/|$)|theme-gallery(?:/|$)|…).*)
```

`(?:/|$)` matches the anchoring style of every neighbouring alternative, which
exists so `/api/cronjobs` stays gated. Here it means `/theme-gallery-secrets`
would **not** be opened by this change — only the segment itself and its children.
That is not incidental; it is the difference between opening a route and opening a
prefix.

## What is actually being exposed

Verified before proposing, not asserted:

- **No data access of any kind.** `grep` across `app/(gallery)` for `serverClient`,
  `operationalClient`, `getServerSession`, `requireActive`, `process.env` and
  `fetch(` returns **nothing**. The fixtures are hardcoded literals.
- **Prerendered at build time.** The build reports
  `● /theme-gallery/[theme]/[fixture]` with 6 static paths, so there is no runtime
  request path to abuse.
- **No personal data.** The planner fixture previously carried the first names and
  roles of six real team members; those were replaced with placeholders in
  `2183b3d`, **before** this plan, precisely so the gate question could be decided
  on its merits rather than under time pressure.
- **No provider-less layout risk.** `app/(gallery)/theme-gallery/[theme]/layout.tsx`
  is a separate root layout with no `<Provider>`, so none of Child E/F's session
  machinery — `ThemeBootstrap`, the `/api/me` read, the migration script — runs
  there at all.

**What it does expose:** the app's visual design, its component layouts, and its
colour system, to anyone with the URL. That is a real disclosure and should be
stated as one rather than dismissed. The judgement is that a worship-team
scheduling tool's swatch page is not sensitive, and the design is already visible
to ~40 volunteers. **This is the decision the reviewer should press on**, because
it is the only genuinely arguable part of the change.

## The guard that makes this safe

`routeMatcher.test.ts:45-52` walks every route in `app/` and asserts
`ungated === PUBLIC_ROUTES` — an exact-equality check against a hand-maintained
list. So this change **cannot** quietly open anything else: adding
`theme-gallery` widens `ungated` by exactly the gallery routes, and the test fails
until `PUBLIC_ROUTES` is updated to match, deliberately, with a comment.

That is the whole safety argument, and it is worth stating plainly: the protection
is not that the regex is carefully written, it is that a test enumerates the
resulting public surface and compares it to a reviewed list.

**Verification must include the negative case**: a test that a representative
protected route — `/me`, `/admin`, `/api/me/theme` — is still gated *after* the
change, so a regex slip that widened the lookahead beyond intent fails loudly.

## Slicing

**Not sliced.** Items 1–3 must land together or the sync guard and the
`ungated === PUBLIC_ROUTES` guard both fail; the ADR and docs join them because
CLAUDE.md requires documentation current in the same delivery. One commit.

## Verification

- **`middlewareRuns("/theme-gallery/light/swatches")` is `false`**, and
  `middlewareRuns` for `/me`, `/admin/...`, `/api/me/theme`, `/api/admin/...` is
  still `true`.
- **`/theme-gallery-anything` is still GATED** — the `(?:/|$)` anchor, tested
  explicitly rather than assumed.
- **`ungated === PUBLIC_ROUTES`** still holds, with the gallery routes added to the
  list and a comment saying why they are safe.
- **The proxy.ts sync guard passes** — both copies byte-identical.
- **An anonymous request actually reaches the page**: `curl -s -o /dev/null -w "%{http_code}"`
  against a running production build returns `200`, not `307`. This is the only
  assertion that tests the thing the change is for; every other one tests the regex.
- **`visual-verifier` dispatched against the gallery afterwards**, unauthenticated,
  measuring both themes. That is the acceptance criterion — if it still cannot
  reach it, the change failed regardless of what the tests say.
- `npx tsc --noEmit`, `npm test`, `npx eslint .` at 0 errors.
- **A fresh code review before the merge to `main`**, per the rule added earlier
  today. This is an auth boundary; it does not get the exemption.

## Risks

| Risk | Why it is real | Mitigation |
|---|---|---|
| The regex opens more than intended | A lookahead alternation is easy to get subtly wrong | `ungated === PUBLIC_ROUTES` enumerates the entire resulting public surface; plus explicit negative cases |
| The two matcher copies drift | Next.js forces the duplication | The existing byte-identical sync guard, which fails on any divergence |
| Design disclosure | The gallery becomes world-readable | Stated, not dismissed — the reviewer should test this judgement. No data, no personal information, no runtime path |
| Someone later adds a data-reading fixture | The safety argument is "it reads nothing", which is a property of today's code | **Add a guard**: assert `app/(gallery)` imports no Sanity client, no session helper, and calls no `fetch` |

That last row is the one worth insisting on. The disclosure argument rests
entirely on the gallery being inert, and nothing currently prevents a future
fixture from fetching real members to "make the planner more realistic" — the same
instinct that put six real names there in the first place.

## Open questions

| # | Question | Blocking? | Bounded default |
|---|---|---|---|
| **Q1** | Public on production, or only on the dev deployment? | **No** | **Both.** A dev-only gate would need environment-conditional middleware, which is more moving parts in an auth path than the change itself — and the whole point is verifying what production actually renders. |
| **Q2** | Should the gallery be `noindex`? | **No** | **Yes, add it.** Cheap, and there is no reason for a swatch page to appear in search results. |

---

**Terminal state: READY_FOR_ADVERSARIAL_REVIEW.**

Critical tier: **two sequential fresh `APPROVED` verdicts on byte-identical text.**
This document is **not** authorization to implement.
