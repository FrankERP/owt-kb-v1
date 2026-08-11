# Implementation Plan B: Light mode — the token layer and the hex/`brand-*` migration

## Original request

> "bring light mode back." — Child B of the approved parent scope spec.

This is the largest child: **1,628 literal rows across 65 files**, plus 22 `brand.css` rule
bodies and the typography theme.

**Progress.** B1 (token layer) and B2 (`brand.css` bodies) are merged. B3 migrated the
five-file accent unit: **129 rows — 92 value-identical, 16 inside the two licensed diffs,
21 discarded light halves** — leaving **1,499**. The pair relation is captured at
[`light-mode-pairs-snapshot.json`](../artifacts/light-mode-pairs-snapshot.json), taken at
B1's merge before any batch consumed it. It ships **dark-only** and, apart from **two** licensed
normalisations, the app must render **identically** afterwards.

No secrets, credentials or personal data appear here. Colour literals are design values.

## Status and contract

- **Document status: APPROVED** — round 9, digest `407f2e34…`, commit `9eedbe3`, one fresh
  cold verdict on byte-identical text as Standard tier requires. Nine valid rounds; the
  ledger is in [`…-B-token-migration-review-log.md`](2026-08-08-light-mode-B-token-migration-review-log.md).
  **Plan approval authorizes implementation of this plan only.** Each slice still runs its own
  code review and the documented test gates before it merges.
- **Requirement source:** [parent scope spec](../specs/2026-08-07-light-mode-member-first-scope.md),
  approved at `3a927bd8…` with disclosed post-approval corrections.
- **Inputs, all shipped and on `main`:**
  - the generated inventory — `app/utils/__tests__/__fixtures__/colour-inventory.json`
  - the token vocabulary — [`…-A1-token-vocabulary.md`](2026-08-08-light-mode-A1-token-vocabulary.md)
  - `brand.css`'s structural guards and `.light { color-scheme: light }` (A1)
  - the theme gallery (A2), which is where the token layer becomes visible
- **Risk tier: Standard — one fresh cold `APPROVED`.** Large is not critical. B changes no
  writer, no schema, no migration, no auth boundary, no secret, no remote release action. It
  is reversible by tag, and its correctness gate is mechanical rather than a judgement call.
- **Safe ending state:** dark-only, visually identical except the two licensed diffs. Every
  gate green. **`.light` still carries only `color-scheme`** — Child D adds values.

## The TWO licensed diffs, and nothing else

**1. `--brand-beam` `18 200 244` (`#12C8F4`) → `--accent` `0 191 255` (`#00bfff`)** — parent
D6. Four site classes, and the enumeration is closed only because all four are listed:

| Where | Count | Note |
|---|---:|---|
| `brand.css` occurrences | **32** | 29 alpha-bearing plus three alpha-free at `:120`, `:182`, `:219`; includes `.brand-atmosphere`'s wash and every glow |
| Utility usages (**category 10**) | **87** | including `selection:bg-brand-beam/35` on both root layouts |
| **Category 11** — `AdminPanel.tsx:399` | **1** | `shadow-[inset_0_0_0_1px_rgb(var(--brand-beam)/0.15)]`. Beam rows partition `{10: 87, 11: 1, 12: 1}`, so "87 utilities" is exactly the category-10 set and **does not** contain this one |
| **Bare hex** — `DayCard.tsx:33` | **1 declaration, 11 same-file consumers + 1 prop crossing into `PracticePlaylistButton`** | `accentHex: "#12c8f4"` — beam's exact value spelled as a literal. See below |

**`DayCard.tsx:33` is the one that would have been missed, and it is member-facing.**
`accentHex` is the Sunday theme's accent, consumed as **inline style** at `:127`, `:186`,
`:191`, `:196`, as a component prop at `:141`, `:190`, and threaded through `Row` at `:245`,
`:254`, `:336`. Every one of those changes colour.

**It also cannot be tokenised the way the rest can, and this is a real constraint — not on
the `DayCard` batch, but on a five-file unit.** The consumers build **8-digit hex at
runtime** — `` `${t.accentHex}35` ``, `` `${t.accentHex}0d` ``, `` `${t.accentHex}55` `` —
and a `rgb(var(--accent-rgb) / …)` token **cannot be string-concatenated with an alpha
suffix**. Concatenating anyway yields `rgb(var(--accent-rgb) / 0.2)55`, which is not a valid
`<color>`, so the browser **drops the whole declaration silently** — the same failure mode
this plan warns about for `brand.css`, reproduced at inline-style sites, several of them
member-facing.

**An earlier revision filed this as a `DayCard`-wide decision and closed the enumeration
there. It is wrong: the pattern is 24 occurrences across four files.** Generated with
`grep -rnoE '\$\{[A-Za-z_][A-Za-z0-9_.]*\}[0-9A-Fa-f]{2}\b' app`:

| File | Occurrences | Source of the hex | Crosses a file boundary? |
|---|---:|---|---|
| `DayCard.tsx` | **11** (`:127` ×2, `:186` ×4, `:191`, `:196`, `:344`, `:353`, `:355`) | local `accentHex` on the three theme objects (`:33`, `:43`, `:53`) | **yes** — `:141` passes `t.accentHex` into `PracticePlaylistButton` |
| `ServiceReadinessCard.tsx` | **9** (`:375` ×4, `:382`, `:393`, `:716`, `:722`, `:726`) | `CARD_ACCENT_HEX` imported from `serviceCardModel.ts:215–217` | **yes** — the constant lives in a different file |
| `CalendarView.tsx` | **2** (`:198`) | a local literal tuple at `:193–195` (**category 2**, bare hex) | no — self-contained on one line |
| `PracticePlaylistButton.tsx` | **2** (`:133`) | the `accent: string` prop (`:11`) | **yes** — receiver of `DayCard`'s value |

