# Review log — `2026-10-05-solver-v3-c3-cadence-config-design.md`

Written after the loop ended; never shown to a reviewer. **Approval is not authorization to
implement** — C3 has no implementation plan yet; implementation still needs its own plan, the four
gates, and a fresh code review of the diff before any merge to `main`.

## Tier

**Critical**, derived from the ladder, not raised or lowered: the artifact changes the validator,
the serializer and the whole-document writer of `solverConfig` (`POST /api/admin/solver-config`
`set()`s every parsed field under `ifRevisionId`, `app/api/admin/solver-config/route.ts:111-163`).
That is a destructive full-document serializer and a production writer — the one document that drives
the planner's hard blocks for every admin on production and on Preview alike. A field an older
writer drops silently is the failure class the spec exists to close. Requirement: two sequential
fresh `APPROVED` verdicts on byte-identical bytes.

## Rounds

C3 ran in two loop sets. It was not part of the third (see «Approval resets» below).

| Set / round | Reviewed digest (SHA-256) | Commit | Verdict | Streak |
|---|---|---|---|---|
| 1 / 1 (2026-10-05, snapshot 19:12 CST) | `fef78d00442236b66bb22dae18633c90386f705c35a14ff88e9070d1bf8a8b14` | `c2c444fd` (committed bytes) | CHANGES_REQUIRED (substantive) | 0 |
| 1 / 2 (snapshot 19:29 CST) | `c78800b037a75a11b821e4ccbca7284a25aa09c0d4ada928be95396abceede68` | uncommitted working copy on `c2c444fd` | CHANGES_REQUIRED (substantive) | 0 — **churn cap reached** |
| — | `480327daab7ffdcb…` (round-2 fix, committed in `2c403a0f`) | `2c403a0f` | **never reviewed** | — |
| 2 / 1 (snapshot 22:08 CST) | `755f4749aa951454d847073756675b85d861e61620f221823fef3e6dc4730706` | uncommitted working copy on `2c403a0f`; committed unchanged in `1d1bba18` | APPROVED | 1 |
| 2 / 2 (snapshot 22:22 CST) | `755f4749aa951454d847073756675b85d861e61620f221823fef3e6dc4730706` (same bytes) | same | APPROVED | 2 — requirement met |

Every reviewer was a fresh `skeptical-reviewer` instance, run one at a time for this artifact (loops
on different artifacts of the program ran in parallel), and given only the reviewer brief, the
immutable snapshot path and digest, the repository, evidence pointers and the redacted original
requirement. None saw another's verdict. Each round copied the canonical file to an immutable
snapshot in the private log repository and hashed the snapshot and the canonical file before the
reviewer started and after the verdict; the digests matched in all four rounds (`postDigestsMatch`).
The two set-2 snapshots are byte-identical (same size, same SHA-256), and `1d1bba18`'s blob of the
spec hashes to `755f4749…`.

**What the approval covers.** Between set 1 and set 2 two edits landed with no verdict between them:
the round-2 blocker fix (`480327da…`, `2c403a0f`) and the interface-consolidation pass (citations of
C2's IF2 IDs, plus one corrected sentence in §7 item 4 about which callers import the resolver; no
C3 name, shape or behaviour changed). The approval covers their combined result, `755f4749…`;
`480327da…` itself has no verdict.

## What the reviewers checked (evidence, not claims)

