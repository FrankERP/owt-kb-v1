# Review log — Light mode via role-based design tokens (parent scope spec)

**Artifact:** `2026-08-07-light-mode-member-first-scope.md`
**Loop status:** **APPROVED** at digest
`4fbc41c4c1bed034b16547d343c24948a9ac639ecd0c4282460e7f25193a8140` (commit `477399c`).
**Date:** 2026-08-07

**Approval is not authorization to implement.** It authorizes writing the child plans, each
of which is reviewed separately before any code is written.

---

## Risk tier

**Standard — one fresh cold `APPROVED`.** Derived from the ladder, not a judgment call.

CLAUDE.md holds that parent roadmaps stay standard *unless they directly own a critical
contract*. This parent states requirements and assigns them; the critical contracts belong
to Children A (opens an unauthenticated route past the `auth` matcher exclusion) and E
(schema migration, production write route, irreversible Studio schema deploy), which carry
the Critical tier themselves.

**Author process failure:** the artifact was first written declaring itself **Critical**,
which is not what the ladder gives for a parent roadmap. Corrected before round 1 in
`9236135`. Had it stood, the loop would have spent an extra full round on the artifact least
able to lose data.

## Rounds

Four rounds, four independently spawned `skeptical-reviewer` instances, run strictly one at a
time. No reviewer saw another's findings, the ledger, the round count, or any rebuttal.

| Round | Digest reviewed | Commit | Verdict | Streak |
|---|---|---|---|---|
| 1 | `f9f5bc0c…4570` | `9236135` | `CHANGES_REQUIRED` | 0 |
| 2 | `b377cf26…9b17` | `d7b14a5` | `CHANGES_REQUIRED` | 0 |
| — | *churn cap; scope re-decided by the user; artifact re-architected* | `baadbea` | — | 0 |
| 3 | `7626bc2f…9457` | `baadbea` | `CHANGES_REQUIRED` | 0 |
| 4 | `4fbc41c4…8140` | `477399c` | **`APPROVED`** | **1** |

Byte identity verified at round 4: the recorded round digest, the post-verdict snapshot and
the current canonical file are all `4fbc41c4…8140`, confirmed by `diff`. No edit was made
mid-round in any round.

### The churn cap, and why the loop continued past it

Rounds 1 and 2 were two substantive `CHANGES_REQUIRED` rounds, which reached the cap. **Round
3 was not started.** The loop stopped and the question went to the user, as the cap requires —
the continue-or-stop call is theirs, and telling them afterwards is too late.

Both rounds' blockers had landed on the same component: the mechanism holding deferred admin
screens dark inside a light document. That is not a converging blocker count; it is a
mechanism leaking somewhere new each time it is examined. The user reversed the scope
decision (§4.1 of the artifact), which **deleted the mechanism entirely**.

Rounds 3 and 4 therefore reviewed a materially different artifact — different scope,
different invariants, no containment mechanism at all — and the cap was counted afresh
against it. Round 3's blockers were orthogonal to rounds 1–2 (provider configuration, ISR),
which is the signature of genuine convergence rather than churn.

## Round 1 — blockers

**B1.1 — The `/admin` dark pin specified one cascade channel of three. `fixed`, later moot.**

Verified independently, not accepted on the reviewer's word: 121 `dark:` occurrences across
13 deferred admin files with `tailwind.config.ts:10` `darkMode: "class"`; the cited failures
exact at `AdminPanel.tsx:315` and `:409`; four shared `.brand-*` classes present in admin
files; translucency `0.44`–`0.72` in `brand.css` compositing against
`app/(client)/layout.tsx:57–61`.

**B1.2 — The pin's proof was assigned to a phase where it cannot fail. `fixed`, later moot.**

At Child C's end state `forcedTheme="dark"` is still in force and `.light` holds no values,
so a light-mode render test there resolves every token to its `:root` dark value and passes
vacuously.

### Round 1 — non-blocking

| Item | Disposition | Evidence checked |
|---|---|---|
| "The nine densest files are admin panels" is false | **adopted** | 7 of 9 are admin. `ProposalEditor.tsx` (139) is the second-densest file in the repo. |
| `(admin)/layout.tsx` counted in two mutually exclusive buckets | **adopted** | Confirmed at 3 decisions. |
| `(admin)/layout.tsx` token migration had no owner | **adopted** | B retires the `brand.*` keys `:42` consumes; assigned to B. |
| A 17th `.brand-*` class exists | **adopted** | `brand-admin-frame` at `brand.css:308`, indented and nested. |
| `@capacitor/status-bar` is not a dependency | **adopted** | Absent from `package.json`; assumption A6 added with a fallback. |
| Lint carve-out has no stated mechanism | **adopted** | `app/components/admin/**` is inside `app/**`. |