So there are **three concatenation contracts**, not one: `DayCard → PracticePlaylistButton.accent`,
`serviceCardModel.CARD_ACCENT_HEX → ServiceReadinessCard`, and `CalendarView`'s
self-contained literals. **A batch that migrates either end of the first two without the
other ships a dropped declaration.** `PracticePlaylistButton` is consumed **only** by
`DayCard` (verified: no other importer in `app/**`), so that pair is a two-file unit, not a
fan-out — but it is still two files.

### The accent has a second escape route, and it is not a CSS declaration

Concatenation is one way the accent leaves a stylesheet. The other is an **SVG presentation
attribute**, and the fix for the first breaks the second.

`ChainLinkIcon.tsx:13` renders `stroke={color}` — an attribute, not a declaration — and two
call sites feed it the raw accent:

| Call site | Passes | Effect under the concatenation fix |
|---|---|---|
| `DayCard.tsx:190` | `color={t.accentHex}` | `stroke="rgb(var(--accent-rgb) / 0.65)"` |
| `ServiceReadinessCard.tsx:379` | `color={hex}` | `stroke="rgb(var(--accent-rgb) / 0.7)"` |

**`var()` is not substituted inside SVG presentation attributes** in Chromium or WebKit — the
attribute is parsed as a CSS value but custom-property substitution does not apply there — so
the stroke silently falls back and the medley chain icon loses its colour. That is the same
silent-drop class this section exists to prevent, on a member-facing element, and by this
plan's own admission outside the equality harness. **The repo has no counter-example:**
`grep` for `var(--` inside any `fill=`/`stroke=`/`stopColor=` in `app/**/*.tsx` returns
nothing, so there is no working precedent to lean on.

**The fix already exists inside the component.** `ChainLinkIcon`'s `color` prop defaults to
`currentColor`, and **two of its four call sites already rely on that default** —
`SetlistEditor.tsx:400` and `ProposalEditor.tsx:581`/`:591` pass no colour at all. So the two
accent-passing sites drop the prop and set `color` on the wrapping element with a token
utility; `currentColor` resolves through the cascade and needs no substitution inside the
attribute. **Verify in a browser at the gallery fixture before the batch lands** — this is
precisely the case a static resolver cannot judge.

Not affected, and worth stating so nobody widens the fix: `SectionDivider`'s `accent` prop
(`DayCard.tsx:373`) and `CARD_ACCENT_MUTED` carry **className strings** (`text-[#00bfff]/70`),
never concatenated and never an attribute — they migrate as ordinary category-1 rows.

### Resolution, and the batch unit it forces

The decision is a prerequisite of the **first batch touching any file in the unit**, not of
the `DayCard` batch. Default: give each accent an alpha-aware helper returning a **complete**
`rgb(var(--x-rgb) / <n>)` string and replace all 24 concatenations at the call site — the
helper must never return a fragment a caller can append to — plus the `currentColor`
substitution at the two `ChainLinkIcon` sites. Record the choice before the batch lands.

**The unit is five files, not four:**

`DayCard.tsx` · `PracticePlaylistButton.tsx` · `ServiceReadinessCard.tsx` ·
`serviceCardModel.ts` · `ChainLinkIcon.tsx`

`serviceCardModel.ts` is the declaring end of contract 2 — `CARD_ACCENT_HEX` at `:215–217`,
three category-9 rows (`#00bfff`, `#f59e0b`, `#a78bfa`) that B-final's hex clause forces to
change — so it must move with its consumer. `ChainLinkIcon.tsx` is the presentation-attribute
carrier. **`CalendarView.tsx` is correctly independent**: its literals are declared and
consumed on adjacent lines (`:193–198`) and cross no boundary.

**This unit overrides the densest-first batching rule.** The open-questions default is "one
slice per file for the 12 files >50 rows, grouped slices below that", which would put
`DayCard` (59 rows) in a slice of its own, `ServiceReadinessCard` (42) and `serviceCardModel`
(36) in a grouped slice, and `PracticePlaylistButton` and `ChainLinkIcon` somewhere else
again — splitting every contract above. **The two rules cannot both hold, and this one wins:**
the five files land in one slice regardless of density, and that slice is the only exception
to the per-file rule.

**Equality-harness coverage of these sites is not assumed.** The harness resolves *computed*
colour; these values are composed at render time from a template literal, or leave CSS
entirely through an attribute, and the plan does not establish that its static resolver can
follow either. They are therefore an **enumerated, manually reviewed set** with their own
before/after list — the 24 concatenations plus the 2 attribute sites, each with its rendered
`rgba()` before and after — checked in the theme gallery at the `DayCard`,
`ServiceReadinessCard` and `CalendarView` fixtures rather than trusted to the primary gate.

**This also collapses a pre-existing drift:** `serviceCardModel.ts` and `CalendarView.tsx`
already spell the same Sunday accent `#00bfff`, while `DayCard.tsx:33` spells it `#12c8f4`.
After diff 1 they agree.

**2. `#3dff7c` `61 255 124` → `--positive-fg` `55 245 138`** — **6 rows**, all in
`DayCard.tsx`: two bracketed `[#3dff7c]` and four `rgba(61,255,124,·)` at .10/.3/.5/.8. Two
greens exist — `--brand-signal` `#37f58a` on **14** rows and `#3dff7c` on 6 — and the role
takes signal's value because it carries more than twice the usage.

**An earlier revision of this plan said there was one licensed diff and that six of seven
retired variables were value-identical renames. That was false:** `--brand-signal` is
`55 245 138`, not `#3dff7c`. **Five** are value-identical (`blackout`, `console`, `deck`,
`frost`, `steel`). Built to the old claim, the equality harness would have failed on 14 rows
or an implementer would have silently collapsed two distinct greens. **14 rows, not 13.**

**Both diffs are enumerated site-by-site and reviewed. Any third diff is a defect.**

## Slicing — and why B is sliceable even though the parent calls it atomic

The parent says B "lands atomically because a half-migrated token layer compiles but renders
wrong." That is true of one specific transition and **not** of the migration as a whole.

