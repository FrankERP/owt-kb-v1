# Review log — `2026-09-22-owt-mcp-design-v2.md`

Written after the loop ended and never shown to any reviewer. **Approval is not
authorization to implement.**

## Result

**APPROVED at critical tier** — rounds A14 and A15, two sequential fresh reviewers,
both `APPROVED` on byte-identical digest
`1068240f906711799efa038abee5d7ae396fa2f150be51faa821e78db76918dd`.
Changes made after that approval are listed at the end and are **un-reviewed**.

## Risk tier and why

**Critical**, derived from the ladder, not raised or lowered: the spec owns an
auth/security/ACL/secret boundary (OAuth 2.1 over NextAuth, per-origin discovery,
token audience), production writers (`edit_setlist`, `swap_assignment`,
`publish_service`, `unpublish_service`, `apply_schedule`) and a multi-document
concurrency protocol (observed revisions, solve → revise → apply).

## Rounds

Base tree: `128479bc` for A1–A5; `4a7ba45d` (after merging `origin/main`) from A6.
Reviewer: a fresh `skeptical-reviewer` (Opus) each round, one at a time, handed the
canonical brief and a cold packet only.

| Round | Digest | Verdict | Blockers | Streak |
|---|---|---|---|---|
| A1 | `7a1337f9` | CHANGES_REQUIRED | 1 | 0 |
| A2 | `d889271c` | CHANGES_REQUIRED | 3 | 0 — **churn cap reached** |
| A3 | `ce4b42b0` | CHANGES_REQUIRED | 3 | 0 |
| A4 | `b74e9146` | CHANGES_REQUIRED | 3 | 0 |
| A5 | `592723af` | CHANGES_REQUIRED | 4 | 0 |
| A6 | `ac971c9b` | CHANGES_REQUIRED | 4 | 0 |
| A7 | `3894f937` | CHANGES_REQUIRED | 1 | 0 |
| A8 | `dc43b329` | CHANGES_REQUIRED | 1 | 0 |
| A9 | `c98d2ef0` | CHANGES_REQUIRED | 2 | 0 |
| A10 | `ae8a5725` | CHANGES_REQUIRED | 1 | 0 |
| A11 | `7dc7a6e4` | CHANGES_REQUIRED | 2 | 0 |
| A12 | `9cd3daed` | **APPROVED** | 0 | 1 |
| A13 | `9cd3daed` | CHANGES_REQUIRED | 2 | **reset to 0** |
| A14 | `1068240f` | **APPROVED** | 0 | 1 |
| A15 | `1068240f` | **APPROVED** | 0 | **2 — approved** |

**Go-aheads past the churn cap, each obtained from Frank before the next round:**
after A2 ("consolidation pass, then resume"); after A3 ("thin Part II and resume");
after A4 through A11, one round at a time; then a standing go-ahead after A11
("sigue hasta approval, cap de 20").

## Blockers and dispositions

Every blocker below was independently verified against the cited code before it was
fixed. **None was refuted.**

- **A1** — `publish_service` was specified against `/api/admin/roles/publish`, which has
  no readiness logic and no app caller; `ServicesPanel` publishes only through
  `publish-ready`. *Fixed* (ledger F1; tool bound to the `publish-ready` path, override
  never exposed). Evidence: grep of callers; `publish-ready/route.ts` header.
- **A2** — (1) "drafts visible" and "subject to D1" were incompatible: `MAY_SEE_DRAFTS`
  covers `api/admin` and `serviceReadQueries.ts` only; (2) the solve/apply split captured
  `_rev` at apply time; (3) the ministries filter's polarity was inverted — `$all` is the
  super-admin arm. *All fixed.* Evidence: `draftGatingCoverage.test.ts:96-104`;
  `roleWriteOps.ts:224`; `ministries.ts:44-77`, `members/route.ts:31`.
- **A3** — (1) participation and the P2 history derivation *are* draft-gated reads;
  (2) `get_service` was pointed at `assembleService`, which returns `songs: []` and drops
  names; (3) static `.well-known` files pin one origin. *All fixed.* Evidence:
  `computeParticipation.ts:2-10`; `publishReadyBundle.ts:254-266,504-508`; RFC 8414 §3.3.
- **A4** — (1) dev sits behind Vercel Deployment Protection, so claude.ai cannot reach
  it (resolved by Frank's production-only decision); (2) I7 had no read-side source of
  observed revisions; (3) O2 lacked a live-principal re-check and audience binding.
  *All fixed.* Evidence: ADR-0027:7; `publish-ready/route.ts:193-195`; `auth.ts:258-311`.
- **A5** — (1) the Part II thinning had dropped July's OAuth security contracts (consent
  by POST, code binding, revocation); (2) `get_service` could not address one of several
  same-day specials — and the branch was 69 commits behind `origin/main`; (3) rollout put
  preview before code review; (4) I3 "verbatim" contradicted absent = published.
  *All fixed; branch merged with `origin/main`.* Evidence: July `:103-144`;
  `roleWriteOps.ts:367-399`; CLAUDE.md order; `serviceReadiness.ts:105-109`.
