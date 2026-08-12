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

## This REVERSES a deliberate, tested decision — and that is the whole question

**Child A2 chose gating on purpose and left a tripwire to force this conversation.**
`app/utils/__tests__/themeGallery.test.ts:39` is titled *"theme gallery — it is
GATED, and that is the whole auth story"*, and asserts three things: every gallery
path runs the middleware (`:40-48`); the gallery is **not** placed under `/auth/`,
which the matcher already excludes (`:50-55`); and `routeMatcher.test.ts` contains
no `theme-gallery` string at all (`:57-61`), commented *"If the gallery ever needs
an entry there, the placement is wrong. That entry is the signal, not the fix."*

Ship item 3 trips that last assertion by construction. An earlier draft of this
plan did not mention the file, which meant it was arguing against a recorded
decision without knowing one existed — exactly what CLAUDE.md's ADR rule exists to
prevent.

**What A2's reasoning actually was.** From
[A2's plan](2026-08-08-light-mode-A2-rendering.md): it shipped at **Standard** tier
*because* the route was gated (`:28-35`) — "an unauthenticated route … is a
secret/auth-boundary change on CLAUDE.md's Critical list, and this plan must be
re-tiered" — and gating let it drop four containment mechanisms that "existed only
to contain an unauthenticated route" (`:139-140`): an env flag, a `PUBLIC_ROUTES`
entry, a build-time refusal, and a new env var.

**So A2's reason was cost and tier, not an inherent property of the route.** The
gallery is inert — that was true at A2 and is re-verified below. What has changed
is not the route: it is that a verification agent now exists which cannot enter
credentials, and did not when A2 was written.

**This plan therefore supersedes that decision explicitly rather than deleting its
guard.** The tripwire did its job — it stopped a plausible-looking change long
enough to surface the reasoning. It gets an answer in an ADR, not a `git rm`.

### The alternative A2 named, and why this plan still edits the matcher

A2 recorded that `/auth/theme-gallery/…` needs **no matcher edit at all**, since
`auth(?:/|$)` is already excluded — and asserted the gallery is *not* there
(`themeGallery.test.ts:50-55`).

**That alternative produces the identical exposure.** A route under `/auth/` is
public; the middleware does not run for it. It is the same decision reached by
placement instead of by regex, so it does not avoid the security question — it only
avoids *looking* like it is being asked. A2 saw this too: *"Both placements need no
matcher edit, so 'no matcher edit' justified neither."*

Between two routes to the same exposure, this plan takes the one that is **visible
in the auth boundary**: a named alternation in `MIDDLEWARE_MATCHER`, a
`PUBLIC_ROUTES` entry someone must review, and a Critical-tier record. Hiding a
public route inside the `/auth/` prefix would leave the app's list of anonymous
surfaces less auditable, not more — and `PUBLIC_ROUTES` would still need the entry.

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
| 1b | **`routeMatcher.ts:3-7`'s prose allow-list** — "auth pages, NextAuth API, static assets" — plus a rationale paragraph for the new exclusion, in the style the file already gives `api/cron` (`:18-26`) and the A3 identity route (`:9-16`), pointing at ADR-0017 | `app/utils/routeMatcher.ts` |
| 2b | **`proxy.ts:31-35`'s `config` comment** — "Protect everything except: auth pages, NextAuth API, the cron routes and static assets". **Note its enumeration already omits `api/service-readiness-verification/identity`** — pre-existing drift of exactly the shape this plan corrects in `MOBILE.md:82`, fixed in the same pass | `proxy.ts` |
| 3 | **`"/theme-gallery/sample/sample"`** added to `PUBLIC_ROUTES` — the literal the on-disk walk produces (`[x]` → `sample`), appended last to keep the array's sorted order for the `toEqual` | `app/utils/__tests__/routeMatcher.test.ts` |
| 3b | **A2's three gating assertions rewritten, not deleted** — they become the record that the gate was opened deliberately, pointing at the ADR | `app/utils/__tests__/themeGallery.test.ts:39-61` |
| 3c | **The inertness guard widened, as a numbered deliverable** — the whole disclosure argument rests on it. Today's (`themeGallery.test.ts:130-135`) checks only the three fixture files, only for `useSession\|next-auth\|fetch(`. It must cover `layout.tsx` and `page.tsx` too, and add a Sanity-client check. **Stated limit:** still one level deep — it would not catch a fixture importing a component that fetches | `app/utils/__tests__/themeGallery.test.ts` |
| 4 | An ADR — an auth boundary moved deliberately. **Numbered `0017` exactly**: `adrIndex.test.ts:30` requires consecutive numbering and `:20` fails on a file not linked from the index | `docs/adr/0017-public-theme-gallery.md` **+ `docs/adr/README.md`** |
| 4b | **Parent spec §6 guard 8 (`:235-242`) amended** — it currently reads *"If a child finds itself adding a `PUBLIC_ROUTES` entry for the gallery, the placement is wrong — that entry is the signal, not the fix."* **Left standing, that is a live instruction to revert ship item 3.** Superseded-by pointer to ADR-0017, not deletion | the parent scope spec |
| 4c | **Parent spec §8.4 (`:409-435`) amended** — "The gallery sits on a **gated** path — not under `/auth/`, not public", plus its **five** recorded consequences. The fifth, at `:435`, is *"The VR harness must authenticate. That cost is real and belongs to Child A."* — the single sentence this change most directly reverses, and the original of the `playwright.vr.config.ts` prose item 5 also fixes | the parent scope spec |
| 5 | **The documentation sweep — a rule and a command, not a list.** See below; three drafts of this plan enumerated by hand and three times a reviewer found a member I had missed | as derived |

### Two files the sweep structurally cannot find

`routeMatcher.ts:3-7` and `proxy.ts:31-35` each carry a **prose enumeration of the
public allow-list**, and neither contains the words "gallery", "gated" or
"PUBLIC_ROUTES" — so no keyword sweep built around this change will ever surface
them. They are found by reading the two files the change edits, which is the only
method that works here.

They matter more than their size suggests. `routeMatcher.ts` gives every
non-obvious exclusion its own rationale paragraph — why `api/cron` is excluded, why
the A3 identity route is. Ship items 1 and 2 change only the literal, so
`theme-gallery` would land as **the one exclusion in that file with no recorded
reason**, in the file whose whole job is recording them.

That directly contradicts this plan's own argument for preferring a matcher edit
over an `/auth/` placement — *"visible in the auth boundary… a named alternation
someone must review"*. An alternation nobody explained is not more auditable than a
path prefix; it is just a different way of being unexplained.

## The documentation sweep

Three drafts enumerated this by hand — five statements, then eight — and a reviewer
found more each time. **That is a method failure, not three instance failures**, and
this repo has paid for the same lesson before (see the commits titled *"two
corrections that never reached their originals"* and *"the last two stale twins,
found by sweeping every mention rather than fixing the one a reviewer quoted"*).

So the sweep is a command and a **rule for triaging its output**, and the
implementer re-runs it rather than trusting any list:

```
grep -rn -iE "gallery.{0,80}(gated|not public|no PUBLIC_ROUTES)|gated.{0,60}gallery|PUBLIC_ROUTES entry|stays green.{0,30}unedited|green.{0,20}without being edited|fully gated" app docs e2e playwright*.ts proxy.ts CLAUDE.md AGENTS.md
```

It returns roughly thirty hits across eight files. **The rule that sorts them** —
the same one Children E and F used, applied here without exception:

**AMEND — anything a reader consults to learn how the system works *today*:**

| File | Why |
|---|---|
| `app/utils/__tests__/themeGallery.test.ts` | Executable. **`:12`, `:39`, `:57`** — note `:12`'s header sits *outside* the `:39-61` range, so an implementer working that range literally leaves it stale |
| `docs/superpowers/specs/2026-08-07-light-mode-member-first-scope.md` | **The governing document, and the only spec that gets amended.** `:235-242` (§6 guard 8), `:306`, `:321-323`, `:364`, **`:409-435`** — §8.4 runs to `:435`, not `:424` as an earlier draft said, and has **five** bullets, the fifth being *"The VR harness must authenticate"* — and `:582`, whose guard-traceability row is instruction-shaped |
| `docs/ROUTES.md` | `:6`, **`:12`** (*"enforced at two layers… must be logged in"* — an over-statement once one row is public), `:41` |
| `docs/AUTH_AND_SECURITY.md:116-118` | The canonical auth doc's allow-list |
| `playwright.vr.config.ts:11-20` **and `:36`** | The whole rationale block, not two lines — it argues for a constraint that stops existing. **The `THEME_GALLERY_VR_ENABLED`/`BASE_URL` refusal itself STAYS** — `:36` is a runtime `throw`, not a comment; only its reason changes, so do not delete the guard while rewriting the message |
| `e2e/theme-gallery/README.md:11` | Live |

**LEAVE — dated records of what was decided under the conditions of their day:**
`2026-08-07-light-mode-A-verification-scaffolding.md` (already marked *SUPERSEDED —
do not implement* at `:17`), **`2026-08-08-light-mode-A2-rendering.md`**, and every
review log. An earlier draft had a ship row amending A2's plan; that row is
**removed**, because rewriting a delivered plan falsifies the history. ADR-0017 is
where the supersession is recorded — that is what an ADR is for.

**Named exclusions, so each is a decision rather than a miss:**
`docs/superpowers/specs/2026-07-29-light-mode-role-tokens-design.md:761-807`
describes an `/auth/` placement that never shipped and was superseded before this
plan existed. `docs/MOBILE.md:82` (*"the app is fully gated by `proxy.ts`"*) is
already imprecise — auth pages, cron and the A3 identity route are all public
today — so it is pre-existing drift; **corrected anyway**, since this change makes
it one degree worse and the edit is one line.

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

**The marginal disclosure is smaller than it first appears.** `_next/static` is
*already* excluded from the matcher, so the app's entire client bundle — every
component, every class name, the whole colour system — is world-readable today.
What the gallery adds is a *rendered, browsable* view of it, not the information
itself.

**What it does expose:** the app's visual design and component layouts, assembled
and legible, to anyone with the URL. That is a real disclosure and should be
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
- **`/theme-gallery` and `/theme-gallery/` return 404, not 200.** They become
  anonymously reachable and resolve to no route; with no root `not-found.tsx` the
  built-in 404 serves. Inert, but asserted rather than assumed.
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
| Someone later adds a data-reading fixture | The safety argument is "it reads nothing", which is a property of today's code | **Add a guard**: assert `app/(gallery)` imports no Sanity client, no session helper, and calls no `fetch`. **Stated limit:** it is one level deep and would not catch a fixture importing a component that fetches. Harmless today — every API route stays gated, so a client-side fetch from an anonymous visit gets a 307, not data — but the ADR records the gap rather than letting the guard imply more than it checks |

That last row is the one worth insisting on. The disclosure argument rests
entirely on the gallery being inert, and nothing currently prevents a future
fixture from fetching real members to "make the planner more realistic" — the same
instinct that put six real names there in the first place.

## Open questions

| # | Question | Blocking? | Bounded default |
|---|---|---|---|
| **Q1** | Public on production, or only on the dev deployment? | **No — and the Deployment-Protection unknown genuinely does not gate it.** The judgement is that the disclosure is acceptable *at full public exposure*; the unknown changes only how much the deployed half BUYS, not how much it risks. Two earlier drafts said "confirm before implementing" while labelling the row non-blocking; the check is **post-hoc information**, not a precondition, and the row now says only that | **Both — but the case is weaker than it looks and is stated honestly.** `visual-verifier`'s brief accepts a local dev server, and the matcher change takes effect under `next start` locally, so **the capability lands in full with no deployed exposure at all.** Against that: the deployed surfaces also sit behind Vercel Deployment Protection, which this plan cannot query read-only — **if that covers the dev alias, the production half carries the entire permanent disclosure while the deployed half buys nothing.** Worth knowing afterwards; it changes how much the deployed half BUYS, never how much it RISKS, so it is not a precondition. A dev-only gate is rejected regardless: environment-conditional middleware is more moving parts in an auth path than the change itself. |
| **Q2** | Should the gallery be `noindex`? | **No — ALREADY DONE, do not add a duplicate** | `app/(gallery)/theme-gallery/[theme]/layout.tsx:34-37` already sets `robots: { index: false, follow: false }`. An earlier draft said "yes, add it", which would have produced a second declaration. |

---

**Terminal state: READY_FOR_ADVERSARIAL_REVIEW.**

Critical tier: **two sequential fresh `APPROVED` verdicts on byte-identical text.**
This document is **not** authorization to implement.
