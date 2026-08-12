# Scope spec: Light mode via role-based design tokens

**Date:** 2026-08-07
**Status:** **APPROVED (re-approved after amendment)** at digest `3a927bd8b70c3726134a5254e8e8c258a90eb689ba539397d7bcf0196abb1478`, round 2 of the re-review, commit `9151750`. **Eleven** non-blocking items were folded in afterwards (nine at re-approval, plus §8.1a recording the A1/A2 split, plus the §9 declaration-set correction) and are listed as **post-approval, un-reviewed** in the review log beside this file. **Approval authorizes writing the child plans, not implementing them.**
**Artifact level:** Parent scope spec. Defines *what must be true*. Child implementation
plans are written only after this document is approved.
**Supersedes as the scoping authority:** `2026-07-29-light-mode-role-tokens-design.md`
(v23). That document is retained for its verified mechanism findings (§9 cites them
individually); its phasing, counts and frozen vocabulary are replaced by this one.
**On completion, supersedes:** [ADR-0008](../../adr/0008-forced-dark-theme.md), fully.

> **Filename note.** This file was created as `…-member-first-scope.md` under a scope that
> was reversed on 2026-08-07 (§4.1). The name is kept so the committed review log, its
> digests and the git history stay resolvable. The scope is full-surface.

---

## 1. The request

> "Rewrite the light-mode re-activation plan into correctly scoped plan(s), then go for
> the adversarial review."

Originating ask, from the session that produced v23: *bring light mode back*.

No sensitive values appear in this request or in this document. Colour literals are design
values, not secrets.

## 2. Primary outcome and who it is for

**Outcome:** a member of the Oasis Worship Team can choose Claro or Oscuro (later, Seguir
sistema) and **every screen in the app** renders correctly and legibly in the theme they
chose.

**Primary user:** the ~40 volunteer team members, on phones, frequently in daylight.
Administrators get the same benefit on the same terms.

**Secondary outcome, and the one that makes this different from the revival ADR-0008
buried:** components lose the ability to name a colour at all. A panel added six months
from now is light-correct by construction, not by remembering.

## 3. Current behavior and the gap

`app/utils/Provider.tsx:16` **used to set** `forcedTheme="dark" enableSystem={false}` (Child E4 removed `forcedTheme`; `defaultTheme="dark"` now holds the default), which overrode
both user and system preference. `ThemeSwitch.tsx` was deleted in `33c6e15`. There is no
light path to return to: `app/brand.css` declares `:root { color-scheme: dark }` at line 2
with **no `.light` branch and no `prefers-color-scheme` query**, and 11 `:root` custom
properties with no light counterparts.

Measured on `main` today, `app/**/*.tsx` excluding `__tests__`:

| Colour source | Count | Themeable today |
|---|---:|---|
| Bracketed hex (`text-[#00bfff]`) | 1,231 across 46 files | No |
| Bare hex — inline styles, SVG attrs, runtime constants | 27 | No — but reachable by CSS vars, see below |
| Raw palette classes — `gray` 470 · `red` 189 · `amber` 88 · `yellow` 47 · `green` 44 · `orange` 20 · `purple` 14 · `blue` 9 | 881 | No |
| `text-white` / `bg-black` etc. | 45 | No |
| `brand-*` colour utilities | 213 | Yes |
| **Total** | **2,397 across 64 files** | **~9% tokenised** |

**The 27 bare-hex sites are not a special mechanism class.** Most are SVG
presentation attributes, inline styles and runtime constants (`icons.tsx`,
`DayCard.tsx:33,43,53`, `ParticipationSidebar.tsx:6`, `CalendarView.tsx:193–195`), all of
which accept `rgb(var(--x-rgb) / α)` or `currentColor` normally. Only two *sites* are genuinely unreachable by a CSS variable —
`(client)/layout.tsx:42`'s `themeColor` string and the Google brand logo (which is one site
but four literals, `signin/page.tsx:157–160`) — and both are handled explicitly (§5). Exact
per-category figures are Child A's inventory to produce, not this table's (A1). An earlier framing called the
whole bucket unreachable, which would have led a child to build a runtime colour mechanism
for sites that do not need one.

Non-`.tsx` sources, excluded from the counts above but **included in the migration**:
`app/components/admin/serviceCardModel.ts` carries **56 colour matches** in exported class
strings consumed by seven `.tsx` components. `app/utils/emailShell.ts` also carries colour and
is **exempt by design** — the email palette is deliberately light.

Of the 241 `dark:` variants across 39 files, the great majority carry a hex literal on both
sides — v23 measured 238 of 251 at its own baseline. **The existing "light path" is itself
hardcoded.** This is the mechanism ADR-0008 records: light was never dropped on aesthetic
grounds, it stopped being maintained, and re-adding `dark:` variants rots on exactly the
same schedule.

## 4. Scope: the whole surface

**All 2,397 colour decisions across 64 files are in scope. Nothing is deferred.**

### 4.1 A narrower scope was tried and rejected, with evidence

This document first scoped the delivery to the member surface only, deferring the 17 admin
panel files and their 1,306 decisions (54%) — the option v23 §10 never priced. That scope
went through two adversarial rounds and failed both, **on the same component each time**:
the mechanism required to hold the deferred admin screens dark inside a light document.

The decisive finding was that the containment mechanism cannot be made complete:

- [`app/components/ui/CueDialogProvider.tsx:62–64`](../../../app/components/ui/CueDialogProvider.tsx)
  appends its portal root to `document.body`, and
  [`CueDialog.tsx:230`](../../../app/components/ui/CueDialog.tsx) portals every dialog into
  it. Five deferred admin panels mount it — `AdminPanel`, `ServicesPanel`, `SetlistEditor`,
  `PlannerGrid`, `ContentPanel`.
