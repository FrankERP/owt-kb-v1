# Review log — 2026-11-10-jovenes-place-and-names.md

Skill: `.agents/skills/adversarial-plan-review`. Approval is NOT authorization to implement; the
owner's request (Frank, 2026-11-10 19:10Z) is.

## Tier

**Critical**, derived from the ladder (not raised or lowered): the plan changes the payload of
`ministryEventCommit.ts`, a production server writer (a new stored field `place`, and seats that
may hold a typed `name` instead of a member reference). The UI slice alone would be standard.

## Rounds

| Round | Reviewed digest | Commit | Verdict | Streak |
|---|---|---|---|---|
| 1 | 305542be…1eba | 06ce3426 | APPROVED | 1 |
| 2 | 305542be…1eba | 06ce3426 | CHANGES_REQUIRED | reset to 0 (blocker below) |
| 3 | 69d8d319…7f1dbf | ddee9294 | APPROVED | 1 (new digest) |
| 4 | 69d8d319…7f1dbf | ddee9294 | APPROVED | 2 — done |

Each round was a new reviewer with only the brief, the snapshot path and digest, the evidence
pointers and the owner's verbatim requirement. Snapshot and canonical digests were checked equal
before each round and after each verdict.

## Blockers

- **R2-1 (fixed, substantive — 1 of the 2-round cap).** P7 put «Escribir un nombre…» into
  `PersonSelect` with no scope; `PersonSelect` is also the program editor's picker
  (`ProgramEditor.tsx:156`), whose `programBody` sends only `member` and whose writer drops unknown
  keys, so a typed name on a program line would vanish behind a 200. Verified by reading both
  files. Fix: the typed mode is opt-in (`typedName`/`onTypedName`), passed only by the seat
  pickers, with a test that the program editor offers no typed option; plus the client rule for
  the overloaded view `name` (`memberId === null ? name : null`).

## Non-blocking items

Adopted into r3 (before rounds 3–4): one-line `place`/`name` (`optionalLine`), `place` in
`PROTECTED_FIELDS` (G1b), seat titles renamed so «Lugar» means only the place, `CODE_WORDS` for
`invalid_place`, navigate to another month after a save there, planner-model tests, the ADR note
that a typed group as Encargado gives its leaders no program right, consent and time check for the
§6 data fix. Round 1 had already raised the PersonSelect sharing as non-blocking; it was not acted
on before round 2 because round 1 approved — an author-side miss, recorded here.

Adopted after approval (plan §7, un-reviewed): empty-date guard and header crash, line-break
definition, `invalid_seats` wording, empty `extra` seats skipped, rollback note, extra docs, test
locations, P5 kind drift accepted.

Not adopted: renaming «Casa Fam Varela» (the §6 values go to Frank for his go-ahead verbatim).

## Process notes

- No invalid or ambiguous verdicts. Churn cap not reached (one substantive round).
- Post-approval changes are listed in plan §7 and are outside the approval.
