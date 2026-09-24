// `POST /api/oauth/register` (RFC 7591, stateless DCR) — P0 plan step 6.
//
// This is the first route that accepts input from anyone on the internet
// without a session, so the tests lean on the exact wording of the brief: the
// allowlist per environment, the body-size cap on BYTES ACTUALLY READ (not
// only a declared Content-Length), the refused-redirect log predicate (R11),
// and the "writes nothing" contract — `sanity/lib/serverClient` is mocked and
// asserted never called.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const writeClientCreate = vi.fn();
const writeClientPatch = vi.fn();
const serverClientFetch = vi.fn();

vi.mock("@/sanity/lib/serverClient", () => ({
  writeClient: { create: writeClientCreate, patch: writeClientPatch },
  serverClient: { fetch: serverClientFetch },
}));

import { POST } from "@/app/api/oauth/register/route";
import { verifyClientId } from "@/app/mcp/oauth/tokens";
import { CLAUDE_AI_REDIRECT_URI } from "@/app/mcp/oauth/redirects";

const SECRET = "s".repeat(32);
const KEY = new TextEncoder().encode(SECRET);

const PRODUCTION_ORIGIN = "https://owt-backstage.vercel.app";
const PREVIEW_ORIGIN = "https://dev-owt-backstage.vercel.app";

const LOOPBACK_URI = "http://127.0.0.1:51004/callback";

interface ReqOptions {
  host?: string;
  body?: string;
  contentType?: string | null; // null omits the header entirely
  contentLength?: string; // explicit override, independent of the real body
}

function req({ host = "dev-owt-backstage.vercel.app", body, contentType, contentLength }: ReqOptions = {}): Request {
  const headers: Record<string, string> = { host };
  if (contentType !== null) headers["content-type"] = contentType ?? "application/json";
  if (contentLength !== undefined) headers["content-length"] = contentLength;
  return new Request("https://ignored.example/api/oauth/register", {
    method: "POST",
    headers,
    body,
  });
}

/** `secret: null` means "explicitly missing"; an omitted `secret` defaults to a valid one. */
function stubEnv(env: { vercelEnv?: string; secret?: string | null; disabled?: string }) {
  vi.stubEnv("VERCEL_ENV", env.vercelEnv);
  vi.stubEnv("MCP_OAUTH_SECRET", env.secret === null ? undefined : (env.secret ?? SECRET));
  if (env.disabled !== undefined) vi.stubEnv("MCP_DISABLED", env.disabled);
}

/** A JSON registration body of an exact byte length (ASCII only, so chars === bytes). */
function jsonBodyOfLength(byteLength: number, redirectUris: string[]): string {
  const baseline = JSON.stringify({ redirect_uris: redirectUris, padding: "" });
  const deficit = byteLength - baseline.length;
  if (deficit < 0) throw new Error(`target ${byteLength} is smaller than the unpadded baseline ${baseline.length}`);
  return JSON.stringify({ redirect_uris: redirectUris, padding: "x".repeat(deficit) });
}

let warnSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  writeClientCreate.mockClear();
  writeClientPatch.mockClear();
  serverClientFetch.mockClear();
  warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
});

afterEach(() => {
  vi.unstubAllEnvs();
  warnSpy.mockRestore();
});

