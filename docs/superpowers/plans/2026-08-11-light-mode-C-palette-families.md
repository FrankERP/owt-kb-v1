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

**The scale is called `mono`, and the name is load-bearing.** `neutral` was the obvious
choice and is unusable: it is one of Tailwind's own 22 families, and
`scripts/colour-inventory.mjs:108` lists it in `PALETTE_FAMILIES`. A `text-neutral-500`
would be re-scanned as a category-3 palette class and dispositioned back to `C`, so the
primary gate below could never reach its target — C2 would migrate 475 rows and the count
would not move. The same collision would make the palette-family lint clause ban C's own
tokens. `slate`, `zinc` and `stone` fail identically. `mono` is not a Tailwind family.

Proven rather than reasoned, by running the real scanner over a probe file:

```
text-neutral-500  ->  cat3, disposition C      <- would never drain
bg-neutral-800    ->  cat3, disposition C
text-gray-500     ->  cat3, disposition C      (the control)
text-mono-500     ->  not found                <- clean
bg-mono-800       ->  not found
```

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
| `gray-200` | 12 | `#e5e7eb` | `229 231 235` | `--mono-200-rgb` | new |
| `gray-300` | 25 | `#d1d5db` | `209 213 219` | `--mono-300-rgb` | new |
| `gray-400` | 96 | `#9ca3af` | `156 163 175` | `--mono-400-rgb` | new |
| `gray-500` | **243** | `#6b7280` | `107 114 128` | `--mono-500-rgb` | new — the densest row in C |
| `gray-600` | 79 | `#4b5563` | `75 85 99` | `--mono-600-rgb` | new |
| `gray-700` | 14 | `#374151` | `55 65 81` | `--mono-700-rgb` | new |
| `gray-800` | 6 | `#1f2937` | `31 41 55` | `--mono-800-rgb` | new |
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

`mono`, `negative` and `warning` are **evidence-backed**: gray is a scale, red is used for
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
`--mono-*` would make them themeable and thereby wrong.

**One exception:** `shadow-black` ×2 → `--elevation`, the role Child B created for exactly
this (`0 0 0`). Δ0.

`stroke-white` ×2 (`AdminPanel.tsx:135`, `ProfilePanel.tsx:50`) is **not** an exception. B
moved those out of the SVG presentation attribute into a `stroke-white` utility and left the
value alone; C leaves them alone too, for the same reason as every other `white` here — they
sit on a `bg-black/50` overlay and mean "maximum contrast".

**So 2 rows move and 45 stay literal.** An earlier revision of this plan said both: it called
`stroke-white` an exception in this paragraph while the prose kept it literal, then counted 4
rows moving in slice C9 and set the primary gate at 43. An implementer targeting 43 with only
2 rows moving would have chased a phantom pair. **The gate is 948 → 45 and C9 moves 2.**

**No lint rule covers the 45, and that is stated rather than implied.** A family clause keyed
on `-\d{2,3}` cannot match `bg-white` or `bg-black`, so there is nothing for them to be
exempt *from*. Making them provably deliberate would need a keyword clause plus an allowlist;
C does not add one, and records the reason in `brand.css` beside `--elevation` instead. Child
C leaves `white`/`black` enforcement to whoever decides they need it.

## Slicing — per family, as the parent requires

The parent's §11 row for C says **"per colour family; each independently revertible"**. That
is the slicing, and it works because `theme.extend.colors` is additive — the same property
that made B sliceable.

