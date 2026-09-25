// The whole connector handshake, chained in-process (R26): what a client does
// from a bare `/api/mcp` URL to a working `ping`, then a refresh, then a
// revocation biting once the grant cache lets go.
//
// Every step feeds the next ONE's input from the previous one's OUTPUT — the
// 401 challenge names the metadata URL, the metadata names the endpoints, the
// registration returns the client id, the consent 303 carries the code, the
// token response carries the tokens — so a seam between two routes that each
// pass their own suite fails here. Requests are dispatched the way Next would:
// the `/.well-known/*` paths through next.config.mjs's REAL `beforeFiles`
// rewrites, everything else to the route file at that path.
//
// Mocked, exactly as the per-route suites mock them and nothing more: the
// session guard (a live super-admin at the consent POST) and the live member
// record. `sanity/lib/serverClient` is the shared in-memory dataset, so the
// real grant store runs underneath. The consent PAGE is a Server Component and
// is not rendered; what it does with the query — the preflight, then the SAME
// validator, then `authorizeFormFields` — is run here with those same functions.

import { createHash, randomBytes } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const h = await vi.hoisted(async () => {
  // Read once when the MCP route loads (R22), so it is set before the import.
  vi.stubEnv("VERCEL_GIT_COMMIT_SHA", "fedcba9876543210fedcba9876543210fedcba98");
  const { createInMemorySanity } = await import("./inMemorySanity");
  return { ...createInMemorySanity(), requireActiveSession: vi.fn(), getMemberAccess: vi.fn() };
});

vi.mock("@/app/utils/authGuards", () => ({ requireActiveSession: () => h.requireActiveSession() }));
vi.mock("@/app/utils/memberAccess", () => ({ getMemberAccess: (id: string) => h.getMemberAccess(id) }));
vi.mock("@/sanity/lib/serverClient", () => ({ writeClient: h.writeClient, serverClient: { fetch: vi.fn() } }));
// A future read tool's import of `operationalClient`/`rawIntegrityClient` must
// never reach `sanity/env.ts`, which throws when `NEXT_PUBLIC_SANITY_*` is
// unset (as it is under vitest). No read tool is registered yet, so nothing
// here calls `fetch`.
vi.mock("@/sanity/lib/operationalClient", () => ({ operationalClient: { fetch: vi.fn() }, rawIntegrityClient: { fetch: vi.fn() } }));

import nextConfig from "../../../next.config.mjs";
import { DELETE as mcpDELETE, GET as mcpGET, POST as mcpPOST } from "@/app/api/mcp/route";
import { POST as authorizePOST } from "@/app/api/oauth/authorize/route";
import { GET as authorizationServerGET } from "@/app/api/oauth/discovery/authorization-server/route";
import { GET as protectedResourceGET } from "@/app/api/oauth/discovery/protected-resource/route";
import { POST as registerPOST } from "@/app/api/oauth/register/route";
import { POST as tokenPOST } from "@/app/api/oauth/token/route";
import { authorizeFormFields, validateAuthorizeRequest } from "@/app/mcp/oauth/authorizeRequest";
import {
  CODE_REDEMPTION_ID_PREFIX,
  GRANT_ID_PREFIX,
  MCP_OAUTH_CODE_REDEMPTION_TYPE,
  MCP_OAUTH_GRANT_TYPE,
} from "@/app/mcp/oauth/documentTypes";
import { GRANT_CACHE_TTL_MS, __clearGrantCache } from "@/app/mcp/oauth/grantStore";
import { mcpRoutePreflight } from "@/app/mcp/oauth/guard";
import { PREVIEW_ORIGIN } from "@/app/mcp/oauth/origin";
import { verifyAccessToken } from "@/app/mcp/oauth/tokens";

const SECRET = "s".repeat(32);
const MEMBER = "frank";
const SUPER_ADMIN_SESSION = { user: { sanityId: MEMBER, role: "super-admin", isImpersonating: false } };
/** RFC 8252 loopback — what the dev smoke registers; allowed on preview only. */
const LOOPBACK_URI = "http://127.0.0.1:51004/callback";
const FORM = "application/x-www-form-urlencoded";
const PROTOCOL = "2025-06-18";
const STATE = "chain-state-123";

type Handler = (request: Request) => Promise<Response>;

