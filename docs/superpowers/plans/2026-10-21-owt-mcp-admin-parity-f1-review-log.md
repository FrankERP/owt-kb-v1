# MCP admin parity, phase 1 plan — adversarial review log

Artifact: [`2026-10-21-owt-mcp-admin-parity-f1.md`](2026-10-21-owt-mcp-admin-parity-f1.md) — the
plan for editing a month's SAVED services from the chat (the proposal-editor card over a stored
month, plus plain chat requests), Frank's request of 2026-10-21 15:48Z: «Quiero poder hacer todo lo
que hago en la página como admin, pero desde el chat».

This log was written after the loop ended and was never shown to a reviewer. **Approval is not
authorization to implement.** Building starts only on Frank's explicit go-ahead, and the delivery
still needs one fresh merge-range code review and the documented gates.

## Risk tier: CRITICAL (derived from the ladder, not raised or lowered)

S2 is a production writer over several role documents reached from the chat, a full-array seat
serializer (the roles PATCH replaces all five sections), and a mutation trust boundary (an edit
arrives from a client and is judged on the server). The bar was two sequential fresh `APPROVED`
verdicts on byte-identical bytes. In scope: §2 F1–F8, §3 and §4 S2 (T2.1–T2.6); §1 and S1/S3/S4
were context only.

**Churn cap.** The default cap (two substantive `CHANGES_REQUIRED`) was reached at round 2. Every
later round ran on Frank's go-ahead, given on a decision card in the project thread BEFORE it ran:

| Before round | Frank's card (UTC) |
|---|---|
| 3 | 16:37 «Parchar y seguir» (keep the per-service save rather than the all-or-nothing draft, and patch it) |
| 4 | 16:46 «Seguir con la ronda 4» |
| 5–7 | 16:57 «Hasta 3 rondas más» (stop at two consecutive approvals) |

The cap was not made observable through a `coordinator-inline` worklog entry: the worklog lives on
Frank's Mac and this cloud session cannot append to it. The defect class is recorded below instead.

## Rounds

| Round | Reviewed digest (SHA-256) | Commit | Verdict | Blockers | Approval streak |
|---|---|---|---|---|---|
| 1 | `64697a1d8cef741f4a905b26466b93ca1c92112f916531412115dc30c97540a0` | `69eb27f9` | CHANGES_REQUIRED | 1 | 0 |
| 2 | `342b649dc1eafc5efda57c701a15b9ebd691ee60ca94bc055d4ce80d4533400d` | `bcc0ef9f` | CHANGES_REQUIRED | 2 | 0 (cap reached) |
| 3 | `05f8439839d9c148849f57a70de8483c1899a1c08c3aa531a86c8794e063d36f` | `ef4a5e97` | CHANGES_REQUIRED | 3 | 0 |
| 4 | `3bb84b1fcd2a375c7de31b8a9200c5b2469f1c57c47fba5d3a4e424d5313a55b` | `471c19c6` | CHANGES_REQUIRED | 1 | 0 |
| 5 | `9892c245159574edbca98559db3d89a28294dec427d95e8281b20e0c96cbed2d` | `00e76289` | **APPROVED** | — | 1 |
| 6 | `9892c245…ed2d` (same bytes, confirming) | `00e76289` | **APPROVED** | — | **2 — approved** |

Each reviewer was a fresh agent given the canonical brief, an immutable snapshot whose digest it
verified, and the repository at the round's commit; none saw an earlier round or the author's
ledger. Every claimed blocker was verified against the cited code before it was fixed. An
all-or-nothing draft (`29c7554e`) was written between rounds 2 and 3 and offered to Frank; he chose
the per-service save, so it was never reviewed.

## Blockers and how each was resolved

- **R1** (1): the permission-prompt lines were compared against CURRENT state, so repeating a save
  after a partial write could never match. → Each change carries its own lines and waivers; the
  save sorts every service first («ya estaba» / «cambió» / «por guardar») and judges only
  «por guardar».