## Round 2 — blockers

**B2.1 — A fourth cascade channel: portal escape to `document.body`. `moot by re-architecture`.**

Verified: `CueDialogProvider.tsx:62–64` `document.body.appendChild(node)`; `CueDialog.tsx:230`
`createPortal`; `PlannerGrid.tsx:2008` `return fullScreen ? createPortal(surface,
document.body) : surface;`; five deferred admin panels mount `CueDialog`. Portaled content is
a child of `<body>`, so **all three channels of the round-1 fix fail there simultaneously**.

This finding is what ended the member-first scope. It is preserved in the artifact at §4.1 as
the recorded reason, and at §4.4 as a standing verification requirement.

**B2.2 — The shared `.brand-*` set was under-counted. `moot by re-architecture`.**

`brand-facet-panel` is a fifth shared class, reaching `/admin` via `DayCard`
(`MonthGenerator.tsx:5`) and `CueDialog`.

**Author process failure, and the sharpest of the loop:** the "four shared classes" figure
came from a grep confined to the admin directories — precisely the file-scoped-grep error the
artifact's own §9 warns about for the `brand.*` rename. The author committed, in the same
document, the mistake it inherited a warning about.

### Round 2 — non-blocking

| Item | Disposition | Evidence checked |
|---|---|---|
| D13's decision-table wording stated the mechanism §4.2 refutes | **moot** | D13 was rewritten to "no pinned surface". |
| Two different guards share one name | **adopted** | Split into reference-integrity and colour-scoped theme-parity. Four of 11 `:root` properties are non-colour, so an unscoped parity check would demand a nonsense `.light --brand-radius-panel`. |
| `.brand-*` selector occurrences are 33, not 35 | **adopted** | The author's 35 counted two comment-line mentions at `brand.css:265,269`. |
| `text-white`/`bg-black` is 43, not 45 | **REFUTED** | Measured 45: `bg-white` 16, `text-white` 12, `bg-black` 7, `text-black` 5, `shadow-black` 2, `border-white` 2, `border-black` 1. |
| `eslint.config.mjs`'s `files: ["e2e/**"]` is at `:41` | **REFUTED** | `sed -n '40,43p'` puts it on line **42**. The document was correct. |
| Inventory glob is `.tsx`-only, missing `serviceCardModel.ts` | **adopted** | 56 colour matches in that `.ts` file. |
| §5 mislabels `Info.plist:57–58` as a launch colour | **adopted** | They are `UIStatusBarStyle` / `UIStatusBarStyleLightContent`. |
| `SongSheet` mounted globally, renders on `/admin` | **moot** | No pinned surface remains. |

## Round 3 — blockers

**B3.1 — The provider's unset default is `"light"`, and `defaultTheme`/`enableSystem` had no
owner. `fixed`.**

The most consequential finding of the loop. Verified in `node_modules/next-themes/dist/`:
`defaultTheme: l = s ? "system" : "light"`, and `Provider.tsx:16` passes `enableSystem={false}`
with **no `defaultTheme`**. Seeding is `localStorage.getItem(key) || defaultTheme`, so an unset
member resolves to `"light"`.

Child E's specified action was "remove `forcedTheme`", framed as one line. That would have
shipped **unset → Light**, inverting D4, D8 and Child E's own declared safe end state, and
bypassing Child F's staged rollout entirely.

**The artifact asserted the opposite as a verified §9 finding** — that `useTheme().theme`
returns `"dark"` for an unset member. The seeding half was right and the value was wrong: the
exact "correct conclusion via a false reason" pattern §9 exists to warn about, inherited
uncritically from v23.

Separately verified: with `enableSystem` false, `themes` is `["light","dark"]`, `"system"` is
never offered, and applying it runs `classList.add("system")` after stripping `light`/`dark` —
no theme class, no error. Child F's outcome was unreachable.

Fixed by giving `defaultTheme` an explicit owner and required value (Child E, `"dark"`),
assigning `enableSystem` to Child F, and rewriting the §9 bullet.

**B3.2 — Theme-responsive `themeColor` was in scope with no caching constraint. `fixed`.**

Verified: nine `(client)` pages export `revalidate`, and `app/(client)/layout.tsx` reads no
session, cookies or headers — which is what keeps `/`, `/schedule`, `/posts/[slug]`, `/tag`
and `/author` statically rendered. The native mechanism (`generateViewport()` reading the
session) would opt the whole segment into dynamic rendering. The words `cache`, `revalidate`
and `ISR` appeared **zero times** in the artifact, despite ADR-0007 forbidding exactly this
trade and §6 listing invariants the work does not even touch.

