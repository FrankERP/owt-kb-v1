# Implementation Plan B: Light mode — the token layer and the hex/`brand-*` migration

## Original request

> "bring light mode back." — Child B of the approved parent scope spec.

This is the largest child: **1,628 literal rows across 65 files**, plus 22 `brand.css` rule
bodies and the typography theme. It ships **dark-only** and, apart from one licensed
normalisation, the app must render **identically** afterwards.

No secrets, credentials or personal data appear here. Colour literals are design values.

## Status and contract

- **Document status:** Draft — not reviewed, not approved, not authorization to implement.
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
- **Safe ending state:** dark-only, visually identical except the one licensed diff. Every
  gate green. **`.light` still carries only `color-scheme`** — Child D adds values.

## The one licensed diff, and nothing else

`--brand-beam` is `18 200 244` (`#12C8F4`). The accent is `#00bfff` = `0 191 255` (parent
D6). Retiring beam onto accent is **a real colour change** on 87 utility usages and 29
`brand.css` occurrences — including `.brand-atmosphere`'s body wash, every glow, and
`selection:bg-brand-beam/35` on both root layouts.

**That is the only visual diff this plan may produce.** Six of the seven retired `--brand-*`
are value-identical renames (`blackout`, `console`, `deck`, `signal`, `frost`, `steel`). Any
other diff is a defect.

## Slicing — and why B is sliceable even though the parent calls it atomic

The parent says B "lands atomically because a half-migrated token layer compiles but renders
wrong." That is true of one specific transition and **not** of the migration as a whole.

The unsafe moment is **removing** the retired `brand.*` keys while call sites still use them:
`bg-brand-beam` with no `brand.beam` key compiles to nothing and the element loses its
colour. Everything before that is additive.

So:

| Slice | Content | Why it is safe alone |
|---|---|---|
| **B1** | Add the token layer: 16 base roles in `brand.css` `:root`, their Tailwind keys, the 24 composed tokens. **Remove nothing.** | Purely additive. Old `--brand-*` and `brand.*` keys still exist and still work. Renders identically |
| **B2** | Rewrite the 22 colour-bearing `brand.css` rule bodies onto the new variables | Same computed values except beam→accent. `brand.css`'s own guards cover it |
| **B3…Bn** | Migrate call sites in batches by file, densest first | Both old and new spellings work throughout, so every batch is independently revertible |
| **B-final** | Remove the seven retired `--brand-*` declarations and their `brand.*` Tailwind keys; land the lint clause banning them | **Atomic, and only safe when zero call sites remain.** This is the transition the parent means |

**Each slice merges to `main` on its own green gate.** B-final is gated on a count, not on
judgement: the inventory must report **zero** rows in category 10.

## Ordered changes

### B1 — the token layer (additive)

- **`app/brand.css` `:root`** gains the 16 base-role triplets from the vocabulary, each
  `--x-rgb`. The seven `--brand-*` colour variables stay for now.
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
- **`--brand-beam` → `--accent-rgb` is the licensed diff**; every other substitution is
  value-identical.
- **The `*-rgb` suffix is where this goes wrong silently.** `rgb(var(--accent-rgb) / 0.11)`
  is valid; `rgb(var(--accent))` expands to `rgb(rgb(…))`, is not a valid `<color>`, and is
  **dropped** — taking `.brand-atmosphere`'s entire body wash with it, with every gate green.
- **Verification:** the `(variable, alpha)` pair multiset is unchanged **per occurrence**,
  except on beam lines. `brand.css` carries 65 `rgb(var(--brand-*) / α)` occurrences across
  56 lines; a per-*line* extractor silently skips the multi-variable lines, so the assertion
  is per occurrence. Plus `participationAlongside.test.tsx` — which already pins
  `.brand-admin-frame`, `.brand-admin-shell` and `[data-route-main]:has(.planner-wide)` — must
  stay green untouched.

### B3…Bn — the call sites

**1,628 rows across 65 files**, driven by the inventory, batched by file with the densest
first: `MonthGenerator` 148 · `ProposalEditor` 82 · `AdminPanel` 76 · `SongFormModal` 67 ·
`EditSongButton` 63 · `PlannerGrid` 59 · `DayCard` 59 · `SongSheet` 57. **12 files carry more
than 50 rows.**

- **The mapping table is the inventory, not a hand-written list.** Rows dispositioned `B`,
  keyed by (literal × utility × pairing context). A literal alone is insufficient: `#003572`
  is a light accent in most of its 243 sites and a dark-native surface where it has no
  `dark:` sibling.
- **Pairs drive composed tokens.** 246 per-element pairs, **166 differing in alpha** — those
  take a composed token. The 80 that do not may use a base role with an opacity modifier.
- **`dark:` variants are deleted only once the composed token carries both sides**, never
  before. Deleting one early flips the dark side from 20% to 100%.
- **Non-JSX sites are in scope**: `serviceCardModel.ts` (56 rows in exported class strings
  consumed by 7 components) and `(admin)/layout.tsx`.
- **Test files move with the code they assert.** They are lint-exempt but not migration-exempt:
  the codemod's file set is intersected with `app/**/__tests__/**`, and colliding assertions
  are updated in the same commit. Known collisions include `PlannerGrid.test.tsx`'s
  `bg-[#00bfff]/70` and `border-[#00bfff] bg-[#00bfff]/10` selectors.
