// `/api/mcp` — P0 plan step 9: the MCP endpoint and its one tool, `ping`.
// Ungated by the session middleware, so it authenticates itself: every request
// passes the preflight and the whole bearer check before anything reaches the
// MCP server (spec I6), on every method.
//
// The live member record is mocked (repo convention) and
// `sanity/lib/serverClient` is the shared in-memory dataset, so the REAL grant
// store runs underneath: a revoked grant is really revoked in the stored
// document, and the 30 s grant cache really serves the second request.

import { SignJWT } from "jose";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const h = await vi.hoisted(async () => {
  // `serverInfo.version` is read ONCE, when the route module loads — as on
  // Vercel, where the commit is fixed for the life of a deployment — so it is
  // set here, before the import below. `vi.unstubAllEnvs()` restores it later.
  vi.stubEnv("VERCEL_GIT_COMMIT_SHA", "0123456789abcdef0123456789abcdef01234567");
  const { createInMemorySanity } = await import("./inMemorySanity");
  return { ...createInMemorySanity(), getMemberAccess: vi.fn() };
});

vi.mock("@/app/utils/memberAccess", () => ({ getMemberAccess: (id: string) => h.getMemberAccess(id) }));
vi.mock("@/sanity/lib/serverClient", () => ({ writeClient: h.writeClient, serverClient: { fetch: vi.fn() } }));

import { DELETE, GET, POST } from "@/app/api/mcp/route";
import * as mcpRoute from "@/app/api/mcp/route";
import { buildGrantDocument, newGrantId } from "@/app/mcp/oauth/grantDocument";
import { __clearGrantCache, createGrant, revokeGrant } from "@/app/mcp/oauth/grantStore";
import { PREVIEW_ORIGIN, PRODUCTION_ORIGIN, resourceFor } from "@/app/mcp/oauth/origin";
import { s256Challenge } from "@/app/mcp/oauth/pkce";
import { CLAUDE_AI_REDIRECT_URI } from "@/app/mcp/oauth/redirects";
import {
  clientHashOf,
  signAccessToken,
  signAuthorizationCode,
  signClientId,
  signRefreshToken,
} from "@/app/mcp/oauth/tokens";

const SECRET = "s".repeat(32);
const KEY = new TextEncoder().encode(SECRET);
const OTHER_KEY = new TextEncoder().encode("o".repeat(32));
const PREVIEW_HOST = "dev-owt-backstage.vercel.app";
const PRODUCTION_HOST = "owt-backstage.vercel.app";
const MEMBER = "frank";
const CLIENT_ID = "client-id-under-test";
const VERSION = "0123456";

// The EXACT challenges (R7), written out rather than rebuilt from the helpers
// under test.
const METADATA_URL = "https://dev-owt-backstage.vercel.app/.well-known/oauth-protected-resource/api/mcp";
const NO_TOKEN_CHALLENGE = `Bearer resource_metadata="${METADATA_URL}"`;
const INVALID_TOKEN_CHALLENGE = `Bearer error="invalid_token", resource_metadata="${METADATA_URL}"`;

const LEGACY_PROTOCOL = "2025-06-18";

function liveAccess(role: string | null, active = true) {
  return { active, role, ministries: ["worship"], managesMinistries: [] };
}

function stubEnv(env: { vercelEnv?: string; disabled?: string; secret?: string } = {}) {
  vi.stubEnv("VERCEL_ENV", env.vercelEnv ?? "preview");
  vi.stubEnv("MCP_OAUTH_SECRET", env.secret ?? SECRET);
  if (env.disabled !== undefined) vi.stubEnv("MCP_DISABLED", env.disabled);
}

/** A live grant in the in-memory dataset, created by the real grant store. */
async function liveGrant(opts: { sub?: string; origin?: string } = {}): Promise<string> {
  const created = await createGrant({ sub: opts.sub ?? MEMBER, clientId: CLIENT_ID, origin: opts.origin ?? PREVIEW_ORIGIN });
  if (!created.ok) throw new Error("fixture: grant not created");
  return created.grantId;
}

async function accessToken(
  grantId: string,
  opts: { sub?: string; origin?: string; key?: Uint8Array; now?: Date } = {},
): Promise<string> {
  const { token } = await signAccessToken({
    key: opts.key ?? KEY,
    origin: opts.origin ?? PREVIEW_ORIGIN,
    sub: opts.sub ?? MEMBER,
    grantId,
    ...(opts.now ? { now: opts.now } : {}),
  });
  return token;
}

