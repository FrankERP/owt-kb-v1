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
  return {
    ...createInMemorySanity(),
    getMemberAccess: vi.fn(),
    /** Every request the route handed to the MCP handler, in order. */
    forwarded: [] as Request[],
    /** When on, each per-request server also gets a test-only `probe` tool (see the mcp-handler mock). */
    probe: { enabled: false },
  };
});

vi.mock("@/app/utils/memberAccess", () => ({ getMemberAccess: (id: string) => h.getMemberAccess(id) }));
vi.mock("@/sanity/lib/serverClient", () => ({ writeClient: h.writeClient, serverClient: { fetch: vi.fn() } }));

// The REAL mcp-handler, observed: the wrapper records every request the route
// forwards (so a refusal can assert the handler was never called at all), and
// can add a test-only `probe` tool that reports what a tool actually sees —
// `ctx.http.req`'s Authorization header and `ctx.http.authInfo`. The init runs
// per request, so the probe exists only in the tests that switch it on.
vi.mock("mcp-handler", async (importOriginal) => {
  const actual = await importOriginal<typeof import("mcp-handler")>();
  const { z } = await import("zod");
  return {
    ...actual,
    createMcpHandler: (...[init, options]: Parameters<typeof actual.createMcpHandler>) => {
      const handler = actual.createMcpHandler(async (server) => {
        await init(server);
        if (!h.probe.enabled) return;
        server.registerTool(
          "probe",
          { inputSchema: z.object({}).strict(), annotations: { readOnlyHint: true } },
          async (_args, ctx) => ({
            content: [
              {
                type: "text",
                text: JSON.stringify({
                  authorization: ctx.http?.req?.headers.get("authorization") ?? null,
                  authInfo: ctx.http?.authInfo ?? null,
                }),
              },
            ],
          }),
        );
      }, options);
      return async (request: Request) => {
        h.forwarded.push(request);
        return handler(request);
      };
    },
  };
});

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
const MODERN_PROTOCOL = "2026-07-28";

/** The 2026-07-28 per-request envelope: the two REQUIRED `_meta` keys, plus clientInfo (SHOULD). */
const MODERN_META = {
  "io.modelcontextprotocol/protocolVersion": MODERN_PROTOCOL,
  "io.modelcontextprotocol/clientCapabilities": {},
  "io.modelcontextprotocol/clientInfo": { name: "vitest", version: "0" },
};

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

/**
 * A 2026-07-28 request: the envelope rides in `params._meta`, and the SDK
 * requires `MCP-Protocol-Version`, `Mcp-Method` and — for a named target like
 * `tools/call` — an `Mcp-Name` equal to `params.name`.
 */
function modernRequest(
  method: string,
  params: Record<string, unknown>,
  opts: { token?: string; name?: string; id?: number } = {},
): Request {
  const headers: Record<string, string> = {
    host: PREVIEW_HOST,
    accept: "application/json, text/event-stream",
    "content-type": "application/json",
    "mcp-protocol-version": MODERN_PROTOCOL,
    "mcp-method": method,
  };
  if (opts.name !== undefined) headers["mcp-name"] = opts.name;
  if (opts.token !== undefined) headers.authorization = `Bearer ${opts.token}`;
  return new Request("https://ignored.example/api/mcp", {
    method: "POST",
    headers,
    body: JSON.stringify({ jsonrpc: "2.0", id: opts.id ?? 1, method, params: { ...params, _meta: MODERN_META } }),
  });
}

/** The modern era answers a plain JSON-RPC body, not an SSE stream. */
async function modernResult(res: Response): Promise<Record<string, unknown>> {
  expect(res.status).toBe(200);
  expect(res.headers.get("content-type")).toMatch(/^application\/json/);
  const message = (await res.json()) as Record<string, unknown>;
  expect(message.error).toBeUndefined();
  return message.result as Record<string, unknown>;
}

/**
 * Reads a response body for at most `ms`. `done: false` means the server was
 * still holding the stream open — it is then cancelled, so a held stream
 * cannot keep the suite alive.
 */