Fixed by adding invariant 17 with all nine cited `revalidate` sites, and constraining the
requirement to a client-side `<meta name="theme-color">` update — or leaving it static and
recording it as a remnant.

### Round 3 — non-blocking

| Item | Disposition | Evidence checked |
|---|---|---|
| Non-colour `:root` properties are at `brand.css:10–13`, not `9–12` | **adopted** | `:9` is `--brand-steel`, a colour. An allowlist built from the wrong range would have exempted it. |
| `.github/workflows/` holds two files, not one | **adopted** | `flush-notifications.yml`, `smtp-probe.yml`; neither has a `push`/`pull_request` trigger, so the conclusion held. |
| `serviceCardModel.ts` has seven `.tsx` importers, not six | **adopted** | Counted. |
| `(admin)` chrome cannot follow the theme until E | **adopted** | `forcedTheme` is removed at E; D's end state is explicitly unreachable. |
| Prose mapping depends on the token storage convention | **adopted** | Under D3's triplet convention the correct form is `rgb(var(--ink-rgb))`; v23 prescribed the inverse. |
| 25 of 27 bare-hex sites are reachable by CSS vars | **adopted** | Calling the bucket unreachable would have bought a runtime mechanism nothing needs. |
| `appleWebApp.statusBarStyle` in neither scope list | **adopted** | Static `"black-translucent"` on both root layouts. |

## Round 4 — `APPROVED`

No blocking issues. The reviewer re-derived every inventory count independently, sampled
~40 `file:line` citations, and verified the `next-themes` source claims directly — all exact.

It also chased and **refuted two candidate blockers of its own**, which is worth recording as
evidence the approval was not passive: both `globals.css` files carry no colour, so their
absence from §5 "In" is correct; and `app/api/admin/members/[id]/route.ts:48–71` is a
field-whitelist patch, so a new `themePref` field cannot be clobbered by an admin edit —
invariant 13 is a UI rule, not a data-safety hole.

### Round 4 — non-blocking, carried forward (deliberately **not** applied)

These were left unapplied to preserve the approved digest. A1 already declares every
hand-count in the artifact provisional pending Child A's generated inventory, which is the
mechanism that resolves the first two.

| Item | Carried to |
|---|---|
| §3's "25 of them" should be 22 (27 − 4 Google literals − 1 `themeColor`); the list also omits `ServiceReadinessCard.tsx:723` and `PlannerGrid.tsx:1497` | Child A |
| §9's `setTheme(undefined)` note reaches the right conclusion by a slightly wrong path — the apply callback has `if(!c)return`, so `classList.add("undefined")` lands on the *next* load via the inline seed script | Child E |
| Child B's row says both "byte-identical" and "visually identical except the enumerated normalisations"; D6's `#12C8F4` → `#00bfff` retirement should be named as *the* normalisation and the equality gate scoped around it | Child B |
| The Child A gallery has no provider, so a surviving `dark:` variant renders its light-intended base there — a false-confidence trap during A's bring-up | Child A |
| `tailwind.config.ts:38` carries `rgba(0, 0, 0, 0.1)` but sits outside the lint rule's `files: ["app/**"]` block, so only §8.3 item 4 catches it | Child C |
| §8's tier rationale decides the gallery is unauthenticated without recording why a gated gallery was rejected | Child A |

## Other author process failures

- A stray non-ASCII token (`背景`) was introduced into §4.2 during a round-1 edit and caught by
  the author's own post-edit scan before the round-2 snapshot was cut.
- Three stale figures survived the first pass of round-1 fixes and needed a second sweep.
- The round-1 artifact asserted "the nine densest files are admin panels" when the author's own
  measurement, taken minutes earlier, showed seven of nine. Data in hand, overstated anyway.

## Post-approval changes

**One, disclosed:** the artifact's `**Status:**` line was updated from "Draft — not approved"
to record the approval and its digest. This is metadata, not a requirement, and no other byte
changed. The approved content digest above remains the authoritative reference; anything
beyond that line falls outside this approval.

## Guarantees

- Reviewer freshness: **satisfied.** Four independently spawned reviewers, sequential, cold.
- Byte identity: **satisfied.** Verified at every round; confirmed by `diff` at round 4.
- Approval requirement: **satisfied.** Standard tier, one fresh cold `APPROVED`.
- Churn cap: **honoured.** The loop stopped at the cap and the scope decision went to the user
  before any further round was started.
