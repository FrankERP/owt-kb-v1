# OWT Backstage MCP server — design spec

**Date:** 2026-07-28
**Status:** Approved approach; staged implementation
**Consumer:** Frank only (super-admin), via claude.ai custom connector — phone, desktop, and web.

## Goal

Let Frank manage the OWT app conversationally from the Claude apps: query
services, setlists, assignments, availability, and songs (stage 1); run the
solver, edit setlists, swap assignments, and publish/unpublish services
(stage 2); long-tail admin (stage 3). Full capability is the destination;
stages sequence the work so every write tool ships with its guards.

## Non-goals

- Team-member access (single-user, super-admin-only by design).
- A standalone service — the MCP lives inside this Next.js app.
- Raw Sanity document access (the hosted Sanity MCP already does that; this
  server exposes the *domain* layer, and its writes must behave exactly like
  the admin UI: guards, revalidation, notifications).
- Local stdio transport. Remote-only (Streamable HTTP).

## Architecture

- **Route:** `app/api/mcp/[transport]/route.ts` using the `mcp-handler`
  package (Vercel's MCP adapter) in **stateless Streamable HTTP** mode — no
  Redis, no SSE resumability. Deploys with the app on Vercel
  (`owt-backstage` project). No new infrastructure.
- **Tools:** implemented in `app/mcp/tools/*.ts`, one module per domain area
  (services, songs, availability, …). Tool handlers call the same server-side
  code the admin routes use — `assignedMemberRefsQuery()`
  (`app/utils/notifyTargets.ts`), `summarizeUnfilledSeats()`
  (`app/utils/unfilledSeats.ts`), `computeParticipation()`,
  `revalidateServiceViews()` / `revalidateSongViews()`
  (`app/utils/revalidate.ts`), the notification senders, and the shared
  Sanity client. **No duplicated domain logic.** Where an admin route's
  logic is currently inline, extract it to a shared function both the route
  and the MCP tool call (targeted refactor, per admin area, in the stage
  that touches it).
- **Middleware:** the matcher must exclude `/api/mcp`, `/api/oauth`,
  `/.well-known/oauth-authorization-server`, and
  `/.well-known/oauth-protected-resource` — the two discovery endpoints are
  fetched **unauthenticated** by claude.ai before any login exists, so
  leaving them behind the session gate kills the handshake at step one.
  The exclusion goes in **both** the inlined matcher in `proxy.ts` and
  `MIDDLEWARE_MATCHER` in `app/utils/routeMatcher.ts` (they must stay
  byte-for-byte identical — the sync guard in `routeMatcher.test.ts`
  enforces this), with matcher tests updated in the same change. Discovery
  endpoints are `app/.well-known/…/route.ts` route handlers serving static
  JSON. These routes enforce their own auth (below); exclusion is
  transport-level only, never an auth bypass.
- **Service-Readiness audit layer (hard constraint on every tool):**
  `app/utils/protectedReadAudit.ts` — enforced by a test in the `npm test`
  gate — statically requires that all reads of the six protected types
  (`sunday_role`, `saturday_role`, `special_role`, `featuredSongs`,
  `saturdarSongs`, `setlistProposal`) go through
  `sanity/lib/operationalClient`, and that every protected **write** appears
  in its exact `file + operation` registries. Consequences the
  implementation must plan for:
  - Every `app/mcp/tools/*.ts` module touching protected types reads via
    `operationalClient` and, for writes, ships a registry entry (exact
    file + operation) plus audit-test update **in the same change** as the
    tool.
  - The "extract inline route logic to a shared function" refactors move
    registered writes to new files — each extraction updates the write
    registry to the new location in the same commit, keeping the audit
    green at every step.
  - The guarded writers assert a **client-observed revision** (e.g. the
    swap writer requires both observed revisions). MCP tools have no
    browser client, so each write tool performs its own
    read-capture-assert: read the target doc(s) through
    `operationalClient`, capture `_rev` (all of them, for multi-doc
    writes), and pass those as the observed revisions so concurrent edits
    from the app UI fail the assertion instead of being clobbered.
- **Server identity:** name `owt-backstage`, version tracks package.json.
- **Compat risk (verify first in planning):** `mcp-handler` with
  Next.js 16 App Router. Fallback if it fights Next 16: hand-roll the
  Streamable HTTP POST handler (small, spec-stable) — same design otherwise.

## Auth — OAuth 2.1 on top of the existing NextAuth login

claude.ai custom connectors speak OAuth 2.1 with PKCE, dynamic client
registration (RFC 7591), authorization-server metadata (RFC 8414), and
protected-resource metadata (RFC 9728). We implement the minimal compliant
surface:

| Endpoint | Purpose |
| --- | --- |
| `/.well-known/oauth-authorization-server` | RFC 8414 metadata (static JSON) |
| `/.well-known/oauth-protected-resource` | RFC 9728 metadata (static JSON). Served at the root form **and** the path-inserted form (`/.well-known/oauth-protected-resource/api/mcp/…`) — some clients fetch only the latter |
| `/api/oauth/register` | Dynamic client registration; stores client doc in Sanity. **redirect_uri allowlist:** registration is rejected unless every redirect URI is on the allowlist of Claude connector callback origins (`claude.ai` / `claude.com` callback paths; exact set confirmed empirically during stage 0 and kept as a constant). Basic rate limiting on this unauthenticated endpoint |
| `/api/oauth/authorize` | **Requires a live NextAuth session with role `super-admin`** (reuse `requireActiveSession` + explicit role check). Validates `redirect_uri` by **exact match** against the client's registration (PKCE does not protect against attacker-initiated flows — this check does). Renders a consent screen; approval is a **POST** (NextAuth's SameSite=Lax cookie then covers CSRF); on approve, issues a short-lived PKCE-bound auth code |
| `/api/oauth/token` | Exchanges code (PKCE verified, `redirect_uri` exact-matched against registration again) for access + refresh tokens; handles refresh grant |

