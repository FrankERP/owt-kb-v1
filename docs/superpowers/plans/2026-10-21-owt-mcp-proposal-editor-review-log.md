# MCP proposal editor plan — adversarial review log

Artifact: [`2026-10-21-owt-mcp-proposal-editor.md`](2026-10-21-owt-mcp-proposal-editor.md) — the plan
for the interactive screen where Frank edits a `solve_month` proposal before loading it, with rule
warnings (his request, 2026-10-21 00:05Z).

This log was written after the loop ended and was never shown to a reviewer. **Approval is not
authorization to implement.** S2–S4 start only on Frank's explicit go-ahead, and each still needs a
fresh merge-range code review and the documented gates. S1 (the read-only card, standard tier) was
implemented and released alongside the review on Frank's instruction (02:15Z), PR #159, `2744278b`.

## Risk tier: CRITICAL (derived from the ladder, not raised or lowered)

Slices S2–S3 produce the input of a production writer (`apply_schedule`), cross the mutation trust
boundary (an edit arrives from a client and is judged on the server), change a digest-bound record
contract, and define a multi-record supersede protocol. Each is on the ladder's critical list, so
the bar was two sequential fresh `APPROVED` verdicts on byte-identical bytes. Only E1–E7, Q1 and
S2 were in scope; S1 and S4 are standard.

**Churn cap.** The default cap (two substantive `CHANGES_REQUIRED`) was reached at round 2. Every
later round ran on Frank's go-ahead, given on a decision card in the project thread BEFORE it ran,
with his standing instruction «si encuentra algo, paro y te aviso»:

| Before round | Frank's card (UTC) |
|---|---|
| 3 | 00:40:28 «Sí, sigue revisando» |
| 4 | 00:54:51 «Sí, lanza la 4» |
| 5 | 01:02:32 «Revisor propio de reglas» (a design choice, below, plus the next round) |
| 6 | 01:12:51 «Sí, sigue» |
| 7 | 01:24:14 «Sigue, con forzar rehecho» |
| 8 | 01:35:24 «Sí, lanza la 8» |
| 9 | 02:05:24 «Sí, lanza la 9» |
| 10 | 02:15:22 «Ronda 10 y empieza la tarjeta» |
| 11 | 02:32:46 «Ronda 11, mejoras después» |
| 12 | 02:43:00 «Corrige todo y lanza la 12» |
| 13 | 03:02:01 «Ronda 13, mejoras después» |

The cap was not made observable through a `coordinator-inline` worklog entry: the worklog lives on
Frank's Mac and this cloud session cannot append to it. The defect classes are recorded here instead.

## Rounds

| Round | Reviewed digest (SHA-256) | Commit | Verdict | Blockers | Approval streak |
|---|---|---|---|---|---|
| 1 | `26fd8c6b5c136c112e524bb6a894a3e490796bf66283db83f98a364436fc6b51` | `2d798c4e` | CHANGES_REQUIRED | 6 | 0 |
| 2 | `f908e8535c024dc850a11238f7156f657287aa70bcd2ac25996d88c4a600a7f0` | `d1743254` | CHANGES_REQUIRED | 2 | 0 (cap reached) |
| 3 | `7e4a7beecad4fc4827686051a31555f0ac90d1e914ecce3d7e19f0d538ee994d` | `b0e5ec0e` | CHANGES_REQUIRED | 2 (both author-introduced) | 0 |
| 4 | `0c05d62876cc47e5df333e4accfbbde9ad58b6cfca6de1ec3a53203320249980` | `f8ecb48c` | CHANGES_REQUIRED | 2 | 0 |
| 5 | `7c7c8a06a17aa511040cf9190205b70fae4eb5871f44eee07d05b91b4cf035ea` | `db6fff1b` | CHANGES_REQUIRED | 1 | 0 |
| 6 | `d5099a410170b9d54bd903ba7b6034124dde5e21f015cd69a8abffb420949f3a` | `7d8e0ca7` | CHANGES_REQUIRED | 2 | 0 |
| 7 | `d3c41953c2fd452bf12f7169092ba72b0ad8a5a9c1fdfbab89e719e2d1ba5aa1` | `8601b5e4` | CHANGES_REQUIRED | 2 | 0 |
| 8 | `f2bd8cb8cf27db2abf7505b60b5430a00619309c218701d4d1d49905e8b70e77` | `cb1ed873` | CHANGES_REQUIRED | 1 | 0 |
| 9 | `2d2bf61f436e2fed645ce6ec45f0b5f1964635f1817fd2a8f7a82a99af99b01c` | `f7a9f24e` | CHANGES_REQUIRED | 2 | 0 |
| 10 | `d113453bf4f81d28a9ca80b5e0b6661ec452ae2484f61a29bb6f6eb7ade211f7` | `0bb87b42` | **APPROVED** | — | 1 |
| 11 | `d113453b…11f7` (same bytes, confirming) | `0bb87b42` | CHANGES_REQUIRED | 1 | **reset to 0** |
| 12 | `32bb32ca7d4bb6b9d954d1ce3091800355f15e877cafb80b21754837dd7c7ff0` | `9ecf36e1` | **APPROVED** | — | 1 |
| 13 | `32bb32ca…7ff0` (same bytes, confirming) | `9ecf36e1` | **APPROVED** | — | **2 — approved** |

