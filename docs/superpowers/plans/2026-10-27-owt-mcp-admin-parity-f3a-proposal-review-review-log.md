# Review log: S1, deciding setlist proposals from the chat (admin parity, phase 3)

Artifact: `2026-10-27-owt-mcp-admin-parity-f3a-proposal-review.md`. Process:
`.agents/skills/adversarial-plan-review/`. Approval is NOT authorization to implement; the build follows
CLAUDE.md's release order and gets its own merge-range code review.

## Tier

**Critical**, derived from the ladder, neither raised nor lowered. The slice adds a second caller and a
new actor source (the MCP bearer) to the production writer that decides proposals. `approve` rewrites a
live setlist in one multi-document transaction and queues the team's setlist email.

## Rounds

| Round | Reviewed SHA-256 | Commit | Verdict | Streak |
|---|---|---|---|---|
| R1 | `7bc0d27d…b5f8` | a3b78d15 | CHANGES_REQUIRED (substantive) | 0 |
| R2 | `2247a336…aae2` | 63c248cf | CHANGES_REQUIRED (substantive) | 0 |
| R3 | `4412794f…7891a` | 19a04161 | APPROVED | 1 |
| R4 | `4412794f…7891a` (same snapshot) | 19a04161 | APPROVED | 2, loop ended |

Each round used a new reviewer that saw only the brief, the snapshot, the repository and the
requirement. R3 and R4 reviewed the same read-only snapshot; its digest was checked before each
dispatch and after each verdict, and it matched the canonical file each time.

## Blockers and dispositions

**R1**
- B1, write annotations: the write was declared `destructiveHint:false, idempotentHint:true` against
  I14, and D10 called the decision "reversible". **Fixed.** Evidence checked: `docs/MCP.md` I14, where
  every write tool is destructive, and the route's reopen, which never restores the setlist.
- B2, the "read-only" check would reach `loadWeekendCoordination` → `resolveOwnedCoordination` →
  `bootstrapLegacyLock`, which commits. **Fixed** with peek mode (D4) and spy tests. Evidence checked:
  `serviceWriteTargets.ts` 205-260 and `roleWriteOps.ts` 358-414.

**R2**
- B1, the live proof would have mailed «Setlist listo» to the whole worship team (ADR-0054).
  **Fixed:** §5 now unpublishes before approving, and the audience of every step is stated first.
  Evidence checked: `setlistUpsert` returns null when unpublished, `outboxSweep.ts` builds
  `everyone` from an empty `beforeSongs`, and the listener query requires `published != false`.
- B2, D8 went around `app/mcp/writes/reports.ts` and understated the audience. **Fixed:** D8 was
  rewritten onto the report layer with the real push conditions. Evidence checked: `reports.ts:219`
  already states ADR-0054.

**R3, R4:** no blockers.

## Non-blocking items

R1 and R2 items folded in before R3: principal reuse, check inputs, statement order with a parity test,
push recipients, the shared notice predicate, the note bound into the line, `runWriteTool`/`callDomain`,
the pins, the dead `bootstrapped` branch, and the past date worded as a prediction.

The R3 and R4 items were adopted **after approval** as §7 A1–A9 of the plan. They are listed there and
are NOT reviewed. The author checked each against the code:
- the outbox keeps the first `before` of a debounce window (`outboxNotice.ts` uses `createIfNotExists`);
- `isPastServiceDate` already exists (`serviceReadiness.ts:1015`);
- deleting a special with songs is refused (`roleDependencies.ts` 280-290).

None was declined.

## Process record (author side)

- **Churn cap reached after R2** (two substantive rounds). The defect class both rounds hit was side
  effects the plan did not trace: an annotation that understated harm, a read that commits, and an
  email audience. Frank's go-ahead for another round came **before** R3: decision card «Sí, las dos»,
  2026-10-27 23:17Z. It is recorded in the private ledger.
- The status line used to carry the round history («churn cap reached, round 3 awaits Frank»). It
  was neutralized in 19a04161 before R3, so a fresh reviewer could not read the history from the
  artifact. Earlier snapshots carried it: a coldness slip in R2.
- The worklog no longer exists (retired 2026-10-22), so the cap is recorded here, as CLAUDE.md
  directs.

## Post-approval changes (un-reviewed)

- The plan's §7 (A1–A9) and its status line.
- Approved digest: `4412794fe38e13f684792a670cb92f10fe9865412a92ae1dda84c35102a7891a`.