describe("POST /api/oauth/register — allowlisted redirect_uris accepted", () => {
  it("production accepts only the claude callback", async () => {
    stubEnv({ vercelEnv: "production" });
    const res = await POST(req({ host: "owt-backstage.vercel.app", body: JSON.stringify({ redirect_uris: [CLAUDE_AI_REDIRECT_URI] }) }));
    expect(res.status).toBe(201);
  });

  it("production refuses a loopback redirect_uri", async () => {
    stubEnv({ vercelEnv: "production" });
    const res = await POST(req({ host: "owt-backstage.vercel.app", body: JSON.stringify({ redirect_uris: [LOOPBACK_URI] }) }));
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "invalid_redirect_uri" });
  });

  it("preview accepts the claude callback and a loopback redirect_uri", async () => {
    stubEnv({ vercelEnv: "preview" });
    for (const uri of [CLAUDE_AI_REDIRECT_URI, LOOPBACK_URI]) {
      const res = await POST(req({ host: "dev-owt-backstage.vercel.app", body: JSON.stringify({ redirect_uris: [uri] }) }));
      expect(res.status, uri).toBe(201);
    }
  });

  it("local accepts the claude callback and a loopback redirect_uri", async () => {
    stubEnv({});
    for (const uri of [CLAUDE_AI_REDIRECT_URI, LOOPBACK_URI]) {
      const res = await POST(req({ host: "localhost:3000", body: JSON.stringify({ redirect_uris: [uri] }) }));
      expect(res.status, uri).toBe(201);
    }
  });

  it("a foreign URI is refused on every environment", async () => {
    stubEnv({ vercelEnv: "preview" });
    const res = await POST(req({ body: JSON.stringify({ redirect_uris: ["https://evil.example/cb"] }) }));
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "invalid_redirect_uri" });
  });
});

describe("POST /api/oauth/register — the returned client_id", () => {
  it("verifies with verifyClientId and carries the URIs, name and iss = origin", async () => {
    stubEnv({ vercelEnv: "preview" });
    const redirectUris = [CLAUDE_AI_REDIRECT_URI, LOOPBACK_URI];
    const res = await POST(
      req({ body: JSON.stringify({ redirect_uris: redirectUris, client_name: "Dev Verifier" }) }),
    );
    expect(res.status).toBe(201);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body.redirect_uris).toEqual(redirectUris);
    expect(body.client_name).toBe("Dev Verifier");
    expect(body.token_endpoint_auth_method).toBe("none");
    expect(body.grant_types).toEqual(["authorization_code", "refresh_token"]);
    expect(body.response_types).toEqual(["code"]);
    expect(typeof body.client_id_issued_at).toBe("number");

    const verified = await verifyClientId(body.client_id, { key: KEY, origin: PREVIEW_ORIGIN });
    expect(verified.ok).toBe(true);
    if (!verified.ok) throw new Error("unreachable");
    expect(verified.claims.redirectUris).toEqual(redirectUris);
    expect(verified.claims.clientName).toBe("Dev Verifier");
    expect(verified.claims.issuedAt).toBe(body.client_id_issued_at);

    // A token minted for a DIFFERENT origin never verifies here — proves `iss`
    // is bound to the resolving origin, not reusable across deployments.
    const wrongOrigin = await verifyClientId(body.client_id, { key: KEY, origin: PRODUCTION_ORIGIN });
    expect(wrongOrigin.ok).toBe(false);
  });

  it("omits client_name from the response and signs no clientName claim when absent", async () => {
    stubEnv({ vercelEnv: "preview" });
    const res = await POST(req({ body: JSON.stringify({ redirect_uris: [CLAUDE_AI_REDIRECT_URI] }) }));
    const body = (await res.json()) as Record<string, unknown>;
    expect("client_name" in body).toBe(false);
    const verified = await verifyClientId(body.client_id, { key: KEY, origin: PREVIEW_ORIGIN });
    expect(verified.ok).toBe(true);
    if (!verified.ok) throw new Error("unreachable");
    expect(verified.claims.clientName).toBeNull();
  });

  it("ignores unknown request members and never echoes them", async () => {
    stubEnv({ vercelEnv: "preview" });
    const res = await POST(
      req({ body: JSON.stringify({ redirect_uris: [CLAUDE_AI_REDIRECT_URI], scope: "everything", logo_uri: "https://evil.example/x" }) }),
    );
    expect(res.status).toBe(201);
    const body = (await res.json()) as Record<string, unknown>;
    expect("scope" in body).toBe(false);
    expect("logo_uri" in body).toBe(false);
  });
});

describe("POST /api/oauth/register — never writes", () => {
  it("writeClient and serverClient are never touched, on success or refusal", async () => {
    stubEnv({ vercelEnv: "preview" });
    await POST(req({ body: JSON.stringify({ redirect_uris: [CLAUDE_AI_REDIRECT_URI] }) }));
    await POST(req({ body: JSON.stringify({ redirect_uris: ["https://evil.example/cb"] }) }));
    await POST(req({ body: "not json" }));
    expect(writeClientCreate).not.toHaveBeenCalled();
    expect(writeClientPatch).not.toHaveBeenCalled();
    expect(serverClientFetch).not.toHaveBeenCalled();
  });
});