- **Tokens:** JWTs signed with a **new dedicated secret** (`MCP_OAUTH_SECRET`
  — never reuse `NEXTAUTH_SECRET`, so either can rotate alone). Access token
  TTL 7 days (matches app session), refresh token TTL 30 days, refresh
  rotation on use.
- **Verification:** the MCP route verifies the bearer token on **every
  request** before any tool executes; failure → 401 with
  `WWW-Authenticate` per MCP spec. Verification also checks the grant doc's
  `revoked` flag through a short-TTL (~30 s) cache — same pattern as
  `isMemberActive` — so revocation takes effect within seconds, not at
  the next refresh. (Without this, an access token would be irrevocable
  for up to 7 days; `requireActiveManager` re-checks activity per request
  and the MCP must match that posture.)
- **Persistence:** new Sanity doc types `mcpOauthClient` (registration) and
  `mcpOauthGrant` (grant + refresh-token state, revocation flag). Auth codes
  are stateless signed JWTs, TTL 60 s, PKCE challenge embedded; the grant
  doc records the code's `jti` on redemption to block replay within TTL.
  These doc types are invisible to the app UI and excluded from Studio
  structure (or hidden in a "Sistema" group).
- **Revocation:** set `revoked: true` on the grant doc (Studio or script) —
  token verification checks the grant on refresh; access tokens die at most
  7 days later. (A kill-switch env var `MCP_DISABLED=1` short-circuits the
  route entirely for emergencies.)
- **Secrets:** `MCP_OAUTH_SECRET` **and** `MCP_DISABLED` each get a
  `docs/SECRETS.md` entry in the same change that introduces them — needed
  on Vercel (all envs) and local `.env.local` for dev; **not** needed in
  CI, the iOS build, or GCF. `MCP_OAUTH_SECRET` generated with
  `openssl rand -hex 32`. Rotation: generate new value, set in Vercel,
  redeploy, re-add connector (all outstanding tokens die — that's the
  point). Blast radius: MCP connector only; app unaffected.

## Tool surface

All dates in/out use `YYYY-MM-DD` and the `America/Mexico_City` invariants
(noon-pinning for rendering, `sv` locale trick for "today", calendar-day
diffs for labels). All member-facing-equivalent reads run as super-admin, so
drafts are visible — every service payload carries an explicit
`published: boolean` so Claude can always say "esto es borrador".

### Stage 1 — reads (ships first)

| Tool | Input | Returns |
| --- | --- | --- |
| `get_service` | `date?` (default: next upcoming), `kind?` (`sunday`/`saturday`/`special`) | Setlist (songs with keys/medley runs), all five seat groups resolved to member names, published status, unfilled seats |
| `list_services` | `month` (`YYYY-MM`) | Per-service summary: date, kind, published, coverage gaps (`summarizeUnfilledSeats`) |
| `search_songs` | `query`, `limit?` | Accent-insensitive (`normalizeText`/Fuse) matches: title, authors, tags, keys |
| `get_song` | `id` or exact title | Full song: keys, authors, tags, references (music/lyrics URLs), lyrics presence, play history (dates + counts) |
| `get_member_availability` | `month`, `member?` | Availability entries; whole team if no member given |
| `get_participation` | `month` | The Servicios-sidebar numbers via `computeParticipation` (voz per service; instruments/FOH per week) |
| `list_proposals` | `serviceDate?` | Shared proposals with contributor state |

