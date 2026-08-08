# Implementation Plan A2: Light mode — the theme gallery and the VR harness

## Original request

> "bring light mode back." — via the approved parent scope spec, whose Child A was split into
> **A1 (measurement)** and **A2 (rendering)** after six review rounds. The finding that forced
> the split is **this plan's first design problem**, addressed in §"Composition" below.

This plan ships a gated route reachable by signed-in team members. It renders colour swatches
and nothing else.

No secrets, credentials or personal data appear here. Colour literals are design values.
Credential *names* appear; no values.

## Status and contract

- **Document status:** Draft — not reviewed, not approved, not authorization to implement.
- **Accepted requirement source:**
  [`2026-08-07-light-mode-member-first-scope.md`](../specs/2026-08-07-light-mode-member-first-scope.md),
  re-approved at digest `3a927bd8b70c3726134a5254e8e8c258a90eb689ba539397d7bcf0196abb1478`.
- **Depends on A1** — [`2026-08-08-light-mode-A1-measurement.md`](2026-08-08-light-mode-A1-measurement.md).
  **A1 is implemented and merged** (`792c72a`, deployed and alias-verified). It supplies
  `.light { color-scheme: light }` in `brand.css`, the generated inventory at
  `app/utils/__tests__/__fixtures__/colour-inventory.json`, and its family/vocabulary analysis
  at `2026-08-08-light-mode-A1-inventory-reconciliation.md`. **Every figure below comes from
  that artifact, not from the parent's hand-counts** — where they disagree, the artifact wins.
- **Supersedes, jointly with A1:** `2026-08-07-light-mode-A-verification-scaffolding.md`.
- **Risk tier: Standard — one fresh cold `APPROVED`.** Derived from the ladder. The gallery is
  a **gated** route: verified against the live matcher, `/theme-gallery/*` is protected by the same
  middleware as `/admin` (though **not** by the same in-handler guard — see Affected
  boundaries), `routeMatcher.test.ts` stays green **without being edited**, and there is no
  env flag, `PUBLIC_ROUTES` entry, `docs/SECRETS.md` entry or build-time refusal. No writer, no
  schema, no migration, no remote release action.
  **One condition re-opens the tier** — see step 5: if VR credentials are provisioned, that is
  a secret/auth-boundary change on CLAUDE.md's Critical list, and this plan must be re-tiered
  and re-reviewed rather than inheriting Standard.
- **Safe ending state:** the app renders identically. One new gated route exists, showing
  swatches in whichever theme its segment names. `forcedTheme="dark"` is untouched, so no
  member's experience changes. `npx tsc --noEmit`, `npm test`, `npx eslint .` all green.

## Evidence and current behavior

Verified across Child A's six review rounds — including two reviewers who built scratch
`next@16.2.12` apps to test the routing claims empirically rather than by reading.

