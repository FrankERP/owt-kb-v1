# Implementation Plan: MCP P0 — OAuth, discovery, and a `ping` tool

## Original request

> "haz el plan de P0 y la spec de P2" — Frank, 2026-09-23, after the MCP spec v2 and
> its delivery roadmap were approved.

## Status and contract

- **Document status:** Draft. **Risk tier: CRITICAL** (auth/ACL/secret boundary; the
  first unauthenticated endpoints this app exposes to the internet).
- **Accepted requirement source:** [`2026-09-22-owt-mcp-design-v2.md`](../specs/2026-09-22-owt-mcp-design-v2.md)
  (contracts O1–O9, I6, I10, I11, I13, I14, E1, DV1, the Connector origin section) and
  the **P0** row of [`2026-09-22-owt-mcp-roadmap.md`](2026-09-22-owt-mcp-roadmap.md).
- **Primary outcome:** Frank adds the OWT Backstage connector in claude.ai, completes
  the OAuth handshake from his phone against production, and calls one tool, `ping`.
- **Preconditions:** spec and roadmap approved (done); this plan approved at critical
  tier (two fresh `APPROVED` on byte-identical text); Frank's go-ahead to implement.
- **Safe ending state:** a connector that proves who it is and does nothing else — no
  domain read, no domain write. Its only dataset writes are OAuth-state documents that
  hold nothing secret (O5).

## Evidence and current behavior

