// `GET /api/oauth/discovery/authorization-server` (RFC 8414) and
// `GET /api/oauth/discovery/protected-resource` (RFC 9728) — P0 plan step 4.
//
// Both handlers do exactly two things: run `mcpRoutePreflight` (already fully
// covered by `app/mcp/oauth/__tests__/guard.test.ts`) and, on success, shape a
// fixed metadata body from the origin/resource it returns. So this file pins
// the wiring — the refusal responses pass through verbatim, and the success
// body carries the exact RFC members the P0 plan names, built on the real
// canonical origin of each environment — rather than re-deriving the guard's
// own test matrix.

import { afterEach, describe, expect, it, vi } from "vitest";

import { GET as authorizationServerGET } from "@/app/api/oauth/discovery/authorization-server/route";
import { GET as protectedResourceGET } from "@/app/api/oauth/discovery/protected-resource/route";

const SECRET = "s".repeat(32);

const PRODUCTION_ORIGIN = "https://owt-backstage.vercel.app";
const PREVIEW_ORIGIN = "https://dev-owt-backstage.vercel.app";
const LOCAL_ORIGIN = "http://localhost:3000";

function req(host?: string): Request {
  return new Request("https://ignored.example/.well-known/discovery-test", {
    headers: host === undefined ? {} : { host },
  });
}

/** Every canonical environment this route must serve, and the host that reaches it. */
const ENVIRONMENTS = [
  { name: "production", vercelEnv: "production", host: "owt-backstage.vercel.app", origin: PRODUCTION_ORIGIN },
  { name: "preview", vercelEnv: "preview", host: "dev-owt-backstage.vercel.app", origin: PREVIEW_ORIGIN },
  { name: "unset (local)", vercelEnv: undefined, host: "localhost:3000", origin: LOCAL_ORIGIN },
] as const;

afterEach(() => {
  vi.unstubAllEnvs();
});

/** `secret: null` means "explicitly missing"; an omitted `secret` defaults to a valid one. */
function stubEnv(env: { vercelEnv?: string; secret?: string | null; disabled?: string }) {
  vi.stubEnv("VERCEL_ENV", env.vercelEnv);
  vi.stubEnv("MCP_OAUTH_SECRET", env.secret === null ? undefined : (env.secret ?? SECRET));
  if (env.disabled !== undefined) vi.stubEnv("MCP_DISABLED", env.disabled);
}

describe("GET /api/oauth/discovery/authorization-server", () => {
  for (const env of ENVIRONMENTS) {
    it(`serves RFC 8414 metadata for this deployment's origin (${env.name})`, async () => {
      stubEnv({ vercelEnv: env.vercelEnv });
      const res = await authorizationServerGET(req(env.host));
      expect(res.status).toBe(200);
      expect(res.headers.get("content-type")).toMatch(/^application\/json/);
      expect(res.headers.get("cache-control")).toBe("no-store");
      expect(await res.json()).toEqual({
        issuer: env.origin,
        authorization_endpoint: `${env.origin}/oauth/authorize`,
        token_endpoint: `${env.origin}/api/oauth/token`,
        registration_endpoint: `${env.origin}/api/oauth/register`,
        response_types_supported: ["code"],
        grant_types_supported: ["authorization_code", "refresh_token"],
        code_challenge_methods_supported: ["S256"],
        token_endpoint_auth_methods_supported: ["none"],
        authorization_response_iss_parameter_supported: true,
      });
    });
  }

  it("never advertises client_id_metadata_document_supported (keeps claude.ai on DCR)", async () => {
    stubEnv({ vercelEnv: "production" });
    const res = await authorizationServerGET(req("owt-backstage.vercel.app"));
    const body = (await res.json()) as Record<string, unknown>;
    expect("client_id_metadata_document_supported" in body).toBe(false);
  });

  it("a non-canonical host → 404, same shape as the guard", async () => {
    stubEnv({ vercelEnv: "production" });
    const res = await authorizationServerGET(
      req("owt-backstage-abc123-frank-rochas-projects.vercel.app"),
    );
    expect(res.status).toBe(404);
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(await res.json()).toEqual({ error: "not_found" });
  });

  it("the other environment's own alias is non-canonical under production → 404", async () => {
    stubEnv({ vercelEnv: "preview" });
    const res = await authorizationServerGET(req("owt-backstage.vercel.app"));
    expect(res.status).toBe(404);
  });

  it("MCP_DISABLED → 503", async () => {
    stubEnv({ vercelEnv: "production", disabled: "1" });
    const res = await authorizationServerGET(req("owt-backstage.vercel.app"));
    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({ error: "temporarily_unavailable" });
  });

  it("a missing MCP_OAUTH_SECRET → 503", async () => {
    stubEnv({ vercelEnv: "production", secret: null });
    const res = await authorizationServerGET(req("owt-backstage.vercel.app"));
    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({ error: "temporarily_unavailable" });
  });
});

describe("GET /api/oauth/discovery/protected-resource", () => {
  for (const env of ENVIRONMENTS) {
    it(`serves RFC 9728 metadata for this deployment's resource (${env.name})`, async () => {
      stubEnv({ vercelEnv: env.vercelEnv });
      const res = await protectedResourceGET(req(env.host));
      expect(res.status).toBe(200);
      expect(res.headers.get("content-type")).toMatch(/^application\/json/);
      expect(res.headers.get("cache-control")).toBe("no-store");
      expect(await res.json()).toEqual({
        resource: `${env.origin}/api/mcp`,
        authorization_servers: [env.origin],
        bearer_methods_supported: ["header"],
      });
    });
  }

  it("the production host under preview → 404", async () => {
    stubEnv({ vercelEnv: "preview" });
    const res = await protectedResourceGET(req("owt-backstage.vercel.app"));
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: "not_found" });
  });

  it("MCP_DISABLED → 503", async () => {
    stubEnv({ vercelEnv: "preview", disabled: "true" });
    const res = await protectedResourceGET(req("dev-owt-backstage.vercel.app"));
    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({ error: "temporarily_unavailable" });
  });

  it("a missing MCP_OAUTH_SECRET → 503", async () => {
    stubEnv({ vercelEnv: "preview", secret: null });
    const res = await protectedResourceGET(req("dev-owt-backstage.vercel.app"));
    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({ error: "temporarily_unavailable" });
  });
});
