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
  (nine non-blocking items folded in afterwards, recorded there as un-reviewed).
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
| `app/brand.css` sits outside every gate — `eslint.config.mjs` loads no CSS processor, `npx eslint app/brand.css` reports 0 errors, `tsc` and vitest are blind to CSS | Step 4's vitest guard is the **only** possible enforcement |
| An undeclared `var()` is invalid at computed-value time and the declaration is **dropped** | The `brand.css` failure mode is silent: the body wash and every inset highlight simply vanish |
| `vitest.config.ts:15` includes only `app/**`, `scripts/**`, `e2e/**` | A guard outside those roots never matches and never runs — a silent no-op, not a failure |
| `brand.css` has 11 `:root` properties: `:9` `--brand-steel` is a **colour**, `:10–13` are the four non-colour ones (`--brand-radius-panel`, `--brand-radius-control`, two `--brand-duration-*`) | The theme-parity assertion must be **colour-scoped**, and an allowlist built from the wrong line range would exempt a colour |
| `brand.css` declares **17** `.brand-*` classes across **33** selector occurrences (35 textual matches minus two comment mentions at `:265,269`) | Any scan must not be line-anchored and must not count comments |
| `.brand-admin-frame` occurs only at `brand.css:308`, indented inside `@media (min-width: 1280px)` opening at `:296`, and declares **only layout properties — no colour** | `^\.brand-` misses it, which is why the count is 17 not 16; it needs no light counterpart |
| `brand.css`'s `:root` colour values are **bare RGB triplets** (`--brand-blackout: 1 11 23`) | They match none of the obvious literal categories; the inventory omits them unless a triplet category exists |
| The only undeclared `var()` references anywhere in `app/**` + `tailwind.config.ts` are `--font-display` / `--font-body` / `--font-label` (`tailwind.config.ts:25–27`), emitted at runtime by `next/font` | An unscoped reference assertion goes red on day one |
| Exactly two **colour** `var(--brand-*)` references live outside `brand.css`/`tailwind.config.ts`: `AdminPanel.tsx:399` (`--brand-beam`) and `(client)/admin/page.tsx:37` (`--brand-signal`) | Both name variables Child B retires; a file-scoped reference set cannot see them |
| `tailwind.config.ts:15–21` declares seven `brand.*` keys against the same variables; `:38` carries `rgba(0, 0, 0, 0.1)` and sits **outside** the `app/**` glob | The declaration set is a union across two files, and `tailwind.config.ts` is a named out-of-glob input |
| `app/utils/emailShell.ts` carries **12** hex literals and is exempt by design (CLAUDE.md landmine: five failed attempts to hold a dark email palette against Outlook for Mac) | Must be classified `exempt`, never `B`/`C` |
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
| `app/utils/__tests__/__snapshots__/colour-inventory.json` *(new)* | — | The committed inventory |
| `app/utils/__tests__/brandCss.test.ts` *(new)* | — | Parses `brand.css` + `tailwind.config.ts`; reference integrity now, theme parity from Child D |
| `app/brand.css` | Dark-only tokens + 17 compositing classes | Gains `.light { color-scheme: light }` **after** `:root`. No other change |
| `app/utils/protectedReadAudit.ts` | Exports `stripComments` (`:415`); enforcement for service-readiness protected reads | **Possibly modified** — if `stripComments` is extracted to a shared `.mjs`, this file imports it instead. Its only consumer is `protectedReadAudit.test.ts`, so the blast radius is contained and test-covered |
| `docs/UTILITIES_AND_COMPONENTS.md` | Current record | Lists the new script and two guards |

**Trust boundary: untouched.** No route, no handler, no session read, no data access, no
network. The only runtime artifact is one CSS declaration that nothing currently activates.

## Ordered changes

### 1. The colour inventory script

- **Purpose:** replace hand-counting permanently. Three v23 hand-counts and two parent
  figures were each wrong; the parent's A1 declares every count in it provisional by
  construction.
- **Components:** `scripts/colour-inventory.mjs`, its snapshot, its guard.
- **Glob:** `app/**/*.{tsx,ts,mjs,css}` minus `__tests__`. **Named out-of-glob input:**
  `tailwind.config.ts`, which carries `rgba(0, 0, 0, 0.1)` at `:38` and the seven `brand.*`
  colour keys — record it explicitly rather than leaving "authoritative" overstated.
- **Categories.** Bracketed hex; bare hex; raw palette classes; `white`/`black`;
  `rgb()`/`rgba()`/`hsl()` literals; **colour inside arbitrary values with no `#`** (e.g.
  `shadow-[0_0_0_1px_rgb(0_191_255/0.45)]`); inline styles; SVG attributes; runtime colour
  maps; the retired `brand-<colour>` keys; `.tsx`/`.ts` arbitrary values referencing
  `var(--brand-*)`; **bare RGB triplets in CSS custom properties** — without which the
  inventory omits the seven colour values in the token file itself; and, thirteenth,
  **`.brand-*` compositing-class occurrences**.
