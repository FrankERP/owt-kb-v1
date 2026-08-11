# Review log — Child B, the token layer and the hex/`brand-*` migration

Companion to [`2026-08-08-light-mode-B-token-migration.md`](2026-08-08-light-mode-B-token-migration.md).
Written after the loop closed; never shown to a reviewer.

**Risk tier: Standard** — one fresh cold `APPROVED`. B changes no writer, no schema, no
migration, no auth boundary, no secret and no remote release action. Size is not risk: it is
1,628 rows, but every one is a design value and the correctness gate is mechanical.

**Outcome: APPROVED at round 9**, digest `407f2e34…`, commit `9eedbe3`.

## Rounds

| # | Blockers | What it found | Valid? |
|---:|---:|---|---|
| 1 | 5 | Count errors throughout; `--brand-signal` mapped to the wrong green | yes |
| 2 | 1 | The `pairs` snapshot had dropped alpha | yes |
| 3 | 1 | A guard that could never fail | yes |
| — | — | Reviewer died to an API error mid-verification, no verdict | **no** |
| 4 | 1 | The B-final gate was stated four ways | yes |
| — | — | Reviewer died to an API error mid-verification, no verdict | **no** |
| 5 | 3 | Category 11 can never reach zero; the `rgba()` lint clause fires on C's rows; the pair count was 12 too high | yes |
| 6 | 1 | `${hex}AA` concatenation: enumerated at `DayCard`, actually 24 sites in four files | yes |
| 7 | 2 | The accent also escapes through an SVG presentation attribute; the batch unit omitted `serviceCardModel.ts` | yes |
| 8 | 1 | Category 8 had no owner: 8 hex rows in `icons.tsx`, breaking `eslint . = 0` | yes |
| 9 | 0 | **APPROVED** | yes |

Blocker trend across valid rounds: **5 → 1 → 1 → 1 → 3 → 1 → 2 → 1 → 0**.

## What the loop was actually finding

**Not one design flaw in nine rounds.** Every blocker was a false factual claim, an
unsatisfiable gate, or an enumeration declared closed that was not. The plan's structure
survived from round 1; its *claims about the tree* did not.

Round 5's three blockers included **one I introduced myself in round 4** — a gate requiring
"categories 10 and 11 report zero" when 7 of category 11's 9 rows are `--brand-radius-*` that
B never touches. Fixing a gate is how you break a gate.

**Rounds 6, 7 and 8 were the same defect three times:** a carrier the plan said it had
followed and had not. `${hex}AA` concatenation past `DayCard`. Then SVG presentation
attributes, where `var()` is not substituted. Then an entire category with no owner. Each
round I patched the specific miss and re-asserted closure in prose, and the next reviewer
found the next one.

**Round 8 is where the method changed.** Closure is now a *generated partition* of every
category holding a `B` row — nine of them, with counts, file counts and mechanism — plus the
standing rule that a B row in an absent category means the enumeration failed and the fix is
to regenerate the table. That is the only change in nine rounds that addressed the cause
rather than an instance, and it is the round after which the next review approved.

The lesson is narrow and worth keeping: **when three consecutive rounds find the same class
of defect, the defect is the method, not the instance.** I should have reached that at round
7, not round 8.

## The two API-error rounds

Two reviewers exhausted their budget mid-verification and returned no verdict. Both are
recorded as invalid — they cannot count toward approval or toward the churn cap. Subsequent
prompts opened with an explicit budget-discipline instruction: verify six or seven claims
selectively and write the verdict block by two-thirds of budget. No reviewer died afterwards.

## Corrections made to shipped documents

B's review corrected **its own input**. The A1 vocabulary (already on `main`) prescribed
`rgb(var(--surface-sunken-rgb))` for `icons.tsx`'s SVG attribute — the exact form B proved is
silently dropped — and assigned four `white` attribute rows to Child C when the inventory
dispositions all four to B. Both are fixed in the vocabulary itself, not just noted in B, so
Child C does not inherit them.

## Decisions recorded during the loop

- **B is sliceable** although the parent calls it atomic. Only *removal* of the retired keys
  is unsafe; everything before it is additive, because `tailwind.config.ts` uses
  `theme.extend.colors`.
- **B discards the light-side value of 233 of the 234 pairs it owns.** `Provider.tsx:16`
  forces dark and `brand.css` has no `.dark` block, so a composed token has exactly one value
  and a two-sided equality gate is impossible. The `pairs` snapshot is therefore the sole
  record of those light values for Child D.
- **23 composed tokens, not 24.** The 24th combination is the split `TextSizeControl` pair,
  whose light side is a palette class Child C owns.
- **`app/components/icons.tsx` is deleted rather than migrated.** No importers, no references
  by name, untouched since the initial commit; and its two-fills-per-SVG structure defeats
  `currentColor` while `var()` cannot live in the attribute.
