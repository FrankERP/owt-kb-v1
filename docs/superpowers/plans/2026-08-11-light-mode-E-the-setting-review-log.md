# Review log — Child E: Light mode, the setting

**Artifact:** `2026-08-11-light-mode-E-the-setting.md`
**Risk tier:** CRITICAL — two sequential fresh `APPROVED` verdicts on byte-identical text.
**Outcome:** APPROVED at rounds 18 and 19, both on `5c0cb2b92b83877635cabfde602d28d499f677e830c6e1cf9a79277bfc40b88f`.
**Rounds:** 19. Written after the loop; never shown to a reviewer.

## What the rounds actually found

| Round | Verdict | The finding that mattered |
|---|---|---|
| 1–3 | CHANGES_REQUIRED | Shape: the write route had no read path, so "follows the member across devices" was unimplementable |
| 4 | CHANGES_REQUIRED | `setTheme` has no falsy guard — an unset member would land in a themeless document |
| 5 | CHANGES_REQUIRED | The reconciliation ran after next-themes' seed, so it repainted nothing; E3 shipped a live but inert `/me` control |
| 6 | CHANGES_REQUIRED | My round-5 read isolation made the stop-impersonation clear dead work *and* argument-less |
| 7 | CHANGES_REQUIRED | Two round-6 corrections reached one section and not their twins; "fire-and-forget" recreated a terminal state |
| 8 | CHANGES_REQUIRED | Binding the control to the resolved theme erased invariant 14's third state; `statusBarStyle` is geometry, not colour |
| 9 | CHANGES_REQUIRED | A cost note instructed narrowing a shared documented route; ADR-0008 was never mentioned |
| 10 | CHANGES_REQUIRED | The ship table still ordered the swap the body forbids; supersession was taken from Child F |
| — | — | **Consolidating rewrite.** 725 → 608 lines, correction archaeology removed |
| 11 | CHANGES_REQUIRED | `forcedTheme` does not reach `resolvedTheme`, so E3 was not inert |
| 12 | CHANGES_REQUIRED | Round 11's fix covered the mirror-less member, not the one holding a mirror |
| 13 | CHANGES_REQUIRED | The multi-tab writeback is `"light"` at the E3 boundary, and a one-shot flag made it permanent |
| 14 | CHANGES_REQUIRED | `CLAUDE.md:8` "Dark-mode only." — a stale claim a `forcedTheme` grep cannot find |
| 15 | CHANGES_REQUIRED | Two more stale claims; the sweep became a stated command instead of a list |
| 16 | **APPROVED** | Flagged the unguarded `localStorage` as non-blocking |
| 17 | CHANGES_REQUIRED | Blocked on that same access: a throw in `clearThemeMirror()` kills the sign-out handler |
| 18 | **APPROVED** | — |
| 19 | **APPROVED** | Same bytes. Bar met. |

## The lesson worth keeping

**Rounds 6–10 were one defect, not five.** Each round I fixed the instance a reviewer
quoted and left its twin standing elsewhere in a 725-line document layered with "an earlier
revision said X, which was wrong because Y". Reviewers correctly kept finding the twins.
That is the same shape Child B's rounds 6–8 had, and I had already written the lesson down:
*when consecutive rounds find the same class of defect, the defect is the method.*

The consolidating rewrite — every decision stated once, correction history dropped to the
commit log — ended it. Round 11 was the first review to report **no internal contradiction**,
and rounds 11–15 found only genuinely new, substantive defects.

**Rounds 16 and 17 disagreed about the same fact**, one calling the unguarded `localStorage`
non-blocking and the next blocking. Round 17 was right, and its argument was concrete where
16's was categorical: `clearThemeMirror()` runs inside the sign-out `onClick`, so a throw
aborts the handler before `signOut()` and the button silently stops working. Two independent
reviewers converging on one line is a stronger signal than either verdict alone.

## Carried into implementation as non-blocking notes

- `GET /api/me` can return `null` — the validator reads through optional chaining.
- **Three** copies of the dark default: `Provider.tsx`, `ThemeBootstrap`'s repair, and the
  migration script's `catch`. Child F must change all three.
- `ThemeBootstrap` needs two hex literals, each with its own inline `eslint-disable`.
- `ThemeControl`'s pre-fetch state is not "unset" — naming it prevents an implementer
  "fixing" it into the concrete default the plan forbids.
- `docs/UTILITIES_AND_COMPONENTS.md:206` still lists the deleted `ThemeSwitch` — pre-existing,
  but E edits that file.
- A same-bundle multi-tab writeback can leave a stale `"dark"` mirror that outlives the
  repair; Child F's own repair fixes it on any single-tab load.