- [`app/components/admin/PlannerGrid.tsx:2008`](../../../app/components/admin/PlannerGrid.tsx)
  is `return fullScreen ? createPortal(surface, document.body) : surface;` — the entire
  full-screen planner, 124 colour decisions, rendered as a child of `<body>`.

Portaled content is not a DOM descendant of anything inside the route, so a route-scoped
containment wrapper misses it by construction — and nothing prevents the next portal from
being added unpinned. Three further channels had already been found in the round before
(121 `dark:` variants compiling to a `.dark` **ancestor** selector under
`tailwind.config.ts:10`; `.light`-scoped `.brand-*` rules a descendant wrapper cannot
override; translucent admin surfaces compositing against the `brand-atmosphere` body wash
in `app/(client)/layout.tsx:57–61`).

**The containment mechanism existed only because of the deferral.** Removing the deferral
removes the mechanism, the four channels, the tests that would have guarded them, and the
standing risk that a future portal silently reopens the hole. That is the trade the user
accepted on 2026-08-07: **+1,306 decisions, −1 open-ended leak.**

Full detail is in the committed review log beside this file.

**Consequence, recorded so it is not rediscovered:** because there is no pinned island, a
future partial rollout — shipping light to some routes and not others — would reintroduce
this entire defect class. **Light mode ships for the whole app or not at all.** Staging
belongs to the *default*, not to the *surface* (D8, Child F).

### 4.2 Sizing

The nine densest files, which dominate Children B and C:

| File | Decisions |
|---|---:|
| `components/admin/MonthGenerator.tsx` | 302 |
| `(client)/me/propose/[roleId]/ProposalEditor.tsx` | 139 |
| `components/admin/ServicesPanel.tsx` | 130 |
| `components/admin/PlannerGrid.tsx` | 124 |
| `components/admin/AdminPanel.tsx` | 113 |
| `components/admin/ProposalsPanel.tsx` | 103 |
| `components/AvailabilityCalendar.tsx` | 96 |
| `components/admin/SongFormModal.tsx` | 90 |
| `components/admin/SetlistEditor.tsx` | 79 |

Seven are admin panels; `ProposalEditor.tsx` is the second-densest file in the repository
and `AvailabilityCalendar.tsx` the seventh. **These nine files alone are 1,176 decisions —
49% of the total.** Children B and C are sized by this table, not by file count.

### 4.3 `(admin)` chrome and `/studio`

`app/(admin)/` contains **only** `/studio` (verified: `globals.css`, `layout.tsx`,
`studio/[[...tool]]/page.tsx`). Its `layout.tsx` `<body>` opens at `:41` with its `className` on `:42`, carrying
`brand-atmosphere min-h-screen bg-brand-blackout font-body text-brand-frost
selection:bg-brand-beam/35`.

Per the user's decision (D14), that chrome moves onto themed tokens and follows
`themePref`. Sanity Studio's own panel stays out of scope (D10), so light mode produces a
**light chrome around a dark Studio panel**. This is an accepted, documented outcome, not a
defect to be filed later.

### 4.4 Portals are in scope and are not a special case

With the whole surface themed, the portal sites of §4.1 need no special handling: portaled
nodes are children of `<body>`, so they inherit the theme class on `<html>` like everything
else. They are named here only so a child plan does not invent a mechanism for them.

They **do** matter to verification: `CueDialog` bodies and `PlannerGrid`'s full-screen view
render outside the normal tree, so **Child A's gallery and the VR harness must be able to
exercise an open dialog**, and Child D's acceptance must include one. A screenshot of a
static panel does not cover them.

## 5. Scope boundaries

### In

- All 64 colour-bearing `.tsx` files and their 2,397 decisions.
- `app/components/admin/serviceCardModel.ts` (56 decisions, non-JSX, strings feed
  `className`).
- `app/brand.css` in full: the token layer, the `.light` branch, all **17** `.brand-*` (of which **15 need light counterparts** — generated; see below)
  compositing classes (**33** selector occurrences including pseudo-elements and states)
  and their light counterparts.
- `tailwind.config.ts` colour configuration, both token layers, and the typography theme.
- `app/(admin)/layout.tsx` (§4.3).
- `themePref` on `teamMembers`, its write route, the `/me` control, the `localStorage`
  mirror, the provider's `defaultTheme` / `enableSystem` configuration (§9), the iOS status
  bar.
- **Theme-responsive `themeColor`, subject to invariant 17.** `(client)/layout.tsx:47` is a
  static `themeColor: "#010b17"`. The native mechanism — `generateViewport()` reading the
  session — **is forbidden here**: it makes the `(client)` root layout dynamic and de-ISRs
  five statically-rendered routes. The requirement must be met **client-side**, by updating
  the `<meta name="theme-color">` element when the theme changes. A child that cannot meet
  it without a session read in a shared layout must leave `themeColor` static and record
  that as a remnant, rather than trade ISR for it.
- **`appleWebApp.statusBarStyle`**, currently the static `"black-translucent"` on both root
  layouts (`(client)/layout.tsx:31`, `(admin)/layout.tsx:26`). It is theme-dependent on the
  installed-PWA path and is subject to the same invariant-17 constraint as `themeColor`. **AMENDED by Child E
  (2026-08-12): `statusBarStyle` stays `black-translucent` and is recorded as a
  remnant — the reason is GEOMETRY, not colour.** `black-translucent` is what makes
  the WebView extend under the iOS status bar, which is what gives
  `env(safe-area-inset-top)` a non-zero value; `Navbar.tsx:18`, `CueDialog.tsx:236`
  and `PlannerGrid.tsx:1769` all consume it. Every light-appropriate value
  (`default`, `black`) is non-translucent, so honouring a runtime swap would collapse
  the inset and move all three — a layout jump on every toggle in an installed PWA.
  The cost is stated: in an installed iOS PWA in light mode the status-bar glyphs stay
  white over a light wash. That is narrower than the jump, and its fix belongs to the
  iOS work, where the safe-area padding can move in the same change. `themeColor` IS
  swapped — it is pure colour with no geometry attached.
