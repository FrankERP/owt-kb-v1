# Design: Light mode via role-based design tokens

**Date:** 2026-07-29
**Status:** Approved (design) — pending implementation plan
**Topic:** Restore light mode as a member-selectable setting (Seguir sistema / Claro / Oscuro), by first migrating the app's colour from hardcoded literals to role-based design tokens.
**Supersedes:** [ADR-0008](../../adr/0008-forced-dark-theme.md) (on completion)
**Revision:** v23 — adversarial review rounds 1–29 (see §11). **Not yet signed off.**

---

## 1. Problem & context

Light mode was never dropped on aesthetic grounds — it stopped being **maintained**.
ADR-0008 records the mechanism: new admin panels shipped dark-only, the light
palette drifted, and forcing dark was the honest way to close the gap. It
explicitly rejects the revival "on time, not on merit," and names that as the
constraint that must change before light mode returns.

**The constraint that changed is tokenisation, not willpower.** A revival that
re-adds `dark:` variants to the lagging files rots on exactly the same schedule.
A revival that removes components' ability to name a palette at all cannot.

### 1.0 How the counts were taken

All figures are `app/**/*.tsx`, excluding `__tests__`. **The inventory, codemod and
lint globs are `app/**/*.{tsx,ts,mjs,css}` minus `__tests__`** — stated once, here,
because "anything not in the mapping table is a build error" otherwise turns
`admin/serviceCardModel.ts` into a 1a build error rather than a table row. **Provisional, like §1.1** — an
independent recount at clean `dafe1e3` gave 1,232 hex across 45 files.

**The tree moved while this spec was being reviewed.** `HEAD` advanced `dafe1e3` →
`ec72b3c` — `01a506a feat(admin): use the seat board for create and edit, drop
ServiceForm`, plus two fixes — landing a **new `SeatBoard.tsx` with 39 bracketed hex
literals and 6 `dark:` variants**, and rewriting `ServicesPanel.tsx`, one of the two
densest colour files. Current totals: 1,198 hex across **45** files. Absolute counts
therefore track active development, and the migration must cover components that did not
exist when this spec was written. The derived claims are stable — the 25 bare-hex delta and
the density ranking both reproduce. This is the strongest argument for §1.0's central
decision: the inventory must be generated, never hand-counted. Command:

```bash
FILES=$(find app -name "*.tsx" -not -path "*__tests__*")
echo "$FILES" | xargs grep -ho '\[#[0-9a-fA-F]\{3,8\}\]' | wc -l   # 1198
echo "$FILES" | xargs grep -l  '\[#[0-9a-fA-F]\{3,8\}\]' | wc -l   # 44
```

Non-JSX `.ts` files add further hex literals in exactly **two** non-test files:
`app/utils/emailShell.ts` (**exempt** — deliberately light, per the email landmine)
and `app/components/admin/serviceCardModel.ts` (**migrated** — its strings feed
`className`). They are excluded from the *counts* above but included in the
*migration*, which is easy to misread; the split is stated plainly here and in §8.

The bracketed pattern `\[#…\]` **misses 25 bare-hex sites** (1,223 total hex
tokens − 1,198 bracketed). Those are not class strings — they are inline styles,
SVG attributes and runtime constants, and they need a different mechanism
entirely (§3.2b).

**The inventory is a generated artefact, not a hand-count.** Three successive
hand-counts in this spec's revision history each understated the surface (§11).
Phase 0's *first* deliverable is a script that emits the complete colour
inventory — every literal, palette class, `white`/`black`, bare hex, inline
style and SVG fill, with file, line and utility context. The mapping table (§4
Phase 1) is that script's output, reviewed.

**How it is enforced — there is no CI to lean on.** `.github/workflows/` contains
exactly one file, `flush-notifications.yml`, a cron that curls a URL; nothing runs
`eslint`, `vitest` or `tsc`, and CLAUDE.md mandates direct push with no PRs, so
there is no PR gate either. The guarantee is therefore a **vitest sync guard**:
the inventory output is committed as a snapshot — keyed on **file + normalised utility +
value multiset, never line numbers** (lines are emitted for humans but excluded from the
assertion, or any unrelated commit that shifts a line in a colour-bearing file turns
`npm test` red on a tree §1.0 documents as moving every few days) — and a test fails when a live scan
diverges from it or from the lint ban list — the same shape as the existing
`routeMatcher.test.ts` guard, riding the `npm test` done-gate that already exists.
Building lint/test CI is out of scope. **The visual-regression suite likewise has
no runner today**, which is why Phase 1's primary proof is equality by
construction and VR is only a backstop.

### 1.0a Baseline at handoff (2026-08-03)

Re-measured on branch `fix/rail-escapes-admin-shell` @ `6862199`:
**1,245 bracketed hex across 47 `.tsx` files**, 249 `dark:` variants,
`app/brand.css` unchanged at **65 `var(--brand-*)` lines / 0 hex literals**.

The `.tsx` figures have drifted from §1.1's 1,198/44 (a `SeatBoard` feature landed
mid-review); the `brand.css` invariants — which every guard assertion in §4 is written
against — have **not** moved. Phase 0's first act is to regenerate §1.1, §1.6, §3.3 and
§3.2b from the inventory script rather than trusting any hand-count in this document.

### 1.1 Measured surface (2026-07-29)

ADR-0008 scoped this as "38 files have `dark:`, 47 don't." That framing assumes
colour mostly lives in a token system with some files lagging. It does not.

> **Provisional, pending Phase 0's generated inventory.** These are hand-counts,
> and independent recounts drift by a few percent depending on regex shape
> (`gray` 460–462, `red` 174–175, `amber` 45–50, `white`/`black` 38–44). The
> orders of magnitude are what the design rests on; the exact figures are §1.0's
> job, not this table's.

| Colour source | Count | Themeable today |
|---|---:|---|
| Bracketed hex literals (`text-[#00bfff]`) | **1,198** across 44 files | No |
| Bare hex — inline styles, SVG, runtime constants (§3.2b) | **25** | No, and not by CSS vars either |
| Raw palette — `gray` 460 · **`red` 174** · `yellow` 55 · `green` 45 · `amber` 45 · `orange` 34 · `purple` 15 · `blue` 9 | **837** | No |
| `text-white` / `bg-black` etc. | **38** | No |
| `brand-*` token usages | ~212 | Yes |
| **Total colour decisions** | **~2,310** | **~9% tokenised** |

**All of it is in scope.** Earlier revisions scoped only hex, leaving ~490
non-hex sites theme-invariant — which in light mode renders dark-palette colour
on light surfaces, i.e. exactly the drift ADR-0008 documents. `red` at 174 uses
is the second-largest family and gets a first-class `negative-*` role.

Highest-density files: `MonthGenerator.tsx` (133), `ServicesPanel.tsx` (122),
`me/propose/[roleId]/ProposalEditor.tsx` (73), `SongFormModal.tsx` (67), `CalendarView.tsx` (51),
`AvailabilityCalendar.tsx` (51), `ProposalsPanel.tsx` (50), `AdminPanel.tsx` (48),
`EditSongButton.tsx` (46), `SetlistEditor.tsx` (45).

### 1.2 Four findings that reshape the job

**(a) The existing "light path" is itself hardcoded.** Of the 251 `dark:`
variants, **238 contain a hex literal**, 12 target Tailwind palette classes, and
**1 is `dark:prose-invert`** (§1.4). The 38 files that "already have a light path"
are the same problem with a second literal attached.

**(b) 75% of light/dark pairs vary their *alpha*, not just their colour.** Of 225
adjacent same-utility hex pairs, **169 carry a different alpha on each side**:

| Shape | Count |
|---|---:|
| `bg-[C] dark:bg-[C]/20` | 32 |
| `border-[C]/30 dark:border-[C]/20` | 30 |
| `hover:bg-[C]/80 dark:hover:bg-[C]/30` | 24 |
| `border-[C]/15 dark:border-[C]/10` | 19 |
| `border-[C]/20 dark:border-[C]/15` | 13 |

**This is the single most important constraint in the design.** If alpha lives in
the utility class (`bg-surface-accent/20`) it is theme-*invariant*, so one class
cannot express "opaque navy in light, 20% cyan in dark." §3.2 resolves it with
composed, alpha-baked tokens. Without that, deleting a `dark:` variant flips dark
from `accent`@20% to `accent`@100% — a real regression on 169 sites.

**(c) The same literal carries different roles in different places.** `#003572`
is a light accent on 162 lines but a *dark-native navy surface* on **41** with no
`dark:` sibling (`bg-[#003572]/50 border-[#00bfff]/50 text-[#00bfff]`). `#78350f`
is a light warning surface at `DayCard.tsx:39` (`bg-[#78350f] dark:bg-[#1c0800]`)
and a dark-native tint at `CalendarView.tsx:392` (`bg-[#78350f]/50`, no sibling).
`#C8D8EB` is muted ink in most places and a *surface* in
`bg-[#C8D8EB]/40 dark:bg-[#010b17]`. **A mapping table keyed by literal alone
cannot be authored** — see §4 Phase 1.

**(d) Two accent cyans, and `#00bfff` won.** `#00bfff` and `--brand-beam`
`#12C8F4` are different colours both used as "the accent." Per the user's
decision, `#00bfff` wins and `--brand-beam` is retired.

### 1.3 Why the palette needs more than a dozen roles

Values that no small vocabulary can represent exactly:

| Current value | Uses | Role required |
|---|---:|---|
| `text-gray-500` / `-400` / `-600` | 223 / 93 / 69 | Three tiers → normalised to two (§3.3) |
| `#C8D8EB` | 61 | `ink-muted` *and* a surface (context-dependent) |
| `#0a1929` | 21 | `surface-raised-alt` |
| `#003572` unpaired | 41 lines | `surface-navy` (distinct from `accent`) |
| `#f59e0b` / `#78350f` / `#92400e` / `#1c0800` | 9 / 5 / 1 / 2 | `warning-fg` / `-surface` / `-border` (fg+surface+border, both themes) |
| `#a78bfa` / `#4c1d95` / `#5b21b6` / `#1e0a3c` | 9 / 5 / 1 / 2 | `info-fg` / `-surface` / `-border` |
| **`#f87171`** (`ServiceReadinessCard.tsx:723`, `color: isConflict ? "#f87171" : accentHex`) | 1 | **`negative-fg`** — appeared in no table until round 26 |
| `#001f3f`,`#001830`,`#00162e`,`#020f1c`,`#002249`,`#03101f` | 18 | `surface-sunken` |

`DayCard.tsx:37–50` is the clearest evidence that states need three roles each:
`border-[#78350f] dark:border-[#f59e0b]` (border),
`bg-[#78350f] dark:bg-[#1c0800]` (surface),
`border-[#92400e] dark:border-[#f59e0b]` (border-strong) — three different
literals for one semantic state, in one component, per theme.

### 1.4 `dark:prose-invert` is not redundant under tokens

[`app/(client)/posts/[slug]/page.tsx:326`](../../../app/(client)/posts/[slug]/page.tsx)
carries `prose prose-sm sm:prose dark:prose-invert`. `@tailwindcss/typography` is
loaded with **no `theme.typography` override**, so prose colours come from
`--tw-prose-*` variables and are reachable by **no role token**. Deleting that
variant renders **song lyrics** in the near-black light prose palette on a dark
surface — on the most-read member page. Handled in §4 Phase 1.

### 1.5 What `brand.css` costs — and it has no prior art

16 `.brand-*` classes (29 rules incl. pseudo-elements) bake in **dark-native compositing**: pure-black shadows
(`rgb(0 0 0 / 0.14–0.28)`, 6 occurrences), white-alpha inset highlights
(`rgb(var(--brand-frost) / 0.035)`), and beam **glows** over near-black. Glow has
no light equivalent.

`--brand-beam` is referenced **32 times inside `app/brand.css` itself**, driving
`.brand-atmosphere`'s whole body wash, every glow, `.brand-section-heading`,
`.brand-key-dial`, `.brand-library-module`, `.brand-song-hero`. Retiring
`#12C8F4` **repaints the app's atmosphere**, not merely 88 class usages.

**`app/brand.css` did not exist before `33c6e15`** — verified:
`git show 33c6e15^:app/brand.css` → *"exists on disk, but not in 33c6e15^"*. The
compositing layer was *introduced by* the identity refresh.

**Zero prior art applies to these 16 classes only.** A working two-theme token
system *does* exist on `redesign/explore` (the Cantoral variant, ADR-0009) and its
mechanics are harvested in §3 — but it predates `33c6e15`, uses a different design
language, and contains no `.brand-*` rules. So the compositing layer genuinely has
no light counterpart in any commit, and remains the largest single design effort
here (§4 Phase 2). The *token architecture*, by contrast, is not starting from
scratch.

`app/brand.css:2` also hardcodes `:root { color-scheme: dark }` with no light
branch. It is harmless *in the app* because next-themes' `enableColorScheme`
(default `true`) writes an inline `documentElement.style.colorScheme` that wins.
**But the Phase 0 gallery deliberately runs with no provider**, which removes
exactly that mitigation — so the light gallery, Phase 2's only review surface,
would render with a dark UA colour-scheme (scrollbars, form controls, default
canvas). `color-scheme` therefore needs a **class-keyed branch in `brand.css`**
(`.light { color-scheme: light }`), which Phase 3 needs anyway. Do not rely on
next-themes' inline style, and do not "clean up" that inline style later.

### 1.6 Files with no light path at all

*Provisional, like §1.1 — recounts land on 38 files, and the list below omits at
least `components/icons.tsx` (8 SVG `fill="#…"`, a named §3.2b target) and
`admin/ReadinessBadge.tsx`. Phase 0's inventory supersedes it; do not use this as a
work list.*

Of the 38–39 `.tsx` files with no `dark:` variant, roughly **16 are colourless** and
**23 carry hardcoded colour** — the real drift:

`SignOutButton` · `Navbar` · `NextServiceHero` · `BottomNav` ·
`PracticePlaylistButton` · `SongSearchList` · `PostComponent` · `CmsNavbar` ·
`ImpersonationBanner` · `AudioTransport` · `AudioPlayer` · `ui/EmailPrefToggles` ·
`ui/CueDialog` · `ui/CueDialogStatus` · `admin/ServicePrimaryAction` ·
`admin/ServiceIssueList` · `(admin)/layout` · **`(client)/layout`** ·
`(client)/page` · `(client)/tag/page` · `(client)/auth/signin/page` ·
`(client)/admin/page` · `(client)/tag/[slug]/page`

Includes the shared shell and both root layouts — `(client)/layout` carries
`bg-brand-blackout text-brand-frost brand-atmosphere` on `<body>`.

## 2. Decisions

| # | Decision | Choice |
|---|---|---|
| 1 | Anti-drift mechanism | **Role-based tokens.** Components stop naming palettes. |
| 2 | What light mode *is* | **Counterpart design**, not mechanical inversion. |
| 3 | Vocabulary | **Two layers** (§3): **34** base roles + ~14 composed alpha-baked tokens + a runtime mechanism (§3.2b). Grown from the initial "~10" because the palette provably cannot be represented in fewer (§1.3, §1.2b, §3.2b). **Provisional — §3.1 is a floor** that Phase 0's palette-family analysis may extend (§3.1a). The decision that moved most under review; see §11. |
| 4 | Sequencing | **Tokens first, light second.** |
| 5 | Phase 1 proof | **Equality by construction** (per-site mapping table + codemod), VR as backstop. |
| 6 | VR target | **Hermetic theme gallery**, own route group, presentational components only. |
| 7 | Persistence | **Server-persisted** `themePref` on the `teamMembers` document type. |
| 8 | First paint | **Mirrored to `localStorage`** so `next-themes` paints before hydration. |
| 9 | Default | **Unset → Dark** at ship; staged to Follow System later. |
| 10 | Scope boundary | App + chrome + iOS status bar. Not `/studio` internals, emails, or the manifest splash. |
| 11 | Ship gate | WCAG AA across the ink × surface matrix + no-hex lint rule + staged default. |
| 12 | Accent | **`#00bfff` wins.** `--brand-beam` `#12C8F4` retired. |
| 13 | Admin editability | **Member-only.** Not in `MemberForm`. |

## 3. The token vocabulary (two layers)

> **Mechanics harvested from `redesign/explore`.** The abandoned Cantoral variant
> (ADR-0009) already built and shipped a working two-theme token system in this
> repo, and its structure solves problems this design hit independently. **Its
> mechanics are adopted; its palette is not** — Papel/Vigilia is a warm
> paper-and-rust identity, and Backstage keeps its own colours. Harvested:
> - **Dual exposure.** Every colour published twice — `--foo-rgb` (space-separated
>   triple) and `--foo` (ready-to-use). Its own comment gives the reason:
>   *"Opacity modifiers like `bg-accent/15` then resolve to a real rgba() value in
>   every browser without depending on `color-mix`."*
> - **Semantic aliases flipped by `.dark`** — `--bg-rgb: var(--paper-rgb)` in
>   `:root`, `--bg-rgb: var(--night-rgb)` in `.dark`.
> - **Pre-multiplied tokens for theme-varying alpha** — `--accent-soft` is
>   `rgb(… / 0.18)` in dark and 100% in light, wired as `soft: "var(--accent-soft)"`
>   with the note *"Tailwind alpha modifiers don't apply (intentional)."*
>
> This retires three problems that four review rounds could not settle: the
> invalid `color-mix` prescription, the unspecified composed-token config shape,
> and the opacity footgun (now a documented, intentional property rather than a
> trap). §1.5's zero-prior-art budget survives, but **only for the 16 `.brand-*`
> compositing classes** — Cantoral predates `33c6e15` and has no `.brand-*` rules.

### 3.1 Layer 1 — base roles (34)

Raw colour per theme. Alpha applied by the utility class where it is
theme-*invariant*.

**Surfaces (6):** `surface-base` `#010B17` · `surface-raised` `#071624` ·
`surface-raised-alt` `#0a1929` · `surface-elevated` `#0D2234` ·
`surface-sunken` `#001f3f` family · **`surface-navy` `#003572` opaque**

> **Naming caution.** `surface-navy` is deliberately *not* called
> `surface-accent`: §3.2 defines a composed token `surface-accent-tint` whose dark
> value is `accent`@20%. An earlier revision used one name for both, which one
> Tailwind colour key cannot hold — it would have silently regressed ~32 sites.
> The two are different roles: an opaque navy surface vs a translucent accent wash.

**Ink (3):** `ink` `#D7E7F6` · `ink-muted` `#C8D8EB` · `ink-subtle` `#7F94A8`

**Accent (1):** `accent` — dark `#00bfff`, light `#003572` (harvested)

**States (16):** each state carries `-fg` / `-surface` / `-surface-strong` /
`-border`, because `DayCard.tsx:37–50` uses three distinct literals per state per
theme, and the *unpaired* dark-native tints (`CalendarView.tsx:392,394`) are a
fourth value that no single `-surface` can also be byte-identical to:
`positive-*` · `warning-*` (`#f59e0b` / `#1c0800` / `#78350f` / `#92400e`) ·
`info-*` (`#a78bfa` / `#1e0a3c` / `#4c1d95` / `#5b21b6`) ·
**`negative-*`** (new — `red` is 174 uses, the second-largest family)

**Chart (6):** `chart-lead` · `chart-bgv` · `chart-coro` · **`chart-especial`** ·
`chart-instr` · `chart-foh` — the palette held as a runtime constant at
`ParticipationSidebar.tsx:6`, which declares **six**:
`#378ADD #1D9E75 #7F77DD` **`#D9534F`** `#BA7517 #888780`. In none of the hex literals
above and previously in no role at all. (An earlier revision said "Chart (5)" and omitted
`especial: "#D9534F"` — a hand-enumeration wrong at the very line it cited, which is §1.0's
lesson restated by evidence.)

**Structural (3):** `edge` · `elevation` · `focus-ring`

> **Naming rule — a token key must never begin with a utility prefix.**
> Tailwind composes `{utility}-{colourKey}`, so a key named `border-accent`
> compiles to `.border-border-accent`, while the class you would naturally write,
> `.border-accent`, silently resolves to the **base `accent` role** instead.
> Verified against this repo's Tailwind 3.4.19. This is why the structural roles
> are `edge` / `elevation`, not `border` / `shadow` (`.border` and `.shadow` are
> themselves utilities), and why §3.2's composed tokens use the `edge-*` prefix.
> **This rule goes in the ADR (§7)** — it has now bitten this design twice.