| Evidence | Source | Planning implication |
|---|---|---|
| Nothing MCP or OAuth exists: no `app/api/mcp`, `app/api/oauth`, `app/.well-known`, no `mcp-handler`, no MCP SDK, no direct `zod` or `jose` | tree + `package-lock.json` | Greenfield inside a production app |
| **claude.ai's hosted surfaces (web, Desktop, mobile) use exactly one redirect URI: `https://claude.ai/api/mcp/auth_callback`**; Claude Code uses an RFC 8252 loopback redirect | claude.com/docs/connectors/building/authentication (fetched 2026-09-23) | The production allowlist is **seeded from documentation** — no observation phase, so no observation record is ever written |
| claude.ai supports DCR and CIMD; it picks CIMD only if the AS advertises `client_id_metadata_document_supported: true` **and** `"none"` auth; always sends PKCE S256; refreshes reactively on 401 and proactively ≤5 min before expiry; expects `invalid_grant` for a dead refresh token, rotated refresh tokens for public clients, a form-urlencoded token endpoint and a JSON registration endpoint; waits ≤10 s for discovery/registration/token, ≤30 s for refresh | same | Contract for the endpoints below. Not advertising CIMD keeps Claude on DCR, which the approved spec requires (O1) |
| MCP spec **2026-07-28** (latest): PRM (RFC 9728) MUST; clients MUST send RFC 8707 `resource` and servers MUST validate token audience; CIMD SHOULD; **DCR MAY, "deprecated, retained for backwards compatibility"**; RFC 9207 `iss` on the authorization response is normative | modelcontextprotocol.io/specification/2026-07-28/basic/authorization | DCR stays (spec O1, Claude supports it) and is made **stateless**, so its deprecation costs nothing to reverse later. `iss` is added to the authorization response |
| `mcp-handler@2.2.0` (2026-09-18): stateless Streamable HTTP, **no Redis**, serves 2026-07-28 natively and 2025-era clients through a stateless fallback; `withMcpAuth` answers 401/403 with RFC 9728 `WWW-Authenticate`; `protectedResourceHandler`; handler is a plain `(Request) => Promise<Response>`; peers `@modelcontextprotocol/server@^2` (which peers `zod@^4.2.0` and pins `@modelcontextprotocol/core` exactly); Node ≥20; `next >=13` — **Next 16 not named** | `npm view mcp-handler`, its README | The compatibility gate (step 1) is real, and its fallback is a hand-written handler on the same web-standard SDK |
| `zod` resolves transitively at 4.3.6 today | spec ledger A4 | A direct `zod@4` pin creates no second major |
| `jose@6.2.12` (2026-09-05): `SignJWT` / `jwtVerify`, HS256, runs on Node | `npm view jose` | The JWT library (O6), pinned exactly |
| Vercel WAF rate limiting is **available on Hobby: one rate-limit rule per project**, fixed window 10 s–10 min, keyed by IP; defined in the dashboard only, not `vercel.json` | vercel.com/docs/vercel-firewall/vercel-waf/rate-limiting (updated 2026-08-28) | O3's rate limit is a Frank-run dashboard step, verified, not code |
| An unauthenticated request is redirected by `proxy.ts`'s `withAuth` to `/api/auth/signin?callbackUrl=<path+search>` and on to `/auth/signin`; NextAuth's **default** `redirect` callback returns any relative URL verbatim, query included; `auth.ts` defines no custom `redirect` | `node_modules/next-auth/next/middleware.js:20,45-47`; `…/core/index.js:167-172`; `…/core/lib/default-callbacks.js:11-17`; `auth.ts:155-332` | **`/oauth/authorize?…` can stay behind the middleware** and round-trips through sign-in intact — O1's cookie-less-browser requirement costs nothing |
| Every server path reads the session through `requireActiveSession()` (the only `getServerSession` call site); the session carries `role`, `sanityId`, `isImpersonating` | `app/utils/authGuards.ts:13-14`; `types/next-auth.d.ts:6-25` | Authorize reuses it, then checks `role === "super-admin"` and `!isImpersonating` |
| `getMemberAccess(id)` → `{ active, role, ministries, managesMinistries }`, 30 s TTL, `active = exists && !disabled` | `app/utils/memberAccess.ts:4,28-68` | O2's live-principal check reuses it as is |
| `writeClient` (`SANITY_WRITE_TOKEN`); `sanityConflictKind(err)` returns `"already_exists"` for a `create()` on an existing `_id` | `sanity/lib/serverClient.ts:1-20`; `app/utils/roleWriteRequest.ts:838-861` | O4's replay refusal = `create()` on a deterministic `_id`, classified by the existing helper |
| Schema types are listed by hand in `sanity/schema.ts:31-33`; internal types are hidden and read-only via `PROTECTED_STUDIO_TYPES` / `INTERNAL_STUDIO_TYPES` (`app/utils/studioProtection.ts:45-70,147-153`), guarded by `studioProtection.test.ts:465-492` | files | New OAuth types join both lists; Studio is read-only for them, so revocation is a script (O9) |
| Guarded scripts: dry run by default, `--apply` to write, `node --env-file=.env.local` — exemplar `scripts/grant-kids-manager.mjs` | file | The revocation script follows it |
| `MIDDLEWARE_MATCHER` (`app/utils/routeMatcher.ts:39-40`) must equal `proxy.ts:48` byte for byte; `PUBLIC_ROUTES` (`routeMatcher.test.ts:34-50`) must equal every **page or route** file the matcher leaves ungated — the walk includes dot-directories | `routeMatcher.test.ts:12-27,155-166` | Three files move together (I11) |
| `proxy.ts` runs **before** `beforeFiles` rewrites | `node_modules/next/dist/docs/…/rewrites.md:87-98` | Excluding the public `/.well-known/*` path is what matters; the rewrite destination stays gated and is never reachable directly |
| `next.config.mjs` has `headers()` (global `nosniff`) and `redirects()`, no `rewrites()` | `next.config.mjs:1-61` | Discovery is served by route handlers with `Content-Type: application/json`, reached by new `beforeFiles` rewrites |
| No route sets `WWW-Authenticate`; no constant-time comparison exists in the repo (`CRON_SECRET` uses `!==`) | grep | New in P0; PKCE and signature checks use `jose`'s and `node:crypto`'s constant-time paths |
| Vitest collects `app/**/*.test.*` and `scripts/**/*.test.*`; route tests mock the guard wrappers, never `getServerSession` | `vitest.config.ts:13-16`; `app/api/__tests__/cueRoute.test.ts` | Tests live under `app/**` and mock `authGuards` / `writeClient` |
| dev sits behind Vercel Deployment Protection; `SR_VERIFY_BYPASS_SECRET` is local-only | ADR-0027:7; `docs/SECRETS.md:380-393` | The dev smoke uses the bypass header and names itself as a new consumer (O7) |
| Every retained deployment counts toward the 10 GB Function Storage quota; ~75 MB each today | `docs/CI.md:127-136` | Measure the bundle delta the new dependencies add |

## Scope

### In scope

- The OAuth 2.1 authorization server: discovery, stateless dynamic registration, the
  consent page and its POST, the token endpoint (authorization code + refresh).
- The MCP route with bearer verification (O2) and exactly one tool, `ping`.
- Two hidden, read-only OAuth-state document types, and a guarded revocation script.
- Middleware exclusions, `docs/SECRETS.md` entries, an ADR, tests.
- The live handshake: dev smoke through a local client, then production from the phone.