- Verification scaffolding: colour inventory, snapshot guard, `brand.css` guard, theme
  gallery, read-only Playwright config, WCAG AA contrast gate, the colour lint rule.

### Out, deliberately

| Excluded | Why | Recorded as |
|---|---|---|
| Sanity Studio's internal theming at `/studio` | Third-party surface | D10 |
| Email templates and `app/utils/emailShell.ts` | Deliberately light; five attempts to hold dark against Outlook for Mac failed | CLAUDE.md landmine, `docs/NOTIFICATIONS.md`; lint-exempt |
| `manifest.webmanifest` `theme_color` / `background_color`, PWA splash | A static file cannot follow a per-user runtime preference | Permanent documented remnant |
| `mobile/fallback/index.html` | Capacitor offline page, shown before any preference can be read; outside `app/**` | Permanent documented remnant |
| `ios/App/App/Info.plist:57–58` (`UIStatusBarStyle` / `UIStatusBarStyleLightContent`), `android/…/values/styles.xml:7–8` | Native defaults. **CORRECTED by Child E (2026-08-12): the iOS one is NOT overridden at runtime.** A6's fallback was taken — `@capacitor/status-bar` is not installed — so the native bar keeps its `Info.plist` default. The web/PWA meta is a separate matter, also left static, for the safe-area reason recorded at §5 | Documented remnants |
| Raster brand assets — `/icons/backstage-v2-*.png`, `/LogoOasis.png` | Opaque `#010b17` tile marks, outside every glob | Decision, not omission |
| The Google brand logo at `(client)/auth/signin/page.tsx` (`#4285F4 #34A853 #FBBC05 #EA4335`) | A third-party mark that must not be themed | Lint-exempt, with reason |
| Building lint/test CI | `.github/workflows/` holds two workflows — one `schedule:` cron and one `workflow_dispatch:`-only diagnostic — and neither has a `push` or `pull_request` trigger; no PR gate exists (CLAUDE.md mandates direct push) | Guards ride the existing `npm test` done-gate |

## 6. Invariants that must remain true

**Repository invariants** (from CLAUDE.md; violating any fails the delivery):

1. Done-gate: `npx tsc --noEmit`, `npm test`, `npx eslint .` with **0 errors**. Baseline
   today: **142 test files, 3,275 tests passing**.
2. Work on a branch, merge to `main` periodically, direct push, no PRs. Conventional
   commits. **Never** add AI/Claude attribution or `Co-Authored-By` trailers.
3. Any new env var gets a `docs/SECRETS.md` entry in the same change — platforms that need
   it, where the value came from, how to rotate, blast radius. Never the value.
4. Documentation current in the same delivery; no stale "not released" claims.
5. Vercel: canonical project `frank-rochas-projects/owt-backstage`. The stable dev domain
   belongs exclusively to the `preview` branch.
6. Production Sanity writes need explicit user consent; dry-run first.
7. **`preview` writes to the real Sanity dataset and emails the real team.** Not a dry run.

**On-disk guards that will fail `npm test` if this delivery forgets them** — all three real
and currently green:

8. `app/utils/__tests__/routeMatcher.test.ts:52` asserts `ungated` equals `PUBLIC_ROUTES`
   (`:34–42`) by walking `app/` on disk. **Any new unauthenticated route breaks `npm test`
   the moment it exists.** **The theme gallery is deliberately NOT such a route** (§8.4): it
   sits on a gated path, so it must never appear in `ungated`, and this guard must stay green
   **without being edited**. If a child finds itself adding a `PUBLIC_ROUTES` entry for the
   gallery, the placement is wrong — that entry is the signal, not the fix.
9. `app/utils/__tests__/agentDocsParity.test.ts` asserts `CLAUDE.md` and `AGENTS.md` are
   byte-identical after normalisation. Both must be edited in the same commit.
10. `app/utils/__tests__/adrIndex.test.ts` requires every `docs/adr/NNNN-*.md` to be linked
    from `docs/adr/README.md`, match `/^# ADR-\d{4}: .+/`, carry a `**Date:** … **Status:**`
    line, and number consecutively from 0001.

**Product invariants:**

11. Timezone `America/Mexico_City`; service dates render pinned to local noon. Untouched
    here, but no fixture added may regress it.
12. Member-facing reads filter `published != false`.
13. `themePref` is **member-only** and never appears in `MemberForm` (D11).
14. **Unset must stay distinguishable from an explicit choice.** Child F's staged default
    flip is a silent no-op otherwise. Nothing may write a default `themePref` to Sanity on
    first render.
15. `/api/cron/*` stays excluded from the `proxy.ts` matcher; the matcher is duplicated in
    `app/utils/routeMatcher.ts` and the two stay byte-identical.
16. **Light mode ships for the whole app or not at all** (§4.1). Staging is on the default,
    never on the surface.
17. **ISR must survive this delivery.** Nine `(client)` pages export `revalidate` —
    `page.tsx:69`, `schedule/page.tsx:14`, `posts/[slug]/page.tsx:120`, `tag/page.tsx:27`,
    `tag/[slug]/page.tsx:34`, `author/page.tsx:21`, `author/[slug]/page.tsx:21`,
    `me/page.tsx:24`, `me/propose/[roleId]/page.tsx:8`. **`app/(client)/layout.tsx` reads no
    session, cookies or headers today** (verified), which is what keeps `/`, `/schedule`,
    `/posts/[slug]`, `/tag` and `/author` statically rendered. **No part of this delivery may
    introduce a session, cookie or header read into a shared layout**, because that opts the
    whole segment into dynamic rendering. CLAUDE.md makes ISR load-bearing, and ADR-0007
    forbids exactly this. See the constraint on `themeColor` in §5.
