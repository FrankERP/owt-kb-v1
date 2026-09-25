# Review log — `2026-09-25-owt-mcp-p2-solver-history.md`

This log was written after the loop ended and was never shown to any reviewer. **Approval is
not authorization to implement.**

## Result

**APPROVED at standard tier** in round 2: one fresh cold reviewer returned `APPROVED` on digest
`3fa29c6832afdcbb290b1e4b56df3358b44163573363173fda04713c619fd543` (commit `2143d85e`). The
canonical and snapshot digests were re-checked after the verdict and had not changed. Changes
made after that approval are listed below and are **un-reviewed**.

## Risk tier and why

**Standard**, derived from the roadmap. P2's *spec* is critical and was approved separately
(`f6f2ed26`); its *implementation plan* is standard and gets no adversarial plan review. This
review ran **at Frank's explicit request** on 2026-09-25 ("No puedes manejar las revisiones
adversariales de ambos planes en paralelo?"). It ran concurrently with the P3 plan's loop, which
is a different artifact. Rounds within this artifact stayed sequential.

## Rounds

| Round | Digest | Commit | Verdict | Blockers | Counts toward churn cap |
|---|---|---|---|---|---|
| 1 | `816e6db7` | `d0985849` | CHANGES_REQUIRED | 2 | yes (1 of 2) |
| 2 | `3fa29c68` | `2143d85e` | **APPROVED** | 0 | — |

### Round 1 blockers

1. **`evidence=1` exposed kids-only member names to a plain worship admin.** Fixed.
   - **Evidence checked:** step 3's evidence `members` list was unfiltered. The route's
     `gate()` is `requireActiveManager` minus content-editor
     (`app/api/admin/solver-config/route.ts:58-64`). `/api/admin/members` hides kids-only
     members from a non-super-admin (`members/route.ts:20-31`, `WORSHIP_MEMBER_GROQ_FILTER`).
     CLAUDE.md §Auth requires two-way isolation.
   - **Fix:** `evidence=1` is super-admin only, with route tests. `duplicateNames` is scoped to
     members that a window seat references.
2. **A failed or pending derived read rendered every leader as «sin Lead».** Fixed.
   - **Evidence checked:** step 5 gave error handling only to the Historial block. The
     stored-mode grid mount (`MonthGenerator.tsx:3773-3781`) has none beside it.
     `priorMonthLeadVisibility` (`leadPoolHistory.ts:88-110`) reads `[]` as "no prior month".
   - **Fix:** no leader list renders until the history is `ready`. Both mounts show a skeleton,
     or an error with «Reintentar». Test 7 covers it.

**Round 1 non-blocking items adopted:**
- the diff CLI refuses when a secondary export needs a target the bundle lacks;
- D3's tier condition;
- the read model's duplicate detection is reused;
- a note that the report is a single data point;
- a 20 s timeout on the Auto fetch;
- R17 is recorded in this log.

**Declined:** the extra round trip before Auto's pre-flight refusal is harmless.

### Round 2

`APPROVED`, no blockers. The reviewer verified these against code:
- the fingerprint round trip;
- the solver's positional weighting of `history[-3:]`, which does not skip empty entries;
- `historyForRequest` being an identity on three derived entries;
- audit and draft-gating compliance;
- the route gates;
- Saturday month assignment;
- the type-only writer import of `plannerModel.ts`.

## Process failures on the author's side

None surfaced by the loop.

## Post-approval changes — un-reviewed

These are the round-2 non-blocking items, all adopted:

1. `unnamedMembers` is scoped to members a window seat references, like `duplicateNames`.
2. Rule 4's "no receipt" arm is defined as a role carrying neither `creationReceiptId` nor
   `creationFingerprint`. Its hits are counted on their own line.
3. `--bundle` is repeatable, one per profile.
4. The display hook fetches only for a four-digit year.
5. After the history await, `handleAuto` reads `cells`/`config` from current state, unless the
   grid is locked while `autoPending`.
6. A spec reconciliation cites test 4, not test 5.
7. Two new reconciliations:
   - the roadmap's "spec and ADR approved" precondition, since the ADR lands in D1 before the
     diff;
   - the objective-skip frequency narrowing, which Frank decides at Gate C.
8. The Preconditions line is corrected. The `DATA_MODEL.md` line range is corrected.
9. The status line and terminal state record the approval.

## Carried forward for Frank

- **Q1–Q3**, all non-blocking with defaults: a code-constant switch, a private folder outside
  the repository, and Frank running the diff CLI himself.
- **Gates A–D**: the export, the diff, the verdicts and cutover, and the stop point.
- **The objective-skip frequency narrowing**, decided at Gate C.

## 2026-09-25 — R17 known-limitation note (task 7, Delivery 1 docs step)

Recorded here per R16/R17 and plan step 7, alongside the same note in the spec's own review
log: the derived history influences the schedule the solver produces only when the fairness
objective is not skipped. ADR-0038 shows most real months with history already run
unoptimised (`objective_skipped: true`) on `main`, before this change, because the ladder's
weights overflow CP-SAT's integer ceiling once history offsets are added. Fixing that ceiling
is separate follow-on work, tracked as **issue #94** ("Solver: the fairness objective is
skipped in most real months, so history has no effect"), OPEN, out of scope for P2 by Frank's
decision of 2026-09-23. **ADR-0041** (new, this task) records the same limitation as one of
its Consequences. This is a documentation note only — no plan text is edited by it.
