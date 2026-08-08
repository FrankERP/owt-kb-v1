# Implementation Plan A: Light mode — verification scaffolding

## Original request

> "Rewrite the light-mode re-activation plan into correctly scoped plan(s), then go for the
> adversarial review." — and, from the session that produced v23: **"bring light mode back."**

This plan is **Child A** of the approved parent scope spec. It ships **no user-visible
change**. It builds the instruments that every later child's correctness claim depends on.

No secrets, credentials or personal data appear in this plan. Colour literals are design
values, not secrets.

## Status and contract

- **Document status:** Draft — not reviewed, not approved, not authorization to implement.
- **Accepted requirement source:**
  [`2026-08-07-light-mode-member-first-scope.md`](../specs/2026-08-07-light-mode-member-first-scope.md),
  approved at digest `4fbc41c4c1bed034b16547d343c24948a9ac639ecd0c4282460e7f25193a8140`.
- **Risk tier: Standard — one fresh cold `APPROVED`.** Derived from the ladder: this plan
  changes no writer, no trust boundary, no schema, no concurrency protocol and no remote
  release action. It reads files and adds tests.
  **This was Critical until 2026-08-07.** An earlier revision placed the theme gallery on an
  **unauthenticated** path under `/auth/`, which changed the trust boundary
  `routeMatcher.test.ts:52` exists to gate and dragged in an env flag, a `docs/SECRETS.md`
  entry, a build-time refusal, and a prerender-versus-runtime argument that did not survive
  review. **The gallery is now a normally gated route** (§5), which deletes that entire
  surface. The user took that decision on 2026-08-07 after review showed the public
  placement bought only local-`next dev` convenience — Vercel Deployment Protection already
  forces SSO on Preview.
- **Primary outcome:** the repository can *measure* its colour surface, *guard* the token
  file, and *render both themes* — none of which it can do today.
- **Preconditions:** parent approved (met). No child before this one.
- **Safe ending state:** the app is dark-only and visually identical to `main`. The only new
  surface is a gallery route gated by the same middleware as every other route, reachable by
  a signed-in team member and showing colour swatches. `npx tsc --noEmit`, `npm test` and
  `npx eslint .` all green.

## Evidence and current behavior

| Evidence | Source | Planning implication |
|---|---|---|
| No colour inventory exists; every count in v23 and the parent is a hand-count | v23 §1.0; parent A1 | Step 1 is the first deliverable and everything else is written against its output |
| `app/brand.css` sits outside every gate — `npx eslint app/brand.css` → 0 errors, no CSS processor in `eslint.config.mjs`, `tsc`/vitest blind to CSS | verified | Step 4's vitest guard is the *only* possible enforcement |
| An undeclared `var()` is invalid at computed-value time and the declaration is **dropped** | CSS spec; v23 §4 | The `brand.css` failure mode is silent — the body wash simply vanishes |
| `vitest.config.ts:15` includes only `app/**`, `scripts/**`, `e2e/**` | verified | A guard outside those roots never runs — a silent no-op, not a failure |
| `routeMatcher.test.ts:52` asserts `expect(ungated).toEqual(PUBLIC_ROUTES)` over an on-disk walk of `app/`; the walk maps `[x]` → `sample` and matches only `page`/`route` files | verified, `:1–52` | A new public route breaks `npm test` the moment it exists. `toEqual` on a **sorted** walk means position matters |
| `proxy.ts:45` excludes `auth(?:/|$)`. Verified by evaluating the live matcher: `/theme-gallery/dark` **is gated**, `/auth/theme-gallery/dark` is not | verified | Both placements need **no** matcher edit, so "no matcher edit" justifies neither. The gallery takes the **gated** path (§5) |
| next-themes 0.4.6 makes a nested `ThemeProvider` a literal pass-through (`useContext(L)?Fragment:X`) | verified in `dist/` | `forcedTheme="dark"` cannot be overridden from inside `(client)`; the gallery needs its own root layout with **no provider** |
| `brand.css:2` is `:root { color-scheme: dark }` with no light branch; next-themes' `enableColorScheme` normally masks it with an inline style | verified | A provider-less gallery removes that mask, so `.light { color-scheme: light }` is needed *here*, not later |
| `app/(client)/globals.css` carries `@layer base` font bindings; `app/(admin)/globals.css` is bare `@tailwind` directives | verified | The gallery must import the **`(client)`** one or every VR baseline renders at fallback metrics |
| `app/brandFonts.ts` exports `displayFont`, `bodyFont`, `labelFont` (not a `brandFonts` object) | verified | The layout applies `${displayFont.variable} ${bodyFont.variable} ${labelFont.variable}` |
| `playwright.config.ts` is a write-safety harness that **throws** without project `scbxomq9`, dataset `service-readiness-verification`, `ALLOW_SERVICE_READINESS_E2E_WRITES=true`, a non-prod URL and a bypass secret | verified, `:1–35` | A read-only VR config cannot live in it. Step 6 adds a second config and an ADR |
| `.github/workflows/` holds two cron files, neither with a `push`/`pull_request` trigger | verified | No CI to lean on; guards ride the `npm test` done-gate |
| Baseline: 142 test files, 3,275 tests passing | `npx vitest run` | Any regression is attributable |