18. **Cache invalidation (CLAUDE.md).** Admin/API routes that mutate content must call the
    matching `revalidate*` util in `app/utils/revalidate.ts` (or `revalidatePath`), or the ISR
    page stays stale. **Child E ships a mutating write route** and lands squarely on this.
19. **Client mutation handlers (CLAUDE.md).** They must wrap `fetch` in try/catch/finally,
    check `res.ok`, reset their loading flag, and never close-as-success on failure.
    **Child E's `/me` theme control is such a handler.**

## 7. Decisions

| # | Decision | Choice | Source |
|---|---|---|---|
| D1 | Anti-drift mechanism | Role-based tokens. Components stop naming palettes. | v23 |
| D2 | What light mode is | Counterpart design, not mechanical inversion. Glow has no light equivalent. | v23 |
| D3 | Vocabulary | Two layers — base roles as `rgb(var(--x-rgb) / <alpha-value>)`, plus composed tokens with alpha baked per theme. **The vocabulary is an output of Child A, not a fixed list here** (§8.1). | This doc, amending v23 |
| D4 | Polarity | Dark in `:root`, light under `.light`. Backstage ships unset→Dark, so dark is the base. | v23 |
| D5 | Sequencing | Tokens first, light second, the setting last. | v23 |
| D6 | Accent, dark side | `#00bfff` wins for **dark**. `--brand-beam` `#12C8F4` is retired. Light needs its own value — see A5. | v23, qualified here |
| D7 | Persistence | Server-persisted `themePref` on `teamMembers`, mirrored to `localStorage` so `next-themes` paints before hydration. **Child E must follow the shape of the existing member preference** — `TextSizeControl.tsx` + `app/utils/textZoom.ts` + `TextScaleBootstrap` — rather than invent a second one. That precedent is localStorage-only; D7 deliberately adds server persistence, which is the only intended difference. | v23, precedent named here |
| D8 | Default | Unset → Dark at ship; staged to Follow System later, after a volunteer week. | v23 |
| D9 | Ship gate | WCAG AA across the ink × surface matrix, plus the colour lint rule, plus the staged default. | v23 |
| D10 | Studio | Sanity Studio's internal theming is out of scope. | v23 |
| D11 | Admin editability | `themePref` is member-only, never in `MemberForm`. | v23 |
| D12 | **Scope** | **The whole surface — all 2,397 decisions. Nothing deferred.** A member-first scope was tried and rejected on evidence (§4.1). | This doc, user 2026-08-07 |
| D13 | **No pinned surface** | **No route renders a theme other than the member's choice.** There is no dark island, and none may be introduced. **One recorded exception: the theme gallery** (§8.4), which is provider-less by design so it can render *both* themes from a route param, and is therefore the one production route that ignores `themePref`. It is a swatch page for reviewers, not a product surface — which is why §4.1's containment argument does not apply to it. | This doc, derived from §4.1 |
| D14 | **`(admin)` chrome** | **Follows the theme. Light chrome around a dark Studio panel is accepted.** | This doc, user 2026-08-07 |
| D15 | **`themePref` delivery** | Extend the **existing** `GET /api/me` projection. A JWT claim is unsafe — the session carries a 30s-TTL `{_id, disabled, role}` projection (`app/utils/memberAccess.ts:3,26`). | This doc, correcting v23 |

## 8. Child decomposition

Six children. Each has a distinct acceptance contract, a coherent change boundary,
independently verifiable completion, a safe end state, and its own rollback boundary. They
are **not** split because the document was long.

| Child | Outcome | Safe end state | Rollback boundary | Tier |
|---|---|---|---|---|
| **A — Verification scaffolding** | Inventory, guards, gallery, VR harness exist. | No user-visible change. Dark-only, unchanged. The gallery is a **gated** route, reachable in production by any signed-in member — accepted (§8.4). | Revert; nothing user-facing moved. | Standard |
| **B — Token layer + hex/`brand-*` migration** | All hex and `brand-*` utilities resolve through tokens. Dark values byte-identical. | Dark-only, visually identical except the enumerated normalisations. | Atomic. Tag before; a half-migrated token layer compiles and renders wrong. | Standard |
| **C — Palette families** | The 881 raw palette classes and 45 `white`/`black` resolve through roles. | Dark-only, per-family visual deltas enumerated and reviewed. | Per colour family; each independently revertible. | Standard |
| **D — Light counterpart design** | `.light` carries a designed counterpart for every token and the **15** `.brand-*` classes that carry colour (of 17 — generated). Acceptance includes an **open `CueDialog`** and **`PlannerGrid` full-screen** (§4.4). | Light values exist but are **unreachable** — `forcedTheme="dark"` still in force. | Atomic. Tag before; the `brand.css` guard demands a full counterpart set. | Standard |
| **E — The setting** | `themePref`, `/me` control, mirror, `forcedTheme` removed, `themeColor`, iOS status bar. | Light mode reachable. Unset → Dark. | Re-add `forcedTheme="dark"`: one line, instant. | **Critical** |
| **F — Staged rollout** | Default moves unset → Follow System; Spanish announcement; ADR-0008 superseded. | Members on system preference. | Revert the default constant. | Standard |

E is critical because it performs a schema/data migration, a production write route, and an
irreversible Studio schema deploy. B is *large*, not critical: reversible by tag, gated by
computed-colour equality, and it touches no trust boundary.