**Naming rule.** Roles are named for the *job*, never the value. `blackout`,
`frost`, `steel`, `deck`, `console`, `beam` and **`signal`** (13 usages, → `positive-fg`)
are retired — a token named for what
it looks like is what made the palette undriftable-from.

### 3.1a Naming convention, and why §3.1 is a floor

**Convention, stated once and binding everywhere in this spec:**
`--x-rgb` is the space-separated **triple**; `--x` is the **ready-to-use colour**
(`--ink: rgb(var(--ink-rgb))`). Layer 1 config entries consume the triple
(`rgb(var(--x-rgb) / <alpha-value>)`); Layer 2 entries consume the colour
(`var(--x)`). Anywhere the spec needs a colour in CSS, write `var(--x)` or
`rgb(var(--x-rgb) / α)` — **never** `rgb(var(--x))`, which double-wraps and is
dropped silently.

**§3.1 is a floor, not a ceiling.** Its role count was derived from the *hex*
surface only. The same analysis has never been run on the 837-site raw-palette
block, which carries ~36 distinct (family, shade) pairs — `gray` across 7 shades,
`red` across 9 — against roughly 19 slots. Known gaps already visible: **no
neutral-grey surface, no neutral border, and no `white`/`black` role at all**
(38–44 sites by regex). Phase 0's family analysis closes this, and **Decision 3's
count is provisional until it does**.

One gap is sharper than the others and should be named now: six sites are
`bg-[#003572] … text-[#C8D8EB]` (e.g. `AvailabilityPanel.tsx:37–39`) — **ink on an
opaque accent surface**. Because §3.2 pins light `surface-accent-tint` to opaque
`#003572`, that ink must stay *pale in light*, which no §3.1 ink role can be (they all
darken). §1.3 maps `#C8D8EB` to "ink-muted *and* a surface"; this third context is
unnamed. Either the `white`/`black` role covers it or it needs its own.

### 3.1b Polarity: dark lives in `:root`, light under `.light`

**Decided in Phase 1a, deliberately inverting the harvest.** Cantoral is
light-first (`:root` = Papel, `.dark` = Vigilia). Backstage is dark-first and
Decision 9 ships **unset → Dark**, so copying that polarity would put light values
in `:root` and hand an un-themed light first paint to *every* user until
next-themes' script runs — and that script lives inside `<body>`
(`app/(client)/layout.tsx:64`), after the server HTML has already painted.

This is not speculative: Cantoral hit exactly this bug and fixed it in `7af69d8`
("theme flash"), whose remedy was *"Add `className="dark"` on the root `<html>` so
the initial paint is Vigilia."* It harvested the structure **and** needed a remedy;
taking the structure without the remedy imports the bug.

Today there is no flash because `app/brand.css:1` puts the **dark** values in
`:root` and no layout emits a theme class server-side. Keeping that polarity
preserves the property for free. `.light { color-scheme: light }` must be declared
**after** `:root { color-scheme: dark }`. `:root` and `.light` are both specificity
(0,1,0) and both match `<html>`, so **source order decides for every token**, not
just `color-scheme`.

One correction to the mechanism, so the ADR records the right reason: next-themes'
inline script is synchronous during parse, so it runs *before* first paint — the
flash risk is not that the script is late. It is that **no theme class is emitted
server-side at all**, so `:root` must hold the shipped default. Recording the wrong
reason invites someone to disprove it later and flip the polarity back.

Decided in **Phase 1a** and the `7af69d8` review moves from Phase 2 into Phase 0 —
but for the right reason, since §7 sends this into an ADR. It is **not** that
polarity is "baked into ~2,310 sites": migrated sites carry theme-agnostic names
(`bg-surface-base`), and polarity lives only in `brand.css`, where flipping it is a
two-block swap. It is decided early because Phase 1a's equality gate resolves
custom properties against `:root`/`.light` and would silently pass against an empty
class set, and because every light value chosen later assumes it.

### 3.2 Layer 2 — composed tokens (alpha baked per theme)

**This layer exists because of §1.2b.** Where a light/dark pair varies its alpha,
the opacity is part of the *semantic value* and must live inside the token, not
in the utility class. Each composed token resolves to a full `rgba` per theme.

| Composed token | Light | Dark | Sites |
|---|---|---|---:|
| `surface-accent-tint` | `#003572` 100% | `accent` 20% | 32 |
| `edge-accent` | `accent` 30% | `accent` 20% | 30 |
| `surface-accent-hover` | `#003572` 80% | `accent` 30% | 24 |
| `edge-subtle` | `accent` 15% | `accent` 10% | 19 |
| `edge-default` | `accent` 20% | `accent` 15% | 13 |
| `surface-accent-subtle` | `accent` 5% | `accent` 5% | 10 |
| `surface-accent-soft` | `accent` 10% | `accent` 5% | 7 |
| …plus ~7 lower-frequency tiers | | | ~34 |

The seven tiers above cover **135 of the 169** alpha-varying pairs; the tail is
normalised onto the nearest tier and enumerated in §3.3. Total composed set: **~14**.

**Config shape — this is the part an implementer must not improvise.** The two
layers are wired differently, exactly as Cantoral does it:

```ts
// Layer 1 — alpha is theme-invariant, so modifiers must work:
accent: "rgb(var(--accent-rgb) / <alpha-value>)",   // bg-accent/15 → real rgba()
// Layer 2 — alpha is part of the value and differs per theme:
"surface-accent-tint": "var(--surface-accent-tint)", // pre-multiplied in brand.css
```

with the per-theme values pre-multiplied in `brand.css`:

```css
:root   { --surface-accent-tint: rgb(var(--accent-rgb) / 0.20); }   /* DARK — the default */
.light  { --surface-accent-tint: rgb(var(--accent-rgb)); }           /* light — 100% accent */
```

Note the light branch resolves `--accent-rgb`, **not** `--surface-navy-rgb`. §3.1
pins light `accent` = `#003572` and §3.2's table pins light `surface-accent-tint` =
`#003572` @100%, so `--accent-rgb` is the variable that actually holds it.
`surface-navy`'s *light* value is a Phase 2 deliverable and will not be `#003572`
(an opaque dark navy is not a light-theme surface) — wiring the light branch to it
would be wrong on the 32 highest-frequency composed-token sites, and wrong in a way
neither the AA matrix nor a token-swatch gallery can see.

**Polarity is `:root` = dark, `.light` = light — for every token, not just
`color-scheme`** (§3.1b). Writing it the other way round (Cantoral's polarity)
paints light panels on every cold load until next-themes' script runs.
**Invariant:** no token may be defined only in `:root` without either a `.light`
counterpart or an explicit *theme-invariant* marker — otherwise light silently
inherits dark values, which is the drift class ADR-0008 documents.

A *literal* colour in the config would be theme-invariant and silently break the
169 alpha-varying sites this layer exists for.

> **Opacity modifiers on Layer 2 are inert — and that is intentional.**
> Verified against this repo's Tailwind 3.4.19: an opacity modifier on **any
> `var()`-valued colour key** emits *no rule at all*, so
> `bg-surface-accent-tint/50` silently drops the background. (`rgba()`,
> `#RRGGBBAA` and `rgb(a b c / .2)` values all *do* accept modifiers — the failure
> is specific to `var()`, not to the absence of `<alpha-value>`.) Cantoral
> documents the same behaviour as deliberate. The lint rule (§8) bans opacity
> modifiers on Layer 2 keys; the ADR (§7) must record the **correct** cause, or a
> maintainer who re-tests the wrong one will find it false and delete the rule.

### 3.2b Runtime and non-class colour

A set of sites set colour outside `className`, where **CSS custom properties
cannot reach them**. The categories are below; **the authoritative per-site list
is Phase 0's generated inventory (§1.0), not a hand-count here** — every hand-count
in this spec's history has been wrong, and an earlier draft of this very table
double-counted concatenation sites as bare hex when they contain no `#` at all.

| Pattern | Why tokens don't reach it |
|---|---|
| 8-digit hex concatenation — `` background: `${t.accentHex}0d` `` (`DayCard.tsx:127,186,191,196,344,353–355`; `PracticePlaylistButton.tsx:133`) | `var(--accent)` cannot have `0d` appended |
| **Three independent runtime colour maps** (an earlier revision said two) — `DayCard.tsx:33,43,53` (incl. `#12c8f4`, the retired beam) **and `CARD_ACCENT_HEX`** consumed by `ServiceReadinessCard.tsx:368,546,567` | Runtime values, in no class string |
| SVG `fill="#…"` (`icons.tsx`) | Attribute, not a utility |
| Chart palette (`ParticipationSidebar.tsx:6`), legend array (`CalendarView.tsx:193–195`) | Runtime constants |
| `rgb()` / `rgba()` literals — **15 occurrences across 5 files** (an earlier revision said 17/7) | Not hex; invisible to a hex-only scan |
| Colour inside arbitrary values with no `#` — `shadow-[0_0_0_1px_rgb(0_191_255/0.45)]` (`ProposalsPanel.tsx:154`) | A *class*, so the inline-style path misses it too |

**Mechanism — role-variable indirection, not a fixed variable.** This is a "must not
improvise" item on par with §3.2's config shape.

A naive reading replaces the concatenation with `rgb(var(--accent-rgb) / 0.05)`. That is
**wrong**, because these sites do not carry *the* accent — they carry a **runtime-selected**
one. `DayCard.tsx:33,43,53` define three service-type themes whose `accentHex` is
`#12c8f4` (Sunday), **`#f59e0b` (Saturday)** and **`#a78bfa` (Special)**, and `t.accentHex`
is threaded into twelve inline-style sites (`:127,186,190,191,196,344,353–355`) plus three
child props (`PracticePlaylistButton accent=` `:141`, `ChainLinkIcon color=` `:190`,
`Row accentHex=` `:245,254`). `CARD_ACCENT_HEX` (`serviceCardModel.ts:214` →
`ServiceReadinessCard.tsx:368,546,567`) does the same per `ServiceType`. Substituting one
fixed variable would **repaint Saturday amber and Special violet as cyan** — and §3.3
licenses only `#12C8F4 → #00bfff`, so that is a defect by 1a's own gate, on the
member-facing schedule.

**Classify prop-threaded colour by its SINK, not its source.** Interpolating a role
variable into every threaded prop reproduces the exact failure this section bans two
paragraphs down. `ChainLinkIcon.tsx:13` is
`<svg … stroke={color} …>` — an **SVG presentation attribute** (with `color` defaulting to
`"currentColor"` at `:2`), so `color={`rgb(var(${t.accentVar}))`}` emits
`stroke="rgb(var(--warning-fg-rgb))"`, which is not reliably supported and fails
*silently*; `stroke` is inherited, so there is no fall-back to the old colour — the chain
icon renders inherited-or-`none`, i.e. likely invisible. Affected: `DayCard.tsx:190`
(member-facing medley chain) and `ServiceReadinessCard.tsx:379`. The other three
`ChainLinkIcon` call sites (`SetlistEditor.tsx:400`, `ProposalEditor.tsx:581,591`) pass no
colour and are unaffected.

| Sink | Migration |
|---|---|
| inline **style** (`style={{ background: … }}`) | `rgb(var(--x-rgb) / α)` |
| SVG **attribute** (`stroke=`, `fill=`) | **`currentColor`** with the colour set on the parent, or `style={{ stroke: … }}` |

A reviewer reading `color={…}` at a call site cannot see which sink it lands in — which is
why this is stated here rather than left to the per-site diff.

**There are three runtime colour maps, not two** — the third is
`CalendarView.tsx:193–195`, a legend tuple array carrying the same three service-type
colours with its own concatenation at `:198`. It appeared only as a row in the table above,
never in the mechanism, the const-map prescription, or the per-site diff artefact that this
section names as the class's *only* gate. `ServiceReadinessCard`'s own concatenation sites
(`:375,382,393,716,722,726`) were likewise uncited. **Regenerate the map list, the suffix
set and the per-site list from Phase 0's inventory** — this section has now been wrong at
its own cited lines twice, and it governs the one class with no automated gate.

So the const maps hold the **role variable name**, and the style-sink templates
interpolate it:

```ts
const THEME = { sunday: { accentVar: "--accent-rgb" },
                saturday: { accentVar: "--warning-fg-rgb" },
                special:  { accentVar: "--info-fg-rgb" } };
// site: style={{ background: `rgb(var(${t.accentVar}) / 0.05)` }}
```

**Gate.** §4 Phase 0 scopes Phase 1a's computed-colour check to migrated *sites* (class
strings), so none of this class is in 1a's primary proof; `DayCard.tsx:58` and
`ServiceReadinessCard` call `useSession()`/fetch, so they are excluded from the hermetic
gallery by the same rule as `AdminPanel`; and after migration no literal survives for the
lint rule, while the `brand.css` guard does not read `.tsx`. **The one part of Phase 1a
that is not byte-identical by construction would otherwise be the part with no gate.**
Therefore the runtime sites ship as an **enumerated, reviewed per-site diff artefact at the
1a merge**, on the model 1b already uses per family — or the computed-colour check is
extended to resolve inline-style/SVG/prop-threaded values per role variable against `:root`.

> **Not `color-mix`.** An earlier revision prescribed
> `color-mix(in srgb, var(--accent) 5%, transparent)`. Against this repo's
> channel-triplet convention (`--brand-blackout: 1 11 23`) that expands to
> `color-mix(in srgb, 0 191 255 5%, transparent)` — not a valid `<color>`, so the
> declaration is **dropped silently** and those elements lose their background with
> no error. This is the same bug the spec correctly catches for `--tw-prose-*` two
> sections earlier. Cantoral's dual exposure exists precisely to avoid it.

**The hex-alpha → decimal conversions are not byte-identical.** `0d` is 13/255 ≈ **0.0510**,
not 0.05. The suffixes actually in play are **twelve**, not the eight an earlier revision
listed: `00 0d 14 18 30 33 35 40 55 70 80 99`. The four it missed include the two most
dangerous — **`14`** = 20/255 = **0.078431…** (`PracticePlaylistButton.tsx:133`) and
**`80`** = 128/255 = **0.50196…** (`CalendarView.tsx:198`) — whose natural conversions
(0.08, 0.5) are exactly the rounding defects this sentence exists to catch. Every suffix
must convert **exactly** or be enumerated as a §3.3 row — under 1a's "any diff outside §3.3 is a defect", a rounded alpha is
a defect.

Switch SVG fills to **`currentColor`** (or `style={{ fill: … }}`) — *not* a
`fill="var(--x)"` presentation attribute, which is not reliably supported and would
fail silently on all 8 `icons.tsx` fills, the exact failure mode this section's
`color-mix` correction exists to avoid. Expose the chart roles as CSS variables read
at render. `DayCard.tsx:33`'s `#12c8f4` folds into `accent`
as part of the §3.3 beam retirement — it was counted in neither the 88 class
usages nor the 32 `brand.css` references.

### 3.3 Enumerated normalisations (deliberate visual changes)

Phase 1 is **not** "zero visible change." These collapses are intentional and are
reviewed as a list, not absorbed into a baseline update:

| Normalisation | Sites | Effect |
|---|---:|---|
| `--brand-beam` `#12C8F4` → `accent` `#00bfff` | 88 usages + **32 refs in `brand.css`** | Repaints atmosphere, glows, headings, key dials |
| `text-gray-500` / `-400` / `-600` → `ink-muted` / `ink-subtle` | 385 | Three grey tiers → two |
| Alpha tail → nearest composed tier | ~29 | Sub-5% opacity shifts |
| Deep navies `#001f3f`,`#001830`,`#00162e`,`#020f1c`,`#03101f` → `surface-sunken` | 17 | Minor unification. **This row was wrong twice**: it omitted `#001830` (6 sites, not byte-identical to `#001f3f`) and undercounted. Since Phase 1a's gate is "any diff outside §3.3 is a defect", an omitted literal arrives as an unexplained diff — Phase 0's inventory must regenerate this table. `#002249` is handled under §6 (`elevation`), not here. |
| `#3dff7c` → `positive-fg` `#37F58A` — **6 sites**: 2 hex (`DayCard.tsx:322,362`) + 4 `rgba(61,255,124,·)` forms (`:323,344,347,364`) at alphas 0.5/0.8/0.3/0.10, all four of which must be enumerated | 6 | Imperceptible |
| `#010b17` literals → `surface-base` | 26 | None (identical value) |
| Raw palette + `white`/`black` → roles | ~875 | Per-family review; the largest unmeasured block |

Every other literal maps to a token whose dark value is **byte-identical** —
including the unpaired dark-native tints, which is why `-surface-strong` exists:
`CalendarView.tsx:392` `bg-[#78350f]/50` maps to `warning-surface-strong`
`#78350f`, **not** `warning-surface` `#1c0800`. Mapping it to `-surface` would
shift dark from `rgba(120,53,15,·)` to `rgba(28,8,0,·)`. Identically for
`#4c1d95` at `CalendarView.tsx:394` → `info-surface-strong`.

## 4. Phases

### Phase 0 — Verification scaffolding