## Scope

### In scope

- The colour inventory script, its committed snapshot, and the vitest sync guard.
- The palette-family shade analysis and the **reviewed token vocabulary** (parent §8.1).
- `.light { color-scheme: light }` in `app/brand.css`.
- The `brand.css` **reference-integrity** guard (active) and the **theme-parity** guard
  (authored dormant, self-activating in Child D).
- The theme gallery: route group, its own root layout, page — on a **gated** path. No env
  gate, no `PUBLIC_ROUTES` entry, no build-time refusal, no new env var.
- `docs/ROUTES.md` (prose **and** row) and two ADRs.
- A second, read-only Playwright config and the ADR explaining why two exist.
- The `redesign/explore` / `7af69d8` polarity review, recorded as a finding.
- The surface-nesting map and the dark composited failing set (inputs to the AA gate).

### Non-goals

- **No token layer.** `tailwind.config.ts` colour config is Child B.
- **No `.light` colour values.** Child D. `.light` here holds only `color-scheme`.
- **No file migrations.** Not one `className` changes.
- **No lint rule.** Its first clauses land with Child B.
- **No `themePref`, no `/me` control, no `forcedTheme` removal.** Child E.

### Preserved invariants

All 17 parent invariants. The four this plan can plausibly break:

- **#1 done-gate** — 0 eslint errors, and `npm test` green. Two failure modes below are
  specifically about this plan failing its own gate.
- **#8 `routeMatcher.test.ts`** — the guard must stay green **without being edited**. If the
  new route ever shows up in `ungated`, something is wrong with the placement, not with the
  guard.
- **#16 whole-app** — nothing here ships a partial surface.
- **#17 ISR** — nothing here may add a session, cookie or header read to a shared layout.
  The gallery has its own root layout and reads none.

## Affected boundaries

| Component | Current responsibility | Planned responsibility |
|---|---|---|
| `scripts/colour-inventory.mjs` *(new)* | — | Emits the complete colour inventory as stable JSON |
| `app/utils/__tests__/colourInventory.test.ts` *(new)* | — | Fails when a live scan diverges from the committed snapshot |
| `app/utils/__tests__/brandCss.test.ts` *(new)* | — | Parses `brand.css`; reference integrity now, theme parity from Child D |
| `app/brand.css` | Dark-only tokens + 17 compositing classes | Gains a `.light { color-scheme: light }` block. **No other change** |
| `app/(gallery)/theme-gallery/[theme]/layout.tsx` *(new)* | — | Root layout: emits `<html class={theme}>`, fonts, `brand.css`, `(client)/globals.css`, **no provider** |
| `app/(gallery)/theme-gallery/[theme]/page.tsx` *(new)* | — | Renders the gallery inventory |
| `app/(gallery)/theme-gallery/[theme]/not-found.tsx` *(new)* | — | 404 boundary co-located at the root layout |
| `app/utils/__tests__/routeMatcher.test.ts` | Asserts the public-route set | **Unchanged.** The new route is gated, so it never enters `ungated` and `PUBLIC_ROUTES` needs no entry — the guard passes by construction |
| `playwright.vr.config.ts` *(new)* | — | Read-only VR config; starts no server that can write |
| `docs/ROUTES.md`, `docs/adr/` | Current records | Route prose + row; ADR-0014 (two Playwright configs) and ADR-0015 (a third root layout at a dynamic segment) |

**Trust boundary: unchanged.** The gallery sits on a gated path like every other route, so
this plan moves no trust boundary at all. It still renders **presentational components
only**, reads no session itself, performs no fetch, and accepts exactly two `[theme]`
values. External effects: none.

## Ordered changes

### 1. The colour inventory script — first, because everything is written against it

- **Purpose:** replace hand-counting permanently. Three successive hand-counts in v23 each
  understated the surface; this plan's own parent had two count errors caught in review.
- **Components:** `scripts/colour-inventory.mjs`, `app/utils/__tests__/colourInventory.test.ts`,
  `app/utils/__tests__/__snapshots__/colour-inventory.json`.