**A was Critical and is now Standard (amended 2026-08-07, after this document's first
approval).** The tier rested on A opening a new unauthenticated route past the `auth` matcher
exclusion. Child A's review established that the stated justification for that placement —
"it needs no matcher edit" — is true of a **gated** path as well (verified against the live
matcher), so it justified neither, and the user chose the gated placement. A therefore
changes no trust boundary: it adds a route the middleware protects exactly like `/admin`,
`routeMatcher.test.ts` stays green **without being edited**, and there is no env flag,
`PUBLIC_ROUTES` entry, `docs/SECRETS.md` entry or build-time refusal to review.

### 8.1 Why the token vocabulary is a Child A deliverable, not a section here

v23 froze a provisional 34-role vocabulary in §3.1 and simultaneously declared it "a floor"
that Phase 0's palette analysis may extend. Reviewers hit that contradiction repeatedly: a
frozen list that is explicitly not frozen cannot be reviewed.

Here the vocabulary is an **output of Child A with acceptance criteria**, not an input:

- It must represent every (family, shade) pair the inventory finds, or explicitly record
  each collapse with its site count and a rationale. `gray` spans 7 shades and `red` 9.
- It must give three slots — foreground, surface, border — to every semantic state that
  needs them. `DayCard.tsx:37–50` is the worked example: `border-[#78350f]
  dark:border-[#f59e0b]`, `bg-[#78350f] dark:bg-[#1c0800]`, `border-[#92400e]
  dark:border-[#f59e0b]` — three literals for one state, in one component, per theme.
- It must carry composed, alpha-baked tokens for pairs whose alpha differs per theme. v23
  measured 169 of 225 adjacent same-utility pairs doing exactly this. **A theme-invariant
  opacity modifier cannot express "opaque navy in light, 20% cyan in dark."**
- **Naming rule, binding:** a token key may never begin with a utility prefix.
  `border-accent` compiles to `.border-border-accent`, while `.border-accent` silently
  resolves to the base `accent` role. This bit the v23 design twice and is invisible from
  reading the config.
- It is reviewed as a Child A artifact before any file changes.

### 8.1a Child A was split into A1 and A2

Recorded 2026-08-08, **after** this document's re-approval, so it is a disclosed
post-approval change like the nine before it.

Child A went through six adversarial rounds without approval. The finding that ended the loop
was a *composition* failure — the theme gallery's three intended fixtures (the swatch
inventory, an open `CueDialog`, and `PlannerGrid` in full screen) occlude and inert one
another, and no stated assertion could see it. That is the signature of one artifact carrying
two separable outcomes, so it was split:

- **[A1 — measurement](../plans/2026-08-08-light-mode-A1-measurement.md):** the colour
  inventory and its guard, the reconciliation, the palette-family analysis and token
  vocabulary, both `brand.css` guards, and `.light { color-scheme }`. **No route**, which is
  what keeps the trust boundary out of measurement work.
- **[A2 — rendering](../plans/2026-08-08-light-mode-A2-rendering.md):** the gated gallery route
  and its composition (one fixture per route), fixture hosting, the read-only VR harness and
  its credential question, the `redesign/explore` polarity review, and this document's AA-gate
  inputs.

**Every "A" row in §12 and every "A" in the sequencing diagram below should be read as "A1
and/or A2".** The split was verified to drop none of them.

### 8.2 Sequencing and prerequisites

```
A ──> B ──> C ──> D ──> E ──> F
```

Strictly sequential. Each child's outputs are the next child's inputs:

- **A → B:** the inventory *is* B's mapping table; the vocabulary is B's target; the
  `brand.css` guard is what makes B's variable rename mechanical rather than hopeful.
- **B → C:** C's lint clauses land per family and cannot be authored until B's token layer
  exists.
- **C → D:** D's `brand.css` `.light` guard self-activates on the first `.light` custom
  property and then demands a counterpart for *every* `:root` colour property, so D cannot
  be merged incrementally.
- **D → E:** E exposes what D designed. Exposing before D is exposing the broken state.
- **E → F:** F needs a volunteer week of real usage on E.

**No child may be skipped or run in parallel.** The one genuine parallelism — C's colour
families — is internal to C.

### 8.3 Integration acceptance

Accepted when, and only when:

1. A member can select Claro or Oscuro and **every** screen renders correctly in both.
2. The WCAG AA contrast matrix passes across the ink × surface matrix in **both** themes,
   including composited surfaces.
3. `npx eslint .` reports 0 errors with the colour ban rule fully staged in.
4. No file in scope contains a colour literal outside the reviewed exempt list.
5. An open `CueDialog` and `PlannerGrid`'s full-screen view render correctly in both themes
   (§4.4).
6. Song lyrics at `/posts/[slug]` render correctly in both themes on a real device.
7. iOS cold start paints correctly with no inversion flash; the status bar is readable in
   light — subject to A6's fallback.
8. ADR-0008 is superseded.

### 8.4 The theme gallery is gated, and reachable in production

Amended 2026-08-07, after this document's first approval.

The gallery sits on a **gated** path — not under `/auth/`, not public. Consequences, recorded
so none of them is discovered later:

- **It is deployed to production and reachable there by any signed-in team member.** It
  renders colour swatches and nothing else: no session read of its own, no fetch, no data.
  An earlier revision demanded a production 404, which only existed to contain an
  *unauthenticated* route. That requirement is withdrawn, not quietly dropped.
- **No env flag, no `docs/SECRETS.md` entry, no build-time refusal, no `PUBLIC_ROUTES`
  entry.** All four existed solely to contain the public placement.
- **`routeMatcher.test.ts` must stay green without being edited.** If the gallery ever appears
  in `ungated`, the placement is wrong — the guard is the proof, not a formality.
