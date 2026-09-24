// app/mcp/oauth/__tests__/authorizeRequest.test.ts
//
// The ONE authorize-request validator (ruling R18), shared by the consent
// page and its POST. The properties pinned here are the confused-deputy
// defences: an unverified client or redirect target NEVER yields a redirect
// URL (the result has no `location` at all), the per-origin allowlist is
// re-checked rather than trusted from the client token, `plain` PKCE is
// refused, a duplicated parameter is refused rather than one copy picked, and
// every redirect is built on the VERIFIED redirect_uri with `iss`.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  authorizationResponseUrl,
  authorizeFormFields,
  searchParamsFromRecord,
  validateAuthorizeRequest,
  type AuthorizeValidation,
} from "../authorizeRequest";
import { PREVIEW_ORIGIN, PRODUCTION_ORIGIN, resourceFor } from "../origin";
import { s256Challenge } from "../pkce";
import { CLAUDE_AI_REDIRECT_URI } from "../redirects";
import { signClientId } from "../tokens";

const KEY = new TextEncoder().encode("s".repeat(32));
const OTHER_KEY = new TextEncoder().encode("t".repeat(32));
const CHALLENGE = s256Challenge("v".repeat(43));
const LOOPBACK_URI = "http://127.0.0.1:51004/callback";

/** Registration at a fixed instant, validation 3 minutes later. */
const REGISTERED_AT = new Date("2026-09-24T12:00:00Z");
const NOW = new Date("2026-09-24T12:03:00Z");

async function clientId(
  opts: { origin?: string; redirectUris?: string[]; clientName?: string; key?: Uint8Array; now?: Date } = {},
): Promise<string> {
  return signClientId({
    key: opts.key ?? KEY,
    origin: opts.origin ?? PREVIEW_ORIGIN,
    redirectUris: opts.redirectUris ?? [CLAUDE_AI_REDIRECT_URI, LOOPBACK_URI],
    now: opts.now ?? REGISTERED_AT,
    ...(opts.clientName !== undefined ? { clientName: opts.clientName } : {}),
  });
}

type ParamValue = string | string[] | null;

/** A valid request; `null` removes a parameter, an array repeats it. */
async function params(overrides: Record<string, ParamValue> = {}): Promise<URLSearchParams> {
  const base: Record<string, ParamValue> = {
    response_type: "code",
    client_id: await clientId({ clientName: "Claude" }),
    redirect_uri: CLAUDE_AI_REDIRECT_URI,
    code_challenge: CHALLENGE,
    code_challenge_method: "S256",
    state: "st-123",
    ...overrides,
  };
  const out = new URLSearchParams();
  for (const [name, value] of Object.entries(base)) {
    if (value === null) continue;
    for (const v of Array.isArray(value) ? value : [value]) out.append(name, v);
  }
  return out;
}

function validate(p: URLSearchParams, origin = PREVIEW_ORIGIN, key = KEY): Promise<AuthorizeValidation> {
  return validateAuthorizeRequest(p, { origin, key, now: NOW });
}

function expectErrorPage(result: AuthorizeValidation, reason: "invalid_client" | "invalid_redirect_uri") {
  expect(result.kind).toBe("error-page");
  if (result.kind !== "error-page") throw new Error("unreachable");
  expect(result.reason).toBe(reason);
  // Never a redirect target of any kind on an error page.
  expect("location" in result).toBe(false);
  expect(JSON.stringify(result)).not.toMatch(/https?:/);
}

function expectErrorRedirect(result: AuthorizeValidation, error: string): URL {
  expect(result.kind).toBe("error-redirect");
  if (result.kind !== "error-redirect") throw new Error("unreachable");
  expect(result.error).toBe(error);
  const url = new URL(result.location);
  expect(url.searchParams.getAll("error")).toEqual([error]);
  expect(url.searchParams.getAll("iss")).toEqual([PREVIEW_ORIGIN]);
  return url;
}

