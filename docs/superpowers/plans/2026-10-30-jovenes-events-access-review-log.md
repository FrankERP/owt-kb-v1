# Review log — 2026-10-30-jovenes-events-access.md

**Tier: critical** (derived from the ladder): the plan creates an ACL boundary between Jóvenes groups
and a production writer with three actors writing different parts of one document. Critical needs two
sequential fresh `APPROVED` verdicts on byte-identical bytes.

**Result: APPROVED** on digest `cf407de92e96b4c52288687111a98cac3a5a19bc12c798e19bddc6d7e8ccd254`
(commit 44c8a9d5), rounds 3 and 4. Approval is not authorization to implement: each PR of §7 still
follows CLAUDE.md's release order, and PR B / PR C each get one fresh code review of their diff.

## Rounds

| Round | Digest | Verdict | Defect class |
|---|---|---|---|
| 1 | `640095ac…8acb` (601ff3b2) | CHANGES_REQUIRED | authorization: the seat-holder program write was authorized by the stored seats alone |
| 2 | `43556e1e…cc3f` | CHANGES_REQUIRED | verification of the boundary: a hand-written GROQ evaluator in the isolation test, and the seat-holder read rule written twice |
| 3 | `cf407de9…d254` (44c8a9d5) | APPROVED | — |
| 4 | `cf407de9…d254` (same snapshot) | APPROVED | — |

## Blockers and dispositions

- **R1 — seat holder writes an event they can no longer read.** Verified: W1/W3 granted the program
  write from `seats` with no read check. Fixed: W3a (fresh access, the member read predicate), W3b
  (writes answer no content), G4 rows.
- **R2 — the isolation test would test a twin, not the GROQ.** Verified: the plan specified a
  GROQ-free evaluator although `app/api/__tests__/adminMemberVisibility.test.ts` already runs
  `groq-js`. Fixed: G3 runs the real query on `groq-js`; R8 makes `mayRead` the one TypeScript
  predicate, held equal to the GROQ by G3; the leader editor arm is written out.

## Non-blocking items adopted before approval (reviewed in later rounds)

The posts DELETE that deletes any id (verified at `app/api/content/posts/[id]/route.ts:42-43`) → W9;
`protectedReadAudit` → G1b; R6 vs `/schedule`'s `revalidate`; the encargado editor reads in member
mode; leaders and joint events put to Frank (§8); idempotent create token (W6); `DATA_MODEL.md` and
the rollout state in PR B; `_weak` stored (D4); `_rev` required (W2a); W5 validates only changed
people; the seat-holder right narrowed to whole-ministry events; the draft-Saturday note; G6 with
unpublished events and rollout `hidden`; R2 inactive; D3 `kind: "ministry"`; the Studio accounts limit.

## Non-blocking items adopted AFTER the final approval — not reviewed

Each was checked against the code before adoption. All narrow or clarify; none widens a read or a write.

- W1: any actor whose fresh read says inactive is refused (`isMinistryManager` ignores `active`,
  `app/utils/ministryAccess.ts:27-31`); impersonation stance stated (effective id, as every guard).
- W2: the stored read carries R1's identity filters; a missing, foreign-type or other-ministry id
  answers 404, never 403 (`kidsCommit.ts` precedent).
- D2/R2: the member arm's groups branch now also requires `audience.kind == "groups"`, so an unknown
  `kind` with valid groups is seen by no member, as D2 already claimed; G3 gains that case.
- W4/W5: kept items keep their stored `_key`; «kept as it was» = same `_key` and same `member._ref`
  (and seat `role`); G4 covers a departed person's program line.
- G1: the match rule named (token `\bministryEvent\b` outside import specifiers, any quote style,
  plus exported type constants); scans `sanity/**` too; R6's no-`unstable_cache`/no-`revalidate`
  rule enforced there. G1c added: only the four routes import `ministryEventCommit.ts`.
- W3a: a never-published Saturday answers «Este evento todavía no está publicado.».
- W6: the create token is lowercased; the «never accepts an id» sentence made consistent.
- Wording: W-sections in order, PR B's garbled sentence rewritten, posts citation 42–43, §2's
  teamMembers count updated (59 → 37 after the Kids roster removal).

Not adopted: nothing.

## Process notes

- The churn cap (two substantive `CHANGES_REQUIRED` rounds) was reached after round 2, 2026-10-30
  ~02:20Z. Frank gave the go-ahead for up to three more rounds on 2026-10-31 00:41Z («Sí, hasta 3
  rondas más»). Two were used.
- Each reviewer was fresh, got the reviewer brief, the immutable snapshot path and digest, evidence
  pointers and Frank's requirement verbatim, and never saw earlier rounds. Both approving reviewers
  ran the plan's GROQ on `groq-js` and confirmed untokened that dotted ids are invisible.
- Left UNVERIFIED by the reviewers, owned by the rollout: who holds Sanity project accounts (§8), and
  the real Sanity API's evaluation of `_id in path("ministryEvent.*")` with a token (G6 on dev).
