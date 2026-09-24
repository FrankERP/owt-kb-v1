# ADR-0039: MCP client registration is stateless DCR — the client id is a signed token, nothing is stored

**Date:** 2026-09-24 · **Status:** Accepted

## Context

The MCP connector (P0: `app/api/mcp`, `app/api/oauth/*`) needs an OAuth client registration
mechanism reachable by anyone on the internet — `POST /api/oauth/register` is, deliberately, the
first endpoint in this app that accepts input from an unauthenticated caller and does something
with it (`app/api/oauth/register/route.ts`'s header comment). Two real mechanisms were on the
table:

- **RFC 7591 Dynamic Client Registration (DCR)** — a client `POST`s metadata and gets back a
  `client_id`. The approved spec (`docs/superpowers/specs/2026-09-22-owt-mcp-design-v2.md`, O1)
  names DCR as the registration mechanism, and claude.ai supports it.
- **Client ID Metadata Documents (CIMD)** — the client hosts a metadata document at its own URL
  and presents that URL as its `client_id`; the authorization server fetches and validates it.
  MCP's 2026-07-28 revision (`modelcontextprotocol.io/specification/2026-07-28/basic/authorization`)
  marks DCR "MAY, deprecated, retained for backwards compatibility" and CIMD "SHOULD". claude.ai
  supports CIMD too, but only chooses it when the authorization-server metadata advertises
  `client_id_metadata_document_supported: true` **and** `"none"` client authentication.

Either mechanism has to answer the same question: what does an unauthenticated `POST` to a
registration endpoint create, and can it be abused?

**`mcp-handler@2.2.0`** (on `@modelcontextprotocol/server@2.1.0` / `core@2.1.0`, `zod@4.3.6`,
`jose@6.2.12` — all exact pins) is the library path step 1 selected: stateless Streamable HTTP, no
Redis, serves the 2026-07-28 spec natively and falls back to a stateless handler for 2025-era
clients. Next 16 is not a peer the package names explicitly, which is why step 1 gated on it
compiling and running rather than trusting the README; a hand-written fallback handler on the same
web-standard SDK was prepared and turned out not to be needed. Pinning a direct `jose@6` (`O6`) put
next-auth's own `jose@4.15.9` into a nested copy under `node_modules` rather than removing it —
`auth.ts` never imported this app's `jose`, so nothing about NextAuth's token handling changed;
`npm ls jose` shows the two versions coexisting, deduped and harmless. The same install also
deduped `firebase-admin`'s transitive `jwks-rsa` copy up to `jose@6.2.12`, which was already
compatible.

## Decision

**Registration is stateless.** `POST /api/oauth/register` validates the request body (redirect
URIs against this origin's allowlist, `token_endpoint_auth_method: "none"` only, a control-character
sweep on `client_name`) and, if it passes, signs a `client` JWT with `MCP_OAUTH_SECRET`
(`app/mcp/oauth/tokens.ts`'s `signClientId`) carrying `redirect_uris`, an optional `client_name`
and `iat` — no expiry, because DCR clients are meant to be long-lived and what actually gets
revoked is a *grant*, not a registration. That token **is** the `client_id` handed back in the
201. Nothing is written to Sanity; the route never imports `writeClient` or the grant store, not
even transitively for types (guarded by an import-closure test). A client id is verified by this
server alone, with its own secret (HS256 is symmetric: nobody without `MCP_OAUTH_SECRET` can check
the signature, let alone mint one) — it needs no lookup, no cap, and no cleanup job.

## Rejected

**Stored registrations (the conventional DCR shape: `POST` writes a document, returns its id).**
This is an unauthenticated *write* endpoint, open to the entire internet — exactly the shape the
spec's O3 (rate-limit `/api/oauth/register`) exists to bound. A stored design still needs O3 *and*
a cap on how many registrations one IP (or nobody, if the write has no auth at all) can create
before the dataset fills with rows nobody will ever complete a handshake for — a second, harder
problem stacked on top of the first. Stateless registration removes the write entirely: there is
no store to exhaust, so O3's rate limit is defense against noise and cost, not against a growing
liability. The trade made in return — a registration cannot be listed or individually
revoked — is the one this ADR accepts: what gets revoked is a *grant* (`mcpOauthGrant`, via
`scripts/revoke-mcp-grant.mjs`), which is created only after a human approves a consent screen,
never at registration time.

**CIMD, despite MCP 2026-07-28 preferring it.** The approved spec's O1 names DCR by contract, and
switching to CIMD is a spec change, not an implementation detail this delivery is free to make —
CIMD requires the client to host and maintain a metadata document at a stable URL, a
responsibility that belongs to Claude's side of the integration, and advertising
`client_id_metadata_document_supported: true` in this server's discovery response
(`app/api/oauth/discovery/authorization-server/route.ts`) is the one thing that would let
claude.ai choose it over DCR — deliberately omitted, with a comment at the call site, for exactly
this reason. Not advertising it costs nothing today (claude.ai falls back to DCR, which it already
supports) and keeps the door open: CIMD can be adopted later, as its own spec change, once there
is a reason to.

## Consequences

- A `client_id` is a bearer credential for the *shape* of a registration (its redirect URIs and
  declared name), not an identity — anyone holding it can attempt the authorize flow, but the
  consent screen (`/oauth/authorize`) is what actually gates issuance of a code, and only a live
  super-admin session can approve one. `grantDocument.ts` stores only `sha256(client_id)`
  (`clientHash`), never the raw value, so even the grant record cannot leak a working client id.
- There is no admin surface to browse "registered clients" — by design. The operable unit is the
  grant, and `scripts/revoke-mcp-grant.mjs` lists and revokes those.
- If MCP tooling around CIMD becomes materially better (or claude.ai deprecates DCR outright), this
  record is the pointer to revisit that trade-off deliberately rather than rediscover it.
- Numbering follows the order changes reach `main`, not the order they were written
  (`docs/adr/README.md`'s convention, most recently exercised at ADR-0038) — this file is `0039`
  as the next free number at the time it was written; it may be renumbered at merge if another ADR
  lands on `main` first, and this paragraph is the marker that renumbering is expected rather than
  an error.
