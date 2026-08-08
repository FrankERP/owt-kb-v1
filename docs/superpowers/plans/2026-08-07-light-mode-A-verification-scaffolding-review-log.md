# Review log — Child A: light-mode verification scaffolding

**Artifact:** `2026-08-07-light-mode-A-verification-scaffolding.md`
**Loop status:** **CLOSED WITHOUT APPROVAL — superseded by a split into A1 and A2.**
**Date:** 2026-08-07 → 2026-08-08

Approval is not authorization to implement. No approval was obtained, so nothing here
authorizes anything. The successor plans carry their own reviews.

---

## Risk tier

**Critical for rounds 1–2, Standard from round 3.**

The Critical tier rested on the plan opening a new unauthenticated route past the `auth`
matcher exclusion. Round 2 established that its sole stated justification — "it needs no
matcher edit" — is equally true of a **gated** path (verified against the live matcher), so
it justified neither placement. The user chose gating on 2026-08-07, which removed the
trust-boundary change and everything attached to it: an env flag, a `docs/SECRETS.md` entry,
a build-time refusal, a `PUBLIC_ROUTES` entry, and a prerender-versus-runtime argument.

The tier change was **derived**, not asserted, and was propagated to the parent rather than
declared inside the child (see round 3).

## Rounds

| Round | Digest | Commit | Tier | Verdict | Blockers |
|---|---|---|---|---|---:|
| 1 | `ca17e155…` | `4f767e4` | Critical | `CHANGES_REQUIRED` | 2 |
| 2 | `ca5852b0…` | `0780eb2` | Critical | `CHANGES_REQUIRED` | 2 |
| — | *churn cap → user decision → gated placement* | `89f470f` | — | — | — |
| 3 | `53a0d9ad…` | `89f470f` | Standard | `CHANGES_REQUIRED` | 2 |
| 4 | `8a6b2ab9…` | `a44d937` | Standard | `CHANGES_REQUIRED` | 3 |
| — | *churn cap → user chose one more round* | — | — | — | — |
| 5 | `e5f3bab6…` | `03fc6e4` | Standard | `CHANGES_REQUIRED` | 1 |
| — | *user chose one more round; "if round 6 fails, split without asking"* | — | — | — | — |
| 6 | `fdf8b12e…` | `a2394a8` | Standard | `CHANGES_REQUIRED` | 1 |

Six freshly spawned `skeptical-reviewer` instances, run strictly one at a time, each given
only the reviewer brief, an immutable snapshot and digest, the repository pointer and the
original requirement. None saw another's findings, the ledger, the round count, or any
rebuttal. Byte identity was verified before every round.

**The churn cap was honoured twice.** After rounds 2 and 4 the loop stopped and the
continue-or-stop call went to the user, as the cap requires. It was reached a third time at
round 6, and the pre-agreed consequence — split — was applied without further asking.

## Blockers by round

**Round 1.** (a) The inventory classified every row as `B` or `C` with no third value, while
the plan declared it authoritative and made it Child B's mapping table — so the parent's four
reviewed exemptions (`emailShell.ts`'s 12 hex literals, the Google mark, the static
`themeColor`) would have been erased. Verified: `emailTemplateGallery.test.ts` asserts
`bgcolor` presence and structural CSS absence but never that a colour is a *literal*, so a
tokenised `bgcolor` passes every gate and breaks the team's real notification emails.
(b) The `brand.css` guard read references from only two files while insisting the
*declaration* set be a union; two live colour references sit outside both
(`AdminPanel.tsx:399`, `(client)/admin/page.tsx:37`) and name variables Child B retires.
Both `fixed`.

**Round 2.** (a) The `/auth/` placement's sole justification did not discriminate against the
gated alternative — `/theme-gallery/dark` is gated and also needs no matcher edit.
(b) A false mechanism inside the Critical-tier security argument: the plan specified a
maximally static page and then credited a runtime env-flag check the prerender path cannot
produce. The repo's own precedent (`identity/route.ts:39`) forces `force-dynamic` precisely
to make such a check real. **Resolved by the user's gating decision**, which deleted the
mechanism rather than patching it.

**Round 3.** (a) The child silently orphaned three rows of its approved parent and downgraded
a tier the parent assigned — while its own step 7 legislates "stop, propagate, treat the
parent's approval as stale". Applying its own rule to itself, the parent was amended and
re-reviewed. (b) Production reachability was stated three mutually exclusive ways, with
residue from the env-flagged revision including an assumptions row about a `PUBLIC_ROUTES`
entry the plan no longer adds. Both `fixed`.

**Round 4.** (a) The gallery excluded "stateful admin panels throughout", foreclosing the one
host Child D needs — but `PlannerGrid` has **zero** `fetch`/`useSession`/`next-auth`
references and its own test renders it with no providers, so the premise was false for it.
(b) The trust-boundary paragraph repeated a disabled-member claim the parent explicitly
corrects, and §5 simultaneously asserted the opposite trust level. (c) "No new env var" was
unqualified while step 6 requires a headless login against a real password form. All `fixed`.

