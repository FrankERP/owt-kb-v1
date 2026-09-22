# Delivery roadmap: OWT Backstage MCP server

Parent scope artifact for [`2026-09-22-owt-mcp-design-v2.md`](../specs/2026-09-22-owt-mcp-design-v2.md).
Five child deliveries, reviewed and delivered in order. **This document
authorizes nothing.**

## Original request

> "Estábamos en proceso de escribir un MCP para la página/app, cómo quedamos con
> eso?" → "haz un plan actualizado que reconcilie la spec"

Three decisions settled with Frank on 2026-09-22, each asked with its cost
stated and answered explicitly:

1. **Remote OAuth, Stage 0 first.** The claude.ai connector from the phone is
   still the goal. A local stdio server was offered as a cheaper path and
   declined — it cannot serve the phone, which is the only thing the OAuth layer
   buys.
2. **Full write scope, including the solver** — chosen after both of its
   blockers were stated (the 60 s Hobby ceiling; the localStorage fairness
   history).
3. **Worship only.** Kids stays out of the surface.

## Parent scope

- **Shared outcome:** Frank manages the OWT app conversationally from the Claude
  apps — phone, desktop and web — through a single-user, super-admin-only MCP
  server that lives inside this Next.js app and exposes the *domain* layer, never
  raw Sanity.
- **Current gap:** nothing is built. `app/api/mcp`, `app/api/oauth`, `app/mcp`,
  `app/.well-known/**`, `mcp-handler`, `@modelcontextprotocol/sdk` and a direct
  `zod` are all absent from the tree and the lockfile.
- **Global requirements:** every stage passes `tsc --noEmit`, `vitest` and
  `eslint` with 0 errors; every stage is a PR to `main` behind a green `gates`
  check, after `preview` and a verified dev alias; every stage is code-reviewed on
  its own diff before merge.
- **Preserved invariants:** the Service-Readiness audit (reads through
  `operationalClient`, writes registered by exact file+operation); draft gating
  (`published != false` for worship, enforced by `draftGatingCoverage.test.ts`);
  the pre-commit `before` capture for notifications; `saturdarSongs` is never
  renamed; all five member-referencing seats are covered by any "who serves"
  query; client-observed `_rev` assertion on every guarded write; ADR-0028
  (no Server Component calls a value from a `"use client"` module).
- **Non-goals:** team-member access; a standalone service; raw Sanity document
  access; local stdio transport; the kids ministry.
- **Integration acceptance:** from the phone, Frank asks for a month's coverage
  gaps, proposes a solve, reviews it, applies it to drafts, edits a setlist and
  publishes a service — and every one of those lands identically to the same
  action performed in the admin UI, including which notifications fired.

## Why this is split five ways

Not because the document is long. Each boundary below is a different trust,
data, or release boundary, and each child has an end state that is safe to stop
at.

- **P0 crosses an authentication trust boundary** and nothing else. Its end state
  is a connector that can prove who it is and do nothing — no domain reads, no
  writes. It also carries the two empirical unknowns (`mcp-handler` × Next 16,
  the claude.ai callback URIs) that would otherwise contaminate every later
  estimate.
- **P1 crosses a read boundary.** Its end state is a read-only connector. It
  touches no registry, mutates nothing, and can be reverted by deleting files.
