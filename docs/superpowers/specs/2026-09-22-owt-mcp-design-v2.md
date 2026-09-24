# OWT Backstage MCP server — design spec v2

**Date:** 2026-09-22
**Status:** **APPROVED** at critical tier (digest `1068240f…`); later changes are listed,
un-reviewed, in [`2026-09-22-owt-mcp-design-v2-review-log.md`](2026-09-22-owt-mcp-design-v2-review-log.md). **Authorizes nothing.**
**Supersedes:** [`2026-07-28-owt-mcp-design.md`](2026-07-28-owt-mcp-design.md),
which was approved on its own terms and is now factually stale in fourteen places.
**Consumer:** Frank only (super-admin), via claude.ai custom connector — phone,
desktop, and web.

## Why there is a v2

The July spec was hardened through three adversarial review rounds and then never
implemented. Nothing about it was built: `app/api/mcp`, `app/api/oauth`,
`app/mcp`, `app/.well-known/**`, `mcp-handler` and `@modelcontextprotocol/sdk` are absent from the tree and the lockfile,
and `zod` is not a direct dependency (it resolves only transitively — A4). The `mcp-server` branch
exists and is an ancestor of `main` — docs only, zero code.

In the 56 days since, well over 1 200 commits landed (`git rev-list --count --since='2026-07-28T00:00:00-06:00' 128479bc` = 1 284), and **ADR-0010 through ADR-0038** — 29 new decision records, plus a nine-record backfill of 0001-0009 in the same window. Fourteen of the July
spec's load-bearing statements are now false, two of its preconditions are
unattainable on this project's plan, and four more statements were false on the
day it was approved. A reviewer reading the July document today
would approve a design that cannot be built as written.

This document is the reconciliation. Everything below that is unchanged from July
is unchanged on purpose and is restated so this file is self-contained.

---

## Part I — Reconciliation ledger

Each row is a July statement, the fact that replaced it, and what it costs.

### A. Claims that are now false

