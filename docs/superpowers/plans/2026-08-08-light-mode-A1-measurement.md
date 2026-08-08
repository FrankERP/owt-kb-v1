# Implementation Plan A1: Light mode — measurement and token-file guards

## Original request

> "bring light mode back." — via the approved parent scope spec, whose Child A was split into
> **A1 (measurement)** and **A2 (rendering)** after six review rounds established that one
> artifact was carrying two separable outcomes.

This plan ships **no user-visible change** and **no route**. It makes the repository able to
*measure* its colour surface and *guard* its token file — neither of which it can do today.

No secrets, credentials or personal data appear here. Colour literals are design values.

## Status and contract

- **Document status:** Draft — not reviewed, not approved, not authorization to implement.
- **Accepted requirement source:**
  [`2026-08-07-light-mode-member-first-scope.md`](../specs/2026-08-07-light-mode-member-first-scope.md),
  re-approved at digest `3a927bd8b70c3726134a5254e8e8c258a90eb689ba539397d7bcf0196abb1478`
  (**eleven** non-blocking items folded in afterwards and recorded there as un-reviewed — nine at re-approval, plus §8.1a recording this split, plus the §9 declaration-set correction. **Both parent edits have landed** in the commit that carries this plan; A1 is the split's record, so it carries them.)
- **Supersedes, jointly with A2:** `2026-08-07-light-mode-A-verification-scaffolding.md`,
  closed without approval. Its review log records what six rounds verified; **that evidence
  is inherited here rather than re-derived.**
- **Risk tier: Standard — one fresh cold `APPROVED`.** Derived from the ladder: no writer, no
  schema, no migration, no auth or trust boundary, no secret, no remote release action, and
  **no route** — the route moved to A2 precisely to keep that boundary out of this plan. This
  plan adds one script, two test files, and one CSS line.
- **Preconditions:** parent approved (met). No plan before this one.
- **Safe ending state:** the app is byte-identical in behaviour and appearance. `app/brand.css`
  gains one inert declaration block. `npx tsc --noEmit`, `npm test` and `npx eslint .` all
  green.

## Evidence and current behavior

Every row was verified against the working tree during Child A's six review rounds.

| Evidence | Planning implication |
|---|---|
| No colour inventory exists; every count in v23 and the parent is a hand-count, and three successive hand-counts each understated the surface | Step 1 is the first deliverable; everything downstream is written against its output |
| `app/brand.css` is outside **lint** — `eslint.config.mjs` loads no CSS processor and `npx eslint app/brand.css` reports 0 errors — but it is **not ungated**: `app/components/admin/__tests__/participationAlongside.test.tsx:954` does `read("app/brand.css")` and several `it()` blocks in that `describe` assert against its contents, pinning `.brand-admin-frame` (`:992`), `[data-route-main]:has(.planner-wide)` (`:1003`) and `.brand-admin-shell` (`:1015`) | Step 4's guard is the only enforcement of **token/theme structure**, not the only enforcement of the file. **Two classes the inventory dispositions are already pinned by an existing test with a CLAUDE.md-documented rationale** — Children B and D must not assume `brand.css` is unguarded |
| An undeclared `var()` is invalid at computed-value time and the declaration is **dropped** | The `brand.css` failure mode is silent: the body wash and every inset highlight simply vanish |
| `vitest.config.ts:15` includes only `app/**`, `scripts/**`, `e2e/**` | A guard outside those roots never matches and never runs — a silent no-op, not a failure |
| `brand.css` has 11 `:root` properties: `:9` `--brand-steel` is a **colour**, `:10–13` are the four non-colour ones (`--brand-radius-panel`, `--brand-radius-control`, two `--brand-duration-*`) | The theme-parity assertion must be **colour-scoped**, and an allowlist built from the wrong line range would exempt a colour |
| `brand.css` declares `.brand-*` classes across multiple selector occurrences, and two textual matches (`:265,269`) are inside comments | Any scan must strip comments and must not be line-anchored. **Exact totals are the generated inventory's to state**, not this table's — every hand-count in this plan's history has been wrong at least once |
| **Two** classes are colour-free: `.brand-admin-frame` (`brand.css:308–312`, indented inside `@media (min-width: 1280px)` opening at `:296`) and `.brand-admin-workspace` (`:332–334`, `min-width: 0`) | `^\.brand-` misses the first, which is why a line-anchored scan under-counts. **Neither needs a light counterpart, so the parent's "17 light counterparts" is too high** — the exact figure comes from the generated `brand-class` rows, not from this table |
| `brand.css`'s `:root` colour values are **bare RGB triplets** (`--brand-blackout: 1 11 23`) | They match none of the obvious literal categories; the inventory omits them unless a triplet category exists |
| The only undeclared `var()` references anywhere in `app/**` + `tailwind.config.ts` are `--font-display` / `--font-body` / `--font-label` (`tailwind.config.ts:25–27`), emitted at runtime by `next/font` | An unscoped reference assertion goes red on day one |
| Exactly two **colour** `var(--brand-*)` references live outside `brand.css`/`tailwind.config.ts`: `AdminPanel.tsx:399` (`--brand-beam`) and `(client)/admin/page.tsx:37` (`--brand-signal`) | Both name variables Child B retires; a file-scoped reference set cannot see them |
| `tailwind.config.ts:15–21` **references** the same variables through seven `brand.*` keys and declares **zero** custom properties; `:38` carries `rgba(0, 0, 0, 0.1)` and sits **outside** the `app/**` glob | It belongs to the **reference** set, never the declaration set — treating it as a declaration source disables the guard entirely (step 4). It is also a named out-of-glob input |
| `app/utils/emailShell.ts` carries **12** hex literals of which **3 sit in comments** (`:88` `#071624`; `:114` `#010B17` twice), so the mandated comment-strip leaves **9** rows. Exempt by design (CLAUDE.md landmine: five failed attempts to hold a dark email palette against Outlook for Mac) | Must be classified `exempt`, never `B`/`C` |
| `app/components/admin/serviceCardModel.ts` carries **56** colour matches in exported class strings consumed by **7** `.tsx` components | A `.tsx`-only glob misses it entirely |
| `PlannerGrid.tsx:1497` names `#010b17` **inside a comment**; the real decision is `bg-[#010b17]` at `:1499` | A source-text scan without comment stripping invents a colour decision that does not exist |
| `app/utils/protectedReadAudit.ts:415` exports `stripComments` | The repo already solved comment stripping; parent §9 directs reuse |
| Four test files already carry hex, and this plan's own tests must name colours by value | `app/**/__tests__/**` is exempt |
| Baseline: **142 test files, 3,275 tests passing**; `tsc` clean; `eslint` 0 errors / 90 warnings | Any regression is attributable |

## Scope

### In scope

- The colour inventory script, its committed snapshot, and the vitest sync guard.
- The reconciliation note against the parent's provisional hand-counts.
- The palette-family shade analysis and the **reviewed token vocabulary** (parent §8.1).
- The `brand.css` **reference-integrity** guard (active) and the **theme-parity** guard
  (authored dormant, self-activating in Child D).
- `.light { color-scheme: light }` in `app/brand.css`, declared **after** `:root`.

### Non-goals

- **No route, no gallery, no page, no layout.** All of that is **A2**. This plan touches no
  routing surface, which is why it changes no trust boundary.
- **No VR harness, no Playwright config, no credentials.** A2.
- **No token layer.** `tailwind.config.ts` colour config is Child B.
- **No `.light` colour values.** Child D. `.light` here holds `color-scheme` and nothing else.
- **No file migrations.** Not one `className` changes.
- **No lint rule.** Its first clauses land with Child B.

### Preserved invariants

All 19 parent invariants. The three this plan can plausibly break:

- **#1 done-gate** — 0 eslint errors and `npm test` green. Two failure modes below are
  specifically about this plan failing its own gate.
- **#8 `routeMatcher.test.ts`** — this plan adds no route, so the guard must stay green
  **untouched**. If it goes red, something outside this plan's declared scope was added.
- **#16 whole-app** — nothing here ships a partial surface.

## Affected boundaries

| Component | Current responsibility | Planned responsibility |
|---|---|---|
| `scripts/colour-inventory.mjs` *(new)* | — | Emits the complete colour inventory as stable, sorted JSON |
| `app/utils/__tests__/colourInventory.test.ts` *(new)* | — | Fails when a live scan diverges from the committed snapshot |
| `app/utils/__tests__/__fixtures__/colour-inventory.json` *(new)* | — | The committed inventory. **Not** under `__snapshots__/`, which is vitest's reserved directory |
| `app/utils/__tests__/brandCss.test.ts` *(new)* | — | Parses `brand.css` + `tailwind.config.ts`; reference integrity now, theme parity from Child D |
| `app/brand.css` | Dark-only tokens + 17 compositing classes | Gains `.light { color-scheme: light }` **after** `:root`. No other change |
| `app/components/admin/__tests__/participationAlongside.test.tsx` | **Existing** `brand.css` gate — pins `.brand-admin-frame`, `.brand-admin-shell` and the width derivation | **Read, not modified.** Named so Children B and D know `brand.css` already has assertions with a CLAUDE.md-documented rationale |
| `app/utils/protectedReadAudit.ts` | Exports `stripComments` (`:415`); enforcement for service-readiness protected reads | **Possibly modified** — if `stripComments` is extracted to a shared `.mjs`, this file imports it instead. `stripComments` also has an **in-module** caller at `protectedReadAudit.ts:780`, so any extraction must keep it re-exported from that module or `protectedReadAudit.test.ts:28` breaks. The module's only external importer is that test, so the blast radius is contained and test-covered |
| `docs/superpowers/specs/2026-08-07-light-mode-member-first-scope.md` | Approved parent | **Modified**, both disclosed post-approval: the status-line item count (nine → **eleven**, adding §8.1a's split record and the §9 correction), and §9's declaration-set / `brand.css`-is-ungated corrections |
| `docs/UTILITIES_AND_COMPONENTS.md` | Current record | Lists the new script and two guards |

**Trust boundary: untouched.** No route, no handler, no session read, no data access, no
network. The only runtime artifact is one CSS declaration that nothing currently activates.

## Ordered changes

### 1. The colour inventory script

**Purpose:** replace hand-counting permanently.

**Scope.** Glob `app/**/*.{tsx,ts,mjs,css}` **minus `__tests__`**. One named out-of-glob input:
`tailwind.config.ts` (`:38` `rgba(0, 0, 0, 0.1)`, plus the seven `brand.*` colour keys).

**Categories.** 1 bracketed hex · 2 bare hex · 3 raw palette classes · 4 `white`/`black` and
colour keywords (`transparent`, `currentColor`) · 5 `rgb()`/`rgba()`/`hsl()` literals ·
6 colour inside arbitrary values with no `#` · 7 inline styles · 8 SVG attributes · 9 runtime
colour maps · 10 retired `brand-<colour>` keys · 11 `.tsx`/`.ts` arbitrary values referencing
`var(--brand-*)` · 12 bare RGB triplets in CSS custom properties · 13 `.brand-*` compositing-class
occurrences.

**Precedence — each site gets exactly one category.** Syntax and location are orthogonal axes,
so "most specific wins" cannot adjudicate them: `fill="#4285F4"` is bare hex *and* an SVG
attribute. **Rule: location beats syntax**, because the migration mechanism follows location —
an SVG attribute becomes `currentColor` or `rgb(var(…))`, a class literal becomes a token.
Order, most specific first: **13 → 12 → 9 → 8 → 7 → 6 → 5 → 11 → 10 → 3 → 4 → 1 → 2**. Under
it, `AdminPanel.tsx:399`'s `shadow-[inset_0_0_0_1px_rgb(var(--brand-beam)/0.15)]` is **11** —
correct, since its migration is a variable rename, not a literal swap.

**Category 13 emits two row kinds**, because one key cannot carry both dispositions:

| Row kind | Key | Disposition |
|---|---|---|
| `brand-class` | file + class + occurrence kind + **occurrence count** | `D` (needs a light counterpart) or `exempt` (no colour anywhere) |
| `brand-rule-body` | class(es) + body ordinal within file | `B` (contains colour) or `exempt` |
| `className` occurrence of a compositing class | — | **`keep`** — never migrated, removed or rewritten |

The occurrence count is load-bearing: without it a class's occurrences collapse to one key, and
deleting any occurrence that is not the last of its class in its file leaves the key set
byte-identical and the guard green. `.brand-navbar` is why the two kinds exist — its body at
`brand.css:34–36` is colour-free while `:38–50` is not, which a class-level disposition cannot
express.

**Match compositing classes by `.brand-<component>` selector and `className` occurrence, never
by a loose `brand-` regex.** A loose match makes `brand-atmosphere` a migration target, and it
sits on `<body>` in both root layouts (`(admin)/layout.tsx:42`, `(client)/layout.tsx:58`) —
stripping it removes the app's entire body wash.

**Disposition domain: `B`, `C`, `D`, `keep`, `exempt`.** **Each child consumes the rows
dispositioned TO it — never "everything minus `exempt`".** A blacklist fails open: a row nobody
thought to exempt joins a migration by default. A whitelist fails closed, and an unrecognised
disposition is an error.

**Scanning rules.**
1. **Case-insensitive** — both `#010B17` and `#010b17` occur.
2. **Never line-anchored** — `.brand-admin-frame` is indented and nested at `brand.css:308`; a
   `^\.brand-` scan misses it entirely.
3. **Strip comments**, reusing `stripComments` (`app/utils/protectedReadAudit.ts:415`).
   Extract it to a shared `.mjs` and re-export from `protectedReadAudit.ts`, which has an
   in-module caller at `:780`. The `.ts`→`.mjs` import precedent is already green in-tree at
   `protectedReadAudit.test.ts:31`. **Caveat:** it implements a **JS/TS** comment grammar and
   the glob includes `.css`, where `//` is not a comment — safe today (zero `//` and zero
   `url(` in all three CSS files), so branch on extension or record the limitation.

**Seeded exemptions, keyed by file + value, never by line range** (line-keyed seeds drift off
their rows on the next edit): `emailShell.ts` — **9** literals after comment-stripping, not the
12 a raw grep shows, or three seeded values never match a row; the Google mark in
`signin/page.tsx`; the static `themeColor` in `(client)/layout.tsx`. `app/**/__tests__/**` is
**excluded by the glob**, not seeded as a row.

**Snapshot key: file + normalised utility + value multiset. Never line numbers.**
- **"Normalised utility"** = property + variant chain, colour removed, **`dark:` preserved** —
  `dark:border-[#f59e0b]` normalises to `dark:border`, not `border`. Collapsing the variant
  merges both sides of a pair; dropping it loses which side is dark.
- Category 12 keys on **file + property name + value**; category 13 as tabled above.
- The snapshot carries a **compared summary block** — class, occurrence and rule-body totals —
  **inside the assertion**, not in a human-only header, or no key can express them.
- Line numbers are emitted for humans and excluded from the assertion, so the artifact's header
  must state that **line numbers are informational and may be stale**.

**Pair relation is a first-class output.** For every element carrying a light/dark pair on the
same property, record both sides and their relation. Three consumers, none able to derive it
from per-literal rows: step 3's alpha-baked token criterion; Child B, which cannot map a literal
to a composed token without its partner; and A2's AA-gate step, which derives the dark
composited failing set from the nesting map **plus these pairs**.

**Verification.** A committed unit test feeds the scanner a synthetic source string and asserts
each category is detected. Two consecutive runs on an unchanged tree produce byte-identical
output — if not, the key is unstable and this step is not done.

**State after:** inventory committed. No behaviour change.

### 2. Reconcile against the parent

**Purpose:** the parent's counts are provisional by its own A1. Generated figures supersede them.

**Change:** a committed note recording every divergence, **stating which unit each figure uses**
— the parent's §3 wobbles between *sites* and *literals* (`:60` says 27 "sites"; `:64` calls the
Google logo "one site but four literals").

**The inventory is authoritative. If generated output disagrees with any figure in any planning
document, the output wins** — including the parent's "17 light counterparts", which is too high
because more than one class is colour-free. Do not narrow a rule until a count matches a number
in a document.

**State after:** the parent's provisional figures superseded.

### 3. Palette-family analysis and the token vocabulary

**Purpose:** the vocabulary is an output with acceptance criteria, not an input.

**Change:** run the "can the vocabulary represent these values" analysis over all eight
raw-palette families *before* freezing anything (`gray` spans 7 shades, `red` 9). Produce the
vocabulary as a reviewed artifact meeting the parent's §8.1 criteria:

- every (family, shade) pair represented, or each collapse recorded with its site count and a
  rationale;
- three slots — foreground, surface, border — for every semantic state needing them
  (`DayCard.tsx:37–50`: three literals for one state, per theme);
- composed, alpha-baked tokens for pairs whose alpha differs per theme, because a
  theme-invariant opacity modifier cannot express "opaque navy in light, 20% cyan in dark";
- **naming rule, binding:** a token key may never begin with a utility prefix. `border-accent`
  compiles to `.border-border-accent`, while `.border-accent` silently resolves to the base
  `accent` role;
- **the storage convention stated once.** `brand.css` stores triplets (`--brand-frost: 215 231
  246`) **without** a `-rgb` suffix; the parent's D3 introduces that suffix. Say which form holds
  a triplet and which holds a complete colour — Child B's prose mapping is correct only against
  a stated convention, and getting it backwards renders song lyrics unstyled with no signal.

**Stop condition:** if the role set cannot represent the palette without collapses nobody will
accept, **stop and raise to the parent** before Child B is written.

**State after:** vocabulary agreed. No tokens in the codebase yet.

### 4. The `brand.css` guard — two assertions, one dormant

**Purpose:** `brand.css` is outside **lint** (no CSS processor), though not ungated —
`participationAlongside.test.tsx:954` reads it and pins `.brand-admin-frame` (`:992`),
`[data-route-main]:has(.planner-wide)` (`:1003`) and `.brand-admin-shell` (`:1015`). What has
**no** enforcement is its **token/theme structure**. The failure this guard closes is silent:
an undeclared `var()` is invalid at computed-value time and the declaration is dropped, taking
the body wash and every inset highlight with it.

**(a) Reference integrity — ACTIVE.** Every **colour** `var(--x)` referenced is declared.
- **Reference set** = the inventory's glob (`app/**/*.{tsx,ts,mjs,css}` **minus `__tests__`**,
  without which the guard's own synthetic fixture poisons the set) **plus `tailwind.config.ts`**.
  A file-scoped set cannot see `AdminPanel.tsx:399` or `(client)/admin/page.tsx:37` — the two
  live colour references naming variables Child B retires.
- **Declaration set = `brand.css` only.** `tailwind.config.ts` declares **zero** custom
  properties; treating it as a declaration source makes every `--brand-*` self-declaring and
  the guard permanently green against the exact rename it exists to catch.
- **Colour-scoped:** classify declared variables by value shape, and treat an undeclared
  reference as a colour **unless named on a non-colour exclusion list** — today exactly
  `--font-display`, `--font-body`, `--font-label` (`tailwind.config.ts:25–27`, emitted by
  `next/font`, declared in neither file). Do not scope by a `--brand-` prefix: that makes the
  synthetic fire-proof vacuous.
- **Out of scope, named so it is a decision:** a `var()`-integrity guard cannot see Tailwind
  **utility** references. `selection:bg-brand-beam/35` on both root layouts consumes the
  `brand.beam` *key*, not a `var()`. **That guard is Child B's**, since B removes the key.

**(b) Theme parity — AUTHORED, DORMANT.** Every **colour** `:root` custom property has a
`.light` counterpart or sits on a reviewed theme-invariant allowlist, and vice versa.
- **Self-activates on "`.light` declares ≥1 custom property."** Step 5 adds only `color-scheme`,
  which is not a custom property, so it stays dormant here and binds in Child D. **The trigger
  matches the selector form, so the form is binding on Child D:** hardening `.light` to
  `:root.light` without updating the trigger un-arms the guard permanently.
- **Colour-scoped**, for the same reason as (a): four of the 11 `:root` properties are
  non-colour (`brand.css:10–13`; `:9` is `--brand-steel`, a colour).
- **The allowlist starts empty**, since colour-scoping already excludes the non-colour four. It
  exists only to hold a future colour property somebody argues is theme-invariant — a claim that
  must be reviewed. **`--brand-signal` must never be allowlisted:** it is a colour Child B
  retires, and allowlisting a colour is the drift class this guard catches.

**Placement:** `app/utils/__tests__/`. Outside `vitest.config.ts:15`'s three roots a guard never
matches and never runs.

**Verification:** both assertions are proven by **committed** unit tests over synthetic sources —
(a) fails on an undeclared `var()` and is green against the real tree; (b) is green today and
fires on a synthetic `.light` block with a missing counterpart. A dormant guard nobody has seen
fail is not a guard.

**State after:** the token file has structural enforcement for the first time.

### 5. `.light { color-scheme: light }`

**Purpose:** `brand.css:2` hardcodes `:root { color-scheme: dark }` with no light branch. It is
masked in the app by next-themes' `enableColorScheme` inline style, but **A2's gallery runs with
no provider**, which removes the mask, and Child E needs the branch regardless.

**Change:** add `.light { color-scheme: light; }`. Nothing else in `brand.css` changes. An
appended block breaks none of `participationAlongside.test.tsx`'s regexes.

**It must be declared AFTER `:root`.** Both selectors are specificity (0,1,0), so the override is
pure source order — and the parity guard checks presence, not order. A `.light` block above
`:root` passes every gate and themes nothing.

**Verification:** a test asserts both declarations exist **and that `.light` follows `:root`**.

**State after:** `.light` holds one non-custom-property declaration, so the parity guard stays
dormant. Inert until Child D.

## Data and failure safety

- **Identity and source of truth:** the generated inventory is authoritative for the colour
  surface. Every hand-count in the parent and v23 is provisional and superseded by it.
- **Migration and compatibility:** none. No data read, written or migrated. No Sanity access,
  no Studio deploy, no network.
- **Partial failure:** every step is independently revertible and none leaves a half-state that
  renders differently — no `className` changes here.
- **Concurrency and idempotency:** the scanner is a pure read. Re-running on an unchanged tree
  must produce a byte-identical snapshot.
- **Rollback:** `git revert`. Nothing to preserve.

## Verification

| Requirement | Test or check | Failure it detects |
|---|---|---|
| Inventory is complete | **Committed** unit test over a synthetic source string asserts each category is detected | An under-reporting glob — the defect that makes Child B migrate by guesswork |
| Inventory is stable | Two consecutive runs on an unchanged tree are byte-identical | An unstable key, which would make `npm test` flap |
| Snapshot is not line-keyed | An unrelated whitespace commit in a colour-bearing file leaves `npm test` green | The false-red that gets the guard deleted |
| Glob covers `.ts` | `serviceCardModel.ts` contributes its 56 matches | The `.tsx`-only glob trap |
| Scan is not line-anchored | `.brand-admin-frame` appears as an **`exempt`** `brand-class` row; the summary block's class count exceeds what `^\.brand-` alone would find | The line-anchored trap, which under-counts by dropping nested rules |
| No loose `brand-` match | `brand-atmosphere` produces **no category-10 row** (it is not a retired colour key) and **no `className` occurrence dispositioned as a removable utility**. Its **rule bodies** (`brand.css:16–26`) contain colour, so they *are* dispositioned `B` — the body-wash rules must be rewritten off the retired variables, which is what parent §12 assigns to B | Stripping `brand-atmosphere` off both root layouts as if it were a retired utility |
| Comments are stripped | `PlannerGrid.tsx:1497` does **not** appear; `:1499` does | An invented colour decision |
| Triplets are captured | The seven `:root` colour values appear | The token file omitting itself from its own inventory |
| Pairs are emitted | `DayCard.tsx:37`'s `border-[#78350f] dark:border-[#f59e0b]` appears as two distinguishable rows **and** a recorded pair | A2's AA-gate input having no producer, and Child B being unable to map a literal to a composed token |
| Categories do not double-count | `signin/page.tsx:157` (`fill="#4285F4"`) occupies exactly one category | An inflated "authoritative" total that cannot reconcile against the parent |
| Occurrences and bodies are separate figures | Both emitted; `brand.css:172–173` share one body | Mis-sizing Child B (bodies) and Child D (classes) from one conflated number |
| Exemptions survive | `emailShell.ts`, the Google mark and the static `themeColor` are `exempt`, not `B`/`C` | Child B tokenising the email palette — which `emailTemplateGallery.test.ts` cannot catch, since it asserts `bgcolor` presence but never that a colour is a literal |
| Reference integrity | **Committed** unit test over a synthetic source asserts an undeclared `var()` fails; green against the real tree today | Child B's silent-drop rename failure |
| Reference set is not file-scoped | Guard sees `AdminPanel.tsx:399` and `(client)/admin/page.tsx:37` | The exact two references Child B's retirement breaks |
| Parity guard is dormant **and works** | Green today; fires on a synthetic `.light` block with a missing counterpart | A guard that is green because it never runs |
| Guards actually execute | Files under `app/utils/__tests__/`; suite count rises from 142 | A guard outside vitest's roots — a silent no-op |
| `.light` follows `:root` | Source-order assertion | A light branch that passes every gate and themes nothing |
| No route was added | `routeMatcher.test.ts` green **untouched** | Scope creep from A2 into this plan |
| Done-gate | `npx tsc --noEmit`, `npm test`, `npx eslint .` = 0 errors | Regression against 142 files / 3,275 tests |

## Rollout, observability, and rollback

- **Release sequence:** branch `feat/light-mode-a1-measurement`; steps in order; merge to `main`
  when the done-gate is green; direct push, no PR (CLAUDE.md).
- **Deploy verification:** after pushing, confirm the **alias moved** to a deployment built from
  the pushed commit — a green build is not a deploy. HTTP checks prove nothing (SSO returns 302).
- **Signals proving success:** test count rises from 142 files / 3,275 tests; the inventory
  snapshot exists and reconciles; `git diff` on `app/brand.css` shows exactly one added block.
- **Stop conditions:**
  - the inventory cannot produce a stable key → **stop**; everything downstream depends on it;
  - the vocabulary analysis shows the role set cannot represent the palette without collapses
    nobody will accept → **stop and raise to the parent** before Child B is written.
- **Rollback:** `git revert` the merge. No data moved, no remote state changed.
- **Restoration verification:** `npm test` green at 142 files / 3,275 tests.

## Decisions

| Decision | Choice | Why | Tradeoffs | Owner |
|---|---|---|---|---|
| Inventory is generated | Script + snapshot + guard | Three v23 hand-counts and two parent figures were each wrong | A script to maintain | A1 |
| Snapshot key excludes line numbers | file + normalised utility + value multiset | A line-keyed snapshot flaps on unrelated commits, and a flapping guard gets deleted | Cannot detect a pure move | A1 |
| Comment stripping reuses `stripComments` | Not a second implementation | Parent §9; the repo already solved it | `.mjs`/`.ts` import friction must be resolved explicitly | A1 |
| Parity guard ships dormant | Self-activates on the first `.light` custom property | Landing it active fails this plan's own done-gate against all 11 `:root` properties | A dormant guard needs its own proof | A1 |
| Vocabulary is an output, not a spec section | Reviewed artifact | v23 froze 34 roles and called them "a floor" | Child B blocks on the review | A1 |
| No route in this plan | Route lives in A2 | Keeps the trust boundary, and the Critical tier, out of measurement work | Two plans instead of one | split decision |

## Assumptions

| Assumption | Impact if false | Validation point | Failure response |
|---|---|---|---|
| A stable inventory key exists that is neither line-based nor lossy | The guard flaps or misses real changes | Step 1, two consecutive runs | **Stop.** Everything downstream depends on it |
| `stripComments` can be reached from an `.mjs` scanner, or cleanly extracted | A second implementation drifts from the first | Step 1 | Extract to a shared `.mjs` and have `protectedReadAudit.ts` import it, so one implementation serves both |
| The role vocabulary can represent the palette without unacceptable collapses | Child C's per-family merges become judgement calls with no criterion | Step 3 | Raise to the parent before Child B is written |
| Adding `.light { color-scheme }` activates nothing | An unnoticed visual change ships | Step 5 | `.light` is never applied to `<html>` until Child E; A2's gallery is the only earlier consumer |

## Open questions

| Question | Why it matters | Recommendation | Owner | Blocking? | Bounded default |
|---|---|---|---|---|---|
| Per-family mapping of `yellow`/`orange`/`amber` onto `warning-*` | Child C's collapse decisions | Keep families separate until step 3's analysis proves a collapse is safe; `red` → `negative-*` is settled in *family* only | A1 | **No** | Separate roles |
| Snapshot format — one JSON file or per-category files | Review ergonomics of a ~2,400-row artifact | One sorted JSON file, so the diff is the review surface and the guard has one thing to compare | A1 | **No** | As recommended |

**No blocking open questions.**

## Handoff

- **Prerequisites supplied to later plans:** the generated inventory and its guard; the
  reviewed token vocabulary and its stated storage convention; an enforced `brand.css`; the
  `.light` branch A2's provider-less gallery needs.
- **Outputs promised:** **A2** consumes `.light { color-scheme }`, the vocabulary, **and the inventory's same-element pair relation**, which its AA-gate step derives the dark composited failing set from.
  **Child B** consumes the rows dispositioned **`B`** — a whitelist, never
  "everything minus `exempt`" — plus the vocabulary as its target and the pair relation.
  **Child C** consumes the rows dispositioned **`C`** and the per-family analysis. **Child D**
  consumes the `brand-class` rows dispositioned **`D`**, which supersedes the parent's figure.
  Rows dispositioned `keep` or `exempt` go to nobody, and an unrecognised disposition is an
  error rather than a silent inclusion.
- **Adversarial review order:** this plan (**Standard** — one fresh cold `APPROVED`), then A2,
  then Child B.
- **Implementation authorization: not granted by this plan.**

## Terminal state

**`READY_FOR_ADVERSARIAL_REVIEW`**

Self-contained, with no unresolved blocking unknowns. **Review readiness is not approval, and
plan approval is not authorization to implement.** After implementation, a fresh code review
plus the documented test gates are required — plan review is not a substitute.