The unsafe moment is **removing** the retired `brand.*` keys while call sites still use them:
`bg-brand-beam` with no `brand.beam` key compiles to nothing and the element loses its
colour. Everything before that is additive.

So:

| Slice | Content | Why it is safe alone |
|---|---|---|
| **B1** | Add the token layer: 18 base roles in `brand.css` `:root`, their Tailwind keys, and **23** composed tokens. **Remove nothing.** | Purely additive. Old `--brand-*` and `brand.*` keys still exist and still work. Renders identically |
| **B2** | Rewrite the 22 colour-bearing `brand.css` rule bodies onto the new variables | Same computed values except beam→accent. `brand.css`'s own guards cover it |
| **B3…Bn** | Migrate call sites in batches by file, densest first | Both old and new spellings work throughout, so every batch is independently revertible |
| **B-final** | Remove the seven retired `--brand-*` declarations and their `brand.*` Tailwind keys; land the lint clauses B owns; re-point the last A1/A2 guard assertions | **Atomic, and only safe when zero call sites remain.** This is the transition the parent means |

**Each slice merges to `main` on its own green gate.** B-final is gated on counts, not on
judgement — and note that **category 11 can never reach zero**, since 7 of its 9 rows are
non-colour `--brand-radius-*` that B never touches:

- **category 10 = 0** (no retired `brand-<colour>` utility remains), **and**
- **zero category-11 rows referencing a retired COLOUR variable** — today exactly two,
  `AdminPanel.tsx:399` (beam) and `(client)/admin/page.tsx:37` (signal), **and**
- **no category-9 row DISPOSITIONED `B` carrying a retired value** — of the 12 category-9
  `B` rows, **exactly one** qualifies: `DayCard.tsx:33`'s `accentHex: "#12c8f4"`, beam's
  value. Its siblings `:43` `#f59e0b` and `:53` `#a78bfa` are `--warning-fg` and `--info-fg`,
  **not retired**, and an implementer hunting a retired value in them will not find one. **The disposition scope is load-bearing**, exactly as it is
  for category 11: `(client)/layout.tsx:42`'s `themeColor: "#010b17"` is a permanent
  category-9 literal spelling retired `--brand-blackout`'s exact value `1 11 23`, and it is
  dispositioned `exempt`. An unscoped "no category-9 retired literal" would never reach zero.
  The inventory header already prescribes the rule — "each child consumes the rows
  dispositioned to it" — and every count in this plan obeys it.

**"Category 11 = 0" would be unsatisfiable and must not be written.** Category 11 holds **9**
rows, and **7 are `[var(--brand-radius-panel)]` / `[var(--brand-radius-control)]`** — five in
`signin/page.tsx`, one more there, one in `DayCard.tsx`. The radius variables are non-colour
and the vocabulary leaves them untouched, so category 11 is 7 at B-final, permanently.
Renaming them to satisfy a gate would be unlicensed scope expansion.

## Ordered changes

### B1 — the token layer (additive)

- **`app/brand.css` `:root`** gains the **18** base-role triplets from the vocabulary, each
  `--x-rgb`. The seven `--brand-*` colour variables stay for now.
- **The vocabulary does not cover 29 of B's rows, and B must decide each before batching.**
  The roles describe the category-1 bracketed-hex surface; B's disposition also carries a
  six-hue **categorical** map (`ParticipationSidebar.tsx:6`), 8 `rgba()` belonging to Child C's
  `red`/`amber` families, 4 `rgba(61,255,124,·)` that follow licensed diff 2, and **7** black
  shadow literals (six in `brand.css`, one at `tailwind.config.ts:38`). The vocabulary's
  "Literals in Child B's set with NO role here" table assigns each with its count. **B adds at
  most a `--chart-1…6` scale and an `--elevation` role; it does not pre-empt C's families.**

### Every category B owns, closed by construction

Three consecutive review rounds found the same defect: a carrier this plan had declared
closed but had not followed — first `${hex}AA` concatenation beyond `DayCard`, then SVG
presentation attributes, then a category with no owner. **Prose enumeration is what keeps
failing.** So the closure is now a generated partition of B's own rows, and the rule is that
**every category with a `B` row appears here or the plan is incomplete**:

| Cat | Name | B rows | Files | Mechanism |
|---:|---|---:|---:|---|
| **1** | `arbitrary-class` | **1,264** | 47 | The main surface. Bracketed hex in a Tailwind utility → base role or composed token |
| **2** | `bare-hex` | **4** | 2 | `CalendarView.tsx:193–195` legend tuple (inside the 24-site concatenation set), `ServiceReadinessCard.tsx:723` `#f87171` → `--negative-fg` |
| **4** | `colour-keyword` | **2** | 1 | `CalendarView.tsx:409`, `:412` `bg-current`. **No-ops** — `current` is `currentColor`, which inherits and needs no token |
| **5** | `inline-style` | **20** | 5 | `rgb()`/`rgba()` in a `style` prop. 8 are C's `red-500`/`amber-400` and are migrated but **not** lint-enforced until C |
| **8** | `svg-attribute` | **97** | 29 | **85 are `currentColor`** — no-ops, they inherit. **12 are real work:** 8 hex + 4 `white`. See below |
| **9** | `object-literal` | **12** | 3 | Hex in a config/theme object. Exactly one carries a retired value (`DayCard.tsx:33`) |
| **10** | `retired-utility` | **213** | 20 | `bg-brand-*` etc. → the renamed key. 87 are beam |
| **11** | `arbitrary-var` | **9** | 4 | `[var(--brand-…)]` inside a bracket. **Only 2 are colour**; 7 are `--brand-radius-*` B never touches |
| **12** | `token-triplet` | **7** | 1 | The seven retired declarations in `brand.css` itself |

**Category 8's 12 non-`currentColor` rows are the ones the attribute finding above applies
to, and they were previously unowned.** All 8 hex rows are in **`app/components/icons.tsx`**:

