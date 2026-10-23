# Review log: 2026-10-23-owt-mcp-card-saves.md

**Tier: critical**, derived from the ladder, not raised or lowered by judgment. The plan changes a mutation
trust boundary on a production writer: a new caller (the card, through an app-only tool) may start
`roleEditCommit` writes without the host's permission prompt.

Approval is not authorization to implement. Frank chose the change on 2026-10-23 at 19:17Z («Sí, guardar desde la
tarjeta»). Frank saw the plan summary and chose «Sigue revisando» at 22:49Z (the go-ahead for round 3).

## Rounds

| Round | Digest reviewed | Verdict | Streak |
|---|---|---|---|
| 1 | `c622ff90…704992` | CHANGES_REQUIRED | 0 |
| 2 | `65b78fc2…9eec` | CHANGES_REQUIRED | 0 |
| 3 | `d741e20a…914da` | APPROVED | 1 |
| 4 | `d741e20a…914da` (same snapshot) | APPROVED | 2 |

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
special case: one rule, «never replay the list after a save starts». Round 3 needed Frank's go-ahead: asked
2026-10-23, given 22:49Z («Sigue revisando»).

### Rounds 3 and 4: approved

Two fresh reviewers, one after the other, approved the same snapshot (`d741e20aaa00d66ab0409c4124c32e1d59ec1dcc93910182a80a6c8d40e914da`);
canonical and snapshot digests matched before and after each verdict. The critical tier's requirement is met.

## Post-approval changes (UN-REVIEWED)

Adopted from rounds 3 and 4's non-blocking items while building; none changes the server writer or the trust
boundary, and the merge-range code review covers them:
- Opening the confirmation closes an open seat picker and a half-done exchange; while the list is frozen the
  board is locked through a new `frozen` prop of `Editor.tsx` (`locked` = busy, a question, or frozen), so
  `onPick` and the second exchange tap cannot replay it.
- «Cerrar» then «Editar» after a save started for that month opens it from the empty list, not the chat's edits.
- The list stays frozen until a check from `[]` succeeds; a failed fresh check keeps it frozen and says so.
- The save's lines written for Claude («Repite exactamente la misma llamada…», «Revisa el mes de nuevo con
  check_service_edits…», the needs-card line) are not shown on the card; the card says its own next step.
- The throw notice also names a host that does not let the card save.
- Comments and docs the plan missed: the headers of `serviceEditor.ts`, `storedModel.ts`, `useStoredEditor.tsx`,
  `roleEditCommit.ts`, the ADR-0066 line in `docs/adr/README.md`, and `SERVICE_EDITOR_TOOL_NAMES` in the smoke.
- One line in the ADR-0066 addendum: saving one part can make a later part's forced lines differ (the save judges
  on the fresh board), which the refusal path (a check from `[]`) handles.

Declined: keeping the list on a first-attempt refusal that wrote nothing (`retry: true` source reads). It needs
per-attempt tracking, the defect class of rounds 1–2, for a rare path. The ADR stays an unnumbered addendum
(precedent ADR-0015) because a new number on main collides with ADR numbers other threads hold on `preview`.