let warnSpy: ReturnType<typeof vi.spyOn>;
beforeEach(() => {
  warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
});
afterEach(() => {
  warnSpy.mockRestore();
});

describe("validateAuthorizeRequest — a valid request renders", () => {
  it("returns the normalized request, the declared name and the registration age", async () => {
    const id = await clientId({ clientName: "Claude" });
    const result = await validate(await params({ client_id: id }));
    expect(result).toEqual({
      kind: "render",
      request: {
        clientId: id,
        redirectUri: CLAUDE_AI_REDIRECT_URI,
        responseType: "code",
        codeChallenge: CHALLENGE,
        codeChallengeMethod: "S256",
        resource: resourceFor(PREVIEW_ORIGIN),
        state: "st-123",
      },
      client: {
        name: "Claude",
        issuedAt: Math.floor(REGISTERED_AT.getTime() / 1000),
        ageSeconds: 180,
      },
    });
  });

  it("a client registered with no name renders with name null", async () => {
    const result = await validate(await params({ client_id: await clientId() }));
    expect(result.kind).toBe("render");
    if (result.kind !== "render") throw new Error("unreachable");
    expect(result.client.name).toBeNull();
  });

  it("a registration 'in the future' (clock skew) is age 0, never negative", async () => {
    const id = await clientId({ now: new Date("2026-09-24T12:10:00Z") });
    const result = await validate(await params({ client_id: id }));
    if (result.kind !== "render") throw new Error("expected render");
    expect(result.client.ageSeconds).toBe(0);
  });

  it("the loopback redirect_uri renders on preview (on the client's list AND the allowlist)", async () => {
    const result = await validate(await params({ redirect_uri: LOOPBACK_URI }));
    expect(result.kind).toBe("render");
  });

  it("an absent or unknown scope is accepted and ignored", async () => {
    for (const scope of [null, "", "mcp", "everything admin"]) {
      const result = await validate(await params({ scope }));
      expect(result.kind, String(scope)).toBe("render");
      if (result.kind !== "render") throw new Error("unreachable");
      expect("scope" in result.request).toBe(false);
    }
  });

  it("unrecognized parameters are ignored (RFC 6749 §3.1)", async () => {
    const result = await validate(await params({ prompt: "consent", nonce: ["a", "b"] }));
    expect(result.kind).toBe("render");
  });

  it("state is carried through byte for byte, including an empty one and one that is already percent-encoded", async () => {
    for (const state of ["st-123", "", "a b&c=d/é?#", "a%20b", "+plus+"]) {
      const result = await validate(await params({ state }));
      if (result.kind !== "render") throw new Error(`expected render for ${JSON.stringify(state)}`);
      expect(result.request.state).toBe(state);
    }
  });

  it("an absent state is null", async () => {
    const result = await validate(await params({ state: null }));
    if (result.kind !== "render") throw new Error("expected render");
    expect(result.request.state).toBeNull();
  });
});

describe("validateAuthorizeRequest — client_id failures render an error page, never a redirect", () => {
  it("a missing client_id", async () => {
    expectErrorPage(await validate(await params({ client_id: null })), "invalid_client");
  });

  it("an empty or garbage client_id", async () => {
    for (const bad of ["", "not-a-token", "a.b.c"]) {
      expectErrorPage(await validate(await params({ client_id: bad })), "invalid_client");
    }
  });

  it("a client id from ANOTHER origin (a production token presented to preview)", async () => {
    const foreign = await clientId({ origin: PRODUCTION_ORIGIN, redirectUris: [CLAUDE_AI_REDIRECT_URI] });
    expectErrorPage(await validate(await params({ client_id: foreign })), "invalid_client");
  });

  it("a client id signed with another key", async () => {
    const forged = await clientId({ key: OTHER_KEY });
    expectErrorPage(await validate(await params({ client_id: forged })), "invalid_client");
  });

  it("a duplicated client_id — even two identical valid copies", async () => {
    const id = await clientId();
    expectErrorPage(await validate(await params({ client_id: [id, id] })), "invalid_client");
  });

  it("a bad client_id wins over every later error: nothing about the request is redirected", async () => {
    const result = await validate(
      await params({ client_id: "junk", response_type: "token", code_challenge_method: "plain", resource: "x" }),
    );
    expectErrorPage(result, "invalid_client");
  });
});

