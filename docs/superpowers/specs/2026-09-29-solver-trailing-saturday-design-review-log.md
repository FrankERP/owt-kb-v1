# Review log — `2026-09-29-solver-trailing-saturday-design.md`

Written after the loop ended; never shown to a reviewer. **Approval is not authorization to
implement** — implementation still needs its own plan, the four gates, and a fresh code review
of the diff.

## Tier

**Critical**, derived from the ladder, not raised or lowered: the artifact changes the production
solver's constraint model and request contract, and its release is an irreversible remote action
(Cloud Build deploys `main` to ONE Cloud Function serving production and dev, with no `preview`
rehearsal). Requirement: two sequential fresh `APPROVED` verdicts on byte-identical bytes.

## Rounds

| Round | Reviewed digest (SHA-256) | Commit | Verdict | Streak |
|---|---|---|---|---|
| 1 | `d7c4b0dd5e654788d7561b1187fe86ea42d1c79244c4c745b9a7dddbb723841a` | `6a8a3bdd` | APPROVED | 1 |
| 2 | `d7c4b0dd5e654788d7561b1187fe86ea42d1c79244c4c745b9a7dddbb723841a` (same immutable snapshot) | `6a8a3bdd` | APPROVED | 2 — requirement met |

Both reviewers were fresh `skeptical-reviewer` instances, run one after the other, given only the
reviewer brief, the snapshot path and digest, the repository, evidence pointers (including the
throwaway prototype `approach-a.diff`) and Frank's verbatim requirement. Neither saw the other's
verdict. The snapshot and the canonical file were hashed before each round and after each verdict;
all four hashes matched.

## What the reviewers checked (evidence, not claims)

- The prototype's base file is byte-identical to `main`'s `gcf/owt_solver_v2.py` (`diff`, both rounds).
- **Inertness:** the prototype's identity harness (history-free shapes) and each reviewer's own
  history-bearing harness on the real October 2026 request (3 history months, pinned and pinless):
  0 model/parameter mismatches in both rounds (round 2: 28 shapes in total).
- Real October 2026 on the prototype with `[1..5]` and `[5]`: `ok: true`, `schedule["5"]` holds only
  `Saturday`, the anchor binds; the old solver refuses week 5 with `ok: false` (the fail-loudly claim).
- The refusals of §6 (index `weeks + 2`, a week-5 exclusion without the trailing Saturday, a Sunday
  pin in week 5) on the prototype.
- Every per-week loop the spec names is bounded by `config.weeks` today (line-cited), the Sun.Lead
  rotation skips seat-less weeks before drawing, and an unconditional `weeks + 2` bound would break
  inertness (the soft consecutive loop creates variables per week).
- Calendar claims (a month ending on a Saturday has exactly four Sundays; last Saturday = last
  Sunday + 6).

## Blockers

None in either round.

## Non-blocking items and their disposition

All were deferred until after the second approval (adopting any before it would have reset the
streak) and then adopted as below. **Every adoption is a post-approval change: un-reviewed.**

| # | Item (round) | Disposition |
|---|---|---|
| 1 | A refused request naming `weeks + 1` gets the generic diagnostic; anchor + caps (reproduced: solves with 4 Saturdays, refused with 5), pair or consecutive rules can sink a month T5 does not check (R1) | Adopted: §6 — the diagnostic adds one line naming the trailing Saturday and suggesting it be deselected. Model untouched. |
| 2 | The differential identity check has no stated source for "the pre-change solver"; a vendored copy under `gcf/` would ship (`--source=gcf`) (R1, R2) | Adopted: §7 — per-shape fingerprints frozen as literals in the step-zero PR, under `test_inertness.py`'s governance. |
| 3 | "17-shape harness" overstates (≈12 distinct, all history-free) (R1) | Adopted: §7 states the spread instead of a count. |
| 4 | No test for absence slack from a full week-5 exclusion; none for the week-5 builtin markers under pins (R1, R2) | Adopted: §7 required tests. |
| 5 | A stored `!in week 5 …` rule silently changes from refusing the month to binding the 31st (R1) | Adopted: stated in §5. |
| 6 | "Revert signal" in deploy step 3 means "the deploy did not land, redeploy" (R1, R2) | Adopted: §7 reworded. |
| 7 | §5's "no phantom Sunday … variable or objective term" contradicts the endorsed last-named-week bound: the soft consecutive loop then creates `asgn[p,Sun.*,W5]` fixed to 0 and `rep` terms (42 variables measured) (R2) | Adopted, keeping the stronger contract: §5 now requires that loop to skip the Sunday roles in week `weeks + 1` only (skipping roles in every week would change existing models). |
| 8 | `SolveResponse.schedule[w].Sunday` is typed required (R2) | Already owned by the companion spec (§2.2 «Types»); no change here. |
| 9 | §3's "no longer drops Saturday minimums once the trailing Saturday is staffable" should say "staffable by that person" — round 2 reproduced one unreachable `Sat.* == 1` sinking the month (R2) | Adopted: §3 wording. |
| 10 | §8 lacks the D2 interaction: `Sat.Lead <= {weeks}` resolves against four Sundays while five Saturdays need a dedicated lead (R2) | Adopted: §8 limit. |
| 11 | Nits: the week-6 message's week count; an ADR; the legal index in «Input / output (JSON)» (R2) | Adopted: §6 message counts Sundays; §7 asks for the ADR and the doc line. |

## Process notes (author side)

- No churn: zero `CHANGES_REQUIRED` rounds, so the cap never came into play.
- The post-approval edits above are substantive clarifications (items 1, 2, 7 and 10 add or tighten
  contract text). They are outside the approved digest by construction and must be checked by the
  delivery-1 plan's self-review and by the fresh code review of the solver diff.
- During round 2 a parallel session («Auto-solver servicios especiales fairness») began a Stage B
  ladder change in the same solver file (`for sb_limit in (1, 2, 3)`), disjoint from this spec's
  regions. Delivery 1 rebases onto whatever lands first; the step-zero history fixture is shared.

## Approved digest

`d7c4b0dd5e654788d7561b1187fe86ea42d1c79244c4c745b9a7dddbb723841a` (commit `6a8a3bdd`). The spec's
current bytes differ from it only by the post-approval changes listed above.
