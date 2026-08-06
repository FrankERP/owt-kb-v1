---
name: adversarial-plan-review
description: Harden a substantial plan, spec, design, or migration before implementation with risk-tiered fresh adversarial review. Use for "$adversarial-plan-review", "skeptical review", "adversarial review", "vet this plan", or consequential multi-step work. Standard-risk artifacts need one cold approval; critical writer, serializer, security, migration, concurrency, recovery, or irreversible-remote artifacts need two approvals on unchanged text.
---

# Adversarial Plan Review

Harden a plan with the minimum fresh adversarial review justified by its risk. Each round uses a brand-new reviewer with **no memory of predecessors**. A reviewer who sees prior findings anchors on them and is not cold.

**Core principle:** bias comes from continuity. Kill continuity → start fresh every round.

Review approval does not authorize implementation.

## Classify the artifact first

Record the tier and rationale in the private ledger before starting a reviewer.

- **Standard risk (default): one fresh cold approval.** Parent roadmaps and read,
  model, UI, or reversible cutover artifacts stay standard unless they directly own
  a critical contract.
- **Critical risk: two sequential fresh approvals on byte-identical text.** Use
  critical risk when the artifact changes a production/server writer or mutation
  trust boundary, destructive/full-array serializer, auth/security/ACL/secret
  boundary, schema/data migration, multi-document transaction/concurrency/recovery
  protocol, rollback-sensitive data operation, or irreversible remote release action.
- A client/UI artifact that only consumes an already-approved idempotent writer is
  standard unless it changes that writer's trust, payload, retry, or recovery contract.

When uncertain whether a material hazard meets the critical definition, ask the user
or conservatively classify it as critical. Do not raise the tier merely because an
artifact is long.

## When to use

- About to implement a substantial spec, design, migration, or multi-step plan with non-obvious premises.
- The user asks for skeptical/adversarial review, or to vet a plan.

Skip it for trivial, easily-reversible changes.

## Running a round

- **Keep the plan in a file and pass the path.** This makes critical-plan byte identity checkable and keeps revisions auditable.
- **Give the reviewer:** the plan file path, the repo path, pointers to the relevant code, and the **original requirement verbatim**. Without the requirement a reviewer can only check internal consistency, not whether the plan solves the actual ask.
- **Never give it:** prior reviews, your rebuttals, or the round count. A round is a *new* reviewer with no history — never a continuation of a previous one.
- The reviewer's brief is `reviewer-brief.md` in this directory. Hand it over whole; it defines the verdict format the loop depends on.

## The sequential loop

1. Start one fresh reviewer on the current plan file.
2. On **`CHANGES_REQUIRED`**, independently verify every blocker against code or
   source evidence. Fix verified blockers, refute incorrect ones in the private
   ledger, and restart with a new reviewer. Any plan edit resets approval credit.
3. On **`APPROVED`**:
   - standard risk: stop successfully after this one approval;
   - critical risk: run one more fresh reviewer on the **byte-identical, unedited**
     plan. Stop only if it also approves. Any edit or `CHANGES_REQUIRED` resets the
     critical approval streak to zero.
4. Run reviewers **one at a time**. Never run two concurrently or continue an old
   reviewer. Sequence ensures each new round sees all accepted corrections.

## Round ledger and final report

Keep a running ledger: round number, verdict, and each blocker with your disposition (`fixed` / `refuted: <evidence>`). Use it to:

- Detect flip-flop and surface evidence-supported judgment calls to the user.
- Report rounds, tier, approved digest, changes, refutations, and remaining concerns.

## Publish the ledger as a committed review log — required

When the loop ends, write the ledger up as a durable file committed beside the plan:
same directory, `<plan-basename>-review-log.md`. See
`docs/superpowers/plans/2026-08-06-grid-drag-and-drop-review-log.md` for the shape.

An approval recorded only as a status line in the plan is the author's unverifiable
word. The digest pairing is checkable from the repository; "two fresh reviewers
approved this digest" is not. The log is what makes the claim auditable by someone
who was not present.

Write it **after** the loop terminates. Never show it to a reviewer — publishing it
mid-loop destroys the coldness the mechanism depends on.

Record: the tier and why (including whether it was raised against the ladder rather
than derived from it); a round table of digest, commit and verdict, marking where a
critical streak reset and what reset it; every blocker with its disposition and the
**evidence checked**; non-blocking items adopted and not adopted; **the author's own
process failures** — a churn cap exceeded, a defect introduced mid-loop, a reviewer
claim accepted without independent verification; and **post-approval changes**,
listed separately and marked un-reviewed, since approval covers exactly one digest.

State in the log that approval is not authorization to implement.

## Termination and guardrails

- **Standard done = one fresh `APPROVED`. Critical done = two fresh sequential
  `APPROVED` verdicts on identical plan text.** Merely addressing comments is not done.
- **Don't game the loop by capitulating.** Watering the plan down to pass review defeats the purpose. Refute wrong blockers with evidence instead.
- **Churn cap.** After two substantive `CHANGES_REQUIRED` rounds for one artifact,
  stop and reassess scope or architecture with the user before another edit or review.
- After each implementation phase, use a fresh code reviewer and run the repository's
  documented test and browser gates. Plan review is not a substitute for implementation review.

## Common mistakes

| Mistake | Fix |
|---|---|
| Continuing the same reviewer instead of starting a new one | Always a fresh reviewer — that is the mechanism |
| Passing prior reviews or your rebuttals into the next round | Current plan file and the requirement only |
| Pasting plan text into the prompt | Pass the file path — pasting invites drift and breaks byte-identity |
| Omitting the original requirement | The reviewer can then only check internal consistency, not fitness |
| Requiring two approvals for every artifact | Classify first; standard needs one, critical needs two |
| Stopping after you *address* feedback | Stop only after the tier's approval requirement is met |
| Editing a critical plan between confirming approvals | Any edit resets the streak |
| Running two reviewers at once | Sequential only — see step 4 |
| Diluting the plan to force approval | Fix real blockers; refute wrong ones with evidence |
| Looping forever on a judgment call | Escalate the disagreement to the user |
| Recording the approval only as a status line | Commit a review log beside the plan; a status line is the author's unverifiable word |
