# Review log — Light mode, member surface first (parent scope spec)

**Artifact:** `2026-08-07-light-mode-member-first-scope.md`
**Loop status:** **STOPPED AT THE CHURN CAP — not approved.**
**Date:** 2026-08-07

Approval is **not** authorization to implement. No approval was obtained, so nothing here
authorizes anything.

---

## Risk tier

**Standard — one fresh cold `APPROVED`.** Derived from the ladder, not a judgment call.

CLAUDE.md holds that parent roadmaps stay standard *unless they directly own a critical
contract*. This parent states requirements and assigns them; the critical contracts belong
to children A (opens an unauthenticated route past the `auth` matcher exclusion) and E
(schema migration, production write route, Studio schema deploy).

**Author process failure:** the artifact was first written declaring itself **Critical**,
which is not what the ladder gives for a parent roadmap. Corrected before round 1 in commit
`9236135`. Had it stood, the loop would have spent a second full round on the artifact least
able to lose data.

## Rounds

| Round | Digest reviewed | Commit | Verdict | Streak |
|---|---|---|---|---|
| 1 | `f9f5bc0c1259aa5c99cf0e33fd491c2fb755f196d8a4ffee2ad19f776ea64570` | `9236135` | `CHANGES_REQUIRED` | 0 |
| 2 | `b377cf26a9f215613d696a2210d2a4b76f91a7547f2836341c00b4defe949b17` | `d7b14a5` | `CHANGES_REQUIRED` | 0 |

Both reviewers were freshly spawned `skeptical-reviewer` instances, run one at a time, given
only the reviewer brief, the immutable snapshot path and digest, the repository pointer, and
the original requirement. Neither saw the other's findings, the ledger, the round count, or
any rebuttal.

**Two substantive `CHANGES_REQUIRED` rounds reached the churn cap. Round 3 was not started.**
The cap exists so the continue-or-stop call belongs to the user, and telling them afterwards
is too late.

## Round 1 — blockers

**B1.1 — The `/admin` dark pin specified one cascade channel of three. `fixed`.**

Evidence checked independently, not accepted on the reviewer's word:

- Channel 1: `find` over the deferred admin files gives **121 `dark:` occurrences across 13
  files**; `tailwind.config.ts:10` is `darkMode: "class"`. Cited failures read exactly as
  quoted — `AdminPanel.tsx:315` `bg-[#003572] dark:bg-[#00bfff]/20`, `:409`
  `from-[#C8D8EB] dark:from-[#010b17]`.
- Channel 2: `brand-surface`, `brand-search-console`, `brand-section-heading`,
  `brand-member-row` confirmed present in admin files.
- Channel 3: translucency confirmed in `brand.css` (`0.44`–`0.72`); backdrop confirmed at
  `app/(client)/layout.tsx:57–61` (`brand-atmosphere bg-brand-blackout`), structurally
  outside any wrapper in the subtree.

Fixed by rewriting §4.2 to name all three channels and prescribe a mechanism for each.
**This fix was itself found insufficient in round 2 — see B2.1.**

**B1.2 — The pin's proof was assigned to a phase where it cannot fail. `fixed`.**

Verified against the document's own §8 sequencing: at Child C's end state `forcedTheme="dark"`
is still in force (removed at E) and `.light` holds no values (authored at D). A light-mode
render test at C therefore resolves every token to its `:root` dark value and passes
vacuously. Executable proof moved to Child D and added to D's acceptance contract.

### Round 1 — non-blocking

| Item | Disposition | Evidence checked |
|---|---|---|
| "The nine densest files are admin panels" is false | **adopted** | 7 of 9 are admin. `ProposalEditor.tsx` (139) is the second-densest file in the repo and is in scope; `AvailabilityCalendar.tsx` (96) is seventh. |
| `(admin)/layout.tsx` counted in two mutually exclusive buckets | **adopted** | Confirmed at 3 decisions; deferred set corrected to 17 files / 1,306 decisions. |
| `(admin)/layout.tsx` token migration had no owner | **adopted** | B retires the `brand.*` keys that `:42` consumes; assigned to B explicitly. |
| A 17th `.brand-*` class exists | **adopted** | `brand-admin-frame` at `brand.css:308`, indented and nested, missed by a line-anchored scan. |
| `@capacitor/status-bar` is not a dependency | **adopted** | Absent from `package.json`; assumption A6 added with a fallback. |
| Lint carve-out has no stated mechanism | **adopted** | `app/components/admin/**` is inside `app/**`; an explicit `ignores` list is required. |

## Round 2 — blockers (verified, **not yet fixed**)

Fixes were deliberately **not** applied, because the reassessment below may make the
mechanism they would patch unnecessary. Applying them first would be work spent defending an
architecture that is itself in question.

**B2.1 — A fourth cascade channel: portal escape to `document.body`. `verified, unfixed`.**

Independently confirmed against source:

