# Review log — 2026-11-05-availability-fallback-options

**Tier: CRITICAL**, derived from the ladder, not raised or lowered: §4 changes a production writer's
gate («Aplicar» may now write a change that breaks the rules it lists). §3 and §5 are standard risk
but were reviewed with it as one artifact. An approval here does NOT authorize implementation.

| Round | Reviewed digest (sha256) | Verdict | Streak |
|---|---|---|---|
| 1 | `dddb46b13ebfb0ea2ec9eadadda320c704672780e8696dcc47241ccc3d8892bf` | CHANGES_REQUIRED (substantive) | 0 |
| 2 | `49b57652145cd0fe031a88055fa727fa8bef3631051e83ebad7cf45484da2518` | APPROVED | 1 |
| 3 | `49b57652145cd0fe031a88055fa727fa8bef3631051e83ebad7cf45484da2518` (same bytes) | CHANGES_REQUIRED (substantive) | reset to 0 |

Each round used a new reviewer that had only the brief, the snapshot, the evidence pointers and
Frank's requirement. Rounds ran one after another, never in parallel.

## Round 1 — blockers

1. **The person's instrument seat was emptied when a clean player existed.** The other seat was
   judged against the stored board. The voice taker's own broken rule therefore landed in every
   bassist's `added` list, so every bassist was rejected and the seat was left empty.
   - Checked: the plan's §3.4 and `judgeTarget` (`added` against the stored board).
   - **Fixed**: the other seat now passes when it adds nothing beyond what the voice build itself
     breaks. A test reproduces the bug with the old judge and passes with the new one.
2. **An option with no broken rule could appear first and never be applicable.** The strict pool
   and the relaxed pool sort exempt members by different medians (`orderByEffectiveLoad`,
   `localFill.ts`). An empty `waive` would also have been open by default.
   - Checked: the median that `localFill.ts` takes over the pool it is handed.
   - **Fixed**: a build with no broken rule is dropped. The writer and the route refuse an empty
     `waive`.

Non-blocking items adopted:
- An `e:` miss is excused only by a per-seat rule for the same person and row. Otherwise the build is
  dropped.
- A moved-up singer counts as a newly seated voice.
- The deadline is passed into the search.
- Options with more than 32 breaks are dropped.
- `waived` is unset by the sweep and added to the schema.
- The copy's location and two accepted looseness points are stated in §4.
- The rollback note was added.

## Round 2 — APPROVED

Non-blocking items recorded for after approval:
- the «Deshacer» premise;
- binding to the rule ordinals;
- the email copy;
- two voice seats in legacy data;
- "or, if none";
- the eligibility exemption test;
- `project-rules.md`;
- telling Frank the scope.

## Round 3 — blocker (resets the streak)

1. **The relaxed pools applied their limits (8 / 6 / 3) BEFORE the v3 eligibility drop.** Low-load
   singers who are not on the lists could use up the tries, which would leave fewer than 2 options.
   - Checked: `seatModel.ts`, where the Lead seat list is every `voz`, and the fact that eligibility
     was checked only in `breaksOf`.
   - Not hit by the real 15 nov roster, which has 5 relaxed direct candidates, but it is a real
     failure of the requirement.
   - **Fixed** in §3.3 and in the code (a `couldStand` pre-filter that reads the baseline
     eligibility). A test fails without the fix and passes with it.

Non-blocking items:
- Adopted:
  - the «Mantener»/«Deshacer» unsets;
  - `none` for two voice seats;
  - the `MonthCheckVerdict` labels stated in the plan.
- Declined: binding a digest of `ruleIds` / the config. «Aplicar» already requires the same role
  `_rev` and the exact key set. A config edit that renumbers rules and still yields the identical key
  set is negligible, and the admin can make the same edit by hand.
- Not adopted now: a confirmation dialog, since the normal «Aplicar» has none. It was offered to
  Frank.

## Process: churn cap reached

Two substantive CHANGES_REQUIRED rounds (1 and 3) hit the cap. The defect class was the same both
times: the relaxed search's candidate generation, meaning which pools, limits and boards feed the
late gates. The §4 writer gate was never the problem; all three reviewers found it sound. Round 4
needs Frank's go-ahead. The plan was edited after round 3 (current digest below), and those edits
are **un-reviewed**:

- the §3.3 eligibility pre-filter;
- the filler wording;
- two voice seats → `none`;
- the §4.4 unset list.

Current plan digest: `273e2609e2d6057519517572b639900ab4057769836ff7a8cc485a869b9dc16a`.

On the author's side: the implementation of §3 started while round 1 ran, before any approval. It
was kept uncommitted and was corrected after each round.
