---
name: adversarial-plan-review
description: Harden a plan, spec, design, or migration before implementation by subjecting it to fresh adversarial review until two independent cold reviewers approve the same unchanged text. Use for "$adversarial-plan-review", "skeptical review", "adversarial review", "vet this plan", or before implementing anything multi-step, data-touching, or hard to reverse.
---

# Adversarial Plan Review

Harden a plan by subjecting it to **fresh, adversarial review** until **two independent cold reviewers approve the same, unchanged plan text**. Each round is a brand-new reviewer with **no memory of its predecessors** — this is the whole point. A reviewer who has seen prior rounds anchors on them, defers to "they probably fixed it", or rubber-stamps to end the loop.

**Core principle:** bias comes from continuity. Kill continuity → start fresh every round.

**Why two:** a single approval can be a fluke. Two independent cold reads signing off on identical text is the bar. Any `CHANGES_REQUIRED`, or any edit to the plan, resets the count to zero.

## When to use

- About to implement a spec, design, migration, or any multi-step plan worth getting right — data-touching, auth-touching, irreversible steps, non-obvious premises.
- The user asks for skeptical/adversarial review, or to vet a plan.

Skip it for trivial, easily-reversible changes.

## Running a round

- **Keep the plan in a file and pass the path.** This is what makes "byte-identical between the two approvals" checkable, and revisions are just edits to that file.
- **Give the reviewer:** the plan file path, the repo path, pointers to the relevant code, and the **original requirement verbatim**. Without the requirement a reviewer can only check internal consistency, not whether the plan solves the actual ask.
- **Never give it:** prior reviews, your rebuttals, or the round count. A round is a *new* reviewer with no history — never a continuation of a previous one.
- The reviewer's brief is `reviewer-brief.md` in this directory. Hand it over whole; it defines the verdict format the loop depends on.

## The loop

1. **Start a fresh reviewer** on the current plan file.
2. **`CHANGES_REQUIRED`** → streak resets to 0. **Verify each blocker against the code yourself** before acting: fix the real ones in the plan file; refute the wrong ones with evidence and leave the plan unchanged for those. Log the round in the ledger. Back to step 1.
3. **`APPROVED`** → streak 1. Run one more fresh reviewer on the **byte-identical, unedited** plan file. A second `APPROVED` → done. Anything else → step 2.
4. **Run reviewers ONE AT A TIME. Never two concurrently.** Independence is not the point — *sequence* is. A reviewer launched in parallel judges text that still carries the previous round's defects, so when both find the same thing the second review is wasted, and neither ever sees whether the fixes hold. Sequential means every round reviews text that already carries the last round's corrections, which is the only way the loop converges. This holds even when you judge the plan mature, and even when a round is expected to be a formality.

## Round ledger and final report

Keep a running ledger: round number, verdict, and each blocker with your disposition (`fixed` / `refuted: <evidence>`). Use it to:

- **Detect flip-flop.** Successive reviewers demanding opposite things is a judgment call, not a defect. Surface both positions to the user rather than looping.
- **Report at the end.** Rounds run, what the review changed, what you refuted and why. The user should see what the loop bought, not just "approved".

## Termination and guardrails

- **Done = two fresh `APPROVED` verdicts on identical plan text**, from two reviewers run **in sequence** — not "I addressed the comments".
- **Don't game the loop by capitulating.** Watering the plan down to pass review defeats the purpose. Refute wrong blockers with evidence instead.
- **Churn cap.** Still getting substantive *new* blockers after about four rounds → stop and reassess with the user. The plan may need a rethink rather than another patch.

## Common mistakes

| Mistake | Fix |
|---|---|
| Continuing the same reviewer instead of starting a new one | Always a fresh reviewer — that is the mechanism |
| Passing prior reviews or your rebuttals into the next round | Current plan file and the requirement only |
| Pasting plan text into the prompt | Pass the file path — pasting invites drift and breaks byte-identity |
| Omitting the original requirement | The reviewer can then only check internal consistency, not fitness |
| Stopping after you *address* feedback | Stop only after two fresh reviewers approve the same text |
| Editing the plan between the two confirming approvals | Any edit resets the streak |
| Running two reviewers at once | Sequential only — see step 4 |
| Diluting the plan to force approval | Fix real blockers; refute wrong ones with evidence |
| Looping forever on a judgment call | Escalate the disagreement to the user |
