# Implementation Plan C: Light mode — the palette families

## Original request

> "bring light mode back." — Child C of the approved parent scope spec.

**948 rows across 49 files**: 901 raw palette classes (`gray-500`, `red-400`, …) and 47
`white`/`black` keyword utilities. Plus the lint clauses Child B deferred here, and the 8
`rgba()` rows B migrated but could not lint-enforce.

No secrets, credentials or personal data appear here. Colour literals are design values.

## Status and contract

- **Document status:** Draft — not reviewed, not approved, not authorization to implement.
- **Requirement source:** [parent scope spec](../specs/2026-08-07-light-mode-member-first-scope.md),
  approved at `3a927bd8…`; row C of its §11 table.
- **Inputs, all shipped and on `main`:**
  - the generated inventory — `app/utils/__tests__/__fixtures__/colour-inventory.json`
  - Child B's token layer — 30 base roles, 23 composed tokens, `themeColour()`, and the
    five lint clauses already in `eslint.config.mjs`
  - [B's plan](2026-08-08-light-mode-B-token-migration.md), whose slicing and verification
    shape this one follows
- **Risk tier: Standard — one fresh cold `APPROVED`.** C changes no writer, no schema, no
  migration, no auth boundary, no secret, no remote release action. It is reversible per
  family, and its correctness gate is mechanical.
- **Safe ending state:** dark-only, **rendering byte-identical**. `.light` still carries only
  `color-scheme` — Child D adds values.

## The contract: ZERO licensed diffs

**This is the one place C differs sharply from B, and it is the whole reason C is
reviewable.** B shipped two licensed value changes and had to enumerate every affected site.
**C ships none.** Every one of the 36 `(family, shade)` pairs migrates to a role carrying its
**exact** value.

That is a decision, not an accident — recorded here with its alternative, because it is the
single largest choice in this plan:

> The obvious-looking migration is to collapse the palette onto the semantic roles that
> already exist: `gray-500 → --ink-dim`, `yellow-500 → --warning-fg`, and so on. It was
> measured and rejected. `gray-500` alone is **243 rows** and sits **distance 56** from
> `--ink-dim`, in lightness *and* hue — Tailwind's grays are neutral, the ink roles are
> blue-tinted. Collapsing the gray family repaints **475 rows**, half of Child C, and the
> warm families another ~100. **Frank chose zero repaint on both** (2026-08-11).

The consequence is stated plainly so nobody discovers it later: **C adds 34 roles**, taking
the layer from 30 to 64. That cost lands on Child D, which must design a light counterpart
for each. The alternative was to pay it in silent repaints of a UI the team uses weekly, and
to make a design decision inside a migration slice where no reviewer would see it.

**Any visual diff at all is a defect.** There is no licensed-diff list to check against.

## The mapping — all 36 pairs, generated

Generated from `tailwindcss/colors` against the inventory's C rows. `Δ0` throughout is the
contract.

| Palette class | Rows | Hex | Triplet | Role | Note |
|---|---:|---|---|---|---|
| `gray-200` | 12 | `#e5e7eb` | `229 231 235` | `--neutral-200-rgb` | new |
| `gray-300` | 25 | `#d1d5db` | `209 213 219` | `--neutral-300-rgb` | new |
| `gray-400` | 96 | `#9ca3af` | `156 163 175` | `--neutral-400-rgb` | new |
| `gray-500` | **243** | `#6b7280` | `107 114 128` | `--neutral-500-rgb` | new — the densest row in C |
| `gray-600` | 79 | `#4b5563` | `75 85 99` | `--neutral-600-rgb` | new |
| `gray-700` | 14 | `#374151` | `55 65 81` | `--neutral-700-rgb` | new |
| `gray-800` | 6 | `#1f2937` | `31 41 55` | `--neutral-800-rgb` | new |
| `red-100` | 1 | `#fee2e2` | `254 226 226` | `--negative-faint-rgb` | new |
| `red-200` | 6 | `#fecaca` | `254 202 202` | `--negative-soft-rgb` | new |
| `red-300` | 10 | `#fca5a5` | `252 165 165` | `--negative-muted-rgb` | new |
| `red-400` | 76 | `#f87171` | `248 113 113` | `--negative-fg-rgb` | **exists — Δ0, no new role** |
| `red-500` | 74 | `#ef4444` | `239 68 68` | `--negative-strong-rgb` | new |
| `red-700` | 5 | `#b91c1c` | `185 28 28` | `--negative-border-rgb` | new |
| `red-800` | 10 | `#991b1b` | `153 27 27` | `--negative-surface-rgb` | new |
| `red-900` | 9 | `#7f1d1d` | `127 29 29` | `--negative-surface-deep-rgb` | new |
| `red-950` | 1 | `#450a0a` | `69 10 10` | `--negative-surface-deepest-rgb` | new |
| `amber-200` | 5 | `#fde68a` | `253 230 138` | `--warning-faint-rgb` | new |
| `amber-300` | 8 | `#fcd34d` | `252 211 77` | `--warning-soft-rgb` | new |
| `amber-400` | 34 | `#fbbf24` | `251 191 36` | `--warning-strong-rgb` | new — B's 4 deferred `rgba()` rows |
| `amber-500` | 44 | `#f59e0b` | `245 158 11` | `--warning-fg-rgb` | **exists — Δ0, no new role** |
| `yellow-200` | 5 | `#fef08a` | `254 240 138` | `--recency-faint-rgb` | new |
| `yellow-300` | 2 | `#fde047` | `253 224 71` | `--recency-soft-rgb` | new |
| `yellow-400` | 15 | `#facc15` | `250 204 21` | `--recency-strong-rgb` | new |
| `yellow-500` | 28 | `#eab308` | `234 179 8` | `--recency-fg-rgb` | new |
| `green-300` | 1 | `#86efac` | `134 239 172` | `--positive-soft-rgb` | new |
| `green-400` | 15 | `#4ade80` | `74 222 128` | `--positive-strong-rgb` | new |
| `green-500` | 31 | `#22c55e` | `34 197 94` | `--positive-deep-rgb` | new |
| `orange-200` | 1 | `#fed7aa` | `254 215 170` | `--availability-faint-rgb` | new |
| `orange-300` | 2 | `#fdba74` | `253 186 116` | `--availability-soft-rgb` | new |
| `orange-400` | 8 | `#fb923c` | `251 146 60` | `--availability-strong-rgb` | new |
| `orange-500` | 10 | `#f97316` | `249 115 22` | `--availability-fg-rgb` | new |
| `orange-600` | 2 | `#ea580c` | `234 88 12` | `--availability-deep-rgb` | new |
| `purple-400` | 4 | `#c084fc` | `192 132 252` | `--badge-violet-fg-rgb` | new |
| `purple-500` | 10 | `#a855f7` | `168 85 247` | `--badge-violet-deep-rgb` | new |
| `blue-400` | 3 | `#60a5fa` | `96 165 250` | `--badge-azure-fg-rgb` | new |
| `blue-500` | 6 | `#3b82f6` | `59 130 246` | `--badge-azure-deep-rgb` | new |

**901 rows covered. 34 new roles. 120 rows land on roles that already exist.**

### Two families already had an exact role, and that is not luck

`red-400` **is** `--negative-fg` (`248 113 113`) and `amber-500` **is** `--warning-fg`
(`245 158 11`). Child B derived those two roles from bare-hex sites spelling the same values
— `#f87171` and `#f59e0b` — so the palette classes and the hex literals were always the same
colour written two ways. 120 of C's rows are therefore a pure rename onto an existing role.

### Why the names are what they are — and where the evidence runs out

`neutral`, `negative` and `warning` are **evidence-backed**: gray is a scale, red is used for
conflicts and errors, amber for warnings (`ImpersonationBanner.tsx:22`,
`ServicesPanel.tsx:1033`).

The other four are **proposed from thin usage evidence and are the weakest part of this
plan.** Spec Q1 asks whether `yellow`/`orange`/`amber` collapse onto one `warning-*`. They do
not, and the reason is not colour distance but **meaning** — the three families signal
different states:

| Family | What it actually signals | Evidence |
|---|---|---|
| `amber` | warnings, impersonation | `ImpersonationBanner.tsx:22`, `ServicesPanel.tsx:1033` |
| `yellow` | **recency** — "Reciente", activity dots | `ActivityPanel.tsx:50`, `:131` |
| `orange` | **availability** states on the calendar | `AvailabilityCalendar.tsx:351`, `:353` |
| `purple` / `blue` | **categorical badges**, not links or info | `AdminPanel.tsx:79` (`"admin"`), `ActivityPanel.tsx:84` (`azure`), `MonthGenerator.tsx:748` |

`--badge-violet-*` and `--badge-azure-*` are deliberately named for the hue rather than a
meaning, because these are categorical tags — the same reasoning that produced B's
`--chart-*` roles. **Naming `blue` as `--link-*` was considered and dropped: nothing in the
app links with it.** See open question C-Q1: the names, not the values, are what a reviewer
should attack.

## `white` and `black` — 47 rows, and the one place a role is wrong

| Utility | Rows |
|---|---:|
| `bg-white` | 16 |
| `text-white` | 12 |
| `bg-black` | 7 |
| `text-black` | 5 |
| `stroke-white` | 2 |
| `border-white` | 2 |
| `shadow-black` | 2 |
| `border-black` | 1 |

**These do NOT become roles, and that is the decision.** `white` and `black` are theme
*anchors*, not palette entries: `text-white` on a coloured badge means "maximum contrast
against this fill", and that stays true in a light theme. Tokenising them onto
`--neutral-*` would make them themeable and thereby wrong.

**Two exceptions, both already identified by Child B:**

- `shadow-black` ×2 → `--elevation`, the role B created for exactly this (`0 0 0`). Δ0.
- `stroke-white` ×2 (`AdminPanel.tsx:135`, `ProfilePanel.tsx:50`) — B moved these out of the
  SVG presentation attribute into a `stroke-white` utility and left the value alone.
  **C leaves them alone too.** They are white because they sit on `bg-black/50` overlays.

The remaining 43 stay literal, and **C adds a lint exemption saying so**, rather than leaving
a future reader to wonder whether they were missed.

## Slicing — per family, as the parent requires

The parent's §11 row for C says **"per colour family; each independently revertible"**. That
is the slicing, and it works because `theme.extend.colors` is additive — the same property
that made B sliceable.

| Slice | Content | Rows | Why it is safe alone |
|---|---|---:|---|
| **C1** | Add all 34 roles to `brand.css` and `tailwind.config.ts`. **Remove nothing, migrate nothing.** | 0 | Purely additive. Renders identically |
| **C2** | `gray` → `--neutral-*` | 475 | Largest slice, but one family; revert restores `gray-*` |
| **C3** | `red` → `--negative-*` | 192 | Includes B's 4 deferred `rgba(239,68,68,·)` rows |
| **C4** | `amber` → `--warning-*` | 91 | Includes B's 4 deferred `rgba(251,191,36,·)` rows |
| **C5** | `yellow` → `--recency-*` | 50 | |
| **C6** | `green` → `--positive-*` | 47 | |
| **C7** | `orange` → `--availability-*` | 23 | |
| **C8** | `purple` + `blue` → `--badge-*` | 23 | Two tiny families, one slice |
| **C9** | `white`/`black` — the 4 rows that move, the exemption for the 43 that do not | 4 | |
| **C-final** | Land the deferred lint clauses; re-point any remaining guard | 0 | Gated on a generated count |

**Each slice merges to `main` on its own green gate**, with a code review, exactly as B's did.

**There is no unsafe transition in C.** B had one — removing a `brand.*` key while call sites
still used it. C removes nothing: Tailwind's own `gray-500` etc. remain valid classes
throughout, because they come from Tailwind's default palette, not from `theme.extend`.
**C-final therefore has no removal step**, and its gate is a count, not a cutover.

## The lint clauses C owns

B deferred two clause families here, and its reasoning is the prerequisite:

1. **`rgb()`/`rgba()`/`hsl()` not followed by `var(`.** B could not land this because 8
   category-5 rows in `app/**` are dispositioned `B` but belong to C's families —
   `ServiceReadinessCard.tsx` `rgba(239,68,68,·)` ×4 and `DayCard.tsx`
   `rgba(251,191,36,·)` ×4. **C3 and C4 migrate exactly those**, so the clause becomes
   satisfiable at C-final and not before.
   - **Must be spelled `(rgba?|hsla?)\((?!\s*var\()`** or the rule forbids its own fix.
   - **Must not be anchored with `\b`** — `_` is a word character, so `\b(rgba?)\(` fails on
     `shadow-[0_0_0_1px_rgb(0_191_255/0.45)]`.
2. **The palette-family clause** — a ban on `(bg|text|border|…)-(gray|red|…)-\d{2,3}`.
   Lands per family as each slice completes, or all at C-final; either is acceptable, but
   **a family's clause must not land before its slice**, or `eslint .` cannot reach 0 errors.

Both go in the existing `files: ["app/**/*.{ts,tsx}"]` block C inherits from B, with the same
AST-based `no-restricted-syntax` selectors — **not source-text rules**, which fire on colours
named in comments.

**The `white`/`black` exemption belongs here too**, scoped to the 43 rows that stay literal.
`ignores` is file-granular and these rows sit in files full of C's own rows, so this must be a
rule-option allowlist or inline disables — the same trap B documented for `signin/page.tsx`.

## Verification

- **Primary gate — the inventory.** `disposition === "C"` must fall from 948 to **43** (the
  `white`/`black` rows that stay literal). Generated, not counted by hand.
- **Zero-diff gate.** For every migrated row, the role's triplet must equal the palette
  value's triplet. This is checkable **statically and exhaustively** — `tailwindcss/colors`
  is the source of truth for one side and `brand.css` for the other — and it is stronger
  than anything B had, because C has no licensed diffs to except.
- **The specificity check B5 was written for.** Any slice that collapses a `dark:` variant
  must ask what that base was masking. C has **12 remaining light/dark pairs, all `gray`**,
  so this lands squarely in C2. See `CLAUDE.md`'s colour-tokens section.
- **A new guard**, extending `tokenLayer.test.ts`: every role in the table exists as both a
  custom property and a Tailwind key; no key is silently shadowed; every composed token is
  still alpha-free.
- **Browser**: the theme gallery's `dark` route before and after each slice.
- `npx tsc --noEmit`, `npm test`, `npx eslint .` at **0 errors**, per slice.

## Risks

| Risk | Why it is real | Mitigation |
|---|---|---|
| **The role layer doubles, 30 → 64** | Child D must design a light counterpart for each. This is the true cost of zero repaint | Stated here so D is sized correctly, not surprised. D may collapse roles *when designing light values* — that is a design act in the right place |
| A palette class is left behind and the lint clause makes `eslint .` un-green | B hit exactly this shape twice | The clause lands per family, never before its slice |
| `gray` is 50% of C in one slice | A bad C2 is a big revert | C2 is the only slice with 12 light/dark pairs; it gets its own review and its own merge point |
| Names encode meanings C has not proven | `recency`, `availability`, `badge-*` rest on 2–4 call sites each | **Open question C-Q1.** Values are Δ0 regardless, so a renaming later is mechanical and safe |
| `white`/`black` left literal looks like an oversight | 43 rows with no token | The lint exemption is part of C9 and carries the reason inline |

## Open questions

| # | Question | Blocking? | Bounded default |
|---|---|---|---|
| **C-Q1** | Are `--recency-*`, `--availability-*`, `--badge-violet-*`, `--badge-azure-*` the right names? They rest on 2–4 call sites each | **No** — values are Δ0 either way, so a rename is mechanical | Ship these names; revisit at D, when designing light values forces the question anyway |
| **C-Q2** | Should the palette-family lint clause land per slice or all at C-final? | **No** | Per slice — it proves each family is complete at the moment it completes |

**Spec Q1 is resolved by this plan**: `yellow`/`orange`/`amber` do **not** collapse onto a
single `warning-*`, on usage evidence rather than colour distance. The spec assigned the
producing analysis to Child A and A never produced it; the analysis is in this document, and
the parent's bounded default — "separate roles per family until the analysis proves collapse
is safe" — is what this plan implements.

## What this plan does NOT do

- **No light values.** `.light` still carries only `color-scheme`. Child D.
- **No `forcedTheme` change.** Child E.
- **No redesign.** Every value is preserved exactly. Where the palette is inconsistent — three
  warm families for three different states — C records it and preserves it. Rationalising it
  is a design decision for D, made against designed light counterparts.

---

**Terminal state: READY_FOR_ADVERSARIAL_REVIEW.**

This document is self-contained, has no unresolved blocking unknowns, and is **not
authorization to implement**. Each slice runs its own code review and the documented gates
before it merges.