| Row | Value | Was going to become |
|---|---|---|
| `:25`, `:31`, `:96`, `:103` | `fill="#00bfff"` | `--accent` — **the accent's own value, at four attribute sites** |
| `:70`, `:141`, `:148` | `fill="#003572"` | `--surface-raised` |
| `:64` | `fill="#002249"` | `--surface-sunken` |

**`icons.tsx` is dead code.** Its four exports — `SunIcon`, `MoonIcon`, `HomeIconLight`,
`HomeIconDark` — have **zero importers and zero references anywhere in `app/**`** (verified by
name, not just by module path); it has not been touched since the repository's initial commit.
Its 10 rows are the whole file's colour surface.

**Disposition: B deletes `app/components/icons.tsx`, and records why.** The alternative —
migrating it — cannot use the mechanism its own input prescribes. **The vocabulary is wrong
here and B corrects it:** `…-A1-token-vocabulary.md:98–101` says the file "migrates to
`currentColor` or `rgb(var(--surface-sunken-rgb))`", and the second half is exactly what the
attribute finding above proves is **silently dropped**. `currentColor` alone cannot rescue
them either — `MoonIcon` carries `#002249` and `#003572` on sibling paths of one SVG, and
`HomeIconDark` carries `#00bfff` and `#003572` — **one inherited colour cannot serve two
fills.** The only working migration is Tailwind's `fill-*`/`stroke-*` utilities, which emit
real CSS properties where `var()` does substitute. Spending that on a file nothing renders is
not justified; deleting it removes 10 rows, 8 of them hex, from B's surface.

**If the deletion is rejected**, the fallback is `fill-*` utilities — **not** `currentColor`,
and **not** `rgb(var(…))` in the attribute — and `icons.tsx` then joins the accent unit for
its four `#00bfff` rows.

**The 4 `white` SVG attributes are B's, not C's.** `AdminPanel.tsx:135`, `ProfilePanel.tsx:50`
(`stroke="white"`) and `icons.tsx:112`, `:157` (`fill="white"`) are all dispositioned `B` in
the inventory. An earlier revision of this section assigned them to C, which would have left
two of them behind after B and inside a file B deletes. B migrates the two live ones to a
`stroke-*` utility on the appropriate role; the two in `icons.tsx` go with the file.

**This table is the closure test.** If a future round finds a B row whose category is absent
here, the enumeration failed again and the fix is to regenerate the table, not to add another
paragraph.
- **`tailwind.config.ts`** gains a key per base role as
  `rgb(var(--x-rgb) / <alpha-value>)`, and a key per composed token. **The seven `brand.*`
  keys stay for now.**
- **Naming rule, enforced by a test:** no colour key may begin with a utility prefix
  (`bg`, `text`, `border`, `ring`, `divide`, `from`, `via`, `to`, `fill`, `stroke`,
  `placeholder`, `shadow`, `outline`, `decoration`, `caret`, `accent`). `border-accent`
  compiles to `.border-border-accent`; `.border-accent` silently resolves to the base role.
- **Composed tokens are opaque at the use site.** They bake their own alpha, so an opacity
  modifier on one is a bug. The lint clause banning that lands with B-final.
- **Verification:** `brand.css`'s reference-integrity guard stays green; a new test asserts
  every vocabulary role exists as both a custom property and a Tailwind key, and that no key
  violates the naming rule. **Nothing renders differently** — proven by B's equality harness
  below, run with an empty migration set.

### B2 — `brand.css` rule bodies

- Rewrite the **22 colour-bearing rule bodies** off `--brand-*` onto the new roles.
- **`--brand-beam` → `--accent-rgb` is licensed diff 1**; `--brand-signal` → `--positive-fg`
  is value-identical (both `55 245 138`); every other substitution in this file is
  value-identical.
- **The `*-rgb` suffix is where this goes wrong.** `rgb(var(--accent-rgb) / 0.11)` is valid;
  `rgb(var(--accent))` expands to `rgb(rgb(…))`, is not a valid `<color>`, and is **dropped** —
  taking `.brand-atmosphere`'s body wash with it. **A1's reference-integrity guard does catch
  an undeclared `var(--accent)`** (`brandCss.test.ts` fires on it), so this is not invisible to
  every gate — but it *is* invisible to the multiset assertion if that is scoped to
  alpha-bearing occurrences only.
- **Verification:** the `(variable, alpha|none)` multiset is unchanged **per occurrence**,
  except on the enumerated beam occurrences. `brand.css` carries **69** colour
  `rgb(var(--brand-*)…)` occurrences: 65 alpha-bearing across 56 lines, plus **four
  alpha-free** at `:31` (`.brand-atmosphere`'s base `background-color` — the body wash
  itself), `:120`, `:182` and `:219`. **Three of those four are beam.** A multiset scoped to
  alpha-bearing occurrences misses them entirely, and a per-*line* extractor also skips the
  multi-variable lines — so the assertion is per occurrence, and `none` counts as an alpha
  value. Plus `participationAlongside.test.tsx` — which already pins
  `.brand-admin-frame`, `.brand-admin-shell` and `[data-route-main]:has(.planner-wide)` — must
  stay green untouched.

### B3…Bn — the call sites

**1,628 rows across 65 files** (**1,499** remaining after B3), driven by the inventory, batched by file with the densest
first: `MonthGenerator` 148 · `ProposalEditor` 82 · `AdminPanel` 76 · `SongFormModal` 67 ·
`EditSongButton` 63 · `PlannerGrid` 59 · `DayCard` 59 · `SongSheet` 57. **12 files carry more
than 50 rows.**

- **The mapping table is the inventory, not a hand-written list.** Rows dispositioned `B`,
  keyed by (literal × utility × pairing context). A literal alone is insufficient: `#003572`
  is a light accent in most of its 243 sites and a dark-native surface where it has no
  `dark:` sibling.