- **The gate is `proxy.ts`'s middleware check, not `requireActiveSession`.** An earlier
  wording claimed this lets a *disabled* member reach the gallery. **That reason is wrong and
  is corrected here:** `proxy.ts:10–12` redirects any token without `sanityId` to
  `/auth/not-a-member`, and `auth.ts:247` returns `{...token, sanityId: undefined, role: undefined}` for a
  member `getMemberAccess` reports inactive — so a disabled member is turned away from the
  gallery too. The residual gap is narrower and worth naming precisely: `withAuth` reads the
  JWT cookie via `getToken` without running the `jwt` callback, and the gallery's
  provider-less root layout mounts no `SessionProvider`, so visiting it triggers no session
  refresh and a **stale cookie** can outlive a deactivation there. Exposure is still nil —
  the page is colour swatches — but the gallery does not run the in-handler guard `/me` and
  `/admin` run, and this document does not claim it does.
- **The VR harness must authenticate.** That cost is real and belongs to Child A.


## 9. Inherited technical constraints

**Verified mechanism findings** from v23's 30 review rounds and this document's two, recorded
so children inherit them rather than rediscovering them. Children must re-verify before
relying on any of them, per v23's own warning that its conclusions sometimes rested on false
reasons.

- **`brand.css` is outside *lint*, but it is NOT ungated.** Corrected 2026-08-08 (disclosed
  post-approval). `eslint.config.mjs` loads only `eslint-config-next` with no CSS processor, so
  `npx eslint app/brand.css` reports 0 errors, and `tsc` never reads it. **But vitest is not
  blind to it:** `app/components/admin/__tests__/participationAlongside.test.tsx:954` does
  `read("app/brand.css")` and five `it()` blocks assert against its contents, pinning
  `.brand-admin-frame` (`:990`), `.brand-admin-shell` (`:1016`) and
  `[data-route-main]:has(.planner-wide)` (`:1003`), with a rationale CLAUDE.md documents.
  This claim survived ten review rounds across three artifacts before anyone read that file.
  **Children B and D must not treat `brand.css` as unguarded** — two of the classes the
  inventory dispositions are already pinned, and a "cleanup" that breaks those regexes turns
  `npm test` red. A `var()` referencing an undeclared property is invalid
  at computed-value time and is **dropped silently**, taking `.brand-atmosphere`'s body wash
  or `.brand-surface`'s inset highlights with it. The guard that asserts every referenced
  colour `var()` is declared is what makes Child B mechanical.
- **The `brand.css` guard has two distinct assertions; do not conflate them.**
  (a) *Reference integrity* — every colour `var(--x)` referenced is declared. (b) *Theme
  parity* — every **colour** `:root` custom property has a `.light` counterpart or sits on a
  reviewed theme-invariant allowlist. Parity is scoped to **colour** properties: four of the
  11 `:root` properties are non-colour (`--brand-radius-panel`, `--brand-radius-control`, two
  `--brand-duration-*`, `brand.css:10–13` — note `:9` is `--brand-steel`, a colour), and an unscoped parity assertion would demand a
  nonsense `.light --brand-radius-panel`. Child A owns (a); (b) self-activates in Child D.
- **The declaration set is `brand.css` only — an earlier revision of this section said "a
  union" with `tailwind.config.ts`, and that was false on both halves.** Corrected 2026-08-08
  (disclosed post-approval). `tailwind.config.ts:15–21` declares **zero** custom properties; it
  only *references* the same variables through seven `brand.*` keys. Treating it as a
  declaration source makes every `--brand-*` self-declaring, so the guard goes permanently
  green against exactly the rename it exists to catch. And a `brand.css`-scoped guard does
  **not** "fail today" — verified green. `tailwind.config.ts` belongs to the **reference** set.
  Separately, `selection:bg-brand-beam/35` on both root layouts consumes the `brand.beam`
  **key**, not a `var()`, so no `var()`-integrity guard covers it — that failure is Child B's
  to guard, since B is the change that removes the key.
- **`brand-` means two things and only one is retired.** The 213 colour utilities are
  retired; the **17 `.brand-<component>` compositing classes** are kept, and the **15 of them
  that carry colour** are given light counterparts in Child D. **Corrected 2026-08-08
  (disclosed post-approval):** `.brand-admin-frame` and `.brand-admin-workspace` declare no
  colour in any rule body, so neither needs one. The figure is A1's generated
  `lightCounterpartClasses`, not a hand-count. A regex on `brand-` strips `brand-atmosphere` off both root
  layouts' `<body>`.
- **Scans must not be line-anchored, and must not stop at `.tsx`.** `brand-admin-frame`
  (`brand.css:322`, post-A1) is indented and nested, so `^\.brand-` misses it — that is why the class
  count is 17, not 16. `serviceCardModel.ts` holds 56 colour decisions in a `.ts` file. Both
  are inventory-glob failures, not judgement calls.
- **`vitest.config.ts:15` includes only `app/**`, `scripts/**`, `e2e/**`.** A guard placed
  outside those roots never matches and never runs — a silent no-op, not a failure. All new
  guards go under `app/utils/__tests__/`.
- **`theme.extend.typography` is load-bearing, not stylistic.** A top-level
  `theme.typography` *replaces* the plugin stylesheet; v23 measured the compiled prose CSS
  collapsing from ~36.8 KB to ~187 bytes with zero `prose-sm` rules. `/posts/[slug]` uses
  `prose prose-sm sm:prose`, so song lyrics would render unstyled, silently.
- **The prose mapping must match the token storage convention, and the convention decides
  which form is correct.** D3 stores base roles as **triplets** (`--ink-rgb: 215 231 246`),
  consumed as `rgb(var(--ink-rgb) / <alpha-value>)` — the convention `brand.css` already
  uses. Under that convention the correct mapping is **`--tw-prose-body:
  rgb(var(--ink-rgb))`**, and `var(--ink)` is what gets dropped unless a full-colour alias
  `--ink` is also declared. v23 prescribed the opposite pairing, which is right only if the
  bare name holds a complete colour function. **Child A must state the convention once, and
  Child B must map prose to whichever form that convention makes valid** — getting it
  backwards reintroduces the unstyled-lyrics regression with no build or lint signal.