describe("POST /api/oauth/register — body handling", () => {
  it("a wrong Content-Type is refused", async () => {
    stubEnv({ vercelEnv: "preview" });
    const res = await POST(
      req({ contentType: "text/plain", body: JSON.stringify({ redirect_uris: [CLAUDE_AI_REDIRECT_URI] }) }),
    );
    expect(res.status).toBe(400);
    expect((await res.json()) as Record<string, unknown>).toMatchObject({ error: "invalid_client_metadata" });
  });

  it("a missing Content-Type is refused", async () => {
    stubEnv({ vercelEnv: "preview" });
    const res = await POST(
      req({ contentType: null, body: JSON.stringify({ redirect_uris: [CLAUDE_AI_REDIRECT_URI] }) }),
    );
    expect(res.status).toBe(400);
    expect((await res.json()) as Record<string, unknown>).toMatchObject({ error: "invalid_client_metadata" });
  });

  it("malformed JSON is refused", async () => {
    stubEnv({ vercelEnv: "preview" });
    const res = await POST(req({ body: "{ this is not json" }));
    expect(res.status).toBe(400);
    expect((await res.json()) as Record<string, unknown>).toMatchObject({ error: "invalid_client_metadata" });
  });

  it("a JSON array body (not an object) is refused", async () => {
    stubEnv({ vercelEnv: "preview" });
    const res = await POST(req({ body: JSON.stringify([1, 2, 3]) }));
    expect(res.status).toBe(400);
    expect((await res.json()) as Record<string, unknown>).toMatchObject({ error: "invalid_client_metadata" });
  });

  it("an oversized body is refused via a declared Content-Length", async () => {
    stubEnv({ vercelEnv: "preview" });
    const res = await POST(
      req({
        body: JSON.stringify({ redirect_uris: [CLAUDE_AI_REDIRECT_URI] }),
        contentLength: String(4096 * 4),
      }),
    );
    expect(res.status).toBe(400);
    expect((await res.json()) as Record<string, unknown>).toMatchObject({ error: "invalid_client_metadata" });
    expect(writeClientCreate).not.toHaveBeenCalled();
  });

  it("an oversized body is refused via the bytes actually read, with no declared length", async () => {
    stubEnv({ vercelEnv: "preview" });
    const res = await POST(req({ body: jsonBodyOfLength(4096 * 4, [CLAUDE_AI_REDIRECT_URI]) }));
    expect(res.status).toBe(400);
    expect((await res.json()) as Record<string, unknown>).toMatchObject({ error: "invalid_client_metadata" });
  });

  it("the 4 KB boundary: exactly 4096 bytes is accepted", async () => {
    stubEnv({ vercelEnv: "preview" });
    const body = jsonBodyOfLength(4096, [CLAUDE_AI_REDIRECT_URI]);
    expect(new TextEncoder().encode(body).byteLength).toBe(4096);
    const res = await POST(req({ body }));
    expect(res.status).toBe(201);
  });

  it("the 4 KB boundary: 4097 bytes is refused", async () => {
    stubEnv({ vercelEnv: "preview" });
    const body = jsonBodyOfLength(4097, [CLAUDE_AI_REDIRECT_URI]);
    expect(new TextEncoder().encode(body).byteLength).toBe(4097);
    const res = await POST(req({ body }));
    expect(res.status).toBe(400);
    expect((await res.json()) as Record<string, unknown>).toMatchObject({ error: "invalid_client_metadata" });
  });
});