### Stage 2 — weekly-use writes

| Tool | Behavior |
| --- | --- |
| `edit_setlist` | Add/remove/reorder songs on a service (`saturdarSongs` for Saturday — typo is load-bearing, never rename; `featuredSongs` for Sunday). Generates `_key` for every array item. Calls `revalidateServiceViews()` |
| `swap_assignment` | Move/swap members across the five seat types on a role doc; same validation as the admin swap route |
| `run_solver` | **The largest stage-2 work item — a server-side rebuild, not an extraction.** `/api/admin/solve` is compute-only (it just relays a prepared `SolveRequest` to the GCF and returns the schedule); the real pipeline — assembling the request (leads, support seats, availability, history, DSL rules) and applying the returned schedule via role writes — currently lives client-side in `MonthGenerator.tsx` (~1,700 lines, sole caller of the route). Stage 2 builds two shared server-side functions: `assembleSolveRequest(month)` (reads via `operationalClient`) and `applySchedule(schedule)` (guarded role writes, registered in the audit, revision-asserted). Semantics: `run_solver` solves **and writes assignments onto draft services**, then returns the solver's honest diagnostic plus a summary of what was written; it refuses (whole run, not per-service) if any target service in the month is published. `MonthGenerator.tsx` migrating onto the shared functions is desirable but **not** required for stage 2 |
| `publish_service` / `unpublish_service` | Flip draft state through the same code path as the admin publish routes — assignment notifications/emails fire on publish exactly as from the UI. **Deliberately separate from `run_solver`: no tool both solves and publishes** |

Write-tool contract (all stage 2+ tools):
1. Verify token (route-level) — no per-tool auth bypass possible.
2. Validate inputs with zod schemas (zod added as a **direct** dependency —
   today it would only arrive transitively via the MCP SDK); reject
   unknown fields.
3. Read the target document(s) through `operationalClient`, capture
   `_rev`(s), and pass them as the observed revisions (the audit layer's
   guarded writers require this — see Architecture).
4. Execute via the shared function the admin route uses (extracting it
   first if inline, updating the audit write registry in the same commit).
5. Revalidate the matching views (`revalidate.ts`) — never skip.
6. Return a structured summary of **what actually changed** (and what
   notifications fired); errors are real errors, never success-shaped.

### Stage 3 — long tail (design later, additively)

Member management, sending notifications, proposal administration. Each gets
its own mini-spec when a real need appears; the architecture above already
accommodates them (new module in `app/mcp/tools/`).

## Error handling

- Auth failure → 401 before tool dispatch (MCP-spec `WWW-Authenticate`).
- Tool errors → MCP tool-error results with a human-readable message and,
  where useful, the failing field. No stack traces or Sanity internals.
- Solver/GCF failures surface the solver's own diagnostic verbatim.
- Every write reports partial outcomes honestly (e.g. revalidation succeeded
  but notification batch deferred → say so).

## Testing

- **Vitest (pure logic):** JWT sign/verify + expiry, PKCE S256 verification,
  auth-code replay rejection, zod input schemas per tool, payload shaping
  (service summary, coverage, participation), date formatting against the TZ
  invariants.
- **Route-level:** 401 on missing/expired/garbage tokens for the MCP route;
  role check on `/api/oauth/authorize` (member/admin sessions rejected).
- **Gates:** `npx tsc --noEmit` and `npm test` green before each stage
  ships (per CLAUDE.md).
- **Manual verification per stage:** connect from claude.ai (desktop) and
  the phone app; exercise each new tool once against prod data
  (reads) / against a throwaway draft service (writes).

## Rollout

1. **Stage 0:** OAuth layer + MCP route with a single `ping` tool. Verify
   the full connector handshake from the phone before building anything else.
2. **Stage 1:** read tools. Live on the phone same week.
3. **Stage 2:** write tools, one commit-sized change each, each behind the
   write-tool contract above.
4. **Stage 3:** on demand.

Branch `mcp-server`, merged to `main` per stage (direct push, no PRs, no
AI attribution in commits — per repo convention).

## Open questions (resolve during planning, none block the design)

1. `mcp-handler` × Next.js 16 compatibility (fallback: hand-rolled handler).
2. Whether the consent screen reuses the app's dark-mode layout shell or is
   a bare page (cosmetic).
3. Exact Claude connector callback URIs for the redirect_uri allowlist —
   confirmed empirically during the stage-0 handshake.
