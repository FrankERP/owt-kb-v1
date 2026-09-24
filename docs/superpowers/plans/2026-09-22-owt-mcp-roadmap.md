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

Four more, on 2026-09-23:

4. **The spec states contracts; the child plans choose implementations.**
5. **The claude.ai connector is registered against production only.** dev sits
   behind Vercel Deployment Protection, which claude.ai cannot pass; lifting it
   was declined. Code still goes preview-first; the connector is exercised on
   production.
6. **Person-level edits on a created service stay in the admin UI**; the connector
   swaps only whole sections or teams.
7. **The solver's proposal can be edited from the connector** before it is applied
   — quick edits by Frank, the heavy lifting by the solver and the assistant —
   through a server-judged, re-signed revision.

## Parent scope

- **Shared outcome:** Frank manages the OWT app conversationally from the Claude
  apps — phone, desktop and web — through a single-user, super-admin-only MCP
  server that lives inside this Next.js app and exposes the *domain* layer, never
  raw Sanity.
- **Current gap:** nothing is built. `app/api/mcp`, `app/api/oauth`, `app/mcp`,
  `app/.well-known/**`, `mcp-handler` and `@modelcontextprotocol/sdk` are absent
  from the tree and the lockfile, and `zod` is not a direct dependency.
- **Global requirements:** every stage passes the four gates — `tsc --noEmit`, `vitest`,
  `eslint` with 0 errors, and the `gcf` unittest when a stage touches `gcf/**`; every stage follows the spec's Rollout and
  CLAUDE.md's order — code review of its own diff, fix, re-verify the fix, then
  `preview` with a verified dev alias, then a PR to `main` behind a green `gates`
  check, a verified production alias, and only then the connector exercise. A change
  under `gcf/**` deploys straight to the production Cloud Function from `main` with no
  preview rehearsal (`ci.yml`), so a child that touches it says how it is rehearsed. Documentation is kept current in the same delivery (CLAUDE.md).
- **Preserved invariants:** the Service-Readiness audit (reads through
  `operationalClient`, writes registered by exact file+operation); draft gating
  (`published != false` for worship, enforced by `draftGatingCoverage.test.ts`);
  the pre-commit `before` capture for notifications; `saturdarSongs` is never
  renamed; all five member-referencing seats are covered by any "who serves"
  query; client-observed `_rev` assertion on every guarded write; ADR-0028
  (no Server Component calls a value from a `"use client"` module).
- **Non-goals:** team-member access; a standalone service; raw Sanity document
  access; local stdio transport; the kids ministry; person-level edits on a
  created service (decision 6); July's Stage 3 — member management, sending
  notifications, proposal administration — deferred with no tools here.
- **Integration acceptance:** from the phone, Frank asks for a month's coverage
  gaps, proposes a solve, revises it, applies it to drafts, edits a setlist and
  publishes a service — and every one of those lands identically to the same
  action performed in the admin UI, including which notifications are queued and
  to whom. For the solve, "identically" is defined at the solver boundary: the same
  solve request and, from one given solver response, the same proposal. The schedule
  itself can differ from run to run, as it already does in the browser — CP-SAT is
  randomly seeded and time-limited (`gcf/owt_solver_v2.py:110-120`, `:1104-1106`).

## Why this is split five ways

Not because the document is long. Each boundary below is a different trust,
data, or release boundary, and each child has an end state that is safe to stop
at.

- **P0 crosses an authentication trust boundary** and nothing else. Its end state
  is a connector that can prove who it is and do nothing — no domain reads and no
  domain writes; its only writes are OAuth-state documents, non-secret under O5. It also carries the empirical unknowns (an MCP handler × Next 16,
  serving discovery at the RFC paths, the claude.ai callback URIs) that would otherwise contaminate every later
  estimate.
- **P1 crosses a read boundary.** Its end state is a read-only connector. It
  touches no audit registry and mutates nothing. It is standard tier **only because
  of one constraint**: P1 reaches modules that production writers import —
  `app/utils/serviceReadQueries.ts` (eleven importers, including `roleWriteOps.ts`,
  the setlist writer and `publishReadyBundle.ts`) and the readiness loader
  `publish-ready` decides its refusals with (`publish-ready/route.ts:130`) — so every
  change P1 makes there is **additive only**: existing exports, routes and their
  tests stay unchanged, and readiness is consumed, never narrowed on the path
  publish uses. A P1 plan that must modify an existing writer-imported export is
  critical tier instead, and gets a plan review.