- **Change:** scan `app/**/*.{tsx,ts,mjs,css}` minus `__tests__`. Emit every colour decision
  with file, line, utility and pairing context: bracketed hex, bare hex, raw palette classes,
  `white`/`black`, `rgb()`/`rgba()`/`hsl()` literals, **colour inside arbitrary values with
  no `#`** (e.g. `shadow-[0_0_0_1px_rgb(0_191_255/0.45)]`), inline styles, SVG attributes,
  runtime colour maps, the retired `brand-<colour>` keys, and **`.tsx`/`.ts` arbitrary values
  referencing `var(--brand-*)`**.
  - **Case-insensitive** — both `#010B17` and `#010b17` occur.
  - **Never line-anchored.** `brand-admin-frame` (`brand.css:308`) is indented and nested; a
    `^\.brand-` pattern misses it. This is why the class count is 17, not 16.
  - **Must include `.ts`.** `serviceCardModel.ts` holds 56 colour decisions in exported class
    strings consumed by seven `.tsx` components.
  - Each row is classified by **render surface** and by **disposition: `B`, `C`, or `exempt`**.
    `exempt` rows carry a reason and the governing source. **The parent's four reviewed
    exemptions are seeded before the first run** and must appear as `exempt`, never as `B`
    or `C`:
    - `app/utils/emailShell.ts` — **12 hex literals** (verified). The email palette is
      deliberately light; CLAUDE.md records five failed attempts to hold a dark palette
      against Outlook for Mac.
    - `app/(client)/auth/signin/page.tsx:157–160` — the Google brand mark. A third-party
      mark that must not be themed.
    - `app/(client)/layout.tsx:42` — the static `themeColor` string. Not a class, not an
      inline style, not an SVG attribute; Child E makes it theme-responsive under
      invariant 17.
    - `app/**/__tests__/**` — outside the glob, and lint-exempt, but the codemod's file set
      is intersected with it so colliding assertions move with the code they assert.
  - **Two boundaries the word "authoritative" must not overstate.** (i) The glob is `app/**`,
    so `tailwind.config.ts` is **outside** it — yet it carries a live colour literal at
    `:38` (`rgba(0, 0, 0, 0.1)`) and the seven `brand.*` colour keys, and the parent assigns
    its colour config to Child B. Record it as a named out-of-glob input rather than leaving
    it unaccounted. (ii) `brand.css`'s own `:root` colour values are **bare RGB triplets**
    (`--brand-blackout: 1 11 23`) and match none of the categories above, so the inventory
    would omit the seven colour values in the token file itself. Add a triplet category or
    state the omission explicitly.
  - **Whether the scanner strips comments must be decided and stated.** If it does not,
    `PlannerGrid.tsx:1497` — a comment reading ``… `#010b17` is `--brand-blackout` …`` —
    becomes an inventory row for a colour decision that does not exist. Recommend stripping
    comments in `.tsx`/`.ts`/`.css` and recording the choice in the script's header.
- **Snapshot key:** file + normalised utility + value multiset. **Never line numbers** —
  lines are emitted for humans and excluded from the assertion, or any unrelated commit that
  shifts a line in a colour-bearing file turns `npm test` red on a tree that moves weekly.
- **Failure and recovery:** if the scan under-reports, later children migrate by guesswork.
  Mitigated by step 1b. If it over-reports, the mapping table carries dead rows — noisy, not
  dangerous.
- **Verification:** the guard fails on a deliberately introduced literal in a scratch file
  (added, asserted red, reverted). Totals reconcile against the parent's §3 table, and
  **every divergence is recorded rather than silently adopted** — the parent's counts are
  provisional by construction (A1).
- **State after:** inventory committed. No behaviour change.

### 1b. Reconcile against the parent, and close its three carried arithmetic items

- **Purpose:** the parent's round-4 review left three counted items deliberately unfixed to
  preserve the approved digest. This is where they resolve.
- **Change:** produce a short reconciliation note recording, at minimum:
  - the parent's §3 "25 of 27 bare-hex sites are reachable" should be **22** (27 − 4 Google
    literals − 1 `themeColor`);
  - the parent's bare-hex list omits `ServiceReadinessCard.tsx:723` (verified: `color: isConflict ? "#f87171" : accentHex`). **`PlannerGrid.tsx:1497` is NOT a bare-hex site** — it is a comment; the real decision is the bracketed `bg-[#010b17]` at `:1499`, which belongs to the 1,231-bracketed bucket. Do not commit that as a finding;
  - any other divergence the generated inventory finds.
- **Verification:** the note is committed beside the snapshot and cited by Child B's mapping
  table. **The inventory is authoritative; the parent's hand-counts are not.**
- **State after:** the parent's provisional figures superseded by generated ones.

### 2. Palette-family shade analysis, and the token vocabulary

- **Purpose:** the vocabulary is an **output with acceptance criteria**, not an input
  (parent §8.1). v23 froze 34 roles and simultaneously called them "a floor" — a
  contradiction reviewers hit repeatedly.