- **R2** (2): one side of a move could land while the other was stale (groups were optional and
  model-carried; the cut-off and a later 409 ignored them); and sending `lockRev` would 409 forever
  once a weekend setlist save heartbeated the lock (`setlistSaveCommit.ts`). → Server-derived move
  groups (at most 6, written back to back, a later-side failure named in words); no `lockRev` on
  the wire (the route reads the lock fresh when it is absent).
- **R3** (3): Next runs `after()` callbacks only once the response closes, so the post-commit tail
  of every write ran after the last write; the layer-2 sweep in that tail could outlive the 60 s
  limit; a refusal on a group's FIRST write was unspecified. → No layer-2 sweep in the MCP save
  (seat notices are debounced 15 minutes anyway); the cut-off measured over the whole call; a
  first-write refusal marks the whole group «no se guardó».
- **R4** (1): with `after()` deferred, a call killed at 60 s lost the notices of every service it
  had already written, and the repeat («ya estaba») never re-queued them. → The outbox upsert runs
  inline and awaited before the next write; every Sanity request is bounded by the time left
  (45 s hard stop); outcomes are classified with `classifyPatchOutcome`.

## Defect class

**Failure and recovery semantics of a non-atomic multi-service save** (R1 retry, R2 half-move and
lock, R3 tail timing and a group's first refusal, R4 notices lost on a kill). Every blocker was in
this one class. The structural remedy (one transaction for the whole save) was offered to Frank
after round 2; he chose to keep `/admin`'s per-service model knowingly, so the class was closed by
patching it: sort-first idempotent repeats, server-derived groups, inline durable side effects and
bounded requests.

## Non-blocking items adopted AFTER the final approval (un-reviewed)

Applied in the commit that adds this log. None was re-reviewed; the merge-range code review covers
their implementation.

- After a refusal, the advice comes from the error code: only lock contention with the `_rev`
  unchanged says «repite la misma llamada»; a re-read equal to the target answers «ya estaba»;
  persistent refusals (`ambiguous_target`, `integrity_conflict`, `invalid_request`) never loop.
  Item 5 now agrees with item 4 (R5, R6).
- A rule a service already broke before the edit, when forced again from the card, still shows in
  the permission prompt, marked «ya estaba rota antes de este cambio», without a token; Q3 says so
  (R5, R6).
- Timeouts: the save passes its own client (`maxRetries: 0`, the time left) through the commit's
  loaders and `specialIdentityCoordinator`, plus an outer deadline; the stalled-request test runs
  at the loaders (R5, R6).
- A failed inline upsert answers «guardado, avisos sin confirmar» (R5, R6).
- Revalidation is queued on the request, not inline; a killed call leaves pages stale until the
  next write, stated (R6).
- A special's setlist saved between check and save answers «cambió» with that reason; test added
  (R6).
- The card shows the derived groups and offers to save in parts when one exceeds 6 (R6).
- `docs/SECRETS.md` lists three new `MCP_OAUTH_SECRET` labels and what a rotation invalidates (R5).
- F3's answer shape includes `diff` and `mac`; `force` is per edit (R5).
- Adding a new instrument or FOH row stays in `/admin` for phase 1, stated in §6 (R5).

Not adopted: re-queuing notices after a «sin confirmar» that did commit (R6 notes it is not
idempotent: `buildUpsert` re-pends and clears `servedRecipients`); it stays a stated limitation,
as on `/admin`.

## Remaining concerns carried to implementation

- The Claude app's own client-side timeout for an MCP tool call is unknown; if it is shorter than
  the save, the model could repeat a call still running (the repeat is safe: «ya estaba» or a
  contention refusal).
- Dev latency per write and for a 6-service group is measured before release; the cut-off (30 s)
  and the group cap (6) only move down.
- Whether a month's `fairnessMonth` record carries everything the month check needs (warnings
  only).