describe("validateAuthorizeRequest — redirect_uri failures render an error page, never a redirect", () => {
  it("a missing redirect_uri", async () => {
    expectErrorPage(await validate(await params({ redirect_uri: null })), "invalid_redirect_uri");
  });

  it("a redirect_uri that is not EXACTLY one of the client's URIs", async () => {
    for (const bad of [
      "https://evil.example/cb",
      CLAUDE_AI_REDIRECT_URI + "/",
      CLAUDE_AI_REDIRECT_URI + "?x=1",
      CLAUDE_AI_REDIRECT_URI.toUpperCase(),
      "http://127.0.0.1:51005/callback",
      "",
    ]) {
      expectErrorPage(await validate(await params({ redirect_uri: bad })), "invalid_redirect_uri");
    }
  });

  it("a redirect_uri on the client's list but OFF this origin's allowlist (a loopback client presented to production)", async () => {
    // Minted directly for production with a loopback URI — registration would
    // never issue this, which is exactly why authorize re-checks the allowlist
    // instead of trusting the client token.
    const id = await clientId({ origin: PRODUCTION_ORIGIN, redirectUris: [LOOPBACK_URI] });
    const result = await validateAuthorizeRequest(await params({ client_id: id, redirect_uri: LOOPBACK_URI }), {
      origin: PRODUCTION_ORIGIN,
      key: KEY,
      now: NOW,
    });
    expectErrorPage(result, "invalid_redirect_uri");
  });

  it("a duplicated redirect_uri — even two identical valid copies — is refused, never one picked", async () => {
    expectErrorPage(
      await validate(await params({ redirect_uri: [CLAUDE_AI_REDIRECT_URI, CLAUDE_AI_REDIRECT_URI] })),
      "invalid_redirect_uri",
    );
    expectErrorPage(
      await validate(await params({ redirect_uri: [CLAUDE_AI_REDIRECT_URI, LOOPBACK_URI] })),
      "invalid_redirect_uri",
    );
  });

  it("a bad redirect_uri wins over every later error", async () => {
    const result = await validate(
      await params({ redirect_uri: "https://evil.example/cb", response_type: "token", code_challenge_method: "plain" }),
    );
    expectErrorPage(result, "invalid_redirect_uri");
  });
});

describe("validateAuthorizeRequest — refused claude-host redirect_uri logging (as registration does)", () => {
  it("logs a refused claude.ai URI exactly once, JSON.stringify'd", async () => {
    const nearMiss = "https://claude.ai/api/mcp/other";
    expectErrorPage(await validate(await params({ redirect_uri: nearMiss })), "invalid_redirect_uri");
    expect(warnSpy).toHaveBeenCalledTimes(1);
    const [prefix, logged] = warnSpy.mock.calls[0]!;
    expect(String(prefix)).toContain("refused redirect_uri from a claude host");
    expect(logged).toBe(JSON.stringify(nearMiss));
  });

  it("logs a claude URI refused by the ALLOWLIST (on the client's list, not allowed here)", async () => {
    const moved = "https://claude.ai/api/mcp/new_callback";
    const id = await clientId({ origin: PRODUCTION_ORIGIN, redirectUris: [moved] });
    await validateAuthorizeRequest(await params({ client_id: id, redirect_uri: moved }), {
      origin: PRODUCTION_ORIGIN,
      key: KEY,
      now: NOW,
    });
    expect(warnSpy).toHaveBeenCalledTimes(1);
    expect(warnSpy.mock.calls[0]![1]).toBe(JSON.stringify(moved));
  });

  it("never logs a non-claude URI, the client_id or the state", async () => {
    await validate(await params({ redirect_uri: "https://evil.example/cb", state: "secret-state" }));
    expect(warnSpy).not.toHaveBeenCalled();
    await validate(await params({ redirect_uri: "https://claude.ai/x", state: "secret-state" }));
    const logged = warnSpy.mock.calls.flat().map(String).join(" ");
    expect(logged).not.toContain("secret-state");
    expect(logged).not.toContain("eyJ");
  });

  it("logs nothing for a valid request", async () => {
    await validate(await params());
    expect(warnSpy).not.toHaveBeenCalled();
  });
});