- **Change:** run the "can the vocabulary represent these values" analysis over all eight
  raw-palette families *before* the vocabulary is frozen. `gray` spans 7 shades and `red` 9.
  Produce the vocabulary as a reviewed artifact satisfying, verbatim, the parent's §8.1
  criteria:
  - every (family, shade) pair represented, or each collapse recorded with its site count and
    rationale;
  - three slots — foreground, surface, border — for every semantic state that needs them
    (`DayCard.tsx:37–50` is the worked example);
  - composed, alpha-baked tokens for pairs whose alpha differs per theme;
  - **the naming rule: a token key may never begin with a utility prefix.** `border-accent`
    compiles to `.border-border-accent`, while `.border-accent` silently resolves to the base
    `accent` role. This bit v23 twice and is invisible from reading the config.
  - **the storage convention stated once, explicitly** — triplet (`--ink-rgb: 215 231 246`)
    versus complete colour function. Child B's prose mapping is correct only against a stated
    convention, and getting it backwards renders song lyrics unstyled with no build signal.
- **Verification:** reviewed as an artifact before Child B begins. No code depends on it yet.
- **State after:** vocabulary agreed. Still no tokens in the codebase.

### 3. `.light { color-scheme: light }`

- **Purpose:** the gallery runs **without** the provider, which removes the inline
  `documentElement.style.colorScheme` that currently masks `brand.css:2`'s dark-only
  declaration. Without this the light gallery — Child D's only review surface — renders with
  dark scrollbars, form controls and default canvas.
- **Change:** add `.light { color-scheme: light; }` after `:root`. **Nothing else in
  `brand.css` changes.**
- **Failure and recovery:** trivially revertible; affects only UA-chrome rendering.
- **Verification:** a test asserts both declarations exist. Do **not** rely on next-themes'
  inline style, and do not "clean it up" later.
- **State after:** `.light` exists, holds one non-custom-property declaration. The parity
  guard therefore stays dormant (step 4).

### 4. The `brand.css` guard — two assertions, one dormant

- **Purpose:** `brand.css` is the token file and sits outside every existing gate. Its
  failure mode is silent deletion of the body wash and every inset highlight.
- **Change:** `app/utils/__tests__/brandCss.test.ts`, parsing `brand.css` and
  `tailwind.config.ts`:
  - **(a) Reference integrity — ACTIVE NOW.** Every colour `var(--x)` referenced is declared,
    checked against the **union** of `brand.css` and `tailwind.config.ts` declarations.
    **The reference set spans the same glob as the inventory — `app/**/*.{tsx,ts,mjs,css}`
    plus `tailwind.config.ts` — not just those two files.** A file-scoped reference set
    cannot detect the failure this guard exists for, and step 1 already proves references
    live elsewhere: it lists `.tsx`/`.ts` arbitrary values referencing `var(--brand-*)` as
    its own inventory category. **Verified, two live colour references sit outside both
    files, and both name variables Child B retires:**
    `app/components/admin/AdminPanel.tsx:399`
    `shadow-[inset_0_0_0_1px_rgb(var(--brand-beam)/0.15)]`, and
    `app/(client)/admin/page.tsx:37` `shadow-[0_0_10px_rgb(var(--brand-signal)/0.8)]`.
    When Child B retires `--brand-beam` (parent D6) and `--brand-signal`, those two
    declarations become invalid at computed-value time and are **dropped**: a file-scoped
    guard stays green because it never reads `.tsx`; the inventory snapshot stays green
    because the class string is unchanged; `tsc` and `eslint` are green; and the inset glow
    and the admin-tab ring silently vanish. That is exactly the failure class this guard
    exists to prevent, on exactly the variables named.
    `tailwind.config.ts:15–21` declares seven `brand.*` keys against the same variables, with
    live consumers including `selection:bg-brand-beam/35` on both root layouts, so a
    file-scoped check both misses Child B's rename and fails today. **Scoped to colour
    properties:** `tailwind.config.ts` also references `--font-display`/`--font-body`/
    `--font-label`, emitted at runtime by `next/font` and declared in neither file; an
    unscoped assertion goes red immediately.
  - **(b) Theme parity — AUTHORED, DORMANT.** Every **colour** `:root` custom property has a
    `.light` counterpart or sits on a reviewed theme-invariant allowlist, **and vice versa**.
    **Self-activates on "`.light` declares ≥1 custom property"**, so it stays dormant through
    steps 3–8 and binds in Child D. Without that trigger it goes red against all 11 current
    `:root` properties on the day it lands — this plan failing its own done-gate.
    **Colour-scoped:** four of the 11 properties are non-colour (`brand.css:10–13`; note `:9`
    is `--brand-steel`, a colour), and an unscoped parity check would demand a nonsense
    `.light --brand-radius-panel`.
  - **The allowlist and the colour scope are one rule, not two.** Because parity is colour-scoped, the four non-colour properties are already outside the assertion, so the allowlist starts empty and exists only to hold a future colour property somebody argues is genuinely theme-invariant — a claim that must be reviewed, never assumed. **`--brand-signal` must not
    be allowlisted** — it is a colour that Child B retires. Allowlisting a colour as
    "theme-invariant" is precisely the drift class this guard exists to catch.
- **Placement:** under `app/utils/__tests__/`. A guard outside `vitest.config.ts:15`'s three
  roots never matches and never runs.