- No code drift under the spec's citations: `git diff --stat 3dbc189b <HEAD> -- app sanity scripts
  docs/DATA_MODEL.md CLAUDE.md` empty in every round.
- The whole-document writer and its order (gate → JSON → `rev` → parse → load → `_rev` →
  `patch().ifRevisionId().set(fields)`), and that `set()` replaces the whole `restrictions` array, so
  a nested field the parser drops is erased (`route.ts:111-163`).
- The parser drops unknown fields on purpose, pinned by a test (`solverConfigWriteRequest.ts:32-35`;
  `__tests__/solverConfigWriteRequest.test.ts:204-209`); the reader rebuilds restrictions from an
  explicit field list and the client normalises GET and POST echo through it
  (`solverConfigWriteRequest.ts:351-399`; `solverConfigSource.ts:88-98`).
- Error mapping that the version guard relies on: `invalid_request` → 400, `stale: false`, the
  «rejected» message; `stale_revision` → `stale: true`, «Recargar reglas»
  (`solverConfigSource.ts:104-111`; `serviceMutation.ts`).
- The form rebuilds a restriction from its own state and `canAdd` needs a clause
  (`MonthGenerator.tsx:664`, `:675`); `v2View` is the exact complement of today's `canAdd`.
- `solverPools` injects every restriction person and has exactly two callers, `buildSolveRequest` and
  the pin board (`plannerModel.ts:858-927`, `:1306-1314`; `MonthGenerator.tsx:2572`;
  `pinModel.ts:261-270`); every other restriction reader reads clause fields only (E10's list).
- Name matching (lowercase + trim, first match; `memberRuleNames.ts:37-45`,
  `plannerModel.ts:572-578`); `rolesOfPattern`'s five keys with no `Sat.Choir`, and the form's
  11 patterns (`plannerModel.ts:613-650`; `MonthGenerator.tsx:310-322`).
- The other writers of `solverConfig` (member DELETE patches only the pool arrays; a one-off
  rule-name repair script in `scripts/` patches one `person` path; the seed creates only); no MCP
  reader or writer; Studio hidden and read-only; Capacitor loads the live origin, so the iOS app is
  covered by the same guard.
- Set 2: the members route projects `ministries` and binds `$all` for super-admin only, and the
  runtime objects keep `ministries` (`app/api/admin/members/route.ts:20-32`;
  `serviceSourceState.ts:151-153`); the new runtime import `solverConfigWriteRequest` →
  `plannerModel` is neutral (no `"use client"`, no `server-only`, no cycle) and resolves under tsx.
- Parent amendments touching C3 and the sibling restatements of §7 (C2 RES-3/5/7/8, WR-4/5,
  IF2-15/16/18/27; C4; C6 IF-C3; C7) were read against the spec.

Left unverified by every reviewer, and owned by the spec as pre-merge checks: §9 A1 (Vercel Skew
Protection off), E24 / A6 (no stored overlapping `==` pair — private evidence, re-checked before the
merge) and A5 (cadence-member names unique — C7's rehearsal checks it).

## Blockers

### Set 1, round 1 — one blocker

| # | Blocker | Disposition | Evidence checked |
|---|---|---|---|
| 1 | §11's UI-only rollback removed the «Domingo» control without keeping the form's data path. `PersonRestrictionForm` builds `onAdd`'s restriction only from its own state, so after the rollback, editing any cadence card (say, to change a cap) would write the restriction without `sundayCadence`; the client still sends `configVersion` 2, so the guard does not stop it, and the chip is gone, so nobody sees it. T7 pins only the serializer's key set and would not catch it. §11 called this rollback «safe at any time», and parent A26 makes it the only rollback once C2 ships. | **fixed** | `MonthGenerator.tsx:646-676` (the form's `useState` fields at `:675`; `canAdd` at `:664`). §11 now keeps the form carrying `sundayCadence` from `initialValues` to `onAdd` and `canAdd` accepting a cadence-only restriction; `SOLVER_CONFIG_VERSION` stays 2; T11's deep-equal preserve-on-edit test (fixture carrying every field) and its cadence-only `canAdd` test survive the rollback unmodified, with T7, T8 and T14; a rollback that removes or edits them is a full revert. §6.6 states edit preservation as a property of the form, not the control. |

### Set 1, round 2 — one blocker

| # | Blocker | Disposition | Evidence checked |
|---|---|---|---|
| 1 | The roster behind every «exactly one member» check is not the worship roster for the real operator. `/api/admin/members` returns every member — kids-only included — to a super-admin, and nothing downstream filters by ministry, while `RosterMember` had no `ministries` so the resolver could not filter. Consequences: a false «Nombre ambiguo» chip under v2 for the super-admin only; under v3, spurious Auto refusals that change with the viewer's role; a rule name matching only a kids-only member would resolve to her; and C2 RES-5 already defined the roster by ministry, so two children disagreed about one shared contract. | **fixed** | `app/api/admin/members/route.ts:20-32` binds `$all` to `role === "super-admin"` in `WORSHIP_MEMBER_GROQ_FILTER` (`app/ministries.ts:74-77`); `ServicesPanel.tsx:435`, `:990`, `:1041` pass `members` on unfiltered; the planner's `MemberOption` types (`MonthGenerator.tsx:129-137`, `serviceCardModel.ts:96-110`) omit `ministries` although the route projects it. Fix: new E25 records the role-dependent roster; §6.5 defines the roster by `normalizeMinistries(...).includes("worship")` and has the resolver apply that predicate itself, so one config gives one answer for every viewer; §7 item 4's `RosterMember` gains `ministries?: unknown` and all three functions drop non-worship members before matching; §5 widens both `MemberOption` types; a §7 obligation requires every caller to pass `ministries` unstripped; A4 rewritten as a superset-carrying-`ministries` assumption; a §8 row explains why the filter lives inside the resolver; T9/T11 gain kids-only-namesake cases. **This changed a §7 shape, so it rippled to C2, C4, C6 and C7** (see «Sibling changes»). |

### Set 2 — none in either round.

## Non-blocking items and their disposition

### Adopted before approval (set 1)

| # | Item (round) | Disposition |
|---|---|---|
| 1 | §6.7's `no_sunday_lead_tipo` sentence is false for a member with «Líder Domingo» but no «Voz» (`memberFitsPoolSubtype` needs both, `plannerModel.ts:806-818`; the Tipo checkboxes are independent, `MembersPanel.tsx:316-323`) (R1) | Adopted, with different wording from the reviewer's (which read as «lacks both»): «… no tiene «Voz» y «Líder Domingo» a la vez en su Tipo …»; T10 gains the case. Only a §7 item-5 constant's value changed. |
| 2 | §6.4 left room to apply the v2 view only inside `buildSolveRequest`, missing `solverPools`' second caller, the pin board (`MonthGenerator.tsx:2572` → `pinModel.ts:261-270`) (R1) | Adopted: the §6.4 invariant now requires `solverPools`' own output and `pinConflicts` to be deep-equal for `C` and `v2View(C)`; T8 adds both and a pinned cadence-only case. |
| 3 | A Vercel Instant Rollback or promote of production past C3 is an unlisted full revert (R1) | Adopted: a §11 bullet (pointing dev at a pre-C3 deployment counts the same) and the §12 ADR bullet. |
| 4 | The §6.12 rollback row overstated the protection: a C3 tab loaded before a full revert still writes once (`route.ts:111-131`) (R1) | Adopted: the row and §11 say so. |
| 5 | Stale parent amendment count (A1–A39 vs A1–A40) (R1) | Adopted: header and §15 say A1–A40; evidence commit moved to `c2c444fd`. |
| 6 | E24's wording («each stored `==` rule on a different person») is false against the 2026-09-29 snapshot (R2) | Adopted: E24 reworded to «some people carry two `==` caps; no two on one person text share a role under `rolesOfPattern`»; A6 stays the pre-merge check. |
| 7 | E15 and A2 grep only `app` and `scripts`; two one-off scripts in the private log repository wrote caps and restrictions without the parser (R2) | Adopted: E15 names them (no member names) as the precedent §7 item 8 supersedes; the §12 CLAUDE.md bullet and the ADR record them. |
| 8 | The bump rule and tripwire covered new fields only; a new allowed value would be rewritten by an older client without a bump (R2) | Adopted: §6.2's bump rule covers «a field or an allowed value an older client would drop or rewrite»; T7 also pins the accepted-value sets. |
| 9 | T11's cadence-only `canAdd` test must be written on the edit path to survive the UI-only rollback (R2) | Adopted: T11 separates the control test (removed with the rollback) from two edit-path tests that survive it. |

### Not adopted into the spec (set 2 approvals, and the later cross-check)

None of these was adopted into the spec: any edit would have reset the approval streak, and the
current bytes still equal `755f4749…`, which proves none landed. No disposition for them is recorded
in the private ledger; they are listed here, **open**, so that C3's implementation plan picks them up.

| # | Item (round) | Status |
|---|---|---|
| 10 | §6.6 says an unresolved cadence name is «already reported by the existing banner» — false for a super-admin whose only match is a kids-only member (v2's first-match banner resolves her; the chip renders only for `ambiguous`). Nothing is silent at Auto: C2/C6 refuse at build time (set 2 R1) | Open — plan: show the chip for `unresolved` too, or correct the sentence. |
| 11 | T8's acceptance list is narrower than §6.4's invariant (`ruleViolationsForColumn`, pin-violation copy, `priorMonthLeadVisibility`, the Saturday helpers; `requestMemberIds`); `isExcludedFromLead` (`leadPoolHistory.ts:37`) is a first-match `.find` that a cadence-only card could shadow if it ever matched — today it compares a name with an `_id`, so it is inert (set 2 R1 and R2) | Open — plan: compare `solverPools` as a whole object and add `priorMonthLeadVisibility` to the T8 corpus. |
| 12 | §11 rule 6 (no cadence saved before production serves C3) is enforced by process only; a production save in that window drops it (recoverable; v2 unaffected) (set 2 R1) | Open — release note. |
| 13 | Client runs `exactCapOverlaps` on the raw config, server after `normalizeLabel`; they agree for every form-produced body only (set 2 R1) | Open — plan wording. |
| 14 | The `{rol}` copy says «as the cap chips name it», but the chips show patterns (`capLabel`) (set 2 R1) | Open — plan pins the role wording. |
| 15 | The seed script gains a runtime `@/` alias import of `plannerModel`; keep T12's dry run as the proof (set 2 R1) | Open — plan. |
| 16 | Guard order vs. auth: §6.2 could be read as putting the version check ahead of `gate()`, answering 400 instead of 403 to a non-manager (set 2 R2) | Open — plan: after `gate()` and the JSON parse, before `parseSolverConfigWrite` and `loadStored`. |
| 17 | `exact_overlap` issue paths use raw document indices, which match parsed indices only because every dropped item returns early (`solverConfigWriteRequest.ts:250`) (set 2 R2) | Open — plan: run `exactCapOverlaps` only after that early return. |
| 18 | Other live pre-C3 writers against the same dataset — older deployments' immutable URLs and `verify/service-readiness` — are not named in §11 (set 2 R2) | Open — ADR or plan line. |
| 19 | A pre-C3 tab sees «El servidor rechazó las reglas…» with no reload hint (unavoidable; old bundle) (set 2 R2) | Open — release note to Frank: reload open admin tabs after step 5. |
| 20 | `not_ticked` copy «descansa este mes» may overstate under v3 for a member still in other pools (set 2 R2) | Open — Frank's wording review (Q-c). |
| 21 | **Key hygiene** (program cross-check after C3's approval, later parent A41 in `cc05dff0`): C3 extends the seed script's dry-run summary and REFUSING diff, which already print raw restriction/conflict/presence ids next to person text (`scripts/seed-solver-config.ts:111-117`); seed-era ids embed first names | Open — routed to C3's plan by the cross-check itself («C3 is approved, so the spec is not edited»): print each item by kind and ordinal with no person text, or record the script as an accepted pre-existing exception (it refuses when the document exists). |

## Sibling changes

The fix rounds requested six sibling edits (one optional from round 1, five from round 2's
`RosterMember` change). They were applied to the sibling specs by their owner agents in later passes,
not by C3's author; status as found on 2026-10-06:

- C7's stale «C3 §11 step 7 still reads …» sentence is gone from `plans/2026-10-05-solver-v3-c7-cutover.md`.
- `ministries?: unknown` and the inside-the-function worship filter are present in C2 (§7.1's C3 row,
  RES-5 — confirmed by the consolidation pass), C4, C6 (RQ-2, RQ-5, WN-2, each with a kids-only
  namesake test) and C7 (its C3 row and rehearsal counts).

## Process notes (author side)

- **Churn cap reached.** C3 hit the cap after set 1 round 2: two substantive `CHANGES_REQUIRED` rounds,
  each blocker verified as genuinely blocking. C2 and C4 hit it in the same set. Before any round
  three the coordinator logged the program's defect class — cross-spec interface drift, siblings
  restating C2's interfaces — and asked Frank (AskUserQuestion); his answer, «Sí, con la
  consolidación», is recorded in the private ledger (~20:35 CST) as the explicit go-ahead obtained
  before round three. The remedy: C2 became the single source of its interfaces (IF2 IDs) and
  siblings cite them, never restate them. «Loops restart with a fresh cap of two substantive rounds
  per artifact» is the coordinator's framing of that go-ahead, recorded in the ledger, not skill text.
- **C3's own blockers were not that defect class.** Both were genuine spec defects (a rollback that
  lost the form's data path; a viewer-dependent roster). The consolidation only changed C3's
  citations; the round-2 fix is what cured its blocker. C3 then approved twice in set 2 with zero
  substantive rounds, so it never approached the renewed cap.
- **Second authorization not load-bearing for C3.** Frank's 22:52 CST message («Me voy a dormir, no
  me consultes más. Te autorizo lo que necesites para seguir avanzando»), recorded in the ledger as
  the go-ahead to continue past the cap without further consultation, was given after C3's set-2
  rounds (snapshots 22:08 and 22:22) and was needed for C2, not C3.
- **Delegated blocker verification.** Each `CHANGES_REQUIRED` round's blockers were verified against
  the repository by a fresh «author» agent, which recorded `fixed` / `fixed-nonblocking-class` /
  `refuted` with evidence (both C3 blockers: `fixed`). The coordinator did not personally re-verify
  every disposition; the evidence column above is the author agent's, cross-read against the
  reviewer's citations.
- **An un-reviewed intermediate state.** `480327da…` (round-2 fix, committed in `2c403a0f`) was never
  reviewed on its own; the consolidation pass edited it before set 2. The approval covers only the
  combined result.

## Approval resets

None for C3. After set 2, a program cross-check required editing C4 (key hygiene, later parent A41),
which reset C4's approval and sent C2 and C4 through set 3. C3 was not edited, so it was not
re-reviewed; its approval stands on `755f4749…`.

## Post-approval changes

**None to the spec.** `shasum -a 256` of the spec on 2026-10-06 is
`755f4749aa951454d847073756675b85d861e61620f221823fef3e6dc4730706`, the approved digest; the last
commit touching it is `1d1bba18`. Two things changed around it and are outside the approval:

- The parent gained **A41** (key hygiene, «every child») in `cc05dff0`. C3's header still cites the
  parent's amendments as A1–A40. A41's consequence for C3 is item 21 above, routed to C3's plan.
- The spec's header still reads `Status: DRAFT`; the approval is recorded here, not in the artifact
  (editing that line would change the approved bytes).

## Approved digest

`755f4749aa951454d847073756675b85d861e61620f221823fef3e6dc4730706` (committed in `1d1bba18`),
two sequential fresh `APPROVED` verdicts on byte-identical bytes. The current spec equals it.
Approval is not authorization to implement.

## Post-approval changes (un-reviewed)

- **2026-10-07, Frank — rule-UI help text (§6.6, «The rule UI», Form bullet).** The original copy read
  as if the member also rested from BGV and Coro; the rule governs Sunday Lead only. Copy only — no
  contract changed.
- **Old text:** «Si el mes anterior no dirigió domingo, está en Líderes Domingo y puede al menos un
  domingo, ese mes le toca uno; en otro caso descansa y, si no dirige domingo, de preferencia dirige un
  sábado. Fuera de Líderes Domingo no le toca ni domingo ni sábado de compensación. Aplica con el nuevo
  solver; el solver actual no lo usa.»
- **New text:** «Solo cambia cuántas veces dirige domingo; en BGV y Coro participa igual que todos.
  Dirige domingo un mes sí y uno no: le toca el mes siguiente a uno en que no dirigió domingo, si puede
  al menos un domingo. En el mes que no le toca, de preferencia dirige un sábado. Solo aplica si está en
  Líderes Domingo. Aplica con el nuevo solver; el solver actual no lo usa.»
- **Digest:** the approved digest `755f4749aa951454d847073756675b85d861e61620f221823fef3e6dc4730706`
  covers the pre-amendment bytes only; the amended spec no longer matches it and this change was not
  reviewed.
- **2026-10-07, Frank — §6.7 warning copy.** «descansa» read as resting from BGV and Coro; the state concerns Sunday lead only. Both warning sentences now end «este mes no dirige domingo ni sábado de compensación.» Copy only — no contract changed. Not reviewed; the approved digest does not cover it.