| # | July spec said | Today | Consequence |
|---|---|---|---|
| A1 | "the six protected types" (`:65`) | **Seven.** `specialIdentityCoordinator` joined `PROTECTED_TYPES` on 2026-08-05 (`app/utils/protectedReadAudit.ts:21-30`) | Any tool touching special services must know it. The static test pins the 7-item list verbatim (`protectedReadAudit.test.ts:599-608`) |
| A2 | "`run_solver` … a server-side rebuild, not an extraction" (`:183`) | **Half wrong.** `buildSolveRequest` (143 lines) and `applySolveResponse` (70 lines, both counted at `128479bc`) were extracted to the neutral `app/components/admin/plannerModel.ts` on 2026-07-29 — one day after the spec — and are server-callable today. Their whole transitive import graph is neutral (ADR-0028-compliant) | The *translation* to wire format is free. `buildSolveRequest` still takes an already-assembled `{ config, members, sundayDates, activeSatDates, historyEntries, year, month }`, so the server-side read layer producing those inputs is new work — and it is the layer the draft-gating and ministries rules above land on. The Sanity-write half (`applySchedule`) has no counterpart at all |
| A3 | "`MonthGenerator.tsx` (~1 700 lines)" (`:183`) | **4 094 lines.** It was 1 707 at `1c346022`, the last commit to touch it before the extraction, so July's "~1 700" was accurate then; it has grown 2.40× | The client surface to leave alone is much larger than budgeted |
| A4 | "the ecosystem is zod-v3-based; don't jump to v4 independently" (`:188-190`) | `zod` resolves **transitively at 4.3.6** today, on a production dependency path (via `sanity@5.31.1` → `@sanity/cli`), and is not a direct dependency | The pin must be re-derived from whatever the MCP SDK actually requires now. The July instruction would install a second, conflicting major |
| A5 | "Branch `mcp-server`, merged to `main` per stage (direct push, no PRs …)" (`:239`) | `main` has been **PR-only with `enforce_admins: true` since 2026-08-24** (`docs/CI.md:56-67`). `preview` still takes direct pushes | Every stage is a PR whose `gates` check must be green. The push order is `preview` first, verify the dev alias, then PR to `main` |
| A6 | Read tools return "the Servicios-sidebar numbers via `computeParticipation`" (`:174`) | `MemberParticipation` gained **`especial`**, and `total` now folds it in (2026-07-31) | A July-shaped `get_participation` payload is incomplete, not merely different |
| A7 | `list_proposals` returns "shared proposals with contributor state" (`:175`) | The live conversation moved to **`setlistProposal.messages[]`** (2026-08-24). `lead_notes`/`admin_notes` are a **frozen archive**, no longer written (ADR-0023, amended 2026-08-27) | Reading the July fields returns stale text that looks current — the worst failure mode for a conversational tool |
| A8 | `get_song` returns "lyrics presence" (`:172`) | **ADR-0018:** a filled `chords` chart *hides* `body` in every existing reader. And two divergent "full song" projections coexist — `app/(client)/posts/[slug]/page.tsx:56-87` (tags, authors, reference links, tutorials) vs `app/api/song/[id]/route.ts:16-29` (history, myInstruments) — **neither is canonical** | "Lyrics presence" is not `body != null`. And `get_song` must be defined field by field, never by copying one of the two. `rehearsalMixes[]` is in **both** projections |
| A9 | The spec's whole tool surface is implicitly worship | The **ministries axis was created 2026-08-20**, three weeks after the spec — `app/ministries.ts`, `requireMinistryMember`/`requireMinistryManager`, `requireWorshipPage`. The session now carries `ministries` and `managesMinistries` | Worship-only is now a *decision* that must be stated, not a silent default. Kids (`kidsPair`, `kidsSchedule`) is a whole vertical the surface omits |
| A10 | *Moved to F3.* The guard behaviour it concerns has been unchanged since 2026-06-16, so it belongs with the claims that were never true, not with drift | — | Not counted among the fourteen |
| A11 | Tests: the matcher "tests updated in the same change" (`:59`) | There are **two** hand-kept lists, not one. Beyond the byte-identical matcher sync guard (`routeMatcher.test.ts:155-166`), `PUBLIC_ROUTES` (`:34-50`) is a separate deliberate allowlist — "Adding to this list is a deliberate, reviewable act" | Three files per opened route — `proxy.ts`, `app/utils/routeMatcher.ts` and the `PUBLIC_ROUTES` list in its test — in the same commit, or the gate fails |
| A12 | "**Gates:** `npx tsc --noEmit` and `npm test` green before each stage ships" (`:224-225`) | **Four gates.** `eslint` at 0 errors joined on 2026-07-29, and a Python gate — `python -m unittest discover -s gcf -t gcf` — on 2026-09-16; CLAUDE.md now says "all FOUR must pass", the Python one when a change touches `gcf/**`, and the CI `gates` job runs it on every PR (`.github/workflows/ci.yml:69-70`) | Nothing is planned wrong in v2, but the July text under-states what every stage must pass |
| A13 | `app/utils/serviceReadQueries.ts:1` still reads "the **six** protected service types" | Seven since 2026-08-05 (A1). Live staleness in the tree, not in the July spec | Harmless today, but it is the same drift A1 records, in the file this design now leans on hardest. Fix it in P1 |
| A14 | `run_solver` "writes assignments onto draft services" and "does not create them" (`:183`) | The only **solver** path in the app today is the opposite: Auto is offered in **create** mode only (`app/components/admin/PlannerGrid.tsx:2001`) and applies a solve by **creating** draft services (`handleConfirm` → one `POST /api/admin/roles` per service). One automatic fill **does** write onto stored services, and it is not a solve: «Llenar especiales…» (PR #91, `app/components/admin/groupFill.ts`), which runs the two local fillers over a group of existing specials — published ones included — through the stored save; `docs/MONTH_GRID_EDITING.md` calls it "the explicit exception" to never filling a roster automatically | v2's `apply_schedule` creates and never modifies. The connector does not expose the group fill: it is a person-level change on created services, which stays in the admin UI **[D-2026-09-23]** |
| A15 | `get_service` is selected by `date?` and `kind?` (`:169`) | Several specials can share a date — same-day camp sets are a released feature (PRs #90, #91). A special's identity is **date + normalised `service_name`**; its new `time` field is display and sort only, never identity (CLAUDE.md, ADR-0011) | `date` + `kind` cannot address one special on a camp day; a read that picks one arbitrarily feeds the wrong set's observations to a write |
| A16 | `edit_setlist` "Add/remove/reorder songs on a service" (`:181`) | A worship night (`special_role.format = "worship_night"`, ADR-0036, 2026-09-22) names one or two **leaders per song** (`songs[].leads`), who must be in that set's Lead when written; a save whose rows carry no leaders stores "no leaders" and **erases them** | A setlist edit that round-trips only titles and keys silently wipes a worship night's song leaders |

### B. Preconditions that cannot be met

| # | July precondition | Why it fails | Resolution adopted below |
|---|---|---|---|
| B1 | "The MCP route needs `maxDuration` **strictly greater than** the solve route's 60 s" (`:183`) | This project is on **Vercel Hobby**. Every one of the 16 routes that declares `maxDuration` declares exactly `60`; `vercel.json` has no `functions` block; **ADR-0013 states the ceiling explicitly** — "Bounded by `maxDuration = 60`, which Vercel Hobby will not raise. There is no room behind it." ADR-0032 rejected Pro on cost | **Split the tool.** `solve_month` (solve, writes nothing) and `apply_schedule` (writes) become two calls, each inside 60 s. (This rests on the ceiling the repo documents; if the project's Vercel compute allows longer, the split still stands on its own merits — see the tool section.) |
| B2 | `run_solver` "solves **and writes assignments onto draft services**" in one request (`:183`) | The solver's fairness history is `owt_solver_history_v2` in **`localStorage`**, per an explicit ADR-0010 consequence: *"Decision 2 shares the RULES, not the fairness history, so two admins still solve against different history."* A server-side solver has no access to it | **Derive the history from Sanity role documents** — its own delivery, with its own ADR amending ADR-0010. See the Fairness history (CP-SAT) decision and P2 |

### C. Things that did not exist to reuse

| # | July spec assumed | Reality |
|---|---|---|
| C1 | "Basic rate limiting on this unauthenticated endpoint" (`/api/oauth/register`) | **No rate limiter exists anywhere in the repo.** The only `rateLimit` hits are nodemailer's outbound SMTP pacing. The nearest precedent (`api/service-readiness-verification/identity`) fails closed on env checks instead; the other middleware-excluded routes are either the auth pages themselves, the prerendered gallery, or `api/cron/*`, which authenticate with a bearer secret. This must be built |
| C2 | Discovery endpoints as `.well-known` route handlers | **No `.well-known` route exists.** The closest auth precedent is ADR-0017 (the theme gallery: a deliberately public, prerendered, data-free route) |
| C3 | "JWTs signed with a new dedicated secret" | **No repo-owned JWT-signing utility exists.** `jose@4.15.9` is present only transitively, under `next-auth` and `openid-client` (two install locations: `4.15.9`, shared by those two, and `6.2.3` under `jwks-rsa`); `jsonwebtoken@9.0.3` only under `firebase-admin`. `google-auth-library` verifies *Google's* tokens against Google's JWKS and issues nothing. A direct, pinned dependency is required (ADR-0001 is the repo's pattern for pinning) |
| C4 | `mcp-handler` × Next 16 as an "open question … none block the design" | Neither `mcp-handler` nor `@modelcontextprotocol/sdk` is in the lockfile, and `next` resolves to **16.2.12**. This is not an open question at the end of planning — it is the **first gate**. (Ambient risk worth recording: `next-sanity@12.4.5` self-reports as "not recommended for usage with Next.js v16") |

### D. New enforcement that did not exist in July

| # | Mechanism | Created | What it does to this work |
|---|---|---|---|
| D1 | **`draftGatingCoverage.test.ts`** | 2026-08-13, kids-extended 08-21/24 | The draft filters were a convention in July — "eight correct call sites and no mechanism". They are now **mechanically enforced**: any new read of `sunday_role`/`saturday_role`/`special_role` under `app/**` without `published != false`, or of `kidsSchedule` without `published == true`, fails `npm test`. Note the rules are **inverted** between worship and kids (ADR-0022) |
| D2 | **Audit registry mechanics, in detail** | continuous | Stricter than the July spec conveys. Entries are exact `file` + `operation` (an exported HTTP method name, or the literal `"module"`), **no globs**; the test pins each registry to an exact sorted list via `toEqual`, so a new entry fails until the assertion is updated; registries are pairwise disjoint; **an entry must be exercised by a real non-compliant site on the same commit** — pre-registering fails the "carries no dead entries" test. Precedent worth heeding: *"Child A Phase E added this read-only reconcile and listed it nowhere, so the audit failed on the commit that introduced it"* |
| D3 | **`PROTECTED_RUNTIME_WRITERS` licenses writes only** | — | *"A guarded runtime route is licensed to write, never to read off a non-canonical client."* Combined with the fact that a non-route module collapses to a single `"module"` operation, a tools module that both reads and writes gets **one registry key that does not excuse its reads**. Every protected read in `app/mcp/**` must go through `operationalClient` regardless of write registration |
| D4 | **The fail-closed dynamic-query trap** | — | A query expression the scanner cannot statically resolve, run on a non-canonical client inside an operation that names a protected type, is a hard violation **with no registry home**. This independently forecloses any "pass me a GROQ string" tool — which the July spec had already ruled out as a non-goal, for different reasons |
| D5 | `revalidateRolePublication` ≠ `revalidateServiceViews` | — | Publication deliberately omits `/posts/[slug]` ("publication state does not change any setlist"). A publish tool must call the bespoke one, not the generic one |

### F. Wrong in July too, and still wrong

Four errors are not drift. All four were false on the day the July spec was approved, and
three adversarial rounds did not catch them — by construction, because they were
reading a plan and not the routes. It is recorded separately so the distinction
survives: a stale claim and a claim that was never true have different lessons.

| # | July spec said | Fact | Consequence |
|---|---|---|---|
| F1 | `publish_service`/`unpublish_service` flip draft state "through the same code path as the admin publish routes" (`:184`) | `/api/admin/roles/publish` contains **zero** readiness logic and has **no caller in the app**. `/api/admin/roles/publish-ready` — which landed 2026-07-25, three days *before* the July spec — declares itself "the server-authoritative publish surface", and is what `ServicesPanel.tsx:614,661,681,702` calls | An implementer reading either spec builds on `/publish` and ships a conversational tool that can publish a service the admin UI would refuse. See the corrected tool row |
| F2 | `list_services` returns "coverage gaps (`summarizeUnfilledSeats`)" (`:170`) | `summarizeUnfilledSeats` (`app/utils/unfilledSeats.ts:63`, unchanged since 2026-06-30) parses **solver-response seat strings** of the form `W2 Sunday Sun.Choir #2` (`app/utils/__tests__/unfilledSeats.test.ts:10`) (`SEAT_RE`, `:30`). It cannot read stored service documents, and it has **no production caller at all** | It cannot say what is missing on a month of real services. The stored-state answer is the readiness blocker set — see I4 |
| F3 | Each write tool performs its own "read-capture-assert: read the target doc(s) through `operationalClient`, capture `_rev` … and pass those as the observed revisions **so concurrent edits from the app UI fail the assertion instead of being clobbered**" (`:79-85`) | A revision the tool captures inside its own write request observes nothing Frank saw: it proves only that nothing changed **during that request**. An admin edit landing between Frank reading a service and asking for the write is clobbered, not refused. Every admin counterpart takes the revision the **client** observed (`app/api/admin/roles/publish-ready/route.ts:193-195`, `swap/route.ts:46-49`, `app/utils/setlistWriteRequest.ts:82-84`) **And July never named the other half of the problem:** a tool cannot reuse the admin guards to authenticate at all — `requireActiveManager()` takes no `req` and resolves the session from ambient cookies (`app/utils/authGuards.ts:13-14`), unchanged in substance since 2026-06-16 (`d8141bcd`, last touched the same day by `04e397f1`) | I7 replaces the capture: every write takes the observations from a read the user acted on, and an in-request capture does not satisfy it. I6 covers the guards: authorization is separated from domain logic |
| F4 | The two discovery documents are "static JSON" (`:100-101`) | The preview deployment already existed and already wrote the production dataset (its mail redirect dates from 2026-07-24), so there were two origins on the day the spec was approved. RFC 8414 requires `issuer` to equal the origin fetched; a static document can carry only one | I10 replaces it: discovery is computed per request |

### E. Process debt to clear

The July spec went through three adversarial review rounds and **has no committed
review log**, which the repo convention requires beside the artifact. v2 carries
its own log when reviewed; the July rounds are recorded as unlogged and are not
reconstructed.

---

## Part II — The reconciled design

**What this part is, and what it is not.** It states what must be true of the
MCP server: its scope, the invariants every tool obeys, and each tool's contract
— what it returns, what it must refuse, what it must never do. It deliberately
does **not** prescribe which helper, route or query implements a contract. Those
choices are made in the P0–P4 implementation plans, written immediately before
each delivery against the code as it stands then, and reviewed as diffs. Where a
contract is only satisfiable in a non-obvious way, the fact that makes it
satisfiable is stated with its evidence; the implementation is not.

Decisions Frank settled are marked with their date, e.g. **[D-2026-09-22]**.

### Goal

Let Frank manage the OWT app conversationally from the Claude apps: query
services, setlists, assignments, availability and songs; then edit setlists, swap
assignments, publish services, and run the month solver.

### Non-goals

- Team-member access. Single-user, super-admin-only by design.
- A standalone service. The MCP lives inside this Next.js app and deploys with it;
  no new infrastructure.
- Raw Sanity document access. The hosted Sanity MCP already offers that; this
  server exposes the *domain* layer. Also foreclosed by D4.
- Local stdio transport. Remote-only, Streamable HTTP. **[D-2026-09-22]** — the
  phone is the point.
- July's Stage 3 (member management, sending notifications, proposal
  administration). July left it "on demand" (`:201`, `:237`); it stays deferred and has no
  tools in this surface. Each piece would get its own mini-spec when a real need
  appears, as July intended.
- **The kids ministry. [D-2026-09-22]** The surface is worship-only.

### Invariants — every tool, every stage

| ID | Invariant | Why it is not optional |
|---|---|---|
| **I1** | Every protected read runs on a canonical operational client; every protected write carries its exact `file`+`operation` audit registry entry and the updated exact-list assertion **in the same commit** as the writer | D2, D3, D4. The audit fails the suite otherwise, and an entry cannot be staged ahead of its writer |
| **I2** | The MCP adds **no** entry to `MAY_SEE_DRAFTS` and puts **no** draft-gated query literal in an MCP-owned file. **No MCP route lives under `app/api/admin/**`**, whose prefix exemption would silently apply to it | D1. A new exemption is a widening of a security guard. The contract is satisfiable because an exempt canonical read model already exists (`app/utils/serviceReadQueries.ts`, exempt at `draftGatingCoverage.test.ts:96-104`) and can be extended |
| **I3** | Every payload that describes a service carries its **publication state, normalised by the app's own rule**: only an explicit `published === false` is a draft; an absent field is a service created before draft/publish existed, and it is published (`derivePublishState`, `app/components/admin/serviceReadiness.ts:105-109`; CLAUDE.md's draft-gating rule). The raw field may ride alongside; the normalised state is what the tool asserts. No tool infers visibility from the absence of a filter | Reads run as super-admin and must see drafts — the write path cannot publish a draft it cannot see — so this state is the only thing standing between "draft" and "live" in what Frank is told. Reporting the raw field would hand the model an empty value for every legacy service, on exactly the question this invariant exists to answer |
| **I4** | **One readiness predicate.** What a read tool reports as blocking a service is exactly what `publish_service` would refuse that service for | F1: the server-authoritative publish surface recomputes readiness itself. Two predicates would let the connector say "nothing is missing" and then refuse to publish |
| **I5** | **Worship scope.** No read that **lists members** returns a kids-only member, **even though the caller is super-admin**. (A seat read shows whoever is actually seated, even if that member has since become kids-only — hiding a seated person would misreport the service.) | [D-2026-09-22]. The trap is concrete: the existing worship member-list filter deliberately admits *every* member for a super-admin (`WORSHIP_MEMBER_GROQ_FILTER`'s `$all` arm, `app/ministries.ts:44-57,77`), and its admin callers bind it that way (`app/api/admin/members/route.ts:31`). That bypass must not apply here. **The solver's member pool is not a member-listing read:** `solve_month` uses the same pool the browser's solve uses, so its solve request can match the browser's (P4 — the schedule itself is randomly seeded, in the browser too) and ministries never becomes a second eligibility axis (ADR-0029). Parity includes this: whoever the shared rule set's pools name is eligible to the solver, exactly as in a **super-admin's** browser solve (which is what Frank runs) — even a kids-only member who still carries a worship Tipo |
| **I6** | Every request is authenticated by bearer token at the route, before any tool dispatches. No per-tool bypass. Authorization is kept separate from domain logic | F3: the admin guards read the session from ambient cookies and cannot authenticate a bearer-token caller, so reusing domain code requires separating the two |
| **I7** | **Concurrency parity, with a real observation.** Every write requires the identities and observed revisions — and, for a setlist edit, the observed row `_key`s, an identity the connector adds (the admin writer takes only the observed target) so that rows can be named unambiguously — that its admin counterpart requires, **taken from a read the user acted on**, and refuses on any mismatch. Every read that can precede a write returns exactly those values. **A revision captured inside the write request does not satisfy I7**: it asserts only that nothing changed during the request itself. Each write also asserts every coordination token its counterpart asserts, and inherits that path's known gaps without widening them | Every admin counterpart takes the client's observation: publish takes `roles: [{ id, rev }]` and refuses `stale_revision` (`app/api/admin/roles/publish-ready/route.ts:193-195`); swap takes `{ roleId, rev, path, itemKey }` (`swap/route.ts:46-49`); the setlist writer requires an observed target — "a writer must never guess which document was observed" (`app/utils/setlistWriteRequest.ts:82-84`). Without the read side, Frank could publish or swap a team another admin changed after he looked at it — which the admin UI refuses today |
| **I8** | **Notification parity.** A write fires exactly the notifications its admin counterpart fires, computed from state captured **before** the commit | `docs/NOTIFICATIONS.md:724-726`: reading live state after the commit makes before == after and silently sends nothing |
| **I9** | **Honest outcomes.** A write returns what actually changed and which notifications it **queued, and to whom** — never that they were delivered, since every counterpart sends after the response and swallows its own failures; a multi-item write reports per item; an error is never success-shaped | July's write contract, kept. It is what makes a partial outcome survivable in a conversation |
| **I10** | **Discovery per origin.** The OAuth discovery documents are served at the RFC 8414 / RFC 9728 paths — the protected-resource document at both its root and its path-inserted form, since some clients fetch only the latter (`:101`) — with `issuer` equal to the origin actually fetched and `resource` equal to the resource identifier each well-known URL was built from — the MCP endpoint's own absolute URL on that origin, as RFC 9728 §3.3 requires and as O2's audience check uses — **computed per request** — never fixed to one origin | Every deployment answers on several hostnames — its own deployment URL and its alias — and the two aliases (`dev-owt-backstage.vercel.app`, `owt-backstage.vercel.app`) share one dataset. A `401` from the MCP route carries `resource_metadata` in its `WWW-Authenticate`, pointing at that document. A document fixed to one origin, served from the other, does not fail — it silently advertises the other origin's endpoints. Together with O2's audience check, this keeps each deployment's OAuth surface its own, even though only production is registered as a connector (see Connector origin) |
| **I11** | The MCP, OAuth and discovery paths are excluded from the session middleware, and **both** hand-kept lists stay in sync in the same commit | A11. Discovery is fetched before any login exists; a session gate there kills the handshake at step one. Exclusion is transport-level only — every excluded route enforces its own auth |
| **I12** | **Cache parity.** Every write performs exactly its admin counterpart's cache invalidation — no write skips it | July's "revalidate — never skip" and CLAUDE.md's cache invariant. The admin swap and create both revalidate (`app/api/admin/roles/swap/route.ts:306`, `app/api/admin/roles/route.ts:343`); a swap on a published service that skipped it would leave member pages stale |
| **I13** | **Inputs are validated and unknown fields are rejected**, on every tool, and **every document an input references resolves to a document of the expected type** — a setlist row names a song, a seat names a member | July's write contract, kept. A tool that ignores an unexpected field cannot tell a typo from an instruction it does not implement |
| **I14** | **Every tool declares what it does.** Reads are declared read-only. **Every write is declared destructive** — each one replaces, notifies or creates in the production dataset: `edit_setlist` replaces a whole setlist and, on a published service, pushes to the whole team; `swap_assignment` notifies the members it adds; `publish_service` notifies; `apply_schedule` creates services; `unpublish_service` hides a live service from the team. `solve_month` and `revise_proposal` write nothing to the dataset and are declared read-only. A client that confirms destructive calls before making them can therefore confirm every write | CLAUDE.md requires explicit consent for production Sanity writes, and every write here lands in the production dataset. The declaration is what lets the client ask, so a write that notifies the whole team must never be the one labelled harmless |
| **I15** | **Refusal parity.** Every write refuses **at least** everything its admin counterpart refuses, and reports each refusal with its reason | I7 covers concurrency; this covers everything else a counterpart guards. The admin create, for one, also refuses raw drafts at the target, weekend-lock integrity problems, and **any existing history on the date** — "normal create/move never adopts history" (`app/utils/roleDependencies.ts:234`; `app/api/admin/roles/route.ts:153-208`) |

### Auth — OAuth 2.1 over the existing NextAuth login

The July design stands and is restated as contracts:

| ID | Contract |
|---|---|
| **O1** | The claude.ai custom-connector handshake completes from the phone **against production** (see Connector origin): RFC 8414 + RFC 9728 discovery, dynamic client registration, PKCE (S256), and an authorization step that requires a live NextAuth session with role `super-admin` — redirecting a cookie-less browser to sign-in with the authorize URL intact, and rejecting any other role. Any live super-admin qualifies — the same trust the app already extends to that role. `redirect_uri` is matched **exactly** against the client's registration, and registration accepts only redirect URIs on an allowlist of claude.ai / claude.com callbacks, observed empirically and recorded as a dated constant. The allowlist is per origin: production accepts those callbacks only; if P0 exercises dev with a local client, a loopback redirect (RFC 8252) is accepted **on dev only**, never on production. Because both origins store OAuth state in one dataset, **authorize and token re-check the per-origin allowlist themselves** rather than trusting a stored registration's redirect URIs — and **a registration is bound to the origin that issued it** (a stored field, or the origin inside a signed, stateless client id), so a client registered on dev is refused by production even when its redirect URIs are claude.ai callbacks. The `state` parameter is returned unchanged. **Authorize refuses while the browser session is impersonating someone**; a token's subject is always the real signed-in super-admin |
| **O2** | On **every** request, within a 30 s cache (`TTL_MS = 30_000`, `app/utils/memberAccess.ts:4`): the token's signature and expiry hold; its grant is not revoked; **its subject is an existing, non-disabled member whose live role is still `super-admin`** — the same live re-check the app already applies to every session (`auth.ts:258-311`), so a demotion or a disabled account takes effect within the TTL, not at the end of a 7-day token or never; and **its audience equals this origin's MCP resource** (RFC 8707), so a token minted on one deployment is refused by the other even though both share one dataset — a second line of defence behind O7's distinct per-environment secrets. `MCP_DISABLED=1` short-circuits **every** MCP and OAuth route — the MCP route, registration, authorize and token — not only the MCP route; changing it takes effect on the next deployment |
| **O3** | The unauthenticated registration endpoint is rate-limited **and** hard-capped in how many registrations it keeps. No rate limiter exists to reuse (C1); the cap, not the rate limit, is the real bound on document spam. **The cap evicts the oldest registration that holds no consented grant, and never refuses a new registration because of them; a registration holding a consented, unrevoked **and unexpired** grant is never evicted, and neither is one young enough to be mid-handshake** (created within the authorize window). Otherwise a flood of junk registrations could evict Frank's live registration or crowd out his new one indefinitely; with these rules a sustained flood can at most **delay** a first connection or a re-add while it lasts. **Precedence when nothing is evictable** (every stored registration is consented or mid-handshake): a new registration is refused with a retry hint — a flood can delay a first connection, never break an existing one. A registration that stores nothing (a signed, stateless client identity) meets O3 without a cap at all |
| **O4** | An authorization code lives **at most 60 s**, is **single-use**, and is **bound** to the `client_id`, the exact `redirect_uri` and the PKCE challenge used at authorize; the token endpoint re-verifies all three against what the client presents. A replay is **refused**, not silently absorbed — a check that no-ops when the record already exists cannot signal a replay, so the refusal must come from a write that fails on conflict. Reuse of a superseded refresh token revokes the whole grant. A legitimate retry after a lost token response looks identical to theft and also revokes the grant; that is accepted, and the cost is that Frank occasionally reconnects the connector |
| **O5** | Stored OAuth state is limited to non-secret, non-replayable fields — current refresh-token `jti`, redeemed auth-code `jti`s, the `revoked` flag, registered redirect URIs. The dataset answers unauthenticated published reads (`sanity/lib/operationalClient.ts:13-15`), so anything stored is world-readable |
| **O6** | Tokens are signed with a dedicated secret, `MCP_OAUTH_SECRET`, never `NEXTAUTH_SECRET`, by a **direct** dependency pinned to an exact version (C3). Access token 7 days, refresh token 30 days, rotated on use |
| **O7** | `MCP_OAUTH_SECRET` and `MCP_DISABLED` each get a `docs/SECRETS.md` entry in the same change that introduces them, in that file's existing shape. Needed on Vercel (all environments, with **distinct values for preview and production**, so O2's audience check is a second line of defence rather than the only separation between two deployments that share a dataset) and local `.env.local`; **not** in CI, the iOS build or GCF. Never the value. If P0 smoke-tests the MCP endpoints on dev with the existing Vercel protection-bypass secret, that secret's `docs/SECRETS.md` entry gains the new consumer in the same change |
| **O8** | **Consent, per client.** The authorize step shows a consent screen with the registering client and its redirect URI — treating the self-declared client name as untrusted, showing how long ago the client registered, and warning to approve only a connection Frank has just started — and issues a code only on an explicit approval sent as a **POST** (the NextAuth session cookie is `SameSite=Lax`, which then covers CSRF). Consent is **never remembered**: every authorization shows the screen and needs its own POST, whatever the client, because nothing guarantees claude.ai does not reuse client ids. Registration is open to anyone, so without this a super-admin browser that opens someone else's authorize link would be issued a code silently — the confused-deputy attack |
| **O9** | **Revocation.** Frank can revoke any grant through a documented path that needs no deployment, and it takes effect within O2's 30 s |

### Connector origin — production only **[D-2026-09-23]**

`dev-owt-backstage.vercel.app` sits behind Vercel Deployment Protection
(ADR-0027:7; `docs/SECRETS.md:381-387`): a request without the protection-bypass
header or cookie never reaches the app. claude.ai's servers carry neither, so
they cannot fetch discovery, exchange a token or call the MCP route on dev.
Lifting that protection was considered and declined: dev writes to the
production dataset, and would then rest on NextAuth alone.

So **the claude.ai connector is registered against production only.** The code
still goes preview-first exactly as every change does (Rollout, below); what
changes is where the *connector* is exercised:

- **On dev:** the MCP and OAuth endpoints are smoke-tested by a local client that
  carries the protection-bypass header — not by claude.ai. Dev writes the production
  dataset and nothing gates pushes by environment (its mail redirect covers email
  only), so **the dev smoke test calls no write tool against a real service**, and the
  notification-audience rule below applies to any write it does make.
- **On production:** the handshake from the phone (O1), and every tool's first
  connector-driven run.

### Tool surface

Dates in and out are `YYYY-MM-DD` under the `America/Mexico_City` invariants.

#### Reads

| Tool | Contract | Constraints the implementation must respect |
|---|---|---|
| `get_service` | One service, selected **unambiguously** — by service id, or by date and kind, or for a special by date and name; default the next upcoming. **An ambiguous selector is refused and the candidates are listed** (ledger A15). Returns its name, time and format for a special, its setlist — per row the song (id, title, author), the key it is played in, its medley grouping, and on a worship night its leaders —, all five seat groups with member **names**, `published` (I3), and its readiness blockers (I4). It also returns **every observation a write needs (I7)**: the role's id and `_rev`, and the setlist's observed state — its id, `_rev` and rows' `_key`s, or its observed absence | **No existing read model answers this alone.** The readiness bundle is deliberately song-free and name-free (`app/utils/publishReadyBundle.ts:254`, `:266`, `:504-508`), and the only query that resolves seats and joins the setlist lives inline in a route (`app/api/admin/roles/route.ts:64-81`). I2 applies to whatever is built. Song documents are neither protected nor draft-gated |
| `list_services` | Every service in a month, in the app's own order (date, then time): date, kind, and for a special its name, time and format; publication state (I3), readiness blockers (I4), and each role's id and `_rev` (I7) | Ledger F2: the helper July named cannot answer this. Readiness is computed over the whole catalogue today (seven queries, including every proposal thread) — a cost the plan may narrow as long as I4 holds |
| `search_songs` | Fuzzy, **accent-insensitive** search over title, artist and key (`normalizeText`, as the library does — the catalogue is Spanish), with an exact tag filter; several tags combine as the library combines them since PR #92, with the library's own tempo-versus-theme split (`isTipoSlug`, `app/utils/libraryIndex.ts:90`) — any match within the tempo tags, any match within the themes, and both groups must match | Tags are never fuzzy-matched. The vocabulary is **exactly 43 tags — 40 themes and 3 tempo** (`docs/SOLVER_AND_INFRA.md:170-171`); artist tags were removed on 2026-09-06 and must not return. That count is a snapshot of Studio-editable data: the tool reads the vocabulary live and never hard-codes it |
| `get_song` | A declared field set: title, authors, keys, tags, reference links, lyrics presence, rehearsal mixes by tone, play history | Ledger A8: two divergent song projections exist and neither is canonical, so the field set is declared here and copied from neither. **Lyrics presence obeys ADR-0018** — a filled chord chart hides `body`. A mix is identified by its array `_key`, never by a musical key. Play history is computed as the song page computes it today — past services only, and a draft overlay never counts as a play (`app/api/song/[id]/route.ts:32-55`) — under I2 |
| `get_member_availability` | Unavailable dates for the month, for one member or the whole worship team | I5 |
| `get_participation` | Per-member counts for the month, including `especial` and the `total` that folds it in (A6) | **This is a draft-gated read** — participation is computed over the three role types (`app/utils/computeParticipation.ts:2-10`) — so I2 and I3 apply, and each service's `published` is reported so Frank can see which counts include drafts |
| `list_proposals` | Proposals per service, with the **live message thread**, and whether the thread is still open | Ledger A7: the thread lives in `messages[]`, not the frozen notes fields. The thread stays open **through** the service date and closes after it (`isThreadOpen` returns `day >= today`, `app/utils/proposalThread.ts:94-104`), independently of proposal status. **Unread state is never reported** — ADR-0024 puts read-marks on neither document |

#### Writes

| Tool | Contract | Must refuse / must never |
|---|---|---|
| `edit_setlist` | Given the setlist observation from `get_service`, replace a service's setlist — Sunday `featuredSongs`, Saturday `saturdarSongs` (the typo is load-bearing), specials — producing the same document and the same cache invalidation as the admin setlist editor; a `_key` on every array item. **Every stored row attribute survives an edit that does not explicitly change it** — the key a song is played in, its medley grouping, and on a worship night its leaders (ledger A16). A reorder or a removal re-derives medley grouping by the admin editor's own adjacency rule (`normalizeMedleyTags`, as `SetlistEditor.tsx:247,259` does), so the stored result is one the admin UI could have produced. Omitting an attribute is never read as clearing it: the writer stores `play_key`, `medley_tag` and `leads` only when they are sent (`app/utils/setlistWriteRequest.ts:195-208`), so a read-then-replace that forgets them would erase every medley in the set. Rows are identified by the `_key` each one carried in the observed setlist — stable under the observed `_rev` — so a song that appears twice is still two distinct rows; a new row carries no key; **an edit that names a key the observed setlist does not contain is refused, never guessed**. It returns the fresh observation (new `_rev` and row `_key`s), so a follow-up edit needs no re-read, and it reports the admin editor's repeat-song hint — a song already used in the last eight weeks (`app/api/admin/setlists/route.ts:210`). (The writer then issues fresh `_key`s on save, `:198`, which is why the observation, not the stored key, is the identity.) | Refuse on a stale observed setlist or target. Inherits the admin path's concurrency exactly (I7), **including its one known gap**: a weekend setlist saved before its role exists commits with no lock assertion (`app/api/admin/setlists/route.ts:404-407` is conditional on a lock). The tool neither widens that gap nor silently changes it. A leader not in the set's Lead is refused, as the admin writer refuses it |
| `swap_assignment` | Given the role ids and `_rev`s from `get_service`, swap **two whole sections or two whole teams** between services — the only two shapes the admin UI sends (`app/components/admin/MonthGenerator.tsx:2815`, `:2913`) — with the admin swap's validation. **Never a single seat.** The swap route also accepts a seat-level shape, but no screen sends it any more (`app/components/admin/ServicesPanel.tsx:1322-1325`; `docs/MONTH_GRID_EDITING.md:85`), and the server checks it only referentially — "memberType remains UI guidance, not server policy" (`app/api/admin/roles/[id]/route.ts:129`). Every person-level move the UI makes today passes the planner's gate, where a wrong Tipo or a same-section double can never be forced and a hard-rule block needs a recorded human override; a seat swap through the connector would skip all three. So person-level changes stay in the admin UI | Assert **both** roles' observed revisions and every owned lock's revision in **one** transaction. `_key`s travel with their items and are never regenerated. **Not refused — the admin swap does not refuse these either — but reported, which the admin UI does not do at swap time:** on a worship night, a swap that moves someone out of Lead while songs still name them as leader is reported with those songs (the next setlist save is refused until the leaders are fixed); and a swap across dates that places anyone on a date they marked unavailable is reported with those names |
| `publish_service` | Given a service's id and `_rev` from a read, publish that draft, firing exactly the admin publish's notifications (I8) and cache invalidation — including the **immediate**, undelayed «Setlist listo» email of ADR-0037 (a publish followed by an edit within minutes therefore sends two emails, in the admin UI and here alike) | **Refuse every service the admin UI would refuse** — the server-authoritative readiness of ledger F1, recomputed at publish time, never trusted from the caller. **Never override a blocker**: workflow blockers are reported to Frank in words; overriding one stays an admin-UI action, where the acknowledged set is a deliberate click rather than a model's inference. Integrity blockers are never overridable anywhere |
| `unpublish_service` | Given a service's id and `_rev` from a read, return it to draft, exactly as the admin unpublish does | Notifies nobody, deliberately. The admin unpublish also runs an outbox sweep after it responds (`app/api/admin/roles/unpublish/route.ts:30-32`); the tool does the same, or records the difference — the scheduled sweep covers it either way |
| `solve_month` | Do what the admin planner's **Auto** does, in full. Solve the month's weekend voice seats with CP-SAT — **always every Sunday of the month**, plus **every Saturday of the month unless Frank excludes some** — the planner turns them all on by default («Domingos y sábados se generan por defecto», `app/components/admin/MonthCalendar.tsx:299`; `MonthGenerator.tsx:1842-1846`); unlike an excluded Sunday, an excluded Saturday is not solved, exactly as in the planner — then, on the same proposal, run the two local fills Auto runs on every exit (`app/components/admin/MonthGenerator.tsx:3040-3097`): **instrument seats on every weekend service** (`fillInstruments`, shipped 2026-09-10) and **each special Frank names for the month** (date and name), filled locally as ADR-0010 prescribes rather than by CP-SAT. A named special is **refused and reported** on the planner's own terms (`refuseSpecialOn`, `MonthCalendar.tsx:140`): its date already carries a weekend service Frank has not excluded, another special in the same request shares its date, or a special already exists on that date in the dataset. **A refused special is never silently dropped** — the planner's column builder drops an overlapping one with only a console warning (`plannerModel.ts:433-450`), which a conversational tool must not do. Return the proposed schedule, the solver's own diagnostic verbatim (including `objective_skipped`, which ADR-0038 says real history can trigger, and any name the solver returned that matches no member — Auto surfaces those separately, `MonthGenerator.tsx:1701`), **every seat Auto would report unfilled** — voices, instruments and specials alike; the solver's own `unfilled_seats` lists voice seats only, so the proposal adds what the local fills leave empty, as the browser's «Lugares sin cubrir» does — and a **proposal bound to this solve** (see `apply_schedule`), carrying per service the identity that makes applying it idempotent. **When CP-SAT itself fails**, the local fills still run, as they do in the browser on every exit, and the tool returns the solver's diagnostic with whatever the fills produced — a bound proposal only if any seat was filled, marked as partial. A Sunday Frank excludes **is still solved** and is only left out of the proposal: the solver's weeks are positional, and every week-scoped rule, Saturday index and availability entry is keyed to that position, so dropping a Sunday from the input would shift every hard rule onto the wrong date. The admin UI does exactly this (E21: "the solve always addresses the full month's Sundays — only RENDERING/CREATION is gated", `MonthGenerator.tsx:1913-1915`) | **Writes nothing.** Completes inside 60 s (B1). **It reads role documents, twice over, and both are draft-gated reads under I2.** (1) CP-SAT's fairness history comes from P2's derivation. (2) The two local fills rank candidates by `load` over a **56-day window of role documents ending at the month's first Sunday — drafts and specials included** (`savedWindowFor`, `MonthGenerator.tsx:417-433`, consumed at `localFill.ts:263` and `instrumentFill.ts:169`); specials count toward that signal on purpose (ADR-0010 Decision 3). The two inputs are distinct: P2's `special_role` exclusion applies to the CP-SAT history **only**, never to this window. **Specials never reach CP-SAT** — ADR-0010 fills them locally, in the same Auto action. The fill modules carry no client boundary (`app/components/admin/localFill.ts`, `instrumentFill.ts`), so running them on the server re-implements nothing |
| `revise_proposal` | **[D-2026-09-23]** Apply Frank's edits to a bound proposal — place a member in a seat, clear a seat, or exchange two people within the proposal, on **any** seat the proposal carries: voices, instruments, and the named specials — and return a **newly bound** proposal with the diff against the solver's original and the updated unfilled seats. Writes nothing to the dataset. Frank's own words: quick edits by him; the heavy lifting by the solver and the assistant | **Each edit is judged on the server by the same gate the planner applies to a human's manual pick**, before placement — never after, where every rule would pass. The gate's modules carry no client boundary (`app/components/admin/moveGate.ts`, `ruleEnforcement.ts`, `candidateRanking.ts`), so this is satisfiable without re-implementing a predicate. (The half that *performs* a move, `moveOccupant.ts`, is a client module that calls into the grid component; P4 extracts it rather than reusing it.) A wrong Tipo or a same-section double is **refused**, as the planner refuses it. A **hard-rule block is refused too**: the planner lets a human force it with a recorded override, but the connector never forces — it names the rule, and forcing stays an admin-UI action. **Count caps and presence rules are not re-checked after an edit** — the planner does not check them on a manual pick either; only CP-SAT does (ADR-0010) — and the revised proposal says so for every edited seat. It also reports, per edit, the three warnings the planner badges at pick time — the member marked that date unavailable («No disp.»), has not declared that instrument («Sin declarar»), or already holds another seat on the same service («Ya asignado») (`PlannerGrid.tsx:3006-3020`). A revised proposal keeps the original solve's expiry and rule-set revision, so revising can never extend or refresh them, and carries a **revision number** in its binding; `apply_schedule` reports which revision it applied, so applying a superseded proposal — and silently losing Frank's edits — is visible |
| `apply_schedule` | Create the draft services of a solved month **exactly as proposed** — drafts only: the browser can create a month already published, but from the connector publishing is always a separate `publish_service` call, which keeps its readiness gate. It accepts **only** a proposal that `solve_month` or `revise_proposal` returned — never a schedule the caller composes or edits by hand — and refuses one whose binding does not verify, that has **expired** (a bounded window set in P4, because eligibility — a cleared Tipo, for one — is not re-checked at apply time), or whose shared rule set has changed since the solve. A change Frank wants **before** creation goes through `revise_proposal`. After creation, whole sections or teams go through `swap_assignment`; **any person-level change on a created service stays an admin-UI action** **[D-2026-09-23]**, where the planner's gate enforces Tipo, doubles and hard rules and records any human override | **Why the proposal must be bound.** The proposal travels back through the model, and the create route enforces **no** solver rule (`app/api/admin/roles/route.ts:130-270`; hard rules are enforced only by CP-SAT and by the planner's client-side gate). A payload the model altered itself — a transcription slip, or "swap Ana and Bea first" applied by hand — would therefore create rule-blocked pairs with no override on record: the automation doing what ADR-0010 reserves for a human (`docs/adr/0010-*.md:128-142`). So the proposal is bound by a server-side signature the model cannot forge, and **the only way to change it is `revise_proposal`, which judges every edit on the server**; the signing key never leaves the server, and if it is a new secret O7 applies to it. **Creates only** — never modifies an existing service. A target the admin create would refuse (I15) — already occupied by a published or draft service, carrying a raw draft, or **already holding a setlist or proposal on that date** — is **not created and is reported**, per service, so no existing history is ever adopted; the rest of the month proceeds. That is a **deliberate difference** from the browser, which skips dates already occupied when its preview is built but aborts the whole batch if a date becomes occupied between preview and confirm — a conversational gap is long enough that aborting would make a month nearly impossible to apply. Each proposed service is created **at most once** across any number of retries, and a partial month can be finished by re-running only while its proposal is still valid. Target occupancy is re-checked **at write time**. **Not atomic across the month** — see below |

**Why `run_solver` is split.** B1 makes one request impossible. The split
also keeps the July rule that no tool both solves and publishes, extends it to
"no tool both solves and writes", and puts a natural review point between the
proposal and the mutation.

**The split's concurrency contract.** Two conversational calls can be minutes or
hours apart, with nothing to refresh in between. A revision captured at apply
time would assert nothing about the solve, and the solve observes no role
document whose revision could be carried forward — the documents `apply_schedule`
writes do not exist yet. What protects the gap is therefore what already protects
a create in this app — a per-service idempotency identity, plus a re-check at write
time that the target is still free and every assigned member still exists — and
one thing the browser does not need: a binding that makes the proposal itself
tamper-evident, because here it passes through the model. The
admin create route enforces this today, among its other refusals (I15)
(`app/api/admin/roles/route.ts`: receipt at `:258-261`, occupancy at `:148-167`,
members at `:140-145`, history on the date at `:169-180`).

**Atomicity is a stated limitation, not a gap.** The existing create surface is
one service per request (`app/api/admin/roles/route.ts:126,213,368`), and the
browser applies a month as a sequential loop and reports partial failure — "No se
pudieron crear N de M servicios". `apply_schedule` inherits that and reports per
service (I9); a re-run converges because each create is idempotent. An atomic
month would need a new batch-create writer, which no delivery here builds. The
repo already has the atomic multi-role pattern (`publish-ready` commits every
entry in one transaction), so this is a scope decision with a known cost.

### Error handling, testing, first live exercise

- Auth failure → `401` with `WWW-Authenticate` before any dispatch. Tool errors →
  MCP tool-error results with a human-readable message, never stack traces or
  Sanity internals. Solver failures surface the solver's own diagnostic.
- Pure logic is unit-tested: JWT sign/verify/expiry, PKCE S256, auth-code replay
  **asserting the refusal path**, input schemas, payload shaping, timezone
  formatting. Routes are tested the way this repo tests routes today.
- All four gates pass per stage — `npx tsc --noEmit`, `npm test`, `npx eslint .`
  with 0 errors, and `python -m unittest discover -s gcf -t gcf` when a stage touches
  `gcf/**` — which is what the CI `gates` job runs (`.github/workflows/ci.yml:46,49,55,69-70`).
- **A write tool's first connector-driven run is on production** (Connector
  origin), which has no mail redirect — so it runs against a **throwaway service
  made for the purpose, seated with Frank alone**, never a real upcoming service,
  and removed afterwards. `publish_service` cannot override "empty team" or
  "missing setlist", so the throwaway also carries a setlist. Seated with Frank
  alone, publishing it should notify only Frank. Notifications are sent from post-commit hooks that swallow their own failures, so
  the first run confirms Frank actually **receives** each push and email — not only
  that the audience was right. A published throwaway is visible to the whole team on
  member pages until it is removed, so it is dated and named to be unmistakably a test and removed right
  after the run — for a special: unpublish, clear its songs (delete refuses a
  special that still has songs), then delete. The rule generalises: **before
  any write tool's first connector run, its plan confirms the exact audience of
  every notification it can fire, and the run targets something whose audience is
  Frank alone or that notifies no one** — an unpublished draft for `edit_setlist`,
  because a setlist save on a published service sends a push to the whole team
  (its email goes only to those seated); **two** throwaway
  services for `swap_assignment`, whose section and team swaps need two distinct
  services; a month
  with no existing services for `apply_schedule`, whose drafts are removed after.

