// app/mcp/oauth/__tests__/guard.test.ts
import { describe, it, expect } from "vitest";
import {
  LOCAL_ORIGIN,
  MIN_SECRET_BYTES,
  PREVIEW_ORIGIN,
  PRODUCTION_ORIGIN,
  canonicalOrigin,
  loadSecret,
  resolveOrigin,
  resolveResource,
  resourceFor,
  resourceMetadataUrl,
} from "../origin";
import { mcpRoutePreflight } from "../guard";

const SECRET_32 = "s".repeat(32);

function req(host?: string): Request {
  return new Request("https://ignored.example/api/oauth/token", {
    headers: host === undefined ? {} : { host },
  });
}

const PROD = { VERCEL_ENV: "production", MCP_OAUTH_SECRET: SECRET_32 };
const PREVIEW = { VERCEL_ENV: "preview", MCP_OAUTH_SECRET: SECRET_32 };
const LOCAL = { MCP_OAUTH_SECRET: SECRET_32 };

async function expectRefusal(
  result: ReturnType<typeof mcpRoutePreflight>,
  status: number,
): Promise<Record<string, unknown>> {
  expect(result.ok).toBe(false);
  if (result.ok) throw new Error("unreachable");
  expect(result.response.status).toBe(status);
  expect(result.response.headers.get("cache-control")).toBe("no-store");
  expect(result.response.headers.get("content-type")).toMatch(/^application\/json/);
  const text = await result.response.text();
  // Small, fixed body: no env names, no secret, no stack.
  expect(text.length).toBeLessThan(80);
  expect(text).not.toMatch(/MCP_|SECRET|VERCEL|Error|at /);
  return JSON.parse(text);
}

describe("canonicalOrigin", () => {
  it("maps VERCEL_ENV to exactly one origin", () => {
    expect(canonicalOrigin({ VERCEL_ENV: "production" })).toBe("https://owt-backstage.vercel.app");
    expect(canonicalOrigin({ VERCEL_ENV: "preview" })).toBe("https://dev-owt-backstage.vercel.app");
    expect(canonicalOrigin({ VERCEL_ENV: "development" })).toBe("http://localhost:3000");
    expect(canonicalOrigin({})).toBe("http://localhost:3000");
    expect(PRODUCTION_ORIGIN).toBe("https://owt-backstage.vercel.app");
    expect(PREVIEW_ORIGIN).toBe("https://dev-owt-backstage.vercel.app");
    expect(LOCAL_ORIGIN).toBe("http://localhost:3000");
  });

  it("an unknown VERCEL_ENV has no origin at all (fail closed)", () => {
    expect(canonicalOrigin({ VERCEL_ENV: "staging" })).toBeNull();
  });
});

describe("resolveOrigin", () => {
  it("accepts only the canonical host of this deployment", () => {
    expect(resolveOrigin(req("owt-backstage.vercel.app"), PROD)).toBe(PRODUCTION_ORIGIN);
    expect(resolveOrigin(req("dev-owt-backstage.vercel.app"), PREVIEW)).toBe(PREVIEW_ORIGIN);
    expect(resolveOrigin(req("localhost:3000"), LOCAL)).toBe(LOCAL_ORIGIN);
    expect(resolveOrigin(req("localhost:3000"), { VERCEL_ENV: "development" })).toBe(LOCAL_ORIGIN);
  });

  it("host comparison is case-insensitive", () => {
    expect(resolveOrigin(req("OWT-Backstage.vercel.app"), PROD)).toBe(PRODUCTION_ORIGIN);
  });

  it("the request's own Host never picks another deployment's issuer", () => {
    // The other alias, a per-deployment URL, loopback and garbage are all refused.
    for (const host of [
      "dev-owt-backstage.vercel.app",
      "owt-backstage-abc123-frank-rochas-projects.vercel.app",
      "owt-backstage-git-main-frank-rochas-projects.vercel.app",
      "localhost:3000",
      "owt-backstage.vercel.app.",
      "owt-backstage.vercel.app:443",
      "evil.example",
      "",
    ]) {
      expect(resolveOrigin(req(host), PROD)).toBeNull();
    }
    expect(resolveOrigin(req("owt-backstage.vercel.app"), PREVIEW)).toBeNull();
    expect(resolveOrigin(req("127.0.0.1:3000"), LOCAL)).toBeNull();
    expect(resolveOrigin(req("localhost:3001"), LOCAL)).toBeNull();
    expect(resolveOrigin(req("localhost"), LOCAL)).toBeNull();
  });

  it("no Host header is refused", () => {
    expect(resolveOrigin(req(), PROD)).toBeNull();
  });

  it("an unknown VERCEL_ENV refuses every host", () => {
    expect(resolveOrigin(req("owt-backstage.vercel.app"), { VERCEL_ENV: "staging" })).toBeNull();
    expect(resolveOrigin(req("localhost:3000"), { VERCEL_ENV: "staging" })).toBeNull();
  });
});