/** An access-token-shaped JWT with hand-picked `iss`/`aud`, signed with the real key. */
function craftedAccessToken(grantId: string, claims: { iss: string; aud: string }): Promise<string> {
  return new SignJWT({ typ: "at", iss: claims.iss, aud: claims.aud, sub: MEMBER, grant: grantId, jti: "crafted" })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime("1h")
    .sign(KEY);
}

function rpc(method: string, params?: unknown, id = 1) {
  return { jsonrpc: "2.0", id, method, ...(params !== undefined ? { params } : {}) };
}

const INITIALIZE = rpc("initialize", {
  protocolVersion: LEGACY_PROTOCOL,
  capabilities: {},
  clientInfo: { name: "vitest", version: "0" },
});

interface RequestOptions {
  /** A token sent as `Authorization: Bearer <token>`. */
  token?: string;
  /** A raw `Authorization` header, verbatim (wins over `token`). */
  authorization?: string;
  host?: string;
  method?: "GET" | "POST" | "DELETE";
  /** Query string appended to the URL, e.g. `?access_token=…`. */
  search?: string;
}

function mcpRequest(body: unknown, opts: RequestOptions = {}): Request {
  const method = opts.method ?? "POST";
  const headers: Record<string, string> = {
    host: opts.host ?? PREVIEW_HOST,
    accept: "application/json, text/event-stream",
  };
  if (method === "POST") headers["content-type"] = "application/json";
  const isInitialize = typeof body === "object" && body !== null && (body as { method?: unknown }).method === "initialize";
  if (!isInitialize) headers["mcp-protocol-version"] = LEGACY_PROTOCOL;
  if (opts.authorization !== undefined) headers.authorization = opts.authorization;
  else if (opts.token !== undefined) headers.authorization = `Bearer ${opts.token}`;
  return new Request(`https://ignored.example/api/mcp${opts.search ?? ""}`, {
    method,
    headers,
    ...(method === "POST" ? { body: JSON.stringify(body) } : {}),
  });
}

function sseMessages(text: string): Record<string, unknown>[] {
  return text
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
}

/** The single JSON-RPC response carried by a 200 SSE stream. */
async function rpcResponse(res: Response): Promise<Record<string, unknown>> {
  expect(res.status).toBe(200);
  expect(res.headers.get("content-type")).toMatch(/^text\/event-stream/);
  const messages = sseMessages(await res.text());
  expect(messages).toHaveLength(1);
  return messages[0]!;
}

async function rpcResult(res: Response): Promise<Record<string, unknown>> {
  const message = await rpcResponse(res);
  expect(message.error).toBeUndefined();
  return message.result as Record<string, unknown>;
}

/** The R7 401: exact challenge, small fixed JSON body, no-store. */
async function expectUnauthorized(res: Response, cause: "no_token" | "invalid_token") {
  expect(res.status).toBe(401);
  expect(res.headers.get("www-authenticate")).toBe(cause === "no_token" ? NO_TOKEN_CHALLENGE : INVALID_TOKEN_CHALLENGE);
  expect(res.headers.get("cache-control")).toBe("no-store");
  expect(res.headers.get("content-type")).toMatch(/^application\/json/);
  expect(await res.json()).toEqual({ error: cause === "no_token" ? "unauthorized" : "invalid_token" });
}

/** Sends a tools/call for ping and asserts the request was refused before any dispatch. */
async function expectRefused(opts: RequestOptions, cause: "no_token" | "invalid_token") {
  const request = mcpRequest(rpc("tools/call", { name: "ping", arguments: {} }), opts);
  await expectUnauthorized(await POST(request), cause);
  // No principal was ever attached, so nothing downstream could have run as one.
  expect(request.auth).toBeUndefined();
}

let consoleSpies: ReturnType<typeof vi.spyOn>[];

function consoleText(): string {
  return consoleSpies
    .flatMap((spy) => spy.mock.calls.map((call: unknown[]) => call.map(String).join(" ")))
    .join("\n");
}

beforeEach(() => {
  vi.clearAllMocks();
  h.reset();
  __clearGrantCache();
  stubEnv();
  h.getMemberAccess.mockResolvedValue(liveAccess("super-admin"));
  consoleSpies = (["log", "info", "warn", "error", "debug"] as const).map((m) =>
    vi.spyOn(console, m).mockImplementation(() => {}),
  );
});

