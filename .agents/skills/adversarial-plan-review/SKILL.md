---
name: adversarial-plan-review
description: Harden a substantial plan, spec, design, or migration before implementation through risk-tiered sequential fresh skeptical reviews. Use for "$adversarial-plan-review", adversarial or skeptical review requests, "vet this plan", or consequential multi-step work. Standard-risk artifacts need one cold approval; critical writer, serializer, security, migration, concurrency, recovery, or irreversible-remote artifacts need two approvals on unchanged bytes. Skip trivial, easily reversible changes.
---

# Adversarial Plan Review

Harden a plan with the minimum genuinely fresh review justified by its risk. Every
round uses a brand-new reviewer with **no memory of predecessors**. A reviewer who
sees prior findings anchors on them and is not cold.

**Core principle:** bias comes from continuity. Kill continuity → start fresh every round.

Review happens before implementation, and completing this workflow does **not**
authorize implementation.

> **Canonical copy.** This file lives at `~/.agents/skills/adversarial-plan-review/`
> (symlinked into `~/.claude/skills/`). Projects that vendor it — e.g. owt-kb-v1 at
> `.agents/skills/adversarial-plan-review/` — must keep `SKILL.md`,
> `reviewer-brief.md` and `agents/openai.yaml` **byte-identical** to this directory.
> When you change one, change the other in the same delivery and say so in the commit.
> The two previously diverged into two different processes under one name; that is
> what this note exists to prevent.

## Classify the artifact first

Record the tier and rationale in the private ledger before starting a reviewer.

- **Standard risk (default): one fresh cold approval.** Parent roadmaps and read,
  model, UI, or reversible cutover artifacts stay standard unless they directly own
  a critical contract.
- **Critical risk: two sequential fresh approvals on byte-identical bytes.** Use
  critical risk when the artifact changes a production/server writer or mutation
  trust boundary, destructive/full-array serializer, auth/security/ACL/secret
  boundary, schema/data migration, multi-document transaction/concurrency/recovery
  protocol, rollback-sensitive data operation, or irreversible remote release action.
- A client/UI artifact that only consumes an already-approved idempotent writer is
  standard unless it changes that writer's trust, payload, retry, or recovery contract.
- **Incident and firefight work is not exempt.** A change to a production writer's
  concurrency, batching, or deletion behaviour is critical risk whether it was
  planned or discovered mid-fire. Under time pressure the bar reduces — to ONE
  fresh approval on a one-paragraph hypothesis, no plan document required — but
  never to zero. What the round is for is the VERIFIED ledger: an unverified
  premise about a live system ("the server accepts sends in parallel") is exactly
  what a reviewer catches and a hurry does not, and shipping one costs more time
  than the round would have.

When uncertain about a material hazard, ask the user or conservatively use critical.
Do not raise the tier merely because an artifact is long. If you raise or lower the
tier against this ladder rather than deriving it from the ladder, say so in the tier
rationale and in the published log — a reader cannot otherwise tell a judgment call
from a rule.

## When to use

- About to implement a substantial spec, design, migration, or multi-step plan with
  non-obvious premises.
- The user asks for skeptical or adversarial review, or to vet a plan.

Skip it for trivial, easily reversible changes.

## Prepare the review

1. Put the complete plan, spec, design, or migration in a canonical file. Do not review mutable prompt-only text.
2. Build a cold review packet containing only:
   - immutable plan snapshot path and digest;
   - repository or source path;
   - precise evidence pointers such as files, symbols, schemas, documents, or commands;
   - the original requirement, preserving its wording and intent.
3. Never disclose secrets, credentials, or PII. Replace only sensitive spans with explicit markers such as `[REDACTED: SECRET]`, `[REDACTED: CREDENTIAL]`, or `[REDACTED: PII]`, while preserving the surrounding requirement and its intent.
4. Compute a cryptographic content digest of the canonical file's exact bytes, preferably SHA-256.
5. Create a dedicated byte-identical snapshot for the round, treat it as immutable, and verify its digest matches the canonical file before starting the reviewer. Give the reviewer the snapshot path, never a mutable copy. A critical artifact may reuse the same unchanged snapshot for its confirming approval.

Keep the packet sufficient for a reviewer to verify both fitness to the original requirement and repository or source premises.

## Keep every reviewer cold

- Run exactly one reviewer at a time. Never start reviews concurrently.
- Start a genuinely fresh reviewer for every round. Never reuse, continue, or follow up with any earlier reviewer.
- Use a fresh reviewer with the named `skeptical-reviewer` role when available.
- **The reviewer's brief is `reviewer-brief.md` in this directory — the single source of the reviewer contract.** Hand it over whole; it defines the verdict format this loop depends on. If a reviewer cannot read files, paste its contents verbatim. Do not summarize, adapt, or maintain a second copy of it anywhere.
- Give a reviewer only the brief and the cold review packet. Never reveal the private ledger, earlier reviews, rebuttals, dispositions, round count, approval streak, or approval history.
- If a genuinely fresh reviewer cannot be started, stop and report that the freshness guarantee is unsatisfied.

## Run the sequential loop

Maintain an approval streak for the current digest, initially zero.

