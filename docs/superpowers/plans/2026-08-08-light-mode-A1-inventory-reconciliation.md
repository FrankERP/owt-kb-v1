# A1 step 2 — reconciliation, and step 3 — the token vocabulary

**Date:** 2026-08-08
**Produced by:** `node scripts/colour-inventory.mjs`, guarded by
`app/utils/__tests__/colourInventory.test.ts`.

**The inventory is authoritative. Where it disagrees with any figure in any planning
document — this one included — the inventory wins.** Every number below is generated,
not counted by hand.

---

## Step 2 — reconciliation against the parent's §3

The parent's §3 declares its own counts provisional (A1). They were hand-taken with
ad-hoc greps; these are produced by a scanner that strips comments, applies a stated
precedence so nothing is double-counted, and covers `.ts`, `.mjs` and `.css` as well
as `.tsx`.

| Category | Generated | Parent §3 | Δ | Why |
|---|---:|---:|---:|---|
| 1 · bracketed hex | 1,264 | 1,231 | +33 | The generated value now includes Tailwind's opacity modifier (`bg-[#003572]/50`), so sites the parent's `\[#…\]` pattern truncated are counted once, fully |
| 2 · bare hex | 4 | 27 | −23 | **Location beats syntax.** A bare hex inside an SVG attribute or a runtime map is category 8 or 9, because its migration mechanism differs. The parent counted them all as "bare hex" |
| 3 · raw palette classes | 901 | 881 | +20 | Opacity modifiers (`bg-gray-700/50`) are now part of the matched value |
| 4 · colour keywords | 108 | 45 | +63 | The parent counted `white`/`black` only. This adds `transparent`, `currentColor` and `bg-current`, which the parent's §3 itself names as live theming affordances |
| 8 · SVG attributes | 101 | — | — | Not a parent category. Restricted to colour-shaped values: `fill="none"` is not a colour decision |
| 9 · runtime colour maps | 22 | — | — | Not a parent category. Includes `emailShell.ts`'s 9 |
| 10 · retired `brand-*` keys | **213** | **213** | **0** | Exact agreement |
| 11 · `var(--brand-*)` arbitrary values | 9 | — | — | 2 colour + 7 `--brand-radius-*` |
| 12 · `:root` RGB triplets | 7 | — | — | The token file's own colour values, which no literal category matches |
| **Total literal rows** | **2,649** | 2,397 | +252 | The delta is categories 4, 8, 9 and 12 — surface the parent's five-row table had no row for |

**Units.** The parent's §3 wobbles between *sites* and *literals* — `:60` calls 27
"sites" while `:64` calls the Google logo "one site but four literals". Every figure
in this document is a **row**: one row per colour decision site, assigned to exactly
one category.

### Corrections the inventory forces on the parent

1. **`brand.css` compositing classes: the light-counterpart set is 15, not 17.**
   The parent says 17 in §5, §8 and §12. Two of the 17 classes carry no colour in any
   rule body — `.brand-admin-frame` and `.brand-admin-workspace` — so neither needs a
   light counterpart. Generated: **17 classes · 33 selector occurrences · 32 rule
   bodies · 15 needing light counterparts.**
2. **`emailShell.ts` contributes 9 rows, not 12.** Three of its twelve hex literals
   sit in comments and are stripped. All 9 are `exempt`.
3. **The parent's bare-hex list omits `ServiceReadinessCard.tsx`'s `#f87171`.** It is
   one of only four true bare-hex rows in the app.

### Disposition totals

| Disposition | Rows | Consumer |
|---|---:|---|
| `B` | 1,650 | Child B — hex, `brand-*`, arbitrary values, SVG, runtime maps, triplets |
| `C` | 946 | Child C — raw palette families and `white`/`black` |
| `D` | 15 | Child D — compositing classes needing a light counterpart |
| `keep` | 107 | Nobody. Usage sites and already-theme-agnostic values |
| `exempt` | 26 | Nobody. Governed by a recorded rule |

**Each child consumes the rows dispositioned to it — a whitelist.** "Everything minus
`exempt`" is a blacklist and fails open: a row nobody thought to exempt joins a
migration by default. An unrecognised disposition is an error.

---

## Step 3 — palette-family analysis, and the token vocabulary

### The family surface

| Family | Rows | Distinct shades | Shades |
|---|---:|---:|---|
| `gray` | 475 | **7** | 200, 300, 400, 500, 600, 700, 800 |
| `red` | 192 | **9** | 100, 200, 300, 400, 500, 700, 800, 900, 950 |
| `amber` | 91 | 4 | 200, 300, 400, 500 |
| `yellow` | 50 | 4 | 200, 300, 400, 500 |
| `green` | 47 | 3 | 300, 400, 500 |
| `orange` | 23 | 5 | 200, 300, 400, 500, 600 |
| `purple` | 14 | 2 | 400, 500 |
| `blue` | 9 | 2 | 400, 500 |
| **Total** | **901** | **36** | |

