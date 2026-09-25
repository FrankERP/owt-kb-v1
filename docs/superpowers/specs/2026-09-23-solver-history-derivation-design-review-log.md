# Review log — `2026-09-23-solver-history-derivation-design.md`

Written after the loop ended and never shown to any reviewer. **Approval is not
authorization to implement.**

## Result

**APPROVED at critical tier** — rounds 5 and 6, two sequential fresh reviewers, both
`APPROVED` on byte-identical digest
`a6958d85c55f3813156cd4b278b863370e20be7c8ad58e87ff90e19cd489186c`. Changes made after that
approval are listed below and are **un-reviewed**.

## Risk tier and why

**Critical**, as the roadmap sets it for P2's spec: it changes what the month solver —
whose output becomes production role documents — is told about the past.

## Rounds

| Round | Digest | Verdict | Blockers | Streak |
|---|---|---|---|---|
| 1 | `af1f9507` | CHANGES_REQUIRED | 1 | 0 |
| 2 | `2aea6646` | CHANGES_REQUIRED | 1 | 0 |
| 3 | `2367d0ae` | CHANGES_REQUIRED | 1 | 0 |
| 4 | `5639f429` | CHANGES_REQUIRED | 1 | 0 |
| 5 | `a6958d85` | **APPROVED** | 0 | 1 |
| 6 | `a6958d85` | **APPROVED** | 0 | **2 — approved** |

These were rounds 3–8 of the 15 Frank authorised in advance for both artifacts.

## Blockers and dispositions

All four were on **R11, the diff gate**, and each was verified before it was fixed.
None was refuted.

- **Round 1** — any difference could be admitted as "stored-vs-created" by label alone;
  the classes missed eviction, chip deletion and other browsers; the comparison's domain
  was unstated. *Fixed:* union domain; per-class evidence, using `creationFingerprint`
  (stamped only at create, `roleWriteRequest.ts:228`).
- **Round 2** — the fingerprint hashes instruments, FOH, date and name too, so a mismatch
  cannot prove a voice change; deletions and moves had no class; "created outside create
  mode" relied on a receipt field that does not exist; no read path was named. *Fixed:*
  R11 rebuilt around three verdicts (explained / unverified / bug), with the evidence read
  through builder diagnostics.
- **Round 3** — the "unchanged document → bug" row contradicted the partial-overwrite,
  eviction and rename rows, and nothing said which class wins. *Fixed:* an ordered rule
  list, first match wins.
- **Round 4** — the raw-response arm admitted "names never seated", a signal ordinary swaps
  produce. *Fixed:* zero-count rows only, the one reliable signature.

## Non-blocking items

Adopted in the round that raised them, except rounds 5–6's, held during the streak and
applied after approval (below). None declined.

## Process failures on the author's side

- **Four consecutive rounds on one requirement.** R11 was written as a list of labelled
  causes; each round found the evidence behind a label too weak or a rule missing. The
  remedy in round 2 — rebuilding R11 as an evidence table with explicit verdicts — was the
  real fix; rounds 3–4 then found precedence and one over-broad arm. Logged as a method
  finding in the worklog.
- A patch in round 1 failed on an anchor and the round-2 snapshot was first copied from
  the unchanged file; caught before dispatch by comparing digests.

## Post-approval changes — un-reviewed

1. Attribution is per cell: a document explains only the counts it contributes.
2. A changed latest-session document makes earlier-session documents `unverified`, not a false `bug`.
3. Rule 1's duplicate target carries the verdict `bug`.
4. Month keys are compared numerically, never as unpadded strings.
5. A solve uses history derived at solve time, never a copy cached before an edit.
6. The cutover switch is deployment-wide; `historyEntryFromDrafts` and R12's test stay until the dual-write ends.
7. R12 builds its documents with `buildRoleDocument`.
8. The planner shows the derivation's diagnostics after cutover.
9. `plannerModel.ts` is named under the additive-only rule.
10. The receipt date is stated as committed 2026-07-24, deployed 2026-07-27.
11. The H3 narrowing has its own Decisions row, owned by Frank at the diff.
12. Status line and terminal state record the approval.

**Suggested, done 2026-09-24:** the objective-ceiling follow-on (Frank's decision 3) is now
tracked as **issue #94** ("Solver: the fairness objective is skipped in most real months, so
history has no effect"), filed 2026-09-24 and OPEN as of 2026-09-25, with Frank's go-ahead to
publish it. The ADR (R16) records the same follow-on; see the dated note below.

## 2026-09-25 — R17 known-limitation note (P2 task 7, Delivery 1 docs step)

R17 requires this log and the P2 plan's own review log to record the known limitation: the
derived history changes the solver's schedule only when the fairness objective is not
skipped. ADR-0038 shows most real months with history already run unoptimised
(`objective_skipped: true`) on `main`, before this change — history offsets alone can push
the ladder's weights past CP-SAT's integer ceiling. Fixing the ceiling is issue #94 (above),
out of scope for P2 by Frank's decision 3 (2026-09-23). **ADR-0041**
("The solver's fairness history is derived from stored role documents, not `localStorage`",
`docs/adr/0041-the-fairness-history-is-derived-from-stored-services.md`) records the same
limitation as one of its Consequences and amends ADR-0010. This is a documentation note
only — no spec text is edited by it.