- **Verification:** (a) fails against a scratch `var(--nonexistent)`; (b) is proven to stay
  green today *and* proven to fire, by a unit test that feeds it a synthetic `.light` block
  with one custom property and one missing counterpart. **A dormant guard nobody has seen
  fail is not a guard.**
- **State after:** the token file has enforcement for the first time.

### 5. The theme gallery

- **Purpose:** the only surface on which both themes can be rendered while `forcedTheme` is
  still in force — which it is until Child E.
- **Route:** `app/(gallery)/theme-gallery/[theme]/` — a **gated** path, deliberately *not*
  under `/auth/`. Verified by evaluating the live matcher: `/theme-gallery/dark` is gated,
  so the middleware protects it exactly like `/admin` or `/me`, `PUBLIC_ROUTES` needs no
  entry, and `routeMatcher.test.ts` passes by construction. `layout.tsx` sits **at the
  dynamic segment**, not above it. Next 16 passes a layout only the params from the root segment down
  to *that* layout, so a layout at `app/(gallery)/layout.tsx` sits three segments above
  `[theme]` and receives `{}`. A layout with no `layout.js` above it *is* a root layout, so
  this path is both valid and the only one that works. `(admin)` and `(client)` are already
  sibling root layouts, and there is no root `app/layout.tsx` — verified.
- **The layout must:**
  - apply `className={theme}` to `<html>` from the route param — no provider, no storage;
  - apply `${displayFont.variable} ${bodyFont.variable} ${labelFont.variable}`, as both real
    root layouts do;
  - import `app/(client)/globals.css` **specifically** (the `(admin)` one is bare `@tailwind`
    and carries none of the `@layer base` font bindings) **and** `app/brand.css`;
  - **not** import `app/utils/Provider` — `(client)/layout.tsx:64` wraps everything in
    `<Provider>` and renders `ActivityPing`, which fires `fetch("/api/activity/ping")` on
    mount; and a nested `ThemeProvider` is a pass-through in 0.4.6, so `forcedTheme` would be
    un-overridable.
- **Segment validation:** `export const dynamicParams = false` **alongside**
  `generateStaticParams`. `generateStaticParams` alone does not 404 — `dynamicParams` defaults
  to `true`, and in `next dev` the structure serves `/theme-gallery/EVIL` with **200**
  and `<html class="EVIL">`. State the *dev* behaviour only; do not claim a production
  `next start` 404s it, because with `dynamicParams` defaulting true an unlisted segment
  renders on demand. `dynamicParams = false` closes it in both modes. The route is
  authenticated, so an unvalidated segment is not a public injection vector — but reflecting
  arbitrary input into a root attribute is still wrong, and `dynamicParams = false` costs one
  line.
- **No env flag, no build-time refusal, no `PUBLIC_ROUTES` entry, no new env var.** All four
  existed only to contain an unauthenticated route. A gated gallery in production is a page
  that logged-in team members can reach and that shows them colour swatches — the same trust
  level as every other route. **`routeMatcher.test.ts` needs no edit**: the route is gated, so
  it never enters `ungated`, and the guard passes untouched. Confirm that rather than assume
  it — the walk enumerates `app/` on disk, so it *will* see the new route.
- **No `proxy.ts` edit either.** The matcher gates everything not explicitly excluded, and
  `/theme-gallery/…` is not excluded.
- **Gallery inventory — Phase A baselines only what exists.** Dark only: all 17 `.brand-*`
  classes across their 33 selector occurrences, a `prose` block, and stateless components.
  **Token swatches arrive in Child B** (tokens do not exist yet) and **the second theme in
  Child D** (light values do not exist yet). An earlier revision of v23 asked Phase 0 for
  "every token swatch in both themes", which it cannot produce.
- **It must host an open `CueDialog`** (parent §4.4). `CueDialog` portals to a root that
  `CueDialogProvider` appends to `document.body`, and `PlannerGrid`'s full-screen view portals
  there directly — content that renders outside the normal tree and that a screenshot of a
  static panel does not cover. `CueDialogProvider` is a **descendant** of `ThemeProvider` in the
  `Provider` chain (`SessionProvider` › `ThemeProvider` › `PlayerProvider` › `CueDialogProvider`,
  innermost), so the gallery mounts it **directly**, without `SessionProvider` or
  `ThemeProvider`. **Verified:** `CueDialogProvider.tsx` references no `useSession`, no
  `fetch` and nothing from `next-auth`, so it is mountable standalone.
- **Stateful admin panels are excluded throughout.** `AdminPanel.tsx:416` calls `useSession()`
  (verified; throws without a `SessionProvider`), and the editor panels issue network fetches
  — e.g. `ProposalEditor.tsx:262` `fetch("/api/me/songs?…")` (verified). Putting them in a
  "hermetic" gallery fires more uncontrolled traffic than the one call the route group exists
  to avoid. *(v23 cited `ServicesPanel.tsx:792` as a mount fetch; at that file's current 1,528
  lines its `useEffect`s are focus management, not fetches. Excluded on the `useSession`/fetch
  grounds above, not on that stale citation.)*
