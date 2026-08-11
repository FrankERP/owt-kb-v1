# Review log — Child C, the palette families

Companion to [`2026-08-11-light-mode-C-palette-families.md`](2026-08-11-light-mode-C-palette-families.md).
Written after the loop closed; never shown to a reviewer.

**Risk tier: Standard** — one fresh cold `APPROVED`. C changes no writer, no schema, no
migration, no auth boundary, no secret, no remote release action.

**Outcome: APPROVED at round 6**, digest `2e7150bd…`, commit `b3f0d36`.

## Rounds

| # | Blockers | What it found |
|---:|---:|---|
| 1 | 4 | The gray scale was named `neutral` — a Tailwind family the scanner knows, so the primary gate could never drain. C1's 34 roles falling to disposition `B`. Two `rgb()` literals the inventory could not see. Self-contradicting `white`/`black` arithmetic |
| 2 | 2 | Category 12's property regex had no digits, so `--mono-*-rgb` emitted **no row at all**. `byDisposition.B` is 124, not the stated 102 |
| 3 | 1 | A **second** name-keyed registry — `tokenLayer.test.ts`'s stray-key assertion — would fail `npm test` on C1 |
| 4 | 1 | `pairs` does **not** drain at C2; `pairsIn()` is family-agnostic. The plausible "fix" would have stranded two live-tree assertions |
| 5 | 1 | A fourth out-of-inventory assertion (`withAlpha > 0`) drains to zero at C8 |
| 6 | 0 | **APPROVED** |

Trend: **4 → 2 → 1 → 1 → 1 → 0**.

## The one defect this loop kept finding

Not a design flaw in six rounds. Every blocker was the same species: **a claim about the
scanner's behaviour that I asserted instead of executing.**

- `neutral` is safe → it is in `PALETTE_FAMILIES`
- category 12 will see `--mono-500-rgb` → `[a-z-]+` excludes digits
- C1 touches one registry → two
- `pairs` drains because `pairsFor()` keys on families → it doesn't
- three out-of-inventory assertions, list complete → four

The scanner is 600 lines of interacting regexes with a precedence order, and prose reasoning
about it is unreliable in a way that prose reasoning about the *plan* was not. **The fix that
finally worked was running it** — probe files, simulated slices, and in round 6 the reviewer
doing the same.

## Three defects fixed in shipped code

The review found real bugs in `scripts/colour-inventory.mjs`, live since A1, that no gate
could catch — because `colourInventory.test.ts` compares the artifact against the *same*
scanner, so it agrees with the scanner about anything the scanner cannot see.

1. **Category 6's `\b` anchor.** Tailwind writes spaces as underscores inside an arbitrary
   value, so `shadow-[0_0_0_1px_rgb(…)]` has no word boundary before `rgb`. Two rows were
   invisible to every child. Both were dispositioned `B` — work Child B should have done and
   could not see. Migrated at `2965d3e`, both Δ0.
2. **Category 12's digit-less property class.** `--([a-z-]+):` cannot match `--mono-500-rgb`.
   Widened, verified count-neutral first.
3. A stale comment claiming 18 composed tokens where there are 23.

**Both regex bugs were the same shape as bugs the B plan had already documented as hazards —
for the lint rule it prescribed. Nobody checked whether the scanner carrying those categories
had them too.**

## What round 6 did differently

The approving reviewer **simulated C1 and C2 against a scratchpad copy of the tree** and
reran the scanner, rather than reasoning about what would happen. It reproduced all four C1
key movements, C2's `901 → 426` and `948 → 473`, `pairs`-stays-12, and re-derived the
"exactly one of ten assertions drains" claim independently. That is the strongest verification
any artifact in this programme has received, and it is the technique the earlier rounds were
missing.

## Decisions recorded during the loop

- **Zero licensed diffs**, unlike B's two. Every one of the 36 `(family, shade)` pairs maps to
  a role carrying its exact value. Frank chose zero repaint over collapsing onto the semantic
  roles, after being shown that `gray-500` alone is 243 rows at distance 56 from `--ink-dim`.
- **The scale is `mono`**, not `neutral`/`slate`/`zinc`/`stone` — all four are Tailwind
  families the scanner would re-scan.
- **Spec Q1 resolved on usage, not colour distance.** `yellow`/`orange`/`amber` do not collapse
  because they signal different things: amber warns, yellow marks recency, orange encodes
  availability. The spec assigned that analysis to Child A; A never produced it, so C did.
- **45 `white`/`black` rows stay literal** as contrast anchors, enforced by nothing,
  deliberately — and flagged for D to re-examine rather than inherit.

## What the next child should take from this

**The scanner deserves its own audit.** Two of its category regexes were wrong for months, and
it is the authority that sizes Children D and E. Finding the third by having D's review trip
over it would be the expensive way.