### Non-goals

- Any domain tool (P1 onward). Any domain read or write.
- Client ID Metadata Documents. Not advertised, so claude.ai stays on DCR (see Decisions).
- A registration store, a callback-observation record, or any other write an
  unauthenticated caller can cause.
- Kids, stdio, `openid-configuration`, scopes beyond a single implicit one.

### Preserved invariants

- `proxy.ts` and `routeMatcher.ts` stay byte-identical; `PUBLIC_ROUTES` lists exactly the
  new ungated routes.
- No change to `auth.ts`, `authGuards.ts`, `memberAccess.ts` or any existing route —
  P0 only **calls** them.
- `studioProtection` guarantees hold for the new types (read-only, hidden).
- No secret value in any tracked file (global CLAUDE.md); Frank generates and enters
  every secret himself.

## Affected boundaries

| Component | Current | Planned |
|---|---|---|
| `package.json` / lockfile | — | + `mcp-handler@2.2.0`, `@modelcontextprotocol/server@2.1.0`, `@modelcontextprotocol/core@2.1.0`, `zod@4.3.6`, `jose@6.2.12` — **exact pins** |
| `app/mcp/oauth/*.ts` (new, neutral) | — | origin/issuer resolution, token sign/verify, PKCE, client-id codec, redirect allowlist, grant store, error builders |
| `app/api/oauth/register/route.ts` | — | stateless DCR (ungated) |
| `app/(client)/oauth/authorize/page.tsx` + `app/api/oauth/authorize/route.ts` | — | consent page (gated) + approval POST (gated) |
| `app/api/oauth/token/route.ts` | — | code + refresh grants (ungated) |
| `app/api/oauth/discovery/*/route.ts` + `next.config.mjs` rewrites | — | AS metadata, PRM (root and path-inserted), reached only through `/.well-known/*` |
| `app/api/mcp/route.ts` + `app/mcp/tools/ping.ts` | — | MCP endpoint (ungated; self-authenticating) |
| `sanity/schemas/mcpOauthGrant.ts`, `mcpOauthCodeRedemption.ts`; `sanity/schema.ts`; `app/utils/studioProtection.ts` | — | two hidden, read-only types |
| `proxy.ts`, `app/utils/routeMatcher.ts`, `routeMatcher.test.ts` | 8 public routes | + `/api/mcp`, `/api/oauth/register`, `/api/oauth/token`, and the `/.well-known` prefix in the matcher |
| `scripts/revoke-mcp-grant.mjs` | — | O9's deploy-free revocation path |
| `docs/SECRETS.md`, `docs/adr/`, `docs/MCP.md` (new), `CLAUDE.md` | — | secrets, the registration ADR, the operator runbook, one invariant line |
| Vercel project | — | env `MCP_OAUTH_SECRET` (preview ≠ production), optional `MCP_DISABLED`; one WAF rate-limit rule |

## Ordered changes

Each step leaves the tree green on the four gates. Nothing is deployed until step 12.

### 1. Compatibility gate — the handler library on Next 16.2.12

- **Purpose:** C4 of the spec — prove `mcp-handler@2.2.0` + `@modelcontextprotocol/server@2.1.0` work in this app before anything depends on them.
- **Change:** install the five exact pins; add a throwaway `app/api/mcp/route.ts` serving `ping` with **no auth**, and run it only locally: `next build` succeeds; a JSON-RPC `initialize` + `tools/list` + `tools/call ping` over Streamable HTTP POST returns correctly (a vitest calling the exported handler with a `Request`, plus one `curl` against `next start`).
- **Failure and recovery:** if either fails on Next 16, replace `mcp-handler` with a hand-written POST handler on `@modelcontextprotocol/server`'s web-standard transport (its v2 core is `Request`/`Response`), keeping every other step unchanged. Record which path was taken in the ADR (step 11).
- **Verification:** the build log and the test.
- **State after:** dependencies pinned; the unauthenticated route **is removed again** before the commit ends — it never reaches a commit that could deploy.

### 2. OAuth core module — pure, fully unit-tested