| Slice | Content | Rows | Why it is safe alone |
|---|---|---:|---|
| **C1** | Add all 34 roles to `brand.css` and `tailwind.config.ts`, **and extend `TOKEN_LAYER_ROLES` in `scripts/colour-inventory.mjs` with all 34 names.** Remove nothing, migrate nothing | 0 | Purely additive. Renders identically — but see the note below: without the third step it is *not* count-neutral |
| **C2** | `gray` → `--mono-*` | 475 | Largest slice, but one family; revert restores `gray-*` |
| **C3** | `red` → `--negative-*` | 192 | Includes B's 4 deferred `rgba(239,68,68,·)` rows |
| **C4** | `amber` → `--warning-*` | 91 | Includes B's 4 deferred `rgba(251,191,36,·)` rows |
| **C5** | `yellow` → `--recency-*` | 50 | |
| **C6** | `green` → `--positive-*` | 47 | |
| **C7** | `orange` → `--availability-*` | 23 | |
| **C8** | `purple` + `blue` → `--badge-*` | 23 | Two tiny families, one slice |
| **C9** | `white`/`black` — the **2** `shadow-black` rows that move to `--elevation`; the other **45** stay literal with their reason recorded | 2 | |
| **C-final** | Land the deferred lint clauses; re-point any remaining guard | 0 | Gated on a generated count |

**C1 has a third step that is easy to miss and breaks a shipped gate if missed.**
`TOKEN_LAYER_ROLES` (`scripts/colour-inventory.mjs`) enumerates Child B's 30 roles **by
name**, and category 12 dispositions any `--*-rgb` declaration *not* on that list to `B`.
Today `byCategory[12]` is 30, all `keep`. Adding 34 declarations without extending the list
sends all 34 to disposition `B`, on a slice whose entire claim is that it changes nothing.

**Expected after C1, quoted as the artifact actually reports them:**

| Key | Before C1 | After C1 |
|---|---:|---:|
| `summary.byCategory["12"]` | 30 | **64** |
| `summary.byDisposition.B` | **124** | **124** (unchanged) |
| category-12 rows dispositioned `keep` | 30 | **64** |

**`byDisposition.B` is 124, not 102.** An earlier revision of this plan said 102, which is
the count of *literal* rows with disposition `B`; the summary key folds in the 22
`compositing` rows as well (`build()` adds `compositing` to `byDisposition` but not to
`byCategory`). An implementer who landed C1 correctly and checked the named key would have
found 124 where the plan promised 102, and either hunted a regression that does not exist or
"corrected" the artifact. The scanner's own header states the rule that violates: **if the
generated output disagrees with any figure in any planning document, the output wins.**

**A second scanner defect had to be fixed before C1 was possible at all**, found in review
round 2. Category 12's property regex was `--([a-z-]+):` — no digits — so `--mono-500-rgb`
and its six siblings matched *nothing* and emitted **no row**. Not a miscount: a row that
does not exist cannot be dispositioned, so the seven roles covering C's densest 475 rows
would have been invisible to the artifact this programme treats as authoritative, and
`byCategory[12]` would have reached 57 rather than 64. Widened to `--([a-z0-9-]+):` at
`2965d3e`'s successor, verified count-neutral first: the only digit-bearing custom properties
today are the 18 composed tokens, whose values are `rgb(var(…))` rather than bare triplets,
so they still fail the value clause. `byCategory[12]` stayed at 30 across the change.

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

**The obstacle set was 8 rows and is now exactly 8 — but only because the scanner was wrong
and has been fixed.** Review round 1 found two `rgb()` literals that no child had migrated and
that the inventory did not contain: `signin/page.tsx:72`'s `rgba(0,0,0,0.28)` and
`ProposalsPanel.tsx:154`'s `rgb(0_191_255/0.45)`. The cause was category 6's regex anchoring
with `\b(?:rgba?|hsla?)\(` — and Tailwind writes spaces as underscores inside an arbitrary
value, so `_rgb(` has no word boundary and the match failed silently. **This is the same trap
B's plan documented as a requirement on the lint rule; nobody checked the scanner carrying
that category had it too.** Both rows were dispositioned `B`, both were Δ0 (`0 0 0` is
`--elevation`, `0 191 255` is `--accent`), and both were migrated at `2965d3e` along with the
regex fix. Category 6 now reports zero. **C's clause therefore has 8 obstacles, not 10, and
the number is now trustworthy** — it was not when this plan was first drafted.