- **P2 crosses a data-semantics boundary and does not touch the MCP at all.** It
  changes what the solver is told about the past. It is independently valuable
  (it fixes the two-admins-disagree defect ADR-0010 named and left out of scope),
  independently verifiable (diff the derived history against the browser's), and
  it needs its own ADR. Folding it into P4 would hide a solver-behaviour change
  inside an MCP delivery.
- **P3 crosses the production-write boundary**, including a notification audience.
- **P4 depends on P2 and P3 both** and is the largest single piece. It stays last
  so the pattern it follows is already proven by four guarded writers.

P2 is independent of P0/P1 and may be delivered in parallel with them by a
different owner; it blocks only P4.

## Child plans

| ID | Type | Outcome and acceptance contract | Prerequisites | Outputs | Safe ending state | Rollback | Delivery order |
|---|---|---|---|---|---|---|---|
| **P0** | Implementation plan | OAuth 2.1 + `.well-known` discovery + MCP route with a single `ping` tool. **Accepted when the full connector handshake completes from the phone against production**, the MCP and OAuth endpoints pass a smoke test on dev through a local client carrying the protection bypass, a revoked grant stops working within the cache TTL, tool errors never carry stack traces or Sanity internals, and every O1–O9, I10, I11 and E1 verification in the coverage table passes. While the callback allowlist is being observed — possible on production only — it **fails closed**: refused redirect URIs are logged, never admitted by a permissive mode. Seeded from claude.ai's documented callbacks where they exist; otherwise the observe-then-admit cycle costs two production releases, each through the full pipeline. Runtime logs on Hobby are short-lived, so the observation is kept in the dataset — **bounded**, because a refused registration falls outside O3's cap on kept registrations: it is recorded **only for redirect hosts on claude.ai / claude.com**, in **one** document holding a deduplicated, size-capped set with the oldest entry dropped first, each entry timestamped so the admit step accepts only a URI seen during Frank's own connection attempt. Non-secret under O5; fixed in size whatever the traffic | v2 spec approved | The chosen SDK + its zod major, pinned; the JWT library, pinned; the observed callback-URI allowlist; the rate limiter; the deployment-size cost of the new dependencies, since Function Storage counts every retained deployment and has already hit its quota once; `MCP_OAUTH_SECRET`/`MCP_DISABLED` documented; the `SR_VERIFY_BYPASS_SECRET` entry updated with the dev smoke client as a consumer | A connector that authenticates and exposes one no-op tool | `MCP_DISABLED=1`, then remove the routes and the matcher entries in all three files (`proxy.ts`, `app/utils/routeMatcher.ts`, `PUBLIC_ROUTES` in its test), plus any discovery rewrites in `next.config.mjs`; the OAuth-state documents are inert once the routes are gone and may be deleted by a guarded script | 1st |
| **P1** | Implementation plan | The seven read tools per the spec's read contracts, under I1–I5, I7 and I13–I14. **Accepted when each read meets its spec contract** — the declared fields, drawn from the same canonical data the admin UI reads — **with the departures the spec requires named and tested**: I5's worship filtering on member-listing reads (the admin availability view shows a super-admin kids-only members too), A8's declared song field set (copied from neither existing projection), and I3's normalised publication state rather than the raw flag. `get_service` has no single admin surface and is accepted against its contract alone. Ledger A13's stale header is fixed here. P1's code review checks that every `_rev` and row `_key` a read returns comes from the same query snapshot as the content Frank acts on — the readiness bundle is a separate set of queries. **Every change to a module a production writer imports is additive**, with that module's existing tests unchanged. The seat-plus-setlist join `get_service` needs may be **added** as a new builder in the canonical read model while the admin route keeps its own inline copy; a test pins the two equal **on their shared projection** (the new builder also carries row `_key`s and `leads`, which the route's copy does not) until a later, separately reviewed change retires the route's copy | P0 | Proven payload shapes; the `app/mcp/tools/` module pattern | Read-only connector | Delete the tool modules and revert P1's additive changes to shared modules; P0 survives | 2nd |
| **P2** | Spec, then implementation plan | Solver fairness history derived server-side from role documents instead of `localStorage`. **Accepted when the derived history is diffed against Frank's exported `owt_solver_history_v2` and the differences are explained, not merely small** | v2 spec approved (independent of P0/P1). Changes to any module a production writer imports are additive only, as for P1 — and while P1 and P2 are both in flight, whoever lands second rebases onto the other's changes to `serviceReadQueries.ts` | A server-callable history builder; a new ADR amending ADR-0010; at cutover the browser's solve switches to the derived history too | Either cut over — **a decision Frank makes**, since it changes Auto for every admin — or not cut over and Frank decides P4's scope with the explained differences in hand — recorded as a change to this roadmap, since P4's entry requires the cutover | Keep the browser as the history source — which is only a clean rollback because the browser keeps writing its local history until the cutover is proven, and only **before P4 ships**: afterwards, rolling back the cutover also withdraws `solve_month` (a P4 change), or the connector and the admin UI would solve against different histories (H4); no MCP code is affected | 3rd |
| **P3** | Implementation plan | `edit_setlist`, `swap_assignment`, `publish_service`, `unpublish_service` per the spec's write contracts, under I6–I9 and I12–I15. **Accepted when each produces the same document diff and the same notification set as the admin UI**, proven per tool on production against throwaway services whose notification audience is Frank alone (two for `swap_assignment`), **after** the exact recipients of each tool are confirmed and delivery — not only the audience — is checked — and when `publish_service` is shown to refuse a service the admin UI would refuse (I4) and to expose no override. `edit_setlist`'s first live run is on an **unpublished** draft (a published save pushes to the whole team whoever is seated); its published-path notification parity is proven by tests, not live. **The admin counterparts' own behaviour and tests are unchanged** by the authorization extraction | P1 | The "extract authorization from write" pattern; registry-entry precedent | Read-only connector plus four proven writers | Remove the tools and their registry entries in one commit — the audit test forbids leaving either behind. The behaviour-preserving authorization extraction may stay | 4th |
| **P4** | Implementation plan | `solve_month` + `revise_proposal` + `apply_schedule` per the spec. **Accepted on solver-boundary parity**: from the same dataset, history and selections the connector builds the same solve request as the browser's Auto (production requests carry no seed on either side, so request parity needs none; the proposal is compared from one recorded solver response, never from two live solves, because CP-SAT is randomly seeded and bounded by a 40 s wall clock), and from one recorded solver response it produces the same proposal — voices, the local instrument and special fills, refused specials and the unfilled-seat report. End-to-end schedule equality is **not** a goal; CP-SAT is randomised and time-limited. Also accepted when applying never touches a target the admin create refuses — occupied (published or draft), a raw draft, or a date already holding a setlist or proposal — and reports each one, a retry never creates a service twice, and a partial apply is reported per service rather than as a whole-month success. **Not atomic across the month** — a limitation the spec states and owns. `apply_schedule`'s first live run is on a month with no existing services, and its drafts are removed afterwards. A new proposal-signing key, if one is needed, is documented under O7 | P2 **and** P3 | — | Full surface | Remove the three tools and their audit registry entries in one commit; the behaviour-preserving extractions (the move primitive, the create route's authorization split) may stay; a signing key, if any, is retired per O7. Drafts removed after the first live run can leave idempotency receipts and coordinators behind — inert, and cleaned by a guarded script. P2's history builder stays (it is independently correct) | 5th |

Each child is written against the implementation-plan template when it is about
to be delivered — not now. Repository facts already verified for them are carried in
[`2026-09-22-owt-mcp-child-plan-evidence.md`](2026-09-22-owt-mcp-child-plan-evidence.md)
— input to those plans, not a requirement, and re-verified when each is written. Writing five plans before the first is reviewed
wastes them: a material finding in P0 propagates to every later artifact and
stales its approval.

## Requirement-to-plan coverage

Requirement IDs are the spec's own: **I1–I15** (invariants), **O1–O9** (auth
contracts) and the tool names (tool contracts). **H1–H4** are owned here, for
P2, because P2 writes its own spec. The Requirement column is a **label**: the
spec's own text binds, in full. How each is met is decided in the child plan that
owns it — not in this table.