- **The thirteenth category, and the trap it must not fall into.** The twelve categories above
  are all *colour-literal* categories, and the compositing classes are not literals — so
  without this category the parent's **17 classes across 33 selector occurrences** go
  unmeasured, even though parent §5 puts them in scope and §12 assigns "33 `.brand-*` rule
  bodies" to Child B and "light counterparts for 17 `.brand-*` classes" to Child D. Those
  figures would then remain the hand-count that already moved from 16 to 17 during review —
  in a plan whose stated purpose is to replace hand-counting permanently.
  **Match the compositing classes by their `.brand-<component>` selector and `className`
  occurrences, never by a loose `brand-` regex.** A loose match drags `brand-atmosphere` in as
  a migration target, and it sits on `<body>` in **both** root layouts
  (`(admin)/layout.tsx:42`, `(client)/layout.tsx:58`) — stripping it removes the app's entire
  body wash. This is the trap parent §9 names verbatim.
  **Disposition for this category is by content, not by name:**
  - a class whose rule bodies contain **no colour** → `exempt`, with the reason. Verified:
    `.brand-admin-frame` is the only such class today — `brand.css:308–312` declares
    `max-width` and two paddings, and its `className` use at `(client)/admin/page.tsx:22`
    carries no colour either;
  - the **33 rule bodies** → `B`, which rewrites them off the retired variables;
  - the **17 classes needing light counterparts** → `D`.
- **Three scanning rules, each of which has already caused a wrong count:**
  1. **Case-insensitive** — both `#010B17` and `#010b17` occur.
  2. **Never line-anchored** — `.brand-admin-frame` is indented and nested at `brand.css:308`;
     `^\.brand-` misses it, which is why the class count is 17 and not 16.
  3. **Strip comments** — `PlannerGrid.tsx:1497` names `#010b17` in prose. Reuse
     `stripComments` (`app/utils/protectedReadAudit.ts:415`) per parent §9. **Friction to
     resolve, not ignore:** the scanner is `.mjs` and `stripComments` is a `.ts` export, so a
     plain-node import is not direct. Either run the scanner through the TS pipeline, extract
     the helper to a shared `.mjs`, or record explicitly why a second implementation was
     unavoidable. Do not silently write a second one.
     **Grammar caveat, recorded:** `stripComments` implements a **JS/TS** comment grammar and
     the glob includes `.css`. `//` is not a CSS comment, so a future `url(https://…)` in a CSS
     file would be blanked to end-of-line. Verified safe today — `brand.css` and both
     `globals.css` contain zero `//` and zero `url(` — but either branch on file extension or
     record the limitation where the next person will find it.
- **Disposition per row: `B`, `C`, or `exempt`.** `exempt` rows carry a reason and the
  governing source. **Seed the parent's four exemptions before the first run:**
  `app/utils/emailShell.ts` (12 literals; the email palette is deliberately light);
  the Google mark in `app/(client)/auth/signin/page.tsx` (currently `:157–160`, a third-party
  mark that must not be themed); the static `themeColor` literal in `app/(client)/layout.tsx`
  (currently `:42`, which Child E makes theme-responsive); and `app/**/__tests__/**`. That last one is **excluded by the glob rather than seeded as a
  row** — the distinction matters, since a row must exist to be dispositioned. It is recorded
  here because Child B's codemod intersects its file set with `__tests__` so colliding
  assertions move with the code they assert.
- **Seed exemptions by file + value, never by line range.** The two site-specific exemptions
  above are cited with today's line numbers for a human reader, but the seed data must key on
  file + literal value — otherwise the exemption drifts off its rows on the next unrelated edit,
  which is the same defect the snapshot key exists to avoid.
- **Snapshot key: file + normalised utility + value multiset. Never line numbers.** Lines are
  emitted for humans and excluded from the assertion. A line-keyed snapshot turns `npm test`
  red on any unrelated commit that shifts a line in a colour-bearing file — in a tree that
  moves weekly — and a flapping guard gets deleted rather than fixed.
- **Failure and recovery:** an under-reporting glob makes Child B migrate by guesswork.
  Step 2's verification is the check. Over-reporting leaves dead rows — noisy, not dangerous.