- **Honest coverage:** the gallery exercises the token layer, `brand.css` compositing and the
  portal path — **not** the bulk of the 1,231 hex sites. That is exactly why Child B's primary
  gate is equality by construction and not screenshots.
- **The false-confidence trap:** the gallery has no provider, so if the layout ever fails to
  write the theme class, a surviving `dark:` variant silently renders its **light-intended
  base** while the real app renders the dark side. Assert the class is on `<html>` for both
  segments.
- **Co-locate `not-found.tsx` at `[theme]/`.** Next inserts the default not-found boundary at
  the root layer and at the first-layer group route — `app/` and `app/(gallery)/` — both
  **above** the `[theme]` root layout, so a 404 would render with no `<html>`/`<body>`. The
  status is still 404 and no gallery content is served, so the trust boundary holds; but in
  `next dev` it surfaces as "Missing `<html>` and `<body>` tags in the root layout" rather
  than a clean 404 — on the path that is the *default* in production. A co-located
  `not-found.tsx` fixes it.
- **`docs/ROUTES.md` needs more than a row.** Its opening states *"The app uses **two route
  groups**, each with its own root `<html>`/`<body>` layout"* (`:3`) and that there are no
  nested sub-tree layouts beyond those two group roots. Both go stale the moment `(gallery)`
  exists. Update the prose **and** add the row with its "Public" column set — CLAUDE.md
  requires docs current in the same delivery.
- **Regenerate the inventory snapshot at the end of this step.** The gallery page is new
  source under `app/**` and will itself carry colour decisions, so the step-1 snapshot goes
  stale and `npm test` goes red at merge until it is regenerated. Loud and trivially fixed,
  but it is a done-gate failure if nobody says it.
- **Failure and recovery:** with the gallery gated, the dangerous failure the earlier
  revision worried about no longer exists — there is no unauthenticated surface to contain,
  no flag to leak, and no promotion path to reason about. The residual failure is a gallery
  that renders *wrongly* and gives Child D false confidence; that is what the assertions
  below are for. Recovery is deleting the route group.
- **State after:** both themes renderable in dev and Preview; nothing reachable in production.

### 6. Read-only Playwright config and its ADR

- **Purpose:** VR baselines. `playwright.config.ts` cannot be reused — it is a write-safety
  harness that **throws** unless a whole verification identity is present, and has no
  `webServer` block by design.
- **Change:** `playwright.vr.config.ts`, read-only, with its `testDir` **under `e2e/`** —
  placement decides a lint outcome, not just tidiness. `react-hooks/rules-of-hooks` is an
  error under `next/core-web-vitals`, and `eslint.config.mjs` disables it only for
  `files: ["e2e/**"]`. A Playwright spec using a `use` fixture outside `e2e/**` fails
  `npx eslint .` on the day it lands — this plan's own done-gate. **It must authenticate**, because the gallery is
  now gated — a headless VR run gets the login page otherwise, and a baseline of the login
  page is worse than no baseline. Reuse the repo's existing `e2e/` auth approach rather than
  inventing a second one. It must not be able to reach the production Sanity dataset or start
  anything that writes. Add **two** ADRs — existing records run 0001–0013, so
  `adrIndex.test.ts` will accept **0014** and **0015** consecutively:
  `0014-two-playwright-configs.md`, and `0015-gallery-root-layout.md` for the third root
  layout at a dynamic segment. The latter is textbook CLAUDE.md decision-record material —
  a structure that looks like a mistake but is the only arrangement that receives the
  `[theme]` param *and* escapes `forcedTheme`. Without it, someone "tidies" the layout upward
  and silently breaks both.
- **ADR mechanics — `adrIndex.test.ts` will fail otherwise:** link it from
  `docs/adr/README.md`, match `/^# ADR-\d{4}: .+/`, carry a `**Date:** … **Status:**` line,
  and number consecutively from 0001, all in the same commit.
- **Verification:** running the VR config with no env set does something safe and obvious;
  running the *existing* config still refuses as before.
- **State after:** VR harness exists. Baselines are Child D's.

### 7. The `redesign/explore` / `7af69d8` polarity review

- **Purpose:** the polarity decision (D4: dark in `:root`, light under `.light`) is baked in
  by Child B and cannot be cheaply revisited. `redesign/explore` carries a **working
  two-theme token system** (the Cantoral variant, ADR-0009). This is where its mechanics are
  harvested — it is not history to skip.
- **Change:** read `app/(client)/globals.css` on that branch, `ThemeToggle.tsx`,
  `REDESIGN_PROPOSAL.md`, and the commits fixing *"theme flash"* (`7af69d8`) and *"floating
  surfaces now flip with theme"* (`392c47a`). Record what is and is not harvestable, and
  confirm or challenge D4. This also closes the gap ADR-0009 filed.