describe("POST /api/oauth/register — redirect_uris shape", () => {
  it("0 redirect_uris is refused as invalid_client_metadata", async () => {
    stubEnv({ vercelEnv: "preview" });
    const res = await POST(req({ body: JSON.stringify({ redirect_uris: [] }) }));
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual(expect.objectContaining({ error: "invalid_client_metadata" }));
  });

  it("6 redirect_uris is refused as invalid_client_metadata (before URI validation)", async () => {
    stubEnv({ vercelEnv: "preview" });
    const res = await POST(
      req({ body: JSON.stringify({ redirect_uris: Array(6).fill(CLAUDE_AI_REDIRECT_URI) }) }),
    );
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual(expect.objectContaining({ error: "invalid_client_metadata" }));
  });

  it("a non-array redirect_uris is refused", async () => {
    stubEnv({ vercelEnv: "preview" });
    const res = await POST(req({ body: JSON.stringify({ redirect_uris: CLAUDE_AI_REDIRECT_URI }) }));
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual(expect.objectContaining({ error: "invalid_client_metadata" }));
  });

  it("a redirect_uris array with a non-string entry is refused", async () => {
    stubEnv({ vercelEnv: "preview" });
    const res = await POST(req({ body: JSON.stringify({ redirect_uris: [CLAUDE_AI_REDIRECT_URI, 42] }) }));
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual(expect.objectContaining({ error: "invalid_client_metadata" }));
  });

  it("missing redirect_uris is refused", async () => {
    stubEnv({ vercelEnv: "preview" });
    const res = await POST(req({ body: JSON.stringify({}) }));
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual(expect.objectContaining({ error: "invalid_client_metadata" }));
  });
});

describe("POST /api/oauth/register — token_endpoint_auth_method", () => {
  it('"none" is accepted', async () => {
    stubEnv({ vercelEnv: "preview" });
    const res = await POST(
      req({ body: JSON.stringify({ redirect_uris: [CLAUDE_AI_REDIRECT_URI], token_endpoint_auth_method: "none" }) }),
    );
    expect(res.status).toBe(201);
  });

  it('"client_secret_basic" is refused', async () => {
    stubEnv({ vercelEnv: "preview" });
    const res = await POST(
      req({
        body: JSON.stringify({
          redirect_uris: [CLAUDE_AI_REDIRECT_URI],
          token_endpoint_auth_method: "client_secret_basic",
        }),
      }),
    );
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual(expect.objectContaining({ error: "invalid_client_metadata" }));
  });
});

describe("POST /api/oauth/register — grant_types / response_types (R14)", () => {
  it("their CONTENT is never rejected — the 201 states what the server supports, not what was sent", async () => {
    stubEnv({ vercelEnv: "preview" });
    const res = await POST(
      req({
        body: JSON.stringify({
          redirect_uris: [CLAUDE_AI_REDIRECT_URI],
          grant_types: ["password", "implicit"],
          response_types: ["token"],
        }),
      }),
    );
    expect(res.status).toBe(201);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body.grant_types).toEqual(["authorization_code", "refresh_token"]);
    expect(body.response_types).toEqual(["code"]);
  });

  it("a non-array grant_types is refused (shape only)", async () => {
    stubEnv({ vercelEnv: "preview" });
    const res = await POST(
      req({ body: JSON.stringify({ redirect_uris: [CLAUDE_AI_REDIRECT_URI], grant_types: "authorization_code" }) }),
    );
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual(expect.objectContaining({ error: "invalid_client_metadata" }));
  });

  it("a response_types array with a non-string entry is refused (shape only)", async () => {
    stubEnv({ vercelEnv: "preview" });
    const res = await POST(
      req({ body: JSON.stringify({ redirect_uris: [CLAUDE_AI_REDIRECT_URI], response_types: [1] }) }),
    );
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual(expect.objectContaining({ error: "invalid_client_metadata" }));
  });
});