/** The route files the chain reaches, by the path Next serves them at. */
const ROUTES: Record<string, Partial<Record<"GET" | "POST" | "DELETE", Handler>>> = {
  "/api/oauth/discovery/authorization-server": { GET: authorizationServerGET },
  "/api/oauth/discovery/protected-resource": { GET: protectedResourceGET },
  "/api/oauth/register": { POST: registerPOST },
  "/api/oauth/authorize": { POST: authorizePOST },
  "/api/oauth/token": { POST: tokenPOST },
  "/api/mcp": { GET: mcpGET, POST: mcpPOST, DELETE: mcpDELETE },
};

let beforeFiles: { source: string; destination: string }[] = [];

/**
 * What a client's request to `url` reaches on the preview deployment: the
 * `beforeFiles` rewrite for its path if there is one, else the route file at
 * that path. The `Host` header is the URL's own, as it would be on the wire.
 */
async function send(
  url: string,
  init: { method?: "GET" | "POST" | "DELETE"; headers?: Record<string, string>; body?: string } = {},
): Promise<Response> {
  const target = new URL(url);
  expect(target.origin, url).toBe(PREVIEW_ORIGIN);
  const pathname = beforeFiles.find((r) => r.source === target.pathname)?.destination ?? target.pathname;
  const method = init.method ?? "GET";
  const handler = ROUTES[pathname]?.[method];
  if (!handler) throw new Error(`no route serves ${method} ${pathname}`);
  return handler(
    new Request(target, {
      method,
      headers: { host: target.host, ...init.headers },
      ...(init.body !== undefined ? { body: init.body } : {}),
    }),
  );
}

/** The single JSON-RPC message a legacy-era 200 carries as an SSE stream. */
async function rpcResult(res: Response): Promise<Record<string, unknown>> {
  expect(res.status).toBe(200);
  expect(res.headers.get("content-type")).toMatch(/^text\/event-stream/);
  const messages = (await res.text())
    .split(/\r?\n\r?\n/)
    .map((event) =>
      event
        .split(/\r?\n/)
        .filter((line) => line.startsWith("data:"))
        .map((line) => line.slice(5).replace(/^ /, ""))
        .join("\n"),
    )
    .filter((data) => data !== "")
    .map((data) => JSON.parse(data) as Record<string, unknown>);
  expect(messages).toHaveLength(1);
  expect(messages[0]!.error).toBeUndefined();
  return messages[0]!.result as Record<string, unknown>;
}

let consoleSpies: ReturnType<typeof vi.spyOn>[];

beforeEach(() => {
  vi.clearAllMocks();
  h.reset();
  __clearGrantCache();
  // Only `Date` is faked: the grant cache's clock. Timers stay real, so
  // nothing the SDK schedules can stall the chain.
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.stubEnv("VERCEL_ENV", "preview");
  vi.stubEnv("MCP_OAUTH_SECRET", SECRET);
  h.requireActiveSession.mockResolvedValue(SUPER_ADMIN_SESSION);
  h.getMemberAccess.mockResolvedValue({ active: true, role: "super-admin", ministries: ["worship"], managesMinistries: [] });
  consoleSpies = (["log", "info", "warn", "error", "debug"] as const).map((m) =>
    vi.spyOn(console, m).mockImplementation(() => {}),
  );
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
  for (const spy of consoleSpies) spy.mockRestore();
});

