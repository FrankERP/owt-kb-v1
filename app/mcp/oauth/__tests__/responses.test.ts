// app/mcp/oauth/__tests__/responses.test.ts
import { describe, it, expect } from "vitest";
import {
  basicClientAuthRefusedResponse,
  jsonNoStore,
  mcpUnauthorizedResponse,
  oauthErrorResponse,
  registrationErrorResponse,
} from "../responses";
import { PREVIEW_ORIGIN, PRODUCTION_ORIGIN } from "../origin";

function expectNoStoreJson(res: Response) {
  expect(res.headers.get("cache-control")).toBe("no-store");
  expect(res.headers.get("content-type")).toMatch(/^application\/json/);
}

describe("mcpUnauthorizedResponse", () => {
  it("no bearer token → challenge WITHOUT an error code (RFC 6750 §3.1)", async () => {
    const res = mcpUnauthorizedResponse(PRODUCTION_ORIGIN, "no_token");
    expect(res.status).toBe(401);
    expect(res.headers.get("www-authenticate")).toBe(
      'Bearer resource_metadata="https://owt-backstage.vercel.app/.well-known/oauth-protected-resource/api/mcp"',
    );
    expectNoStoreJson(res);
    expect(await res.json()).toEqual({ error: "unauthorized" });
  });

  it("any other cause → error=\"invalid_token\" plus the same metadata URL", async () => {
    const res = mcpUnauthorizedResponse(PREVIEW_ORIGIN, "invalid_token");
    expect(res.status).toBe(401);
    expect(res.headers.get("www-authenticate")).toBe(
      'Bearer error="invalid_token", resource_metadata="https://dev-owt-backstage.vercel.app/.well-known/oauth-protected-resource/api/mcp"',
    );
    expectNoStoreJson(res);
    expect(await res.json()).toEqual({ error: "invalid_token" });
  });
});

describe("basicClientAuthRefusedResponse (RFC 6749 §5.2, header-based client auth)", () => {
  it("→ 401 invalid_client with a Basic challenge, JSON, no-store", async () => {
    const res = basicClientAuthRefusedResponse("clients are public");
    expect(res.status).toBe(401);
    expect(res.headers.get("www-authenticate")).toBe('Basic realm="owt-backstage"');
    expectNoStoreJson(res);
    expect(await res.json()).toEqual({ error: "invalid_client", error_description: "clients are public" });
  });

  it("sanitises its description like every other token error", async () => {
    const body = await basicClientAuthRefusedResponse('bad "x"\n').json();
    expect(body.error_description).not.toMatch(/["\\\n]/);
  });
});

describe("oauthErrorResponse (RFC 6749 §5.2)", () => {
  it.each([
    ["invalid_grant", 400],
    ["invalid_request", 400],
    ["invalid_client", 400],
    ["unsupported_grant_type", 400],
    ["invalid_target", 400],
    ["server_error", 500],
  ] as const)("%s → %i, JSON, no-store", async (code, status) => {
    const res = oauthErrorResponse(code);
    expect(res.status).toBe(status);
    expectNoStoreJson(res);
    expect(await res.json()).toEqual({ error: code });
  });

  it("carries an optional description, restricted to the RFC 6749 charset", async () => {
    const res = oauthErrorResponse("invalid_grant", 'bad "code"\n    at Foo (x.ts:1)\\');
    const body = await res.json();
    expect(body.error).toBe("invalid_grant");
    // No quote, backslash or newline survives: a stack can never ride along.
    expect(body.error_description).not.toMatch(/["\\\n]/);
    expect(body.error_description.length).toBeLessThanOrEqual(200);
  });

  it("drops a description that sanitises to nothing", async () => {
    expect(await oauthErrorResponse("invalid_grant", "\n\n").json()).toEqual({ error: "invalid_grant" });
  });
});

describe("registrationErrorResponse (RFC 7591 §3.2.2)", () => {
  it.each(["invalid_redirect_uri", "invalid_client_metadata"] as const)(
    "%s → 400, JSON, no-store",
    async (code) => {
      const res = registrationErrorResponse(code, "redirect_uri not allowed");
      expect(res.status).toBe(400);
      expectNoStoreJson(res);
      expect(await res.json()).toEqual({ error: code, error_description: "redirect_uri not allowed" });
    },
  );
});

describe("jsonNoStore", () => {
  it("serialises the body with no-store", async () => {
    const res = jsonNoStore({ a: 1 }, 201);
    expect(res.status).toBe(201);
    expectNoStoreJson(res);
    expect(await res.json()).toEqual({ a: 1 });
  });
});