**36 distinct (family, shade) pairs.** `gray` at 7 and `red` at 9 confirm the parent's
figures exactly. A vocabulary smaller than 36 slots *must* collapse, so every collapse
below is recorded with its site count rather than assumed.

### The hex surface

**20 distinct hex values** carry 1,264 bracketed sites. The distribution is extremely
top-heavy — three values are 89% of it:

| Hex | Rows | Role |
|---|---:|---|
| `#00bfff` | 806 | `accent` |
| `#003572` | 243 | `accent-deep` / `surface-navy` — see the ambiguity note |
| `#c8d8eb` | 78 | `ink-muted` |
| `#a78bfa` | 30 | `info-fg` |
| `#010b17` | 29 | `surface-base` |
| `#0a1929` | 18 | `surface-raised-alt` |
| `#f59e0b` | 14 | `warning-fg` |
| `#001f3f` `#001830` `#00162e` `#020f1c` `#002249` `#03101f` | 20 | `surface-sunken` (six near-identical navies) |
| `#4c1d95` `#5b21b6` `#1e0a3c` | 12 | `info-surface` / `info-border` |
| `#78350f` `#92400e` `#1c0800` | 12 | `warning-surface` / `warning-border` |
| `#3dff7c` | 2 | `positive-fg` |
| `#f87171` | 1 | `negative-fg` |

### The finding that decides the token architecture

**88 of 100 light/dark pairs differ in ALPHA, not only in colour.**

The canonical case, generated from `(client)/auth/not-a-member/page.tsx`:

```
bg-[#003572]          (light — opaque navy)
dark:bg-[#00bfff]/20  (dark  — 20% cyan)
```

A theme-invariant opacity modifier cannot express this: `bg-accent/20` is 20% in
*both* themes. **This is why the second, alpha-baked token layer exists**, and it is
the single most load-bearing measurement in this document.

Pairs by utility: `border` 34 · `bg` 31 · `hover:bg` 17 · `text` 12 · `hover:text` 2 ·
`hover:border` 2 · `shadow` 1 · `from` 1.

### Vocabulary acceptance criteria — how it must be judged

The vocabulary itself is authored against the data above and reviewed before Child B
begins. It must satisfy, and be checked against, the parent's §8.1:

1. **Every (family, shade) pair represented, or each collapse recorded with its site
   count.** 36 pairs against a smaller role set means collapses are the rule. `gray`'s
   7 shades and `red`'s 9 are where the judgement is hardest.
2. **Three slots per semantic state** — foreground, surface, border. `DayCard.tsx:37–50`
   is the worked example: `border-[#78350f] dark:border-[#f59e0b]`,
   `bg-[#78350f] dark:bg-[#1c0800]`, `border-[#92400e] dark:border-[#f59e0b]` — three
   literals for one state, per theme.
3. **Composed, alpha-baked tokens** for the 88 alpha-differing pairs.
4. **Naming rule, binding:** a token key may never begin with a utility prefix.
   `border-accent` compiles to `.border-border-accent`, while `.border-accent` silently
   resolves to the base `accent` role.
5. **Storage convention, stated once.** `brand.css` stores **triplets**
   (`--brand-frost: 215 231 246`) **without** a `-rgb` suffix; the parent's D3
   introduces that suffix. Child B's prose mapping is correct only against a stated
   convention — `--tw-prose-body: rgb(var(--ink-rgb))` under a triplet convention,
   `var(--ink)` only if the bare name holds a complete colour. Getting it backwards
   renders song lyrics unstyled with no build or lint signal.

### The ambiguity a per-literal mapping cannot resolve

`#003572` carries **two different roles**: a light accent in most of its 243 sites, and
a *dark-native navy surface* where it appears with no `dark:` sibling. `#78350f` and
`#c8d8eb` behave the same way. **A mapping table keyed by literal alone cannot be
authored** — this is why the inventory records the pair relation, and why Child B's
table must be keyed by (literal × utility × pairing context).

### Open question carried to Child C

`yellow` (50) / `orange` (23) / `amber` (91) versus a single `warning-*` role.
Together they are 164 rows across 13 distinct shades. **Recommendation: keep them
separate until Child C's per-family diff list proves a collapse is safe.** `red` →
`negative-*` is settled in *family* only; its 9 shades still need a slot decision.

---

## Verification

Every figure here is reproducible:

```bash
node scripts/colour-inventory.mjs --stdout
```

The committed artifact is `app/utils/__tests__/__fixtures__/colour-inventory.json`,
guarded by `colourInventory.test.ts`, which fails when a live scan diverges from it —
proven to fire on a new literal, and proven **not** to fire when an unrelated commit
shifts a line in a colour-bearing file.