| Evidence | Planning implication |
|---|---|
| **A root layout at a dynamic segment builds and prerenders.** Scratch `next@16.2.12` app with no `app/layout.tsx`: `app/(gallery)/theme-gallery/[theme]/layout.tsx` built, prerendered both segments, and emitted `<html class="dark">` / `<html class="light">`. Mechanism confirmed at `next-root-params-loader.js:129` — the first `layout.*` found is the root layout | The structure is proven, not reasoned |
| **`dynamicParams = false` really 404s** an unlisted segment under `next start` (HTTP 404, complete `<body>`) | Segment validation works as specified |
| **A co-located `not-found.tsx` is inert for a `dynamicParams` miss.** Empirically: the built-in `/_not-found` serves a complete `<body>` in both `next start` and `next dev`; the co-located file's markup never appears; removing it changes nothing. A miss resolves *before* the segment matches | An earlier revision mandated the file on a **false** rationale. Add it only to catch an explicit `notFound()` from inside the page |
| Next 16 passes a layout only the params from the root segment down to **that layout** | The layout must sit at `[theme]`, not above it |
| next-themes 0.4.6 makes a nested `ThemeProvider` a **literal pass-through** (`useContext(L)?Fragment:X`) | `forcedTheme="dark"` cannot be overridden from inside `(client)`; the gallery needs its own root layout with **no provider** |
| `enableColorScheme` defaults true and writes an inline `documentElement.style.colorScheme`, masking `brand.css:2` | A provider-less gallery removes the mask — hence A1's `.light { color-scheme }` |
| `(client)/layout.tsx:64` wraps everything in `<Provider>` and renders `ActivityPing`, which fetches on mount | The gallery must not import `Provider` |
| `(client)/globals.css` carries the `@layer base` font bindings; `(admin)/globals.css` is three bare `@tailwind` lines | Import the **`(client)`** one or every baseline renders at fallback metrics |
| `app/brandFonts.ts` exports `displayFont`/`bodyFont`/`labelFont` — not a `brandFonts` object | The layout applies the three `.variable` classes, as both real root layouts do |
| `/theme-gallery/{dark,light,sample}` are **gated** by the live matcher; `/auth/theme-gallery/dark` is not | Both placements need no matcher edit, so "no matcher edit" justifies neither. Gating is the deliberate choice |
| `routeMatcher.test.ts:12–27` walks `app/` mapping `[x]`→`sample`, matching only `page`/`route` files | A gated route never enters `ungated`; `layout.tsx`/`not-found.tsx` are invisible to the walk |
| `CueDialogProvider.tsx` references no `useSession`, no `fetch`, nothing from `next-auth`; `CueDialog.tsx` imports only React, `createPortal`, `focusTrap` and the provider | Both mountable standalone — no `SessionProvider`, no `PlayerProvider` |
| `PlannerGrid.tsx` has **zero** `fetch`/`useSession`/`next-auth`; its test renders it with no providers | It is hostable — the "stateful admin panel" exclusion does not apply to it |
| **`fullScreen` is not a prop.** `PlannerGridProps` (`:163`) does not declare it; it is `useState(false)` at `:553`, entered only via the toggle at `:1823`. The repo's tests click `/Pantalla completa/` | A static render never reaches `createPortal(surface, document.body)` at `:2008` |
| `PlannerGridProps` requires seven function props (`preflightFor`, `createBlockFor`, `canReceive`, `onCellsChange`, `onRowsChange`, `onToggleSkip`, `onAuto`) | The fixture host must be a `"use client"` component; a server component cannot pass them |
| `playwright.config.ts:33` throws via `requireHarnessConfig` without the verification identity, and has no `webServer` | A read-only VR config cannot reuse it |
| `eslint.config.mjs:42` disables `react-hooks/rules-of-hooks` only for `files: ["e2e/**"]` | A Playwright spec outside `e2e/**` fails `npx eslint .` |
| 16 `SR_VERIFY_*` variables exist repo-wide; **zero** appear in `docs/SECRETS.md` | There is no entry to copy for a VR login |
| `docs/ROUTES.md:3` says "two route groups"; `:25` says "No nested sub-tree layouts"; `:34`'s header has an **Access** column and no "Public" column | Prose and row both change |
| ADRs run 0001–0013 | 0014 and 0015 are the next consecutive numbers `adrIndex.test.ts` accepts |

## The composition problem, and its resolution

**This is why Child A was split, and it is settled here rather than discovered later.**

An earlier revision put the swatch inventory, an open `CueDialog` and a full-screen
`PlannerGrid` on **one page per theme**. Verified, they destroy each other:

- `PlannerGrid.tsx:1769` is `fixed inset-0 z-50 … bg-[#010b17]` — an **opaque, full-viewport**
  overlay portalled to `document.body`. Entering full screen covers every swatch.
- It also sets `document.body.style.overflow = "hidden"` and `inert` on body children, so the
  swatch tree is inert and a `fullPage` capture degrades to one viewport.
- `CueDialog.tsx:235` is `fixed inset-0 z-[90]` with `:244` `bg-black/68 backdrop-blur-md` —
  above the planner's `z-50`, painting a blurred sheet over it.
- `CueDialogProvider.tsx:86–89` sets `root.inert = true` on the wrapper containing `children`,
  which holds the "⛶ Pantalla completa" button — so with a dialog open, a Playwright harness
  cannot click it (actionability fails on an `inert` element).

**Resolution: one fixture per route, not one page per theme.**

Route shape: `app/(gallery)/theme-gallery/[theme]/[fixture]/page.tsx`, with the root layout
staying at `[theme]/layout.tsx` (it needs only `theme`, and a layout receives params from the
root down to itself).

