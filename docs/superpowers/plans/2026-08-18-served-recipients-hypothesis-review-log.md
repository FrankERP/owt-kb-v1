# Review log — 2026-08-18 served-recipients hypothesis

Incident firefight (one round, one-paragraph hypothesis).

**Snapshot:** `docs/superpowers/plans/2026-08-18-served-recipients-hypothesis.md`
**SHA-256:** `dc7869ac0731148a5a6666c3121de02e1eae75a7ec23ebc35e2a7c2d83705101`

## Round 1

- Reviewer: skeptical-reviewer (cold)
- Verdict: **CHANGES_REQUIRED**
- Blocking: `servedRecipients` must be cleared on the writer debounce patch (`buildUpsert` `patchSet`), or people already attempted miss a later edit on the same subject during the multi-tick drain.
- Applied: `patchSet` and `createIfNotExists` set `servedRecipients: []`; re-pend persists the union of prior served + this sweep's attempted ids for that notice only.