- **Verification:** committed as a finding. If it *contradicts* D4, that is a parent-level
  change: stop, propagate, and treat the parent's approval as stale.
- **State after:** polarity evidenced rather than asserted.

### 8. The AA gate's own inputs

- **Purpose:** parent D9 makes WCAG AA a ship gate, and nothing else produces its inputs. Two
  earlier v23 revisions claimed these were "derived in Phase 0" without putting them in Phase
  0's checklist. **A ship gate whose inputs live in no phase is the gate that gets waived.**
- **Change:**
  - the **surface-nesting map** — hand-authored and reviewed, the only producer of
    cross-component pairs;
  - the **dark composited failing set**, derived from that map plus the inventory's
    same-element pairs. **Must be re-derived at every Child C family merge**: C changes ~881
    dark values and does not promise byte-identity, so a set derived once here is stale the
    moment the first family lands, and C's own per-family diff gate is contrast-blind;
  - the **recorded conservative backdrop assumption** — the lightest rendered
    `brand-atmosphere` point in dark. Conservative is load-bearing: an unconstrained
    flat-approximation lets an implementer pick a favourable backdrop and satisfy the gate
    while shipping a real failure.
- **Verification:** committed artifacts, cited by Child C's re-derivation step and Child D's
  matrix.
- **State after:** the AA gate has producers.

## Data and failure safety

- **Identity and source of truth:** the generated inventory is authoritative for the colour
  surface. Every hand-count in the parent and in v23 is provisional and superseded by it.
- **Migration and compatibility:** none. No data is read, written or migrated. No Sanity
  access of any kind. No Studio deploy.
- **Partial failure:** every step is independently revertible and none leaves a half-state
  that renders differently — no `className` changes in this plan.
- **Concurrency and idempotency:** the inventory script is a pure read. Re-running it on an
  unchanged tree must produce a byte-identical snapshot; if it does not, the key is unstable
  and step 1 is not done.
- **Data preservation and rollback:** nothing to preserve. Rollback is `git revert`.

## Verification

| Requirement | Test or check | Failure it detects |
|---|---|---|
| Inventory is complete | Guard fails on an introduced literal in a scratch file | An under-reporting glob — the defect that makes later children migrate by guesswork |
| Inventory is stable | Two consecutive runs on an unchanged tree are byte-identical | A key that drifts, which would make `npm test` flap |
| Snapshot is not line-keyed | An unrelated whitespace commit in a colour-bearing file leaves `npm test` green | The false-red that would make the guard get deleted |
| Inventory covers `.ts` and nested CSS | `serviceCardModel.ts` and `brand-admin-frame` both appear | The two known glob traps |
| `brand.css` reference integrity | Guard fails on a scratch `var(--nonexistent)` | Child B's silent-drop rename failure |
| Theme-parity guard is dormant **and works** | Green today; fires on a synthetic `.light` block with a missing counterpart | A guard that is green because it never runs |
| Guards actually execute | Files live under `app/utils/__tests__/`; the suite count rises from 142 | A guard placed outside vitest's roots — a silent no-op |
| Gallery is **gated** | `routeMatcher.test.ts` stays green with **no edit** — the new route must not appear in `ungated` | A placement mistake that silently makes it public |
| Gallery 404s on an invalid segment | A served-route check in the VR config | Arbitrary input reflected into a root attribute |
| Gallery applies the theme class | Assert `<html class>` for both segments | The false-confidence trap: `dark:` variants rendering their light base |
| Gallery renders an open `CueDialog` | Gallery renders it; VR covers it | The portal path being invisible to every later screenshot |
| Fonts are real, not fallback | Assert the three `.variable` classes on `<html>` | Every VR baseline at fallback metrics, invalidating Child D's review |
| Done-gate | `npx tsc --noEmit`, `npm test`, `npx eslint .` = 0 errors | Regression against the 142/3,275 baseline |

## Rollout, observability, and rollback

- **Release sequence:** branch `feat/light-mode-a-scaffolding`; steps in order; merge to
  `main` when the done-gate is green; direct push, no PR (CLAUDE.md).
- **Deploy verification:** after pushing, confirm the **alias moved** to a deployment built
  from the pushed commit — a green build is not a deploy. HTTP checks prove nothing here (SSO
  returns 302).
- **Signals proving success:** test count rises from 142 files / 3,275 tests; `/theme-gallery/dark`
  and `/theme-gallery/light` both render for a signed-in member in dev and on Preview;
  `/theme-gallery/EVIL` 404s.
- **Stop conditions:**
  - the inventory cannot produce a stable key → stop; every later child depends on it;
  - step 7 contradicts D4 → **stop and propagate to the parent**; its approval becomes stale;
  - the gallery cannot host `CueDialog` without a session → stop and re-plan the fixture
    rather than importing `Provider`.