`generateStaticParams` enumerates the cross-product — `{dark,light} × {swatches, dialog,
planner}` — with `dynamicParams = false` on **both** segments' behalf, so any other value 404s.

| Fixture | Renders | Why it is alone |
|---|---|---|
| `swatches` | The **15** `.brand-*` classes that carry colour (of 17 total, across 33 selector occurrences — generated), a `prose` block, stateless presentational components — **name them in the fixture, do not leave the set to the implementer**; start from `SectionNav`, `TextSizeControl` and `ui/CueDialogStatus`, none of which read a session or fetch — and (from Child B) token swatches | Nothing portals over it, nothing inerts it, and the page can scroll for a `fullPage` capture |
| `dialog` | One open `CueDialog` | Its `z-[90]` backdrop is the intended subject, not an occluder |
| `planner` | `PlannerGrid` with full screen **activated** | Its opaque `z-50` overlay is the intended subject; no dialog exists to inert the toggle |

**Full-screen activation, stated rather than assumed.** The `planner` fixture is a
`"use client"` host that renders `PlannerGrid` from a static props fixture modelled on the
tests' `baseProps()` and **activates the toggle on mount** — the same interaction
`participationAlongside.test.tsx:660` performs. **`PlannerGrid.tsx` is not modified**; adding a
`fullScreen` prop would be a production-component change outside this plan's boundary.

**The assertions must discriminate, not merely detect.** "A portal node exists under
`document.body`" passes in every broken arrangement above. Instead assert that **the intended
subject is the topmost painted body child** for its fixture, and that the swatch surface is
**unobscured** in the `swatches` baseline.

**Route-walk consequence, confirmed rather than assumed:** the walk maps each dynamic segment
to `sample`, so the enumerated route is `/theme-gallery/sample/sample` — gated, therefore never
in `ungated`, therefore `routeMatcher.test.ts` still needs no edit. **Re-confirm this after the
route exists**; it is one assertion and it is the whole auth story.

## Scope

### In scope

- The `(gallery)` route group, its root layout at `[theme]`, the `[fixture]` segment, and the
  three fixture pages.
- Fixture hosting for `CueDialog` and for `PlannerGrid` in full screen.
- A second, **read-only** Playwright config, its `testDir` under `e2e/`, and the credential
  question.
- The `redesign/explore` / `7af69d8` polarity review.
- The AA gate's three inputs: the surface-nesting map, the dark composited failing set, and the
  recorded conservative backdrop assumption.
- ADR-0014 (two Playwright configs) and ADR-0015 (a root layout at a dynamic segment).
- `docs/ROUTES.md` prose **and** row; `docs/UTILITIES_AND_COMPONENTS.md`.

### Non-goals

- **No inventory categories, no vocabulary, no `brand.css` guards, no `.light` branch.** All
  A1. **One exception, and it is a deliberate edit to an A1 deliverable** — see step 0.
- **No token layer, no migrations, no lint rule.** Children B and C.
- **No `.light` colour values.** Child D — so the `light` segment renders correctly-structured
  but *unstyled-for-light* output until then, which is expected and stated.
- **No env flag, no `PUBLIC_ROUTES` entry, no build-time refusal, no new env var for the
  gallery.** All four existed only to contain an unauthenticated route.

### Preserved invariants

All 19 parent invariants. The four this plan can plausibly break:

- **#1 done-gate** — 0 eslint errors, `npm test` green.
- **#8 `routeMatcher.test.ts`** — must stay green **without being edited**. If the gallery ever
  appears in `ungated`, the placement is wrong; that entry is the signal, not the fix.
- **#3 secrets documentation** — step 5 may introduce or reuse VR credentials. Any variable gets
  a `docs/SECRETS.md` entry in the same change.
- **#17 ISR** — the gallery has its own root layout and reads no session, cookie or header.

## Affected boundaries