describe("POST /api/oauth/register — client_name", () => {
  it("a control character is refused", async () => {
    stubEnv({ vercelEnv: "preview" });
    const res = await POST(
      req({ body: JSON.stringify({ redirect_uris: [CLAUDE_AI_REDIRECT_URI], client_name: "evil\nname" }) }),
    );
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual(expect.objectContaining({ error: "invalid_client_metadata" }));
  });

  it("more than 200 characters is refused", async () => {
    stubEnv({ vercelEnv: "preview" });
    const res = await POST(
      req({ body: JSON.stringify({ redirect_uris: [CLAUDE_AI_REDIRECT_URI], client_name: "a".repeat(201) }) }),
    );
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual(expect.objectContaining({ error: "invalid_client_metadata" }));
  });

  it("exactly 200 characters is accepted", async () => {
    stubEnv({ vercelEnv: "preview" });
    const res = await POST(
      req({ body: JSON.stringify({ redirect_uris: [CLAUDE_AI_REDIRECT_URI], client_name: "a".repeat(200) }) }),
    );
    expect(res.status).toBe(201);
  });

  it("a non-string client_name is refused", async () => {
    stubEnv({ vercelEnv: "preview" });
    const res = await POST(
      req({ body: JSON.stringify({ redirect_uris: [CLAUDE_AI_REDIRECT_URI], client_name: 42 }) }),
    );
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual(expect.objectContaining({ error: "invalid_client_metadata" }));
  });
});

describe("POST /api/oauth/register — refused-redirect logging", () => {
  it("logs exactly once, JSON.stringify'd, for a refused claude.ai near-miss", async () => {
    stubEnv({ vercelEnv: "preview" });
    const nearMiss = "https://claude.ai/api/mcp/other";
    const res = await POST(req({ body: JSON.stringify({ redirect_uris: [nearMiss] }) }));
    expect(res.status).toBe(400);
    expect(warnSpy).toHaveBeenCalledTimes(1);
    const [prefix, logged] = warnSpy.mock.calls[0]!;
    expect(String(prefix)).toContain("refused redirect_uri from a claude host");
    expect(logged).toBe(JSON.stringify(nearMiss));
  });

  it("never logs a refused non-claude URI", async () => {
    stubEnv({ vercelEnv: "preview" });
    const res = await POST(req({ body: JSON.stringify({ redirect_uris: ["https://evil.example/cb"] }) }));
    expect(res.status).toBe(400);
    expect(warnSpy).not.toHaveBeenCalled();
  });

  it("never logs the client_id or the request body", async () => {
    stubEnv({ vercelEnv: "preview" });
    await POST(
      req({
        body: JSON.stringify({ redirect_uris: ["https://claude.ai/api/mcp/other"], client_name: "should-not-log" }),
      }),
    );
    expect(warnSpy).toHaveBeenCalledTimes(1);
    const loggedArgs = warnSpy.mock.calls[0]!.map(String).join(" ");
    expect(loggedArgs).not.toContain("should-not-log");
  });
});

describe("POST /api/oauth/register — preflight refusals pass through", () => {
  it("the kill switch → 503", async () => {
    stubEnv({ vercelEnv: "preview", disabled: "1" });
    const res = await POST(req({ body: JSON.stringify({ redirect_uris: [CLAUDE_AI_REDIRECT_URI] }) }));
    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({ error: "temporarily_unavailable" });
    expect(writeClientCreate).not.toHaveBeenCalled();
  });

  it("a non-canonical host → 404", async () => {
    stubEnv({ vercelEnv: "production" });
    const res = await POST(
      req({ host: "owt-backstage-abc123-frank-rochas-projects.vercel.app", body: JSON.stringify({ redirect_uris: [CLAUDE_AI_REDIRECT_URI] }) }),
    );
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: "not_found" });
  });

  it("a missing MCP_OAUTH_SECRET → 503", async () => {
    stubEnv({ vercelEnv: "preview", secret: null });
    const res = await POST(req({ body: JSON.stringify({ redirect_uris: [CLAUDE_AI_REDIRECT_URI] }) }));
    expect(res.status).toBe(503);
  });
});

describe("POST /api/oauth/register — response shape", () => {
  it("headers: application/json, no-store", async () => {
    stubEnv({ vercelEnv: "preview" });
    const res = await POST(req({ body: JSON.stringify({ redirect_uris: [CLAUDE_AI_REDIRECT_URI] }) }));
    expect(res.headers.get("content-type")).toMatch(/^application\/json/);
    expect(res.headers.get("cache-control")).toBe("no-store");
  });
});
