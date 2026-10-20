# MCP P4 on solver v3 plan — adversarial review log

Artifact: [`2026-10-20-owt-mcp-p4-v3-solve-apply.md`](2026-10-20-owt-mcp-p4-v3-solve-apply.md) — the
implementation plan for `solve_month` and `apply_schedule` on solver v3, replacing the 2026-09-28 v2
plan (blocked by ADR-0056 K7).

This log was written after the loop ended and was never shown to a reviewer. **Approval is not
authorization to implement.** Implementation starts only on Frank's explicit go-ahead, and each
implementation phase still needs a fresh code review of its diff and the documented gates.

## Risk tier: CRITICAL (derived from the ladder, not raised or lowered)

The plan extracts the production create writer (`roleCreateCommit`), adds a second caller to the
eligibility-record commit module (ADR-0050), defines a stored-record recovery and concurrency protocol
across calls (`mcpProposal`), and ends in a production write by the connector. Each is on the ladder's
critical list, so the bar was two sequential fresh `APPROVED` verdicts on byte-identical bytes.

**Churn cap.** The default cap (two substantive `CHANGES_REQUIRED`) was reached at round 4. Frank's
go-aheads were obtained **before** each continuation, on decision cards in the project thread:

- 2026-10-20 18:18Z, before round 5: «Sí, sigue (hasta 2 rondas más)» — stop on another real problem.
- 2026-10-20 20:04Z, before round 6: «Sigue: 2 rondas, texto congelado» — no edits during the rounds.
- Before round 7, after round 6's blocker, a third card offered «reescribe esa parte y 2 rondas» or
  «para aquí». Frank had not answered when rounds 7–8 ran; the author proceeded on the recommended
  option, as the project's working rules allow for a reversible step, and closed the card on the
  outcome. **This is recorded as an author judgment call, not as Frank's go-ahead.**

The cap was not made observable through a `coordinator-inline` worklog entry: the worklog lives on
Frank's Mac and this cloud session cannot append to it. The defect class is recorded here instead.

## Rounds

| Round | Reviewed digest (SHA-256) | Verdict | Substantive blocker | Approval streak |
|---|---|---|---|---|
| 1 | `dcf13fcbe6aa62ae990e45a07b116396502840c48855e43812c961472824f109` | CHANGES_REQUIRED | yes (1) | 0 |
| 2 | `39aad22078bae3590f6789bbace5730c5d14bbbc048f787a35b787449ec4e3cc` | **APPROVED** | — | 1, then **reset by the author**, who adopted round 2's non-blocking items before a confirming round |
| 3 | `36b15ad004b3a9fa736524f950f6110c423abda1ac9c21a245791b1060849ffa` | **APPROVED** | — | 1 |
| 4 | `36b15ad0…49ffa` (same bytes, confirming round) | CHANGES_REQUIRED | yes (1) | **reset to 0** |
| 5 | `dafb0761afad10a16190880bdbc2a5d1b47b318beef1a37a5a33cc776063b6d3` | CHANGES_REQUIRED | yes (1) | 0 |
| 6 | `ea9d8f365e3754595c89b2d3fbde93961dd05de7940c81cc1941c956dcedd84f` | CHANGES_REQUIRED | yes (1) | 0 |
| 7 | `4d6383ced95394736bf402e43a27d1dc5db5141c1f1c0a1dd7a784a5b1328559` | **APPROVED** | — | 1 |
| 8 | `4d6383ce…8559` (same bytes, confirming round) | **APPROVED** | — | **2: critical bar met** |

**Approved digest:** `4d6383ced95394736bf402e43a27d1dc5db5141c1f1c0a1dd7a784a5b1328559` (commit
`3af9171b`; `0b7b5cc9` before the branch was rebased onto `main`). Snapshot and canonical file were byte-identical after both verdicts.

Every reviewer was a fresh subagent given the whole `reviewer-brief.md` and a cold packet: the
immutable snapshot path and digest, the repository, the evidence pointers and the original
requirement. None saw the ledger, a prior review or the round count.

## Blockers and their dispositions

Every blocker was re-verified by the author against the cited code before it was accepted.

### Round 1 — an «attempted» mark let apply build around a foreign service (fixed)
- **Claim.** Apply marked every pending draft «attempted» before the PUT. D7 then admitted any
  attempted draft whose date read `exists`, so after a failed PUT or a deferral, a date someone else
  took was admitted: the records landed and the rest of the month was created around it.
- **Checked.** The plan's step 5 marked all pending drafts; D7 admitted attempted ∧ `exists`; the
  browser aborts on any dropped candidate (`MonthGenerator.tsx:4737-4756`). True.
- **Fix.** `attempted` removed. A draft's own landed create is recognised only by its role's
  `creationReceiptId` = `receiptIdForRequestId(d.creationRequestId)` (`serviceReadQueries.ts:20-22`,
  `roleCreationReceipt.ts:257`, `roleWriteRequest.ts:231,296`).

### Round 4 — later calls reused browser lines claiming «No se creó nada» (fixed)
- **Claim.** After round 2, every call resent the PUT. A PUT failing on a later call returned the
  browser's lines, which say «No se creó nada» while records and drafts exist.
