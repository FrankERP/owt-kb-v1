# Scope spec: Light mode, member surface first

**Date:** 2026-08-07
**Status:** Draft — not reviewed, not approved, not authorization to implement
**Artifact level:** Parent scope spec. Defines *what must be true*. Child implementation
plans are written only after this document is approved.
**Supersedes as the scoping authority:** `2026-07-29-light-mode-role-tokens-design.md`
(v23). That document is retained for its verified mechanism findings (§ "Inherited
technical constraints" below cites them individually); its scope, phasing, counts and
vocabulary are replaced by this one.
**On completion, supersedes:** [ADR-0008](../../adr/0008-forced-dark-theme.md), partially —
see "Relationship to ADR-0008".

---

## 1. The request

> "Rewrite the light-mode re-activation plan into correctly scoped plan(s), then go for
> the adversarial review."

Originating ask, from the session that produced v23: *bring light mode back*.

No sensitive values appear in this request or in this document. Colour literals are
design values, not secrets.

## 2. Primary outcome and who it is for

**Outcome:** a member of the Oasis Worship Team can choose Claro or Oscuro (later, Seguir
sistema) and the app they use — song library, lyrics, setlists, availability, proposals,
profile — renders correctly and legibly in the theme they chose.

**Primary user:** the ~40 volunteer team members, on phones, frequently in daylight.
**Not** the 1–3 administrators, whose screens are explicitly deferred (§5).

**Secondary outcome, and the one that makes this different from the revival ADR-0008
buried:** components in the themed surface lose the ability to name a colour at all. A
panel added six months from now is light-correct by construction, not by remembering.

## 3. Current behavior and the gap

`app/utils/Provider.tsx:16` sets `forcedTheme="dark" enableSystem={false}`, which overrides
both user and system preference. `ThemeSwitch.tsx` was deleted in `33c6e15`. There is no
light path to return to: `app/brand.css` declares `:root { color-scheme: dark }` at line 2
with **no `.light` branch and no `prefers-color-scheme` query**, and 11 `:root` custom
properties with no light counterparts.

Measured on `main` today, `app/**/*.tsx` excluding `__tests__`:

| Colour source | Count | Themeable today |
|---|---:|---|
| Bracketed hex (`text-[#00bfff]`) | 1,231 across 46 files | No |
| Bare hex — inline styles, SVG attrs, runtime constants | 27 | No, and not via CSS vars either |
| Raw palette classes — `gray` 470 · `red` 189 · `amber` 88 · `yellow` 47 · `green` 44 · `orange` 20 · `purple` 14 · `blue` 9 | 881 | No |
| `text-white` / `bg-black` etc. | 45 | No |
| `brand-*` colour utilities | 213 | Yes |
| **Total** | **2,397 across 64 files** | **~9% tokenised** |

Of the 241 `dark:` variants across 39 files, the great majority carry a hex literal on
both sides — v23 measured 238 of 251 at its own baseline. **The existing "light path" is
itself hardcoded.** This is the mechanism ADR-0008 records: light was never dropped on
aesthetic grounds, it stopped being maintained, and re-adding `dark:` variants rots on
exactly the same schedule.

## 4. The scoping decision, and its evidence

Splitting the 2,397 decisions by render surface:

| Surface | Decisions | Files |
|---|---:|---:|
| Admin panels (`components/admin/`, `(client)/admin/`, `(admin)/`) | **1,309 (55%)** | 18 |
| Member-facing and shared shell | **1,088 (45%)** | 46 |

The nine densest files in the repository are admin panels — `MonthGenerator.tsx` (302),
`ServicesPanel.tsx` (130), `PlannerGrid.tsx` (124), `AdminPanel.tsx` (113),
`ProposalsPanel.tsx` (103). Over half the rewrite, and the half that collides hardest with
active feature development, is on screens that three people see.

**Decision: the first delivery covers the member surface. Admin panels are deferred,
explicitly and visibly, not silently.** Approved by the user, 2026-08-07.

This is the option v23 §10 never priced. It keeps the token architecture whole, so the
deferred admin work is a continuation of the same mechanism rather than a second design.

### 4.1 The boundary is render context, not permission

A component is in scope if it can render **inside the themed `(client)` shell**, whatever
role is required to reach it. `EditSongButton.tsx` (76) and `SongSheet.tsx` (75) are
content-editor tools, but they render on member pages inside the themed shell, so a
hardcoded-dark button on a light page is a visible defect. They are in scope.

The single exception is the `/admin` subtree, which is carved out by §4.2.

### 4.2 Derived requirement: the `/admin` subtree must be pinned dark

This does not follow from the user's answers taken singly, and it is the most important
structural finding in this document.

`app/(admin)/` contains **only** `/studio` (verified: its three files are `globals.css`,
`layout.tsx`, `studio/[[...tool]]/page.tsx`). The admin **panels** render at
[`app/(client)/admin/page.tsx`](../../../app/(client)/admin/page.tsx), which imports
`AdminPanel` and sits inside the `(client)` root layout — the shell this delivery themes.

So without an explicit carve-out, an administrator in light mode gets a light shell
wrapping 1,309 hardcoded-dark decisions. Worse, the shared components used *inside* those
panels — `DayCard.tsx` (65), `CalendarView.tsx` (71), `AvailabilityCalendar.tsx` (96) — are
in scope and would render light *within* a dark panel. That is a broken screen, and it is
precisely the state ADR-0008 exists to prevent.

**Requirement:** the `/admin` route subtree renders dark in both themes until the deferred
admin migration lands. Because polarity is dark-in-`:root` / light-under-`.light`
(Decision D4), the pin must **re-declare the dark token values on a wrapper element** in
the `/admin` subtree, so tokenised shared components inside it resolve dark. Removing a
class from `<html>` cannot achieve this. The mechanism, its test, and its removal
condition belong to Child C.

### 4.2a Three `.brand-*` compositing classes are admin-only

Verified: of the 16 `.brand-*` base classes in `brand.css` (29 selector lines including
pseudo-elements and states), three are consumed **only** by the deferred surface —
`brand-admin-shell` (`(client)/admin/page.tsx:41`), `brand-admin-tabs`
(`AdminPanel.tsx:392`) and `brand-admin-workspace` (`AdminPanel.tsx:634` and four more).

This collides with two rules children would otherwise inherit unexamined:

- the `brand.css` guard requires a `.light` counterpart for every `:root` custom property;
- Child D's rule bans raw colour literals inside `.brand-*` rules, which fires on the six
  pure-black shadows those classes share with the rest.

Under D13 these three classes render only inside a subtree pinned dark, so light
counterparts for them would be unreachable code that the guard nonetheless demands.
**Child D must resolve this explicitly** — either an allowlist entry naming them as
pinned-surface classes with a reason, or light values authored and left unused. Either is
acceptable; discovering it mid-implementation is not.

### 4.3 `(admin)` chrome around `/studio` follows the theme

Per the user's decision, `app/(admin)/layout.tsx` — currently
`brand-atmosphere min-h-screen bg-brand-blackout font-body text-brand-frost
selection:bg-brand-beam/35` on `<body>` (`:42`) — moves onto themed tokens and follows
`themePref`. The Sanity Studio panel itself stays out of scope (D10), so light mode
produces a light chrome around a dark Studio panel. **This is an accepted, documented
outcome, not a defect to be filed later.**

Note this is a different surface from §4.2: `(admin)` is the Studio wrapper; the panels are
in `(client)`. v23 §9 item 4 conflated them, which is why it read as one blocking question
when it is two.

## 5. Scope

### In

- The 46 member-surface files and their 1,088 colour decisions.
- `app/brand.css` in full: the token layer, the `.light` branch, all 16 `.brand-*`
  compositing classes (29 rules including pseudo-elements) and their light counterparts.
- `tailwind.config.ts` colour configuration, both token layers, and the typography theme.
- `app/(admin)/layout.tsx` chrome (§4.3).
- The `/admin` dark pin and its guard (§4.2).
- `themePref` on `teamMembers`, its write route, the `/me` control, the `localStorage`
  mirror, dynamic `viewport.themeColor`, the iOS status bar.
- Verification scaffolding: colour inventory, snapshot guard, `brand.css` guard, theme
  gallery, read-only Playwright config, WCAG AA contrast gate, the colour lint rule.

### Out, deliberately

| Excluded | Why | Recorded as |
|---|---|---|
| The 18 admin panel files, 1,309 decisions | §4, deferred delivery | Follow-on scope, §11 |
| Sanity Studio's internal theming at `/studio` | Third-party surface | D10 |
| Email templates | Deliberately light; five attempts to hold dark against Outlook for Mac failed | CLAUDE.md landmine, `docs/NOTIFICATIONS.md` |
| `manifest.webmanifest` `theme_color` / `background_color`, PWA splash | A static file cannot follow a per-user runtime preference | Permanent documented remnant |
| `mobile/fallback/index.html` | Capacitor offline page, shown before any preference can be read; outside `app/**` so outside inventory, codemod and lint | Permanent documented remnant |
| `ios/App/App/Info.plist:57–58`, `android/…/values/styles.xml:7–8` | Native launch colours, statically pinned | Permanent documented remnants |
| Raster brand assets — `/icons/backstage-v2-*.png`, `/LogoOasis.png` | Opaque `#010b17` tile marks, outside every glob | Decision, not omission |
| `app/utils/emailShell.ts` | The email palette is deliberately light | Lint exempt, by design |
| Building lint/test CI | `.github/workflows/` holds one cron file; no PR gate exists (CLAUDE.md mandates direct push) | Guards ride the existing `npm test` done-gate |

## 6. Invariants that must remain true

**Repository invariants** (from CLAUDE.md; violating any of these fails the delivery):

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
7. **`preview` writes to the real Sanity dataset and emails the real team.** It is not a
   dry run.

**On-disk guards that will fail `npm test` if this delivery forgets them** — all three are
real and currently green:

8. `app/utils/__tests__/routeMatcher.test.ts:52` asserts `ungated` equals `PUBLIC_ROUTES`
   (`:34–42`) by walking `app/` on disk. **Any new unauthenticated route breaks `npm test`
   the moment it exists.** The theme gallery is such a route. This is the auth review, not
   a formality.
9. `app/utils/__tests__/agentDocsParity.test.ts` asserts `CLAUDE.md` and `AGENTS.md` are
   byte-identical after normalisation. Both must be edited in the same commit.
10. `app/utils/__tests__/adrIndex.test.ts` requires every `docs/adr/NNNN-*.md` to be linked
    from `docs/adr/README.md`, match `/^# ADR-\d{4}: .+/`, carry a `**Date:** … **Status:**`
    line, and number consecutively from 0001.

**Product invariants:**

11. Timezone `America/Mexico_City`; service dates render pinned to local noon. Untouched by
    this work, but any test fixture added here must not regress it.
12. Member-facing reads filter `published != false`.
13. `themePref` is **member-only** and never appears in `MemberForm` (D13).
14. **Unset must stay distinguishable from an explicit choice.** The staged default flip
    (Child F) is a silent no-op otherwise. Nothing may write a default `themePref` to
    Sanity on first render.
15. `/api/cron/*` stays excluded from the `proxy.ts` matcher; the matcher is duplicated in
    `app/utils/routeMatcher.ts` and the two stay byte-identical.

## 7. Decisions

Inherited from v23 and re-affirmed, or taken in this document. Each is binding on children.

| # | Decision | Choice | Source |
|---|---|---|---|
| D1 | Anti-drift mechanism | Role-based tokens. Components in scope stop naming palettes. | v23 |
| D2 | What light mode is | Counterpart design, not mechanical inversion. Glow has no light equivalent. | v23 |
| D3 | Vocabulary | Two layers — base roles as `rgb(var(--x-rgb) / <alpha-value>)`, plus composed tokens with alpha baked per theme. **The vocabulary itself is an output of Child A, not a fixed list here** (§8.1). | This doc, amending v23 |
| D4 | Polarity | Dark in `:root`, light under `.light`. Backstage ships unset→Dark, so dark is the base. | v23 |
| D5 | Sequencing | Tokens first, light second, the setting last. | v23 |
| D6 | Accent | `#00bfff` wins. `--brand-beam` `#12C8F4` is retired. | v23 |
| D7 | Persistence | Server-persisted `themePref` on `teamMembers`, mirrored to `localStorage` so `next-themes` paints before hydration. | v23 |
| D8 | Default | Unset → Dark at ship; staged to Follow System later, after a volunteer week. | v23 |
| D9 | Ship gate | WCAG AA across the ink × surface matrix, plus the colour lint rule, plus the staged default. | v23 |
| D10 | Studio | Sanity Studio's internal theming is out of scope. | v23 |
| D11 | Admin editability | `themePref` is member-only, never in `MemberForm`. | v23 |
| D12 | **Scope** | **Member surface first. 18 admin panel files deferred.** | This doc, user 2026-08-07 |
| D13 | **`/admin` subtree** | **Pinned dark in both themes via a wrapper that re-declares dark token values.** | This doc, derived (§4.2) |
| D14 | **`(admin)` chrome** | **Follows the theme. Light chrome around a dark Studio panel is accepted.** | This doc, user 2026-08-07 |
| D15 | **`themePref` delivery** | Extend the **existing** `GET /api/me` projection. A JWT claim is unsafe — the session carries a 30s-TTL `{_id, disabled, role}` projection. | This doc, correcting v23 |

## 8. Child decomposition

Six children. Each has a distinct acceptance contract, a coherent change boundary,
independently verifiable completion, a safe end state, and its own rollback boundary —
which is the test for splitting. They are **not** split because the document was long.

| Child | Outcome | Safe end state | Rollback boundary |
|---|---|---|---|
| **A — Verification scaffolding** | The inventory, the guards, the gallery, the VR harness exist. | No user-visible change. App is dark-only, unchanged. | Revert; nothing user-facing moved. |
| **B — Token layer + hex/`brand-*` migration** | Member-surface hex and `brand-*` utilities resolve through tokens. Dark values byte-identical. | Dark-only app, visually identical except the enumerated normalisations. | Atomic. Tag before; a half-migrated token layer compiles and renders wrong. |
| **C — Palette families + `/admin` pin** | The ~881 raw palette classes and 45 `white`/`black` in scope resolve through roles; `/admin` pinned dark. | Dark-only, per-family visual deltas enumerated and reviewed. | Per colour family; each family independently revertible. |
| **D — Light counterpart design** | `.light` carries a designed counterpart for every token and all 16 `.brand-*` classes. | Light values exist but are **unreachable** — `forcedTheme="dark"` still in force. | Atomic. Tag before; the `brand.css` guard demands a full counterpart set. |
| **E — The setting** | `themePref`, the `/me` control, the mirror, `forcedTheme` removed, `themeColor`, iOS status bar. | Light mode reachable. Unset → Dark. | Re-add `forcedTheme="dark"`: one line, instant. |
| **F — Staged rollout** | Default moves unset → Follow System; Spanish announcement. | Members on system preference. | Revert the default constant. |

### 8.1 Why the token vocabulary is a Child A deliverable, not a section here

v23 froze a provisional 34-role vocabulary in §3.1 and simultaneously declared it "a floor"
that Phase 0's palette analysis may extend (§3.1a, Decision 3). Reviewers hit that
contradiction repeatedly: a frozen list that is explicitly not frozen cannot be reviewed.

Here, the vocabulary is an **output of Child A with acceptance criteria**, not an input:

- It must represent every (family, shade) pair the inventory finds, or explicitly record
  each collapse with its site count and a rationale.
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

### 8.2 Sequencing and prerequisites

```
A ──> B ──> C ──> D ──> E ──> F
```

Strictly sequential. Each child's outputs are the next child's inputs:

- **A → B:** the inventory *is* B's mapping table; the vocabulary is B's target; the
  `brand.css` guard is what makes B's variable rename mechanical rather than hopeful.
- **B → C:** C's lint clauses land per family, and cannot be authored until B's token layer
  exists.
- **C → D:** D's `brand.css` `.light` guard self-activates on the first `.light` custom
  property and then demands a counterpart for *every* `:root` property, so D cannot be
  merged incrementally.
- **D → E:** E exposes what D designed. Exposing before D is exposing the broken state.
- **E → F:** F needs a volunteer week of real usage on E.

**No child may be skipped or run in parallel.** The one genuine parallelism — C's colour
families — is internal to C.

### 8.3 Integration acceptance

The delivery as a whole is accepted when, and only when:

1. A member can select Claro or Oscuro and every in-scope screen renders correctly in both.
2. The WCAG AA contrast matrix passes across the ink × surface matrix in **both** themes,
   including composited surfaces.
3. `npx eslint .` reports 0 errors with the colour ban rule fully staged in.
4. No in-scope file contains a colour literal outside the reviewed exempt list.
5. `/admin` renders dark in both themes, and a test asserts it.
6. Song lyrics at `/posts/[slug]` render correctly in both themes on a real device.
7. iOS cold start paints correctly with no inversion flash; the status bar is readable in
   light.
8. ADR-0008 is superseded with the residual admin scope named (§11).

## 9. Inherited technical constraints

These are **verified mechanism findings** from v23's 30 review rounds. They are recorded
here so children inherit them rather than rediscovering them. Each was confirmed against
source; children must re-verify before relying on any of them, per v23's own warning that
its conclusions sometimes rested on false reasons.

- **`brand.css` sits outside every gate.** `eslint.config.mjs` loads only
  `eslint-config-next` with no CSS processor — `npx eslint app/brand.css` reports 0 errors.
  `tsc` and vitest are blind to it. A `var()` referencing an undeclared property is invalid
  at computed-value time and is **dropped silently**, taking `.brand-atmosphere`'s body
  wash or `.brand-surface`'s inset highlights with it. The guard that asserts every
  referenced colour `var()` is declared is what makes Child B mechanical.
- **The declaration set is a union.** `tailwind.config.ts:15–21` declares seven `brand.*`
  keys as `rgb(var(--brand-<name>) / <alpha-value>)` — the same variables `brand.css` uses,
  one file over, with live consumers including `selection:bg-brand-beam/35` on **both**
  root layouts. A file-scoped guard both misses the rename and fails today.
- **`brand-` means two things and only one is retired.** The ~213 colour utilities are
  retired; the **16 `.brand-<component>` compositing classes** are kept and given light
  counterparts in Child D. A regex on `brand-` strips `brand-atmosphere` off both root
  layouts' `<body>`.
- **`vitest.config.ts:15` includes only `app/**`, `scripts/**`, `e2e/**`.** A guard placed
  outside those roots never matches and never runs — a silent no-op, not a failure. All new
  guards go under `app/utils/__tests__/`.
- **`theme.extend.typography` is load-bearing, not stylistic.** A top-level
  `theme.typography` *replaces* the plugin stylesheet; v23 measured the compiled prose CSS
  collapsing from ~36.8 KB to ~187 bytes with zero `prose-sm` rules. `/posts/[slug]` uses
  `prose prose-sm sm:prose`, so song lyrics would render unstyled, silently.
- **`--tw-prose-body: var(--ink)`, not `rgb(var(--ink))`** — the latter expands to
  `rgb(rgb(…))`, is not a valid `<color>`, and is dropped.
- **The obvious prose assertion is vacuous.** "The compiled prose block contains no `gray-`
  literal" can never fail: Tailwind resolves `theme(colors.gray[700])` to `#374151` at build
  time. A `#rrggbb`-only pattern is equally vacuous — typography emits five 3-digit `#fff`
  literals and two `rgb(… / 10%)` kbd shadows.
- **Lint regex traps.** Ban `rgb(`/`rgba(`/`hsl(` **only when not followed by `var(`** —
  `(rgba?|hsla?)\((?!\s*var\()` — or the rule forbids its own prescribed fix. Do **not**
  anchor with `\b`: `_` is a word character, so `\b(rgba?)\(` fails to match
  `shadow-[0_0_0_1px_rgb(0_191_255/0.45)]`. Add clauses under an explicit
  `files: ["app/**"]` block — `eslint.config.mjs`'s rules block has no `files` key
  (verified: its only `files` key is `["e2e/**"]` at `:42`).
- **Test files must be migrated with the code they assert**, and are lint-exempt.
  `globalIgnores` does not exclude tests, three already carry hex, and the contrast matrix
  and computed-colour tests *must* name colours by value.
- **next-themes 0.4.6 makes a nested `ThemeProvider` a literal pass-through**
  (`useContext(L) ? Fragment : X`), so `forcedTheme="dark"` cannot be overridden from
  inside `(client)`. The theme gallery therefore needs its own root layout with no
  provider — which is also why `brand.css` needs a class-keyed `color-scheme` branch, since
  the gallery removes the inline `documentElement.style.colorScheme` that currently masks
  the dark-only declaration.
- **`useTheme().theme` returns `"dark"` for an unset member**, since next-themes seeds from
  `localStorage.getItem(key) || defaultTheme`. The `/me` control must bind to the **server**
  `themePref` (invariant 14).
- **`setTheme` has no falsy guard** — `setTheme(undefined)` writes the string `"undefined"`
  and `classList.add("undefined")` sticks permanently.
- **`ios/App/App/Info.plist:59–60`** already sets `UIViewControllerBasedStatusBarAppearance`
  to `false`, the precondition for `@capacitor/status-bar`'s runtime `setStyle`.

## 10. Assumptions

| # | Assumption | Impact if false | Validation point |
|---|---|---|---|
| A1 | The 45/55 member/admin split is stable enough to plan against. | Child B/C scope grows. | Child A's generated inventory re-derives it. Counts have moved every week; the split ratio has not been measured twice. |
| A2 | Shared components used by both surfaces can be tokenised without breaking the pinned `/admin` subtree. | D13's pin mechanism fails and admin screens break. | Child C must prove it with a rendering test, not by inspection. |
| A3 | Deferring admin does not strand a member-reachable screen. | A member hits an unthemed screen. | Child A's inventory must classify every file by render surface, and the classification is reviewed. |
| A4 | The lint ban can be scoped to in-scope files without becoming unenforceable. | Drift returns to the themed surface. | Child C. The scoped rule must fail on a new literal in an in-scope file. |
| A5 | `#00bfff` reads acceptably as the accent on light surfaces. | **Believed false already.** Measured: `#00bfff` on `#ffffff` is **2.12:1**, against `#010b17` it is **9.32:1**. It fails AA for text and for UI components on any light surface, so D6's "`#00bfff` wins" is a *dark-side* decision only. | Child D must design a distinct light accent value and must not reuse `#00bfff` for foreground roles on light surfaces. Recorded here so Child D does not inherit D6 as a both-themes constraint. |

## 11. Follow-on scope, named so it is a decision

**The 18 admin panel files and their 1,309 colour decisions are deferred, not cancelled.**

While deferred:

- `/admin` is pinned dark (D13) and a test asserts it.
- The colour lint ban does **not** cover `components/admin/**`, so those files keep
  drifting. This is the accepted cost of D12 and must be stated in the superseding ADR.
- ADR-0008 is superseded **partially**: the forced-dark decision is lifted for the member
  surface and retained, with a reason, for admin.

A follow-on delivery covering the admin surface reuses Children A–D's mechanism unchanged.
It needs no new architecture.

## 12. Requirement → child coverage

Every requirement has exactly one primary owner. Cross-cutting verification is marked.

| Requirement | Primary | Also verified by |
|---|---|---|
| Generated colour inventory + snapshot guard | A | — |
| Token vocabulary, reviewed (§8.1) | A | B applies it |
| `brand.css` structural guard, staged | A | B, D activate clauses |
| Theme gallery + `PUBLIC_ROUTES` entry + prod 404 | A | — |
| Read-only Playwright config + its ADR | A | — |
| `redesign/explore` / `7af69d8` polarity review | A | — |
| `.light { color-scheme: light }` branch | A | D |
| Surface-nesting map + dark composited failing set | A | re-derived at every C family merge |
| Token layer in `brand.css` + `tailwind.config.ts` | B | — |
| Hex + `brand-*` → tokens, member surface | B | — |
| 29 `.brand-*` rule bodies off retired variables | B | — |
| Typography theme + `dark:prose-invert` removal | B | E verifies on device |
| Computed-colour equality per migrated site | B | — |
| Raw palette + `white`/`black` → roles | C | — |
| `/admin` dark pin + test (D13) | C | E verifies in light |
| Colour lint rule, staged per family | C | B lands the first clauses |
| `.light` values for all tokens | D | — |
| Light counterparts for 16 `.brand-*` classes | D | — |
| Resolution for the 3 admin-only `.brand-*` classes (§4.2a) | D | C's pin makes them unreachable |
| Distinct light accent value; `#00bfff` not reused on light (A5) | D | AA matrix |
| WCAG AA matrix, both themes | D | integration acceptance |
| `(admin)` chrome follows theme (D14) | D | E |
| `themePref` schema + Studio deploy | E | — |
| `GET /api/me` projection + write route (D15) | E | — |
| `/me` control bound to server `themePref` | E | — |
| `localStorage` mirror, sign-out, impersonation isolation | E | — |
| Remove `forcedTheme`; dynamic `themeColor`; iOS status bar | E | — |
| Unset stays distinguishable (invariant 14) | E | F depends on it |
| Default → Follow System; Spanish announcement | F | — |
| ADR-0008 superseded, residual admin scope named | F | — |
| `docs/SECRETS.md` entry for the gallery flag | A | — |
| `DATA_MODEL.md`, `API_REFERENCE.md`, `ROUTES.md`, `UTILITIES_AND_COMPONENTS.md` | owning child | docs audit at each merge |
| CLAUDE.md + AGENTS.md invariants, mirrored | B | guard 9 enforces |

## 13. Open questions

| # | Question | Blocking? | Owner | Bounded default if unanswered |
|---|---|---|---|---|
| Q1 | Per-family mapping of `yellow` / `orange` / `amber` onto `warning-*`. `red` → `negative-*` is settled in family. | **No** — Child A's family analysis produces it, reviewed before Child C ships. | Child A | Separate roles per family until the analysis proves collapse is safe. |
| Q2 | Placement and copy of the Spanish announcement. | **No** | Child F | In-app banner on `/me`, drafted at Child F. |
| Q3 | Does the `/admin` pin also cover `/studio`, or does D14 make `(admin)` fully themed? | **No** — §4.2 and §4.3 answer it: `(admin)` themed, `/admin` pinned. Recorded because the two are easy to conflate. | Settled | — |

**No blocking open questions remain.** The two that blocked v23 — overall scope, and the
admin chrome — were decided by the user on 2026-08-07 and are recorded as D12 and D14.

## 14. Relationship to ADR-0008

ADR-0008 rejected the revival "on time, not on merit," and named the maintenance cost of
two palettes as the constraint that must change.

**The constraint this delivery changes is tokenisation, plus scope.** Components in the
themed surface lose the ability to name a palette, so the drift mechanism is removed rather
than out-run. And by deferring the 55% of the surface that three people see, the delivery
is sized to a repository that is under active development — v23's own baseline moved four
times during its review, with a `SeatBoard` feature landing 39 new hex literals mid-flight,
and the `Tablero` retirement has moved it again since.

ADR-0008 is superseded **partially** on completion of Child F, with the residual admin
scope and the un-enforced lint boundary named explicitly (§11).

---

## Terminal state

**`READY_FOR_ADVERSARIAL_REVIEW`**

This artifact is self-contained and has no unresolved blocking unknowns.

**Risk tier: Critical.** It governs a schema/data migration (`themePref` on `teamMembers`),
a production write route, an auth/trust boundary (a new unauthenticated route, gated by
`routeMatcher.test.ts`), and an irreversible remote release action (Studio schema deploy).
Per CLAUDE.md this requires **two sequential fresh `APPROVED` verdicts on byte-identical
text**, reviewers run one at a time, never exposed to prior findings.

**Child review order:** this parent first. Children are written only after it is approved,
then reviewed in dependency order A → B → C → D → E → F.

**Review readiness is not approval. Plan approval is not authorization to implement.**