describe("the connector handshake, end to end on preview (discovery → ping → refresh → revocation)", () => {
  it("chains every route with the real validator, PKCE, grant store and bearer check", async () => {
    const rewrites = (await nextConfig.rewrites!()) as { beforeFiles?: typeof beforeFiles };
    beforeFiles = rewrites.beforeFiles ?? [];

    // ── 1. Discovery, from nothing but the MCP URL ─────────────────────────
    const mcpUrl = `${PREVIEW_ORIGIN}/api/mcp`;
    const challengeRes = await send(mcpUrl, {
      method: "POST",
      headers: { accept: "application/json, text/event-stream", "content-type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 0, method: "tools/list" }),
    });
    expect(challengeRes.status).toBe(401);
    const challenge = challengeRes.headers.get("www-authenticate") ?? "";
    const metadataUrl = /resource_metadata="([^"]+)"/.exec(challenge)?.[1];
    expect(metadataUrl).toBe(`${PREVIEW_ORIGIN}/.well-known/oauth-protected-resource/api/mcp`);

    const resourceRes = await send(metadataUrl!);
    expect(resourceRes.status).toBe(200);
    const resource = (await resourceRes.json()) as { resource: string; authorization_servers: string[] };
    expect(resource.resource).toBe(mcpUrl);
    expect(resource.authorization_servers).toEqual([PREVIEW_ORIGIN]);

    const asRes = await send(`${resource.authorization_servers[0]}/.well-known/oauth-authorization-server`);
    expect(asRes.status).toBe(200);
    const as = (await asRes.json()) as {
      issuer: string;
      authorization_endpoint: string;
      token_endpoint: string;
      registration_endpoint: string;
      code_challenge_methods_supported: string[];
    };
    expect(as.issuer).toBe(PREVIEW_ORIGIN);
    expect(as.code_challenge_methods_supported).toEqual(["S256"]);

    // ── 2. Registration: a loopback redirect, allowed on preview ───────────
    const registerRes = await send(as.registration_endpoint, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        redirect_uris: [LOOPBACK_URI],
        client_name: "Chain test",
        token_endpoint_auth_method: "none",
        grant_types: ["authorization_code", "refresh_token"],
        response_types: ["code"],
      }),
    });
    expect(registerRes.status).toBe(201);
    const registration = (await registerRes.json()) as { client_id: string; redirect_uris: string[] };
    const clientId = registration.client_id;
    expect(registration.redirect_uris).toEqual([LOOPBACK_URI]);
    // Stateless (ADR-0039): registering wrote nothing.
    expect(h.creates).toEqual([]);

    // ── 3. Consent: the page's validation, then «Permitir» ─────────────────
    // A real RFC 7636 verifier; its S256 challenge computed independently of
    // the code under test.
    const verifier = randomBytes(32).toString("base64url");
    const codeChallenge = createHash("sha256").update(verifier).digest("base64url");
    const authorizeUrl = new URL(as.authorization_endpoint);
    expect(authorizeUrl.pathname).toBe("/oauth/authorize");
    for (const [name, value] of Object.entries({
      response_type: "code",
      client_id: clientId,
      redirect_uri: LOOPBACK_URI,
      code_challenge: codeChallenge,
      code_challenge_method: "S256",
      state: STATE,
      resource: resource.resource,
    })) {
      authorizeUrl.searchParams.set(name, value);
    }

    // What `/oauth/authorize` (a Server Component) does with that query.
    const preflight = mcpRoutePreflight({ headers: new Headers({ host: authorizeUrl.host }) });
    if (!preflight.ok) throw new Error("consent page preflight refused");
    const page = await validateAuthorizeRequest(authorizeUrl.searchParams, {
      origin: preflight.origin,
      key: preflight.key,
    });
    if (page.kind !== "render") throw new Error(`consent page would not render: ${page.kind}`);
    expect(page.client.name).toBe("Chain test");
    expect(page.request.redirectUri).toBe(LOOPBACK_URI);

    // The form it renders, submitted to its action with «Permitir».
    const form = new URLSearchParams(authorizeFormFields(page.request));
    form.append("decision", "allow");
    const consentRes = await send(`${PREVIEW_ORIGIN}/api/oauth/authorize`, {
      method: "POST",
      headers: { origin: PREVIEW_ORIGIN, "content-type": FORM },
      body: form.toString(),
    });
    expect(consentRes.status).toBe(303);
    const callback = new URL(consentRes.headers.get("location")!);
    expect(`${callback.origin}${callback.pathname}`).toBe(LOOPBACK_URI);
    expect(callback.searchParams.get("state")).toBe(STATE);
    expect(callback.searchParams.get("iss")).toBe(PREVIEW_ORIGIN);
    expect(callback.searchParams.get("error")).toBeNull();
    const code = callback.searchParams.get("code");
    expect(code).toBeTruthy();
    // The live role was checked for the SESSION's member, and minting wrote nothing.
    expect(h.getMemberAccess).toHaveBeenCalledWith(MEMBER);
    expect(h.creates).toEqual([]);

    // ── 4. Token exchange with the real verifier ───────────────────────────
    const tokenRes = await send(as.token_endpoint, {
      method: "POST",
      headers: { "content-type": FORM },
      body: new URLSearchParams({
        grant_type: "authorization_code",
        code: code!,
        redirect_uri: LOOPBACK_URI,
        client_id: clientId,
        code_verifier: verifier,
        resource: resource.resource,
      }).toString(),
    });
    expect(tokenRes.status).toBe(200);
    const tokens = (await tokenRes.json()) as { access_token: string; refresh_token: string; token_type: string };
    expect(tokens.token_type).toBe("Bearer");

    // One redemption receipt and one grant — and neither stores a raw client id or token.
    const stored = [...h.docs.values()];
    expect(stored.map((d) => [d._type, d._id.slice(0, d._id.indexOf(".") + 1)]).sort()).toEqual(
      [
        [MCP_OAUTH_CODE_REDEMPTION_TYPE, CODE_REDEMPTION_ID_PREFIX],
        [MCP_OAUTH_GRANT_TYPE, GRANT_ID_PREFIX],
      ].sort(),
    );
    const storedText = JSON.stringify(stored);
    for (const secret of [clientId, code!, tokens.access_token, tokens.refresh_token, verifier]) {
      expect(storedText).not.toContain(secret);
    }

    // ── 5. MCP: initialize → tools/list → tools/call ping ─────────────────
    const mcp = (token: string, method: string, params?: unknown, protocol?: string) =>
      send(mcpUrl, {
        method: "POST",
        headers: {
          authorization: `Bearer ${token}`,
          accept: "application/json, text/event-stream",
          "content-type": "application/json",
          ...(protocol ? { "mcp-protocol-version": protocol } : {}),
        },
        body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, ...(params !== undefined ? { params } : {}) }),
      });

    const init = await rpcResult(
      await mcp(tokens.access_token, "initialize", {
        protocolVersion: PROTOCOL,
        capabilities: {},
        clientInfo: { name: "chain-test", version: "0" },
      }),
    );
    expect(init.serverInfo).toMatchObject({ name: "owt-backstage", version: "fedcba9" });
    const negotiated = init.protocolVersion as string;
    expect(negotiated).toBe(PROTOCOL);

    const list = await rpcResult(await mcp(tokens.access_token, "tools/list", undefined, negotiated));
    expect((list.tools as { name: string }[]).map((t) => t.name)).toEqual([
      "ping",
      "get_service",
      "list_services",
      "search_songs",
      "get_song",
      "get_member_availability",
      "get_participation",
      "list_proposals",
    ]);

    const ping = (token: string) => mcp(token, "tools/call", { name: "ping", arguments: {} }, negotiated);
    const first = await rpcResult(await ping(tokens.access_token));
    expect(first.isError).toBeFalsy();
    expect(first.structuredContent).toMatchObject({ ok: true, server: "owt-backstage", version: "fedcba9" });

    // ── 6. One refresh, then ping on the new access token ──────────────────
    const refreshRes = await send(as.token_endpoint, {
      method: "POST",
      headers: { "content-type": FORM },
      body: new URLSearchParams({
        grant_type: "refresh_token",
        refresh_token: tokens.refresh_token,
        client_id: clientId,
      }).toString(),
    });
    expect(refreshRes.status).toBe(200);
    const refreshed = (await refreshRes.json()) as { access_token: string; refresh_token: string };
    expect(refreshed.refresh_token).not.toBe(tokens.refresh_token);

    const cachedAt = Date.now();
    const second = await rpcResult(await ping(refreshed.access_token));
    expect(second.structuredContent).toMatchObject({ ok: true, server: "owt-backstage" });

    // ── 7. Revoke the grant straight in the dataset ────────────────────────
    const verified = await verifyAccessToken(refreshed.access_token, { key: preflight.key, origin: PREVIEW_ORIGIN });
    if (!verified.ok) throw new Error("the refreshed access token does not verify");
    const grant = h.docs.get(verified.claims.grantId)!;
    expect(grant.revoked).toBe(false);
    // Not through `revokeGrant`, which would also drop the cache entry: this
    // is what a revocation written from elsewhere (the script, another
    // instance) looks like to this instance.
    Object.assign(grant, { revoked: true, revokedAt: new Date().toISOString(), revokedReason: "chain-test" });

    // Inside the grant cache's TTL the cached live grant still answers…
    vi.setSystemTime(cachedAt + GRANT_CACHE_TTL_MS - 1);
    const stale = await rpcResult(await ping(refreshed.access_token));
    expect(stale.structuredContent).toMatchObject({ ok: true });

    // …and once it has elapsed, the next call is refused.
    vi.setSystemTime(cachedAt + GRANT_CACHE_TTL_MS);
    const refused = await ping(refreshed.access_token);
    expect(refused.status).toBe(401);
    expect(refused.headers.get("www-authenticate")).toBe(
      `Bearer error="invalid_token", resource_metadata="${metadataUrl}"`,
    );
    expect(await refused.json()).toEqual({ error: "invalid_token" });

    // Nothing along the way logged a token (every one is a JWT: `eyJ…`).
    const logged = consoleSpies.flatMap((spy) => spy.mock.calls.flat().map(String)).join("\n");
    expect(logged).not.toMatch(/eyJ/);
  });
});