**Round 5.** `fullScreen` is not a prop on `PlannerGrid` — it is `useState(false)` at `:553`,
entered only via the toggle at `:1823`, exactly as the repo's tests do it. The plan's
"host it in `fullScreen` mode from a static props fixture" described something impossible,
and a static render never reaches `createPortal(surface, document.body)` at `:2008`. `fixed`.

**Round 6 — the finding that ended the loop.** The gallery's single page per theme cannot
simultaneously host the swatch inventory, an open `CueDialog` and a full-screen
`PlannerGrid`; they occlude one another, and no stated assertion can see it. Verified in
full:

- `PlannerGrid.tsx:1769` is `fixed inset-0 z-50 … bg-[#010b17]` — an **opaque** full-viewport
  overlay portalled to `document.body`, covering every swatch.
- It sets `document.body.style.overflow = "hidden"` and `inert` on body children, so the
  swatch tree is inert and a `fullPage` capture degrades to one viewport.
- `CueDialog.tsx:235` is `fixed inset-0 z-[90]` with `:244` `bg-black/68 backdrop-blur-md` —
  above the planner's `z-50`, painting a blurred sheet over it.
- `CueDialogProvider.tsx:86–89` sets `root.inert = true` on the wrapper containing `children`,
  which holds the "⛶ Pantalla completa" button — so with a dialog already open, the plan's own
  activation path is blocked for a Playwright harness.

The plan's assertion ("a portal node exists under `document.body`") passes in every broken
arrangement. `not fixed — superseded by the split.`

## Non-blocking items adopted

Across six rounds, roughly thirty. The ones that changed the plan materially: the `exempt`
disposition on inventory rows; comment handling via the repo's existing `stripComments`;
the `.light` source-order assertion (equal specificity makes order the whole override);
`docs/ROUTES.md` prose *and* row, with an **Access** column rather than a "Public" one;
snapshot regeneration after the gallery page lands; the VR `testDir` under `e2e/` because
`rules-of-hooks` is disabled only there; ADR-0015 for the root layout at a dynamic segment;
and the credential obligation with its bounded manual-baseline default.

## Non-blocking items deliberately not adopted

- **"Six admin panels mount `CueDialog`" — REFUTED.** Five do. `MonthGenerator` references it
  only in comments explaining that it moved *out* of `CueDialog` into a full-width panel.
- **"`text-white`/`bg-black` is 43" — REFUTED** (parent round 2). Measured 45.
- **"`eslint.config.mjs`'s `e2e` key is at `:41`" — REFUTED** (parent round 2). It is `:42`.

## Author process failures

Recorded because a log listing only reviewer findings hides the half most worth keeping.

- **The sharpest:** the "four shared `.brand-*` classes" figure came from a grep confined to
  the admin directories — precisely the file-scoped-grep error the artifact's own §9 warns
  about. The author committed, in the same document, the mistake it inherited a warning about.
- The plan asserted a `not-found.tsx` was required to avoid a missing-`<html>` 404. A reviewer
  **built a scratch `next@16.2.12` app** and disproved it: the built-in `/_not-found` serves a
  complete `<body>` in both `next start` and `next dev`, and the co-located file's markup never
  appears. A plausible-but-false mechanism, of exactly the class the plan warns against.
- The plan overrode its parent's tier from inside a child, contradicting its own step 7.
- Two sentences lost text during a revision and shipped as fragments into round 6.
- Step 1b spent two rounds correcting a parent sentence that no longer existed.

## Disposition

**Split into two successor plans, per the user's pre-agreed rule.**

Round 6's blocker is a *composition* failure — three rendering fixtures that cannot share a
surface — and it surfaced only after five rounds spent on measurement concerns. That is the
signature of one artifact carrying two separable outcomes, and it is the same diagnosis that
fixed the parent.

- **A1 — measurement.** Inventory script, snapshot guard, reconciliation, palette-family
  analysis and the token vocabulary, `brand.css` reference-integrity and theme-parity guards,
  `.light { color-scheme }`. No rendering, no route.
- **A2 — rendering.** The gallery route and its composition (the round-6 blocker is A2's
  first design problem, not an afterthought), fixture hosting for `CueDialog` and
  `PlannerGrid` full screen, the read-only VR harness and its credential question, the
  `redesign/explore` polarity review, and the AA gate's inputs.

Everything verified across these six rounds carries forward into the successors; the evidence
was expensive and none of it is discarded.

## Guarantees

- Reviewer freshness: **satisfied.** Six independently spawned reviewers, sequential, cold.
- Byte identity: **satisfied.** Verified before every round; no mid-round edits.
- Approval requirement: **not met.** No `APPROVED` verdict at any digest.
- Churn cap: **honoured.** Stopped at rounds 2 and 4 for the user's call; at round 6 the
  pre-agreed split was applied.