async function readWithin(res: Response, ms: number): Promise<{ done: boolean; text: string }> {
  const reader = res.body!.getReader();
  const decoder = new TextDecoder();
  const deadline = Date.now() + ms;
  let text = "";
  for (;;) {
    const remaining = deadline - Date.now();
    if (remaining <= 0) break;
    const chunk = await Promise.race([
      reader.read(),
      new Promise<"timeout">((resolve) => setTimeout(() => resolve("timeout"), remaining)),
    ]);
    if (chunk === "timeout") break;
    if (chunk.done) return { done: true, text };
    text += decoder.decode(chunk.value);
  }
  await reader.cancel();
  return { done: false, text };
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
  const forwardedBefore = h.forwarded.length;
  await expectUnauthorized(await POST(mcpRequest(rpc("tools/call", { name: "ping", arguments: {} }), opts)), cause);
  // The MCP handler was not called for this request: nothing downstream could have run.
  expect(h.forwarded).toHaveLength(forwardedBefore);
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
  h.forwarded.length = 0;
  h.probe.enabled = false;
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
    expect(h.forwarded).toHaveLength(0);
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
    // Tools, but no list-changed notifications: nothing here holds a stream open.
    expect(result.capabilities).toMatchObject({ tools: { listChanged: false } });
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

  it("forwards a copy WITHOUT Authorization that carries the verified principal, never the raw token", async () => {
    const grantId = await liveGrant();
    const token = await accessToken(grantId);
    const request = mcpRequest(rpc("tools/list"), { token });
    // The body really moved to the copy: the handler parsed it and answered.
    const result = await rpcResult(await POST(request));
    expect(result.tools).toHaveLength(1);

    expect(h.forwarded).toHaveLength(1);
    const forwarded = h.forwarded[0]!;
    expect(forwarded).not.toBe(request);
    expect(forwarded.headers.get("authorization")).toBeNull();
    // Positive control: the caller's request did carry the header.
    expect(request.headers.get("authorization")).toBe(`Bearer ${token}`);
    // Everything else the SDK routes on survives the copy.
    expect(forwarded.method).toBe("POST");
    expect(forwarded.headers.get("content-type")).toBe("application/json");
    expect(forwarded.headers.get("accept")).toBe("application/json, text/event-stream");
    expect(forwarded.headers.get("mcp-protocol-version")).toBe(LEGACY_PROTOCOL);
    // The principal rides on the copy only; the caller's request is never touched.
    expect(request.auth).toBeUndefined();

    const auth = forwarded.auth;
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

  it("a tool sees no Authorization header, only the principal — on both protocol eras", async () => {
    h.probe.enabled = true;
    const grantId = await liveGrant();
    const token = await accessToken(grantId);
    const legacy = await rpcResult(
      await POST(mcpRequest(rpc("tools/call", { name: "probe", arguments: {} }), { token })),
    );
    const modern = await modernResult(
      await POST(modernRequest("tools/call", { name: "probe", arguments: {} }, { token, name: "probe" })),
    );
    for (const result of [legacy, modern]) {
      expect(result.isError).toBeFalsy();
      const text = (result.content as { text: string }[])[0]!.text;
      expect(text).not.toContain(token);
      const seen = JSON.parse(text) as { authorization: string | null; authInfo: Record<string, unknown> | null };
      expect(seen.authorization).toBeNull();
      expect(seen.authInfo).toMatchObject({ clientId: clientHashOf(CLIENT_ID), extra: { sub: MEMBER, grantId } });
    }
  });

  it("serves a streamed body inside a NextRequest (what Next hands the route) through the copy", async () => {
    const { NextRequest } = await import("next/server");
    const token = await accessToken(await liveGrant());
    const bytes = new TextEncoder().encode(JSON.stringify(rpc("tools/call", { name: "ping" })));
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(bytes.slice(0, 10));
        controller.enqueue(bytes.slice(10));
        controller.close();
      },
    });
    const request = new NextRequest("https://ignored.example/api/mcp", {
      method: "POST",
      headers: {
        host: PREVIEW_HOST,
        accept: "application/json, text/event-stream",
        "content-type": "application/json",
        "mcp-protocol-version": LEGACY_PROTOCOL,
        authorization: `Bearer ${token}`,
      },
      body,
      duplex: "half",
    } as ConstructorParameters<typeof NextRequest>[1]);
    const result = await rpcResult(await POST(request));
    expect(result.isError).toBeFalsy();
    expect(result.structuredContent).toMatchObject({ ok: true, server: "owt-backstage" });
    expect(h.forwarded[0]!.headers.get("authorization")).toBeNull();
  });

  it("logs nothing on success", async () => {
    const token = await accessToken(await liveGrant());
    await rpcResult(await POST(mcpRequest(rpc("tools/call", { name: "ping" }), { token })));
    for (const spy of consoleSpies) expect(spy).not.toHaveBeenCalled();
  });
});