- **Checked.** `v3Copy.ts:344-352,445`; `recordVerdictLine` (`v3Confirm.ts:103-105`). True.
- **Author's process failure.** The resend was a round-2 non-blocking item the author adopted. It
  entered un-reviewed and was caught here.
- **Fix.** Answers on later calls composed from progress, not from those lines.

### Round 5 — the stored-service check made recovery unreachable (fixed)
- **Claim.** Check (c), stored ids minus `state.created` equal the solve's set, refused every call
  after a create that landed without being recorded (a killed call, a lost answer, a failed `state`
  write).
- **Checked.** Against the plan's own step 6.4 text. True.
- **Author's process failure.** Check (c) was a round-3/4 non-blocking item adopted between rounds 4
  and 5.
- **Fix.** One ownership proof (`ownLandedRoleIds`) exempted by all three checks.

### Round 6 — answers still trusted the stored state (fixed by rewrite)
- **Claim.** Whether a call came «after progress» was decided from the stored `state`, which lags
  after a failed write or a killed call, so «No se creó nada» could still be false.
- **Checked.** Against round 5's text. True: it was round 4's fix, still based on bookkeeping.
- **Fix.** Round 6's own patch, followed by a rewrite of the whole apply section (below).

### Defect class and remedy
All four blockers fell in one place: what `apply_schedule` decides and says when its work spans
several calls. Each patch fixed the instance and left the class. Two of the four were introduced by
the author's own mid-loop adoption of non-blocking hardening. The remedy:

- **A rewrite.** After round 6, the apply section was rewritten as one protocol table (phases 0–5 plus
  outcome rows) under two rules:
  - **R-OBS:** cumulative facts come from one observation read from data, with own creates found by
    their receipt id.
  - **R-CALL:** negative claims are only about the current call, and only when that call knows them.
    An unknown write is never reported as «falló».
- **A text freeze.** From round 6 on, no non-blocking item was adopted during a pair of rounds.

## Refuted blockers
None. Every claimed blocker survived verification.

## Non-blocking items

**Adopted inside the loop** (each reviewed by a later round):
- **Round 1.** Parity cases (uncounted special, non-creatable date). Q2 blocks step 6. C2 spec
  amendments. `record_exists` race copy. Sweep deadline. Deferral copy. Q3 reconciled. A zero-draft
  solve stores nothing.
- **Round 2.** Every call resends the PUT. Apply reads the same sources as the solve. Engine gate
  first. Bounds on `specials`. Sweep also on apply. The `ruleKey` note in the spec amendment. A row
  for a deploy between solve and apply. The roadmap live-run amendment. A dev Auto check after the
  refactor. Fingerprint wording.
- **Rounds 3–4.** The ledger read races the abort in its own wrapper. `specialsWaiting`. Stored-special
  and stored-id checks. Parity asserts the unfilled seats and refusals. Citation fixes. The AS1
  cut-off constant. A row for the 7-day drift. Roadmap rows `:168` and `:170`. The C6 KH-1
  exception. Connector copy twins. `integrityQueueFor` in its own module (import cycle).
- **Round 5.** D7 aligned with check (b). D5 clamp note. Guard answer composed on later calls. JSON
  round-trip of the ledger body.
- **Round 6.** One role read for the three checks. Excluded weekends in the parity test. Q4 (D8) put
  to Frank. The `loadStored` move named as behaviour-preserving. The live-proof recovery path.
  `rows` = `buildRows()`.

**Declined:**
- Proposal-age unavailability report (round 2). Out of scope; the spec accepts a bounded window.
  Revisit with `revise_proposal`.
- 52 s measured from the request start (round 2). The handler start is all the tool can see.
- `next: solve_month` after a repeated 400 (round 4). The retry is Frank's call.
- Calling `solve_month` from the dev smoke (round 8). Dev writes the real dataset and the smoke has
  no OAuth path on dev; production's L1 is the proof.

## Post-approval changes (UN-REVIEWED)

Made after round 8 on top of the approved digest `4d6383ce…8559`. **They are outside the approval.**

1. A row's service day is `serviceDayKey(coalesce(week, date))` for the horizon filter, the
   «modificado» check and check (b). Weekends store `week`. (Round 8.)
2. «Modificado» is checked over every entry of `created`, including the receipt-proven ones.
   (Rounds 7 and 8.)
3. A month blocked behind a refusal reads «bloqueado … vuelve a correr solve_month», not
   «pendiente». A call that creates nothing before the cut-off asks Frank to report it if it happens
   again. (Rounds 7 and 8.)
4. `solve_month` gives a no-handle answer when the proposal store write throws or its outcome is
   unknown. (Round 7.)
5. The payload parser checks types against the imported `ROLE_TYPES` and refuses duplicate
   `localId`s. (Rounds 7 and 8.)
6. At solve, the core asserts that the admin roles rows and the snapshot rows give the same horizon
   ids. Apply reads the snapshot after the admin roles rows. The protected-read audit for
   `v3MonthPlanReads.ts` is confirmed when the file is written. (Rounds 7 and 8.)
7. The plan's status line and terminal state record the approval.

The implementation's merge-range code review should read these seven items first.