describe("resource", () => {
  it("resourceFor is origin + /api/mcp", () => {
    expect(resourceFor(PRODUCTION_ORIGIN)).toBe("https://owt-backstage.vercel.app/api/mcp");
    expect(resourceFor(PREVIEW_ORIGIN)).toBe("https://dev-owt-backstage.vercel.app/api/mcp");
    expect(resourceFor(LOCAL_ORIGIN)).toBe("http://localhost:3000/api/mcp");
  });

  it("resourceMetadataUrl is the RFC 9728 path-suffixed metadata URL", () => {
    expect(resourceMetadataUrl(PRODUCTION_ORIGIN)).toBe(
      "https://owt-backstage.vercel.app/.well-known/oauth-protected-resource/api/mcp",
    );
  });

  it("an absent resource defaults to this origin's", () => {
    const expected = { ok: true, resource: resourceFor(PRODUCTION_ORIGIN) };
    expect(resolveResource(undefined, PRODUCTION_ORIGIN)).toEqual(expected);
    expect(resolveResource(null, PRODUCTION_ORIGIN)).toEqual(expected);
    expect(resolveResource([], PRODUCTION_ORIGIN)).toEqual(expected);
  });

  it("a present resource must equal this origin's exactly", () => {
    const r = resourceFor(PRODUCTION_ORIGIN);
    expect(resolveResource(r, PRODUCTION_ORIGIN)).toEqual({ ok: true, resource: r });
    expect(resolveResource([r], PRODUCTION_ORIGIN)).toEqual({ ok: true, resource: r });
    for (const bad of [
      "",
      r + "/",
      resourceFor(PREVIEW_ORIGIN),
      "https://owt-backstage.vercel.app",
      "https://OWT-backstage.vercel.app/api/mcp",
      "http://owt-backstage.vercel.app/api/mcp",
    ]) {
      expect(resolveResource(bad, PRODUCTION_ORIGIN)).toEqual({ ok: false, error: "invalid_target" });
    }
    expect(resolveResource([r, resourceFor(PREVIEW_ORIGIN)], PRODUCTION_ORIGIN)).toEqual({
      ok: false,
      error: "invalid_target",
    });
  });
});

describe("loadSecret", () => {
  it("returns the UTF-8 bytes of a secret of at least 32 bytes", () => {
    expect(MIN_SECRET_BYTES).toBe(32);
    const s = loadSecret({ MCP_OAUTH_SECRET: SECRET_32 });
    expect(s.ok).toBe(true);
    if (s.ok) expect(Array.from(s.key)).toEqual(Array.from(new TextEncoder().encode(SECRET_32)));
  });

  it("missing, empty or 31-byte secrets fail closed", () => {
    expect(loadSecret({}).ok).toBe(false);
    expect(loadSecret({ MCP_OAUTH_SECRET: "" }).ok).toBe(false);
    expect(loadSecret({ MCP_OAUTH_SECRET: "s".repeat(31) }).ok).toBe(false);
  });

  it("measures bytes, not characters", () => {
    // "é" is two bytes in UTF-8.
    expect(loadSecret({ MCP_OAUTH_SECRET: "é".repeat(16) }).ok).toBe(true);
    expect(loadSecret({ MCP_OAUTH_SECRET: "é".repeat(15) + "a" }).ok).toBe(false);
  });
});