- `app/components/ui/CueDialogProvider.tsx:62–64` — `document.createElement("div")` then
  `document.body.appendChild(node)`.
- `app/components/ui/CueDialog.tsx:230` — `createPortal(...)` into that node.
- `app/components/admin/PlannerGrid.tsx:2008` — `return fullScreen ? createPortal(surface,
  document.body) : surface;`
- Five deferred admin panels mount `CueDialog`: `ServicesPanel`, `SetlistEditor`,
  `PlannerGrid`, `ContentPanel`, `AdminPanel`.

Portaled content is a child of `<body>`, not a descendant of any wrapper inside the `/admin`
route, so **all three channels of the round-1 fix fail there simultaneously**. §8.3 item 5
is unachievable as specified, and a test written against the static panel passes while every
admin dialog is broken.

**B2.2 — The shared `.brand-*` set was under-counted. `verified, unfixed`.**

`brand-facet-panel` is a fifth shared class. Confirmed consumers: `DayCard.tsx`,
`TagSearchList.tsx`, `ui/CueDialog.tsx`, `(client)/posts/[slug]/page.tsx`,
`(client)/auth/signin/page.tsx`. It reaches `/admin` through `DayCard`
(`MonthGenerator.tsx:5` imports it) and through `CueDialog`.

**Author process failure, and the sharpest one in this loop:** the "four shared classes"
figure came from a grep confined to the admin directories. That is precisely the
file-scoped-grep error the artifact's own §9 warns about for the `brand.*` rename — the
author committed, in the same document, the mistake it inherited a warning about.

### Round 2 — non-blocking

| Item | Disposition | Evidence checked |
|---|---|---|
| D13's decision-table wording states the mechanism §4.2 refutes | **to adopt** | §7 still reads "via a wrapper that re-declares dark token values"; a child reading the table builds the wrong pin. |
| Two different guards share one name (`:root` property parity vs referenced-`var()` declaration) | **to adopt** | Four of the 11 `:root` properties are non-colour (`brand.css:9–12`), so the §4.2a reading demands a nonsense `.light --brand-radius-panel`. |
| `.brand-*` selector occurrences are 33, not 35 | **adopt** | Verified: the author's 35 counted two comment-line mentions at `brand.css:265,269`. |
| `text-white`/`bg-black` is 43, not 45 | **REFUTED** | Measured 45: `bg-white` 16, `text-white` 12, `bg-black` 7, `text-black` 5, `shadow-black` 2, `border-white` 2, `border-black` 1. The 1,306 / 1,091 split stands. |
| `eslint.config.mjs`'s `files: ["e2e/**"]` is at `:41`, not `:42` | **REFUTED** | `sed -n '40,43p'` puts `files: ["e2e/**"],` on line **42**. The document is correct. |
| Inventory glob is `.tsx`-only and misses `serviceCardModel.ts` | **to adopt** | 56 colour matches in that `.ts` file. Deferred set, so the split is unaffected, but Child A's glob must cover `.ts` or record the exclusion. |
| §5 mislabels `Info.plist:57–58` as a "native launch colour" | **to adopt** | Those lines are `UIStatusBarStyle` / `UIStatusBarStyleLightContent` — the runtime status-bar style A6's plugin overrides. |
| `SongSheet` is mounted globally at `(client)/layout.tsx:73` and renders while on `/admin` | **to adopt** | Confirmed. Same structural class as B2.1 and currently unaddressed. |

## Other author process failures

- A stray non-ASCII token (`背景`) was introduced into §4.2 during a round-1 edit and caught
  by the author's own post-edit scan before the round-2 snapshot. Recorded because a review
  log that lists only reviewer findings hides the half of the record most worth keeping.
- Three stale figures (`1,309`, `18 admin panel files`, `16 .brand-*`) survived the first
  pass of round-1 fixes and needed a second sweep before the round-2 snapshot was cut.

## Stop condition

**Churn cap reached: two substantive `CHANGES_REQUIRED` rounds on one artifact.**

Both rounds' blockers landed on the same component — the `/admin` dark pin. Round 1 found it
covered one channel of three; round 2 found a fourth channel that defeats all three at once.
The pattern is not a converging blocker count, it is a mechanism that leaks somewhere new
each time it is examined, because "pin a subtree dark inside a light document" is fighting
the DOM: any component that portals to `document.body` escapes it by construction, and
nothing prevents the next one from being added.

The pin exists **only** because the admin surface is deferred (D12). The scope decision and
the defect are the same decision.

Reassessment is therefore an architecture and scope question for the user, not another
review round. Escalated 2026-08-07.

## Guarantees

- Reviewer freshness: **satisfied.** Two independently spawned reviewers, sequential, cold.
- Byte identity: **satisfied.** Canonical and snapshot digests verified equal before each
  round; no edits were made mid-round.
- Approval requirement: **not met.** No `APPROVED` verdict was obtained at any digest.
