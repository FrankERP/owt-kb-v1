# Review log — `2026-09-25-owt-mcp-p3-writes.md`

This log was written after the loop ended and was never shown to any reviewer. **Approval is
not authorization to implement.**

## Result

**APPROVED at critical tier.** In rounds 4 and 5, two sequential fresh reviewers both returned
`APPROVED` on the byte-identical digest
`643c87863ceeefb95d8e7909b365e21999c54007b9ec921134861e9045830b3a`, committed at `d6dc4947`.
The canonical file and the snapshot were re-checked after each verdict and had not changed.
Changes made after that approval are listed below and are **un-reviewed**.

## Risk tier and why

The tier is **critical**, derived from the ladder. The plan adds four production writers, has a
notification audience (the real team, by email and push) and involves multi-document
concurrency, and the roadmap assigns P3 critical tier. The loop ran concurrently with the P2
plan's review, which is a different artifact, as Frank asked on 2026-09-25 ("No puedes manejar
las revisiones adversariales de ambos planes en paralelo?"). Rounds on this artifact stayed
sequential.

## Rounds

| Round | Digest | Commit | Verdict | Blockers | Streak | Counts toward the cap |
|---|---|---|---|---|---|---|
| 1 | `006961ef` | `78b43fd5` | CHANGES_REQUIRED | 1 | 0 | yes (1) |
| 2 | `5e13d50c` | `02f91df9` | APPROVED | 0 | 1 | — |
| 3 | `5e13d50c` | `02f91df9` | CHANGES_REQUIRED | 1 | **reset to 0** | yes (2), **cap reached** |
| 4 | `643c8786` | `d6dc4947` | APPROVED | 0 | 1 | — |
| 5 | `643c8786` | `d6dc4947` | **APPROVED** | 0 | **2, approved** | — |

**The churn cap.** After round 3 the loop had two substantive `CHANGES_REQUIRED` rounds, so it
stopped.
- The defect class was logged to the worklog at 11:40, before anything further was dispatched.
- Frank chose, through a question with options, "Barrido + ronda 4 y nuevo tope de 15" at
  11:43. That was the go-ahead for round 4 and a new cap of 15.
- No further round was substantive.

### Round 1: blocker

**`edit_setlist` dropped explicit leaders on a service that is not a worship night, and
reported success.** Fixed.
- **Evidence checked:** the plan's step 11 sent `leadIds` only when the service was a worship
  night. `validateSongLeads` refuses any non-empty `leadIds` when `!target.worshipNight`
  (`songLeads.ts:40-43`, called at `setlists/route.ts:377-380`).
- **Fix:** explicit, non-empty leaders are forwarded, so the writer's own check refuses the whole
  edit. Refusal-replay and translation tests were added.

**Found by the author in the same revision:** the plan read request durations from Vercel logs.
On this plan the logs carry none.
- **Evidence:** on 2026-09-25 the logs API and `vercel logs --json` returned no duration field,
  and the Observability API answered 404.
- **Fix:** an `[mcp]` timing line in `runWriteTool` and `runReadTool`.

### Round 2

`APPROVED` with ten non-blocking notes. They were held back, because an edit would have reset
the streak.

### Round 3: blocker

**`edit_setlist` skipped the setlist editor's `invalid_content` gate** (a dangling song
reference, or a missing or duplicate row `_key`), **and its refusal copy sent Frank to `/admin`,
which refuses the same setlist.** Fixed in the revision at `d6dc4947`.
- **Evidence checked:** `setlistReadContract.ts:228-240` (`canEditSetlistResponse` →
  `invalid_content`, with the copy «Revísalo en Studio») and `serviceReadModel.ts:160-177`
  (`setlistContentState`).

**Defect class across rounds 1 and 3:** the plan measured I15's refusal parity against the
admin **route** only. It missed the gates the admin **editor and UI** apply on their own. The
swap UI's admission gate, a non-blocking note in rounds 2 and 3, belongs to the same class.
- The remedy was a consolidation, not another round: a read-only sweep of every client-side and
  read-contract gate on the four admin surfaces.