1. Compute and record the canonical and snapshot digests, verify they match, then start one fresh reviewer on the immutable snapshot.
2. Require exactly one verdict token: `VERDICT: APPROVED` or `VERDICT: CHANGES_REQUIRED`. A changes-required verdict must include a non-empty `BLOCKING` section; an approved verdict must contain no blocking issues. Permit `VERIFIED`, `UNVERIFIED`, and `NON-BLOCKING` sections so reviewers with either installed output format remain compatible.
3. Treat malformed or ambiguous output as invalid, reset the approval streak to zero, record the invalid round, and obtain a valid verdict from a new fresh reviewer.
4. **Independently verify every claimed blocker against the cited repository or source evidence.** This applies to non-blocking corrections too: accepting a plausible citation fix without checking it can turn a correct reference into a wrong one.
5. On `CHANGES_REQUIRED`:
   - reset the approval streak to zero, even when every blocker is refuted;
   - fix each verified blocker in the plan;
   - refute each incorrect blocker with evidence in the private ledger, without exposing the rebuttal to later reviewers;
   - recompute the digest after any edit.
6. On `APPROVED`:
   - count it only if the post-verdict snapshot digest and current canonical digest both match the recorded round digest;
   - reset the streak if either digest differs;
   - otherwise set the streak to one for a new digest, or increment it when it matches the preceding approved round's digest.
7. Stop a standard-risk review after one valid fresh `APPROVED`. Stop a critical-risk review only after two sequential fresh reviewers return `APPROVED` for the same immutable snapshot digest. Any edit, invalid verdict, ambiguous verdict, or `CHANGES_REQUIRED` resets critical approval credit.

Do not manufacture changes to satisfy an unsupported objection, dilute the requirement, or accept an approval without checking byte identity.

## Maintain a private ledger

For every completed round, record:

- round identifier;
- pre-round and post-verdict digest;
- verdict, or `INVALID` for malformed or ambiguous output;
- blockers, or `none`;
- disposition for each blocker: `fixed` or `refuted`;
- evidence supporting every disposition;
- non-blocking concerns worth carrying forward.

The ledger is for verification and convergence during the loop. Never include it in a cold review packet.

## Publish the ledger as a committed review log

**Required for every completed review, on every project.** When the loop ends, write
the ledger up as a durable file committed beside the artifact — same directory, named
`<artifact-basename>-review-log.md`.

An approval recorded only as a status line inside the artifact is the author's
unverifiable word. The digest pairing is checkable from the repository; "two fresh
reviewers approved this digest" is not. The log is what makes the approval auditable
by someone who was not present, including a later session of yourself.

Write it **after** the loop terminates, and never show it to any reviewer — publishing
it mid-loop would destroy the coldness the whole mechanism depends on.

Record:

- the risk tier and **why**, including whether it was raised or lowered against the
  ladder rather than derived from it;
- a round table: round number, reviewed digest, commit, verdict, and — for critical
  artifacts — where the approval streak reset and what reset it;
- per round, every blocker with its disposition (`fixed` / `refuted`) and the
  **evidence checked**, not merely the claim accepted;
- non-blocking items adopted, and any deliberately not adopted;
- **process failures on the author's side**, plainly: a churn cap exceeded, a defect
  the author introduced mid-loop, a reviewer claim accepted without the independent
  verification step 4 requires. A log recording only reviewer findings hides the
  half of the record most worth keeping;
- **post-approval changes**, listed separately and marked un-reviewed. Approval covers
  exactly one digest; anything after it falls outside that approval and must say so.

State in the log that approval is not authorization to implement.

## Escalate instead of looping

- If successive reviewers demand materially opposite changes, verify both positions. Escalate to the user only when both remain evidence-supported judgment calls; otherwise refute the disproven position in the private ledger and continue.
- **Churn cap.** After two substantive `CHANGES_REQUIRED` rounds for one artifact, do not start another round. Stop and reassess scope or architecture with the user. Converging blocker counts are not a licence to keep going — the cap exists so that the continue-or-stop call is the user's, and telling them afterwards is too late.
- Do not treat style preferences, optional hardening, or speculative concerns as blockers. A blocker must make the plan likely to cause incorrect behavior, data loss, a material safety failure, or failure of the stated requirement. A verification gap blocks only when it prevents confirmation of core correctness or safety.

## Report the result

Report:

- rounds completed;
- risk tier and rationale;
- the path of the committed review log;
- approved digest, only when the tier's approval requirement was met;
- plan changes and the blockers they resolved;
- refuted blockers and supporting evidence;
- remaining non-blocking concerns;
- any stop condition or unsatisfied guarantee.

State explicitly that review approval is not authorization to implement. After each
implementation phase, require a fresh code review plus documented test/browser gates;
plan review is not a substitute for implementation review.

## Common mistakes

| Mistake | Fix |
|---|---|
| Continuing the same reviewer instead of starting a new one | Always a fresh reviewer — that is the mechanism |
| Passing prior reviews or your rebuttals into the next round | Snapshot and requirement only |
| Pasting plan text into the prompt | Pass the snapshot path — pasting invites drift and breaks byte identity |
| Omitting the original requirement | The reviewer can then only check internal consistency, not fitness |
| Requiring two approvals for every artifact | Classify first; standard needs one, critical needs two |
| Stopping after you *address* feedback | Stop only after the tier's approval requirement is met |
| Editing a critical plan between confirming approvals | Any edit resets the streak |
| Running two reviewers at once | Sequential only |
| Diluting the plan to force approval | Fix real blockers; refute wrong ones with evidence |
| Accepting a reviewer's citation fix without checking it | Step 4 applies to non-blocking corrections too |
| Blowing through the churn cap because it feels like progress | Two substantive `CHANGES_REQUIRED` and you stop, regardless of trend |
| Looping forever on a judgment call | Escalate the disagreement to the user |
| Recording the approval only as a status line | Commit a review log beside the artifact; a status line is unverifiable |
| Keeping a second copy of the reviewer contract | `reviewer-brief.md` is the only copy — duplicates drift |
