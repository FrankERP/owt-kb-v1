# OWT Backstage MCP server — design spec v2

**Date:** 2026-09-22
**Status:** `DRAFT` — reconciled, not yet reviewed. **Authorizes nothing.**
**Supersedes:** [`2026-07-28-owt-mcp-design.md`](2026-07-28-owt-mcp-design.md),
which was approved on its own terms and is now factually stale in twelve places.
**Consumer:** Frank only (super-admin), via claude.ai custom connector — phone,
desktop, and web.

## Why there is a v2

The July spec was hardened through three adversarial review rounds and then never
implemented. Nothing about it was built: `app/api/mcp`, `app/api/oauth`,
`app/mcp`, `app/.well-known/**`, `mcp-handler`, `@modelcontextprotocol/sdk` and
`zod` are all absent from the tree and the lockfile. The `mcp-server` branch
exists and is an ancestor of `main` — docs only, zero code.

In the 56 days since, well over 1 200 commits landed (`git rev-list --count --since='2026-07-28T00:00:00-06:00' 128479bc` = 1 284), and **ADR-0010 through ADR-0035** — 26 new decision records, plus a nine-record backfill of 0001-0009 in the same window. Twelve of the July
spec's load-bearing statements are now false, two of its preconditions are
unattainable on this project's plan, and two more statements were false on the
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
| A2 | "`run_solver` … a server-side rebuild, not an extraction" (`:183`) | **Half wrong.** `buildSolveRequest` (143 lines) and `applySolveResponse` (70 lines) were extracted to the neutral `app/components/admin/plannerModel.ts` on 2026-07-29 — one day after the spec — and are server-callable today. Their whole transitive import graph is neutral (ADR-0028-compliant) | The *translation* to wire format is free. `buildSolveRequest` still takes an already-assembled `{ config, members, sundayDates, activeSatDates, historyEntries, year, month }`, so the server-side read layer producing those inputs is new work — and it is the layer the draft-gating and ministries rules above land on. The Sanity-write half (`applySchedule`) has no counterpart at all |
| A3 | "`MonthGenerator.tsx` (~1 700 lines)" (`:183`) | **3 924 lines.** It was 1 707 at `1c346022`, the last commit to touch it before the extraction, so July's "~1 700" was accurate then; it has grown 2.30× | The client surface to leave alone is much larger than budgeted |
| A4 | "the ecosystem is zod-v3-based; don't jump to v4 independently" (`:188-190`) | `zod` resolves **transitively at 4.3.6** today, on a production dependency path (via `sanity@5.31.1` → `@sanity/cli`), and is not a direct dependency | The pin must be re-derived from whatever the MCP SDK actually requires now. The July instruction would install a second, conflicting major |
| A5 | "Branch `mcp-server`, merged to `main` per stage (direct push, no PRs …)" (`:239`) | `main` has been **PR-only with `enforce_admins: true` since 2026-08-24** (`docs/CI.md:56-67`). `preview` still takes direct pushes | Every stage is a PR whose `gates` check must be green. The push order is `preview` first, verify the dev alias, then PR to `main` |
| A6 | Read tools return "the Servicios-sidebar numbers via `computeParticipation`" (`:174`) | `MemberParticipation` gained **`especial`**, and `total` now folds it in (2026-07-31) | A July-shaped `get_participation` payload is incomplete, not merely different |
| A7 | `list_proposals` returns "shared proposals with contributor state" (`:175`) | The live conversation moved to **`setlistProposal.messages[]`** (2026-08-24). `lead_notes`/`admin_notes` are a **frozen archive**, no longer written (ADR-0023, amended 2026-08-27) | Reading the July fields returns stale text that looks current — the worst failure mode for a conversational tool |
| A8 | `get_song` returns "lyrics presence" (`:172`) | **ADR-0018:** a filled `chords` chart *hides* `body` in every existing reader. And two divergent "full song" projections coexist — `app/(client)/posts/[slug]/page.tsx:56-87` (tags, authors, reference links, tutorials) vs `app/api/song/[id]/route.ts:16-29` (history, myInstruments) — **neither is canonical** | "Lyrics presence" is not `body != null`. And `get_song` must be defined field by field, never by copying one of the two. `rehearsalMixes[]` is in **both** projections |
| A9 | The spec's whole tool surface is implicitly worship | The **ministries axis was created 2026-08-20**, three weeks after the spec — `app/ministries.ts`, `requireMinistryMember`/`requireMinistryManager`, `requireWorshipPage`. The session now carries `ministries` and `managesMinistries` | Worship-only is now a *decision* that must be stated, not a silent default. Kids (`kidsPair`, `kidsSchedule`) is a whole vertical the surface omits |
| A10 | "Every write tool … reads the target doc(s) through `operationalClient`, capture `_rev`" (`:82-85`) — framed as the tool's own work | Correct, and **understated**. `requireActiveManager()` takes no `req`: it calls `getServerSession(authOptions)` with no arguments and reads cookies from `next/headers` ambient context (`app/utils/authGuards.ts:13-14`) | An MCP tool authenticates by bearer token and **cannot reuse the admin guards at all**. Every extraction must separate authorization from write logic — a cost the July spec never named |
| A14 | `run_solver` "writes assignments onto draft services" and "does not create them" (`:183`) | The only automatic path in the app today is the opposite: Auto is offered in **create** mode only (`app/components/admin/PlannerGrid.tsx:2000`) and applies a solve by **creating** draft services (`handleConfirm` → one `POST /api/admin/roles` per service) | v2's `apply_schedule` creates and never modifies. The July behaviour has no counterpart left to reuse |
| A11 | Tests: the matcher "tests updated in the same change" (`:59`) | There are **two** hand-kept lists, not one. Beyond the byte-identical matcher sync guard (`routeMatcher.test.ts:155-166`), `PUBLIC_ROUTES` (`:34-50`) is a separate deliberate allowlist — "Adding to this list is a deliberate, reviewable act" | Two edits per opened route, in the same commit, or the gate fails |
| A13 | `app/utils/serviceReadQueries.ts:1` still reads "the **six** protected service types" | Seven since 2026-08-05 (A1). Live staleness in the tree, not in the July spec | Harmless today, but it is the same drift A1 records, in the file this design now leans on hardest. Fix it in P1 |
| A12 | "**Gates:** `npx tsc --noEmit` and `npm test` green before each stage ships" (`:224-225`) | **Three gates.** `eslint` at 0 errors joined the rule on 2026-07-29 — one day after the spec — and is now also the CI `gates` check | Nothing is planned wrong (v2's Testing and Rollout already say three), but the July text under-states what every stage must pass |

### B. Preconditions that cannot be met

| # | July precondition | Why it fails | Resolution adopted below |
|---|---|---|---|
| B1 | "The MCP route needs `maxDuration` **strictly greater than** the solve route's 60 s" (`:183`) | This project is on **Vercel Hobby**. Every one of the 16 routes that declares `maxDuration` declares exactly `60`; `vercel.json` has no `functions` block; **ADR-0013 states the ceiling explicitly** — "Bounded by `maxDuration = 60`, which Vercel Hobby will not raise. There is no room behind it." ADR-0032 rejected Pro on cost | **Split the tool.** `solve_month` (solve, writes nothing) and `apply_schedule` (writes) become two calls, each inside 60 s. (This rests on the ceiling the repo documents; if the project's Vercel compute allows longer, the split still stands on its own merits — see the tool section.) |
| B2 | `run_solver` "solves **and writes assignments onto draft services**" in one request (`:183`) | The solver's fairness history is `owt_solver_history_v2` in **`localStorage`**, per an explicit ADR-0010 consequence: *"Decision 2 shares the RULES, not the fairness history, so two admins still solve against different history."* A server-side solver has no access to it | **Derive the history from Sanity role documents** — its own delivery, with its own ADR amending ADR-0010. See D4 |

### C. Things that did not exist to reuse

| # | July spec assumed | Reality |
|---|---|---|
| C1 | "Basic rate limiting on this unauthenticated endpoint" (`/api/oauth/register`) | **No rate limiter exists anywhere in the repo.** The only `rateLimit` hits are nodemailer's outbound SMTP pacing. The nearest precedent (`api/service-readiness-verification/identity`) fails closed on env checks instead; the other middleware-excluded routes are either the auth pages themselves, the prerendered gallery, or `api/cron/*`, which authenticate with a bearer secret. This must be built |
| C2 | Discovery endpoints as `.well-known` route handlers | **No `.well-known` route exists.** The closest auth precedent is ADR-0017 (the theme gallery: a deliberately public, prerendered, data-free route) |
| C3 | "JWTs signed with a new dedicated secret" | **No repo-owned JWT-signing utility exists.** `jose@4.15.9` is present only transitively, under `next-auth` and `openid-client` (a third copy, `6.2.3`, sits under `jwks-rsa`); `jsonwebtoken@9.0.3` only under `firebase-admin`. `google-auth-library` verifies *Google's* tokens against Google's JWKS and issues nothing. A direct, pinned dependency is required (ADR-0001 is the repo's pattern for pinning) |
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

Two errors are not drift. Both were false on the day the July spec was approved, and
three adversarial rounds did not catch them — by construction, because they were
reading a plan and not the routes. It is recorded separately so the distinction
survives: a stale claim and a claim that was never true have different lessons.

| # | July spec said | Fact | Consequence |
|---|---|---|---|
| F2 | `list_services` returns "coverage gaps (`summarizeUnfilledSeats`)" (`:170`) | `summarizeUnfilledSeats` (`app/utils/unfilledSeats.ts:63`, unchanged since 2026-06-30) parses **solver-response seat strings** of the form `W2 Sunday Sun.Choir #2` (`app/utils/__tests__/unfilledSeats.test.ts:10`) (`SEAT_RE`, `:30`). It cannot read stored service documents, and it has **no production caller at all** | It cannot say what is missing on a month of real services. The stored-state answer is the readiness blocker set — see I4 |
| F1 | `publish_service`/`unpublish_service` flip draft state "through the same code path as the admin publish routes" (`:184`) | `/api/admin/roles/publish` contains **zero** readiness logic and has **no caller in the app**. `/api/admin/roles/publish-ready` — which landed 2026-07-25, three days *before* the July spec — declares itself "the server-authoritative publish surface", and is what `ServicesPanel.tsx:613,660,680,701` calls | An implementer reading either spec builds on `/publish` and ships a conversational tool that can publish a service the admin UI would refuse. See the corrected tool row |

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
  administration). July deferred it (`:201`); v2 drops it from the surface. It is
  a narrowing of the July scope, recorded as one.
- **The kids ministry. [D-2026-09-22]** The surface is worship-only.

### Invariants — every tool, every stage

| ID | Invariant | Why it is not optional |
|---|---|---|
| **I1** | Every protected read runs on a canonical operational client; every protected write carries its exact `file`+`operation` audit registry entry and the updated exact-list assertion **in the same commit** as the writer | D2, D3, D4. The audit fails the suite otherwise, and an entry cannot be staged ahead of its writer |
| **I2** | The MCP adds **no** entry to `MAY_SEE_DRAFTS` and puts **no** draft-gated query literal in an MCP-owned file | D1. A new exemption is a widening of a security guard. The contract is satisfiable because an exempt canonical read model already exists (`app/utils/serviceReadQueries.ts`, exempt at `draftGatingCoverage.test.ts:96-104`) and can be extended |
| **I3** | Every payload that describes a service carries that service's `published` flag verbatim. No tool infers visibility from the absence of a filter | Reads run as super-admin and must see drafts — the write path cannot publish a draft it cannot see — so the flag is the only thing standing between "draft" and "live" in what Frank is told |
| **I4** | **One readiness predicate.** What a read tool reports as blocking a service is exactly what `publish_service` would refuse that service for | F1: the server-authoritative publish surface recomputes readiness itself. Two predicates would let the connector say "nothing is missing" and then refuse to publish |
| **I5** | **Worship scope.** No read that **lists members** returns a kids-only member, **even though the caller is super-admin**. (A seat read shows whoever is actually seated, even if that member has since become kids-only — hiding a seated person would misreport the service.) | [D-2026-09-22]. The trap is concrete: the existing worship member-list filter deliberately admits *every* member for a super-admin (`WORSHIP_MEMBER_GROQ_FILTER`'s `$all` arm, `app/ministries.ts:44-57,77`), and its one caller binds it that way (`app/api/admin/members/route.ts:31`). That bypass must not apply here |
| **I6** | Every request is authenticated by bearer token at the route, before any tool dispatches. No per-tool bypass. Authorization is kept separate from domain logic | A10: the admin guards read the session from ambient cookies and cannot authenticate a bearer-token caller, so reusing domain code requires separating the two |
| **I7** | **Concurrency parity, with a real observation.** Every write requires the identities and observed revisions — and, for a seat edit, the seat `_key`s — that its admin counterpart requires, **taken from a read the user acted on**, and refuses on any mismatch. Every read that can precede a write returns exactly those values. **A revision captured inside the write request does not satisfy I7**: it asserts only that nothing changed during the request itself. Each write also asserts every coordination token its counterpart asserts, and inherits that path's known gaps without widening them | Every admin counterpart takes the client's observation: publish takes `roles: [{ id, rev }]` and refuses `stale_revision` (`app/api/admin/roles/publish-ready/route.ts:158-160`); swap takes `{ roleId, rev, path, itemKey }` (`swap/route.ts:46-49`); the setlist writer requires an observed target — "a writer must never guess which document was observed" (`app/utils/setlistWriteRequest.ts:81-83`). Without the read side, Frank could publish or swap a team another admin changed after he looked at it — which the admin UI refuses today |
| **I8** | **Notification parity.** A write fires exactly the notifications its admin counterpart fires, computed from state captured **before** the commit | `docs/NOTIFICATIONS.md:663`: reading live state after the commit makes before == after and silently sends nothing |
| **I9** | **Honest outcomes.** A write returns what actually changed and which notifications fired; a multi-item write reports per item; an error is never success-shaped | July's write contract, kept. It is what makes a partial outcome survivable in a conversation |
| **I10** | **Discovery per origin.** The OAuth discovery documents are served at the RFC 8414 / RFC 9728 paths with `issuer` and `resource` equal to the origin actually fetched, **computed per request** — never fixed to one origin | The same build deploys to two origins (`dev-owt-backstage.vercel.app`, `owt-backstage.vercel.app`) that share one dataset. A document fixed to one origin, served from the other, does not fail — it silently advertises the other origin's endpoints. Together with O2's audience check, this keeps each deployment's OAuth surface its own, even though only production is registered as a connector (see Connector origin) |
| **I11** | The MCP, OAuth and discovery paths are excluded from the session middleware, and **both** hand-kept lists stay in sync in the same commit | A11. Discovery is fetched before any login exists; a session gate there kills the handshake at step one. Exclusion is transport-level only — every excluded route enforces its own auth |

### Auth — OAuth 2.1 over the existing NextAuth login

The July design stands and is restated as contracts:

| ID | Contract |
|---|---|
| **O1** | The claude.ai custom-connector handshake completes from the phone **against production** (see Connector origin): RFC 8414 + RFC 9728 discovery, dynamic client registration, PKCE (S256), and an authorization step that requires a live NextAuth session with role `super-admin` — redirecting a cookie-less browser to sign-in with the authorize URL intact, and rejecting any other role. Any live super-admin qualifies — the same trust the app already extends to that role. `redirect_uri` is matched **exactly** against the client's registration, and registration accepts only redirect URIs on an allowlist of claude.ai / claude.com callbacks, observed empirically and recorded as a dated constant |
| **O2** | On **every** request, within a 30 s cache (`TTL_MS = 30_000`, `app/utils/memberAccess.ts:4`): the token's signature and expiry hold; its grant is not revoked; **its subject is an existing, non-disabled member whose live role is still `super-admin`** — the same live re-check the app already applies to every session (`auth.ts:258-311`), so a demotion or a disabled account takes effect within the TTL, not at the end of a 7-day token or never; and **its audience equals this origin's MCP resource** (RFC 8707), so a token minted on one deployment is refused by the other even though both share one dataset and one signing secret. `MCP_DISABLED=1` short-circuits the route entirely |
| **O3** | The unauthenticated registration endpoint is rate-limited **and** hard-capped in how many registrations it keeps. No rate limiter exists to reuse (C1); the cap, not the rate limit, is the real bound on document spam |
| **O4** | An authorization code is single-use, and a replay is **refused**, not silently absorbed — a check that no-ops when the record already exists cannot signal a replay, so the refusal must come from a write that fails on conflict. Reuse of a superseded refresh token revokes the whole grant |
| **O5** | Stored OAuth state is limited to non-secret, non-replayable fields — current refresh-token `jti`, redeemed auth-code `jti`s, the `revoked` flag, registered redirect URIs. The dataset answers unauthenticated published reads (`sanity/lib/operationalClient.ts:13-15`), so anything stored is world-readable |
| **O6** | Tokens are signed with a dedicated secret, `MCP_OAUTH_SECRET`, never `NEXTAUTH_SECRET`, by a **direct, pinned** dependency (C3; pinned per ADR-0001). Access token 7 days, refresh token 30 days, rotated on use |
| **O7** | `MCP_OAUTH_SECRET` and `MCP_DISABLED` each get a `docs/SECRETS.md` entry in the same change that introduces them, in that file's existing shape. Needed on Vercel (all environments) and local `.env.local`; **not** in CI, the iOS build or GCF. Never the value. If P0 smoke-tests the MCP endpoints on dev with the existing Vercel protection-bypass secret, that secret's `docs/SECRETS.md` entry gains the new consumer in the same change |

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
  carries the protection-bypass header — not by claude.ai.
- **On production:** the handshake from the phone (O1), and every tool's first
  connector-driven run.

### Tool surface

Dates in and out are `YYYY-MM-DD` under the `America/Mexico_City` invariants.

#### Reads

| Tool | Contract | Constraints the implementation must respect |
|---|---|---|
| `get_service` | One service — by date and kind, default the next upcoming — with its setlist (song title, author and key per song), all five seat groups with member **names**, `published` (I3), and its readiness blockers (I4). It also returns **every observation a write needs (I7)**: the role's id and `_rev`, each seat item's `_key`, and the setlist's observed state — its id and `_rev`, or its observed absence | **No existing read model answers this alone.** The readiness bundle is deliberately song-free and name-free (`app/utils/publishReadyBundle.ts:255`, `:267`, `:505-509`), and the only query that resolves seats and joins the setlist lives inline in a route (`app/api/admin/roles/route.ts:65-88`). I2 applies to whatever is built. Song documents are neither protected nor draft-gated |
| `list_services` | Every service in a month: date, kind, `published`, readiness blockers (I4), and each role's id and `_rev` (I7) | Ledger F2: the helper July named cannot answer this. Readiness is computed over the whole catalogue today (seven queries, including every proposal thread) — a cost the plan may narrow as long as I4 holds |
| `search_songs` | Fuzzy search over title, artist and key, with an exact tag filter | Tags are never fuzzy-matched. The vocabulary is **exactly 43 tags — 40 themes and 3 tempo** (`docs/SOLVER_AND_INFRA.md:161-162`); artist tags were removed on 2026-09-06 and must not return |
| `get_song` | A declared field set: title, authors, keys, tags, reference links, lyrics presence, rehearsal mixes by tone, play history | Ledger A8: two divergent song projections exist and neither is canonical, so the field set is declared here and copied from neither. **Lyrics presence obeys ADR-0018** — a filled chord chart hides `body`. A mix is identified by its array `_key`, never by a musical key |
| `get_member_availability` | Unavailable dates for the month, for one member or the whole worship team | I5 |
| `get_participation` | Per-member counts for the month, including `especial` and the `total` that folds it in (A6) | **This is a draft-gated read** — participation is computed over the three role types (`app/utils/computeParticipation.ts:2-10`) — so I2 and I3 apply, and each service's `published` is reported so Frank can see which counts include drafts |
| `list_proposals` | Proposals per service, with the **live message thread**, and whether the thread is still open | Ledger A7: the thread lives in `messages[]`, not the frozen notes fields. The thread closes on the service date, independently of proposal status. **Unread state is never reported** — ADR-0024 puts read-marks on neither document |

#### Writes

| Tool | Contract | Must refuse / must never |
|---|---|---|
| `edit_setlist` | Given the setlist observation from `get_service`, replace a service's setlist — Sunday `featuredSongs`, Saturday `saturdarSongs` (the typo is load-bearing), specials — producing the same document and the same cache invalidation as the admin setlist editor; a `_key` on every array item | Refuse on a stale observed setlist or target. Inherits the admin path's concurrency exactly (I7), **including its one known gap**: a weekend setlist saved before its role exists commits with no lock assertion (`app/api/admin/setlists/route.ts:374-377` is conditional on a lock). The tool neither widens that gap nor silently changes it |
| `swap_assignment` | Given the role ids, `_rev`s and seat `_key`s from `get_service`, move or swap members across the five member-referencing seats, with the admin swap's validation | Assert **both** roles' observed revisions and every owned lock's revision in **one** transaction. `_key`s travel with their items and are never regenerated |
| `publish_service` | Given a service's id and `_rev` from a read, publish that draft, firing exactly the admin publish's notifications (I8) and cache invalidation | **Refuse every service the admin UI would refuse** — the server-authoritative readiness of ledger F1, recomputed at publish time, never trusted from the caller. **Never override a blocker**: workflow blockers are reported to Frank in words; overriding one stays an admin-UI action, where the acknowledged set is a deliberate click rather than a model's inference. Integrity blockers are never overridable anywhere |
| `unpublish_service` | Given a service's id and `_rev` from a read, return it to draft, exactly as the admin unpublish does | Notifies nobody, deliberately |
| `solve_month` | Solve a month — its Sundays (all, unless Frank excludes some) and the Saturdays Frank names (none by default; the admin UI treats them as a choice, not a default) — and return the proposed schedule, the solver's own diagnostic verbatim, the seats it left unfilled, and — per proposed service — an identity that makes applying it idempotent | **Writes nothing.** Completes inside 60 s (B1). Reads no role document itself; its fairness-history input comes from P2's derivation, which *is* a draft-gated read (I2). **Specials are never solved** — ADR-0010 keeps them out of the solver on purpose |
| `apply_schedule` | Create the draft services of a solved month | **Creates only** — never modifies an existing service. A target that is already occupied — published or draft — is **not created and is reported**, per service; the rest of the month proceeds, as the browser does today (it applies only the creatable drafts, `MonthGenerator.tsx:3129`). Each proposed service is created **at most once** across any number of retries. Target occupancy is re-checked **at write time**, so an apply made long after its solve either creates exactly what was proposed or fails closed with a named reason. **Not atomic across the month** — see below |

**Why `run_solver` is two tools.** B1 makes one request impossible. The split
also keeps the July rule that no tool both solves and publishes, extends it to
"no tool both solves and writes", and puts a natural review point between the
proposal and the mutation.

**The split's concurrency contract.** Two conversational calls can be minutes or
hours apart, with nothing to refresh in between. A revision captured at apply
time would assert nothing about the solve, and the solve observes no role
document whose revision could be carried forward — the documents `apply_schedule`
writes do not exist yet. What protects the gap is therefore what already protects
a create in this app: a per-service idempotency identity, plus a re-check at write
time that the target is still free and every assigned member still exists. The
admin create route enforces exactly this bundle today (`app/api/admin/roles/route.ts`:
receipt at `:256-259`, occupancy at `:148-167`, members at `:140-145`).

**Atomicity is a stated limitation, not a gap.** The existing create surface is
one service per request (`app/api/admin/roles/route.ts:126,213,366`), and the
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
- All three gates pass per stage — `npx tsc --noEmit`, `npm test`, `npx eslint .`
  — which is what the CI `gates` job runs (`.github/workflows/ci.yml:46,49,55`).
- **A write tool's first connector-driven run is on production** (Connector
  origin), which has no mail redirect — so it runs against a **throwaway service
  made for the purpose, seated with Frank alone**, never a real upcoming service,
  and removed afterwards. `publish_service` cannot override "empty team" or
  "missing setlist", so the throwaway also carries a setlist. Seated with Frank
  alone, publishing it should notify only Frank; P3 confirms the exact recipients
  of every notification the tool fires **before** that first run, and the run
  does not happen until it has.

### Rollout

Replaces July's "direct push per stage" (A5). Per stage, without exception:

    feature branch (tsc + vitest + eslint 0 errors, locally green)
    → merge into preview, push, VERIFY the dev alias moved
      (dev-owt-backstage.vercel.app in `alias`, `meta.githubCommitSha` == the pushed commit)
    → fresh CODE REVIEW of the merge range → fix → re-verify the fix
    → PR to main, wait for `gates`
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
| `run_solver` shape | `solve_month` + `apply_schedule` | B1 is a hard ceiling ADR-0013 says will not move | Two round trips instead of one | this spec |
| `apply_schedule` atomicity | Per-service creates, reported per service, idempotent on retry | Matches the only create surface that exists and the browser's own behaviour | A month can land partially; a re-run completes it | this spec |
| Fairness history | Derived server-side from role documents, **excluding `special_role`** | The role documents already record who served, and deriving them fixes the two-admins-disagree defect ADR-0010 named and left out of scope. ADR-0010 Decision 3 keeps specials out of the persisted history on purpose (`docs/adr/0010-*.md:66-70`) — a naive sweep pulls them in | Output may differ from any given browser's; must be diffed before cutover | this spec |
| Where the "how" lives | In the P0–P4 implementation plans, not in this spec | A helper-level prescription can only be checked with the code open, and is best checked immediately before it is implemented | This spec proves feasibility where it is non-obvious, not the implementation | this spec |

## Assumptions

| Assumption | Impact if false | Validation point | Failure response |
|---|---|---|---|
| An MCP handler library works with Next 16.2.12 | P0 grows a hand-rolled Streamable HTTP handler | P0 gate, before any tool is written | Hand-roll it; the design is otherwise unchanged |
| Discovery documents can be served at the extensionless RFC paths with `issuer`/`resource` computed from the request | The handshake dies at step one, or one deployment advertises the other's endpoints | P0 — on production with no cookie, and on dev through the local client with the protection bypass; in both, compare `issuer` to the host fetched, not merely that it responds | Change the serving mechanism; I10 is the contract either way |
| Solve inputs can be assembled and the GCF solve completed inside 60 s from a serverless function | `solve_month` cannot ship on Hobby | P4, measured | Return the assembled request for the browser to solve, or re-open the question |
| History derived from role documents matches the browser's `owt_solver_history_v2` once the specials and draft-counting rules are applied | Solver output changes in ways Frank did not ask for | P2, a read-only diff against Frank's exported history | Do not cut over; keep the solver browser-driven and drop `solve_month` |
| claude.ai callback URIs pin to a stable set | The allowlist is too narrow (handshake dies) or too wide (the check stops protecting) | P0, empirically | Record the observed set as a dated constant |

## Open questions

| Question | Why it matters | Recommendation | Blocking? | Resolution point |
|---|---|---|---|---|
| Which zod major does the chosen MCP SDK require? | A4 — July's "pin v3" would install a second major beside the transitive 4.3.6 | Read it off the SDK's own peer range at install time | No — bounded: match the SDK, pin per ADR-0001 | P0 |
| Does the consent screen reuse the app's layout shell? | Cosmetic | Bare page | No | P0 |
| What does the derived fairness history count? | Two rules decide whether the P2 diff can be read at all: ADR-0010 keeps specials out on purpose, and the browser records history **when drafts are created**, so a derivation that counts only published services diverges by construction | A new ADR amending ADR-0010 that settles **both** rules **before** the diff runs. Deciding them is the amendment, not paperwork | No — a decision, owned by P2 | P2, before the diff |

## Terminal state

`READY_FOR_ADVERSARIAL_REVIEW`

**Risk tier: CRITICAL.** This spec owns an auth/security/ACL boundary, production
writers, and a multi-document concurrency protocol. Per repo convention that
means **two sequential fresh `APPROVED` verdicts on byte-identical text**. Review
order: this spec, then the roadmap, then each child in dependency order.

**This document authorizes no implementation.**