- It found:
  - setlist: 8 gates, 5 consequential;
  - swap: 12 gates, 4 consequential;
  - publish: 4 gates, none material;
  - unpublish: 5 gates, none material.
- The plan now names the whole admin surface (UI, read contract and route) as I15's
  counterpart, and it disposes of every gate in one table.
- Mirrored gates: the `invalid_content` gate, duplicate songs, `post`-only song refs, `play_key`
  over 24 characters (the writer would silently blank it), cross-month swaps, and swap admission
  (duplicate targets, and a missing lock, mirrored through the readiness lock issues so that
  refusal never writes).
- The other gates are marked structural, inherited, or declared narrowings for Frank (Q6–Q8).
- Every held note from rounds 2 and 3 was folded into the same revision.

### Rounds 4 and 5

Both `APPROVED` with no blockers. The reviewers verified these against code at `963cd736`:
- the extraction and the audit registry move;
- the delivery-capable scan;
- the SDK transport, where buffering cannot hang;
- the `publishVerdict` consolidation;
- the gate table's premises (S2g through `assessRoleTargetLock` → `lockIssuesToIntegrity`, S2b
  through `loadTargetOccupancy`);
- the notification audiences of every live step.

## Process notes on the author's side

- **The churn cap was reached and escalated before round 4.** It was not passed silently.
- **Worktree isolation.** During the loop the session was pinned to the P2 implementation
  worktree. Reviewers from round 3 on were told to read code through `git show 963cd736:<path>`
  or through absolute paths in the clean plans checkout. The round 2 reviewer's shell was
  confined to the other worktree partway through; its checks of the file were read-only.

## Post-approval changes — un-reviewed

These are the non-blocking notes from rounds 4 and 5, all adopted.

1. **Live parity with `/admin` by default.** Two `/admin` twin rows are added.
   - L5b: Frank's `/admin` Lead swap between A and B, after L5. Its emails must arrive before L6a,
     because an unpublish silences a pending notice.
   - L7b: three `/admin` setlist saves on B once it is a draft again, after L6b. They are the
     twins of L1, L2 and L7, and they notify nobody.
   Tests-only parity is now the opt-out. Q6 is rewritten, and Frank answers it before
   implementation.
2. **Non-adjacent medley links.** An explicit `medleyTag` on rows that are not adjacent is
   refused; before, it would have been silently erased.
3. **`runWriteTool` copy.** A throw before the domain call says «No se escribió nada.». Only a
   throw at or after the call keeps «No se pudo confirmar…».
4. **PP0.** It takes `NOTIFY_DEBOUNCE_MINUTES` from the code default and asks Frank about
   overrides. It never pulls the production env to disk.
5. **Roadmap rollback amendment.** The registry entries move to the `*Commit` modules. The
   amendment is recorded before P3 releases, as a listed parent change.
6. **Text corrections.**
   - The cleanup check covers one month.
   - Step 2 names its one allowed in-body edit: hoisting `setlistRecipientIds`.
7. **Swap `freshRevs`.** They compare the whole `ROLE_PROJECTION` minus `_rev`, as D8 does.
8. **Time bound at L3a.** If nothing arrives, the step stops at once and applies the A2 response.
9. **Caller pin.** It is named and described as covering `publishVerdict` too.
10. **The 24-character key check was adjusted on evidence.** 24 × U+0958 is 24 characters raw
    and 48 after NFC, which the writer would silently blank.
    - The tool now also runs the writer's own `parseSongRows` over the rows it built.
    - It refuses any key that was non-blank after trimming but comes back blank.
    - A test covers the case.
11. **Status line and terminal state.** Both record the approval.

## Carried forward for Frank

- **Q1–Q8.** None of them blocks. Q6 (live parity) must be answered before implementation.
- **The spec erratum.** The admin unpublish runs no outbox sweep, and the spec's text says it
  does.
- **The roadmap rollback amendment** (item 5).
- **P1's exit gate** (step 0): phone acceptance is 4 of 7 checks, and latency (item 9) is not
  yet measured.