- **Verification:** a **committed** unit test feeds the scanner a synthetic source string and
  asserts each category is detected — not a manual add-assert-revert, which leaves no artifact.
  This plan's own standard is that a guard nobody has seen fail is not a guard; that applies to
  the scanner as much as to the parity assertion. Two consecutive runs on an unchanged tree produce byte-identical
  output; if not, the key is unstable and this step is not done. `serviceCardModel.ts` and
  `brand-admin-frame` both appear. `PlannerGrid.tsx:1497` does **not**.
- **State after:** inventory committed. No behaviour change.

### 2. Reconcile against the parent

- **Purpose:** the parent's counts are provisional by its own A1. This is where generated
  figures supersede them.
- **Change:** a short committed note recording every divergence, including the one known
  wobble: the parent's §3 uses *sites* and *literals* inconsistently — `:60` calls 27 "sites"
  while `:64` calls the Google logo "one site but four literals". Under that wording the
  reachable-**site** count is 25 and the reachable-**literal** count is 22. **State which unit
  each figure uses**, and do not repeat the conflation the note exists to fix.
- **Verification:** committed beside the snapshot and cited by Child B's mapping table.
  **The inventory is authoritative; the parent's hand-counts are not.**
- **State after:** the parent's provisional figures superseded by generated ones.

### 3. Palette-family analysis and the token vocabulary

- **Purpose:** the vocabulary is an **output with acceptance criteria**, not an input. v23
  froze 34 roles and simultaneously called them "a floor" — a contradiction reviewers hit
  repeatedly.
- **Change:** run the "can the vocabulary represent these values" analysis over all eight
  raw-palette families *before* freezing anything. `gray` spans 7 shades and `red` 9. Produce
  the vocabulary as a reviewed artifact satisfying the parent's §8.1 criteria verbatim:
  - every (family, shade) pair represented, or each collapse recorded with its site count and
    a rationale;
  - three slots — foreground, surface, border — for every semantic state needing them
    (`DayCard.tsx:37–50` is the worked example: three literals for one state, per theme);
  - composed, alpha-baked tokens for pairs whose alpha differs per theme, because a
    theme-invariant opacity modifier cannot express "opaque navy in light, 20% cyan in dark";
  - **the naming rule, binding:** a token key may never begin with a utility prefix.
    `border-accent` compiles to `.border-border-accent`, while `.border-accent` silently
    resolves to the base `accent` role. This bit v23 twice and is invisible from the config.
  - **the storage convention stated once, explicitly.** `brand.css` already stores **triplets**
    (`--brand-frost: 215 231 246`) but **without** a `-rgb` suffix; the parent's D3 introduces
    that suffix. Say which form holds the triplet and which holds a complete colour, because
    Child B's prose mapping is correct only against a stated convention — and getting it
    backwards renders song lyrics unstyled with no build or lint signal.
- **Verification:** reviewed as an artifact before Child B begins. No code depends on it yet.
- **State after:** vocabulary agreed. Still no tokens in the codebase.

### 4. The `brand.css` guard — two assertions, one dormant

- **Purpose:** `brand.css` is the token file and sits outside every existing gate. Its failure
  mode is silent deletion of the body wash and every inset highlight.
- **(a) Reference integrity — ACTIVE NOW.** Every **colour** `var(--x)` referenced is declared.
  - **Reference set spans the inventory's glob** — `app/**/*.{tsx,ts,mjs,css}` plus
    `tailwind.config.ts` — **not** just the two token files. Verified: the only two colour
    references outside them are `AdminPanel.tsx:399` (`--brand-beam`) and
    `(client)/admin/page.tsx:37` (`--brand-signal`), both naming variables Child B retires.
    A file-scoped guard stays green because it never reads `.tsx`, the snapshot stays green
    because the class string is unchanged, and the inset glow and admin-tab ring vanish.
  - **Declaration set is the union** of `brand.css` and `tailwind.config.ts`. The latter
    declares seven `brand.*` keys against the same variables, with live consumers including
    `selection:bg-brand-beam/35` on both root layouts.
  - **Colour-scoped, and the mechanism is stated once here.** Classify *declared* variables by
    value shape, and treat an *undeclared* reference as a colour **unless it appears on a named
    non-colour exclusion list** — which today holds exactly the three `--font-*` names
    (`tailwind.config.ts:25–27`), emitted at runtime by `next/font` and declared in neither
    file. Do **not** scope by a `--brand-` prefix instead: that would make the prescribed
    `var(--nonexistent)` verification vacuous, since the scratch variable would fall outside
    the guard's attention entirely. An unscoped assertion is red on day one — this plan failing
    its own done-gate.