- **Rollback:** `git revert` the merge. Nothing user-facing exists to restore, no data has
  moved, and no remote state changed. The gallery route group can be deleted outright.
- **Restoration verification:** `npm test` green at 142 files / 3,275 tests, and
  `/theme-gallery/*` resolves nowhere.

## Decisions

| Decision | Choice | Why | Tradeoffs | Owner |
|---|---|---|---|---|
| Inventory is generated, never hand-counted | Script + snapshot + guard | Three v23 hand-counts and two parent figures were each wrong | A script to maintain | A |
| Snapshot key excludes line numbers | file + normalised utility + value multiset | A line-keyed snapshot goes red on unrelated commits in a tree that moves weekly, and a flapping guard gets deleted | Cannot detect a pure move | A |
| Gallery gets its own root layout | `(gallery)` group, layout at `[theme]` | A nested `ThemeProvider` is a pass-through in 0.4.6, so both themes are otherwise unrenderable until Child E | Duplicated shell | A |
| Gallery sits on a **gated** path | Not `/auth/`, not public | "No matcher edit" was true of both placements and justified neither. Gating deletes the env flag, the `SECRETS.md` entry, the build refusal, the `PUBLIC_ROUTES` entry and the prerender-vs-runtime argument, and drops this child to Standard | Local `next dev` and the VR harness need a session | user, 2026-08-07 |
| Theme-parity guard ships dormant | Self-activates on the first `.light` custom property | Landing it active makes this plan fail its own done-gate against all 11 `:root` properties | A dormant guard needs its own proof | A |
| Vocabulary is an output, not a spec section | Reviewed artifact | v23 froze 34 roles and called them "a floor" — reviewers hit that contradiction repeatedly | Child B blocks on the review | A |

## Assumptions

| Assumption | Impact if false | Validation point | Failure response |
|---|---|---|---|
| A stable inventory key exists that is neither line-based nor lossy | The guard flaps or misses real changes | Step 1, two consecutive runs | Stop. Everything downstream depends on it |
| ~~`CueDialogProvider` mounts without a session~~ — **verified true**, not an assumption: it references no `useSession`, no `fetch` and nothing from `next-auth`, and is the innermost provider in the chain | — | Resolved at planning | — |
| `CueDialog` renders usefully with no `PlayerProvider` above it either | The portal fixture needs a second provider, or a stub | Step 5 | Mount `PlayerProvider` too if required — it is equally session-free. **Do not import `Provider`**, which pulls in `SessionProvider` and `ActivityPing` |
| `redesign/explore` still resolves and is readable | The polarity decision stays asserted, not evidenced | Step 7 (branch and commit both verified to exist today) | Record D4 as unevidenced and raise it to the parent |
| A read-only Playwright config can coexist without weakening the write-safety harness | VR either cannot run or the safety harness is loosened | Step 6 | Keep the harness intact and defer VR to Child D |
| Adding one `PUBLIC_ROUTES` entry is the whole auth surface change | An unnoticed second route becomes public | `routeMatcher.test.ts` catches it by construction | The guard is the response |

## Open questions

| Question | Why it matters | Recommendation and why | Owner | Blocking? | Bounded default |
|---|---|---|---|---|---|
| How the VR harness authenticates against a gated gallery | Step 6 cannot run headless without it | Reuse the repo's existing e2e auth approach rather than inventing a second one; the write-safety harness already solves login for `e2e/service-readiness` | A | **No** | Resolve at step 6; if it proves costly, take VR baselines manually for Child D and record it |
| Whether the gallery renders one page per theme or one page with both | Affects VR baseline shape | One route per theme (`[theme]`), already implied by the segment — it is the only shape that lets a single baseline capture a whole theme | A | **No** | As specified |
| Per-family mapping of `yellow`/`orange`/`amber` onto `warning-*` | Child C's collapse decisions | Keep families separate until step 2's analysis proves a collapse is safe; `red` → `negative-*` is settled in family only | A | **No** | Separate roles |

**No blocking open questions.**

## Handoff

- **Prerequisites supplied to later plans:** the generated inventory and its guard; the
  reviewed token vocabulary and its storage convention; an enforced `brand.css`; a
  two-theme-capable gallery including the portal path; a read-only VR harness; the AA gate's
  three inputs; an evidenced polarity decision.
- **Outputs promised:** Child B consumes the inventory **minus its `exempt` rows** as its mapping table and the
  vocabulary as its target. Child C re-derives the composited failing set at every family
  merge. Child D takes the gallery, the VR harness and the AA inputs.
- **Adversarial review order:** this plan (**Standard** — one fresh cold `APPROVED`), then
  Child B.
- **Implementation authorization: not granted by this plan.**

## Terminal state

**`READY_FOR_ADVERSARIAL_REVIEW`**

Self-contained, with no unresolved blocking unknowns. **Review readiness is not approval, and
plan approval is not authorization to implement.** After implementation, a fresh code review
plus the documented test gates are required — plan review is not a substitute.