- **The obvious prose assertion is vacuous.** "The compiled prose block contains no `gray-`
  literal" can never fail: Tailwind resolves `theme(colors.gray[700])` to `#374151` at build
  time. A `#rrggbb`-only pattern is equally vacuous — typography emits five 3-digit `#fff`
  literals and two `rgb(… / 10%)` kbd shadows.
- **Decide comment handling explicitly.** A source-text lint or inventory rule fires on colour
  tokens inside comments — `PlannerGrid.tsx:1497` names `#010b17` in prose, and
  `brand.css:265,269` name `.brand-admin-shell` — while an AST rule does not. The repo already
  ships `stripComments` (`app/utils/protectedReadAudit.ts:415`) for exactly this class of
  problem; reuse it rather than inventing a second answer.
- **`.light` must be declared AFTER `:root` in `brand.css`.** Both selectors have specificity
  (0,1,0), so the light override depends entirely on source order — and the theme-parity guard
  checks presence, not order. A `.light` block placed above `:root` passes every gate and
  themes nothing.
- **Lint regex traps.** Ban `rgb(`/`rgba(`/`hsl(` **only when not followed by `var(`** —
  `(rgba?|hsla?)\((?!\s*var\()` — or the rule forbids its own prescribed fix. Do **not**
  anchor with `\b`: `_` is a word character, so `\b(rgba?)\(` fails to match
  `shadow-[0_0_0_1px_rgb(0_191_255/0.45)]`. Add clauses under an explicit
  `files: ["app/**"]` block — `eslint.config.mjs`'s rules block has no `files` key (verified:
  its only one is `["e2e/**"]` at `:42`). The exempt list needs an explicit `ignores`
  carrying `app/utils/emailShell.ts`, `app/**/__tests__/**`, the Google logo lines, and
  `(client)/layout.tsx`'s static `themeColor` until Child E makes it dynamic.
- **Test files must be migrated with the code they assert**, and are lint-exempt.
  `globalIgnores` does not exclude tests, **four** already carry hex, and the contrast matrix
  and computed-colour tests *must* name colours by value.
- **next-themes 0.4.6 makes a nested `ThemeProvider` a literal pass-through**
  (`useContext(L) ? Fragment : X`), so `forcedTheme="dark"` cannot be overridden from inside
  `(client)`. The theme gallery therefore needs its own root layout with no provider — which
  is also why `brand.css` needs a class-keyed `color-scheme` branch, since the gallery
  removes the inline `documentElement.style.colorScheme` that currently masks the dark-only
  declaration.
- **The provider's unset default is `"light"` today, not `"dark"` — removing `forcedTheme`
  alone ships the inverse of D4 and D8.** next-themes 0.4.6 resolves
  `defaultTheme = enableSystem ? "system" : "light"`, and
  [`Provider.tsx:16`](../../../app/utils/Provider.tsx) passes `enableSystem={false}` with
  **no `defaultTheme`**. Seeding is `localStorage.getItem(key) || defaultTheme`, so an unset
  member resolves to **`"light"`**. Child E must therefore add an explicit
  **`defaultTheme="dark"`**; "remove one line" is not the change. The derived requirement
  that the `/me` control binds to the **server** `themePref` (invariant 14) still holds —
  but it holds because the client seed is not the source of truth, not because that seed is
  `"dark"`.
- **`enableSystem={false}` blocks Child F's outcome, and fails silently.** With it false,
  `themes` is `["light","dark"]` and `"system"` is never offered; applying `"system"` anyway
  runs `classList.add("system")` after stripping `light`/`dark`, leaving **no theme class at
  all** and no error. Child F must flip `enableSystem` to `true` as part of moving the
  default to Follow System — it is not a cosmetic label change.
- **`setTheme` has no falsy guard** — `setTheme(undefined)` writes the string `"undefined"`
  and `classList.add("undefined")` sticks permanently.
- **`ios/App/App/Info.plist:59–60`** already sets `UIViewControllerBasedStatusBarAppearance`
  to `false`, the precondition for `@capacitor/status-bar`'s runtime `setStyle` to apply
  app-wide.

## 10. Assumptions

| # | Assumption | Impact if false | Validation point |
|---|---|---|---|
| A1 | The 2,397 / 64-file inventory is stable enough to plan against. | Children B and C grow. | Child A's generated inventory is authoritative and re-derives it. Counts moved four times during v23's review and again since; **hand-counts in this document are provisional by construction.** |
| A3 | Every colour-bearing source is reachable by Child A's globs. | Sites migrate by guesswork or not at all. | Child A. Globs must cover `app/**/*.{tsx,ts,mjs,css}` minus `__tests__`, must not be line-anchored, and the exclusion of anything found must be recorded rather than silent. |
| A4 | The colour lint ban can cover the whole of `app/**` with only the four reviewed exemptions. | Drift returns. | Child C. The rule must fail on a new literal in any non-exempt file. |
| A5 | `#00bfff` is the accent in **both** themes. | **Believed false already.** Measured: `#00bfff` on `#ffffff` is **2.12:1**; against `#010b17` it is **9.32:1**. It fails AA for text and UI components on any light surface, so D6 is a dark-side decision only. | Child D must design a distinct light accent and must not reuse `#00bfff` for foreground roles on light surfaces. |
| A6 | `@capacitor/status-bar` can be added and verified on a real device. | §8.3 item 7 blocks. **Verified: the plugin is not in `package.json` today**, and CLAUDE.md records Apple Developer enrollment as in progress. | Child E must add it and run `npx cap sync` plus a native rebuild. **Fallback:** ship E without the plugin, leave the native bar at its `Info.plist` default, record it as a known remnant. The web surface is unaffected; this must not block the delivery. |