Both go in the existing `files: ["app/**/*.{ts,tsx}"]` block C inherits from B, with the same
AST-based `no-restricted-syntax` selectors — **not source-text rules**, which fire on colours
named in comments.

**There is no `white`/`black` exemption, because there is nothing to exempt them from.** An
earlier revision of this plan called for one "scoped to the 43 rows that stay literal", which
was wrong twice over: the count is 45, and a family clause keyed on `-\d{2,3}` cannot match
`bg-white` in the first place. Had C written that exemption it would have been an allowlist
guarding against a rule that does not exist — the kind of dead apparatus that reads as
coverage. The 45 rows are recorded in `brand.css` and enforced by nothing, deliberately.

## Verification

- **`summary.pairs` and `lightCounterpartClasses` move at C2, and that is expected.** All 12
  surviving pairs are `gray`, so collapsing them takes `pairs` to **0**. The guard compares the
  whole artifact, so it regenerates regardless — but naming the fields here keeps C2's diff
  review honest, rather than leaving a reviewer to wonder whether a drop to zero is success or
  a scanner regression. It is success: B hit the same shape and had to move that assertion onto
  a synthetic source for exactly this reason.
- **Primary gate — the inventory.** `disposition === "C"` must fall from 948 to **45** (the
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
- **Three test assertions sit outside the inventory and must move with their slices.**
  `__tests__` is excluded from the scan by design, so C's row counts cannot see them:
  `plannerGridDrag.test.tsx:194` asserts `toContain("border-amber-500/40")` and **will fail at
  C4**; `PlannerGrid.test.tsx:582` and `:604` assert `.border-red-500\/50` has length 0 and go
  **vacuously true at C3** — a dead guard that still passes, which is worse than a failing one.
  Budget all three in their slices and re-point rather than delete.
  `colourInventory.test.ts:75`/`:78` also name palette spellings, but those are the scanner's
  own synthetic fixtures — they exist to prove detection still works, and `gray` remains a
  Tailwind family regardless of what C migrates, so they are correct unchanged. Named here so
  a future reader does not re-derive it.
- **The gallery is unmeasured but linted.** `app/(gallery)` is excluded from the inventory
  (`EXCLUDED_TREES`) yet sits inside the eslint block's `files: ["app/**/*.{ts,tsx}"]` with no
  ignore. It carries **0 palette classes and 0 `rgb()` literals** as of `fbedd70`, so
  C-final reaches 0 errors — but it is the one surface D and E will keep extending, and a
  palette class added there would fail the clause without ever appearing in a count.
- **Browser**: the theme gallery's `dark` route before and after each slice.
- `npx tsc --noEmit`, `npm test`, `npx eslint .` at **0 errors**, per slice.

## Risks

| Risk | Why it is real | Mitigation |
|---|---|---|
| **The role layer doubles, 30 → 64** | Child D must design a light counterpart for each. This is the true cost of zero repaint | Stated here so D is sized correctly, not surprised. D may collapse roles *when designing light values* — that is a design act in the right place |
| A palette class is left behind and the lint clause makes `eslint .` un-green | B hit exactly this shape twice | The clause lands per family, never before its slice |
| `gray` is 50% of C in one slice | A bad C2 is a big revert | C2 is the only slice with 12 light/dark pairs; it gets its own review and its own merge point |
| Names encode meanings C has not proven | `recency`, `availability`, `badge-*` rest on 2–4 call sites each | **Open question C-Q1.** Values are Δ0 regardless, so a renaming later is mechanical and safe |
| `white`/`black` left literal looks like an oversight | 45 rows with no token | C9 records the reason in `brand.css` beside `--elevation`. **No lint rule covers them**, because a family clause keyed on `-\d{2,3}` cannot match a keyword — stated rather than implied |

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