- **Purpose:** every security decision lives in one neutral module (`app/mcp/oauth/`), with no route or framework code, so it is testable without a server.
- **Change:**
  - **Origin and issuer.** `resolveOrigin(request)` returns the canonical origin for this deployment — production `https://owt-backstage.vercel.app`, preview `https://dev-owt-backstage.vercel.app`, local `http://localhost:3000` — chosen by `VERCEL_ENV`, and **refuses any other host** (per-deployment URLs included). Every OAuth/MCP route answers 404 on a refused host. So each deployment serves exactly one origin and never advertises another's endpoints (I10), and a request's own `Host` can never pick the issuer.
  - **Resource.** `resourceFor(origin) = origin + "/api/mcp"`.
  - **Secret.** `loadSecret()` reads `MCP_OAUTH_SECRET`; missing or shorter than 32 bytes → every OAuth/MCP route answers 503 (fail closed; an empty key never signs or verifies).
  - **Tokens** (`jose`, HS256, `typ` distinguishes kinds; every token carries `iss = origin`):
    - *client id* — `{ typ: "client", redirect_uris, client_name, iat }`, no expiry (DCR clients are long-lived);
    - *authorization code* — `{ typ: "code", sub, client (sha256 of client_id), redirect_uri, code_challenge, resource, jti, exp: 60 s }`;
    - *access token* — `{ typ: "at", sub, aud: resource, grant, jti, exp: 7 d }`;
    - *refresh token* — `{ typ: "rt", sub, grant, jti, exp: 30 d }`.
    Verification checks signature, `typ`, `iss === origin`, expiry, and `aud` where present — a token minted on one deployment fails on the other twice over (different secret by O7, different `iss`/`aud` by I10).
  - **PKCE.** S256 only; `plain` refused. Verifier compared to the challenge through `crypto.timingSafeEqual` on equal-length buffers.
  - **Redirect allowlist, per origin.** Production and preview: exactly `https://claude.ai/api/mcp/auth_callback` (a dated constant citing the source). Preview only, additionally: loopback `http://127.0.0.1:<port>/…` and `http://localhost:<port>/…` (RFC 8252) for the dev smoke client. The allowlist is re-checked at authorize **and** at token, never read from anything stored (O1).
  - **Grant store** (`writeClient`): `createGrant`, `loadGrant` (30 s cache, reusing the `isMemberActive` pattern), `rotateRefresh(grant, presentedJti)` under `ifRevisionId`, `revokeGrant`; `redeemCode(jti)` = `writeClient.create({ _id: "mcpOauthCode." + sha256(jti), _type: "mcpOauthCodeRedemption", redeemedAt })`, where `sanityConflictKind(err) === "already_exists"` means **replay** (O4).
- **Failure and recovery:** pure; nothing ships.
- **Verification:** vitest per function — including a token signed with another secret, a wrong `iss`, a wrong `aud`, an expired code, a `plain` PKCE method, a verifier of the wrong length, a loopback redirect presented to production, a host outside the canonical set, a second redemption of one code (the mocked `create` throws a 409 → refused), a superseded refresh `jti` (→ grant revoked).
- **State after:** module merged, unused.

### 3. OAuth-state document types

- **Change:** `mcpOauthGrant` — `{ sub (member id), clientHash, origin, createdAt, lastRefreshAt, currentRefreshJti, revoked, revokedAt, revokedReason }`; `mcpOauthCodeRedemption` — `{ redeemedAt }` only (the `_id` carries the hashed `jti`). Both `readOnly: true`, `hidden: true`; registered in `sanity/schema.ts`; added to `PROTECTED_STUDIO_TYPES` and `INTERNAL_STUDIO_TYPES`.
- **Why these fields are safe (O5):** the dataset answers unauthenticated published reads (`operationalClient.ts:13-15`), so everything here is treated as public. A member id is already public; a refresh `jti` or a hashed code `jti` cannot be replayed without the signing secret; `clientHash` is a hash. No token, no secret, no client id.
- **Verification:** `studioProtection.test.ts` (extended for the two types); a unit test that the grant writer never sets a field outside the list.
- **State after:** types exist; Studio shows them read-only; nothing writes them yet.

### 4. Discovery