| ID | Requirement | Primary | Dependent | Verification owner |
|---|---|---|---|---|
| O1 | The connector handshake completes from the phone, against production; per-origin redirect allowlist re-checked at authorize and token; registrations bound to their origin; authorize refuses while impersonating | P0 | — | P0 (manual, from the phone) |
| O2 | Per request within 30 s: signature, expiry, grant not revoked, subject still a live non-disabled super-admin, audience equals this origin's MCP resource; `MCP_DISABLED` shuts every MCP and OAuth route | P0 | P1, P3, P4 | P0 (route tests: demoted subject, disabled subject, foreign-origin token) |
| O3 | Rate limit **and** hard registration cap; a registration holding a consented, unrevoked, unexpired grant, or one mid-handshake, is never evicted; a flood can only delay | P0 | — | P0 (unit: filling the cap with junk never displaces a consented registration) |
| O4 | Auth code ≤60 s, single-use, bound to client/redirect/PKCE and re-verified at exchange; replay refused; refresh-token reuse revokes the grant | P0 | — | P0 (tests assert each binding and each refusal path) |
| O5 | Stored OAuth state is non-secret and non-replayable | P0 | — | P0 code review |
| O6 | Dedicated signing secret; direct, pinned JWT dependency | P0 | — | P0 code review |
| O7 | `MCP_OAUTH_SECRET` and `MCP_DISABLED` documented in `docs/SECRETS.md` in the same change; `MCP_OAUTH_SECRET` **generated separately** for preview and production; the existing protection-bypass secret's entry names its new consumer | P0 | P4 (a proposal-signing key, if new) | P0: code review of `docs/SECRETS.md`, plus `vercel env ls` showing **separate** preview and production entries for `MCP_OAUTH_SECRET` (entries only — never reading a value; the listing proves two entries, not distinct values, so the real control is the procedure: **Frank** generates each value separately and enters it himself — no agent enters credentials) |
| DV1 | The dev smoke test calls **no write tool against a real service**; dev writes the production dataset and its mail redirect covers email only | P0 | P3, P4 | Each child's plan names its dev smoke calls; code review |
| E1 | Error contract: `401` with `WWW-Authenticate` before dispatch; tool errors human-readable, never stack traces or Sanity internals | P0 | P1, P3, P4 | P0 route tests |
| O8 | Consent screen on every authorization, never remembered; approval by POST only; client name treated as untrusted | P0 | — | P0 (a returning client still sees consent; a GET never issues a code) |
| O9 | A documented, deploy-free revocation path, effective within 30 s | P0 | — | P0 (revoke, then the next call is refused within the TTL) |
| I10 | Discovery computed per request: `issuer` equals the origin fetched, `resource` the MCP endpoint's URL on it (RFC 9728 §3.3); root and path-inserted forms; `401` carries `resource_metadata` | P0 | — | P0 (production with no cookie; dev through the local bypass client; compare `issuer` and `resource` to the host fetched, not merely that it responds) |
| I11 | Middleware exclusion, both hand-kept lists in sync | P0 | — | `routeMatcher.test.ts` |
| I6 | Bearer auth at the route before dispatch; authorization separate from domain logic | P0 | P1, P3, P4 | P0 route tests + each child's code review |
| I1 | Audit: canonical reads; exact write registration in the same commit | P1 | P2, P3, P4 | `protectedReadAudit.test.ts` |
| I2 | No new `MAY_SEE_DRAFTS` entry; no draft-gated literal in an MCP-owned file | P1 | P2, P3, P4 | `draftGatingCoverage.test.ts` |
| I3 | Publication state on every service payload, normalised by the app's rule (absent = published) | P1 | P3, P4 | P1 tests, including a legacy service with no `published` field |
| I4 | One readiness predicate for reads and `publish_service` | P1 | P3 | P1 + P3 agreement test: what a read reports blocking is what publish refuses on |
| I5 | Worship scope; the super-admin bypass does not apply | P1 | P4 (the solver's pool must **not** take this filter) | P1 test with a kids-only fixture member |
| reads | `get_service`, `list_services`, `search_songs`, `get_song`, `get_member_availability`, `get_participation`, `list_proposals` | P1 | — | P1, each against its spec read contract, with the I5 / A8 / I3 departures tested |
| A13 | The canonical read model's header still says "six" protected types | P1 | — | P1 code review |
| TZ | Dates in and out are `YYYY-MM-DD` under the `America/Mexico_City` invariants — "next upcoming" and "today" computed in Mexico City, never UTC | P1 | P3, P4 | P1 tests at an evening hour, when UTC has already turned the day |
| H1 | Derived CP-SAT fairness history excludes specials (ADR-0010 Decision 3) | P2 | P4 | P2 |
| H2 | An ADR amending ADR-0010 ratifies the specials rule **and** decides whether unpublished services count, **before** the diff runs | P2 | — | P2 |
| H3 | Derived history diffed against Frank's `owt_solver_history_v2`, every difference explained. No export exists today (`MonthGenerator.tsx:1886-1906`): P2's plan names the browser it is read from and how it is extracted, and accounts for the six-entry `MAX_HISTORY` truncation (`:307`) and for divergence between browsers | P2 | P4 | P2 |
| H4 | At cutover the browser's solve switches to the derived history too, so the connector and the admin UI never solve against different histories; until then the browser keeps writing its local history, and P2's plan states when that dual-write stops | P2 | P4 | P2 |
| I7 | Concurrency parity: each write requires the observations its admin counterpart requires, taken from a read the user acted on; reads return them | P1 | P3, P4 | P1 (reads return them) + P3 stale-observation tests per tool |
| I8 | Notification parity, computed from pre-commit state | P3 | P4 | P3 + the existing regression guard |
| I9 | Honest, per-item outcomes; notifications reported as queued, never as delivered | P3 | P4 | Per-tool tests |
| I12 | Cache parity: every write performs its admin counterpart's revalidation | P3 | P4 | Per-tool tests assert the revalidation call |
| I13 | Inputs validated; unknown fields rejected | P0 | P1, P3, P4 | Schema tests per tool |
| I14 | Every tool declares its nature: reads read-only, **every write destructive** | P0 | P1, P3, P4 | Tool-list test per stage |
| I15 | Refusal parity: every write refuses at least what its admin counterpart refuses, with the reason | P3 | P4 | Per-tool tests replaying each counterpart refusal |
| writes | `edit_setlist`, `swap_assignment` (whole sections and teams only — never a single seat), `publish_service`, `unpublish_service` | P3 | — | P3, each against the admin UI on production, on throwaways whose audience is Frank alone — `edit_setlist` on an unpublished draft, `swap_assignment` on two |
| `solve_month` | Everything Auto does — CP-SAT voices on every Sunday plus every Saturday not excluded, reading the 56-day role window the local fills rank by — a separate input from P2's history, and one that keeps specials; named specials refused and reported on the planner's rules, never dropped; then the local instrument fill and the local fill of named specials; reports every seat Auto would report unfilled; writes nothing; inside 60 s; returns a bound proposal | P4 | — | P4 (measured; solver-boundary parity — identical solve request (no seed on either side, as in production), identical proposal from one recorded response — covering instruments, a named special, a deselected Sunday, an excluded Saturday, and a CP-SAT failure returning a partial proposal) |
| `revise_proposal` | Every edit judged on the server by the planner's manual-pick gate; wrong Tipo, doubles and hard-rule blocks refused, never forced; caps/presence not re-checked and said so; reports the three pick-time warnings («No disp.», «Sin declarar», «Ya asignado»); re-signed with a revision number, keeping the solve's expiry and rule-set revision; writes nothing | P4 | — | P4 (one test per gate verdict; a forged or hand-edited proposal refused by `apply_schedule`) |
| `apply_schedule` | Accepts only a bound, unexpired proposal (from `solve_month` or `revise_proposal`), refused if altered, expired, or if the rule set changed; creates only; every target the admin create refuses (occupied, raw draft, existing setlist or proposal on the date) skipped and reported; at most once per service; occupancy re-checked at write time; per-service outcome; reports which proposal revision it applied | P4 | — | P4 (tampered-proposal, superseded-revision, stale-apply, retry, partial-failure and occupied-target tests) |
| L1 | A committed review log beside each reviewed artifact | Cross-cutting: each child owns its own | — | `finish-cycle` |
| INT | The integration acceptance above, run from the phone once every child is live — against a real planned month only up to applying drafts, and against throwaways for anything that publishes or pushes; "identically" rests on P3's and P4's per-tool parity | P4 (the last child) | — | P4, from the phone |

Every requirement has exactly one primary owner, except L1, which is cross-cutting by
nature. I1, I2, I6 and I7 are also intentionally cross-cutting: established once, then re-verified by the gate on
every later child.

## Sequence and safe states

Every "exit criteria met" below means the **acceptance column of the Child plans
table** for that child — nothing weaker.

| Transition | Entry criteria | Allowed release state | Exit criteria | Recovery if interrupted |
|---|---|---|---|---|
| Start → P0 | v2 spec and this roadmap each have two fresh `APPROVED` verdicts on byte-identical text; P0's own plan approved at its tier; Frank's go-ahead to implement | Releasable — a connector that only pings | Handshake verified from the phone; revocation verified | No domain surface exists to leak. If P0 stops between its observe and admit releases, registration, authorize and token are live on production and writing OAuth-state documents; the stop is `MCP_DISABLED=1` plus a redeploy. Stopping there is safe because every write those endpoints make is bounded: kept registrations by O3's cap, the callback observation by its single size-capped document |
| P0 → P1 | P0's exit criteria met: merged, production alias verified, handshake and revocation proven | Releasable — read-only | Each read meets its spec read contract, with the I5 / A8 / I3 departures tested | The connector still pings; no data is mutable through it |
| P0/P1 ∥ P2 | v2 spec and this roadmap approved; P2's own spec and ADR approved; Frank's go-ahead to implement | Releasable on its own | Derived-vs-browser diff explained | Browser remains the history source |
| P1 → P3 | P1's exit criteria met, production alias verified; P3's plan approved at its tier; Frank's go-ahead | Releasable per tool | Document diff and notification set match the UI | A tool released but not yet proven on production is never used on a real service; if its proof fails or is abandoned it is removed, or the connector is shut with `MCP_DISABLED=1` |
| P2 + P3 → P4 | P2's and P3's exit criteria met — including P3's live proof on production; P2 cut over; P4's plan approved at its tier; Frank's go-ahead | Releasable per tool | Solver-boundary parity with the browser's Auto | `solve_month` without `apply_schedule` is a safe stop — it writes nothing |

The one state that is **not** safe to stop in: a write tool merged without its
audit registry entry, or an entry without its writer. The audit test forbids
both, so this is enforced rather than intended.

## Shared assumptions

Carried from the v2 spec; each child re-validates the ones it depends on.

| Assumption | Impact if false | Validation | Failure response |
|---|---|---|---|
| `mcp-handler` works with Next 16.2.12 | P0 grows a hand-rolled Streamable HTTP handler | P0 gate, before any tool | Hand-roll it; design unchanged |
| Discovery can be served at the extensionless RFC paths with `issuer`/`resource` computed per request | The handshake dies at step one, or one deployment advertises the other's endpoints | P0 — production with no cookie, dev through the local bypass client | Change the serving mechanism; I10 is the contract either way |
| Assemble + GCF solve fits in 60 s serverless | `solve_month` cannot ship on Hobby | P4, measured | Escalate to Frank with the measurement; never narrow the solver scope unilaterally |
| Derived fairness history reproduces the browser's closely enough | Solver output changes unasked | P2 diff | Do not cut over; escalate to Frank before changing P4's scope |
| claude.ai callback URIs pin to a stable set | The allowlist is too narrow (handshake dies) or too wide (stops protecting) | P0, empirically | Record the observed set as a dated constant |

## Review handoff

- **Order:** after the v2 spec, this roadmap, then the critical plans P0, P3, P4 in
  sequence — each a separate fresh review with no prior findings exposed. P1 is
  standard (no plan review) under its additive-only constraint. P2 has no MCP
  dependency: its **spec** (critical) is reviewed right after this roadmap; its implementation
  plan is standard tier and gets no adversarial plan review; its **delivery** may overlap P0/P1 and must finish before P4. Review agents
  never run concurrently — one at a time, always.
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

**APPROVED** at critical tier — two sequential fresh `APPROVED` verdicts on
byte-identical digest `7e42909f…`. Changes made after that approval are listed,
un-reviewed, in [`2026-09-22-owt-mcp-roadmap-review-log.md`](2026-09-22-owt-mcp-roadmap-review-log.md).
Approval is not authorization to implement.