Each reviewer was a fresh `skeptical-reviewer` given the canonical brief, an immutable snapshot whose
digest it verified, and the repository at the round's commit; none saw an earlier round. Every
claimed blocker was verified against the cited code before it was fixed.

## Blockers and how each was resolved

- **R1** (6): the all-fixed solver check was not all-fixed (planned services `fixed:false` plus
  prefill); `evaluateMove` answers `unresolved` for a pick from the pool, so it cannot judge `place`;
  a base could fork (apply's `writeState` merges); «Claude can never force» was unenforced; the
  record contract (fixed digest list, `hasOnly`) had no room for waivers; the candidate list could
  name kids-only members (I5). Fixed with per-gesture gates, one create+supersede transaction,
  payload v2 with waivers that apply must echo, and a worship-audience filter.
- **R2** (2): the judge's inputs failed open (no column/config/spine = no rule; a pinned ineligible
  person is accepted silently by the solver); the all-fixed check was blind to an empty Lead or seat.
- **R3** (2, both introduced by the author's R2 fix): the new safety net refused breaches the solver
  itself had made; T4.2 still routed the screen's save through `revise_proposal` (no `force`).
- **R4** (2): the solver clamps `>=`/`==` to the pinned availability on fixed services, so it cannot
  judge "rules as written"; waiver inheritance re-judged through a self-exempting verdict.
  → Frank chose an OWN month checker with a parity test against `gcf_v3/acceptance/checker.py`.
- **R5** (1): the parity guard was a one-time snapshot → fixtures asserted by both suites.
- **R6** (2): the per-seat single reason (`ruleViolationsForColumn`) lost multi-rule waivers; the
  parity fixtures could pass vacuously → whole-board invariant; per-family non-vacuity asserted.
- **R7** (2): pair-linked forced seats were unsavable → finding-level waivers, `force` = the board
  diff; S2's `gcf_v3/**` change redeploys the production solver → verify that deploy.
- **R8** (1): the findings source kept one reason per seat → a structured `ruleFindings` keyed by
  rule identity.
- **R9** (2): rule keys may spell first names (KH-1) → rules keyed by kind and config ordinal,
  members cross as HMAC tokens; the month check ignored the solver's named protections → added, with
  parity against `checker.py`'s `_protections`.
- **R11** (1): the gate's inputs were hardened but the finder's were not, so a forced week exclusion
  could be stored with no waiver → ONE input builder (`columnRuleInputs`) for gate, finder and safety
  net, and a gate/finder cross-check that refuses on disagreement.

## Defect classes

1. **Reuse at the wrong granularity** (R1, R2, R4): a planner or solver piece reused without the
   context it is assembled or run in, so it judged something else. Remedy: reuse whole call paths
   (`judgePick` extracts `rankFor`'s assembly, the adapter is `buildV3SolveRequest`), plus an
   independent post-check.
2. **The waiver chain** (R1, R3, R4, R6, R7): found defective five times; the remedy was structural,
   not another patch — finding-level waivers under one whole-board invariant.
3. **A correction that reached one judge and not its twin** (R3, R8, R11): fixed structurally by a
   single shared input builder.

## Non-blocking items

Adopted before approval (and so reviewed): every non-blocking item of rounds 1–11 that the author
verified, including in round 12's text all of rounds 10–11 (`force` carries `confirms`, waivers
dropped only with their seat, a digest-bound `root` for tokens, one shared fairness-ledger assembly,
the `>=` family added to the parity generator, the protection codes enumerated, the Q1 wording for
month rules, I5 on the name lookup).

**Adopted AFTER the final approval — un-reviewed** (the plan's §8, A1–A6; S2's merge-range code
review checks them against the code):

- A1 — eligibility from the frozen entries; what a ledger failure still judges (rounds 12, 13).
- A2 — the adapter overrides the builder's fixed/pinned specials and judges the board (12, 13).
- A3 — a builder or rule-resolution refusal makes the check «sin revisar», never blocks a save (13).
- A4 — every confirmed force stores a waiver, even with an empty diff; unforced breaches stay
  warnings and are named next to Q1 in the ADR (12, 13).
- A5 — `confirms` crosses the wire as member tokens (13).
- A6 — the ADR names the accepted base-apply/child-save race (12).

Not adopted: none.

## Open before implementation

- Frank's go-ahead for S2–S4.
- Frank to acknowledge Q1's exact wording (plan §3 and A4): per-seat rules are the only ones forced
  and everything he forces reaches apply's permission prompt; month rules are warnings for everyone,
  the chat included, and are not in that prompt.