- **(b) Theme parity — AUTHORED, DORMANT.** Every **colour** `:root` custom property has a
  `.light` counterpart or sits on a reviewed theme-invariant allowlist, **and vice versa**.
  - **Self-activates on "`.light` declares ≥1 custom property." The trigger matches the
    selector form, so the selector form is binding on Child D:** if D hardens `.light` to
    `:root.light` or `html.light` for specificity, it must update the trigger in the same
    change, or the guard silently un-arms forever — the exact "green because it never runs"
    failure this plan names elsewhere. Step 5 adds only
    `color-scheme`, which is not a custom property, so the guard stays dormant through this
    plan and binds in Child D. Without that trigger it goes red against all 11 current `:root`
    properties the day it lands.
  - **Colour-scoped**, for the same reason as (a): four of the 11 properties are non-colour
    (`brand.css:10–13`; note `:9` is `--brand-steel`, a colour).
  - **The allowlist and the colour scope are one rule.** Because parity is colour-scoped, the
    four non-colour properties are already outside it, so the allowlist starts **empty** and
    exists only to hold a future colour property somebody argues is theme-invariant — a claim
    that must be reviewed, never assumed. **`--brand-signal` must never be allowlisted**: it is
    a colour that Child B retires, and allowlisting a colour as "theme-invariant" is precisely
    the drift class this guard exists to catch.
- **Placement:** under `app/utils/__tests__/`. Outside `vitest.config.ts:15`'s three roots a
  guard never matches and never runs.
- **Verification:** (a) fails against a scratch `var(--nonexistent)`. (b) is proven green today
  **and proven to fire**, by a unit test feeding it a synthetic `.light` block with one custom
  property and one missing counterpart. **A dormant guard nobody has seen fail is not a guard.**
- **State after:** the token file has enforcement for the first time.

### 5. `.light { color-scheme: light }`

- **Purpose:** `brand.css:2` hardcodes `:root { color-scheme: dark }` with no light branch.
  It is currently masked in the app by next-themes' `enableColorScheme` inline style — but
  **A2's gallery runs with no provider**, which removes that mask, and Child E needs the branch
  regardless.
- **Change:** add `.light { color-scheme: light; }`. **Nothing else in `brand.css` changes.**
- **It must be declared AFTER `:root`.** Both selectors have specificity (0,1,0), so the
  override is pure source order — and the parity guard checks presence, not order. A `.light`
  block placed above `:root` passes every gate and themes nothing.
- **Verification:** a test asserts both declarations exist **and that `.light` follows
  `:root`**. Do not rely on next-themes' inline style, and do not "clean it up" later.
- **State after:** `.light` exists holding one non-custom-property declaration, so the parity
  guard stays dormant. Inert until Child D.

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
| Inventory is complete | Guard fails on a literal introduced into a scratch file | An under-reporting glob — the defect that makes Child B migrate by guesswork |
| Inventory is stable | Two consecutive runs on an unchanged tree are byte-identical | An unstable key, which would make `npm test` flap |
| Snapshot is not line-keyed | An unrelated whitespace commit in a colour-bearing file leaves `npm test` green | The false-red that gets the guard deleted |
| Glob covers `.ts` | `serviceCardModel.ts` contributes its 56 matches | The `.tsx`-only glob trap |
| Scan is not line-anchored | `.brand-admin-frame` appears as an **`exempt`** row of the thirteenth category, and the class count is **17 / 33 occurrences**, not 16 | The line-anchored trap — and the 17/33 figures staying a hand-count |
| No loose `brand-` match | `brand-atmosphere` is **never** dispositioned `B` or `C` | Stripping the body wash off both root layouts |
| Comments are stripped | `PlannerGrid.tsx:1497` does **not** appear; `:1499` does | An invented colour decision |
| Triplets are captured | The seven `:root` colour values appear | The token file omitting itself from its own inventory |
| Exemptions survive | `emailShell.ts`, the Google mark and the static `themeColor` are `exempt`, not `B`/`C` | Child B tokenising the email palette — which `emailTemplateGallery.test.ts` cannot catch, since it asserts `bgcolor` presence but never that a colour is a literal |
| Reference integrity | Guard fails on a scratch `var(--nonexistent)`; green today | Child B's silent-drop rename failure |
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
- **Outputs promised:** **A2** consumes `.light { color-scheme }` and the vocabulary.
  **Child B** consumes the inventory **minus its `exempt` rows** as its mapping table, and the
  vocabulary as its target. **Child C** consumes the per-family analysis.
- **Adversarial review order:** this plan (**Standard** — one fresh cold `APPROVED`), then A2,
  then Child B.
- **Implementation authorization: not granted by this plan.**

## Terminal state

**`READY_FOR_ADVERSARIAL_REVIEW`**

Self-contained, with no unresolved blocking unknowns. **Review readiness is not approval, and
plan approval is not authorization to implement.** After implementation, a fresh code review
plus the documented test gates are required — plan review is not a substitute.