| Component | Current responsibility | Planned responsibility |
|---|---|---|
| `app/(gallery)/theme-gallery/[theme]/layout.tsx` *(new)* | — | Root layout: `<html class={theme}>`, the three font `.variable` classes, `(client)/globals.css` + `brand.css`, **`brand-atmosphere …` on `<body>`**, **no provider** |
| `app/(gallery)/theme-gallery/[theme]/[fixture]/page.tsx` *(new)* | — | Dispatches to one of three fixtures; `generateStaticParams` + `dynamicParams = false` |
| Gallery fixture components *(new, `"use client"`)* | — | Static props fixtures; the planner host activates full screen on mount |
| `app/utils/__tests__/routeMatcher.test.ts` | Asserts the public-route set | **Unchanged.** The route is gated, so it never enters `ungated` |
| `playwright.vr.config.ts` *(new)* + `e2e/theme-gallery/` *(new)* | — | Read-only VR config that starts nothing capable of writing |
| `docs/ROUTES.md`, `docs/adr/`, `docs/UTILITIES_AND_COMPONENTS.md`, `docs/SECRETS.md` | Current records | Route prose + row; ADR-0014, ADR-0015; new components; any VR credential |
| `docs/superpowers/specs/2026-08-07-light-mode-member-first-scope.md` | Approved parent | **Modified** — the "17 light counterparts" claim in §5, §8, §9 **and** §12 corrected to the generated 15, disclosed post-approval. `:473–474`'s "17, not 16" is a different, correct claim and is left alone |

**Trust boundary: unchanged.** The gallery sits on a gated path. It renders presentational
components only, reads no session itself, performs no fetch and accepts exactly two `[theme]`
and three `[fixture]` values.

**It is not quite at the trust level of `/me` or `/admin`, and this plan does not claim it is.**
A *refreshed* token is turned away — `proxy.ts:10–12` redirects any token without `sanityId`,
and `auth.ts:247` returns `{...token, sanityId: undefined, role: undefined}` for an inactive
member. The residual is a **stale cookie**: `withAuth` reads the JWT via `getToken` without
running the `jwt` callback, and the provider-less layout mounts no `SessionProvider`, so
visiting triggers no refresh and a deactivation can be outlived there. Exposure is nil — colour
swatches — but the gallery runs no in-handler guard, which `/me` and `/admin` do.

## Ordered changes

### 0. Exclude the gallery from the colour inventory — BEFORE the route exists · **LANDED at `bb1270d`**

**This is a done-gate blocker, not housekeeping.** `scripts/colour-inventory.mjs` walks all of
`app/**` (`inGlob` excludes only `__tests__`), and `colourInventory.test.ts` deep-equals both
the summary block and the compositing array against the committed artifact. **Verified by
adding a stub `layout.tsx` + `page.tsx` under `app/(gallery)/`: two assertions fail
immediately** — `filesScanned` rises, and every `brand-*` class the fixtures name adds a
`className` row. The `swatches` fixture must name 15 `.brand-*` classes to render them, so the
divergence is unavoidable, not incidental.

**Decision: add `app/(gallery)` to the inventory's exclusion, with the rationale recorded in
the script.** The alternative — regenerate and re-commit the artifact — was considered and
rejected: it would fold the gallery's own colour usage into the surface Children B and C
migrate, and a Child B that tokenised the swatch fixtures would leave them demonstrating
nothing. **The gallery is a verification surface, not product colour.**

- **Change:** `scripts/colour-inventory.mjs`'s `inGlob` excludes `app/(gallery)`; the reason is
  a comment in the script, not just here. Add a test asserting the exclusion holds, so a later
  widening of the glob cannot silently pull the gallery in.
- **Consequence to state plainly:** the gallery's colour is then **unmeasured**, so a fixture
  must not become a place where product colour hides. Fixtures render tokens and existing
  components; they do not introduce new literals.
- **Verification:** with the route group present, `npx vitest run` is green — the assertion this
  step exists to satisfy, and verified both ways before and after the exclusion.
  **The exclusion guard is vacuous until fixtures exist.** It asserts the *absence* of
  `(gallery)` rows, which passes trivially today; it only becomes a real guard once fixtures
  carrying `brand-*` classes land. Do not read today's green as proof.
- **A second app-wide walk exists and is deliberately NOT excluded.** `brandCss.test.ts` also
  walks `app/`, but it is a *positive* guard — every colour `var()` referenced must be declared
  — so a gallery file can only fail it by referencing an undeclared token, which is exactly the
  outcome we want.

### 1. The route group, root layout and fixture segment

- **Route:** `app/(gallery)/theme-gallery/[theme]/[fixture]/page.tsx` with `layout.tsx` at
  `[theme]`. A layout with no `layout.js` above it *is* a root layout; there is no
  `app/layout.tsx`, and `(admin)`/`(client)` are already sibling root layouts.