## 11. Nothing is deferred

The member-first deferral was considered, specified, reviewed twice, and rejected on the
evidence in §4.1. There is no follow-on colour scope after Child F.

What *is* deferred is the **default**, not the surface: Child F stages unset → Follow System
after a volunteer week (D8). See invariant 16.

## 12. Requirement → child coverage

Every requirement has exactly one primary owner. Cross-cutting verification is marked.

| Requirement | Primary | Also verified by |
|---|---|---|
| Generated colour inventory + snapshot guard (globs per A3) | A | — |
| Token vocabulary, reviewed (§8.1) | A | B applies it |
| `brand.css` reference-integrity guard | A | B relies on it |
| `brand.css` theme-parity guard, colour-scoped, staged | A authors | D activates |
| Theme gallery, on a **gated** route (§8.4) | A | `routeMatcher.test.ts` proves the gating, unedited |
| Gallery must be able to host an open `CueDialog` (§4.4) | A | D exercises it |
| Read-only Playwright config + its ADR | A | — |
| `redesign/explore` / `7af69d8` polarity review | A | — |
| `.light { color-scheme: light }` branch | A | D |
| Surface-nesting map + dark composited failing set | A | re-derived at every C family merge |
| Token layer in `brand.css` + `tailwind.config.ts` | B | — |
| Hex + `brand-*` → tokens, whole surface | B | — |
| `serviceCardModel.ts` (non-JSX) migration | B | — |
| `(admin)/layout.tsx` token migration | B | D authors its light values; it can only *follow* the theme at E, when `forcedTheme` goes |
| 33 `.brand-*` rule bodies off retired variables | B | — |
| Typography theme + `dark:prose-invert` removal | B | E verifies on device |
| Computed-colour equality per migrated site | B | — |
| Raw palette + `white`/`black` → roles | C | — |
| Colour lint rule, staged per family, with its `ignores` list | C | B lands the first clauses |
| `.light` values for all colour tokens | D | — |
| Light counterparts for the **15** colour-carrying `.brand-*` classes (of 17 — generated) | D | — |
| Distinct light accent value (A5) | D | AA matrix |
| WCAG AA matrix, both themes | D | integration acceptance |
| Open-dialog and full-screen-planner rendering, both themes | D | E on device |
| A light-capable host for D's two-theme checks while `forcedTheme` is still in force | **A** | D consumes it. The gallery route param is the mechanism — nothing else can render light before E |
| `themePref` schema + Studio deploy | E | — |
| `GET /api/me` projection + write route (D15) | E | — |
| `/me` control bound to server `themePref` | E | — |
| `localStorage` mirror, sign-out, impersonation isolation | E | — |
| Remove `forcedTheme` **and add `defaultTheme="dark"`** (§9) | **E** | F depends on it |
| Theme-responsive `themeColor` + `statusBarStyle`, **client-side only** (invariant 17) | **E** | — |
| iOS status bar (A6) | E | — |
| Unset stays distinguishable (invariant 14) | E | F depends on it |
| **Flip `enableSystem` to `true`** (§9) | **F** | ✅ delivered 2026-08-12 |
| Default → Follow System; Spanish announcement | F | ✅ delivered 2026-08-12 |
| ADR-0008 superseded | F | ✅ [ADR-0016](../../adr/0016-light-mode-revived-by-tokenisation.md), 2026-08-12 |
| `DATA_MODEL.md`, `API_REFERENCE.md`, `ROUTES.md`, `UTILITIES_AND_COMPONENTS.md` | owning child | docs audit at each merge |
| CLAUDE.md + AGENTS.md invariants, mirrored | B | guard 9 enforces |

## 13. Open questions

| # | Question | Blocking? | Owner | Bounded default |
|---|---|---|---|---|
| Q1 | Per-family mapping of `yellow` / `orange` / `amber` onto `warning-*`. `red` → `negative-*` is settled in family. | **No** — Child A's family analysis produces it, reviewed before C ships. | A | Separate roles per family until the analysis proves collapse is safe. |
| Q2 | Placement and copy of the Spanish announcement. | **No** | F | In-app banner on `/me`, drafted at F. |

**No blocking open questions remain.** Scope (D12) and admin chrome (D14) were decided by
the user on 2026-08-07.

## 14. Relationship to ADR-0008

ADR-0008 rejected the revival "on time, not on merit," and named the maintenance cost of two
palettes as the constraint that must change.

**The constraint this delivery changes is tokenisation.** Components lose the ability to name
a palette, so the drift mechanism is removed rather than out-run. ADR-0008 named the cheap
revival — re-adding `dark:` variants — and this design rejects it for the same reason:
238 of 251 existing variants carry a hex literal, so that path scales the drift.

ADR-0008 is superseded **fully** on completion of Child F. **Done — 2026-08-12, by
[ADR-0016](../../adr/0016-light-mode-revived-by-tokenisation.md)**, which carries the §4.1
record required below.

The superseding ADR must also record §4.1: that a partial-surface revival was specified,
reviewed and rejected because containing an unthemed island is not achievable against
body-level portals — and that light mode therefore ships whole (invariant 16).

---

## Terminal state

**`READY_FOR_ADVERSARIAL_REVIEW`**

Self-contained, with no unresolved blocking unknowns.

**Risk tier: Standard — one fresh cold `APPROVED`.** Derived from the ladder: CLAUDE.md
holds that parent roadmaps stay standard unless they *directly own* a critical contract.
This document states requirements and assigns them; the critical contracts belong to
Children A and E, which carry that tier themselves (§8).

**Child review order:** this parent first. Children are written only after it is approved,
then reviewed in dependency order A → B → C → D → E → F.

**Review readiness is not approval. Plan approval is not authorization to implement.**