// ── the 2026-07-28 era ─────────────────────────────────────────────────────

describe("/api/mcp — the 2026-07-28 envelope, authenticated", () => {
  it("tools/call ping returns the same payload as on the 2025 path", async () => {
    const token = await accessToken(await liveGrant());
    const result = await modernResult(
      await POST(modernRequest("tools/call", { name: "ping", arguments: {} }, { token, name: "ping" })),
    );
    expect(result.isError).toBeFalsy();
    expect(result.resultType).toBe("complete");
    const content = result.content as { type: string; text: string }[];
    const payload = JSON.parse(content[0]!.text) as Record<string, unknown>;
    expect(Object.keys(payload).sort()).toEqual(["now", "ok", "server", "version"]);
    expect(payload).toMatchObject({ ok: true, server: "owt-backstage", version: VERSION });
    expect(payload.now).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}[+-]\d{2}:\d{2}$/);
    expect(result.structuredContent).toEqual(payload);
  });

  it("refuses an argument to ping there too", async () => {
    const token = await accessToken(await liveGrant());
    const result = await modernResult(
      await POST(modernRequest("tools/call", { name: "ping", arguments: { extra: "x" } }, { token, name: "ping" })),
    );
    expect(result.isError).toBe(true);
    expect(result.structuredContent).toBeUndefined();
  });

  it("server/discover advertises tools without list-changed notifications", async () => {
    const token = await accessToken(await liveGrant());
    const result = await modernResult(await POST(modernRequest("server/discover", {}, { token })));
    expect(result.capabilities).toMatchObject({ tools: { listChanged: false } });
  });
});

describe("/api/mcp — no stream outlives the request that was checked (O2/O9)", () => {
  it("refuses an authenticated subscriptions/listen with a completed JSON-RPC error, never an open SSE stream", async () => {
    const token = await accessToken(await liveGrant());
    const res = await POST(
      modernRequest("subscriptions/listen", { notifications: { toolsListChanged: true } }, { token, id: 9 }),
    );
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toMatch(/^application\/json/);
    expect(res.headers.get("content-type")).not.toMatch(/event-stream/);
    const { done, text } = await readWithin(res, 1000);
    expect(done).toBe(true);
    const message = JSON.parse(text) as { id: unknown; result?: unknown; error?: { code: number } };
    expect(message.id).toBe(9);
    expect(message.result).toBeUndefined();
    expect(message.error?.code).toBe(-32603);
  });

  it("refuses an unauthenticated subscriptions/listen before the handler", async () => {
    const res = await POST(modernRequest("subscriptions/listen", { notifications: { toolsListChanged: true } }));
    await expectUnauthorized(res, "no_token");
    expect(h.forwarded).toHaveLength(0);
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
    expect(h.forwarded).toHaveLength(0);
    expect(h.getMemberAccess).not.toHaveBeenCalled();
    expect(consoleText()).not.toMatch(/internal detail/);
  });

  it("a failed member lookup is a 500 and dispatches nothing", async () => {
    const token = await accessToken(await liveGrant());
    h.getMemberAccess.mockRejectedValue(new Error("Sanity said: internal detail"));
    const request = mcpRequest(rpc("tools/list"), { token });
    await expectServerError(await POST(request));
    expect(h.forwarded).toHaveLength(0);
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
    expect(h.forwarded).toHaveLength(0);
    expect(consoleText()).not.toMatch(/internal detail/);
  });
});