- **P2 crosses a data-semantics boundary and does not touch the MCP at all.** It
  changes what the solver is told about the past. It is independently valuable
  (it fixes the two-admins-disagree defect ADR-0010 named and left out of scope),
  independently verifiable (diff the derived history against the browser's), and
  it needs its own ADR. Folding it into P4 would hide a solver-behaviour change
  inside an MCP delivery.
- **P3 crosses the production-write boundary**, including a notification audience.
- **P4 depends on P2 and P3 both** and is the largest single piece. It stays last
  so the pattern it follows is already proven by three guarded writers.

P2 is independent of P0/P1 and may be delivered in parallel with them by a
different owner; it blocks only P4.

## Child plans

| ID | Type | Outcome and acceptance contract | Prerequisites | Outputs | Safe ending state | Rollback | Review order |
|---|---|---|---|---|---|---|---|
| **P0** | Implementation plan | OAuth 2.1 + `.well-known` discovery + MCP route with a single `ping` tool. **Accepted when the full connector handshake completes from the phone** and a revoked grant stops working within the cache TTL | v2 spec approved | The chosen SDK + its zod major, pinned; the JWT library, pinned; the observed callback-URI allowlist; the rate limiter; `MCP_OAUTH_SECRET`/`MCP_DISABLED` documented | A connector that authenticates and exposes one no-op tool | `MCP_DISABLED=1`, then remove the routes and both matcher list entries | 1st |
| **P1** | Implementation plan | The seven read tools, reconciled per the v2 tool table. **Accepted when each returns data identical to the corresponding admin surface**, drafts marked `published: false` | P0 | Proven payload shapes; the `app/mcp/tools/` module pattern | Read-only connector | Delete the tool modules; P0 survives | 2nd |
| **P2** | Spec, then implementation plan | Solver fairness history derived server-side from role documents instead of `localStorage`. **Accepted when the derived history is diffed against Frank's exported `owt_solver_history_v2` and the differences are explained, not merely small** | None (independent of P0/P1) | A server-callable history builder; a new ADR amending ADR-0010 | Either cut over, or not cut over and P4 is dropped | Keep the browser as the history source; no MCP code is affected | 3rd |
| **P3** | Implementation plan | `edit_setlist`, `swap_assignment`, `publish_service`, `unpublish_service`. **Accepted when each produces the same document diff and the same notification set as the admin UI**, proven per tool against a throwaway draft service | P1 | The "extract authorization from write" pattern; registry-entry precedent | Read-only connector plus three proven writers | Remove the tools and their registry entries in one commit — the audit test forbids leaving either behind | 4th |
| **P4** | Implementation plan | `solve_month` (no writes) + `apply_schedule` (guarded writes). **Accepted when a month solved through the connector produces the same schedule the browser produces from the same inputs**, and applying it refuses a published month | P2 **and** P3 | — | Full surface | Remove both tools; P2's history builder stays (it is independently correct) | 5th |

Each child is written against the implementation-plan template when it is about
to be delivered — not now. Writing five plans before the first is reviewed
wastes them: a material finding in P0 propagates to every later artifact and
stales its approval.

## Requirement-to-plan coverage

| ID | Requirement | Primary | Dependent | Verification owner |
|---|---|---|---|---|
| R1 | OAuth 2.1 + PKCE + DCR handshake completes from the phone | P0 | — | P0 (manual, from the phone) |
| R2 | Bearer verified per request; revocation effective within the cache TTL | P0 | P1, P3, P4 | P0 (route-level tests) |
| R3 | Middleware exclusions in **both** the matcher literal and `PUBLIC_ROUTES` | P0 | — | `routeMatcher.test.ts` |
| R4 | `MCP_OAUTH_SECRET` + `MCP_DISABLED` in `docs/SECRETS.md`, same change | P0 | — | P0 code review |
| R5 | Rate limit + hard registration cap on the unauthenticated DCR endpoint | P0 | — | P0 (unit) |
| R6 | Auth-code replay refused via the `create()` 409 conflict path | P0 | — | P0 (test asserts the conflict path specifically) |
| R7 | Seven read tools, reconciled against A6–A9 of the v2 ledger | P1 | — | P1 vs admin surfaces |
| R8 | Every protected read via a named `operationalClient` import | P1 | P3, P4 | `protectedReadAudit.test.ts` |
| R9 | Draft gating on every new read | P1 | P3, P4 | `draftGatingCoverage.test.ts` |
| R10 | Worship-only surface | P1 | P3, P4 | P1 code review |
| R11 | Fairness history derived from role documents, with an ADR | P2 | — | P2 diff against exported browser history |
| R12 | `edit_setlist` with `_key` per item and both revision assertions | P3 | — | P3 (route-parity test) |
| R13 | `swap_assignment` asserting **both** role revisions plus lock revisions | P3 | — | P3 |
| R14 | Publish notifications fire from a **pre-commit** `before` capture | P3 | — | P3 + the existing regression guard |
| R15 | Every protected write registered by exact file+operation, same commit | P3 | P4 | `protectedReadAudit.test.ts` |
| R16 | Authorization extracted separately from write logic | P3 | P4 | P3 code review |
| R17 | `solve_month` completes within 60 s and writes nothing | P4 | — | P4 (measured, not assumed) |
| R18 | `apply_schedule` refuses a month containing a published service | P4 | — | P4 |
| R19 | A committed review log beside each reviewed artifact | all | — | `finish-cycle` |

Every requirement has exactly one primary owner. R2, R8, R9, R15 and R16 are
intentionally cross-cutting: they are established once and re-verified by the
gate on every later child.

## Sequence and safe states

| Transition | Entry criteria | Allowed release state | Exit criteria | Recovery if interrupted |
|---|---|---|---|---|
| Start → P0 | v2 spec has two fresh `APPROVED` verdicts on byte-identical text | Releasable — a connector that only pings | Handshake verified from the phone; revocation verified | Nothing shipped; no domain surface exists to leak |
| P0 → P1 | P0 merged, production alias verified | Releasable — read-only | Each tool matches its admin surface | The connector still pings; no data is mutable through it |
| P0/P1 ∥ P2 | none | Releasable on its own | Derived-vs-browser diff explained | Browser remains the history source |
| P1 → P3 | P1 merged | Releasable per tool | Document diff and notification set match the UI | Tools landed so far are proven; the rest are absent |
| P2 + P3 → P4 | both merged; P2 cut over | Releasable per tool | Connector-solved month matches a browser-solved month | `solve_month` without `apply_schedule` is a safe stop — it writes nothing |

The one state that is **not** safe to stop in: a write tool merged without its
audit registry entry, or an entry without its writer. The audit test forbids
both, so this is enforced rather than intended.

## Shared assumptions

Carried from the v2 spec; each child re-validates the ones it depends on.

| Assumption | Impact if false | Validation | Failure response |
|---|---|---|---|
| `mcp-handler` works with Next 16.2.12 | P0 grows a hand-rolled Streamable HTTP handler | P0 gate, before any tool | Hand-roll it; design unchanged |
| Assemble + GCF solve fits in 60 s serverless | `solve_month` cannot ship on Hobby | P4, measured | Return the assembled request for the browser to solve; re-open the question |
| Derived fairness history reproduces the browser's closely enough | Solver output changes unasked | P2 diff | Do not cut over; drop P4 |
| claude.ai callback URIs pin to a stable set | The allowlist is too narrow (handshake dies) or too wide (stops protecting) | P0, empirically | Record the observed set as a dated constant |

## Review handoff

- **Order:** this roadmap first, then P0, P1, P2, P3, P4 — each as a separate
  fresh review with no prior findings exposed.
- **Risk tier: CRITICAL** for the roadmap, P0, P3 and P4 (auth/ACL boundary,
  production writers, multi-document concurrency). Two sequential fresh
  `APPROVED` verdicts on byte-identical text each. **P1 is standard** — reads
  only, no writer, no trust boundary — so it relies on spec review plus
  post-implementation diff review, per the 2026-08-19 retier. **P2 is critical**
  on its spec (it changes what a production writer is told) and standard on its
  implementation plan.
- **Churn cap is binding:** after two rounds with verified substantive blockers,
  stop. Round three needs Frank's go-ahead obtained in advance.
- Prior reviews, feedback, rebuttals and planning dialogue: **excluded**.
- A material child change propagates to this parent and restarts review from the
  earliest affected artifact.
- **Implementation authorization: not granted by this roadmap.**

## Terminal state

`READY_FOR_ADVERSARIAL_REVIEW`