### Rollout

Replaces July's "direct push per stage" (A5), in CLAUDE.md's order: review and its fix-verification come **before** preview, so the commit that reaches dev is the reviewed one and no fix reaches `main` without passing through dev. Per stage, without exception:

    feature branch (tsc + vitest + eslint 0 errors, + gcf unittest if gcf/** changed; locally green)
    → fresh CODE REVIEW of the merge range → fix
    → RE-VERIFY THE FIX (scoped review of the fix range + gates on the final tree)
    → merge into preview, push, VERIFY the dev alias moved
      (dev-owt-backstage.vercel.app in `alias`, `meta.githubCommitSha` == the pushed commit)
    → PR to main from that same reviewed commit, wait for `gates`
    → merge = production release → verify the production alias the same way
    → exercise the stage through the claude.ai connector (production only)

---

## Decisions

| Decision | Choice | Why | Tradeoffs | Owner |
|---|---|---|---|---|
| Connector origin | Production only | dev is behind Vercel Deployment Protection, which claude.ai cannot pass; lifting it would leave an app that writes the production dataset guarded by NextAuth alone | Each stage's first connector run is on production; mitigated by the kill switch, per-stage tool rollout, and a throwaway service seated with Frank alone | Frank, 2026-09-23 |
| Transport | Remote OAuth, Stage 0 first | The phone is the goal and a local stdio server cannot serve it. Stage 0 buys the compat answer (C4) and the callback URIs for days of work instead of weeks | If the MCP handler library fights Next 16, P0 hand-rolls the handler | Frank, 2026-09-22 |
| Write scope | Full, including the solver | Reaffirmed after both blockers (B1, B2) were stated | B2 makes the history derivation a prerequisite delivery with its own ADR | Frank, 2026-09-22 |
| Ministries | Worship only | Matches the surface July defined; one draft-gating model in the first releases | Kids stays unreachable from the connector | Frank, 2026-09-22 |
| `run_solver` shape | `solve_month` (everything Auto does) + `revise_proposal` + `apply_schedule` | B1 is a hard ceiling ADR-0013 says will not move | Two round trips instead of one | this spec |
| Editing a proposal | Allowed, through `revise_proposal`: server-judged per edit, re-signed | Frank wants quick edits from the connector and the heavy lifting done for him. The create route enforces no solver rule, so edits must be judged on the server, never assembled by the model | Hard-rule blocks cannot be forced from the connector; caps and presence rules are not re-checked after an edit (as with a manual pick) | Frank, 2026-09-23 |
| `apply_schedule` input | Only an unexpired proposal bound by a server-side signature, from `solve_month` or `revise_proposal` | Keeps every path from solve to create on the server's terms | — | this spec |
| Person-level edits on created services | Stay in the admin UI; the connector swaps only whole sections or teams | The server checks a seat-level swap only referentially; the planner's gate is where Tipo, doubles and hard rules are enforced | Moving, adding or removing one person on a created service needs the admin UI | Frank, 2026-09-23 |
| `apply_schedule` atomicity | Per-service creates, reported per service, idempotent on retry | Matches the only create surface that exists; skipping an occupied target instead of aborting is a deliberate difference from the browser (see the tool row) | A month can land partially; a re-run completes it | this spec |
| Fairness history (CP-SAT) | Derived server-side from role documents, **excluding `special_role`** — for the CP-SAT history only; the local fills' `load` window keeps specials, per ADR-0010 Decision 3 | The role documents already record who served, and deriving them fixes the two-admins-disagree defect ADR-0010 named and left out of scope. ADR-0010 Decision 3 keeps specials out of the persisted history on purpose (`docs/adr/0010-*.md:72-76`) — a naive sweep pulls them in | Output may differ from any given browser's; must be diffed before cutover. **At cutover the browser's solve switches to the derived history too** — otherwise the connector and the admin UI would solve against different fairness histories | this spec |
| Where the "how" lives | In the P0–P4 implementation plans, not in this spec | A helper-level prescription can only be checked with the code open, and is best checked immediately before it is implemented | This spec proves feasibility where it is non-obvious, not the implementation | this spec |

## Assumptions

| Assumption | Impact if false | Validation point | Failure response |
|---|---|---|---|
| An MCP handler library works with Next 16.2.12 | P0 grows a hand-rolled Streamable HTTP handler | P0 gate, before any tool is written | Hand-roll it; the design is otherwise unchanged |
| Discovery documents can be served at the extensionless RFC paths with `issuer`/`resource` computed from the request | The handshake dies at step one, or one deployment advertises the other's endpoints | P0 — on production with no cookie, and on dev through the local client with the protection bypass; in both, compare `issuer` to the host fetched, not merely that it responds | Change the serving mechanism; I10 is the contract either way |
| Solve inputs can be assembled and the GCF solve completed inside 60 s from a serverless function | `solve_month` cannot ship on Hobby | P4, measured | Escalate to Frank with the measurement; do not narrow the solver scope he chose unilaterally |
| History derived from role documents matches the browser's `owt_solver_history_v2` once the specials and draft-counting rules are applied | Solver output changes in ways Frank did not ask for | P2, a read-only diff against Frank's exported history | Do not cut over; escalate to Frank with the explained differences before changing `solve_month`'s scope |
| claude.ai callback URIs pin to a stable set | The allowlist is too narrow (handshake dies) or too wide (the check stops protecting) | P0, empirically | Record the observed set as a dated constant |

## Open questions

| Question | Why it matters | Recommendation | Blocking? | Resolution point |
|---|---|---|---|---|
| Which zod major does the chosen MCP SDK require? | A4 — July's "pin v3" would install a second major beside the transitive 4.3.6 | Read it off the SDK's own peer range at install time | No — bounded: match the SDK, pin per ADR-0001 | P0 |
| Does the consent screen reuse the app's layout shell? | Cosmetic | Bare page | No | P0 |
| What does the derived fairness history count? | Two rules decide whether the P2 diff can be read at all: ADR-0010 keeps specials out on purpose, and the browser records history **when drafts are created**, so a derivation that counts only published services diverges by construction | A new ADR amending ADR-0010 that **ratifies** the specials rule this spec already chose and **decides** the draft-counting rule, both **before** the diff runs | No — a decision, owned by P2 | P2, before the diff |

## Terminal state

**APPROVED** — two sequential fresh `APPROVED` verdicts on byte-identical digest
`1068240f…`. See the review log.

**Risk tier: CRITICAL.** This spec owns an auth/security/ACL boundary, production
writers, and a multi-document concurrency protocol. Per repo convention that
means **two sequential fresh `APPROVED` verdicts on byte-identical text**. Review
order: this spec, then the roadmap, then each child in dependency order.

**This document authorizes no implementation.**
