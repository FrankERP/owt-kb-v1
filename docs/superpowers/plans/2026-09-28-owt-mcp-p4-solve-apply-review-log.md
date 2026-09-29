# MCP P4 plan — adversarial review log

Artifact: [`2026-09-28-owt-mcp-p4-solve-apply.md`](2026-09-28-owt-mcp-p4-solve-apply.md) — the implementation plan for `solve_month`, `revise_proposal` and `apply_schedule`, plus Fluid compute as its own first release.

This log was written after the loop ended and was never shown to a reviewer. **Approval is not authorization to implement.** Implementation starts only on Frank's explicit go-ahead. Each implementation phase still needs a fresh code review of its diff and the documented gates.

## Risk tier: CRITICAL (derived from the ladder, not raised or lowered)

The plan:
- extracts the production create writer from `/api/admin/roles` (`roleCreateCommit`, mirroring ADR-0043) and calls it from a new trust boundary, the MCP connector;
- introduces a new stored document type (`mcpProposal`) with a lease and write-ahead recovery protocol;
- changes the platform execution model for every function (Fluid compute).

Each of those is on the ladder's critical list, so the requirement was two sequential fresh `APPROVED` verdicts on byte-identical bytes.

**Churn cap.** Frank authorized up to 15 rounds in advance, on 2026-09-28 before round 2 («Hasta 15, como P3»). The default cap of two substantive rounds was reached at round 3, and the loop continued under that recorded go-ahead.

## Rounds

| Round | Reviewed digest (SHA-256) | Verdict | Substantive blocker | Approval streak |
|---|---|---|---|---|
| 1 | `0cf6685bd7fc4d9480c1b4314c08d36f4cdaa700cc8fcfb8115f67319907dd8d` | CHANGES_REQUIRED | yes (1) | 0 |
| 2 | `f8619fa4d80c025eff536412c8b34202fb17d4578cb470597261aa88f39c9c2d` | **APPROVED** | — | 1, then **reset by the author**: round 2's non-blocking items were adopted before a confirming round, deliberately, because one of them changed `apply_schedule`'s reported outcome |
| 3 | `5ee9a2395dbf65d92ec8e8ece7824d8dfb6ad9db4f60a16def9d3ea5100f578f` | CHANGES_REQUIRED | yes (1) | 0 |
| 4 | `1dd1095cc7b2c753949ce08cbd248a01793ca3aa85debdf72c889eea9ce40e6b` | CHANGES_REQUIRED | yes (1) | 0 |
| 5 | `07c6b0fbceb1368896b7b0838b0417c28495b1584842350e4375aeba69d12060` | **APPROVED** | — | 1 |
| 6 | `07c6b0fb…2060` (same bytes, confirming round) | CHANGES_REQUIRED | yes (1) | **reset to 0**: round 5's approval was not confirmed |
| 7 | `93c4e227ce5ea55510c7ec266039b26dbc8e5579aa0030a2d27e0a415e66c95a` | **APPROVED** | — | 1 |
| 8 | `93c4e227…c95a` (same bytes, confirming round) | **APPROVED** | — | **2: critical bar met** |

**Approved digest:** `93c4e227ce5ea55510c7ec266039b26dbc8e5579aa0030a2d27e0a415e66c95a`.

Every reviewer was a fresh `skeptical-reviewer` (Opus). Each received the same brief and a cold packet: the immutable snapshot, the repository, the evidence pointers, and the original requirement with Frank's decisions. None saw a prior round.

## Blockers and their dispositions

Each blocker was independently re-verified against the cited evidence before it was accepted.

### Round 1: `solve_month` would list kids-only volunteers (spec I5)
- **Claim.** The unavailability warnings would name kids-only volunteers, with their dates.
- **Evidence checked.**
  - `buildUnavailabilityNotices` iterates every member with no ministry or Tipo filter (`app/components/admin/MonthGenerator.tsx:389-405`).
  - The kids availability route writes the same `unavailableDates` field (`app/api/kids/members/[id]/availability/route.ts:121-123`).
  - `WORSHIP_MEMBER_GROQ_FILTER`'s `$all` arm admits every member (`app/ministries.ts:77`).
- **Fixed.** The pool projects `ministries`. Every pool-derived name list not tied to a seat is filtered to the worship audience. M17 is restated as «mirror (behaviour), narrowed by I5». An I5 test was added.

### Round 3: a date taken after the solve counted as success
- **Claim.** A target another admin occupied after the solve was reported «omitido (ya existe)» and counted toward a whole-month success.
- **Evidence checked.**
  - `planApply` rule 3 read only the fresh month roles.
  - The output counted that label as success.
  - The record kept no solve-time state.
  - This contradicts the roadmap («a partial apply is reported per service») and I9.
- **Fixed, by consolidation.** The same defect class had appeared in round 2 (a created-then-deleted draft reported «ya creado»). So the fix was not a patch for this one case:
  - the record stores the solve-time target state per service;
  - apply classifies each service from one exhaustive table: Table X for the action, Table O for the report;
  - whole-month success means no service landed in a failure cell.