afterEach(() => {
  // Whatever happened, no token (every one of ours is a JWT: `eyJ…`) reached a log line.
  expect(consoleText()).not.toMatch(/eyJ/);
  vi.unstubAllEnvs();
  for (const spy of consoleSpies) spy.mockRestore();
});

// ── the bearer check ───────────────────────────────────────────────────────

describe("/api/mcp — no bearer token: 401 without an error code (RFC 6750 §3.1)", () => {
  it("refuses a request with no Authorization header", async () => {
    await expectRefused({}, "no_token");
    expect(h.getMemberAccess).not.toHaveBeenCalled();
  });

  it("refuses another scheme, even one carrying a valid token", async () => {
    const token = await accessToken(await liveGrant());
    await expectRefused({ authorization: "Basic dXNlcjpwYXNz" }, "no_token");
    await expectRefused({ authorization: `Token ${token}` }, "no_token");
    await expectRefused({ authorization: token }, "no_token");
  });

  it("refuses an empty bearer", async () => {
    await expectRefused({ authorization: "Bearer" }, "no_token");
    await expectRefused({ authorization: "Bearer    " }, "no_token");
    await expectRefused({ authorization: "" }, "no_token");
  });

  it("ignores a token in the query string", async () => {
    const token = await accessToken(await liveGrant());
    await expectRefused({ search: `?access_token=${token}` }, "no_token");
  });

  it("ignores a token in the body", async () => {
    const token = await accessToken(await liveGrant());
    const request = mcpRequest({ ...rpc("tools/list"), access_token: token });
    await expectUnauthorized(await POST(request), "no_token");
    expect(request.auth).toBeUndefined();
  });
});

describe("/api/mcp — an invalid token: 401 invalid_token", () => {
  it("refuses a malformed token without touching the dataset", async () => {
    const fetchSpy = vi.spyOn(h.writeClient, "fetch");
    await expectRefused({ token: "not-a-jwt" }, "invalid_token");
    await expectRefused({ token: "abc.def.ghi" }, "invalid_token");
    await expectRefused({ authorization: "Bearer two tokens" }, "invalid_token");
    await expectRefused({ authorization: "Bearer <script>" }, "invalid_token");
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(h.getMemberAccess).not.toHaveBeenCalled();
  });

  it("refuses an expired token", async () => {
    const eightDaysAgo = new Date(Date.now() - 8 * 24 * 60 * 60 * 1000);
    await expectRefused({ token: await accessToken(await liveGrant(), { now: eightDaysAgo }) }, "invalid_token");
  });

  it("refuses a token minted for the other origin's resource", async () => {
    const grantId = await liveGrant();
    await expectRefused({ token: await accessToken(grantId, { origin: PRODUCTION_ORIGIN }) }, "invalid_token");
  });

  it("refuses a wrong audience alone (right issuer, right key)", async () => {
    const token = await craftedAccessToken(await liveGrant(), { iss: PREVIEW_ORIGIN, aud: resourceFor(PRODUCTION_ORIGIN) });
    await expectRefused({ token }, "invalid_token");
  });

  it("refuses a wrong issuer alone (right audience, right key)", async () => {
    const token = await craftedAccessToken(await liveGrant(), { iss: PRODUCTION_ORIGIN, aud: resourceFor(PREVIEW_ORIGIN) });
    await expectRefused({ token }, "invalid_token");
  });

  it("control: the crafted token with the right issuer and audience IS accepted", async () => {
    const token = await craftedAccessToken(await liveGrant(), { iss: PREVIEW_ORIGIN, aud: resourceFor(PREVIEW_ORIGIN) });
    await rpcResult(await POST(mcpRequest(rpc("tools/list"), { token })));
  });

  it("refuses a refresh token, a code and a client id presented as access tokens (wrong typ)", async () => {
    const grantId = await liveGrant();
    const refresh = await signRefreshToken({ key: KEY, origin: PREVIEW_ORIGIN, sub: MEMBER, grantId, jti: "j" });
    const code = await signAuthorizationCode({
      key: KEY,
      origin: PREVIEW_ORIGIN,
      sub: MEMBER,
      clientId: CLIENT_ID,
      redirectUri: CLAUDE_AI_REDIRECT_URI,
      codeChallenge: s256Challenge("v".repeat(43)),
    });
    const clientId = await signClientId({ key: KEY, origin: PREVIEW_ORIGIN, redirectUris: [CLAUDE_AI_REDIRECT_URI] });
    await expectRefused({ token: refresh }, "invalid_token");
    await expectRefused({ token: code }, "invalid_token");
    await expectRefused({ token: clientId }, "invalid_token");
  });

  it("refuses a token signed with another secret", async () => {
    await expectRefused({ token: await accessToken(await liveGrant(), { key: OTHER_KEY }) }, "invalid_token");
  });
});