- **Category 2 (`bare-hex`) has a home, and it is B.** Four rows, all dispositioned `B`:
  `CalendarView.tsx:193–195`'s three legend literals and `ServiceReadinessCard.tsx:723`'s
  `#f87171`. The prose elsewhere walks categories 1, 5, 9, 10, 11 and 12; category 2 is small
  enough to have been skipped, but a reader reconciling B's row accounting against the
  inventory would find a category with no owner. The hex lint clause covers all four, and
  three of them are inside the 24-site concatenation set above.
- **23 composed tokens, not 24 — and the missing one is deliberate.** The 166
  alpha-differing pairs collapse to exactly **24** distinct `(light/α → dark/α)`
  combinations. Seven occur once; the largest is `[#003572] → [#00bfff]/20` at 36 sites.
  **The 24th is `gray-600 → [#C8D8EB]/70`, the split `TextSizeControl` pair, occurring
  once** — and B is instructed not to collapse it, because its light side is a palette class
  Child C owns. Building a token for it would produce one B never uses and whose light half
  B has no authority to fill. So B1 adds **23**, and the 24th arrives with C when it collapses
  the pair.
- **Pairs drive composed tokens.** 246 per-element pairs, **166 differing in alpha** — those
  take a composed token. Of the 80 that do not, **12 are palette pairs belonging to Child C**,
  so B's share is **68**, and those may use a base role with an opacity modifier.
- **Snapshot the `pairs` relation into the handoff before B-final** — all 246, not just B's
  234, since C inherits the other 12 and the split one. It is the only generated
  record of which light literal partnered which dark one, and regenerating the inventory batch
  by batch overwrites it — leaving Child D's light design to reconstruct it from git history.
- **A `dark:` variant is deleted only once the composed token's `:root` value equals that
  variant's pre-migration computed colour** — see the harness section. Deleting one early
  flips the dark side from 20% to 100%.
