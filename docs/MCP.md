# MCP connector — operator runbook

> **Status: implemented on branch `claude/mcp-page-app-247b7c`, NOT released.** Every route,
> test and script this document describes exists in the repository; nothing has been deployed.
> See [Release checklist](#release-checklist-steps-1213) for what remains.

This app exposes itself to Claude as an [MCP](https://modelcontextprotocol.io) server, so Frank
can ask Claude questions against a live OWT Backstage deployment from his phone or desktop. The
connector is OAuth-gated end to end: only a super-admin can authorize it, and only super-admin
tools are exposed (today: one health check). See
[ADR-0039](adr/0039-mcp-client-registration-is-stateless-dcr.md) for why client registration is
stateless, and [AUTH_AND_SECURITY.md](AUTH_AND_SECURITY.md#mcp--oauth) / [API_REFERENCE.md](API_REFERENCE.md)
for the route-level contract.

---

## What exists

### Endpoints

| Route | Gated by the session middleware? | Notes |
|---|---|---|
| `GET /.well-known/oauth-authorization-server` | No — self-authenticating | `beforeFiles` rewrite to `app/api/oauth/discovery/authorization-server/route.ts`, which stays gated at its own path |
| `GET /.well-known/oauth-protected-resource` | No | rewrite to `app/api/oauth/discovery/protected-resource/route.ts` |
| `GET /.well-known/oauth-protected-resource/api/mcp` | No | same rewrite target, path-suffixed RFC 9728 form (what `resourceMetadataUrl` points at) |
| `POST /api/oauth/register` | No | stateless DCR — writes nothing (ADR-0039) |
| `POST /api/oauth/token` | No | the only place grants are created and refresh tokens rotate |
| `GET \| POST \| DELETE /api/mcp` | No | the MCP endpoint itself — authenticates every request with its own bearer token |
| `GET /oauth/authorize` | **Yes** | the consent screen (a page, not an API route) |
| `POST /api/oauth/authorize` | **Yes** | the only thing that mints an authorization code; GET is 405 |

The three routes above marked "No" are excluded from `proxy.ts` / `MIDDLEWARE_MATCHER`
(`app/utils/routeMatcher.ts`) by design — each authenticates itself (a bearer token, a signed
client id, a signed code). `/oauth/authorize` and `/api/oauth/authorize` deliberately stay
**gated**: the consent screen needs a real super-admin session, and it can afford to sit behind
the middleware because NextAuth's **default** `redirect` callback carries a relative
`callbackUrl` (query included) through sign-in unchanged — see the invariant in `CLAUDE.md` and
the guard test `app/utils/__tests__/authRedirectCallback.test.ts`.

**Canonical origin, one per deployment.** Every request is checked against the ONE origin that
deployment is allowed to serve, chosen by `VERCEL_ENV` (`app/mcp/oauth/origin.ts`):

| `VERCEL_ENV` | Canonical origin | Resource (`GET /api/mcp`'s audience) |
|---|---|---|
| `production` | `https://owt-backstage.vercel.app` | `https://owt-backstage.vercel.app/api/mcp` |
| `preview` | `https://dev-owt-backstage.vercel.app` | `https://dev-owt-backstage.vercel.app/api/mcp` |
| unset / `development` | `http://localhost:3000` | `http://localhost:3000/api/mcp` |

Every other `Host` gets a 404 — a per-deployment `*.vercel.app` preview URL, the other alias, a
loopback address on a Vercel box, all refused. This is what makes "one deployment, one issuer"
structural rather than configured.

### Tokens

HS256 JWTs (`jose`), signed with `MCP_OAUTH_SECRET` (see [SECRETS.md](SECRETS.md#mcp_oauth_secret)):

| Kind | Lifetime | Carries |
|---|---|---|
| client id | none (DCR client) | `redirect_uris`, an optional `client_name`, `iat` |
| authorization code | 60 s | subject, client hash, redirect URI, PKCE challenge, resource, `jti` |
| access token | 7 days | subject, grant id, `jti`, `aud` = this origin's resource |
| refresh token | 30 days | subject, grant id, `jti` — **rotated on every use** |

**A reused refresh token revokes the whole grant** (once the request otherwise passes every
other check) — this is deliberate (spec O4): the second presenter of a superseded refresh token
is treated as a sign that the token leaked, not as a race to be quietly resolved. A lost token
response therefore means Frank reconnects from Claude; there is no partial-recovery path.

### The one tool: `ping`

Read-only (`readOnlyHint: true`), a strict empty input schema — any argument is refused, not
ignored. Returns:

```json
{ "ok": true, "server": "owt-backstage", "version": "a1b2c3d", "now": "2026-09-24T10:15:00-06:00" }
```

`version` is the deployment's `VERCEL_GIT_COMMIT_SHA`, first 7 characters (`"local"` if absent) —
this is how you tell from the phone which deployment answered. `now` is
America/Mexico_City wall-clock time with its UTC offset. Pattern for adding a second tool: one
file per tool in `app/mcp/tools/`, exporting a `register<Tool>(server, deps)` function that
`app/api/mcp/route.ts` calls inside its handler init.

### Stored state

Two Sanity document types, both hidden and read-only in `/studio`
(`app/utils/studioProtection.ts`) — see [DATA_MODEL.md](DATA_MODEL.md#studio) for the full field
list:

- **`mcpOauthGrant`** (`mcpOauthGrant.<uuid>`) — one per authorized connection: member id, a
  HASH of the client id (never the raw value), the issuing origin, timestamps, the current
  refresh `jti`, the revocation flag.
- **`mcpOauthCodeRedemption`** (`mcpOauthCode.<sha256(jti)>`) — a replay guard, `redeemedAt` only.

Nothing stored is secret or replayable on its own — the dataset answers unauthenticated
published reads, and both types are safe to be world-readable (a member id is already public;
neither a client hash nor a refresh `jti` is usable without the signing secret). Dotted `_id`s
are not surfaced by the public reader regardless.

---

## Adding the connector (claude.ai)

1. In claude.ai (web, Desktop or mobile), add a **custom connector** with URL:
   ```
   https://owt-backstage.vercel.app/api/mcp
   ```
   (or `https://dev-owt-backstage.vercel.app/api/mcp` to connect to dev instead of production —
   see [Release checklist](#release-checklist-steps-1213) for why dev is the one to use before
   step 13).
2. Claude discovers the OAuth endpoints, registers itself (stateless DCR — nothing is written
   yet), and opens the authorize URL in a browser.
3. **Sign in to Backstage** if you are not already — the consent page is a real app page behind
   the session middleware, so it goes through the ordinary `/auth/signin` flow first if needed.
4. The consent screen (`/oauth/authorize`) shows the client's self-declared, **unverified** name,
   the exact redirect URI, and how long ago it was registered. Read it — this screen is what
   stands between a super-admin and the confused-deputy attack that stateless, open registration
   makes possible (ADR-0039). Approve only a connection you just started in Claude.
5. Press **«Permitir»**. This is the only action that mints an authorization code
   (`POST /api/oauth/authorize`) — a GET never does, so no link, prefetch or redirect can trigger
   it.
6. Claude exchanges the code for tokens and the connector is live. A `ping` call in Claude is the
   quickest proof it worked.

Only a live, non-impersonating **super-admin** can reach step 4 successfully — everyone else sees
a refusal screen (no session, wrong role, or impersonation active) and no code is issued.

---

## Revoking

Grant documents are hidden and read-only in Studio, so the script is the only way to revoke one
without a deployment:

```bash
# Dry run — lists every grant (id, sub, origin, timestamps, revoked state). Writes nothing.
node --env-file=.env.local scripts/revoke-mcp-grant.mjs

# Revoke one grant.
node --env-file=.env.local scripts/revoke-mcp-grant.mjs --id mcpOauthGrant.<uuid> --apply

# Revoke every live grant.
node --env-file=.env.local scripts/revoke-mcp-grant.mjs --all --apply

# Either --apply form accepts an optional reason (defaults to "manual"):
node --env-file=.env.local scripts/revoke-mcp-grant.mjs --id mcpOauthGrant.<uuid> --apply --reason "lost device"
```

Every non-`--apply` invocation is a dry run that shows exactly what would be revoked. Revocation
takes effect **within 30 s** (the MCP route's grant cache TTL, `GRANT_CACHE_TTL_MS` in
`app/mcp/oauth/grantStore.ts`) and needs **no deployment** — the next request bearing that
grant's access token gets a 401 once the cache entry expires.

---

## Kill switch

Setting `MCP_DISABLED` to any non-empty value (Vercel → Settings → Environment Variables, on the
environment to disable) shuts every MCP and OAuth route: they answer 503, and the consent page
shows «No disponible» instead of rendering. Unlike grant revocation, **this takes effect on the
next deployment**, not within 30 s — env vars bind at build time. See
[SECRETS.md](SECRETS.md#mcp_disabled).

---

## The WAF rate limit (`/api/oauth/register`)

Registration is stateless and writes nothing (ADR-0039), so its risk is noise and cost, not a
growing dataset. Vercel's Hobby tier allows **one rate-limit rule per project**:

1. Vercel dashboard → the `owt-backstage` project → **Firewall** → **New Rule**.
2. **Rate Limit**, path `/api/oauth/register`, key **IP**, a window like **10 requests / 60 s**,
   action **429**.
3. **If the project's one Hobby rate-limit slot is already used by something else, stop and
   decide** — do not silently displace an existing rule. This is a Frank-run dashboard step, not
   code; nothing in this repo can create or verify it.

---

## Dev smoke procedure

`scripts/mcp-dev-smoke.mjs` is a self-contained local client that runs the whole OAuth + MCP
handshake against a real deployment of this app's own MCP server — discovery, DCR registration,
PKCE, a loopback OAuth callback, token exchange, `initialize`/`tools/list`/`ping`, refresh, and
(optionally) a revoke-and-401 proof. It needs `SR_VERIFY_BYPASS_SECRET` (see
[SECRETS.md](SECRETS.md#sr_verify_bypass_secret)) to pass Vercel's Deployment Protection when
targeting the dev alias, refuses to run against production outright, and calls only the `ping`
tool. **Running it against dev creates a real grant document in the shared production Sanity
dataset** — revoke it afterward with `scripts/revoke-mcp-grant.mjs`, per the steps below.

```bash
# Full dev smoke: discovery → registration → consent (opens the browser) → token →
# initialize/tools-list/ping → refresh → ping again → prints the grant id + revoke command.
node --env-file=.env.local scripts/mcp-dev-smoke.mjs

# Same, then pauses after printing the revoke command so you can run
# revoke-mcp-grant.mjs --id <id> --apply in another terminal, press Enter, and this
# polls ping every 10s for up to 60s for the 401 that proves the revocation landed.
node --env-file=.env.local scripts/mcp-dev-smoke.mjs --await-revocation

# Local next dev instead of the deployed dev origin — no bypass secret needed.
node --env-file=.env.local scripts/mcp-dev-smoke.mjs --base http://localhost:3000

# Print the authorize URL instead of auto-opening it.
node --env-file=.env.local scripts/mcp-dev-smoke.mjs --no-open

# Skip the refresh-token round trip (step 8).
node --env-file=.env.local scripts/mcp-dev-smoke.mjs --no-refresh
```

Two safe proof-of-refusal runs — no network call, may be run by anyone, any time:

```bash
node scripts/mcp-dev-smoke.mjs --base https://owt-backstage.vercel.app   # refuses, exit 2
env -u SR_VERIFY_BYPASS_SECRET node scripts/mcp-dev-smoke.mjs            # refuses, exit 2
```

**The revoke-and-401 check, end to end:** run the script with `--await-revocation`, let it walk
through registration/consent/token/ping/refresh, then when it prints the grant id and pauses, run
`revoke-mcp-grant.mjs --id <id> --apply` in a second terminal, come back to the first terminal and
press Enter. The script polls `ping` every 10 s for up to 60 s and passes once it observes a 401
whose `WWW-Authenticate` header carries `error="invalid_token"` — the same challenge a real,
revoked Claude connection would see.

Every secret, code and token the script ever prints is redacted (an 8-character prefix plus the
length, never the value); nothing is written to disk.

---

## Size measurements

Measured at implementation time (steps 1 and 9):

- `/api/mcp`'s traced serverless function is **≈2.46 MB** (155 files).
- Installing the new dependencies (`mcp-handler`, `@modelcontextprotocol/server`,
  `@modelcontextprotocol/core`, `zod`, `jose`) grew `.next/server` by **≈+4.8 MB**.
- Adding any new route rehashes Turbopack's shared chunks, so **every existing function's trace
  shifted by ≈+90 KB** too — this is Turbopack build behavior, not something the new dependencies
  themselves cause.
- **The per-deployment total on Vercel (Function Storage impact) is measured at step 13, once
  this ships to a real deployment.** This section will be updated with that number rather than
  left as a placeholder once it exists — see [CI.md](CI.md#which-branches-vercel-builds)
  for why Function Storage matters on this project's Hobby quota.

---

## Known behaviours

A few things that look like bugs at first glance and are not:

- **The consent page streams.** `/oauth/authorize` lives under `app/(client)/`, which has its own
  `loading.tsx` — so Next streams the route rather than blocking on it. A concrete consequence:
  `notFound()` (the foreign-host refusal) arrives to the browser as an HTTP 200 with the 404 body
  streamed in, and every error redirect is delivered in-stream too. This is ordinary App Router
  streaming, not a bug in the OAuth flow.
- **A session that expires between opening the consent page and clicking «Permitir» dead-ends at
  a 405 JSON body**, not at a helpful error screen — `GET /api/oauth/authorize` (which is what a
  stale form would effectively hit) is deliberately 405, because a GET must never mint a code.
  Frank should restart the connection from Claude rather than retry the stale page.
- **The token endpoint answers `invalid_client` with a 400**, never a 401 — the connector uses
  public clients (`token_endpoint_auth_method: "none"`), so a 401 would imply a `WWW-Authenticate`
  challenge for a scheme this server doesn't offer.
- **A replayed authorization code is refused, but the tokens issued on its FIRST redemption are
  not revoked.** Spec O4 requires refusing the replay itself, not retroactively invalidating a
  legitimate prior exchange — if that is a security concern in a specific incident, revoke the
  grant directly.
- **The SDK's schema-violation message is in English**, regardless of the rest of the app's
  Spanish UI: `Input validation error: Invalid arguments for tool …` comes from
  `@modelcontextprotocol/server` itself, not from this app's code. Accepted as-is — Claude reads
  the error, not Frank, and translating an upstream library's internal message is not worth the
  maintenance cost.
- **`subscriptions/listen` gets a JSON-RPC error (`-32603`), never a held stream.** The handler is
  built with `maxSubscriptions: 0` deliberately (see `app/api/mcp/route.ts`'s header comment) — a
  kept-open SSE stream would mean a revocation or a role demotion could not bite within the
  30-second cache window, and would keep a serverless function invocation alive for no reason.

---

## Release checklist (steps 12–13)

**Status: not released.** Everything above describes what is built on
`claude/mcp-page-app-247b7c`; none of it has reached a real deployment. What remains, per the P0
plan:

1. Generate and set `MCP_OAUTH_SECRET` on **preview** (`openssl rand -hex 32`, entered by Frank —
   see [SECRETS.md](SECRETS.md#mcp_oauth_secret)).
2. Merge the branch into `preview`, push, and **verify the dev alias moved** (the alias +
   `githubCommitSha` check — a green build is not enough).
3. Run the dev smoke (`scripts/mcp-dev-smoke.mjs`) against `dev-owt-backstage`, including the
   `--await-revocation` check, and revoke the grant it creates afterward.
4. Create the WAF rate-limit rule on `/api/oauth/register` (above) — check the project's one
   Hobby slot is free first.
5. Generate and set a **separate** `MCP_OAUTH_SECRET` on **production** — never reuse preview's
   value (see why in [SECRETS.md](SECRETS.md#mcp_oauth_secret)).
6. Open the PR, wait for the `gates` check, merge, then **verify the production alias** the same
   way as step 2.
7. Add the connector from the phone, against `https://owt-backstage.vercel.app/api/mcp`, and
   confirm `ping` answers with `version` matching the just-merged commit.

Until all seven are done, this document's "not released" status stands — do not update it to
imply a deployment that has not happened.
