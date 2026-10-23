# Review log: 2026-10-23-owt-mcp-card-saves.md

**Tier: critical**, derived from the ladder, not raised or lowered by judgment. The plan changes a mutation
trust boundary on a production writer: a new caller (the card, through an app-only tool) may start
`roleEditCommit` writes without the host's permission prompt.

Approval is not authorization to implement. Frank chose the change on 2026-10-23 at 19:17Z («Sí, guardar desde la
tarjeta»). Building waits for his look at the plan.

## Rounds

| Round | Digest reviewed | Verdict | Streak |
|---|---|---|---|
| 1 | `c622ff90…704992` | CHANGES_REQUIRED | 0 |
| 2 | `65b78fc2…9eec` | CHANGES_REQUIRED | 0 |

### Round 1: one blocker, fixed

After a save, the card's follow-up check erased the save's report, because `runCheck` resets `notice` on every
path. The card could also replay edits that were already written.

- Evidence checked: `useStoredEditor.tsx:80-96` resets `notice`. A replayed `place` of a member already seated is
  refused (`revise.ts`: `already_in_cell`, `member_not_in_cell`). A second refusal leaves `check` on the old view
  (`useStoredEditor.tsx:87-91`).
- Fix:
  - `runCheck` takes a `keep` notice.
  - The list is frozen once a save starts.
  - A partial write re-checks from `[]`.

Non-blocking items adopted:
- Compare the two input schemas with `toolsVersion` left out.
- Update the pinned tool lists (`mcpRoute.test.ts` and `scripts/mcp-dev-smoke.mjs` with its test).
- The throw copy now mentions refreshing the connector.
- «Mandar al chat» starts from an emptied context map.

### Round 2: one blocker, fixed

The `refused: true` branch still replayed the list whenever no part had been marked saved. An earlier attempt
with an unknown outcome (a timeout, the 30 s cutoff, a throw) may have written services without the card
knowing, so this was the same replay.

- Evidence checked:
  - `serviceEditor.ts` 1252-1290 and 1356-1358: `repeat_same_call` after earlier services were saved.
  - `runWriteTool.ts:116-123`: a text-only answer after the domain phase.
  - The order of checks in the save (line 1224, «cambió» after a partial write).
- Fix, by consolidation rather than another flag: after a save starts, the edit list is never replayed. It is
  either kept frozen for a repeat of the same part, or thrown away by a check from `[]`. Every structured refusal
  now re-checks from `[]` too.

Non-blocking items adopted:
- «Descartar» keeps the save's lines.
- The docs naming the inline-notice writer are now listed in S3.
- `SAVE_SERVICE_EDITS_DESCRIPTION` is kept on purpose.
- `callServerTool` gets an explicit 70 s timeout.
- The live proof now says who gets emailed.

Not adopted: keeping the list when `check_again` reports nothing saved. It would bring back per-attempt tracking,
which is the defect class here, and it only spares a redo on a rare path.

## Churn cap reached

Two substantive rounds in a row found **the same defect class: the card's state after a save attempt that may
have partly written.** Following the skill, the second fix consolidated the method instead of adding a third
special case: one rule, «never replay the list after a save starts». Round 3 needs Frank's go-ahead, asked for on
2026-10-23. Current digest: `d741e20a…914da`.