- **Colour inventory script — the first deliverable, before anything else.**
  Emits every colour decision with file, line, utility and pairing context:
  bracketed hex, bare hex, raw palette, `white`/`black`, **`rgb()`/`rgba()`/`hsl()`
  literals, colour inside arbitrary values that contain no `#`** (e.g.
  `shadow-[0_0_0_1px_rgb(0_191_255/0.45)]`), inline styles, SVG attributes,
  runtime constants, and the retired **`brand-<colour>` Tailwind keys**. Its output
  *is* the mapping table (Phase 1), committed as a snapshot and guarded by a vitest
  sync test (§1.0 — there is no lint/test CI in this repo).

  > **`brand-*` means two things and only one is retired.** The ~215
  > **colour-utility** usages (`brand-beam` 88, `brand-steel` 61, `brand-frost` 39,
  > `brand-signal` 13, `brand-blackout` 10, `brand-deck` 3, `brand-console` 1) are
  > retired by §3.1. The **16 `.brand-<component>` compositing classes**
  > (`brand-atmosphere`, `brand-surface`, `brand-song-hero`, …) are **kept** and
  > given light counterparts in Phase 2 — §1.5 calls that the largest design effort
  > in this project. A regex on `brand-` would strip `brand-atmosphere` off both
  > root layouts' `<body>` and error on all 16 in lint. The non-colour vars
  > `--brand-radius-panel` / `--brand-radius-control` / `--brand-duration-*`
  > (7 arbitrary-value usages) are **out of scope** for both codemod and lint.

  **A third file class references the retired colour variables: `.tsx` arbitrary values.**
  Two sites, and both would break silently:
  - `AdminPanel.tsx:399` — `shadow-[inset_0_0_0_1px_rgb(var(--brand-beam)/0.15)]`
  - `(client)/admin/page.tsx:28` — `shadow-[0_0_10px_rgb(var(--brand-signal)/0.8)]`

  This also **corrects the justification for deleting `--brand-signal`**: "declared in
  `:root` and referenced nowhere" is true of `brand.css` only — the second site above
  references it. After 1a both would point at undeclared properties, the declarations go
  invalid at computed-value time and are dropped, exactly the failure mode Phase 1a names
  for `brand.css` itself. Nothing currently catches it: guard (vi) fixes the reference set
  to `brand.css` ∪ `tailwind.config.ts`; the lint lookahead `(?!\s*var\()` deliberately
  exempts `rgb(var(…`; §4 Phase 0 accounts only for the seven *non-colour*
  `--brand-radius-*`/`--brand-duration-*` arbitrary-value usages, which reads as if
  arbitrary-value `var()` were fully covered; and both files are excluded from the gallery
  (`AdminPanel.tsx:416` calls `useSession()`). So: **`app/**/*.{tsx,ts}` arbitrary-value
  `var(--…)` references join the codemod scope and the guard's reference set**, and the
  lint lookahead does *not* exempt retired variable names.

  **The inventory must scan `app/**/*.css` too — and a vitest guard must cover it.**
  `app/brand.css` is where the token layer *lives*, and it currently sits outside
  every gate: the inventory command is `find app -name "*.tsx"`, and
  `eslint.config.mjs` loads only `eslint-config-next` with **no CSS processor** —
  verified, `npx eslint app/brand.css` reports 0 errors. So §3.2's invariant has no
  enforcement at all, and `.brand-new-panel { background: #123456 }` added later
  passes `tsc`, `npm test` and `eslint` cleanly. Decision 1 ("components stop naming
  palettes") is true and irrelevant here: `brand.css` is not a component and can name
  anything. **Add a vitest assertion that parses `brand.css` and enforces the following:**
  (i) every custom property declared in `:root` has a `.light` declaration or sits on an
  explicit, reviewed theme-invariant allowlist — **and vice versa**, since a property
  declared only under `.light` is undefined in dark and equally unguarded. **This one
  self-activates on "`.light` declares ≥1 custom property"**, so it stays dormant through
  Phase 1 (where `.light` holds only `color-scheme: light`, which is not a custom
  property) and binds in Phase 2. Without that trigger it would go red against all 11
  current `:root` properties on the day it lands. The allowlist holds the four
  **non-colour** properties only (`--brand-radius-panel`, `--brand-radius-control`, the
  two `--brand-duration-*`). **`--brand-signal` must NOT be allowlisted** — it is a
  colour, §3.1 retires it to `positive-fg`, and 1a deletes the declaration (it is declared
  in `:root` and referenced nowhere in `brand.css`). Allowlisting a colour as
  "theme-invariant" is precisely the drift class this guard exists to catch;
  (ii) **every COLOUR `var(--x)` referenced is declared** — scoped to colour custom
  properties, and under (vi) the reference set is `brand.css` + `tailwind.config.ts`
  checked against the *union* of declarations. The colour scope is load-bearing:
  `tailwind.config.ts:25-27` references `--font-display` / `--font-body` / `--font-label`,
  which `next/font` emits at runtime via its `.variable` classes and which are declared in
  **neither** file — an unscoped (ii) goes red at the 1a merge, the same
  "phase cannot pass its own done-gate" class v19 fixed for (iii)/(vi). Allowlist them
  explicitly as externally declared if you prefer that to a colour filter (this is what
  catches the 65-line variable rename in §4 Phase 1a, whose failure mode is a silently
  dropped declaration);
  (iii) **[binds at the 1a merge — see below] inside `rgb()`/`rgba()`, every `var()` must
  name a `*-rgb` variable, and no `*-rgb` variable may appear where a full `<color>` is
  expected** — this is what
  actually catches the 65-line rename, because assertion (ii) does not. 29 of the 32
  `--brand-beam` occurrences are `rgb(var(--brand-beam) / α)` — the other three (`:106`,
  `:168`, `:205`) carry no alpha, per (iv); renaming to `--accent`
  rather than `--accent-rgb` yields `rgb(rgb(0 191 255) / 0.11)`, which is invalid and
  dropped — yet `--accent` *is* declared, so (ii) passes green. `.brand-atmosphere`'s
  six gradients are a single `background-image` declaration, so one bad function removes
  the entire body wash; the same slip inside `.brand-key-dial::after` is not visually
  obvious at all;
  (iv) **the mapped `(variable, alpha)` pair multiset is unchanged — one entry per
  occurrence, and `none` counts as an alpha value.** Not "the alpha multiset": that is
  too weak to see a variable swap, because **11 of the 43 alpha values are shared by two
  different variables** (0.035, 0.04, 0.055, 0.13 across beam/frost; 0.08, 0.28 across
  beam/blackout; 0.32, 0.72 across beam/console; 0.12 frost/steel; 0.14 beam/steel; 0.62
  blackout/deck). Crossing `.brand-surface`'s
  `inset 0 1px 0 rgb(var(--brand-frost) / 0.035)` with a beam stop at 0.035 would pass
  (ii), (iii) and an alpha-only (iv), while VR is licensed to diff on beam lines. Per
  *occurrence*, not per line — `brand.css:108` names three variables on one line.
  Measured precisely: **69 colour `var(--brand-*)` occurrences, of which 65 carry an
  explicit alpha across 43 distinct values (0.025–0.94) and 4 carry none** —
  `brand.css:17` (`.brand-atmosphere`'s base `background-color`), `:106` and `:168`
  (gradient stops), `:205` (`.brand-key-dial`'s `color`). Three of those four are *beam*
  lines, i.e. exactly the lines §3.3 licenses a diff on, so VR cannot cover them. An
  extractor written to "a `(variable, alpha)` pair per line" silently skips all four and
  leaves the atmosphere's base colour guarded only by (ii)/(iii), which pass on any
  `*-rgb` rename whether an alpha was added or not.
  (Be precise about the unit, or the extractor will be written wrong — and note this
  paragraph was itself imprecise until v21: the multi-variable lines are `:24` and `:115`
  (three variables each) plus `:219`, `:272`, `:278` (two each), which is how 59 lines
  yield 66 per-variable counts; `:108` names only one. **69** is colour
  *occurrences*, **65** of those carry an alpha, and the declarations live on **59**
  lines. The per-variable counts — beam 29, blackout 9, frost 9, console 7, deck 7,
  steel 5 — are per-*line* and sum to 66 because one gradient line names three
  variables. Beam has 32 occurrences on 29 lines, and 3 of them carry no alpha.)
  Renaming `rgb(var(--brand-beam) / 0.11)` to `rgb(var(--accent-rgb))` passes (i), (ii)
  and (iii) — the variable is declared, it is a `*-rgb`, there is no literal — and
  silently renders `.brand-atmosphere`'s 11% wash at 100%, or turns
  `.brand-surface`'s `inset 0 1px 0 rgb(var(--brand-frost) / 0.035)` into an opaque
  white line. VR is structurally weakest exactly here, because §3.3 *licenses* an
  expected diff on those same 29 beam lines, so a reviewer cannot separate the planned
  recolour from an unplanned alpha change on the same declaration. Phase 1a's
  computed-colour check is scoped to migrated **sites** (class strings); `brand.css`
  declarations are not sites and it does not cover them;
  (v) once Phase 2 lands, no raw colour literal inside `.brand-*` rules — note this fires
  on the six pure-black shadows at `brand.css:119,144,186,194,246,281`, so **Phase 2 must
  assign them the `elevation` role**; no bullet did until v22;
  (vi) **[binds at the 1a merge] the declaration set is the UNION of `brand.css` and
  `tailwind.config.ts`, not a per-file check.** The five
  assertions above are file-scoped, but `tailwind.config.ts:15-21` declares seven
  `brand.*` keys as `rgb(var(--brand-<name>) / <alpha-value>)` — the *same* retired
  variables, one file over, with live consumers including `selection:bg-brand-beam/35` on
  **both** root layout `<body>` elements. Renaming in `brand.css` alone leaves those keys
  pointing at undeclared properties: identical silent-drop failure. The 1a lint clause
  banning retired `brand-<colour>` keys is a backstop and both land in the same merge, but
  the guard should cover it rather than rely on that. A *file-scoped* (ii) would also fail
  today, since `tailwind.config.ts` declares no custom properties at all while referencing
  seven — hence the union.

  > **(iii) and (vi) must be staged, like (i) and (v).** Against the pre-migration tree
  > they are **red**: all 69 `var(--brand-*)` occurrences in `brand.css` and all seven keys
  > at `tailwind.config.ts:15-21` name non-`*-rgb` variables, and **no `*-rgb` variable
  > exists anywhere yet**. The guard is a Phase 0 deliverable whose done-gate is
  > `npm test`, so as written **Phase 0 cannot pass its own gate** — and the cheapest local
  > fix would be to weaken the very assertion this section calls the one that catches the
  > rename. Bind them to the 1a merge, or trigger on "≥1 `*-rgb` variable is declared".
  The codemod must also be **case-insensitive**: both `#010B17` and `#010b17` occur.

  **`.css` is also where the §3.2 invariant binds — and it binds in Phase 2, not
  Phase 1.** During Phase 1 `.light` is deliberately empty and `npm test` must pass,
  so the assertion activates with the light values.

  **The derived-alias exemption is defined syntactically, not by example.** Exempt
  *only* a **pure re-wrap** of a base token that is itself redeclared under `.light`:
  exactly one `var()`, **no added alpha**, no literal — i.e. `--ink: rgb(var(--ink-rgb))`.
  **All ~14 Layer-2 keys are non-exempt by construction.** An example-only definition
  would exempt them too: `--surface-accent-tint: rgb(var(--accent-rgb) / 0.20)` is
  equally "derived" and does follow `--accent-rgb` into `.light` by cascade — but it
  **must not**, because light needs `#003572` at **100%** while cascade alone yields
  light-accent at **20%**. That leaves a translucent wash where an opaque navy panel
  belongs, on the 32 highest-frequency composed-token sites, with `npm test` green.
  Defined loosely, the guard would protect the base roles — whose absence is obvious
  on every surface — and miss the composed ones, whose absence is a subtle alpha error.

  **Guard placement is load-bearing.** `vitest.config.ts:15-16` sets
  `include: ["app/**/*.test.{ts,tsx,mjs}", "scripts/**/*.test.{ts,mjs}", "e2e/**/*.test.ts"]`
  so a guard placed outside those three roots **simply never matches and never runs** —
  a silent no-op, not a failure. (`passWithNoTests` is incidental; 116 files already
  match, so the suite is green either way.) Put every new guard — inventory snapshot,
  `brand.css` parse, compiled-prose assertions, contrast matrix — under
  `app/utils/__tests__/`.

  Every hand-count in this spec's history understated the surface (§11); this replaces
  hand-counting permanently.
- **Palette-family shade analysis.** Run §1.3's "can the vocabulary represent
  these values" analysis over the eight raw-palette families **before** the
  vocabulary is frozen. It was only ever run on the hex surface, and the families
  carry ~36 distinct (family, shade) pairs — `gray` alone spans 7 shades, `red` 9 —
  against ~19 role slots. §3.1 is therefore a **floor, not a ceiling** (§3.1a).
- **Theme gallery** with its root layout at
  **`app/(gallery)/auth/theme-gallery/[theme]/layout.tsx`** — the layout must sit
  *at* the dynamic segment, not above it. Next 16 passes a layout only the params
  "from the root segment down to **that layout**," so a layout at
  `app/(gallery)/layout.tsx` sits three segments above `[theme]` and receives `{}`;
  and only a root layout may emit `<html>`. A layout with no `layout.js` above it
  *is* a root layout, so this path is both valid and the only one that works.
  The `(gallery)` group is then cosmetic — the hermeticity comes from there being
  no layout above, not from the group. Its **own route group
  with its own root layout** (verified structurally valid: there is no root
  `app/layout.tsx`; `(admin)` and `(client)` are already sibling root layouts).
  It imports `globals.css` (for the `@tailwind` directives) **and** `brand.css`,
  but **not** `app/utils/Provider`. Required because:
  - `app/(client)/layout.tsx:64` wraps everything in `<Provider>` and renders
    `ActivityPing`, which fires `fetch("/api/activity/ping")` on mount.
  - next-themes 0.4.6 makes a **nested `ThemeProvider` a literal pass-through**
    (`useContext(L) ? Fragment : X`), so `forcedTheme="dark"` is un-overridable
    from inside `(client)` — both themes must render while `forcedTheme` is still
    in force for Phase 2 to be possible at all.
  - The layout applies the theme by writing `className={theme}` on `<html>` from
    a route param — no provider, no storage.
  - The `/auth/` prefix keeps [`proxy.ts:45`](../../../proxy.ts)'s matcher
    exclusion (verified: `/auth/theme-gallery` → middleware does not run;
    `/author/x` → it does). **No matcher edit.**
  - The layout must apply `brandFonts`' `--font-display/body/label` `.variable`
    classes to `<html>`, as both real root layouts do, and import
    `app/(client)/globals.css` specifically — `app/(admin)/globals.css` is bare
    `@tailwind` directives, while the `(client)` one carries the
    `@layer base` font bindings. Without both, every VR baseline renders in
    fallback fonts at fallback metrics and Phase 2's design review is invalid.
  - **Validate `[theme]` with `export const dynamicParams = false`** alongside
    `generateStaticParams` (or an explicit `notFound()`). `generateStaticParams`
    **alone does not 404** — `dynamicParams` defaults to `true`, and in **`next dev`**
    the proposed structure serves `/auth/theme-gallery/EVIL` with **200** and
    `<html class="EVIL">`. State the *dev* behaviour only. Do **not** claim a
    production `next start` 404s it — with `dynamicParams` defaulting to `true` an
    unlisted segment renders on demand, so that parenthetical is very likely false and
    is exactly the "maintainer re-tests, finds it false, deletes the guard" trap this
    sentence exists to prevent. `dynamicParams = false` closes it in
    **both** modes. The route is unauthenticated by design, so an unvalidated segment
    reflects arbitrary input into a root attribute.
  - **Add the gallery to `PUBLIC_ROUTES`** — which lives in
    `app/utils/__tests__/routeMatcher.test.ts:34`, not in `routeMatcher.ts` — with a
    reason comment naming the env flag that fails it closed. The walk maps `[theme]`
    to `sample`, so the literal entry is `/auth/theme-gallery/sample`, and the list
    is compared with `toEqual`, so ordering matters. Note the walk only matches
    `page`/`route` files, so that entry presupposes
    `app/(gallery)/auth/theme-gallery/[theme]/page.tsx` — name it explicitly.
    `routeMatcher.test.ts:51` asserts `expect(ungated).toEqual(PUBLIC_ROUTES)` by
    walking `app/` on disk, so the gallery route **breaks `npm test`** the moment
    it exists. "No matcher edit" is true of `proxy.ts` only. That guard exists so
    that opening an unauthenticated route is a deliberate, reviewable act — and
    Phase 0 opens one, so this *is* the auth review, not a formality.
  - Gated on an explicit env flag rather than bare `NODE_ENV`, **with a test
    asserting it 404s in production** — it sits behind the `auth` exclusion and is
    therefore unauthenticated by design. A bare `NODE_ENV !== "production"` check
    would also 404 it on Vercel Preview, making Phase 2's two-theme review
    localhost-only.
- **Review `redesign/explore` and `7af69d8` — here, not in Phase 2.** The polarity
  decision (§3.1b) rests on it, and Phase 1a's equality gate resolves against
  `:root`/`.light`. Read `app/(client)/globals.css` (the two-theme token system),
  `ThemeToggle.tsx`, `REDESIGN_PROPOSAL.md`, and the commits fixing *"theme flash"*
  (`7af69d8`) and *"floating surfaces now flip with theme"* (`392c47a`). Record what
  is and isn't harvestable — this also closes the gap ADR-0009 filed. **Phase 2's
  duplicate of this bullet is deleted**; two earlier revisions claimed the move
  without executing it, leaving the operative checklist without the work.
- **Add the `.light { color-scheme: light }` branch** to `brand.css`, declared after
  `:root { color-scheme: dark }` (§1.5, §3.1b). It is needed here because the gallery
  runs without the provider whose inline style currently masks the dark-only
  declaration.
- **Gallery inventory — grows with the phases; Phase 0 baselines only what exists.**
  In **Phase 0**, dark only: all 16 `.brand-*` classes (29 rules incl.
  pseudo-elements), a `prose` block (§1.4), and stateless components. Token swatches
  arrive in **Phase 1a** (tokens do not exist before it) and the second theme in
  **Phase 2** (light values do not exist before it) — an earlier revision asked
  Phase 0 for "every token swatch in both themes", which it cannot produce.
  **The stateful admin panels are excluded throughout**:
  `AdminPanel.tsx:416` calls `useSession()` (throws without a `SessionProvider`),
  and `ServicesPanel.tsx:792` / `ProposalEditor.tsx:262` fetch on mount — putting
  them in a "hermetic" gallery would fire more uncontrolled traffic than the one
  call the route group exists to avoid. Honest coverage: the gallery exercises
  the token layer and `brand.css` compositing, **not** the bulk of the 1,198 hex
  sites. That is why Phase 1's primary gate is not screenshots.
- **The AA gate's own inputs — named here because Decision 11 makes AA a ship gate
  and nothing else produces them:**
  - the **surface-nesting map** (hand-authored, reviewed; ~6 surfaces × ~14 composed
    tokens), the only producer of cross-component pairs (§4 Phase 2 point 4);
  - the **dark composited failing set**, derived from it plus the inventory's
    same-element pairs — **and re-derived at every Phase 1b family merge**, because 1b
    changes ~875 dark values and explicitly does *not* promise byte-identity. A set
    derived once in Phase 0 is stale the moment the first family lands, and 1b's own
    gate (the per-family diff list) is contrast-blind. Phase 2 owns only the *light*
    set, so without this the largest ink block in the app — `gray` 463 uses, `red` 176,
    and the 197 `text-gray-500` lines that carry no `bg-` — ships its dark collapse with
    no AA check at all;
  - the **recorded conservative backdrop assumption** (§4 Phase 2 point 3) — the
    lightest rendered `brand-atmosphere` point in dark.

  Two earlier revisions claimed these were "derived in Phase 0" without putting them
  in Phase 0's checklist. A ship gate whose inputs live in no phase is the gate that
  gets waived.
- **Second Playwright config** for read-only VR. Cannot live in
  `playwright.config.ts`, which is a Sanity *write-safety* harness refusing to run
  without project `scbxomq9` / dataset `service-readiness-verification`,
  `ALLOW_SERVICE_READINESS_E2E_WRITES=true`, a non-prod URL, and a bypass secret.
- **ADR** explaining why two Playwright configs exist.

### Phase 1 — Token migration

**Split into 1a and 1b, because they admit different proofs.** An earlier revision
applied one gate ("byte-identical except §3.3") to the whole migration, while §3.3
simultaneously described ~875 of those sites as "the largest unmeasured block" —
a contradiction that left 38% of the surface with no criterion by which a visual
diff counts as a defect.

- **Phase 1a — hex + `brand-*` → tokens.** Dark values are byte-identical by
  construction. The equality gate below applies verbatim; any diff outside §3.3
  is a defect.
- **Phase 1b — raw palette + `white`/`black` → roles (~875 sites).** Shipped
  **per colour family**, each family carrying its own enumerated per-site diff
  list as the review artefact. **Byte-identity is not promised here**: `gray`
  spans 7 shades and `red` 9, against ~4 slots each, so collapse is the rule and
  not the exception (§3.1a). Each family's diff list enumerates its collapses
  with site counts before that family ships. Roles are extended where a collapse
  would be wrong — which is why §3.1 is a floor. `red` → `negative-*` is settled
  in *family*; the per-shade slot count is not.
  A wrong-role error (a destructive `red` becoming `warning-*`) is invisible to
  both the contrast matrix and the gallery, so the per-family diff list *is* the gate.

**Primary proof is equality by construction.** A gallery covering the token layer
cannot vouch for 1,198 sites across stateful panels on live Sanity data.

- **Author the token layer itself** — the `:root` block in `brand.css` and the
  two-layer `tailwind.config.ts` colour config (§3.2, "the part an implementer must not
  improvise"). Phase 0 writes only the `.light { color-scheme }` branch; `.light`
  otherwise stays empty until Phase 2, and the polarity these blocks embody is fixed
  here.
- **Rewrite the 29 `.brand-*` rule bodies off the retired variables — nobody else owns
  this.** §3.1 retires `blackout`/`frost`/`steel`/`deck`/`console`/`beam`, but those are
  consumed **inside `brand.css`**: measured **65 `var(--brand-*)` lines** (`beam` 29,
  `blackout` 9, `frost` 9, `console` 7, `deck` 7, `steel` 5). §3.3 enumerates only the
  beam row; the other ~36 references sat in no phase and no table. Dark values stay
  byte-identical apart from the §3.3 beam→accent row.
  **`app/**/*.css` is in the codemod's scope, not only the inventory's** — and note
  `brand.css` contains **zero hex literals**, so there is nothing here for a hex scan to
  find. The whole CSS-side migration is a variable rename, and its failure mode is
  silent: an undeclared `var()` makes the declaration invalid at computed-value time, so
  it is *dropped* — `.brand-atmosphere`, every glow, `.brand-surface`'s inset highlights
  and shadows simply vanish. ESLint cannot read CSS, `tsc` and `vitest` are blind to it,
  and the VR suite has no runner (§1.0), so **the guard must assert that every `var(--x)`
  referenced in the file is declared** — in `:root`, under `.light`, or on the
  theme-invariant allowlist. That single assertion is what makes this mechanical rather
  than hope.
- Author the **mapping table**, keyed by **(literal × utility × pairing context)**
  — *not* by literal alone, which §1.2c proves impossible. Concretely:
  - a literal **with** a `dark:` sibling maps to a composed token (§3.2) using
    both sides;
  - a literal **without** one maps by its role in situ — `#003572` unpaired → 
    `surface-navy`, `#78350f` unpaired → `warning-surface`;
  - the known-ambiguous literals (`#003572`, `#78350f`, `#C8D8EB`, `#4c1d95`)
    are enumerated per-site in the table and reviewed explicitly.
  - Anything not in the table is a **build error**, so nothing migrates by guesswork.
  - The table must also record the **light** side of every pair *before* the
    codemod deletes the `dark:` variant — otherwise the §1.2b harvest that seeds
    Phase 2 is destroyed by Phase 1.
- Apply by **codemod covering the whole inventory** — bracketed hex, bare hex,
  raw palette classes, `white`/`black`, inline styles and SVG fills (§3.2b) — so
  each dark value is byte-identical by construction except the §3.3
  normalisations. A hex-only codemod would leave ~875 sites theme-invariant.
- **Mechanical pre/post check** asserting each migrated site resolves to the same
  computed colour. Needs a custom-property resolver over `:root` / `.light`
  (**not** `:root` / `.dark` — naming an empty class set is how this gate silently
  passes, and it is Phase 1a's *primary* proof)
  (`bg-accent/20` emits `rgb(var(--accent-rgb) / 0.2)` — note the `-rgb` suffix per §3.1a, not a literal). It must
  compare **sites, not classes** — a codemod that maps every class correctly but
  drops one from a `className` would otherwise pass.
- **Typography:** add a **`theme.extend.typography`** block mapping `--tw-prose-*` onto
  roles, then remove `dark:prose-invert` (§1.4). Under the naming convention
  adopted in §3, the correct form is **`--tw-prose-body: var(--ink)`** (or
  equivalently `rgb(var(--ink-rgb))`) — **not** `rgb(var(--ink))`, which expands
  to `rgb(rgb(215 231 246))`, is not a valid `<color>`, and is dropped silently.
  An earlier revision prescribed exactly that, a leftover from the pre-harvest
  convention where the bare name held the triple. Getting this wrong reintroduces
  the §1.4 regression on song lyrics with no build or lint signal.
  **`extend` is load-bearing, not stylistic:** a top-level `theme.typography`
  *replaces* the plugin's stylesheet rather than merging with it — measured, it
  collapses the compiled prose CSS from ~36.8 KB to ~187 bytes, emitting **zero**
  `prose-sm` rules and dropping all 18 `--tw-prose-*` defaults. `posts/[slug]`
  uses `prose prose-sm sm:prose prose-p:* prose-headings:*`, so the lyrics page
  would render completely unstyled, silently.
  **All 18 non-invert keys must be mapped** — `body bold bullets captions code
  counters headings hr kbd kbd-shadows lead links pre-bg pre-code quote-borders
  quotes td-borders th-borders` — because any unmapped key keeps typography's
  `gray-*` literal, which goes theme-invariant the moment `dark:prose-invert` is
  deleted. Map or null the 18 **`--tw-prose-invert-*`** keys too — the plugin
  declares them in the same `DEFAULT` block, so they survive otherwise.

  > **The obvious assertion is vacuous — measured.** "The compiled `prose` block
  > contains no `gray-` literal" **can never fail**: Tailwind resolves
  > `theme(colors.gray[700])` to `#374151` at build time, so the string `gray`
  > never reaches the stylesheet. Compiled with *zero* keys mapped, the output
  > still contains no `gray` — and 9 distinct hardcoded grey hexes. Assert instead
  > that (a) **no `#[0-9a-fA-F]{3,8}` literal and no `rgb(`-without-`var(`** appears in
  > the compiled `prose` block, (b) `--tw-prose-body` resolves to `var(--ink)`, and (c)
  > `.prose-sm` rules are still emitted — (c) being the only guard on the
  > `theme.typography` collapse above. A `#rrggbb`-only pattern for (a) still passes
  > with all 18 invert keys unmapped, because typography emits five **3-digit** `#fff`
  > literals and two `rgb(… / 10%)` kbd shadows — the same vacuity class as the
  > "no `gray-`" assertion.
- **Delete the other 250 `dark:` variants** — redundant *once the composed token
  carries both sides*, not before (§1.2b).
- **Stage the lint rule by clause, not as one landing.** Its ban list covers ~875
  sites that Phase 1b migrates *per colour family*, each family a separate merge
  (§8 Rollback). Landing the whole rule with 1a would report hundreds of errors on
  every intermediate commit, so the 0-eslint-errors done-gate and "merge to `main`
  periodically" could not both be satisfied. Order: hex + arbitrary-value colour +
  **`rgb()`/`rgba()`/`hsl()` literals — per family, NOT wholesale at 1a** (see below) +
  **the retired `brand-<colour>` keys** +
  **opacity modifiers on Layer-2 keys** with **1a** (1a is what migrates `brand-*`,
  does the §3.2b runtime-colour work, and introduces the composed tokens); each
  palette-family clause with **that family's 1b merge**; `white`/`black` last.
  > **The `rgb()`/`rgba()` clause cannot land wholesale at 1a.** Measured, 15 occurrences
  > carrying five different colours, and three have no role at 1a:
  >
  > | literal | count | role available at 1a? |
  > |---|---:|---|
  > | `rgba(61,255,124,·)` `#3dff7c` (`DayCard.tsx:323,344,347,364`) | 4 | `positive-fg` ✓ |
  > | `rgba(0,191,255,·)` (**`ParticipationSidebar.tsx:81`**, inline style) | 1 | `accent` ✓ |
  > | `rgba(251,191,36,·)` **`#fbbf24` amber-400** (`DayCard.tsx:318,343,346,364`) | 4 | **no — in no table at all**; §3.1 pins `warning-fg` = `#f59e0b` |
  > | `rgba(239,68,68,·)` **`#ef4444` red-500** (`ServiceReadinessCard.tsx:716,722,725,736`) | 4 | **no** — `negative-*` has no pinned values and red is a **1b** family |
  > | `rgba(0,0,0,0.28)` (**`signin/page.tsx:72`**, inside an *arbitrary value*) | 1 | **no** — `white`/`black` is staged **last** |
  >
  > *(An earlier revision had these two rows swapped at the lines it cited — scheduling the
  > one accent site last and a **black** literal at 1a, where §3.1a states there is no
  > `white`/`black` role at all. Collapsing it onto `accent` would have repainted a black
  > drop shadow cyan on the login page. Regenerate this table from Phase 0's inventory
  > rather than by hand.)*
  >
  > **The arbitrary-value-colour clause cannot land wholesale at 1a either.** The four such
  > sites are `AdminPanel.tsx:399`, `ProposalsPanel.tsx:154`, `signin/page.tsx:72`,
  > `(client)/admin/page.tsx:28`. The first and last contain `var(` and are exempted by the
  > prescribed `(rgba?|hsla?)\((?!\s*var\()` lookahead; `ProposalsPanel.tsx:154` is accent;
  > **`signin/page.tsx:72` is black**. So that clause is staged per family too, or 1a needs
  > an `elevation`/black role pulled forward — otherwise `npx eslint .` cannot reach 0
  > errors at the 1a merge.
  >
  > Landing it at 1a errors on nine literals whose roles do not exist yet, and collapsing
  > them onto an existing role is a dark-value change — "a diff outside §3.3 is a defect"
  > by 1a's own gate. So: **`positive`/`accent` literals at 1a; the rest with their
  > family's 1b merge; black last.** Note `DayCard.tsx:362` splits one visual state across
  > phases (`text-amber-400` is 1b, `text-[#3dff7c]` is 1a, and its inline-style twin is
  > the amber `rgba`) — it is re-touched at the amber merge, not left half-migrated.

  Every clause gets a stage — an unassigned clause leaves the 0-eslint-errors gate
  ambiguous at the 1a merge.
- The rule itself (error, per the 0-eslint-errors done-gate) bans, in **any
  string literal** — not just `className`: bare and bracketed hex,
  **`rgb()`/`rgba()`/`hsl()` literals, colour inside arbitrary values with no `#`**,
  raw palette colour utilities, `text-white`/`bg-black`, the retired
  **`brand-<colour>` keys only** (never the 16 `.brand-<component>` classes, which
  are kept — see Phase 0), and **opacity modifiers on composed tokens** (§3.2). Targeting `className` alone
  would miss 31 hex literals in const maps (`DayCard.tsx:37–52`,
  `AvailabilityPanel.tsx:37–39`, `me/page.tsx:36`) — the canonical role-theming
  pattern in this app. `eslint.config.mjs` has no custom plugin infrastructure, but
  `no-restricted-syntax` with `Literal[value=/…/]` and `TemplateElement` selectors
  is sufficient (verified against ESLint 9.39.5). **Add them under an explicit
  `files: ["app/**"]` block** — `eslint.config.mjs`'s rules block has no `files` key, so
  unscoped clauses would fire on `tailwind.config.ts:38`, `scripts/`, `e2e/` and `sanity/`.
  **Exempt list, with reasons:** `app/utils/emailShell.ts` (email palette is
  deliberately light); **`app/(client)/auth/signin/page.tsx:157–160`, the Google
  brand logo** (`#4285F4 #34A853 #FBBC05 #EA4335` — a third-party mark that must
  not be themed); **`app/(client)/layout.tsx:42` `themeColor: "#010b17"`** — a hex
  string that is not a class, not an inline style and not an SVG attribute, so the
  codemod never touches it, yet the rule would error on it and break the
  0-eslint-errors done-gate during Phase 1. It only becomes dynamic in Phase 3;
  **`app/**/__tests__/**`** — `eslint.config.mjs`'s `globalIgnores` does not
  exclude tests, and three already carry hex today
  (`utils/__tests__/emailTemplateGallery.test.ts`,
  `utils/__tests__/notificationEmail.test.ts`,
  `components/__tests__/PracticePlaylistButton.test.tsx`). Worse, §5 *mandates*
  new tests that assert literal colour values — the contrast matrix, the
  computed-colour equality check and token resolution all name colours by value.
  Without this exemption Phase 1 cannot pass `npx eslint .` with 0 errors.
  **Regex cautions — both are traps this rule fell into during review:**
  1. **The naive `rgba?\(` ban forbids the rule's own prescribed fix.** §3.2b
     migrates concatenation sites *to* `rgb(var(--accent-rgb) / 0.05)`, which
     matches `rgba?\(` and would error. Exempting `rgb(` wholesale instead deletes
     the catch for `shadow-[0_0_0_1px_rgb(0_191_255/0.45)]` — the one site named
     as must-catch. Ban it **only when not followed by `var(`**:
     `(rgba?|hsla?)\((?!\s*var\()`.
  2. **Do not anchor with `\b`** — `_` is a word character, so `\b(rgba?)\(` fails
     to match the very arbitrary-value site above.

  Also note `Literal[value=/#[0-9a-fA-F]{3,8}/]` fires on non-colour strings such
  as `href="#abc"`, and the "raw palette colour utilities" clause must enumerate
  every colour-bearing utility — `bg｜text｜border｜ring｜divide｜from｜via｜to｜fill｜stroke｜placeholder｜shadow｜outline｜decoration｜caret｜accent`
  — with their `hover:` / `focus:` / `group-*:` variants. `divide-gray-700` and
  `from-red-500` are easy to miss and go theme-invariant if missed.
- Ship dark-only. The §3.3 normalisations are the only visible changes.

### Phase 2 — Light counterpart design

- (The `redesign/explore` / `7af69d8` review is a **Phase 0** deliverable — the
  polarity decision depends on it. Not repeated here.)
- **Activate the `brand.css` `.light` guard** (§4 Phase 0 says it "binds in Phase 2,
  not Phase 1" — this is where that happens) and **derive the light composited failing
  set from *candidate* light values, before they are finalised.** Not "before any light
  value exists", which would be circular: the darkest-in-light backdrop assumption
  depends on the light `.brand-atmosphere` treatment two bullets below. Candidate-then-
  ratify is the executable order; leaving it circular is how the sequence gets
  reordered ad hoc, which is the waiver risk point 5 exists to prevent.
- Light values for base roles, seeded from the harvested pairs recorded in Phase 1.
- Light *alphas* for the composed tokens — these are **designed, not harvested**,
  because the harvest fixes only the light colour, not its opacity behaviour
  across a redesigned surface set.
- **Light counterparts for the 16 `.brand-*` classes (29 rules incl. pseudo-elements) — the largest single design
  effort in this project, with zero prior art** (§1.5). Glow → tint + soft
  shadow, white-alpha inset → hairline border, atmosphere bloom → warm wash.
- **WCAG AA contrast matrix**, asserted in vitest — with two properties that a
  naive token-pair matrix does not have:

  1. **Scoped to pairs that actually co-occur.** A full cartesian matrix produces
     failures on combinations that never render. Producers, split by kind:
     **(a) same-element** pairs (a `text-*` and a `bg-*` in one `className`) come from
     the inventory, which has the context for them; **(b) within-component** pairs,
     where the ink and the surface are on different elements of the same component; and
     **(c) inherited** ink, resolved from an ancestor or ultimately from `<body>`.
     (b) and (c) come from the hand-authored map in point 4, and **that map's output is
     a set of (ink, effective background) pairs — not a surface nesting alone.**
     This taxonomy has to be complete or the gate silently omits its highest-frequency
     pairs: **197 of 220 `text-gray-500` lines carry no `bg-` on the same line**, so
     (a) covers only ~10% of the largest ink family. A map described purely as
     "~6 surfaces × ~14 composed tokens" has no foreground dimension, and an
     implementer building surface×surface would never test `ink-subtle` against
     `surface-raised` at all.
  2. **Composited on BOTH sides.** The input is
     **(effective foreground, effective background)** — the surface composited over its
     parent, *and the ink composited over its own effective background*. Layer-1 ink
     modifiers are part of the pair key: **`ink-muted@0.5` is a different pair from
     `ink-muted`.**
     Compositing only the background is not a refinement, it is the same optimistic
     error one level over. Measured: **72 `text-[#hex]/α` sites** (plus ~15 palette
     equivalents) — `text-[#00bfff]/70` ×16, `/60` ×13, `text-[#C8D8EB]/70` ×11, `/60`
     ×8, `/50` ×8. Over `#010B17`:

     | Site | Gate with opaque fg | Actually renders |
     |---|---:|---:|
     | `text-[#00bfff]/40` | 9.32:1 | **2.35:1** |
     | `text-[#00bfff]/60` | 9.32:1 | **3.92:1** |
     | `text-[#C8D8EB]/50` | 13.64:1 | **4.02:1** |

     These alphas *survive* tokenisation: §3.1 deliberately keeps ink in Layer 1
     (`rgb(var(--ink-rgb) / <alpha-value>)`) so modifiers keep working, so
     `text-[#C8D8EB]/50` becomes `text-ink-muted/50` and the alpha stays in the class.
     A gate reporting 9.32:1 for a pair rendering at 2.35:1 would green-light dozens of
     genuine sub-AA sites in both themes. All ~87 translucent-ink sites go into Phase 0's
     dark failing-set derivation.
  3. **The base is `brand-atmosphere`, not `surface-base`.** Both root layouts put
     `brand-atmosphere` on `<body>` (`app/(client)/layout.tsx:58`,
     `app/(admin)/layout.tsx:42`), and `brand.css:16` paints it as
     `rgb(var(--brand-blackout))` **plus six gradient layers** of beam at
     0.025–0.2 and deck/console washes. Every translucent surface composites over a
     *gradient*. Compositing "down to a flat `surface-base`" computes a colour that
     never renders — and errs *optimistically* in dark, since the atmosphere is
     lighter than blackout, so the gate would pass pairs that actually fail. Either
     sample the rendered backdrop at worst-case points from the gallery, or use a
     flat approximation — but the approximation **must be conservative and recorded
     as an explicit assumption**, and conservative is **per-pair, not global**: use
     whichever backdrop extreme *minimises* the computed ratio for the pair under
     test. For light *opaque* ink that is the lightest backdrop point; **for dark opaque
     ink it is the darkest** — the lightest backdrop *raises* a dark-ink ratio, so a
     single global direction is optimistic for that whole class. **For translucent ink
     neither extreme is trivially minimising**, because the ink's own luminance moves
     *with* the backdrop (point 2): evaluate both extremes per pair and take the lower.
     Dark ink on a translucent surface is not hypothetical, though it is currently rare:
     **`ImpersonationBanner.tsx:22`** is `bg-amber-500/90 backdrop-blur-sm text-black`
     rendered straight inside `<body class="brand-atmosphere">`. (Other dark-ink sites —
     `CalendarView.tsx:387–389`, `ChordChart.tsx:183`, `ProposalsPanel.tsx:538`,
     `SongSheet.tsx:223` — are on **opaque** surfaces, so the backdrop is irrelevant
     there.) One live site does not fail today, but Phase 1b folds ~875 raw-palette sites
     into this matrix and `text-black` on `bg-amber-*/α` is one of that block's
     commonest shapes. An unconstrained "flat approximation" would also let an
     implementer pick `rgb(var(--brand-blackout))` and reproduce the very error this
     point exists to close.
  4. **Where the parent chain comes from.** Phase 0's inventory emits file, line and
     utility context — it cannot yield co-occurrence or surface nesting, which
     crosses component boundaries (`DayCard` inside `CalendarView` inside a page
     inside a layout). The chain is a small **hand-authored, reviewed
     surface-nesting map** (~6 surfaces × ~14 composed tokens is tractable), or
     `getComputedStyle` measurement over rendered gallery pages. Not "emitted by the
     inventory" — that was asserted, not designed.
  5. **Dark and light failing sets are derived in different phases.** Only the dark
     set is computable in Phase 0, because light base values and light alphas are
     Phase 2 deliverables. The **light** failing set is therefore the *first*
     deliverable of Phase 2, enumerated **before any light value is finalised**,
     under the same normalisation-or-exemption rule. Otherwise light failures get
     discovered late, which is exactly when a gate gets quietly waived.

  The cost of getting this wrong is concrete. An earlier revision pinned three
  "failing" pairs computed on opaque token values. Recomputed against what those
  sites actually render — `CalendarView.tsx:392,394` use `bg-[…]/50` over the page
  base — `warning-fg` on its surface is **6.94:1** and `info-fg` **5.86:1**. Both
  pass comfortably. Acting on the token-level numbers would have "remediated"
  healthy colours, or granted an AA-Large exemption to a pair rendering at 6.94:1 —
  precisely the quiet gate-weakening this section exists to prevent.

  The failing set is therefore **derived in Phase 0 from composited, co-occurring
  pairs**, and whatever it contains is enumerated up front as either a planned
  §3.3 normalisation or an explicit AA-Large (3:1) exemption for pairs used only at
  ≥18.66px bold / 24px. **Note this route may be unusable in practice:**
  `tailwind.config.ts:29-32` overrides `base` to 17px, so almost nothing clears the bar —
  and no named producer emits a font-size dimension (the inventory gives file/line/utility,
  the nesting map gives (ink, background)). If the exemption is to be real, name its
  producer; otherwise expect every failure to need remediation.
- Gallery reviewed in both themes — possible because of the Phase 0 route group.
- `forcedTheme="dark"` still in place. Nothing user-visible yet.

### Phase 3 — The setting

- **Schema:** `themePref` on the **`teamMembers`** document type (the file is
  `sanity/schemas/worshipTeam.ts`; the type name differs). Values
  `"system" | "light" | "dark"`, unset permitted. Requires a **Studio schema deploy**.
- **Add `themePref` to `/me`'s GROQ projection.** `app/(client)/me/page.tsx:48`
  enumerates fields explicitly (`_id, member_name, alias, email, role, memberType,
  notifPrefs, …`); without a `themePref` line the control binds to `undefined` silently.
  `/me` renders per-request (`requireActiveSession` at `:43`) despite `revalidate = 60`,
  so passing `themePref` as a server prop is the cheapest delivery path — bears directly
  on Open item 3 (JWT claim vs fetch).
- **The write route validates the value**, rejecting anything outside
  `"system" | "light" | "dark"`. Without it an authenticated client can write arbitrary
  strings into its own `teamMembers` doc — and `classList.add()` will happily apply one.
- **The write route gates on `requireActiveSession`**, per CLAUDE.md's reusable-utils
  list — conspicuous by omission otherwise, given the cache and client-mutation
  invariants are both spelled out here.
- **`localStorage` is a pure paint cache. Unset-ness lives only in Sanity.**
  Reconciliation calls `setTheme(resolveFromServerPref(themePref))` on every mount and
  never tries to keep the key absent. **`resolveFromServerPref` maps unset → `"dark"`
  at ship** (Decision 9), and **its unset branch is the single seam Phase 4 flips** to
  `"system"`. Getting this backwards is not a typo: resolving unset → `"system"` in
  Phase 3 silently ships OS-following to every member without a `themePref`, *before*
  the volunteer period and *before* the Spanish announcement, and nothing fails —
  `setTheme("system")` is a legal write that the pre-hydration script resolves via
  `matchMedia`. An earlier revision of this bullet said exactly that. Two earlier
  revisions specified an "absent mirror" invariant; both were wrong, and the second
  one loses a race it cannot win:
  - next-themes' `storage` listener is `c.newValue ? r(c.newValue) : f(u)`, where `f`
    is `setTheme`. So **any** removal — including reconciliation's own clear — makes
    every *other* open tab immediately write `defaultTheme` back. Tab A clears → Tab B
    writes `"dark"` → Tab A reads `"dark"`. On any device with two tabs, the mirror
    ends up `"dark"` for a member whose `themePref` is unset, which is the exact
    outcome the invariant existed to prevent, and a single-document unit test cannot
    see it.
  - The invariant also bought nothing. Sanity is the source of truth (Decision 7), and
    `themePref` stays unset there regardless of what the cache holds. **Phase 4's flip
    is a change to the server-side resolution of unset — not to `defaultTheme`** — so
    reconciliation simply re-resolves unset to `"system"` on the next mount.
  - Still true and still required: `setTheme` has **no falsy guard** (verified —
    `useCallback(i => { … localStorage.setItem(o, c) })`, while the internal apply
    function early-returns), so `setTheme(undefined)` writes the literal string
    `"undefined"` and `classList.add("undefined")` sticks. Reconciliation must always
    pass a resolved value, never `undefined`.
- **The mirror IS next-themes' key — there is exactly one.** Pass an explicit
  `storageKey` (e.g. `owt-theme`) to `ThemeProvider`; server-pref reconciliation
  applies via `setTheme()`, which writes that same key; sign-out clears it.
  **Not a second, "distinct" key** — verified in next-themes 0.4.6, the blocking
  pre-hydration script reads `localStorage.getItem(storageKey)` and **nothing
  else**, so a separate mirror key is never consulted before paint and Decision 8
  would silently fail to do the one thing it exists for. Clearing this key on
  sign-out is also what stops the next member on a shared device cold-starting
  into the previous member's theme. §5 asserts *which key the pre-hydration path
  reads*, not merely that reconciliation works.
- **Not in `MemberForm`** — a test asserts its absence, since `AdminPanel.tsx:219`
  makes the adjacent `notifPrefs` admin-editable and the omission would otherwise
  read as an oversight.
- **No cache revalidation.** A per-user preference changes no ISR page content,
  and `app/api/me/notif-prefs/route.ts` — the closest precedent — calls no
  `revalidate*`. Stated explicitly because CLAUDE.md's cache invariant implies
  the opposite.
- **`localStorage` mirror.** Sanity is source of truth and syncs across devices;
  the last-known value is cached locally so next-themes' blocking inline script
  (verified in 0.4.6) paints correctly. **Server wins on arrival, local wins for
  rendering.** Without it, every iOS cold start is paint-dark → hydrate → fetch →
  whole-page inversion, because ADR-0007 makes the session client-side.
  - **Sign-out must clear the mirror — and there are four exits, not one.**
    `SignOutButton.tsx:8`, `BottomNav.tsx:88`, `NavMenu.tsx:159` and
    `(client)/auth/not-a-member/page.tsx:21` each call `signOut(...)` directly. Wiring
    only the obviously-named one leaves three exits caching the previous member's theme —
    exactly the shared-device outcome this clause is justified by — and a test written
    against the wired path false-greens. Add a single `signOutAndForgetTheme()` util,
    route all four through it, and add a filesystem guard on the model of
    `routeMatcher.test.ts` (which walks the tree for precisely this reason).
  - **Reconciliation only runs when `useSession().status === "authenticated"`.** On first
    mount the status is `"loading"`, so an `isImpersonating` check reads falsy and the
    super-admin's mirror would take the target's theme — the very case the skip exists to
    prevent.
  - **Impersonation must be blocked on both sides.** `auth.ts:182` sets
    `token.sanityId = target._id` (with `token.isImpersonating = true` at `:185`),
    so a super-admin who toggles the
    theme while impersonating would (a) paint and persist that member's theme
    locally *and* (b) **silently overwrite the member's stored `themePref` in
    Sanity**. The write must be rejected while `isImpersonating`. (The same hazard
    already exists in `app/api/me/notif-prefs/route.ts`, but theme is far more
    likely to be toggled mid-impersonation.)
    **The read side needs a stated behaviour too:** `/api/me` projects
    `session.user.sanityId`, which during impersonation is the *target's* `_id`
    (`auth.ts:182`), so reconciliation would paint and persist the impersonated member's
    theme into the super-admin's mirror. It self-heals on the next mount after
    impersonation ends — but this section says "decided here, not deferred", and
    `session.user.isImpersonating` is already exposed (`auth.ts:265`), so: **skip
    reconciliation entirely while impersonating.** One check, no new state.
  - The `/me` control is a **client mutation handler**, so CLAUDE.md's invariant
    applies: wrap `fetch` in try/catch/finally, check `res.ok`, reset the loading
    flag, and never close-as-success on failure.
- **Delivery mechanism — constrained, not a free choice.** "Reconcile on every mount"
  plus "server wins on arrival" means **the write must invalidate whatever channel
  reconciliation reads**, or reconciliation reverts the member's own choice.
  A NextAuth JWT claim fails this outright: `auth.ts:105` is
  `session: { strategy: "jwt", maxAge: 7 days }`, and the jwt callback re-reads Sanity
  only on sign-in, on `trigger === "update"`, and via `getMemberAccess` — which projects
  `active`/`role` only, behind a 30-second TTL (`app/utils/memberAccess.ts:3`). So after
  a member picks *Claro*, the claim still holds the old value and the next mount on any
  page **other than `/me`** calls `setTheme(old)` and flips the theme back — silently,
  for up to 30s if `themePref` piggybacks `getMemberAccess`, and **up to 7 days** if it
  is a sign-in-time claim.
  **Decided here, not deferred: reconciliation reads a fresh `GET /api/me`** with
  `cache: "no-store"`. It is always current (`serverClient` is `useCdn: false`), has no
  token and no per-instance cache. `themePref` must be added to **both** explicit
  projections — `app/(client)/me/page.tsx:48` *and* `app/api/me/route.ts:11`, which
  enumerates fields the same way and would otherwise return `undefined` silently.

  **"Server wins on arrival" means *on arrival*.** Reconciliation applies **only when
  `res.ok` AND the body parses as JSON AND it has the expected shape — where "expected
  shape" means `_id` is present — **null-safe**, since `GET /api/me` returns
  `NextResponse.json(member)` and `member` can be a literal `null` (deleted doc) with a 200
  — NOT `"themePref" in body`**. The latter reading is
  exactly the unset case, so it would silently no-op for every member Phase 4 targets
  while `npm test` stays green. §5 asserts that an authenticated 200 body *without*
  `themePref` still resolves and applies; anything else —
  non-200, redirect-to-HTML, throw, parse failure — is a **no-op** that leaves the mirror
  and the current theme untouched. Without that clause the literal instruction is fatal:
  a failed fetch leaves `themePref` absent → `resolveFromServerPref` resolves unset →
  `setTheme("dark")` → and next-themes writes it unconditionally, so **the mirror is
  poisoned and the next cold start also paints dark**. Two live paths make this routine:
  - **Not the login page** — v21's `status === "authenticated"` gate (above) means an
    unauthenticated `/auth/signin` visit never reaches `fetch` at all. An earlier revision
    justified this guard by that path; the gate made it unreachable, and the two
    instructions sat in the spec contradicting each other. The gate is what stands.
    The paths that **do** survive and still need the guard: an **offline Capacitor cold
    start** (§6), and a **stale or expired session** — `status` is `"authenticated"` from a
    cached JWT while the cookie is dead server-side, so the fetch is issued and redirected.
    **Neither gets a 401.** `proxy.ts:3` wraps `withAuth`, and
    `node_modules/next-auth/next/middleware.js:44-47` has no 401 branch at all — it
    returns on success or **redirects to `pages.signIn`** (`auth.ts:109` = `/auth/signin`).
    `/api/me` is inside the matcher, so `fetch` follows the 307 and receives a
    **200 `text/html`** with `res.ok === true`; the route's own 401
    (`app/api/me/route.ts:9`) is unreachable through the middleware. So the guard rests
    entirely on the *parsed-JSON-of-expected-shape* half — a `if (res.status === 401)
    return;` "simplification" would reintroduce the poisoning on the highest-frequency
    path. §5 asserts the **HTML-200** case explicitly, not a 401.
  - This is a Capacitor app with a first-class offline state (§6). An offline cold start
    fails the fetch and poisons the mirror — defeating the very thing Decision 8 exists
    for, repeatedly and durably.

  Because `resolveFromServerPref`'s unset branch is also **the single seam Phase 4
  flips**, this failure inverts sign in Phase 4: a network hiccup would silently ship
  OS-following to a member who explicitly chose Dark.

  **Resolution is client-side only.** Both projections return the **raw** `themePref`;
  `resolveFromServerPref` runs in the client helper. Resolving inside `/api/me` would make
  the two projections disagree — `/api/me` resolved, `me/page.tsx:48` raw — and the `/me`
  control binds to the raw one. (§4 Phase 3 elsewhere calls the Phase 4 seam
  "server-side"; it means *server-stored*, not server-computed.)

  Two mechanisms an earlier revision proposed, both of which fail here:
  - **A JWT claim is stale for up to 30s or up to 7 days.** `auth.ts:105` is
    `strategy: "jwt", maxAge: 7 days`, and the callback re-reads Sanity only on sign-in,
    on the `update` branch, or via `getMemberAccess` at `:240` — which projects
    `{_id, disabled, role}` behind a 30-second TTL (`app/utils/memberAccess.ts:3`), so a
    `themePref` piggybacked there is both stale and coupled to the auth revocation read.
    *(An earlier revision justified this with "`update()` can't reach `:240` because the
    branch returns at `:197`". That reason is wrong: `:157` guards on
    `trigger === "update" && updatePayload`, so an argument-less `update()` skips the
    branch entirely and does reach `:240`. The conclusion stands on the TTL and the
    projection; the reason did not, and this spec warns twice about recording wrong
    reasons.)*
  - **The `memberAccess` cache cannot be busted in production.**
    `app/utils/memberAccess.ts:5` is a module-scope `new Map()` whose only clear
    (`:7`) is marked *"For tests only."* On Vercel the write lambda and the later
    session refresh are frequently different instances, so an in-process clear changes
    nothing — a single-process vitest passes while production reverts the member.
    Piggybacking `getMemberAccess` would also couple a cosmetic preference to the auth
    revocation read, which projects `{_id, disabled, role}` for a reason.

  "Reconciliation must not override a locally-newer choice" is also rejected: it needs a
  local recency marker, i.e. a second `localStorage` key that this same section forbids,
  and "local always wins" contradicts Decision 7's cross-device sync — a member picking
  *Claro* on their phone would never see it on a desktop holding an older explicit
  `"dark"`.

  §5 asserts that an explicit choice survives navigation — the test that would have
  caught this — and it must exercise the real channel, not a same-process cache.
- Control on `/me`, as a **sibling** of `<ProfilePanel/>` — matching
  `TextSizeControl` at `app/(client)/me/page.tsx:437`, which is a sibling of
  `ProfilePanel` at :436, not inside it. Spanish labels: **Seguir sistema · Claro
  · Oscuro**. `TextSizeControl` persists device-locally while `themePref` syncs;
  two adjacent controls behaving differently deserves a line of copy.
- `viewport.themeColor` set client-side (a media-query pair cannot express an
  *explicit* choice, e.g. Light on a dark-OS phone).
- **iOS status bar — in scope with a named mechanism.** Both layouts set
  `appleWebApp.statusBarStyle: "black-translucent"` (white status-bar text, page
  drawing underneath via `viewportFit: "cover"`). On a light page that is
  white-on-light. Because static route metadata cannot follow a runtime
  preference, this requires `@capacitor/status-bar` for the native shell plus a
  client-side update for PWA/standalone. **This is Phase 3 work, not a planning
  question** — it is the one place the spec calls a bug a correctness issue.
- **Precondition: every Phase 1b family has landed.** Nothing else in this spec forbids
  starting Phase 3 with families outstanding, and doing so would ship light mode over
  un-migrated palette families — literally the ADR-0008 drift this document exists to
  end.
- Remove `forcedTheme="dark"` from [`Provider.tsx:16`](../../../app/utils/Provider.tsx)
  and set `enableSystem`. **`defaultTheme="dark"` must be set explicitly** —
  next-themes defaults it to `"system"` once `enableSystem` is on, which would
  silently ship Decision 9's rejected default.

### Phase ownership of cross-cutting deliverables

Named in §6/§7/§8 but, through several revisions, in no phase checklist — the defect
class that recurred as v11 #6, v12 #3 and v22. Assigned here so it stops recurring:

| Deliverable | Phase | Test-guarded? |
|---|---|---|
| `docs/SECRETS.md` entry for the gallery env flag | **0** | No — CLAUDE.md rule only |
| `docs/ROUTES.md:46` gallery row | **0** | No |
| ADR: two Playwright configs | **0** | `adrIndex.test.ts` |
| `tailwind.config.ts:38` `boxShadow.bottom` → `elevation` | **1a** | No |
| ADR: token vocabulary (incl. the naming rule) | **1a** | `adrIndex.test.ts` |
| CLAUDE.md + AGENTS.md **invariants** | **1a** | `agentDocsParity.test.ts` |
| CLAUDE.md + AGENTS.md **stack line** ("Dark-mode only") | **3** | `agentDocsParity.test.ts` |
| Retire the seven `brand.*` colour keys in `tailwind.config.ts` | **1a** | lint clause |
| Decide the `(admin)` chrome around `/studio` (Open item 4) | **1a** — 1a retires the `bg-brand-blackout text-brand-frost brand-atmosphere` that `(admin)/layout.tsx:42` carries, so it cannot land unresolved | No |
| Rollback tags before 1a and before each 1b family (§8) | **1a / each 1b** | No |
| `npx cap sync` + native rebuild for `@capacitor/status-bar` (§8) | **3** | No |
| AA dark failing-set **re-derivation** (incl. the conservative-backdrop assumption, which 1a's beam→accent row repaints) | **the 1a merge AND each 1b family merge** | No |
| Compiled-prose assertions (§4 Phase 1) | **1a** | vitest |
| WCAG AA contrast matrix (§4 Phase 2) | **2** | vitest |
| `docs/DATA_MODEL.md:61` `themePref` field | **3** | No |
| `docs/API_REFERENCE.md` write route | **3** | No |
| `docs/UTILITIES_AND_COMPONENTS.md:165` — retire `ThemeSwitch`, add the `/me` control | **3** | No |
| Supersede ADR-0008 (+ its README Status column) | **4**, on completion | `adrIndex.test.ts` (link only) |

The unguarded rows are the ones that get missed; §7 says so and then left them
unassigned. Note the **stack line is Phase 3, not 1a**: at 1a `forcedTheme="dark"` is
still in `Provider.tsx:16`, so retiring "Dark-mode only" earlier would make the doc
false for two phases.

### Phase 4 — Staged rollout

- Ship with unset → Dark. Light is opt-in from `/me`.
- Volunteer opt-in period (~1 week).
- Flip unset → Follow System with a one-time Spanish in-app announcement.

Because unset is distinguishable from an explicit `"dark"`, the flip is a default
change, not a migration — made with evidence rather than on faith.

## 5. Testing

- **Vitest:** token resolution (both layers); **computed-colour equality per
  migrated site**; WCAG AA contrast matrix, both themes; `themePref` round-trip
  and invalid-value fallback; `localStorage` mirror reconciliation, sign-out
  clearing, impersonation isolation; `MemberForm` does **not** expose `themePref`;
  the gallery's gating helper returns 404 in production **and on an invalid
  `[theme]` segment** (a unit test of the helper — vitest cannot exercise a Next
  production build; the served-route check belongs to the Phase 0 Playwright config);
  the compiled `prose` block contains no `#[0-9a-fA-F]{3,8}` literal and no
  `rgb(`-without-`var(` (a `#rrggbb`-only pattern still passes with all 18 invert keys
  unmapped — see §4), `--tw-prose-body`
  resolves to `var(--ink)`, and `.prose-sm` rules are still emitted; **the pre-hydration path
  reads the one storage key next-themes owns**; **reconciliation always passes a RESOLVED value and never `undefined`** (§4 Phase 3); **nothing writes a default `themePref` to Sanity** — note the *mirror* holding `"dark"` for an unset member is expected and by design (§4 Phase 3); an earlier wording read as the absent-mirror invariant v13 dropped, and a test author following it literally would "fix" it by reviving the multi-tab race. Nothing persists to Sanity on first
  render** — Phase 4's staged flip depends entirely on unset staying
  distinguishable from an explicit choice, so the `/me` control and the API route
  must both be asserted never to write a default.
- **ESLint:** the full colour ban list of §4 Phase 1, in any string literal (error).
- **Visual regression:** gallery baselines in both themes. **Phase 1a** diffs must
  match the §3.3 normalisation list exactly — any other diff is a defect.
  **Phase 1b** is gated per colour family against that family's enumerated diff
  list, not against §3.3.
- **Manual (device):** iOS cold start paints correctly with no inversion flash;
  status bar readable in light; Follow System tracks an OS theme change;
  **song lyrics (`/posts/[slug]`) correct in both themes** (§1.4).

## 6. Scope boundaries

- **In:** all app components and `brand.css`; both token layers; the typography
  theme; `themePref` schema, API and `/me` control; `localStorage` mirror; dynamic
  `viewport.themeColor`; iOS status bar; gallery and VR harness; lint rule;
  contrast gate.
- **Out, deliberately:**
  - **Sanity Studio's own theming** at `/studio`. Note
    `app/(admin)/studio/[[...tool]]/page.tsx` sits inside the `(admin)` root
    layout, which sets `bg-brand-blackout text-brand-frost brand-atmosphere` on
    `<body>` — retiring those tokens **does** touch the Studio's surrounding
    chrome. Decide in planning whether that chrome follows the theme or pins dark;
    the Studio panel itself is untouched either way.
  - **Email templates** stay light — five attempts to hold a dark palette against
    Outlook for Mac failed (CLAUDE.md landmines, `docs/NOTIFICATIONS.md`).
  - **`manifest.webmanifest`** `theme_color` / `background_color` and the PWA
    splash stay `#010b17`. A static file cannot follow a runtime per-user
    preference. A permanent, documented remnant — not a bug to be found later.
  - **`tailwind.config.ts`** — edited by this design but outside its own `app/**`
    inventory, codemod and lint scope. It carries one colour literal,
    `boxShadow.bottom: "0px 6px 4px -4px rgba(0, 0, 0, 0.1)"` (`:38`), consumed once
    at `app/components/Header.tsx:15`. **Migrated with 1a** onto the `elevation` role — it has exactly one consumer,
    `app/components/Header.tsx:15`, which also carries
    `shadow-[#002249] dark:shadow-[#00bfff]` on the same element, so the two must move
    together.
  - **Raster brand assets.** `/icons/backstage-v2-*.png` (an opaque `#010b17` tile mark,
    rendered at `Navbar.tsx:24`, `CmsNavbar.tsx:11`, `signin/page.tsx:57`) and
    `/LogoOasis.png` (`not-a-member/page.tsx:10`) are outside the inventory glob, the
    codemod, the lint rule and the gallery **by construction**. They stay as-is unless
    Phase 2 decides otherwise — recorded here so it is a decision, not an omission.
  - **`mobile/fallback/index.html`** — the Capacitor offline page inside the
    native shell. It carries `#010b17`, `#00bfff` and `#C8D8EB`, and sits outside
    `app/**`, so it escapes the inventory, the codemod **and** the lint scope. It
    stays dark: it is shown when the device is offline, before any preference can
    be read. Listed here so it is a decision rather than an omission.

## 7. Decision records

- **Supersede ADR-0008** — the changed constraint is tokenisation.
- **New ADR — token vocabulary.** Must carry the **naming rule** from §3.1 (a
  token key may never begin with a utility prefix — `border-accent` compiles to
  `.border-border-accent` while `.border-accent` silently resolves to the base
  `accent` role). That rule bit this design twice during review and is invisible
  from reading the config. Also: why
  `blackout`/`frost`/`beam` were retired; why `#12C8F4` lost to `#00bfff`; why
  `#003572` split into `accent` and `surface-navy`; **and why a second,
  alpha-baked token layer exists** (§1.2b — the non-obvious one most likely to be
  "simplified" away later).
- **New ADR — two Playwright configs.**
- **`CLAUDE.md` invariants** gain the two rules that are invisible from reading the
  config: *a component may never name a palette*, and *a token key may never begin
  with a utility prefix*. That list is this repo's real anti-drift surface for
  agents and is read before the done-gate rather than after. CLAUDE.md's stack
  line ("Dark-mode only") also needs updating. **Both edits must be mirrored into
  `AGENTS.md` in the same commit** — `agentDocsParity.test.ts` asserts the two
  files are byte-identical after normalisation, so `npm test` fails otherwise.
- **`docs/adr/README.md` must be updated in the same commit.**
  `app/utils/__tests__/adrIndex.test.ts` requires every `docs/adr/NNNN-*.md` to be
  linked from that README, to match `/^# ADR-\d{4}: .+/`, to carry a
  `**Date:** … **Status:**` line, and to number consecutively from 0001 — so adding
  two ADRs without indexing them fails `npm test`. This is the third on-disk guard
  in the same family as `routeMatcher.test.ts` and `agentDocsParity.test.ts`.
- **Four docs drift with this change** (none guarded by a test, which is why they get
  missed): `docs/DATA_MODEL.md:61` documents `teamMembers` field-by-field including
  `notifPrefs` and needs a `themePref` entry; `docs/API_REFERENCE.md` needs the new
  write route; plus: `docs/ROUTES.md:46` is a maintained route
  table with a "Public" column and needs a row for the gallery route; and
  `docs/UTILITIES_AND_COMPONENTS.md:165` still lists the `ThemeSwitch` deleted in
  `33c6e15` — this is the change that should retire that line.

## 8. Deployment notes

- **Studio schema deploy** required for `themePref` on `teamMembers`.
- **One new environment variable — `docs/SECRETS.md` entry required in the same
  change**, per CLAUDE.md. Phase 0's gallery gate (§4) is an explicit flag rather
  than bare `NODE_ENV`. The entry must record: needed on **Vercel Preview** and in
  local `.env.local`; explicitly **not** set in Production; not a secret (a boolean
  feature flag, so no rotation blast radius); and that setting it in Production
  would expose an unauthenticated route, since the gallery sits behind the `auth`
  matcher exclusion. Never record a value.
- **Lint-rule scope:** any string literal in `app/**` (§4 Phase 1), not just JSX
  `className`. `app/utils/emailShell.ts` is exempt by design (the email palette is
  deliberately light); `app/components/admin/serviceCardModel.ts` (non-JSX,
  strings feed `className`) **is** migrated. The exempt list lives beside the rule
  and is reviewed with it.
- `@capacitor/status-bar` is added in Phase 3 (§4), requiring `npx cap sync` and a
  native rebuild.
- Per CLAUDE.md: branch, merge to `main` periodically, direct push, no PRs.
  Done-gate: `npx tsc --noEmit`, `npm test`, `npx eslint .` with 0 errors.
- **Phase 2 is atomic too.** Guard (i) self-activates on the first `.light` custom
  property and then demands a counterpart for *every* `:root` property, so Phase 2 cannot
  be merged family-by-family the way 1b can. Tag before it, land it whole.
- **Rollback.** A ~2,310-site mechanical rewrite across 44+ files sits awkwardly
  against "merge to `main` periodically". Tag a known-good commit before Phase 1a
  and before each Phase 1b family; each family is independently revertible, and
  1a lands atomically because a half-migrated token layer compiles but renders
  wrong.

## 9. Open items for planning

1. Per-family mapping of the 837 raw palette classes and 38 `white`/`black` uses
   onto roles — in scope (§1.1) but the per-family judgement is planning work.
   `red` → `negative-*` is settled; `yellow`/`orange`/`amber` vs `warning-*` is not.
2. Codemod and mapping-table authoring — the table is the inventory script's
   reviewed output (§1.0), produced **before** any file changes.
3. ~~`themePref` delivery: JWT claim vs `/api/me` fetch.~~ **Decided in §4 Phase 3**
   (fresh `GET /api/me`, `cache: "no-store"`); a JWT claim is unsafe here — see the
   30s-TTL / `{_id, disabled, role}`-projection argument there.
4. Whether the `(admin)` chrome around `/studio` follows the theme or pins dark.
   **Blocks the 1a merge** — 1a retires the `bg-brand-blackout text-brand-frost
   brand-atmosphere` that `(admin)/layout.tsx` carries (see the ownership table).
5. Placement and copy of the Phase 4 Spanish announcement.

## 10. Rejected alternatives

- **Re-adding `dark:` variants to the lagging files.** The cheap revival, and the
  one ADR-0008 already tried. 238 of 251 existing variants contain a hex literal,
  so this scales the drift rather than removing it.
- **Alpha in the utility class** (`bg-surface-accent/20`). The obvious Tailwind
  idiom, and wrong here: 169 of 225 pairs vary alpha per theme, so a
  theme-invariant modifier cannot express them (§1.2b).
- **Mechanical palette inversion.** Glows become smudges, inset highlights vanish.
- **Server-side rendering the theme.** One source of truth and no flash, but a
  session read in a shared layout opts every page out of static/ISR rendering —
  what ADR-0007 forbids.
- **Screenshots as the primary Phase 1 gate.** The hermetic gallery cannot host
  the stateful panels where the hex mass lives (§4 Phase 0).

## 11. Review history

- **v1** — initial design from the grilling thread.
- **v2** — adversarial round 1 (4 blockers, all verified and fixed): 10-role
  vocabulary could not represent the palette; gallery could not be hermetic or
  render both themes under `(client)`; VR gate did not cover the blast radius;
  `dark:prose-invert` was not redundant.
- **v3** — adversarial round 2 (4 blockers, all verified and fixed):
  **(1)** a literal-keyed mapping table cannot be authored — same literal, different
  roles (§1.2c, §4 Phase 1 re-keyed to literal × utility × context);
  **(2)** *theme-varying alpha* — 169 of 225 pairs vary opacity per theme, which the
  single-layer model could not express, forcing the composed token layer (§1.2b,
  §3.2) and invalidating "delete all `dark:` variants, redundant by construction";
  **(3)** 16 roles still could not represent `#1c0800`/`#1e0a3c`/`#92400e`/`#5b21b6`,
  forcing fg/surface/border splits on all three state roles (§1.3, §3.1);
  **(4)** the gallery could not render its own stated inventory —
  `AdminPanel.useSession()` throws without a provider and two panels fetch on
  mount, so stateful panels are dropped and coverage restated honestly (§4 Phase 0).
  Also corrected: `brand.css` has **no** pre-`33c6e15` version, so Phase 2's git
  fallback is empty for the hardest surface (§1.5); §1.6 undercounted (23, not 20,
  including `(client)/layout`); the Sanity type is `teamMembers`, not `worshipTeam`;
  iOS status bar moved from a planning question into Phase 3 scope.
- **v4** — adversarial round 3 (4 blockers, all verified and fixed):
  **(1)** `surface-accent` was defined twice with incompatible dark values — one
  Tailwind key cannot be both an opaque navy base role and a 20%-accent composed
  token; renamed to `surface-navy` / `surface-accent-tint` (§3.1, §3.2);
  **(2)** *runtime colour* — 25 bare-hex sites (not 3) set colour via inline styles,
  SVG attributes and 8-digit hex concatenation (`` `${t.accentHex}0d` ``), which a
  CSS custom property cannot express at all; new §3.2b adds `color-mix()`,
  `currentColor` and chart roles;
  **(3)** ~875 non-hex colour sites (837 raw palette + 38 `white`/`black`) sat
  outside the codemod, the lint rule and the AA matrix — and `red`, at 174 uses the
  second-largest family, had no role; all brought into scope with a new
  `negative-*` role (§1.1, §3.1, §4 Phase 1);
  **(4)** unpaired dark-native tints could not be byte-identical to a `-surface`
  role, forcing `-surface-strong` on every state (§3.1, §3.3).
  **Structural change:** the colour inventory is now a *generated artefact* and
  Phase 0's first deliverable (§1.0, §4 Phase 0) — three successive hand-counts
  each understated the surface, so hand-counting is retired.
  Also fixed: opacity modifiers on composed tokens emit no CSS at all (§3.2);
  the gallery needs a `[theme]` dynamic segment; env-flag gating so Preview still
  renders it; `theme.typography` must wrap channel triplets in `rgb()`;
  `defaultTheme="dark"` must be explicit; 16 `.brand-*` classes, not ~20.
- **v5** — adversarial round 4 (5 blockers, all verified and fixed):
  **(1)** three composed tokens (`border-accent`/`-subtle`/`-default`) collided with
  Tailwind's utility prefixes — `.border-accent` silently resolves to the base
  `accent` role and the other two emit no rule, 62 sites affected; renamed to
  `edge-*`, structural roles renamed `edge`/`elevation`, and the **naming rule is
  now an ADR requirement** (§3.1, §7) because this bug class struck twice;
  **(2)** the gallery's root layout must sit **at** `[theme]`, not above it — Next
  passes params only from the root down to that layout, so a `(gallery)/layout.tsx`
  would receive `{}` (§4 Phase 0);
  **(3)** the lint ban list omitted `rgb()`/`rgba()` literals (14 sites) and colour
  in arbitrary values with no `#`, and the exempt list omitted the **Google brand
  logo** at `signin/page.tsx:157–160`, which must never be themed (§4 Phase 1, §8);
  **(4)** §3.2b's hand-count was internally inconsistent and missed a **second
  `accentHex` mechanism**, `CARD_ACCENT_HEX` in `ServiceReadinessCard.tsx` — the
  table now defers to Phase 0's generated inventory (§3.2b);
  **(5)** §8 claimed no new env vars, but Phase 0's gallery gate introduces one,
  which CLAUDE.md requires be documented in `docs/SECRETS.md` in the same change (§8).
  Also fixed: `color-scheme: dark` would corrupt the *light* gallery because it
  runs without the provider that currently masks it (§1.5); `brand-*` classes added
  to codemod scope; Tailwind version citation corrected to 3.4.19; §5/§8 lint scope
  aligned.
- **v6** — adversarial rounds 5 & 6 (run in parallel; both `CHANGES_REQUIRED`).
  **The significant finding is prior art.** v5 claimed `redesign/cantoral` was
  "genuinely gone" — **false**: the Cantoral work lives on **`redesign/explore`**,
  and carries a complete, working, light-first two-theme token system, plus
  `ThemeToggle.tsx`, `REDESIGN_PROPOSAL.md`, and commits fixing theme flash and
  theme-flipping surfaces. Per the user's decision its **mechanics are harvested
  and its palette is not** (§3 preamble): dual exposure (`--foo-rgb` + `--foo`),
  semantic aliases flipped by `.dark`, and pre-multiplied tokens for theme-varying
  alpha. That single harvest retires three problems four rounds could not settle —
  the invalid `color-mix` prescription (§3.2b), the never-specified composed-token
  config shape (§3.2), and the opacity footgun, which Cantoral documents as
  intentional rather than a trap. §1.5's zero-prior-art budget is narrowed to the
  16 `.brand-*` compositing classes, where it still holds.
  Other blockers fixed: **Phase 1 split into 1a/1b** because one gate cannot cover
  both byte-identical hex migration and ~875 raw-palette sites the spec itself
  called "unmeasured" (§4, §5); the corrected cause of the opacity footgun (only
  `var()`-valued keys fail — `rgba()` and `#RRGGBBAA` accept modifiers fine), which
  matters because §7 enshrines that rationale in an ADR; the lint exempt list now
  covers `themeColor: "#010b17"`, which would otherwise break the done-gate in
  Phase 1; `\b` anchors dropped from colour regexes since `_` is a word character;
  and impersonation is blocked on the **server write** as well as the local mirror
  (`auth.ts:185`), plus CLAUDE.md's client-mutation invariant stated for the `/me`
  control. ADR-0009's open question — whether the abandoned branches held anything
  worth harvesting — is answered yes, and Phase 2 now records the answer.
- **v7** — adversarial rounds 7 & 8 (parallel; both `CHANGES_REQUIRED`, converging
  independently on the same top two). All fixed:
  **(1)** *the harvest introduced its own bug* — adopting Cantoral's `--x-rgb` /
  `--x` convention left §4's typography line prescribing `rgb(var(--ink))`, which
  under the new convention expands to `rgb(rgb(215 231 246))` and is dropped
  silently, reintroducing the §1.4 lyrics regression. The convention is now stated
  once and bindingly (§3.1a) and the line corrected;
  **(2)** *Phase 1b's byte-identity promise was false* — the palette families carry
  ~36 distinct (family, shade) pairs (`gray` 7 shades, `red` 9) against ~19 slots,
  so collapse is the rule, not the exception. §3.1 is now explicitly a **floor**,
  Decision 3 is **provisional**, and Phase 0 gains the palette-family shade
  analysis that §1.3 was only ever run on the hex surface;
  **(3)** *the lint rule banned its own prescribed fix* — `rgba?\(` matches
  `rgb(var(--accent-rgb) / 0.05)`, the migration target from §3.2b; now
  `(rgba?|hsla?)\((?!\s*var\()`;
  **(4)** *"it runs in CI" was fiction* — `.github/workflows/` holds only
  `flush-notifications.yml`; nothing runs eslint/vitest/tsc and CLAUDE.md forbids
  PRs, so the anti-drift guarantee is re-expressed as a **vitest sync guard** on
  the `routeMatcher.test.ts` model, and the VR suite's lack of a runner is stated;
  **(5)** *the lint rule broke the done-gate on tests* — three existing test files
  carry hex and §5 mandates new tests asserting colours by value; `__tests__` is
  now exempt.
  Also fixed: `surface-navy` propagated out of §3; role arithmetic reconciled to 34;
  `requireActiveSession` named on the write route; `[theme]` validated and 404'd;
  the mirror's storage key disambiguated from next-themes' own; the `auth.ts`
  citation corrected to `:182`; §1.1 marked provisional pending the inventory.
- **v8** — adversarial rounds 9 & 10 (parallel; both `CHANGES_REQUIRED`, converging
  independently on the same #1 — a bug v7 itself introduced). All fixed:
  **(1)** *the storage-key rule broke Decision 8* — v7 mandated a "distinct" mirror
  key, but next-themes 0.4.6's pre-hydration script reads `localStorage.getItem(storageKey)`
  and **nothing else**, so the mirror would never be consulted before paint and the
  iOS cold-start inversion it exists to prevent would still happen. There is now
  **exactly one key**: an explicit `storageKey`, written by `setTheme()`, cleared on
  sign-out (§4 Phase 3);
  **(2)** *`:root` polarity was never decided, and the harvest's polarity is wrong here* —
  Cantoral is light-first, Backstage ships unset→Dark, so copying it would hand an
  un-themed light first paint to every user. Cantoral hit this exact bug and fixed it
  in `7af69d8`. Dark stays in `:root`, light under `.light`, **decided in Phase 1a**,
  and the `redesign/explore` review moves from Phase 2 to Phase 0 (§3.1b);
  **(3)** *the AA ship gate was unsatisfiable against the spec's own pinned values* —
  `ink-subtle`/`surface-navy` is 3.83:1, `warning-fg`/`warning-surface-strong` 4.22:1,
  `info-fg`/`info-surface-strong` 4.03:1, all live pairings and all on values §3.3
  promises to keep byte-identical. The matrix is now scoped to co-occurring pairs, with
  the three known failures enumerated up front as planned remediations or AA-Large
  exemptions (§4 Phase 2);
  **(4)** *`theme.typography` would have wiped the prose stylesheet* — a top-level key
  replaces rather than extends the plugin (~36.8 KB → ~187 bytes, zero `prose-sm`
  rules), rendering the lyrics page unstyled with no build signal. Now
  `theme.extend.typography`, with all 18 `--tw-prose-*` keys enumerated;
  **(5)** *the gallery breaks `npm test`* — `routeMatcher.test.ts:51` asserts
  `ungated === PUBLIC_ROUTES`, so the new unauthenticated route must be added there
  with a reason. "No matcher edit" was true of `proxy.ts` only, and that guard is
  precisely the auth review Phase 0 owes;
  **(6)** *`generateStaticParams` does not 404* — `dynamicParams` defaults true, and a
  build serves `/auth/theme-gallery/EVIL` with 200 and `<html class="EVIL">`; now
  `dynamicParams = false`.
  Also fixed: `mobile/fallback/index.html` carries three hex colours outside `app/**`
  and escapes inventory, codemod and lint — now a documented remnant (§6); role
  arithmetic reconciled to 34 everywhere; the CLAUDE.md/AGENTS.md invariant addition
  named, with its `agentDocsParity.test.ts` constraint; the `.ts` exempt-vs-migrate
  split stated plainly (§1.0, §8).
- **v9** — adversarial rounds 11 & 12 (parallel; both `CHANGES_REQUIRED`, converging
  on the same four — three of them regressions v8 itself introduced). All fixed:
  **(1)** *§3.2's normative snippet encoded the polarity §3.1b had just rejected* —
  it showed light in `:root`, dark under `.dark`, in the one section the spec calls
  "the part an implementer must not improvise", covering the composed tokens most
  visible at first paint. Now `:root` = dark / `.light` = light, with an invariant
  that no token may live only in `:root`, and the Phase 1a equality resolver
  corrected from `:root`/`.dark` to `:root`/`.light` — naming an empty class set is
  how that gate would have silently passed;
  **(2)** *the prose gate was vacuous* — "no `gray-` literal in the compiled prose
  block" **can never fail**, because Tailwind resolves palette names to hex at build
  time; compiled with zero keys mapped the output contains no `gray` and nine grey
  hexes. Now asserts no `#rrggbb` literal, `--tw-prose-body` resolving to
  `var(--ink)`, and that `.prose-sm` rules are still emitted — plus the 18
  `--tw-prose-invert-*` keys must be mapped or nulled;
  **(3)** *the three enumerated AA failures were computed on colours that never
  render* — the cited sites use `bg-[…]/50`, so composited over the page base they
  are **6.94:1** and **5.86:1** and pass comfortably. Acting on the token-level
  numbers would have granted an AA-Large exemption to a 6.94:1 pair — the exact
  gate-weakening that subsection exists to prevent. The matrix now requires a
  **compositing model** (fg over surface over `surface-base`) and derives its
  failing set in Phase 0 rather than pinning a wrong table;
  **(4)** *`brand-*` conflated two things* — ~215 retired `brand-<colour>` keys
  versus the 16 **kept** `.brand-<component>` compositing classes that Phase 2
  exists to design. A wholesale ban would error on all 16 and strip
  `brand-atmosphere` off both root layouts; the non-colour `--brand-radius-*` /
  `--brand-duration-*` vars are now explicitly out of scope.
  Also fixed: the lint rule is **staged by clause** across 1a and each 1b family, so
  intermediate commits can still pass the 0-eslint-errors done-gate; `PUBLIC_ROUTES`
  correctly located in `routeMatcher.test.ts:34` with the literal
  `/auth/theme-gallery/sample` entry; the production-404 check moved off vitest onto
  the Playwright config; §3.1b's flash mechanism restated correctly (the script is
  synchronous during parse — the real reason is that no theme class is emitted
  server-side); equal-specificity source ordering generalised from `color-scheme` to
  every token; `CARD_ACCENT_HEX` citations corrected.
- **v10** — adversarial rounds 13 & 14. Round 13 returned **one** blocker (down from
  four in rounds 11–12); round 14 was lost to an API error mid-response and returned
  no verdict. The blocker, verified and fixed:
  *the AA gate's compositing base was a colour that never renders.* v9 required
  compositing "down to `surface-base`", but both root layouts put `brand-atmosphere`
  on `<body>` and `brand.css:16` paints it as blackout **plus five gradient layers**.
  Worse, the error was optimistic — the atmosphere is lighter than blackout, so the
  gate would have passed pairs that actually fail. This was structurally the same
  mistake v9 had just fixed, one level down. §4 Phase 2 now names the real backdrop,
  requires a hand-authored surface-nesting map (the inventory emits file/line context
  and cannot yield nesting, which crosses component boundaries), and splits the
  derivation: the dark failing set in Phase 0, the **light** failing set as Phase 2's
  first deliverable, before any light value is finalised.
  Also fixed: §3.1b recorded a **false reason** for a correct decision — polarity is
  not "baked into ~2,310 sites" (migrated sites carry theme-agnostic names; polarity
  lives only in `brand.css`) but is decided early because Phase 1a's equality gate
  resolves against `:root`/`.light`; and §4 Phase 1 violated §3.1a's own binding
  convention by writing `rgb(var(--accent) / 0.2)` instead of `--accent-rgb`, in the
  paragraph describing Phase 1a's primary proof.

### Known-open items (carried, not blocking)

- **Nothing bans re-adding a `dark:` variant.** Polarity now lives in `brand.css`, so
  `dark:bg-surface-raised` in a future component is drift the hex ban will not catch.
  Consider dropping `tailwind.config.ts:10` `darkMode: "class"` once the 251 variants
  are gone, so such a variant fails to compile rather than silently working.
- **Test files are exempted from lint but must be migrated with the code they assert.**
  Make this a rule, not a hand-list: **the codemod's file set is intersected with
  `app/**/__tests__/**`, and every colliding assertion is updated in the same merge.**
  Known collisions at 1a: `PlannerGrid.test.tsx:366` (`span[class*="bg-[#00bfff]/70"]`) and
  `:420` (`toContain("border-[#00bfff] bg-[#00bfff]/10")`), which target
  `PlannerGrid.tsx:1175` and `:1153` — and `:1175` also carries `bg-gray-700`, so that one
  line straddles the 1a/1b seam while the test asserts only its 1a half. Without this,
  **`npm test` cannot pass at the 1a merge.**
  `PracticePlaylistButton.test.tsx` passes `accent="#12C8F4"` into the component whose
  colour mechanism §3.2b changes, so it needs updating with 1a regardless.

- **Mixed `dark:` pairs straddle the 1a/1b seam** — ~12 variants target Tailwind
  palette classes, so a pair like `text-gray-400 dark:text-[#C8D8EB]` has its dark
  side in 1a and its light side in 1b, and neither gate owns it. Assign in planning.
- **`useTheme().theme` returns `"dark"` for an unset member**, since next-themes seeds
  from `localStorage.getItem(key) || defaultTheme`. Phase 4's staged flip depends on
  unset staying distinguishable, so the `/me` control must bind to the **server**
  `themePref`, not to next-themes' `theme`.
- **Phase 0's env flag should fail the build closed.** `next.config.mjs:1` already
  calls `assertDeploymentCoherence(process.env)`; refusing a build where the gallery
  flag is set and `VERCEL_ENV === "production"` converts a documented promise into an
  enforced one for about three lines.
- **Good news for Phase 3's iOS status bar:** `ios/App/App/Info.plist:59–60` already
  sets `UIViewControllerBasedStatusBarAppearance` to `false`, which is the
  precondition for `@capacitor/status-bar`'s runtime `setStyle` to apply app-wide.
  Only the launch-moment bar stays `UIStatusBarStyleLightContent`.
- **Also outside `app/**` and outside the inventory:** `ios/App/App/Info.plist:57–58`
  and `android/app/src/main/res/values/styles.xml:7–8` statically pin native colours.
  Treat like `mobile/fallback/index.html` (§6) — documented remnants.
- **§11 should move to the ADR's Context on sign-off.** It is now the longest section
  in a document an implementer has to read.
- **v11** — adversarial rounds 15 & 16 (parallel; both `CHANGES_REQUIRED`, 3 blockers
  each). All verified and fixed:
  **(1)** *the v10 polarity flip left a dangling variable* — §3.2's `.light` branch
  wired `--surface-navy-rgb`, which is never defined for light and whose Phase 2 light
  value will not be `#003572`. It now resolves `--accent-rgb`, matching §3.1 and
  §3.2's own table. Wrong here would have been wrong on the 32 highest-frequency
  composed-token sites, invisibly to both the AA matrix and a swatch gallery;
  **(2)** *`app/brand.css` sat outside every gate* — the inventory scans `.tsx` only,
  and `eslint.config.mjs` has no CSS processor (verified: `npx eslint app/brand.css`
  → 0 errors), so §3.2's core invariant had **no enforcement** and the token file
  itself could drift. The inventory now covers `app/**/*.css` and a vitest guard
  parses `brand.css`, requiring every `:root` custom property to have a `.light`
  counterpart or sit on a reviewed theme-invariant allowlist (binding from Phase 2,
  with derived aliases exempt). The codemod is also now case-insensitive — both
  `#010B17` and `#010b17` occur;
  **(3)** *the mirror could silently acquire a non-user value* — `setTheme` has **no
  falsy guard**, so `setTheme(undefined)` writes the string `"undefined"` and
  `classList.add("undefined")` sticks permanently; writing a resolved `"dark"` is
  equally fatal. Either converts "unset" into an explicit choice and makes Phase 4's
  staged flip a silent no-op for exactly the members it exists for. The mirror must
  now stay **absent** while `themePref` is unset, and next-themes' `storage` listener
  re-writing `defaultTheme` when the key is removed in another tab is called out as a
  decision rather than assumed;
  **(4)** *the AA gate had two mutually exclusive producers* — point 1 said the pair
  set was "emitted by Phase 0's inventory" and point 4 explicitly retracted that.
  Producers are now split by kind: same-element pairs from the inventory,
  cross-component pairs from the hand-authored nesting map;
  **(5)** *the flat-approximation escape hatch was direction-unconstrained*, letting an
  implementer pick flat blackout and reproduce v10's optimistic error while satisfying
  the gate. It must now be **conservative** — lightest backdrop in dark, darkest in light;
  **(6)** *Phase 0's checklist contradicted three other sections* — the
  `redesign/explore` / `7af69d8` review was twice claimed "moved to Phase 0" without
  ever being added there (Phase 2's duplicate is now deleted), the `.light
  { color-scheme }` branch had no home, and Phase 0 was asked for token swatches "in
  both themes" that cannot exist until 1a and 2 respectively.
  Also fixed: the `dynamicParams` justification (200 in `next dev`; a production
  `next start` 404s it anyway — stating it as "a build" invited a maintainer to
  disprove and delete the guard); every lint clause now has a stage, including the
  `brand-<colour>` keys and Layer-2 opacity modifiers at 1a; `adrIndex.test.ts` named
  as the third on-disk guard; `docs/ROUTES.md` and the stale `ThemeSwitch` line in
  `docs/UTILITIES_AND_COMPONENTS.md:165` flagged; §1.6 marked provisional with its two
  missing files; SVG fills pinned to `currentColor` rather than an unreliable
  `fill="var(--x)"`; §3.2 arithmetic corrected to 135 of 169.
- **v12** — adversarial round 17 (single reviewer per the user's instruction).
  `CHANGES_REQUIRED`, 3 blockers, all verified and fixed:
  **(1)** *v11's brand.css guard exempted exactly what it was added to protect.* The
  "derived aliases are exempt" hatch was defined by example
  (`--ink: rgb(var(--ink-rgb))`), and by that criterion every Layer-2 token qualifies —
  `--surface-accent-tint: rgb(var(--accent-rgb) / 0.20)` is equally derived and does
  follow `--accent-rgb` into `.light` by cascade. But it must not: light needs `#003572`
  at 100% and cascade yields 20%, leaving a translucent wash where an opaque navy panel
  belongs on the 32 highest-frequency composed sites, with `npm test` green. The
  exemption is now **syntactic** — exactly one `var()`, no added alpha, no literal — and
  all ~14 Layer-2 keys are non-exempt by construction;
  **(2)** *"the mirror stays absent while unset" had no enforcing mechanism, and the
  multi-tab path made it self-defeating.* next-themes' `storage` listener is
  `c.newValue ? r(c.newValue) : f(u)` where `f` is `setTheme`, so removing the key in
  one tab makes every other tab write `defaultTheme` back. With reconciliation a no-op
  and sign-out the only clear, nothing ever removes it — the device cold-starts
  `"dark"` forever and Phase 4's flip is a silent no-op. Reconciliation for an unset
  pref must now **clear** the key, and §5 asserts it on the reconciliation path, since
  the writer is next-themes rather than the control or the route;
  **(3)** *the AA gate's inputs existed in no phase checklist* — the same defect class
  v11 #6 supposedly closed. Phase 0 now explicitly owns the surface-nesting map, the
  dark composited failing set, and the recorded conservative-backdrop assumption;
  Phase 1a owns authoring the token layer itself (`:root`/`.light` blocks plus the
  two-layer Tailwind config); Phase 2 owns activating the `brand.css` `.light` guard
  and deriving the light failing set.
  Also fixed, and severe enough to promote from the reviewer's non-blocking list:
  **`vitest.config.ts:15-16` scopes `include` to three roots with
  `passWithNoTests: true`**, so every new guard this design depends on is a *silent
  false-green* if misplaced — placement is now specified (`app/utils/__tests__/`).
  Plus: `tailwind.config.ts` is edited by this design yet outside its own `app/**`
  scope and carries `rgba(0, 0, 0, 0.1)` at `:38` — now either migrated with 1a or a
  recorded remnant; the `rgb()`/`rgba()`/`hsl()` lint clause got its missing 1a stage;
  the gallery `page.tsx` is named, since `routeMatcher.test.ts`'s walk only matches
  `page`/`route` files; and a sharper vocabulary gap is called out — six
  `bg-[#003572] text-[#C8D8EB]` sites need **ink on an opaque accent surface**, which
  must stay pale in light and which no §3.1 ink role can be.
- **v13** — adversarial round 18. `CHANGES_REQUIRED`, **2** blockers (down from 3),
  both verified and fixed:
  **(1)** *"Clearing is idempotent and safe" was false — v12's own remedy loses a race.*
  next-themes' `storage` listener fires on **any** removal, including reconciliation's
  own clear: Tab A clears → Tab B writes `defaultTheme` back → Tab A reads `"dark"`. On
  any device with two tabs open, an unset member's mirror ends up `"dark"` — the exact
  outcome the invariant existed to prevent, and invisible to a single-document unit
  test. The deeper point is that the invariant bought nothing: Sanity is the source of
  truth, `themePref` stays unset there regardless, and **Phase 4's flip changes the
  server-side resolution of unset, not `defaultTheme`**. So the absent-mirror invariant
  is **dropped**: `localStorage` is a pure paint cache, reconciliation always passes a
  resolved value (never `undefined` — `setTheme` still has no falsy guard), and
  unset-ness lives only in Sanity;
  **(2)** *no phase owned rewriting `brand.css`'s retired variable references.* §3.1
  retires six colour names that are consumed **inside** `brand.css` — measured **65
  `var(--brand-*)` lines** (`beam` 29, `blackout` 9, `frost` 9, `console` 7, `deck` 7,
  `steel` 5) — while §3.3 enumerated only the beam row, leaving ~36 references in no
  phase and no table. `brand.css` has **zero hex literals**, so the whole CSS migration
  is a variable rename that no hex-scanning clause covers, and its failure mode is
  silent: an undeclared `var()` is invalid at computed-value time, so the declaration is
  dropped and the atmosphere, every glow and every inset highlight simply vanish — past
  ESLint (no CSS parser), `tsc`, `vitest`, and a VR suite with no runner. Phase 1a now
  owns the rewrite, `app/**/*.css` is in the **codemod's** scope rather than only the
  inventory's, and the guard gained the assertion that makes it mechanical: **every
  referenced `var()` must be declared**.
  Also fixed: the guard is now **bidirectional** (`.light`-only properties were
  unguarded); the prose gate's residual hole — a `#rrggbb`-only pattern passes with all
  18 invert keys unmapped, because typography emits five 3-digit `#fff` literals and two
  `rgb(… / 10%)` shadows, so it now bans `#[0-9a-fA-F]{3,8}` and `rgb(`-without-`var(`;
  Phase 2's first deliverable de-circularised to *candidate* light values;
  the Phase 0 / Phase 1a contradiction over who authors `.light`; `tailwind.config.ts:38`
  decided (migrated with 1a onto `elevation`, alongside its sole consumer
  `Header.tsx:15`); the `passWithNoTests` framing corrected (a misplaced guard never
  *matches* — the mechanism is the `include` globs, not the flag); and §3.2b's
  `rgb()`/`rgba()` count corrected to 17 occurrences across 7 files.
- **v14** — adversarial round 19. `CHANGES_REQUIRED`, 4 blockers, all verified and fixed:
  **(1)** *v13 shipped Follow System three phases early.* Phase 3's reconciliation bullet
  resolved unset `themePref` to `"system"`, contradicting Decision 9, Phase 4, and its own
  text thirteen lines later. Mechanically it works — which is what makes it dangerous:
  every member without a `themePref` would get OS-following before the volunteer period
  and before the Spanish announcement, with nothing failing. `resolveFromServerPref` now
  maps unset → `"dark"`, and **its unset branch is named as the single seam Phase 4 flips**;
  **(2)** *the conservative-backdrop rule was direction-wrong for dark ink, and the
  justification was false.* v13 claimed the only dark-ink site was opaque; in fact
  `ImpersonationBanner.tsx:22` is `bg-amber-500/90 backdrop-blur-sm text-black` inside
  `<body class="brand-atmosphere">`, joined by `CalendarView.tsx:387–389`,
  `ChordChart.tsx:183` and `ProposalsPanel.tsx:538`. A lighter backdrop *raises* a
  dark-ink ratio, so one global direction is optimistic for that whole class — and
  Phase 1b folds ~875 raw-palette sites in, where `text-black` on `bg-amber-*/α` is a
  common shape. Conservatism is now **per-pair**: whichever extreme minimises the ratio;
  **(3)** *the AA producer taxonomy omitted the shape carrying the largest ink family.*
  "Same-element" and "cross-component" left out ink and surface on different elements of
  the *same* component, and the map was described as surfaces×tokens with **no foreground
  dimension** — while **197 of 220 `text-gray-500` lines carry no `bg-` on the same
  line**, so same-element covers ~10% of it. The taxonomy is now three kinds and the map's
  output is explicitly (ink, effective background) pairs;
  **(4)** *the guard's "every referenced `var()` is declared" assertion misses
  double-wrapping* — the likeliest failure of the very rename it was added for. All 29
  `--brand-beam` references are `rgb(var(--brand-beam) / α)`; renaming to `--accent`
  instead of `--accent-rgb` gives `rgb(rgb(0 191 255) / 0.11)`, invalid and dropped, while
  `--accent` *is* declared so the assertion passes. A fourth assertion now requires every
  `var()` inside `rgb()`/`rgba()` to name a `*-rgb` variable.
  Also: **§1.0 is now marked provisional too** — it was the one count section that wasn't,
  and it does not reproduce (an independent recount at clean `dafe1e3` gave 1,232/45).
  Part of the cause is worth recording: the working tree carries an **uncommitted 265-line
  refactor of `app/components/admin/ServicesPanel.tsx`**, one of the two densest colour
  files, which both moves the counts and will collide with Phase 1. §5's prose pattern
  aligned to §4's corrected one; docs drift corrected from two files to four
  (`DATA_MODEL.md:61` and `API_REFERENCE.md` also need entries, and neither is
  test-guarded).
- **v15** — adversarial round 20. `CHANGES_REQUIRED`, **1** blocker (down from 4),
  verified and fixed:
  *the `brand.css` guard's four assertions could not see an altered or dropped alpha* —
  and **all 65 `var(--brand-*)` lines carry one, across 43 distinct values from 0.025 to
  0.94**, including all 29 beam lines. Renaming `rgb(var(--brand-beam) / 0.11)` to
  `rgb(var(--accent-rgb))` passes (i), (ii) and (iii) — declared, `*-rgb`, no literal —
  and silently renders the atmosphere's 11% wash at 100%, or turns `.brand-surface`'s
  3.5% inset highlight into an opaque white line. VR is structurally weakest precisely
  there, because §3.3 *licenses* a diff on those same 29 lines, so a reviewer cannot
  separate the planned recolour from an unplanned alpha change. Assertion **(iv)** now
  snapshots every `.brand-*` colour declaration as a `(variable, alpha)` pair and
  requires the alpha multiset to be unchanged. Same failure class as v14's blocker #4,
  one step over: syntax preserved, value silently wrong.
  Also fixed: §3.3's deep-navy row was wrong twice — it omitted `#001830` (6 sites) and
  undercounted 19 as 6, which under "any diff outside §3.3 is a defect" would have
  arrived as unexplained diffs; `#002249`'s double-booking between §3.3 and §6 resolved
  to §6 (`elevation`); **three of v14's four "translucent dark-ink" citations were
  actually opaque** — only `ImpersonationBanner.tsx:22` is translucent, and the stale
  carried item asserting the opposite is deleted; the production-`next start` 404 claim
  withdrawn as very likely false (`dynamicParams` defaults to `true`); guard assertion
  (i) given its activation trigger so it cannot go red in Phase 1; and `themePref` added
  to `/me`'s explicit GROQ projection, without which the control binds to `undefined`.
- **v16** — adversarial round 21. `CHANGES_REQUIRED`, 3 blockers, all verified and fixed:
  **(1)** *the AA gate's dark input was stale by construction.* Phase 0 derived the dark
  failing set, but Phase 1b changes ~875 dark values and explicitly does **not** promise
  byte-identity, so the set is stale the moment the first family lands — and 1b's own gate
  (the per-family diff list) is contrast-blind, while Phase 2 owns only the *light* set.
  The largest ink block in the app (`gray` 463, `red` 176, and the 197 `text-gray-500`
  lines with no `bg-`) would have shipped its dark collapse with no AA check. The dark set
  is now **re-derived at every 1b family merge**;
  **(2)** *assertion (iv)'s stated premise was false.* "All 65 lines carry an alpha" is
  wrong: there are **69 colour `var(--brand-*)` occurrences, 65 with an alpha and 4
  without** — `brand.css:17` (`.brand-atmosphere`'s base `background-color`), `:106`,
  `:168`, `:205` (`.brand-key-dial`'s `color`). Three of the four are beam lines, the
  exact lines §3.3 licenses a diff on, so VR cannot cover them either; an extractor built
  to the stated shape skips all four. The snapshot now records **`alpha: none` explicitly**
  and asserts it stays none. Also reconciled the two conflated measurements (65 lines
  containing any such var vs 66 per-variable line counts, because one gradient line names
  three);
  **(3)** *the delivery mechanism was presented as a free choice and one option is unsafe.*
  "Reconcile on every mount" + "server wins on arrival" means the write must invalidate
  whatever channel reconciliation reads. A NextAuth JWT claim fails: `auth.ts:105` sets
  `strategy: "jwt", maxAge: 7 days`, and the callback re-reads Sanity only on sign-in, on
  `trigger === "update"`, or via `getMemberAccess` (which projects `active`/`role` only,
  30s TTL). After a member picks *Claro*, the next mount anywhere but `/me` calls
  `setTheme(old)` and reverts them — silently, for up to 30s or **up to 7 days**. Now
  constrained: either the write calls `useSession().update()` and busts the cache, or
  reconciliation must not override a locally-newer explicit choice, with a §5 test that an
  explicit choice survives navigation.
  **Also — the tree moved during review.** `HEAD` went `dafe1e3` → `ec72b3c`, landing
  `feat(admin): use the seat board for create and edit, drop ServiceForm` plus two fixes.
  That adds a **new `SeatBoard.tsx` carrying 39 bracketed hex literals and 6 `dark:`
  variants** and rewrites `ServicesPanel.tsx`, one of the two densest colour files. §1.0
  now records this: the counts track active development, and Phase 1 must cover components
  that did not exist when the spec was written. Smaller corrections: §3.3's deep-navy row
  to 17 sites, `#3dff7c` to 3 (its `rgba()` form at `DayCard.tsx:344` was unnamed), and
  `brand.css`'s pure-black shadows to 6 occurrences.
- **v17** — adversarial round 22 (the first attempt died on an API error; re-run fresh).
  `CHANGES_REQUIRED`, **1** blocker, verified and fixed:
  *v16's delivery-mechanism fix prescribed something that cannot work in this codebase.*
  Both halves failed. `useSession().update()` refreshes nothing — `auth.ts:157` opens the
  `trigger === "update"` branch and it ends with an unconditional `return token` at
  **`:197`**, *before* the revocation/role refresh at `:240` that calls `getMemberAccess`,
  so the token comes back byte-identical. And the `memberAccess` cache cannot be busted in
  production: `app/utils/memberAccess.ts:5` is a module-scope `new Map()` whose only clear
  is marked *"For tests only."* — on Vercel the write lambda and the later session refresh
  are usually different instances, so a single-process vitest passes green while
  production reverts the member's choice. The alternative ("don't override a
  locally-newer choice") was also unsound: it needs a second `localStorage` key that the
  same section forbids in bold, and "local always wins" contradicts Decision 7's
  cross-device sync. **The channel is now decided in Phase 3 rather than deferred to Open
  item 3: reconciliation reads a fresh `GET /api/me`**, with `themePref` added to *both*
  explicit projections — `me/page.tsx:48` and `app/api/me/route.ts:11`, the second of
  which the spec had never named.
  Also fixed: assertion (iv)'s headline was too weak — "the alpha multiset is unchanged"
  cannot see a variable swap, because **11 of the 43 alpha values are shared by two
  variables**, so a frost↔beam cross at 0.035 would pass while VR is licensed to diff on
  beam lines; it is now a **mapped `(variable, alpha)` pair multiset, per occurrence**.
  The unit confusion behind that assertion is corrected too (69 occurrences / 65 with
  alpha / 59 lines — three different numbers previously presented as one). `signal` was
  missing from §3.1's retirement sentence and from the guard allowlist. The lint clauses
  now carry an explicit `files: ["app/**"]` scope, without which they fire on
  `tailwind.config.ts`, `scripts/`, `e2e/` and `sanity/`. And a new **phase-ownership
  table** assigns the eleven cross-cutting deliverables (SECRETS entry, four doc updates,
  three ADRs, CLAUDE.md/AGENTS.md, the boxShadow migration, the 1b AA re-derivation) that
  had drifted between §6/§7/§8 and no checklist through three separate revisions.
  **HEAD moved twice more during this round** — `ec72b3c` → `acd73fd` → `45bcc6c`
  (`feat(admin): replace the service team editor with the seat board`, then a
  solver/planificador doc fix), which is the §1.0 point restated by events.
- **v18** — adversarial round 23. `CHANGES_REQUIRED`, 2 blockers, both verified and fixed:
  **(1)** *the AA gate composited backgrounds but not foregrounds* — the same optimistic
  error the spec had already fixed for surfaces, one level over. Measured **72
  `text-[#hex]/α` sites** plus ~15 palette equivalents, and the alphas *survive*
  tokenisation because §3.1 deliberately keeps ink in Layer 1 so modifiers keep working.
  `text-[#00bfff]/40` renders at **2.35:1** while the gate as written reported **9.32:1**;
  `text-[#C8D8EB]/50` renders at 4.02:1 against a reported 13.64:1. As a ship gate it
  would have green-lit dozens of genuine sub-AA sites in both themes. The input is now
  **(effective foreground, effective background)**, Layer-1 ink modifiers are part of the
  pair key (`ink-muted@0.5` ≠ `ink-muted`), and the per-pair conservatism rule is
  restated: for translucent ink the ink's luminance moves *with* the backdrop, so neither
  extreme is trivially minimising — evaluate both and take the lower;
  **(2)** *reconciliation could not tell "server says unset" from "server didn't answer".*
  On a 401 or a network failure the literal instruction resolved unset → `setTheme("dark")`
  → and next-themes writes unconditionally, **poisoning the mirror so the next cold start
  also paints dark**. Two routine paths: `/auth/signin` sits inside `(client)/layout` and
  therefore inside `<Provider>`, so *every unauthenticated login-page visit* fires
  reconciliation, gets 401 and writes `"dark"`; and an offline Capacitor cold start does
  the same — defeating exactly what Decision 8 exists for. Because that unset branch is
  also the seam Phase 4 flips, a network hiccup would have inverted the flip's meaning.
  Reconciliation now applies **only on a 200 with a parsed body**, with `cache: "no-store"`,
  and any failure is a no-op.
  Also fixed — **a wrong reason I recorded in v17**: the rebuttal of `useSession().update()`
  claimed the branch "returns at `:197` before `:240`". False — `auth.ts:157` guards on
  `trigger === "update" && updatePayload`, so an argument-less `update()` skips the branch
  and *does* reach `getMemberAccess`. The conclusion (a JWT claim is unsuitable) stands on
  the 30-second TTL and the `{_id, disabled, role}` projection; the reason did not, and
  this spec warns twice about enshrining wrong reasons in an ADR. Plus: impersonation's
  **read** side now has a stated behaviour (it would otherwise persist the impersonated
  member's theme into the super-admin's mirror via `sanityId`); a sixth guard assertion
  covers `tailwind.config.ts:15-21`, which declares the same retired variables one file
  over with `selection:bg-brand-beam/35` live on both root layouts; and the ownership
  table gained six missing rows, with the CLAUDE.md **stack line** moved to Phase 3 —
  at 1a `forcedTheme="dark"` is still in place, so retiring "Dark-mode only" earlier would
  make the doc false for two phases.
- **v19** — adversarial round 24. `CHANGES_REQUIRED`, 3 blockers — but **focus areas 1
  (the AA gate) and 4 (the ownership table) passed for the first time**, and the reviewer
  additionally *proved* the backdrop-extremes rule is tight, not merely conservative: with
  `f ≈ αI + (1−α)b` the ratio is monotone in backdrop luminance **over the ranges in play today**, so an
  extreme is the minimiser here. It is **not a general lemma** — if the backdrop range
  straddles the effective ink luminance, the ratio passes through 1 and the minimum is
  interior. Do not enshrine the general form in the ADR; the operative instruction
  ("evaluate both extremes, take the lower") carries a straddle check. Fixed:
  **(1)** *a third wrongly-stated reason.* v18 said the login-page reconciliation fetch
  "gets 401". It does not: `proxy.ts:3` wraps `withAuth`, and
  `node_modules/next-auth/next/middleware.js:44-47` has **no 401 branch** — it returns on
  success or redirects to `pages.signIn` (`auth.ts:109`). `fetch` follows the 307 and gets
  a **200 `text/html`** with `res.ok === true`; `/api/me`'s own 401 is unreachable through
  the matcher. So the guard rested entirely on its parsed-body half, and a
  `if (res.status === 401) return;` simplification would have reintroduced the mirror
  poisoning on the app's highest-frequency unauthenticated path. The guard is now
  `res.ok && parses as JSON && expected shape`, and §5 asserts the **HTML-200** case;
  **(2)** *guard assertions (iii) and (vi) were red against the pre-migration tree.* No
  `*-rgb` variable exists yet, so all 69 `brand.css` occurrences and all seven
  `tailwind.config.ts` keys violate them on day one — meaning **Phase 0 could not pass its
  own `npm test` done-gate**, and the cheapest fix would have been to weaken the one
  assertion the spec calls decisive. Both now bind at the 1a merge, like (i) and (v), and
  (vi) is restated as a **union** of declaration sets rather than a per-file check (a
  file-scoped (ii) would also fail, since `tailwind.config.ts` declares nothing while
  referencing seven);
  **(3)** *"sign-out clears the mirror" had four call sites and one owner.*
  `SignOutButton.tsx:8`, `BottomNav.tsx:88`, `NavMenu.tsx:159` and
  `(client)/auth/not-a-member/page.tsx:21` all call `signOut` directly; wiring only the
  obviously-named one leaves three exits caching the previous member's theme, and a test
  against the wired path false-greens. Now a single `signOutAndForgetTheme()` util, all
  four routed through it, plus a filesystem guard.
  Also fixed: **Phase 3 now has an explicit precondition that every 1b family has landed**
  — nothing previously forbade shipping light mode over un-migrated palette families, which
  is literally the ADR-0008 drift; resolution is pinned **client-side** so the two
  projections cannot disagree; and `--brand-signal` is removed from the allowlist, since
  allowlisting a *colour* as theme-invariant is the drift class the guard exists to catch.
- **v20** — adversarial rounds 25 & 26. **Round 25 returned the first `APPROVED` in 25
  rounds**; round 26, run on byte-identical text per the two-approval bar, returned
  `CHANGES_REQUIRED` with one blocker — so the streak resets and the blocker was worth the
  round:
  *§3.2b's runtime-colour mechanism was wrong, and the class it governs had no gate.*
  The prescription "replace hex-alpha concatenation with `rgb(var(--accent-rgb) / 0.05)`"
  assumed a single accent. It is **runtime-selected**: `DayCard.tsx:33,43,53` carry
  `#12c8f4` (Sunday), **`#f59e0b` (Saturday)** and **`#a78bfa` (Special)**, threaded into
  twelve inline-style sites and three child props, with `CARD_ACCENT_HEX` doing the same
  per `ServiceType`. Following the spec literally would have **repainted Saturday amber and
  Special violet as cyan on the member-facing schedule** — a defect by 1a's own gate, since
  §3.3 licenses only `#12C8F4 → #00bfff`. The mechanism is now **role-variable
  indirection** (`` `rgb(var(${t.accentVar}) / 0.05)` ``) with the const-map shape spelled
  out. And the class had no gate at all: it is outside 1a's computed-colour check (scoped
  to class strings), outside the hermetic gallery (`DayCard.tsx:58` calls `useSession()`),
  and post-migration invisible to the lint rule and the `brand.css` guard — so it now ships
  as an enumerated per-site diff artefact at the 1a merge.
  Two literals were also in **no table at all**: `#f87171`
  (`ServiceReadinessCard.tsx:723`) → `negative-fg`, and `especial: "#D9534F"` — because
  `ParticipationSidebar.tsx:6` declares **six** chart colours, not the five §3.1 listed.
  A hand-enumeration wrong at the very line it cited; §1.0's lesson, restated by evidence.
  Also fixed: "expected shape" pinned to `_id` presence (the dangerous reading,
  `"themePref" in body`, is exactly the unset case and would have no-oped for every member
  Phase 4 targets while tests stayed green); §5's "nothing persists `dark` on first render"
  reworded, since it read as the absent-mirror invariant v13 dropped and would have
  invited a test author to revive the multi-tab race; AA re-derivation added to the **1a**
  merge, whose beam→accent row repaints the very backdrop the assumption is recorded
  against; impersonation's read side **decided** (skip while impersonating) rather than
  left as "either/or"; server-side validation of `themePref`; Phase 2 marked atomic, since
  guard (i) self-activates on the first `.light` property; the inventory snapshot keyed on
  file + utility + value multiset rather than **line numbers**, which would redden
  `npm test` on any unrelated commit; the inventory globs stated once
  (`app/**/*.{tsx,ts,mjs,css}`); two dangling `§1.7` references repointed to §3.2b; and
  the atmosphere's gradient-layer count corrected to six in the one place it is
  load-bearing.
- **v21** — adversarial round 27. `CHANGES_REQUIRED`, 3 blockers, all verified and fixed:
  **(1)** *v20's own runtime-colour fix reproduced the failure its own section bans.*
  §3.2b prescribed interpolating the role variable into every threaded prop — but
  `ChainLinkIcon.tsx:13` is `stroke={color}`, an **SVG presentation attribute** (defaulting
  to `currentColor` at `:2`), so that emits `stroke="rgb(var(--warning-fg-rgb))"`, the
  unreliable form the same section rules out two paragraphs later. `stroke` is inherited,
  so there is no fall-back: the medley chain icon at `DayCard.tsx:190` (member-facing) and
  `ServiceReadinessCard.tsx:379` would render inherited-or-`none` — invisible — with no
  automated gate, since §3.2b itself establishes this class has none. Colour is now
  classified **by sink**: style sinks take `rgb(var(--x) / α)`, attribute sinks move to
  `currentColor` or `style={{ stroke: … }}`;
  **(2)** *the `rgb()`/`rgba()` lint clause was staged wholesale at 1a, but three of the
  five colours those literals carry have no role at 1a.* `#fbbf24` (amber-400) is in **no
  table anywhere** — §3.1 pins `warning-fg` to `#f59e0b`, a different amber; `#ef4444`
  (red-500) belongs to a **1b** family; `rgba(0,0,0,·)` is staged last. Landing at 1a would
  error on nine literals whose targets don't exist, and collapsing them early is a
  dark-value change forbidden by 1a's own gate. Now staged per family, with a table. The
  `#3dff7c` row was also wrong at the lines it cited — **6 sites across four alpha forms**,
  not 3 — the same "licensed-diff row wrong where it points" defect v15 treated as blocking
  for the deep-navy row;
  **(3)** *guard (ii) under (vi)'s union is red at the 1a merge.* `tailwind.config.ts:25-27`
  references `--font-display` / `--font-body` / `--font-label`, emitted at runtime by
  `next/font` and declared in **neither** file — so the union reading fails on day one while
  the narrow reading makes (vi) a no-op on the keys it exists for. (ii) is now scoped to
  **colour** custom properties.
  Also fixed: the "be precise about the unit" paragraph was itself imprecise — `brand.css:108`
  names one variable, not three; the multi-variable lines are `:24`, `:115` (three each) and
  `:219`, `:272`, `:278` (two each), which is why 59 lines yield 66 per-variable counts.
  Plus: reconciliation gated on `status === "authenticated"` so the impersonation skip
  cannot read falsy while the session is still loading; `_id`-presence made null-safe, since
  `GET /api/me` can return a literal `null` body with 200; and the AA-Large exemption
  flagged as likely unusable in practice — `tailwind.config.ts:29-32` overrides `base` to
  17px, so almost nothing clears the ≥18.66px bold / 24px bar, and no named producer emits
  a font-size dimension anyway.
- **v22** — adversarial round 28. `CHANGES_REQUIRED`, 2 blockers, both verified and fixed:
  **(1)** *v21's own staging table had two rows swapped at the lines it cited.*
  `signin/page.tsx:72` is `rgba(0,0,0,0.28)` — **black**, inside an arbitrary value — and
  `ParticipationSidebar.tsx:81` is `rgba(0,191,255,0.08)` — **accent**, an inline style. The
  table had them backwards, which deferred the one accent site to the final merge and
  scheduled a **black** literal at 1a, where §3.1a states there is no `white`/`black` role
  at all; collapsing it onto `accent` would have repainted a black drop shadow cyan on the
  login page. The same site also proves the *arbitrary-value-colour* clause cannot land
  wholesale at 1a either, so `npx eslint .` could not have reached 0 errors at that merge —
  the "phase cannot pass its own done-gate" class v19 blocked on. Both clauses are now
  per-family, and the table is to be **regenerated from Phase 0's inventory, not by hand**;
  **(2)** *a third file class references the retired colour variables, and I repeated an
  error class.* `.tsx` arbitrary values do it twice — `AdminPanel.tsx:399`
  (`rgb(var(--brand-beam)/0.15)`) and `(client)/admin/page.tsx:28`
  (`rgb(var(--brand-signal)/0.8)`). The second means my justification for deleting
  `--brand-signal` — "declared in `:root` and referenced nowhere" — was true **only of the
  file I checked**, the same generalise-from-one-file mistake that produced the "only
  dark-ink site is opaque" error in v14. After 1a both sites would reference undeclared
  properties and be dropped silently, and nothing caught it: guard (vi) fixed the reference
  set to `brand.css` ∪ `tailwind.config.ts`, the lint lookahead deliberately exempts
  `rgb(var(…`, and both files are outside the gallery. `app/**/*.{tsx,ts}` arbitrary-value
  `var()` references now join the codemod scope and the guard's reference set, and the
  lookahead no longer exempts retired names.
  Also fixed: the hex-alpha → decimal conversions are **not byte-identical** (`0d` is
  0.0510, not 0.05) and must convert exactly or be enumerated; guard (v) fires on the six
  pure-black `brand.css` shadows, which now get `elevation` in Phase 2; the
  `rgb()`/`rgba()` count reconciled to 15 across 5 files (§3.2b said 17/7); guard (iii)'s
  "all 29 beam references carry an alpha" corrected against (iv)'s own 32/29/3 split; and
  the monotonicity lemma carried in §11 downgraded from a general claim to one that holds
  over today's ranges — if the backdrop range straddles the effective ink luminance the
  minimum is interior, so the ADR must not enshrine the general form.
- **v23** — adversarial round 29. `CHANGES_REQUIRED`, 3 blockers, all verified and fixed:
  **(1)** *two contradictory operative instructions, both mine.* v21 added
  "reconciliation only runs when `status === "authenticated"`"; v19's justification —
  "every unauthenticated login-page visit fires reconciliation, and gets a 200 HTML" —
  was left standing. The gate makes that path **unreachable**, so §5's mandated assertion
  covered a path that cannot occur, and the danger was symmetric: an implementer trusting
  the delivery passage drops the gate and revives the `status === "loading"` impersonation
  hazard; one trusting the gate finds the rationale is fiction and "simplifies" the shape
  guard away. The gate stands; the guard's justification now rests on the paths that
  survive — an **offline Capacitor cold start** and a **stale/expired session** where
  `status` is `"authenticated"` from a cached JWT but the cookie is dead server-side;
  **(2)** *§3.2b was wrong at its own cited lines, for the second time, in the one class it
  says has no automated gate.* The "every suffix in play" set listed eight; there are
  **twelve** (`00 0d 14 18 30 33 35 40 55 70 80 99`), and the four missed include exactly
  the non-round ones the sentence exists to catch — **`14`** = 0.078431… and **`80`** =
  0.50196…, whose natural conversions (0.08, 0.5) are rounding defects by 1a's own gate.
  There is also a **third** runtime colour map (`CalendarView.tsx:193–195`, with its own
  concatenation at `:198`), and `ServiceReadinessCard`'s six concatenation sites were
  uncited. The map list, suffix set and per-site list are now to be **generated from
  Phase 0's inventory**, not hand-written;
  **(3)** *`npm test` could not pass at the 1a merge.* `PlannerGrid.test.tsx:366` and
  `:420` assert the exact class strings 1a rewrites, and the carried item named only
  `PracticePlaylistButton.test.tsx`. Now a **rule** rather than a list: the codemod's file
  set is intersected with `app/**/__tests__/**` and every colliding assertion moves in the
  same merge. (`PlannerGrid.tsx:1175` also straddles the 1a/1b seam, with the test
  asserting only its 1a half.)
  Also: **raster brand assets** (`/icons/backstage-v2-*.png`, `/LogoOasis.png`) are outside
  every gate by construction and now sit in §6's documented-remnant list alongside
  `mobile/fallback` and the manifest; and §3.3's beam row notes both letter cases occur.