describe("/api/mcp — the grant and the live principal (spec O2, R13): 401 invalid_token", () => {
  it("refuses a revoked grant without looking up the member", async () => {
    const grantId = await liveGrant();
    const revoked = await revokeGrant(grantId, "test");
    expect(revoked.ok).toBe(true);
    await expectRefused({ token: await accessToken(grantId) }, "invalid_token");
    expect(h.getMemberAccess).not.toHaveBeenCalled();
  });

  it("refuses a missing grant", async () => {
    await expectRefused({ token: await accessToken(newGrantId()) }, "invalid_token");
    expect(h.getMemberAccess).not.toHaveBeenCalled();
  });

  it("refuses a grant whose subject is not the token's", async () => {
    const grantId = await liveGrant({ sub: "someone-else" });
    await expectRefused({ token: await accessToken(grantId, { sub: MEMBER }) }, "invalid_token");
    expect(h.getMemberAccess).not.toHaveBeenCalled();
  });

  it("refuses a grant issued on another origin", async () => {
    const id = newGrantId();
    h.docs.set(id, {
      ...buildGrantDocument({
        id,
        sub: MEMBER,
        clientId: CLIENT_ID,
        origin: PRODUCTION_ORIGIN,
        refreshJti: "j",
        createdAt: new Date().toISOString(),
      }),
      _rev: "r1",
    });
    await expectRefused({ token: await accessToken(id) }, "invalid_token");
    expect(h.getMemberAccess).not.toHaveBeenCalled();
  });

  it.each([
    ["an admin", liveAccess("admin")],
    ["a content-editor", liveAccess("content-editor")],
    ["a member", liveAccess("member")],
    ["a member with no role", liveAccess(null)],
  ])("refuses a subject demoted to %s", async (_label, access) => {
    h.getMemberAccess.mockResolvedValue(access);
    await expectRefused({ token: await accessToken(await liveGrant()) }, "invalid_token");
    expect(h.getMemberAccess).toHaveBeenCalledWith(MEMBER);
  });

  it("refuses a disabled (or deleted) subject, even one still marked super-admin", async () => {
    h.getMemberAccess.mockResolvedValue(liveAccess("super-admin", false));
    await expectRefused({ token: await accessToken(await liveGrant()) }, "invalid_token");
  });

  it("a revocation bites on the next request", async () => {
    const grantId = await liveGrant();
    const token = await accessToken(grantId);
    await rpcResult(await POST(mcpRequest(rpc("tools/list"), { token })));
    expect((await revokeGrant(grantId, "test")).ok).toBe(true);
    await expectRefused({ token }, "invalid_token");
  });

  it("serves the grant check from the 30 s cache", async () => {
    const token = await accessToken(await liveGrant());
    const fetchSpy = vi.spyOn(h.writeClient, "fetch");
    await rpcResult(await POST(mcpRequest(rpc("tools/list"), { token })));
    await rpcResult(await POST(mcpRequest(rpc("tools/list", undefined, 2), { token })));
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });
});

describe("/api/mcp — every method is authenticated", () => {
  it("answers an unauthenticated GET and DELETE with 401, not 405", async () => {
    await expectUnauthorized(await GET(mcpRequest(undefined, { method: "GET" })), "no_token");
    await expectUnauthorized(await DELETE(mcpRequest(undefined, { method: "DELETE" })), "no_token");
    await expectUnauthorized(await GET(mcpRequest(undefined, { method: "GET", token: "not-a-jwt" })), "invalid_token");
  });

  it("only an authenticated GET reaches the handler, which answers 405 in stateless mode", async () => {
    const token = await accessToken(await liveGrant());
    const res = await GET(mcpRequest(undefined, { method: "GET", token }));
    expect(res.status).toBe(405);
  });

  it("exports only GET, POST and DELETE plus the route config", () => {
    expect(Object.keys(mcpRoute).sort()).toEqual(["DELETE", "GET", "POST", "dynamic", "revalidate"]);
    expect(mcpRoute.dynamic).toBe("force-dynamic");
  });
});

// ── the preflight ──────────────────────────────────────────────────────────