- **Change:** `app/api/oauth/discovery/authorization-server/route.ts` (RFC 8414) and `…/protected-resource/route.ts` (RFC 9728), both computing from `resolveOrigin`. `next.config.mjs` gains `beforeFiles` rewrites:
  - `/.well-known/oauth-authorization-server` → AS metadata: `issuer`, `authorization_endpoint: <origin>/oauth/authorize`, `token_endpoint`, `registration_endpoint`, `response_types_supported: ["code"]`, `grant_types_supported: ["authorization_code","refresh_token"]`, `code_challenge_methods_supported: ["S256"]`, `token_endpoint_auth_methods_supported: ["none"]`, `authorization_response_iss_parameter_supported: true`. **`client_id_metadata_document_supported` is omitted**, which keeps claude.ai on DCR.
  - `/.well-known/oauth-protected-resource` and `/.well-known/oauth-protected-resource/api/mcp` → PRM: `resource: <origin>/api/mcp`, `authorization_servers: [<origin>]`, `bearer_methods_supported: ["header"]`.
  Both answer `Content-Type: application/json`, `Cache-Control: no-store`.
- **Verification:** route tests per canonical host (issuer = origin; resource = origin + `/api/mcp`), 404 on a non-canonical host, content type set.

### 5. Middleware exclusions (I11)

- **Change:** add `api/mcp(?:/|$)`, `api/oauth/register$`, `api/oauth/token$` and `\.well-known(?:/|$)` to `MIDDLEWARE_MATCHER`; copy the literal into `proxy.ts`; add `/api/mcp`, `/api/oauth/register`, `/api/oauth/token` to `PUBLIC_ROUTES`. `/oauth/authorize` and `/api/oauth/authorize` **stay gated**; the discovery handlers under `/api/oauth/discovery/*` stay gated too (reachable only through the rewrite).
- **Verification:** `routeMatcher.test.ts` green (sync guard + exact public set); a matcher test that `/oauth/authorize?x=1`, `/api/oauth/authorize` and `/api/oauth/discovery/protected-resource` are still gated.

### 6. Stateless registration — `POST /api/oauth/register` (ungated)