describe("validateAuthorizeRequest — later errors redirect to the VERIFIED redirect_uri with error, state and iss", () => {
  it("response_type other than code → unsupported_response_type", async () => {
    for (const rt of ["token", "code token", "CODE", ""]) {
      const url = expectErrorRedirect(await validate(await params({ response_type: rt })), "unsupported_response_type");
      expect(url.origin + url.pathname).toBe(CLAUDE_AI_REDIRECT_URI);
      expect(url.searchParams.get("state")).toBe("st-123");
    }
  });

  it("a missing response_type → invalid_request (a required parameter is missing)", async () => {
    expectErrorRedirect(await validate(await params({ response_type: null })), "invalid_request");
  });

  it("plain PKCE is refused", async () => {
    expectErrorRedirect(await validate(await params({ code_challenge_method: "plain" })), "invalid_request");
  });

  it("an absent method (RFC 7636 defaults it to plain) or a mis-cased one is refused", async () => {
    expectErrorRedirect(await validate(await params({ code_challenge_method: null })), "invalid_request");
    expectErrorRedirect(await validate(await params({ code_challenge_method: "s256" })), "invalid_request");
  });

  it("a missing or malformed code_challenge is refused", async () => {
    expectErrorRedirect(await validate(await params({ code_challenge: null })), "invalid_request");
    for (const bad of ["", "short", CHALLENGE + "A", CHALLENGE.slice(0, 42) + "=", CHALLENGE.slice(0, 42) + "+"]) {
      expectErrorRedirect(await validate(await params({ code_challenge: bad })), "invalid_request");
    }
  });

  it("a resource that is not this origin's → invalid_target", async () => {
    for (const bad of [resourceFor(PRODUCTION_ORIGIN), resourceFor(PREVIEW_ORIGIN) + "/", "", "https://evil.example/api/mcp"]) {
      expectErrorRedirect(await validate(await params({ resource: bad })), "invalid_target");
    }
  });

  it("an explicit resource equal to this origin's is accepted; a repeated one must be equal every time (RFC 8707)", async () => {
    const own = resourceFor(PREVIEW_ORIGIN);
    expect((await validate(await params({ resource: own }))).kind).toBe("render");
    expect((await validate(await params({ resource: [own, own] }))).kind).toBe("render");
    expectErrorRedirect(await validate(await params({ resource: [own, "https://evil.example/api/mcp"] })), "invalid_target");
  });

  it("a duplicated parameter after redirect_uri is verified → invalid_request", async () => {
    for (const name of ["response_type", "code_challenge", "code_challenge_method", "scope"]) {
      const p = await params();
      while (p.getAll(name).length < 2) p.append(name, p.get(name) ?? "x");
      expectErrorRedirect(await validate(p), "invalid_request");
    }
  });

  it("a duplicated state → invalid_request, and NEITHER copy is echoed", async () => {
    const url = expectErrorRedirect(await validate(await params({ state: ["one", "two"] })), "invalid_request");
    expect(url.searchParams.has("state")).toBe(false);
  });

  it("no state in the request → none in the redirect", async () => {
    const url = expectErrorRedirect(await validate(await params({ state: null, response_type: "token" })), "unsupported_response_type");
    expect(url.searchParams.has("state")).toBe(false);
  });

  it("state round-trips unchanged and nothing is double-encoded", async () => {
    for (const state of ["a b&c=d/é?#", "a%20b", "+plus+", ""]) {
      const url = expectErrorRedirect(await validate(await params({ state, response_type: "token" })), "unsupported_response_type");
      expect(url.searchParams.get("state")).toBe(state);
    }
  });

  it("the redirect goes to the loopback URI when that is the verified one, keeping its own query", async () => {
    const withQuery = "http://127.0.0.1:51004/callback?session=x%202";
    const id = await clientId({ redirectUris: [withQuery] });
    const result = await validate(await params({ client_id: id, redirect_uri: withQuery, response_type: "token" }));
    const url = expectErrorRedirect(result, "unsupported_response_type");
    if (result.kind !== "error-redirect") throw new Error("unreachable");
    expect(result.location.startsWith(withQuery + "&")).toBe(true);
    expect(url.searchParams.get("session")).toBe("x 2");
  });
});