describe("/api/mcp — the preflight runs first", () => {
  it("the kill switch answers 503 on POST and GET, even with a valid token", async () => {
    const token = await accessToken(await liveGrant());
    stubEnv({ disabled: "1" });
    const fetchSpy = vi.spyOn(h.writeClient, "fetch");
    for (const res of [
      await POST(mcpRequest(rpc("tools/list"), { token })),
      await GET(mcpRequest(undefined, { method: "GET", token })),
      await POST(mcpRequest(rpc("tools/list"))),
    ]) {
      expect(res.status).toBe(503);
      expect(res.headers.get("cache-control")).toBe("no-store");
      expect(res.headers.get("www-authenticate")).toBeNull();
      expect(await res.json()).toEqual({ error: "temporarily_unavailable" });
    }
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(h.getMemberAccess).not.toHaveBeenCalled();
  });

  it("a non-canonical host answers 404, even with a valid token", async () => {
    const token = await accessToken(await liveGrant());
    for (const host of [PRODUCTION_HOST, "owt-backstage-abc123.vercel.app", "localhost:3000"]) {
      const res = await POST(mcpRequest(rpc("tools/list"), { token, host }));
      expect(res.status).toBe(404);
      expect(res.headers.get("www-authenticate")).toBeNull();
      expect(await res.json()).toEqual({ error: "not_found" });
    }
  });

  it("a missing or short signing secret answers 503", async () => {
    stubEnv({ secret: "short" });
    const res = await POST(mcpRequest(rpc("tools/list")));
    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({ error: "temporarily_unavailable" });
  });
});

// ── an authenticated request ───────────────────────────────────────────────

describe("/api/mcp — a valid token reaches the MCP server", () => {
  it("initialize reports owt-backstage at the deployed commit", async () => {
    const token = await accessToken(await liveGrant());
    const result = await rpcResult(await POST(mcpRequest(INITIALIZE, { token })));
    expect(result.protocolVersion).toBe(LEGACY_PROTOCOL);
    expect(result.serverInfo).toMatchObject({ name: "owt-backstage", version: VERSION });
    expect(result.capabilities).toHaveProperty("tools");
  });

  it("tools/list shows exactly one tool, ping: read-only, strict, described in Spanish", async () => {
    const token = await accessToken(await liveGrant());
    const result = await rpcResult(await POST(mcpRequest(rpc("tools/list"), { token })));
    const tools = result.tools as Record<string, unknown>[];
    expect(tools).toHaveLength(1);
    const [ping] = tools;
    expect(ping!.name).toBe("ping");
    expect(ping!.annotations).toEqual({ readOnlyHint: true });
    expect(ping!.inputSchema).toMatchObject({ type: "object", properties: {}, additionalProperties: false });
    expect(ping!.title).toMatch(/conexión/i);
    expect(ping!.description).toMatch(/America\/Mexico_City/);
  });

  it("tools/call ping returns { ok, server, version, now } with now in Mexico City time", async () => {
    const token = await accessToken(await liveGrant());
    const before = Date.now();
    const result = await rpcResult(await POST(mcpRequest(rpc("tools/call", { name: "ping", arguments: {} }), { token })));
    const after = Date.now();

    expect(result.isError).toBeFalsy();
    const content = result.content as { type: string; text: string }[];
    expect(content).toHaveLength(1);
    expect(content[0]!.type).toBe("text");
    const payload = JSON.parse(content[0]!.text) as Record<string, unknown>;
    expect(Object.keys(payload).sort()).toEqual(["now", "ok", "server", "version"]);
    expect(payload).toMatchObject({ ok: true, server: "owt-backstage", version: VERSION });
    expect(result.structuredContent).toEqual(payload);

    // `now`: ISO-8601 with an explicit offset, the instant of the call…
    const now = payload.now as string;
    expect(now).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}[+-]\d{2}:\d{2}$/);
    const instant = Date.parse(now);
    expect(instant).toBeGreaterThanOrEqual(Math.floor(before / 1000) * 1000);
    expect(instant).toBeLessThanOrEqual(after);
    // …whose offset is Mexico City's at that instant, by an independent computation…
    const zone = new Intl.DateTimeFormat("en-US", { timeZone: "America/Mexico_City", timeZoneName: "longOffset" })
      .formatToParts(new Date(instant))
      .find((part) => part.type === "timeZoneName")!.value;
    expect("GMT" + now.slice(19)).toBe(zone === "GMT" ? "GMT+00:00" : zone);
    // …and whose wall clock is Mexico City's.
    expect(now.slice(0, 19).replace("T", " ")).toBe(
      new Date(instant).toLocaleString("sv", { timeZone: "America/Mexico_City" }),
    );
  });

  it("tools/call ping without an arguments member is the same call", async () => {
    const token = await accessToken(await liveGrant());
    const result = await rpcResult(await POST(mcpRequest(rpc("tools/call", { name: "ping" }), { token })));
    expect(result.isError).toBeFalsy();
  });

  it("refuses any argument to ping as a tool error (I13)", async () => {
    const token = await accessToken(await liveGrant());
    const result = await rpcResult(
      await POST(mcpRequest(rpc("tools/call", { name: "ping", arguments: { extra: "x" } }), { token })),
    );
    expect(result.isError).toBe(true);
    expect(result.structuredContent).toBeUndefined();
    expect(JSON.stringify(result.content)).not.toMatch(/owt-backstage|"ok"/);
  });

  it("accepts the Bearer scheme case-insensitively", async () => {
    const token = await accessToken(await liveGrant());
    for (const scheme of ["bearer", "BEARER", "BeArEr"]) {
      await rpcResult(await POST(mcpRequest(rpc("tools/list"), { authorization: `${scheme} ${token}` })));
    }
  });

  it("hands the tools the verified principal, never the raw token", async () => {
    const grantId = await liveGrant();
    const token = await accessToken(grantId);
    const request = mcpRequest(rpc("tools/list"), { token });
    await rpcResult(await POST(request));

    const auth = request.auth;
    expect(auth).toBeDefined();
    expect(auth!.clientId).toBe(clientHashOf(CLIENT_ID));
    expect(auth!.scopes).toEqual([]);
    expect(auth!.extra).toEqual({ sub: MEMBER, grantId });
    expect(auth!.resource?.href).toBe(resourceFor(PREVIEW_ORIGIN));
    expect(auth!.resourceMetadataUrl).toBe(METADATA_URL);
    expect(typeof auth!.expiresAt).toBe("number");
    expect(auth!.token).not.toBe(token);
    expect(JSON.stringify(auth)).not.toContain(token);
  });

  it("logs nothing on success", async () => {
    const token = await accessToken(await liveGrant());
    await rpcResult(await POST(mcpRequest(rpc("tools/call", { name: "ping" }), { token })));
    for (const spy of consoleSpies) expect(spy).not.toHaveBeenCalled();
  });
});