- **Non-JSX sites are in scope**: `serviceCardModel.ts` (**36** of its 57 rows are B's; 20 are
  C's palette classes and 1 is `keep`) consumed by 8 `.tsx` components and 3 `.ts` modules, and
  `(admin)/layout.tsx`.
- **The theme gallery is IN B's set, and the inventory cannot see it.** A2 excluded
  `app/(gallery)` from the inventory deliberately — it is a verification surface, not product
  colour — but its layout is live code carrying retired keys:
  `app/(gallery)/theme-gallery/[theme]/layout.tsx:75` is
  `brand-atmosphere font-body min-h-screen bg-brand-blackout text-brand-frost`, and
  `SwatchesFixture.tsx` carries `dark:prose-invert`. Three consequences, all checkable:
  1. B-final's `brand-<colour>` lint clause fires there unless `app/(gallery)/**` is on the
     `ignores` list — so `npx eslint .` cannot reach 0 errors;
  2. left alone, deleting `brand.frost` silently drops the gallery's ink **while
     `themeGallery.test.ts` keeps asserting `bg-brand-blackout`** — a green guard describing a
     dead class, on the one surface Child D reviews light values against;
  3. B's typography change lands half-applied unless `SwatchesFixture.tsx`'s
     `dark:prose-invert` goes with `(client)/posts/[slug]/page.tsx:326`.
  **Decision: migrate the gallery with B, and update `themeGallery.test.ts`'s assertions in
  the same commit.** Do NOT add it to `ignores` — that would leave live code on retired keys.
- **Two test files carry `#12C8F4` and neither is a `DayCard` assertion.**
  `PracticePlaylistButton.test.tsx` passes `accent="#12C8F4"` at four call sites — an input
  value, so nothing goes red — and `emailTemplateGallery.test.ts` carries three inside the
  deliberately-light email templates, which are exempt. **Both will read as unmigrated
  survivors to whoever greps for `12c8f4` after B**, so name them in the batch notes even
  though neither blocks.
- **Test files move with the code they assert — and the automated mechanism does not exist.**
  An earlier revision said "the codemod's file set is intersected with `app/**/__tests__/**`".
  **That intersection is empty**: the inventory excludes `__tests__`, so it holds zero rows
  and can drive nothing. Colliding assertions are found and updated **manually**, per batch,
  with `npm test` as the backstop. Known collisions include `PlannerGrid.test.tsx`'s
  `bg-[#00bfff]/70` and `border-[#00bfff] bg-[#00bfff]/10` selectors.
- **Verification per batch:** computed-colour equality per site (below), plus the inventory
  regenerated and its guard green.

### B-guards — re-point the A1/A2 assertions B's own success invalidates

**B breaks FIVE shipped guard assertions by succeeding.** None is a colour literal a codemod
rewrites, so "the codemod's file set is intersected with `__tests__`" cannot produce them —
and that intersection is in any case **empty**, since the inventory excludes `__tests__`.
Each must be re-pointed deliberately, in the slice that invalidates it:

| Assertion | Why B breaks it | Re-point |
|---|---|---|
| `colourInventory.test.ts:226–227` — `pairsDifferingInAlpha > 0` **and** `> pairs / 2` | Of 246 pairs, 234 involve hex and **all 12 non-hex pairs have `alphaDiffers: false`**. B deletes every hex `dark:` variant, and `pairsFor`'s `COLOURED` regex cannot match token classes, so at B-final the value is **0** — while the assertion's own comment reads "if this ever drops to zero, alpha capture has regressed", i.e. a **false diagnosis** | Move the alpha fire-proof onto a **synthetic source**, where it tests the scanner rather than the tree's current contents |
| `colourInventory.test.ts:172–178` — `AdminPanel.tsx` has category-11 `var(--brand-beam)` rows | That row is B's to migrate | Re-point to a synthetic source, or delete with the reason recorded |
| `brandCss.test.ts:116–117` — `AdminPanel.tsx` references `--brand-beam`; `(client)/admin/page.tsx` references `--brand-signal` | Both are B rows | Re-point to whichever colour `var()` references remain, or synthetic |
| `brandCss.test.ts:145` — `(client)/layout.tsx` contains `selection:bg-brand-beam` | A B row | Re-point to the successor utility |
| `themeGallery.test.ts:83` — the gallery `<body>` carries `bg-brand-blackout` | B migrates the gallery layout (see B3) | Re-point to the successor utility, in the same commit as the gallery batch |

**This slice lands with the batch that invalidates each assertion, never after.** A guard left
asserting a removed premise is worse than no guard: it is green and wrong.

### B-final — remove the retired keys, and land the lint clause

- Delete the seven `--brand-*` colour declarations from `brand.css` and their seven `brand.*`
  keys from `tailwind.config.ts`.
- **Gated on the three generated counts in the slicing section**, not on judgement: category 10 = 0; zero category-11 rows referencing a retired COLOUR variable; no category-9 row dispositioned `B` carrying a retired value. Neither category reaches zero outright: 7 of category 11's 9 rows are non-colour radius vars, and category 9 keeps `layout.tsx`'s exempt `themeColor`.
- **Land the lint clauses B owns**: bare and bracketed hex; `rgb()`/`rgba()`/`hsl()` **only
  when not followed by `var(`** — `(rgba?|hsla?)\((?!\s*var\()`, or the rule forbids its own
  prescribed fix; colour inside arbitrary values with no `#`; the retired `brand-<colour>`
  keys; and opacity modifiers on composed tokens.
  - **Do not anchor with `\b`** — `_` is a word character, so `\b(rgba?)\(` fails to match
    `shadow-[0_0_0_1px_rgb(0_191_255/0.45)]`.
  - Under an explicit `files: ["app/**"]` block — `eslint.config.mjs`'s rules block has no
    `files` key, so unscoped clauses fire on `tailwind.config.ts`, `scripts/`, `e2e/` and
    `sanity/`.
  - **Comment handling must be decided, as the parent's §9 requires.** A source-text rule
    fires on colours named in prose — the gallery's `page.tsx` and `PlannerFixture.tsx` both
    name `#010b17` in comments — while an AST rule does not. `no-restricted-syntax` with
    `Literal`/`TemplateElement` selectors is AST-based and therefore does not fire on
    comments; state that explicitly rather than leaving it implied.
  - **Exemption granularity is per entry, and getting it wrong disables the clause on B's own
    rows.** `ignores` is file-granular; **two of the four confirmed exemptions are
    row-granular** — and a conditional fifth would make three — and the files carrying them
    are mostly B's:

    | Exemption | Rows in that file | Mechanism |
    |---|---|---|
    | `app/utils/emailShell.ts` | **9 of 9 exempt** | Whole-file `ignores` — legitimate |
    | `app/**/__tests__/**` | outside the inventory glob | Whole-file `ignores` — legitimate |
    | Google mark, `signin/page.tsx` | 4 exempt, but **36 dispositioned `B`** | **Row-level.** Inline `eslint-disable-next-line` with the reason, or a rule-option value allowlist keyed file + value, the way `scripts/colour-inventory.mjs`'s `EXEMPT_VALUES` already does it |
    | `themeColor`, `(client)/layout.tsx` | 1 exempt, but **4 dispositioned `B`** | **Row-level**, same |
    | *Conditional* — `ParticipationSidebar.tsx:6` | 6 would be exempt, of **19 dispositioned `B`** | **Row-level**, and **only if** B takes the vocabulary's "record it exempt" option for the six categorical hues instead of the `--chart-1…6` default. Listed here so the choice does not silently create a fifth row-granular exemption after the clause is written |

    **A whole-file ignore on `(client)/layout.tsx` would defeat this slice's stated purpose.**
    One of its four `B` rows is `selection:bg-brand-beam/35` — the utility reference
    `brandCss.test.ts` records as the thing a `var()`-integrity guard structurally cannot see,
    with B-final named as where it finally gets guarded. Ignoring the file makes that guard
    inert on the file that motivated it. The same objection this plan raises against ignoring
    `app/components/admin/**` applies here, and more sharply.
  - **`app/components/admin/**` must NOT be ignored either.** An earlier revision listed it on the
    grounds that "Child C's families still live there" — **but C's 946 rows contain zero hex
    or `rgb()` values** (verified), so B's hex/`rgb(`/`brand-<colour>` clauses cannot fire on
    a palette class like `gray-500` anyway. Ignoring the tree would switch B's own clause off
    across the densest part of its own surface — `MonthGenerator` 148, `AdminPanel` 76,
    `SongFormModal` 67, `PlannerGrid` 59 — for no benefit.
  - **Palette-family clauses are NOT B's** — they land per family with Child C, or `npx
    eslint .` cannot reach 0 errors at this merge.
  - **The `rgb()`/`rgba()`/`hsl()` clause has the SAME problem and must be deferred with
    them.** Eight category-5 rows in `app/**` are dispositioned `B` but belong to Child C's
    families: `ServiceReadinessCard.tsx` `rgba(239,68,68,·)` ×4 (`red-500`) and `DayCard.tsx`
    `rgba(251,191,36,·)` ×4 (`amber-400`). B cannot migrate them — the vocabulary says "C's
    family, B must not pre-empt it" — and cannot tokenise them onto existing roles either,
    since `239 68 68` ≠ `--negative-fg 248 113 113` and `251 191 36` ≠ `--warning-fg
    245 158 11`; doing so would be a third licensed diff.
    **Decision: the `rgb()/rgba()/hsl()` clause lands with Child C, not with B-final.** B's
    own category-5 rows — six black shadows in `brand.css`, one in `tailwind.config.ts` (out of
    glob), `ParticipationSidebar`'s `rgba(0,191,255,0.08)`, and the four
    `rgba(61,255,124,·)` of licensed diff 2 — are migrated by B regardless; they simply are not
    *lint-enforced* until C.
- **A `var()`-integrity guard cannot see utility references.** `selection:bg-brand-beam/35`
  consumes the `brand.beam` *key*, not a `var()`. **This slice is where that is guarded**,
  because this is the change that removes the key.

### B-typography

- Add **`theme.extend.typography`** mapping `--tw-prose-*` onto roles, then remove
  `dark:prose-invert` (`(client)/posts/[slug]/page.tsx:326`).
- **`extend` is load-bearing, not stylistic.** A top-level `theme.typography` *replaces* the
  plugin stylesheet — measured at ~36.8 KB → ~187 bytes, zero `prose-sm` rules. That page uses
  `prose prose-sm sm:prose prose-p:* prose-headings:*`, so song lyrics would render completely
  unstyled, silently.
- **`--tw-prose-body: rgb(var(--ink-rgb))`, not `var(--ink)`** — the roles store triplets.
- **Map all 18 non-invert keys** (`body bold bullets captions code counters headings hr kbd
  kbd-shadows lead links pre-bg pre-code quote-borders quotes td-borders th-borders`), and map
  or null the 18 `--tw-prose-invert-*` keys, which the plugin declares in the same block.
- **The obvious assertion is vacuous.** "The compiled prose block contains no `gray-` literal"
  can never fail — Tailwind resolves `theme(colors.gray[700])` to `#374151` at build time.
  Assert instead: no `#[0-9a-fA-F]{3,8}` **and** no `rgb(`-without-`var(`; `--tw-prose-body`
  resolves to the ink role; and `.prose-sm` rules are still emitted.

## The equality harness — B's primary proof

Screenshots cannot vouch for 1,628 sites across stateful panels on live data. The gate is
**equality by construction**, verified mechanically.

**The gate is ONE-SIDED, and the reason matters more than the mechanism.**

At B's ending state a composed token has exactly **one** value. `brand.css` has no `.dark`
block — `:root` holds the dark values and `.light` carries only `color-scheme`, and Child D
adds the light values. So `:root` must hold the **dark-side** value to preserve what renders.

Pre-migration, `bg-[#003572] dark:bg-[#00bfff]/20` resolves two ways. Post-migration the
element carries one token resolving one way. **A two-sided equality gate is therefore
unsatisfiable on all 166 alpha-differing pairs** — not hard, impossible. And declaring the
light side in `.light` to satisfy it would self-activate the theme-parity guard
(`brandCss.test.ts` is dormant only while `.light` declares zero custom properties), which
then demands a `.light` counterpart for all 18 `:root` colour roles — Child D's entire job,
pulled into B1.

**So the gate is: every migrated site's computed colour in the rendered theme is unchanged.**

- A resolver over `:root` computes each site before and after. `<html class="dark">` always
  renders today (`Provider.tsx:16` sets `forcedTheme="dark"`), so the pre-migration reference
  is the **dark** side of every pair.
- It compares **sites, not classes**: a codemod that maps every class correctly but drops one
  from a `className` would otherwise pass.
- **Every site must resolve identically, except the enumerated sites of the two licensed
  diffs**, which are listed explicitly and reviewed.
- It runs per batch and is committed, so a later batch cannot silently regress an earlier one.

### What B discards, stated plainly

**B owns the 234 pairs with at least one hex side, and deletes the light-side value of 233
of them.** The exception is the split pair below, whose light side is a palette class C
owns and which therefore survives B. The other **12 have palette classes on both sides** (`text-gray-500 dark:text-gray-400`
and kin) and belong to Child C, which is the same 12 that make B's non-alpha-differing share
68 rather than 80.

**One pair is split between B and C, and needs its own treatment.**
`TextSizeControl.tsx` carries `text-gray-600 dark:text-[#C8D8EB]/70` — the light side is C's
palette row, the dark side is B's hex row, and `alphaDiffers` is **true**, so it sits inside
the 166 the composed layer is sized against. B cannot collapse it to one composed token
without deleting `text-gray-600`, which is not B's to touch. **Treatment: B migrates only the
dark side, to a token-valued `dark:` variant, and leaves the pair split until C migrates the
light side and collapses it.** It is one site, but it is the one site B3's delete rule has no
answer for.

This is intentional and invisible today — `forcedTheme="dark"` means no member ever saw the
light side — but it is a real loss of information, and it is **the reason B must snapshot the
`pairs` relation into the handoff**. **Done, and earlier than planned** —
`docs/superpowers/artifacts/light-mode-pairs-snapshot.json`, all 246 pairs captured at B1's
merge. Waiting for B-final was the wrong schedule: B3 alone removed 21, so every batch in
between was raising the reconstruction cost of a record that only exists to be complete. That snapshot becomes the *only* surviving
record of which light literal partnered which dark one, and Child D designs the light theme
from it. Losing it means reconstructing 246 pairings from git history.

**Consequently, B3's rule reads: a `dark:` variant is deleted only once the composed token's
`:root` value equals that variant's pre-migration computed colour** — never "once the token
carries both sides", which nothing at B's ending state can do. **And the rule does not apply
to the split pair above**, where the `dark:` variant survives B as a token-valued variant.

## Verification

| Requirement | Check | Failure it detects |
|---|---|---|
| Tokens exist and are well-named | Test: every vocabulary role is a custom property **and** a Tailwind key; no key starts with a utility prefix | `.border-border-accent`, and a role that exists in CSS but not Tailwind |
| B1 changes nothing visually | Equality harness with an empty migration set | An "additive" slice that was not |
| `brand.css` bodies preserved | `(variable, alpha)` multiset unchanged **per occurrence**, beam lines excepted | A `*-rgb` slip on one of the four alpha-free occurrences, including the body wash's own base colour |
| Existing `brand.css` pins hold | `participationAlongside.test.tsx` green **untouched** | Breaking a documented layout guard while rewriting the file |
| Every migrated site | Computed-colour equality **in the rendered (dark) theme**, sites not classes | Any diff outside the two licensed sets |
| Diff 1 is fully enumerated | The beam set covers all four classes: 32 brand.css + 87 cat-10 + 1 cat-11 + `DayCard.tsx:33` with its 11 same-file consumers and the `PracticePlaylistButton` prop | The harness reporting ~11 unlicensed diffs, or `DayCard` left on a literal that then fails B-final's own lint clause |
| Retired keys are gone | Category 10 = 0; zero category-11 rows referencing a retired **colour** variable (7 radius rows remain by design); no category-9 row dispositioned `B` carrying a retired value (`layout.tsx`'s exempt `themeColor` remains) | Removing keys while call sites remain — the one unsafe transition |
| Utility references covered | A test that fails if a `brand.*` key is deleted while a `bg-brand-*` usage remains | The failure a `var()`-integrity guard structurally cannot see |
| Prose survives | No hex, no `rgb(`-without-`var(`, `--tw-prose-body` → ink role, `.prose-sm` still emitted | The `theme.typography` collapse — unstyled lyrics, no signal |
| Tests move with code | `PlannerGrid.test.tsx` selectors updated in the same commit | `npm test` red at the batch merge |
| Pairs snapshotted | **Done at B3** — all 246 in `docs/superpowers/artifacts/light-mode-pairs-snapshot.json`, captured from B1's merge before any batch consumed them | Child D losing the only record of which light literal partnered which dark one |
| A1/A2 guards re-pointed | The FIVE enumerated assertions updated in the slice that invalidates each | A green guard asserting a premise B removed — worse than no guard |
| Gallery migrated, not ignored | `themeGallery.test.ts` asserts the successor utilities; no `app/(gallery)` entry in `ignores` | Live code left on retired keys, with a green guard describing a dead class |
| Done-gate | `tsc`, `npm test`, `eslint .` = 0 errors, per slice | — |

## Rollout and rollback

- Branch per slice; merge to `main` on a green gate; direct push, no PRs.
- **Tag before B-final.** Slices B1–Bn are individually revertible because both spellings
  work; B-final is the atomic one.
- **Stop conditions:** the equality harness cannot resolve a site → stop, do not eyeball it.
  Any of B-final's three counts is non-zero → stop, the removal is unsafe. The `(variable, alpha)`
  multiset diverges outside beam lines → stop, `brand.css` has drifted.
- **Deploy verification** after each merge: confirm the alias moved to a deployment built
  from the pushed commit. A green build is not a deploy.

## Decisions

| Decision | Choice | Why |
|---|---|---|
| Slice, don't land atomically | B1 additive → batches → B-final atomic | The parent's "atomic" applies to key *removal*, not the migration. Slicing 65 files into one commit maximises the blast radius of the one thing that cannot be partially applied |
| Mapping table = the inventory | Not a hand-written list | Every hand-count in this project's history has been wrong |
| Composed tokens for alpha-differing pairs only | 166 of 246 | The other 80 can use a base role with an opacity modifier; giving them composed tokens doubles the layer for nothing |
| Palette clauses deferred to C | B lands only its own lint clauses | Landing them now makes 0-eslint-errors unreachable, since C's families are unmigrated |
| Equality by construction | Not screenshots | The gallery cannot host the stateful panels where the hex mass lives |

## Assumptions

| Assumption | Impact if false | Validation |
|---|---|---|
| Both spellings coexist through B1–Bn | The slicing is unsound and B must be atomic | B1's equality run. If Tailwind rejects the additive config, fall back to atomic and say so |
| The 166 alpha-differing pairs collapse to **24** distinct `(light/α → dark/α)` combinations, and B builds **23** of them, covering 165 pairs | Some sites have no correct token | Generated; the 17-combination tail is where collapse decisions get recorded |
| Computed-colour equality is decidable per site statically | The primary gate is unbuildable | **Prove on one file before batching.** If it cannot be built, stop and re-plan — do not substitute screenshots |

## Open questions

| Question | Blocking? | Default |
|---|---|---|
| Does the 17-combination tail get its own tokens, or collapse? | **No** | Own token each; collapse only with the site count recorded, as Child C is held to |
| Batch size for B3…Bn | **No** | One slice per file for the 12 files >50 rows; grouped slices below that |
| How runtime `${hex}AA` concatenation survives tokenisation — **24 occurrences across `DayCard.tsx`, `ServiceReadinessCard.tsx`, `CalendarView.tsx` and `PracticePlaylistButton.tsx`**, with three cross-file contracts | **No, but it gates the FIRST batch touching any file in the five-file unit**, which is why THOSE move together. `CalendarView` is NOT in the unit — its two concatenations read from a literal tuple three lines above them and cross no file boundary, so it batches on its own. It must still use the same helper: a second one invented later is how the fragment-returning version comes back | Give each accent an alpha-aware helper returning a COMPLETE `rgb(var(--x-rgb) / <n>)` string — never a fragment a caller can append to — and replace all 24 concatenations at the call site. Settle and record before that batch lands. See the licensed-diff section for the per-file table |

**No blocking open questions.** Two items above gate a specific batch rather than the plan:
the `DayCard` `accentHex` decision, and the harness's prove-on-one-file step.

**One bookkeeping note:** B1 adds 18 base-role triplets to `brand.css :root`, and the
inventory's `disposition()` defaults anything unmatched to `B` — so B's own token layer
regenerates as ~18 fresh category-12 rows dispositioned `B`. Harmless to every gate, but the
headline row count grows during B, and a later reader should not misread the inventory listing
B's own tokens as B's migration target.

## Handoff

- **To Child C:** the palette-family lint clauses, `white`/`black`, and the per-family diff
  lists. C inherits a token layer with no retired variables left.
- **To Child D:** a `.light` block still carrying only `color-scheme`, and the base/composed
  role names its counterparts must fill.
- **Adversarial review order:** this plan (**Standard** — one fresh cold `APPROVED`), then C.
- **Implementation authorization: not granted by this plan.**

## Terminal state

**`READY_FOR_ADVERSARIAL_REVIEW`**
