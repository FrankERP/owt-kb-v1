# Review log — 2026-11-05-owt-mcp-any-agent.md

**Tier: critical**, derived from the ladder (not raised or lowered): the plan changes an
auth/security boundary — who may hold an MCP token, which redirect targets receive authorization
codes, and which tools a token reaches (including writes). Rule: two sequential fresh approvals on
byte-identical bytes. Each round used a brand-new reviewer given only `reviewer-brief.md`, an
immutable snapshot and its SHA-256, repository pointers and the owner's requirement.

| Round | Reviewed digest (SHA-256, prefix) | Commit | Verdict | Streak |
|---|---|---|---|---|
| 1 | `55b58b4e` | 80bd0fd0 | CHANGES_REQUIRED | 0 |
| 2 | `eb0a73a8` | 1e90bee1 | APPROVED | 1 |
| 3 | `eb0a73a8` (same bytes) | 1e90bee1 | CHANGES_REQUIRED | reset to 0 |
| 4 | `ccf4dc93` | dca0c156 | CHANGES_REQUIRED | 0 |
| 5 | `0e3d401e` | 7d0bd565 | APPROVED | 1 |
| 6 | `0e3d401e` (same bytes) | 7d0bd565 | APPROVED | **2 — done** |

## Blockers and dispositions

**R1-B1 — local agents shut out (fixed).** VS Code registers web forwarders and loopback URIs in
one DCR request, the register route refused the whole list, port-less loopback was refused, and
exact matching broke RFC 8252 §7.3 port variance. *Evidence checked:* microsoft/vscode
`src/vs/base/common/oauth.ts` `fetchDynamicRegistration` (fetched); `app/api/oauth/register/route.ts`
all-or-nothing loop; `redirects.ts` `url.port === ""` refusal. *Fix:* §3.1 — registration signs the
allowed subset, port optional, `matchRegisteredRedirect` with port variance; code binding stays exact.

**R3-B1 — app-only twins exposed to non-Claude hosts (fixed).** Opening the full tier to any agent
removes the host-hiding that ADR-0062/0066/0072 rely on for waiver minting and card-confirmed saves.
*Evidence checked:* `APP_ONLY_META` in `serviceEditor.ts`, `serviceDeletes.ts`, `proposalEditor.ts`;
`docs/MCP.md` «rests on the host hiding app-only tools». *Fix:* §4.1 — the grant records its client;
app-only tools and the card only for claude.ai grants (a third handler).

**R4-B1 — `client` not fetched would fail open (fixed).** `GRANT_QUERY` is an explicit projection
without `client`; absent read as `"claude"` on production; store tests mock `fetch`. *Evidence
checked:* `grantStore.ts` `GRANT_QUERY`; `grantStore.test.ts` mocks. *Fix:* add to the projection, a
projection-vs-parser test, and absent ⇒ `"claude"` only for production grants created before
`LEGACY_GRANT_CUTOFF`.

**R4-B2 — a revert re-exposes the twins (fixed).** Old code ignores `client`, and the refresh path
never re-checks the redirect. *Evidence checked:* `token/route.ts` refresh steps. *Fix:* rollback
step 0 revokes non-Claude grants first.

No blocker was refuted; every one was verified against the cited code or source before fixing.

## Non-blocking items

Adopted before the final approval: intended test flips (including re-targeting the O1 re-check
tests to directly signed off-list client ids), agent-neutral stale-list note, no `resources`
capability on handlers without resources, smoke tier mode, other ChatGPT incompatibilities named as
new changes, missed consent copy, data and load exposure stated, rollback order, unknown-origin
test, per-connection ChatGPT URI dropped, parity over active members, localhost/port-variance
residual named. Adopted AFTER the final approval (un-reviewed, listed in the plan's §11 for the diff
review): smoke exception on both guards, cutoff set at the main-PR commit, derived counts, ADR
number, `maxSubscriptions: 0` on all handlers, host-dependent human gates, rollback step 0 wording
and consent, register refusal log line, more stale docs, telling Frank ChatGPT is unproven.
Not adopted: making the per-grant email notice a release condition (kept as the first follow-up
offered to Frank).

## Process notes (author side)

- The churn cap (two rounds with verified blockers) was reached after round 3; Frank's go-ahead
  for more rounds was given on a decision card (2026-11-05 17:27Z, «Sí, sigue revisando»: run the
  rounds needed to reach two approvals).
- Round 2's approval was not the end: round 3, on the SAME bytes, found a real blocker. The
  two-approval rule caught what one approval missed.
- The owner's scope changed mid-review (17:28Z, admins may also write setlists and messages). The
  plan became slice A of two; writes go to a separate plan (slice B) with its own review.
