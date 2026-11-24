# Review log — 2026-11-05-owt-mcp-admin-writes.md

**Tier: critical**, derived from the ladder (not raised or lowered): the plan opens production
writers to a second role through an auth/ACL boundary (which tools a worship admin's MCP grant
reaches, which grants count as consented to writes, and the member read's ministry scope). Rule:
two sequential fresh approvals on byte-identical bytes. Each round used a brand-new reviewer given
only `reviewer-brief.md`, an immutable snapshot and its SHA-256, repository pointers and the
owner's requirement.

| Round | Reviewed digest (SHA-256, prefix) | Commit | Verdict | Streak |
|---|---|---|---|---|
| 1 | `447d1c35` | uncommitted snapshot | CHANGES_REQUIRED | 0 |
| 2 | `095a7681` | uncommitted snapshot | APPROVED | 1 |
| 3 | `6e0207ac` | uncommitted snapshot | CHANGES_REQUIRED | 0 |
| 4 | `8afa75fc` | beb9e2df | CHANGES_REQUIRED | 0 |
| 5 | `cb367234` | 5b0db505 | CHANGES_REQUIRED | 0 |
| 6 | `6445b318` | ac83afc6 | APPROVED | 1 |
| 7 | `cecfd832` | 50573d51 | APPROVED | 1 (new digest) |
| 8 | `26617b60` | e0c1edb9 | CHANGES_REQUIRED | 0 |
| 9 | `9c98a3b0` | 076cfe5f | CHANGES_REQUIRED | 0 |
| 10 | `f0d61846` | 772232ca | APPROVED | 1 |
| 11 | `f0d61846` (same bytes) | 772232ca | APPROVED | **2 — done** |

Rounds 2, 6 and 7 approved, and their non-blocking notes were adopted before a confirming round,
which changed the digest and reset the streak each time.

## Blockers and dispositions

**R1-B1 — `edit_setlist` told the model it needs no confirmation (fixed).** *Evidence:*
`editSetlist.ts:199-221` «sin confirmación» vs `serviceMessages.ts:58-60` `CONFIRM_RULE`. *Fix:*
§3.7, `PERSON_CONFIRMS_RULE` on every model-visible destructive tool; the digests move once.

**R1-B2 — old-consent grants checked before the deploy could stop minting them (fixed, then
replaced).** *Evidence:* the read-only consent page is served until the new deploy is `ready`.
*Fix:* superseded in round 2's notes by `ADMIN_WRITES_CUTOFF` on the grant's `createdAt` (§3.5).

**R1-B3 — ADR-0083 lists the read-only tier as the phishing mitigation (fixed).** *Evidence:*
`docs/adr/0083-*.md:104-108`. *Fix:* §4 restates the risk; §9 asks Frank to accept it.

**R3-B1 — a revert or re-release fails open on the cutoff (fixed).** *Evidence (reasoning):* while
old code serves, grants approved under the read-only page get a `createdAt` past the old cutoff.
*Fix:* any re-release resets the cutoff; a guard test.

**R3-B2 — notification loops understated (fixed).** *Evidence:* `serviceThreadCommit.ts:449`,
`serviceMutationSideEffects.ts:1160`. *Fix:* §4, §8, §9.

**R4-B1 — the dev admin smoke cannot pass before release (fixed).** *Evidence:* §3.5/§7 order: on
dev every admin grant is `adminRead` until the cutoff passes. *Fix:* §3.6 states what the smoke
can and cannot prove; the first end-to-end evidence is the production `tools/list`, checked before
any write.

**R5-B1 — the residual-window check could never find anything (fixed).** *Evidence:* it ran at the
alias check, while the cutoff was still in the future. *Fix:* the check runs once the window has
closed, plus an immediate one if `ready` is past the cutoff.

**R8-B1 — the MCP member read crossed ministries (fixed).** *Evidence:* `WORSHIP_MEMBER_GROQ_FILTER
= ($all || …)` (`app/ministries.ts:130`): `adminMembersQuery(true)`, bound literally at
`v3MonthPlanReads.ts:77` and `getSolverRules.ts:37`, turns the worship filter off. *Fix:* §3.4b,
`readsAllMembers` binds `all` from the live tier, as the members GET binds it from the live role.

**R9-B1 — a sixth `loadV3PlanSources` caller, the availability sweep (fixed).** *Evidence:*
`availabilityFixCommit.ts:198, 232, 286`. *Fix:* the binding is a required parameter, so `tsc` forces
every call site to choose; the sweep is pinned to `true` (unchanged); every call site is tested.

No blocker was refuted; each was verified against the cited code before fixing.

## Non-blocking items

Adopted before the final approval: the reworded «sin confirmación»; the `adminRead` scope; the
live-proof cleanup and its restore by `rowKey`; the email-quota consequence; clock-independent
tests; the runtime `allowlistedServer` Proxy; the `set_member_access` smoke probe; ADR-0072
restated; «Reglas» not delivered, said plainly; the merge-slip rule; consent copy that names
exclusions; a moved cutoff goes through `preview`; ADR-0083's title, status and index; the risk
reconfirmation and the Kids question asked before the build; the card-press clause and the
injected claim it refuses; the window check's owner and origins; the inverse confirm-rule test;
the real registration order; never re-promote after a rollback; the cutoff at merge + 1 h.

Adopted AFTER the final approval (un-reviewed, listed in the plan's §10 for the code review): a
fix-forward is a re-release; name resolution for admins; a `"full"` context in the twin tests;
waiver tokens restated with delete tokens; `docs/MCP.md:1674` keeps its reason; the live-proof
leftover thread; compute loops; the source-guard wording.

## Process notes (author side)

- The churn cap (two rounds with verified blockers) was reached after round 3. Frank gave the
  go-ahead for round 4 (2026-11-05 19:54Z) and round 5 (21:07Z), then for five more rounds without
  asking (2026-11-09 20:32Z, «Sigue con 5 rondas más antes de preguntarme»), and chose on a card
  (21:15Z) to confirm the round-10 text with round 11 and add the last notes afterwards.
- The owner widened the scope after round 3 (2026-11-05 19:55Z, «Todo como en la página»); the
  plan was rewritten, and rounds 4 onward reviewed the wider scope.
- Defect classes. Rounds 3–5 kept finding release-lifecycle timing of the consent boundary
  (old-consent grants across deploy windows). Rounds 8–9 found the member-read binding, and round
  8's blocker came from an author error: a round-7 note was adopted on a misread of
  `adminMembersQuery` (the projection, not the filter). The fix consolidated the binding into one
  required parameter rather than patching call sites one by one.