describe("mcpRoutePreflight", () => {
  it("passes on the canonical host with a valid secret", () => {
    const r = mcpRoutePreflight(req("owt-backstage.vercel.app"), PROD);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.origin).toBe(PRODUCTION_ORIGIN);
    expect(r.resource).toBe(resourceFor(PRODUCTION_ORIGIN));
    expect(r.key.byteLength).toBe(32);
  });

  it("passes on preview and local too", () => {
    expect(mcpRoutePreflight(req("dev-owt-backstage.vercel.app"), PREVIEW).ok).toBe(true);
    expect(mcpRoutePreflight(req("localhost:3000"), LOCAL).ok).toBe(true);
  });

  it("a host outside the canonical set → 404", async () => {
    const body = await expectRefusal(
      mcpRoutePreflight(req("owt-backstage-abc123-frank-rochas-projects.vercel.app"), PROD),
      404,
    );
    expect(body).toEqual({ error: "not_found" });
    await expectRefusal(mcpRoutePreflight(req("dev-owt-backstage.vercel.app"), PROD), 404);
    await expectRefusal(mcpRoutePreflight(req(), PROD), 404);
  });

  it("MCP_DISABLED → 503 before anything else", async () => {
    // Wrong host AND missing secret: the kill switch still answers first.
    const body = await expectRefusal(
      mcpRoutePreflight(req("evil.example"), { VERCEL_ENV: "production", MCP_DISABLED: "1" }),
      503,
    );
    expect(body).toEqual({ error: "temporarily_unavailable" });
    // Any non-empty value disables, including one that reads as "off".
    await expectRefusal(
      mcpRoutePreflight(req("owt-backstage.vercel.app"), { ...PROD, MCP_DISABLED: "0" }),
      503,
    );
    // Empty means not disabled.
    expect(mcpRoutePreflight(req("owt-backstage.vercel.app"), { ...PROD, MCP_DISABLED: "" }).ok).toBe(
      true,
    );
  });

  it("a missing secret → 503", async () => {
    const body = await expectRefusal(
      mcpRoutePreflight(req("owt-backstage.vercel.app"), { VERCEL_ENV: "production" }),
      503,
    );
    expect(body).toEqual({ error: "temporarily_unavailable" });
  });

  it("a 31-byte secret → 503", async () => {
    await expectRefusal(
      mcpRoutePreflight(req("owt-backstage.vercel.app"), {
        VERCEL_ENV: "production",
        MCP_OAUTH_SECRET: "s".repeat(31),
      }),
      503,
    );
  });

  it("host is checked before the secret", async () => {
    await expectRefusal(mcpRoutePreflight(req("evil.example"), { VERCEL_ENV: "production" }), 404);
  });
});

describe("mcpRoutePreflight — headers only (R17: a Server Component has headers(), not a Request)", () => {
  it("runs the same checks, in the same order, on a bare { headers } object", async () => {
    const headersOnly = (host: string) => ({ headers: new Headers({ host }) });
    const ok = mcpRoutePreflight(headersOnly("owt-backstage.vercel.app"), PROD);
    expect(ok.ok).toBe(true);
    if (!ok.ok) throw new Error("unreachable");
    expect(ok.origin).toBe(PRODUCTION_ORIGIN);
    await expectRefusal(mcpRoutePreflight(headersOnly("evil.example"), PROD), 404);
    await expectRefusal(mcpRoutePreflight(headersOnly("owt-backstage.vercel.app"), { ...PROD, MCP_DISABLED: "1" }), 503);
    await expectRefusal(mcpRoutePreflight(headersOnly("owt-backstage.vercel.app"), { VERCEL_ENV: "production" }), 503);
  });
});