### Round 4: a late lease release could drop a successor's lease
- **Claim.** A killed apply's late `releaseApplyLease` could remove a later apply's live lease, breaking apply/revise exclusion.
- **Evidence checked.**
  - The release was a plain `unset(["applyLease"])` in `finally`.
  - The lease's `nonce` was written but never read.
- **Fixed, by consolidation.** A write/guard table (W1–W7) now covers every write to a proposal record.
  - Every apply-side mutation proves lease ownership: the nonce, under `ifRevisionId` of the read that confirmed it.
  - The revise commit runs under `ifRevisionId` of the read that saw no live lease.
  - A lost lease stops the loop, with an honest report.

### Round 6: the soak's per-path watch could never fire
- **Claim.** Release A's soak relied on per-path request durations that Vercel does not provide on Hobby.
- **Evidence checked.**
  - `docs/MCP.md:942-945`: no duration field in the logs API or `vercel logs --json`, and the Observability API answers 404 on Hobby.
  - `docs/NOTIFICATIONS.md:528-529`: about one hour of log retention.
- **Fixed** by re-capping instead of watching.
  - Every function without a declared `maxDuration` keeps the legacy 10 s through the project's Default Max Duration.
  - Fluid changes only the functions that declare a duration.
  - The per-path watch and its stop condition were removed, and Release A's verify step now observes the effective limits.

No blocker was refuted. All four survived verification and were substantive.

## Non-blocking items

- **Adopted during the loop:** every non-blocking item from rounds 1, 2, 3, 4 and 6, including round 5's held items (adopted in round 6's pass).
  - Examples: per-service refusal copy; R1's collapsed eligibility refusal; record size bounds; refused-special and per-(date, row) unfilled parity; the 20 s history ceiling; year bounds 2024–2035; «propuesta de mes» naming; the `ours_moved` replay identity check; all-cells parity; the durable GitHub annotations as the sweep source.
- **Held and adopted after approval** (rounds 7 and 8): listed below as un-reviewed.
- **Not adopted:** none.

## Process failures on the author's side

Recorded plainly:
- **The coordinator's brief to the author contained an incomplete rationale** (after round 2, item 3: «`cards: []` is safe because `monthTargetPreflight` filters by `targetKey`»). The author found that `cards` splits entries into global and card-owned, so the connector sees a superset. That superset is now declared (M16/A5/F5) and tested.
- **The round-6 fix pass first specified a local `vercel build` after `vercel pull --environment=preview`**, which would have written the preview environment's secrets to disk. That violates the project's secrets rule. The coordinator caught it before round 7 and overruled it (ruling P4-R14): Default Max Duration is now the only re-cap, and the read-only deployment/project API is the only observation.
- **The approval streak was reset twice.** After round 2, non-blocking items were adopted before the confirming round; this was deliberate, because one changed a reported outcome. Round 6 failed to confirm round 5's approval.
- **Two consecutive rounds (2 and 3) found the same defect class in apply's outcome reporting.** The fix then became a consolidation (the exhaustive tables) rather than another patch. Round 4 found a second class, the unenforced exclusivity of the record protocol, which was also consolidated (the write/guard table).
- **The default churn cap was passed at round 3**, but only under Frank's advance go-ahead, recorded before round 2.

## Post-approval changes — UN-REVIEWED

These were applied after digest `93c4e227…` and fall **outside the approval**. The plan lists them in its own «Post-approval changes» section. The implementation's code review is the next check on them.

1. `docs/SECRETS.md`'s `OWT_SOLVER_API_KEY` entry is updated in step 11 (the sender moves to `solverCall.ts`; `solve_month` depends on it mid-rotation).
2. Step 6b: X6's parity wording for `exists` is corrected (the browser's `existingRoles` does not refresh while the dialog is open).
3. Step 1: (P) is stated up front as likely inconclusive, a schedule cost for Release A.
4. (O-a) records `config.isUsingActiveCPU` as a second signal.
5. Steps 10.1 and 10.3 and A1 are aligned on where apply's rules are read.
6. Step 15 takes a usage reading after the live proof.
7. The Default Max Duration is set only after Release A's code review, immediately before the preview merge, with no production deploy between setting it and a passing (P).
8. The «Hobby cron slots» reason is removed (the allowance changed).
9. AS7's validation is recorded explicitly at L1 and L4.
10. **`main` moved to `e8660b26` after approval**, via PR #109 (ADR-0044) and PR #110 (ADR-0045, named grid chips). P4's ADR takes the next free number at merge. Step 3 re-verifies every planner citation against the new tree before extracting.
    - The re-check found **no changed premise.** `MonthGenerator.tsx` and everything under `app/utils`, `app/api` and `app/mcp` are unchanged, and the moved bodies are identical (offsets only).
    - One cited element is gone: R8's «+N» pill, which ADR-0045 retired. R8's premise still holds: over target warns and never refuses.
11. The connector's over-target warning reads «Por encima del objetivo», the grid's wording since ADR-0045, instead of «+N sobre el objetivo». This is a copy change only.

**Item 7 deserves the closest look at implementation.** It changes the release procedure and every rollback path for Release A: the Default Max Duration setting now returns to its pre-release state on rollback, instead of staying.