describe("authorizationResponseUrl", () => {
  it("appends to a query-less URI with ?", () => {
    const loc = authorizationResponseUrl(CLAUDE_AI_REDIRECT_URI, { code: "c", state: "s", iss: PREVIEW_ORIGIN });
    expect(loc).toBe(`${CLAUDE_AI_REDIRECT_URI}?code=c&state=s&iss=${encodeURIComponent(PREVIEW_ORIGIN)}`);
  });

  it("preserves an existing query byte for byte and appends with &", () => {
    const loc = authorizationResponseUrl("http://127.0.0.1:5000/cb?a=1%202&b=~x", { code: "c", iss: PREVIEW_ORIGIN });
    expect(loc.startsWith("http://127.0.0.1:5000/cb?a=1%202&b=~x&code=c&iss=")).toBe(true);
  });

  it("omits a null state rather than sending an empty one, and keeps an empty-string state", () => {
    expect(new URL(authorizationResponseUrl(CLAUDE_AI_REDIRECT_URI, { code: "c", state: null, iss: "x" })).searchParams.has("state")).toBe(false);
    expect(new URL(authorizationResponseUrl(CLAUDE_AI_REDIRECT_URI, { code: "c", state: "", iss: "x" })).searchParams.get("state")).toBe("");
  });
});

describe("authorizeFormFields — what the consent form posts", () => {
  it("carries every validated parameter, and re-validates to the SAME request (the POST's input)", async () => {
    const first = await validate(await params({ scope: "mcp", resource: null }));
    if (first.kind !== "render") throw new Error("expected render");
    const fields = authorizeFormFields(first.request);
    expect(fields.map(([name]) => name)).toEqual([
      "response_type",
      "client_id",
      "redirect_uri",
      "code_challenge",
      "code_challenge_method",
      "resource",
      "state",
    ]);
    const again = await validate(new URLSearchParams(fields));
    if (again.kind !== "render") throw new Error("expected render");
    expect(again.request).toEqual(first.request);
  });

  it("omits state when the request had none, and keeps an empty one", async () => {
    const none = await validate(await params({ state: null }));
    if (none.kind !== "render") throw new Error("expected render");
    expect(authorizeFormFields(none.request).some(([n]) => n === "state")).toBe(false);

    const empty = await validate(await params({ state: "" }));
    if (empty.kind !== "render") throw new Error("expected render");
    expect(authorizeFormFields(empty.request)).toContainEqual(["state", ""]);
  });
});

describe("searchParamsFromRecord — the page's searchParams, duplicates kept", () => {
  it("repeats array values and drops undefined", () => {
    const p = searchParamsFromRecord({ a: "1", b: ["2", "3"], c: undefined });
    expect(p.getAll("a")).toEqual(["1"]);
    expect(p.getAll("b")).toEqual(["2", "3"]);
    expect(p.has("c")).toBe(false);
  });
});