- **A6** — (1) `edit_setlist` would erase `medley_tag`/`play_key`; (2) `apply_schedule`
  took an unbound proposal back through the model while the create route enforces no
  solver rule; (3) excluding a Sunday contradicted the E21 positional spine; (4) July's
  "revalidate — never skip" was dropped for swap/apply. *All fixed.* Evidence:
  `setlistWriteRequest.ts:195-208`; ADR-0010:128-142; `MonthGenerator.tsx:1913-1915`;
  `swap/route.ts:306`, `roles/route.ts:343`.
- **A7** — ledger A10 called July's in-tool read-capture-assert "Correct" while I7 rejects
  it. *Fixed* (new F3).
- **A8** — `swap_assignment` exposed the unused seat-level swap shape, checked only
  referentially by the server. *Fixed* (sections and teams only; Frank then confirmed
  person-level edits stay in the admin UI). Evidence: `ServicesPanel.tsx:1322-1325`;
  `roles/[id]/route.ts:129`.
- **A9** — (1) `apply_schedule` dropped the create route's history-dependency and
  raw-draft refusals; (2) I14's destructive list contradicted its own rule. *Both fixed*
  (new I15; every write declared destructive). Evidence: `roleDependencies.ts:234`.
- **A10** — `solve_month` omitted Auto's local fills (specials, instruments). *Fixed.*
  Evidence: `MonthGenerator.tsx:3040-3097`.
- **A11** — (1) the local fills read a 56-day role window, so `solve_month` does read role
  documents; (2) Saturdays default to all, not none, and named specials had no refusal
  rules. *Both fixed.* Evidence: `MonthGenerator.tsx:417-433,1842-1846`;
  `MonthCalendar.tsx:140,299`; `plannerModel.ts:433-450`.
- **A13** — (1) ledger A14 missed the released stored-mode group fill (PR #91);
  (2) ledger A10 called an unchanged-since-June guard "stale". *Both fixed*; counts
  corrected in the spec and the July header. Evidence: `groupFill.ts`; `git log`
  of `authGuards.ts`.

## Non-blocking items

Adopted in the round that raised them unless listed here. **Declined:** A13's claim that
the `time` rule lives only at "ADR-0011:178" — ADR-0011 has 38 lines; the rule is at
`CLAUDE.md:178`. **Held during approval streaks, then applied** after the streak ended or
after final approval (see below).

## Process failures on the author's side

- **Fixes introduced blockers.** The consolidation pass after A2 pointed `get_service` at
  a helper that returns no songs (A3). The Part II thinning after A3 dropped security
  contracts it was meant only to re-express (A5). The A4 fix set Saturdays to "none by
  default" from a `useState([])` initializer without reading the month-change effect (A11).
- **Stale base.** The spec was reconciled against `128479bc` while `origin/main` moved 69
  commits during the review (same-day specials, worship nights, immediate publish email,
  solver overflow). Caught by A5, merged, re-verified.
- **Review-history leak.** Round A3's snapshot contained a paragraph beginning "An
  earlier draft of this document said…", exposing a prior finding to a cold reviewer.
  Removed before A4; every later snapshot was checked for such text.
- **Ledger rows asserted without verification** (A10 "Correct" then "went stale", A14's
  "only automatic path") — caught by A7 and A13.
- **The churn cap was reached at A2** and every round after it ran on an explicit,
  advance go-ahead from Frank; the defect class was logged at each stop (the worklog
  holds the entries).

## Post-approval changes — un-reviewed

Made after `1068240f` was approved; **not covered by that approval**. Several will be
re-examined by the child plans' own reviews (P0 owns O1/O2/O3/O7/O8/I10).

1. I9 — notifications reported as queued, never as delivered.
2. I10 — `resource` equals the MCP endpoint's URL per RFC 9728 §3.3; `401` carries
   `resource_metadata`.
3. O1 — a registration is bound to the origin that issued it.
4. O2 — secret wording aligned with O7's distinct per-environment values.
5. O3 — goal sentence aligned with its precedence rule (a flood can only delay).
6. O8 — consent is never remembered.
7. `unpublish_service` — the admin route's post-response outbox sweep, matched or recorded.
8. `solve_month` — behaviour when CP-SAT fails (local fills still run; partial proposal).
9. `revise_proposal` — a revision number; `apply_schedule` reports which revision it applied.
10. F3 — last-touch commit `04e397f1` named.
11. Dev smoke test calls no write tool against a real service.
12. Assumption failure responses escalate to Frank instead of narrowing scope.
13. P2 open question — the ADR ratifies the specials rule and decides the drafts rule.
14. I5 — "its solve request can match the browser's" (the schedule is randomly seeded).
15. Status line and terminal state record the approval.
