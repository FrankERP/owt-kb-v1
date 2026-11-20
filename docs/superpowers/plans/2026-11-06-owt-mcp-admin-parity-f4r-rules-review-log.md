# Review log — slice R, the solver rules from the chat (admin parity, phase 4)

Artifact: `2026-11-06-owt-mcp-admin-parity-f4r-rules.md`. Process:
`.agents/skills/adversarial-plan-review/`. Approval is NOT authorization to implement; the build follows
CLAUDE.md's release order and gets its own merge-range code review.

## Tier

**Critical**, derived from the ladder (not raised or lowered): a production server writer of the shared
`solverConfig` document, behind a full-document serializer (a six-field `set`), whose content decides
whether every Auto / `solve_month` can run.

## Rounds

| Round | Reviewed SHA-256 | Commit | Verdict | Streak |
|---|---|---|---|---|
| R1 | `79e07d67…0dae` | 7d3a4f2f | CHANGES_REQUIRED (substantive) | 0 |
| R2 | `9cda92ec…6aff` | 24088257 | CHANGES_REQUIRED (substantive) — **churn cap reached** | 0 |
| R3 | `c685004c…dbec` | 06f81262 | CHANGES_REQUIRED (substantive) | 0 |
| R4 | `0e6be0af…83b1` | 89ffac37 | APPROVED | 1 |
| R5 | `0e6be0af…83b1` (same snapshot) | 89ffac37 | APPROVED | 2 — loop ended |

Every round was a fresh reviewer with only the brief, the read-only snapshot, the repository, evidence
pointers and the requirement (Frank's words). R4 and R5 reviewed the same snapshot; its digest was
checked before each dispatch and matched the canonical file. Between R3 and R4 `origin/main` moved to
943f66da with Jóvenes-only changes; none of the evidence files changed (checked with `git diff --stat`).

**Frank's go-ahead past the cap** (each before the round started, on a decision card in the thread
«MCP de la página»): R3 — 2026-11-06 18:12Z («Sí, una tercera ronda»); R4 — 2026-11-10 17:39Z («Sí, una
cuarta ronda»). R5 is the critical tier's confirming round on R4's unchanged bytes.

**Defect class the rounds kept finding:** «guardado for a change that does nothing, or that stops Auto»
— the chat's check judged the rules document, not what the v3 solver does with it. R1 (persons and pools
the solver refuses), R2 (patterns the solver expands to no role), R3 (nested pools). The remedy was to
make the check use the solver's own functions (`resolveRulePersonId`, `memberFitsPool`,
`resolveMonthEligibility`, `rolesOfPatternV3`, `pooledForRoleKey`) rather than re-deriving them.

## Blockers and dispositions

**R1**
- B1 — R5/R6/R9 accepted persons and pool members the v3 solver refuses (non-worship, no Tipo, a
  «cada semana» person without `voz`) and missed the build-time refusals (`cadence_and_exact`,
  `too_many_presence`, `presence_members`, `exact_count_range`); one chat save could block every Auto.
  **Verified** (`fairnessEligibility.ts:118-282`, `sundayCadence.ts:56`, `v3MonthSources.ts:92-96`,
  `MonthGenerator.tsx:1944-1946, 2086`). **Fixed**: R5 resolves with `resolveRulePersonId` over the
  planner roster plus `voz`; R6 gates adds on `memberFitsPool`; new R11 runs `resolveMonthEligibility`
  before and after and refuses only new problems.
- B2 — the live proof targeted the no-Tipo «Prueba MCP», which would stop every Auto (`no_tipo`).
  **Verified.** **Fixed**: §7 proves on an unreachable «como máximo 31» on a real `voz` member, pools
  check-only, bracketed by `get_solver_rules`, with a rollback.
- Non-blocking, all adopted: bound months in §1; `together` 2–12; R8 ids independent of the token; R7
  `<iat>.<mac>`; tier wording; min above max refused.

**R2**
- B1 — the day × seat grammar admitted `Sun.LeadBGV` / `Sat.LeadBGV`, which both expansions turn into
  no role: saved, worded as a real sentence, silently ignored. **Verified** (`plannerModel.ts:766-793`,
  `MonthGenerator.tsx:429-449`, `v3Rules.ts:14-15`). **Fixed**: R12, only the panel's eleven patterns.
- Non-blocking, all adopted: §1 caps and pairs come from the current rules even for bound months; R11
  on one month (the verdict is month-independent; the impossible test replaced); R9 widened; the
  cadence-outside-pool note; integers only; `notTogether` with one member twice refused; the proof
  member already pooled; `balance exempt:false` as a change.

**R3**
- B1 — v3 pools nest (Sat.Lead = Líder Domingo ∪ Líder Sábado; BGV/coro = any pool), so Frank's own
  «Quita a Mkz de Líder Sábado» can save and read as done with no effect. **Verified**
  (`fairnessEligibility.ts:110-116`). **Fixed**: R13, each pool line carries the before/after of what
  the person can do, says plainly when nothing changes and names the edit that would.
- Non-blocking, all adopted: R9 refuses only new contradictions; the «sábado, coro» hint; the unused
  count field stored as the panel's default; the bound-month disagreement note; a raw snapshot before
  the live proof.

**R4, R5** — APPROVED, no blockers. Their non-blocking notes are dispositioned below.

## Post-approval changes (un-reviewed)

Approval covers `0e6be0af…83b1`. Adopted afterwards, listed in the plan's §9, each a narrowing or a
wording fix: R12's reason and hints (and the hint limited to `never`/`weekOff`), one pattern set with
each picker's own order; R5's stored text must resolve back to the same id; duplicate
`notTogether`/`together` is a no-op; no in-place group edit (a narrowing, a new `ruleKey`); `count`
with several matching caps refused; an absent rules document refused; R11's bound-month note says Auto
refuses, not the save; the token is not bound to the checking super-admin (accepted, as slice M);
§7 step 2 no longer claims bit-identical Auto.

Not adopted: none.

## Remaining non-blocking concerns

- R4 (the lossless gate) was not run against production by any reviewer; if production fails it, every
  chat edit is refused with a remedy, never a bad write. The build checks it read-only first.
- The guard tests named in §6 may need small restructuring to admit a non-service commit module.