- **Verification per batch:** computed-colour equality per site (below), plus the inventory
  regenerated and its guard green.

### B-final — remove the retired keys, and land the lint clause

- Delete the seven `--brand-*` colour declarations from `brand.css` and their seven `brand.*`
  keys from `tailwind.config.ts`.
- **Gated on a generated count: category 10 must report zero rows.** Not on judgement.
- **Land the lint clauses B owns**: bare and bracketed hex; `rgb()`/`rgba()`/`hsl()` **only
  when not followed by `var(`** — `(rgba?|hsla?)\((?!\s*var\()`, or the rule forbids its own
  prescribed fix; colour inside arbitrary values with no `#`; the retired `brand-<colour>`
  keys; and opacity modifiers on composed tokens.
  - **Do not anchor with `\b`** — `_` is a word character, so `\b(rgba?)\(` fails to match
    `shadow-[0_0_0_1px_rgb(0_191_255/0.45)]`.
  - Under an explicit `files: ["app/**"]` block — `eslint.config.mjs`'s rules block has no
    `files` key, so unscoped clauses fire on `tailwind.config.ts`, `scripts/`, `e2e/` and
    `sanity/`.
  - **`ignores`** must carry `app/components/admin/**` (Child C's families still live there),
    `app/utils/emailShell.ts`, `app/**/__tests__/**`, the Google mark, and
    `(client)/layout.tsx`'s static `themeColor`.
  - **Palette-family clauses are NOT B's** — they land per family with Child C, or `npx
    eslint .` cannot reach 0 errors at this merge.
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

- A script resolves every migrated site's **computed colour** before and after, through a
  custom-property resolver over `:root` (**not** `:root`/`.dark` — naming an empty class set
  is how this gate silently passes).
- It compares **sites, not classes**: a codemod that maps every class correctly but drops one
  from a `className` would otherwise pass.
- **Every site must resolve identically, except the enumerated beam→accent sites**, which are
  listed explicitly and reviewed.
- It runs per batch and is committed, so a later batch cannot silently regress an earlier one.

## Verification

| Requirement | Check | Failure it detects |
|---|---|---|
| Tokens exist and are well-named | Test: every vocabulary role is a custom property **and** a Tailwind key; no key starts with a utility prefix | `.border-border-accent`, and a role that exists in CSS but not Tailwind |
| B1 changes nothing visually | Equality harness with an empty migration set | An "additive" slice that was not |
| `brand.css` bodies preserved | `(variable, alpha)` multiset unchanged **per occurrence**, beam lines excepted | A `*-rgb` slip dropping the body wash, invisible to every other gate |
| Existing `brand.css` pins hold | `participationAlongside.test.tsx` green **untouched** | Breaking a documented layout guard while rewriting the file |
| Every migrated site | Computed-colour equality, sites not classes | Any diff outside the licensed one |
| Retired keys are gone | Inventory category 10 reports **zero** | Removing keys while call sites remain — the one unsafe transition |
| Utility references covered | A test that fails if a `brand.*` key is deleted while a `bg-brand-*` usage remains | The failure a `var()`-integrity guard structurally cannot see |
| Prose survives | No hex, no `rgb(`-without-`var(`, `--tw-prose-body` → ink role, `.prose-sm` still emitted | The `theme.typography` collapse — unstyled lyrics, no signal |
| Tests move with code | `PlannerGrid.test.tsx` selectors updated in the same commit | `npm test` red at the batch merge |
| Done-gate | `tsc`, `npm test`, `eslint .` = 0 errors, per slice | — |

## Rollout and rollback

- Branch per slice; merge to `main` on a green gate; direct push, no PRs.
- **Tag before B-final.** Slices B1–Bn are individually revertible because both spellings
  work; B-final is the atomic one.
- **Stop conditions:** the equality harness cannot resolve a site → stop, do not eyeball it.
  Category 10 is non-zero at B-final → stop, the removal is unsafe. The `(variable, alpha)`
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
| The 24 composed combinations cover every alpha-differing pair | Some sites have no correct token | Generated; the 17-combination tail is where collapse decisions get recorded |
| Computed-colour equality is decidable per site statically | The primary gate is unbuildable | **Prove on one file before batching.** If it cannot be built, stop and re-plan — do not substitute screenshots |

## Open questions

| Question | Blocking? | Default |
|---|---|---|
| Does the 17-combination tail get its own tokens, or collapse? | **No** | Own token each; collapse only with the site count recorded, as Child C is held to |
| Batch size for B3…Bn | **No** | One slice per file for the 12 files >50 rows; grouped slices below that |

**No blocking open questions.**

## Handoff

- **To Child C:** the palette-family lint clauses, `white`/`black`, and the per-family diff
  lists. C inherits a token layer with no retired variables left.
- **To Child D:** a `.light` block still carrying only `color-scheme`, and the base/composed
  role names its counterparts must fill.
- **Adversarial review order:** this plan (**Standard** — one fresh cold `APPROVED`), then C.
- **Implementation authorization: not granted by this plan.**

## Terminal state

**`READY_FOR_ADVERSARIAL_REVIEW`**