- **The layout must:** apply `className={theme}` to `<html>` from the route param — no provider,
  no storage; apply `${displayFont.variable} ${bodyFont.variable} ${labelFont.variable}`; import
  `app/(client)/globals.css` **specifically** and `app/brand.css`; and **not** import
  `app/utils/Provider`.
- **`<body>` carries `brand-atmosphere font-body min-h-screen bg-brand-blackout text-brand-frost`**
  — the same set both real root layouts carry (`(client)/layout.tsx:56–63`,
  `(admin)/layout.tsx:41–43`), minus `selection:bg-brand-beam/35`, which is a text-selection
  affordance no baseline exercises. **This decides whether the baselines are valid at all, and
  it is not cosmetic:**
  - `.brand-atmosphere` (`brand.css:30–40`) is the opaque page wash — `background-color:
    rgb(var(--brand-blackout))` plus six gradient layers. Without it on `<body>`, the fixtures
    paint over the bare UA canvas.
  - **14 of the 15 colour-carrying `.brand-*` classes are alpha-composited over whatever sits
    behind them** — `.brand-surface` (`brand.css:124–134`) is a `linear-gradient` at 0.68/0.82/
    0.76 over `rgb(var(--brand-console) / 0.72)`, and `brand.css` carries **65**
    `rgb(var(--brand-*) / α)` occurrences (measured with the repo's own `stripComments`; an
    earlier revision said 59, which matched nothing under any reading — a hand-count in a plan
    whose contract is that generated output wins). On the wrong backdrop every one of those baselines
    is wrong in a way a reviewer cannot see.
  - **Step 4's AA input depends on it.** The "recorded conservative backdrop assumption — the
    lightest rendered `brand-atmosphere` point in dark" is **not observable** in a gallery whose
    body does not render `brand-atmosphere`.
  This plan already applies exactly this reasoning to fonts ("absent them, every baseline
  renders at fallback metrics and Child D's review is invalid"). The backdrop deserves the same
  treatment, in the one place that decides it.
- **Segment validation:** `generateStaticParams` enumerating theme × fixture, plus
  `export const dynamicParams = false`. `generateStaticParams` alone does not 404 —
  `dynamicParams` defaults to `true`. Verified empirically: with it set, `next start` returns
  404 for an unlisted segment.
- **`not-found.tsx` is optional.** Add it only to catch an explicit `notFound()` from inside a
  page, and say so — the earlier rationale (a 404 rendering with no `<html>`) was **disproved**.
- **Verification:** `routeMatcher.test.ts` green **unedited**; `<html>` carries the theme class
  for both segments; the three font `.variable` classes are present (absent them, every baseline
  renders at fallback metrics and Child D's review is invalid).
- **State after:** both themes renderable for a signed-in member, in dev, Preview and production.

### 2. The three fixtures

- **`swatches`** — the **15 colour-carrying** `.brand-*` classes, a `prose` block
  (Child B removes `dark:prose-invert`, so this is where that lands), and stateless components.
  **Token swatches arrive with Child B** and **light values with Child D**; A2 baselines only
  what exists. **TWO classes are excluded and recorded as unexercisable, not one** — A1's
  generated inventory dispositions both `exempt` because neither carries colour in any rule
  body: `.brand-admin-frame` (`brand.css:322–326`, inside `@media (min-width: 1280px)` opening at
  `:310` — `max-width` and two paddings) and `.brand-admin-workspace` (`:346–348` —
  `min-width: 0`). *(A1's merge added 14 lines above these; any citation of `:308`/`:296`/`:332` is pre-A1 and
  stale. The parent's own copy was corrected at `bb1270d`.)*. A swatch of either baselines nothing theme-relevant.
  **The parent said 17 in FOUR places — §5 (`:173`), §8 (`:298`), §9 (`:466`) and §12
  (`:587`) — and all four are now corrected (landed at `bb1270d`)** — and correcting only three would leave §9 asserting the superseded figure in the
  section Child D is most likely to read. All four are corrected by this plan.
  **Leave `:473–474` alone:** "the class count is 17, not 16" is a different and correct claim
  about the total, not about light counterparts.
- **`dialog`** — one open `CueDialog`, mounting `CueDialogProvider` directly. Verified
  standalone-safe: no `useSession`, no `fetch`, nothing from `next-auth`.
- **`planner`** — `PlannerGrid` from a static props fixture, full screen activated on mount.
  **Stateful panels stay excluded** — `AdminPanel.tsx:416` calls `useSession()` and
  `ProposalEditor.tsx:262` fetches — but the exclusion is by **dependency**, not by the word
  "admin".
- **Honest coverage:** these fixtures exercise the token layer, `brand.css` compositing and both
  portal paths — **not** the bulk of the 1,264 bracketed-hex rows (artifact). That is exactly why Child B's primary
  gate is equality by construction and not screenshots.
- **Verification, and where it can actually run.** For each fixture the intended subject must
  be the **topmost painted body child**, and for `swatches` the surface must be **unobscured**.
  A bare "a portal node exists" assertion is explicitly insufficient — it passes in every
  broken arrangement.
  **These three assertions need real layout and paint, which means a real browser.** jsdom
  cannot substitute: it performs no layout, so it can only produce the DOM-order check this
  plan rejects. The gallery is gated, so a browser needs a session.
  - **If the VR harness ships** (step 5), the three assertions live in it.
  - **Under this plan's recommended default — VR deferred** — they are a **recorded manual
    verification**: a headed run against `next start` with the developer's own session,
    capturing one screenshot per fixture per theme plus a written check of each assertion,
    committed beside the plan. That is weaker than an automated gate and is stated as such.
  - **They are never silently skipped.** If neither path is taken, the stop condition below
    fires and the fixtures do not ship.
- **Stop condition:** if the planner's toggle cannot be activated, **stop**. Child D's acceptance
  depends on it, and silently baselining the collapsed grid is worse than no baseline.

### 3. `redesign/explore` / `7af69d8` polarity review

- **Purpose:** the parent's D4 (dark in `:root`, light under `.light`) is baked in by Child B and
  cannot be cheaply revisited. `redesign/explore` carries a **working two-theme token system**
  (the Cantoral variant, ADR-0009). This harvests its mechanics; it is not history to skip.
- **Change:** read that branch's `app/(client)/globals.css`, `ThemeToggle.tsx`,
  `REDESIGN_PROPOSAL.md`, and the commits fixing *"theme flash"* (`7af69d8`) and *"floating
  surfaces now flip with theme"* (`392c47a`). Record what is and is not harvestable. Closes the
  gap ADR-0009 filed.
- **Stop condition:** if it **contradicts D4**, stop — that is a parent-level change. Propagate
  and treat the parent's approval as stale.

### 4. The AA gate's inputs

- **Purpose:** the parent's D9 makes WCAG AA a ship gate, and nothing else produces its inputs.
  Two v23 revisions claimed these were "derived in Phase 0" without putting them in any
  checklist. **A ship gate whose inputs live in no plan is the gate that gets waived.**
- **Change:** the **surface-nesting map** (hand-authored, reviewed — the only producer of
  cross-component pairs); the **dark composited failing set**, derived from that map plus A1's
  inventory of same-element pairs — **which A1 now emits as a first-class `pairs` output, with
  `alphaDiffers` per pair (88 of 100 pairs differ in alpha)** — and **re-derived at every Child
  C family merge**, since C
  changes 946 rows dispositioned `C` (artifact), does not promise byte-identity, and its per-family diff gate is
  contrast-blind; and the **recorded conservative backdrop assumption** — the lightest rendered
  `brand-atmosphere` point in dark. Conservative is load-bearing: unconstrained, an implementer
  picks a favourable backdrop and satisfies the gate while shipping a real failure.
- **Verification:** committed artifacts, cited by Child C's re-derivation and Child D's matrix.

### 5. The read-only VR config, and the credential question

- **Purpose:** VR baselines. `playwright.config.ts` cannot be reused — it **throws** without the
  verification identity and has no `webServer` by design.
- **Change:** `playwright.vr.config.ts`, read-only, `testDir` **under `e2e/`**, with specs named `*.spec.ts` — **not** `*.test.ts`, which
  `vitest.config.ts:15` would sweep into `npm test`. Placement also decides a lint outcome: `rules-of-hooks` is an error under `next/core-web-vitals` and disabled only for
  `files: ["e2e/**"]`, so a `use` fixture elsewhere fails `npx eslint .` the day it lands. It must
  not reach the production Sanity dataset or start anything that writes.
- **Credentials are the real cost, and they carry two obligations.** The signin page is a genuine
  email/password form (`(client)/auth/signin/page.tsx:107,117`), so headless login needs a member
  identity. The existing harness uses `SR_VERIFY_MEMBER_EMAIL`/`SR_VERIFY_MEMBER_PASSWORD` behind
  `requireHarnessConfig`, which a read-only config cannot inherit — so expect to write a second,
  read-only login path and keep it incapable of writing. **None of the 16 `SR_VERIFY_*` variables
  is documented in `docs/SECRETS.md`**, so there is no entry to copy.
  1. **Any variable introduced or reused gets a `docs/SECRETS.md` entry in the same commit** —
     name, every platform that needs it and every one that does not, where the value came from,
     rotation steps, and blast radius mid-rotation. **Never the value.**
  2. **Provisioning a real member identity re-opens the tier.** That is a secret/auth-boundary
     change on CLAUDE.md's Critical list, and Preview writes to the production Sanity dataset.
     **Re-tier and re-review rather than inheriting Standard.**
- **Bounded default:** if credential provisioning is not settled, **take Child D's baselines
  manually**, record it, and leave VR automation to a follow-on. Do not invent credentials to
  unblock a screenshot.
- **ADRs, same commit:** `0014-two-playwright-configs.md` and `0015-gallery-root-layout.md` — the
  latter for the root layout at a dynamic segment, textbook CLAUDE.md decision-record material
  ("looks like a bug but isn't"): it is the only arrangement that receives the `[theme]` param
  *and* escapes `forcedTheme`. Both must be linked from `docs/adr/README.md`, match
  `/^# ADR-\d{4}: .+/`, carry a `**Date:** … **Status:**` line, and number consecutively — or
  `adrIndex.test.ts` fails.

## Data and failure safety

- **Identity and source of truth:** none. The gallery renders static fixtures.
- **Migration:** none. No Sanity access, no Studio deploy, no data read or written.
- **Partial failure:** each fixture is independently revertible; the route group can be deleted
  outright.
- **Rollback:** `git revert`. No data moved, no remote state changed.

## Verification

| Requirement | Test or check | Failure it detects |
|---|---|---|
| Gallery is **gated** | `routeMatcher.test.ts` green with **no edit**; the route never appears in `ungated` | A placement mistake that silently makes it public |
| Invalid segment 404s | A served-route check in the VR config, **or a local `next start` check** if VR is deferred | Arbitrary input reflected into a root attribute. A `curl` against Preview proves nothing — SSO answers first with a 302 |
| Theme class is applied | Assert `<html class>` for both segments | The false-confidence trap: a surviving `dark:` variant rendering its light-intended base |
| Fonts are real | Assert the three `.variable` classes on `<html>` | Every baseline at fallback metrics, invalidating Child D's review |
| Backdrop is real | Assert `brand-atmosphere` is on `<body>` in **both** segments | 14 alpha-composited `.brand-*` baselines painted over the bare UA canvas, and step 4's AA backdrop input unobservable |
| `swatches` is unobscured | Assert no fixed full-viewport body child overlays it | The occlusion class that split Child A |
| `dialog` subject is on top | Assert the dialog layer is the topmost painted body child | A baseline of the page behind the dialog |
| `planner` genuinely entered full screen | Assert the planner overlay is the topmost painted body child — **not merely that a portal node exists** | The silent failure where D baselines the collapsed grid |
| VR config cannot write | It starts nothing with write capability; the existing harness still refuses as before | Loosening the write-safety harness to make VR convenient |
| Secrets documented | Any new variable has a `docs/SECRETS.md` entry in the same commit | Parent invariant 3 |
| Done-gate | `npx tsc --noEmit`, `npm test`, `npx eslint .` = 0 errors | Regression against A1's post-merge baseline |

## Rollout, observability, and rollback

- **Release sequence:** branch `feat/light-mode-a2-gallery` **after A1 merges**; steps in order;
  merge to `main` on a green done-gate; direct push, no PR.
- **Deploy verification:** confirm the **alias moved** to a deployment built from the pushed
  commit. HTTP checks prove nothing (SSO returns 302).
- **Signals proving success:** `/theme-gallery/dark/swatches`, `/dark/dialog`, `/dark/planner`
  and their `light` counterparts all render for a signed-in member; `/theme-gallery/EVIL/x`
  404s; test count rises.
- **Stop conditions:** the planner toggle cannot be activated; the polarity review contradicts
  D4; or credential provisioning would re-tier the plan and has not been re-reviewed.
- **Rollback:** delete the route group and revert. Nothing user-facing depends on it.

## Decisions

| Decision | Choice | Why | Tradeoffs | Owner |
|---|---|---|---|---|
| One fixture per route | `[theme]/[fixture]` | The three subjects occlude and inert each other on a shared page — measured | Three baselines per theme instead of one | A2 |
| Gallery is **gated** | Not `/auth/`, not public | "No matcher edit" was true of both and justified neither; gating deletes the flag, the SECRETS entry, the build refusal and the `PUBLIC_ROUTES` entry | Local dev and VR need a session | user, 2026-08-07 |
| Full screen entered by **activation** | Not a new prop | `fullScreen` is `useState`, and adding a prop is a production change outside this boundary | The activation can silently fail — hence the topmost-child assertion | A2 |
| `not-found.tsx` optional | Not mandatory | Its earlier rationale was empirically disproved | — | A2 |
| VR `testDir` under `e2e/` | Not repo root | `rules-of-hooks` is disabled only there | — | A2 |

## Assumptions

| Assumption | Impact if false | Validation point | Failure response |
|---|---|---|---|
| A second dynamic segment under `[theme]` keeps the root layout valid | The route shape collapses | Step 1 — the layout needs only `theme`, and params flow root-downward | Flatten to three sibling routes under `[theme]` (`/swatches`, `/dialog`, `/planner`), all still gated |
| `PlannerGrid` renders acceptably from a synthetic props fixture | The planner baseline is unrepresentative | Step 2, against the tests' `baseProps()` | Record what the fixture cannot represent, so Child D does not over-read the baseline |
| Activating the toggle on mount is reliable in a headless run | D baselines a collapsed grid | Step 2's topmost-child assertion | **If VR ships**, the assertion fails the build. **Under the recommended VR-deferred default there is no build to fail** — it is a recorded manual check, which is weaker, and the stop condition is what prevents the fixtures shipping unverified |
| A read-only VR config can authenticate without new credentials | Step 5 re-tiers the plan | Step 5 | Take baselines manually and defer VR automation |

## Open questions

| Question | Why it matters | Recommendation | Owner | Blocking? | Bounded default |
|---|---|---|---|---|---|
| Whether VR automation is worth provisioning credentials for | It re-tiers this plan to Critical | Defer. Child D needs *correct baselines*, not *automated* ones, and manual capture of six routes is cheap next to a secret-boundary review | A2 | **No** | Manual baselines; VR automation as a follow-on |
| Whether the `swatches` fixture should paginate | A 2,649-row inventory (artifact) is unreviewable as one image | Group by role and capture per group once Child B's tokens exist; A2 baselines the **15 colour-carrying classes**; the 33 figure counts selector *occurrences* across all 17 and includes pseudo-element and state selectors a static capture cannot reach and a `prose` block | A2 | **No** | As recommended |

**No blocking open questions.**

## Handoff

- **Prerequisites consumed from A1:** `.light { color-scheme: light }`, the token vocabulary and
  its stated storage convention, **and the inventory's same-element pair relation**, which step 4
  derives the dark composited failing set from. A1's Handoff promises all four.
- **Outputs promised:** **Child B** gets a swatch surface for its token layer and the `prose`
  fixture for its typography change. **Child C** re-derives the composited failing set at every
  family merge. **Child D** gets three fixtures per theme, the VR harness (or the recorded manual
  fallback), and the AA gate's three inputs.
- **Adversarial review order:** A1 first, then this plan (**Standard** — one fresh cold
  `APPROVED`), then Child B.
- **Implementation authorization: not granted by this plan.**

## Terminal state

**`READY_FOR_ADVERSARIAL_REVIEW`**

Self-contained, with no unresolved blocking unknowns. **Review readiness is not approval, and
plan approval is not authorization to implement.**