// ── failures ───────────────────────────────────────────────────────────────

describe("/api/mcp — a server failure is a fixed 500 and never echoes (E1)", () => {
  async function expectServerError(res: Response) {
    expect(res.status).toBe(500);
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(res.headers.get("www-authenticate")).toBeNull();
    const text = await res.text();
    expect(JSON.parse(text)).toEqual({ error: "server_error" });
  }

  it("a failed grant read is a 500, not a 401 (the token is not at fault), and dispatches nothing", async () => {
    const token = await accessToken(await liveGrant());
    h.failNext.fetch = Object.assign(new Error("Sanity said: internal detail"), { statusCode: 502 });
    const request = mcpRequest(rpc("tools/list"), { token });
    await expectServerError(await POST(request));
    expect(request.auth).toBeUndefined();
    expect(h.getMemberAccess).not.toHaveBeenCalled();
    expect(consoleText()).not.toMatch(/internal detail/);
  });

  it("a failed member lookup is a 500 and dispatches nothing", async () => {
    const token = await accessToken(await liveGrant());
    h.getMemberAccess.mockRejectedValue(new Error("Sanity said: internal detail"));
    const request = mcpRequest(rpc("tools/list"), { token });
    await expectServerError(await POST(request));
    expect(request.auth).toBeUndefined();
    expect(consoleText()).not.toMatch(/internal detail/);
  });

  it("an unexpected throw is a fixed 500; the error is neither echoed nor logged", async () => {
    const token = await accessToken(await liveGrant());
    const request = mcpRequest(rpc("tools/list"), { token });
    const realGet = request.headers.get.bind(request.headers);
    vi.spyOn(request.headers, "get").mockImplementation((name: string) => {
      if (name.toLowerCase() === "authorization") throw new Error("internal detail");
      return realGet(name);
    });
    await expectServerError(await POST(request));
    expect(request.auth).toBeUndefined();
    expect(consoleText()).not.toMatch(/internal detail/);
  });
});