- **Change:** accepts JSON; requires `redirect_uris` (1–5, each on the origin's allowlist — refused otherwise with `invalid_redirect_uri`) and `token_endpoint_auth_method: "none"` if present; body ≤ 4 KB; unknown members ignored per RFC 7591 but never echoed. Returns `201` with `client_id` = the signed client token, `client_id_issued_at`, `redirect_uris`, `token_endpoint_auth_method: "none"`, `grant_types`, `response_types`. **Writes nothing.**
- **O3 as delivered:** the hard cap on *kept* registrations is trivially met — none are kept; the spec's O3 notes a stored-nothing registration "meets O3 without a cap at all". The rate limit is the project's one Hobby WAF rate-limit rule on `/api/oauth/register` (step 12).
- **Verification:** route tests — allowlisted URI accepted, foreign URI refused, oversized body refused, loopback refused on production, the returned `client_id` verifies and carries the URIs; the handler never touches `writeClient` (asserted with a mock).

### 7. Consent — `/oauth/authorize` page and its POST (both gated)

- **Page (GET):** a Server Component. Validates every parameter before rendering: `response_type=code`; `client_id` verifies and was issued by this origin; `redirect_uri` is **exactly** one of the client's URIs **and** on this origin's allowlist; `code_challenge_method=S256` with a challenge present; `resource`, if sent, equals this origin's resource (else `invalid_target`); `state` carried through. An invalid `client_id` or `redirect_uri` renders an error page and **never redirects** (an unverified redirect target is never followed); every other error redirects to the verified `redirect_uri` with `error`, `state` and `iss`.
  Session: `requireActiveSession()` (the middleware already sent a cookie-less browser through sign-in and back); `role !== "super-admin"` → rejection page; `session.user.isImpersonating` → rejection page ("sal de la suplantación para conectar").
  Renders (Spanish UI): the client's self-declared name **labelled as unverified**, the redirect host, how long ago the client registered (from `iat`), and «Aprueba sólo si acabas de iniciar esta conexión en Claude». Two buttons: «Permitir» and «Cancelar», in a `<form method="POST">` to `/api/oauth/authorize` carrying the validated parameters.
- **POST:** re-validates **everything** the page validated (never trusts the page) plus the session, role and impersonation. «Cancelar» → redirect with `error=access_denied`. «Permitir» → mint the 60 s code and 302 to `redirect_uri?code=…&state=…&iss=<origin>` (RFC 9207). A GET to this route never issues a code (405). Consent is never remembered (O8): every authorization renders the page and needs its own POST.
- **CSRF:** the NextAuth cookie keeps its default `SameSite=Lax`, so a cross-site POST arrives without a session and is refused; no GET issues a code.
- **Verification:** route and page tests — member, admin and content-editor sessions rejected; impersonating super-admin rejected; mismatched redirect never redirected to; `plain` PKCE refused; a returning client still sees consent; the POST refuses a parameter set that differs from what a valid page would show.

### 8. Token — `POST /api/oauth/token` (ungated)

- **Change:** `application/x-www-form-urlencoded` only.
  - `authorization_code`: verify the code (signature, `typ`, `iss`, 60 s expiry); its `client` equals the hash of the presented `client_id`, which itself verifies for this origin; `redirect_uri` equals the code's; PKCE verifier matches; `resource`, if sent, equals the code's; the subject is still a live, non-disabled super-admin (`getMemberAccess`); **then** `redeemCode(jti)` — a conflict means replay → `invalid_grant`. Create the grant, issue access (7 d) and refresh (30 d) tokens.
  - `refresh_token`: verify; load the grant **uncached** (the 30 s cache serves only the per-request revocation check, never a rotation); revoked → `invalid_grant`; presented `jti` ≠ `currentRefreshJti` → **revoke the whole grant** and answer `invalid_grant` (O4 — a lost-response retry looks the same and is accepted as a reconnect); live-principal check; rotate under `ifRevisionId` (a concurrent rotation loses the revision race and gets `invalid_grant` rather than a second valid token); issue both tokens.
  - Responses carry `Cache-Control: no-store`; errors are RFC 6749 JSON (`invalid_grant`, `invalid_request`, `invalid_client`, `unsupported_grant_type`), never a stack trace (E1).
- **Verification:** replay refused on the second redemption; wrong verifier, wrong redirect, expired code, foreign `client_id` refused; superseded refresh revokes the grant; demoted and disabled subjects refused at both grants; responses `no-store`.

### 9. The MCP route and `ping` (ungated, self-authenticating)

- **Change:** `app/api/mcp/route.ts` built with `createMcpHandler` (or the step-1 fallback), wrapped in the bearer check:
  1. `MCP_DISABLED` truthy → `503` (also applied at the top of every OAuth route — O2's kill switch covers all of them).
  2. Host not canonical → `404`.
  3. Missing, malformed, expired, wrong-`aud`, wrong-`iss` or wrong-`typ` token → `401` with `WWW-Authenticate: Bearer error="invalid_token", resource_metadata="<origin>/.well-known/oauth-protected-resource/api/mcp"`.
  4. Grant revoked (30 s cache) or subject not a live, non-disabled super-admin (`getMemberAccess`, 30 s) → the same `401`.
  Only then does any tool dispatch (I6).
- **`ping`:** no input — its schema is `z.object({}).strict()`, so any argument is refused (I13); annotated `readOnlyHint: true` (I14). Returns `{ ok: true, server: "owt-backstage", version, now }` with `now` in `America/Mexico_City`. Reads nothing from the dataset.
- **Errors:** tool failures return MCP tool-error results with a Spanish message and no internals (E1).
- **Verification:** route tests for each 401 cause (asserting the exact header), the kill switch, a valid token reaching `ping`, an argument to `ping` refused, `tools/list` showing exactly one tool with `readOnlyHint: true`.

### 10. Revocation — `scripts/revoke-mcp-grant.mjs` (O9)

- **Change:** guarded per `scripts/grant-kids-manager.mjs`: lists grants (id, subject, created, last refresh, revoked) by default; `--id <grant> --apply` or `--all --apply` sets `revoked: true`, `revokedAt`, `revokedReason`. Needs no deployment; effective within the 30 s grant cache. Documented in `docs/MCP.md`.
- **Verification:** unit test of its patch builder; the live run in step 13.

### 11. Documentation and the ADR

- `docs/SECRETS.md`:
  - **`MCP_OAUTH_SECRET`** — Needed in: Vercel **preview and production, each generated separately** (`openssl rand -hex 32`, run and entered by Frank), and local `.env.local`; **not** CI, iOS, GCF. Purpose: signs every client id, code and token; without it every OAuth/MCP route answers 503. Rotate: generate, set in the one environment, redeploy it; every connector on that environment must be re-added. Blast radius: that environment's connector only; the app is unaffected.
  - **`MCP_DISABLED`** — optional kill switch; any non-empty value shuts every MCP and OAuth route; takes effect on the next deployment.
  - **`SR_VERIFY_BYPASS_SECRET`** — add the dev smoke client as a consumer.
- **ADR (next free number at merge):** "MCP client registration is stateless DCR". Rejected: stored registrations (an unauthenticated write, and the cap problem O3 exists for) and CIMD (preferred by MCP 2026-07-28, but the approved spec's O1 names DCR and Claude supports both; switching is a spec change). Also records the step-1 library path.
- **`docs/MCP.md` (new):** the operator runbook — adding the connector in claude.ai, revoking, the kill switch, the WAF rule, the dev smoke procedure.
- **`CLAUDE.md`:** one line under invariants — "OAuth/MCP routes serve only their deployment's canonical origin, fail closed without `MCP_OAUTH_SECRET`, and are excluded from `proxy.ts`; `/oauth/authorize` is not."

### 12. Release to dev, then production (per CLAUDE.md)

1. Gates green locally; fresh code review of the merge range; fix; re-verify the fix.
2. **Frank** sets `MCP_OAUTH_SECRET` on **preview** (its own value). Merge into `preview`, push, verify the dev alias moved (alias + `githubCommitSha`).
3. **Dev smoke (Frank; no agent can — it needs his super-admin session and a consent POST):** a local MCP client (e.g. the MCP Inspector) configured with the `x-vercel-protection-bypass` header runs discovery → registration with a loopback redirect → consent → token → `ping`; then a revoke via the script against a **dev-created** grant and a `401` within 30 s. The smoke calls no other tool (DV1). Discovery fetched on dev shows `issuer`/`resource` equal to `https://dev-owt-backstage.vercel.app`.
4. **Frank** sets a **separately generated** `MCP_OAUTH_SECRET` on **production**. PR to `main`, `gates` green, merge; verify the production alias.
5. **Frank** creates the WAF rate-limit rule on `/api/oauth/register` (Vercel → Firewall → New Rule → Rate Limit; IP key; e.g. 10 requests / 60 s; action 429) and confirms it in the dashboard.
6. `vercel env ls` shows separate preview and production entries for `MCP_OAUTH_SECRET` (entries only — never a value).

### 13. Live acceptance on production (from the phone)

- Frank adds a custom connector in claude.ai pointing at `https://owt-backstage.vercel.app/api/mcp`, signs in on the phone when prompted, sees the consent screen, approves, and calls `ping` from the phone.
- Fetch both discovery documents from production with no cookie; `issuer` and `resource` equal the host fetched.
- Revoke the grant with the script (`--apply`, a production write Frank authorizes explicitly); the next call fails within 30 s; re-add the connector.
- Record the measured deployment-size delta (`next build` output) in `docs/MCP.md`.

## Data and failure safety

- **Identity and source of truth:** the signing secret is the only thing that makes a client id, code or token valid; the dataset holds only revocation and rotation state.
- **Migration:** none — two new document types, empty at release.
- **Partial failure:** a token response lost after the grant was created leaves an orphan grant with no usable refresh token (harmless; the script lists it). A refresh lost after rotation revokes the grant on retry — accepted by O4; Frank reconnects.
- **Concurrency:** refresh rotation is revision-guarded; code redemption is a `create()` race whose loser is refused.
- **Data preservation / rollback:** OAuth-state documents are inert once the routes are gone; the revocation script can revoke everything; no other data is touched.
- **Unauthenticated writes:** none. Registration writes nothing; token writes only after a valid signed code, which only Frank's consent can mint.

## Verification

| Requirement | Test or check | Failure it detects |
|---|---|---|
| O1 handshake, exact redirect, origin binding, impersonation refused | steps 2, 6, 7 tests + step 13 live | a foreign or dev client used on production; a code issued to an impersonator |
| O2 per-request checks + kill switch | step 9 tests | a demoted/disabled/foreign-origin token reaching a tool |
| O3 rate limit + cap | step 6 test (no write) + WAF rule confirmed | registration spam reaching the dataset |
| O4 code binding, single use, replay, refresh reuse | steps 2, 8 tests | replayed codes; stolen refresh tokens surviving |
| O5 stored fields | step 3 test | a secret or replayable value written to a public dataset |
| O6/O7 secret, pins, docs, separate values | step 11 review + `vercel env ls` | shared secrets across environments; undocumented secrets |
| O8 consent every time, POST only, untrusted name | step 7 tests | silent code issuance (confused deputy) |
| O9 revocation within 30 s | step 10 + step 13 live | an unrevokable connector |
| I10 per-origin discovery, `resource` per RFC 9728 | step 4 tests + step 13 fetch | a preview handshake pointed at production |
| I11 exclusions, three files | `routeMatcher.test.ts` | a public route gated, or a gated one public |
| I13 / I14 `ping` input and annotation | step 9 tests | argument injection; mislabelled tool |
| E1 error contract | steps 8, 9 tests | internals leaked |
| DV1 dev smoke calls no write tool | step 12 procedure (only `ping` exists) | — |

## Rollout, observability, and rollback

- **Release sequence:** step 12 exactly; nothing reaches `main` without the dev smoke.
- **Signals:** Vercel function logs for `/api/oauth/*` and `/api/mcp` (status codes only — never log a token or code); the grant list from the script.
- **Stop conditions:** a handshake that fails on production; any `5xx` from the OAuth routes; any token accepted across environments in the step 2/9 tests.
- **Rollback:** set `MCP_DISABLED=1` and redeploy (every MCP and OAuth route answers 503); then revert the PR — removing the routes, the matcher entries in all three files, and the `next.config.mjs` rewrites. The two document types can stay (inert) or be removed by a guarded script.
- **Restoration check:** discovery and `/api/mcp` answer 503 or 404 on both origins; the rest of the app is unaffected (the four gates and the dev alias check).

## Decisions

| Decision | Choice | Why | Tradeoffs | Owner |
|---|---|---|---|---|
| Handler | `mcp-handler@2.2.0` on `@modelcontextprotocol/server@2.1.0`, exact pins | Stateless, no Redis, RFC 9728 helpers, web-standard handler | Next 16 not named by the package — hence the step-1 gate and fallback | this plan |
| Registration | **Stateless DCR**: the client id is a signed token | Nothing stored, so no unauthenticated write and no cap to exhaust; origin binding and registration time ride inside it | Registrations cannot be listed or revoked individually — grants are what gets revoked | this plan (ADR) |
| CIMD | Not advertised | The approved spec's O1 names DCR; Claude supports both; switching is a spec change | Diverges from MCP 2026-07-28's SHOULD | this plan |
| Callback allowlist | Seeded from Claude's documentation; no observation phase | The URI is documented exactly | A future Claude change fails closed until the constant is updated through the pipeline | this plan |
| Canonical origin per deployment | Only the environment's alias; every other host 404 | Makes I10 structural: one deployment, one issuer | Per-deployment URLs cannot be used for OAuth | this plan |
| Consent page gated by the middleware | Yes | The default NextAuth redirect preserves the full query | Relies on no custom `redirect` callback being added later — noted in `CLAUDE.md` | this plan |
| Rate limit | The project's one Hobby WAF rate-limit rule, on `/api/oauth/register` | Only IP-level limiting that works across serverless instances without new infrastructure | Uses Hobby's only rate-limit rule | Frank (dashboard) |

## Assumptions

| Assumption | Impact if false | Validation point | Failure response |
|---|---|---|---|
| `mcp-handler@2.2.0` works on Next 16.2.12 | Step 1 fails | Step 1 | Hand-written handler on `@modelcontextprotocol/server`; plan otherwise unchanged |
| claude.ai still uses exactly `https://claude.ai/api/mcp/auth_callback` | Production handshake refused | Step 13 | Fail closed; update the dated constant through the full pipeline |
| claude.ai sends RFC 8707 `resource` or accepts its absence | If absent, validation must default to this origin's resource | Step 12/13 | `resource` is optional in the request and, when present, must match — already the design |
| The dev smoke client can send the `x-vercel-protection-bypass` header on **every** request (discovery, registration, token, MCP) | The dev handshake cannot complete through Deployment Protection | Step 12 | Use a small local script as the client instead of an off-the-shelf inspector; the browser consent step already passes, since Frank's browser is signed in to Vercel |
| Anthropic's traffic reaches production from its documented range and is not blocked by the WAF rule | Registration throttled | Step 13 | Loosen the rule's threshold |
| The new dependencies add little to each deployment | Function Storage fills faster | Step 13 measurement | Record the delta; revisit retention if needed |

## Open questions

None blocking. Scopes (a single implicit scope today) and CIMD are future decisions, each
a spec change.

## Handoff

- **Prerequisites supplied to later plans:** a verified bearer check (I6) every later tool
  inherits; the tool-registration pattern with annotations and strict input schemas;
  the kill switch; the grant store.
- **Adversarial review order:** this plan now (critical); P2's spec after it.
- **Implementation authorization: not granted by this plan.**

## Terminal state

`READY_FOR_ADVERSARIAL_REVIEW`
