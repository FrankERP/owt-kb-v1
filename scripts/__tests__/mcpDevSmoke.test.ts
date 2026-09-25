// scripts/__tests__/mcpDevSmoke.test.ts
//
// TDD for scripts/mcp-dev-smoke.mjs (P0 plan step 11a, controller ruling R24;
// the `--reads` pass added at P1 plan step 8): the dev-smoke client's pure
// helpers — base-URL validation (including the production refusal), PKCE,
// authorize-URL building, form encoding, SSE-frame parsing, token redaction,
// unverified JWT decoding, the tools/list check and the `--reads` pass'
// arguments/detail/summary helpers. None of this touches the network; the
// live handshake against dev is Frank's own run (see the task-11a report for
// the exact commands and their output).
//
// Several groups cross-check the script's duplicated logic against the real
// server modules it talks to, so a drift in either fails here instead of
// silently producing a client that can no longer complete the handshake.

import { SignJWT } from "jose";
import { describe, expect, it } from "vitest";

import { BYPASS_HEADER as SERVER_BYPASS_HEADER } from "@/e2e/service-readiness/lib/bypass";
import { LOCAL_ORIGIN, MIN_SECRET_BYTES, PREVIEW_ORIGIN, PRODUCTION_ORIGIN, resourceFor } from "@/app/mcp/oauth/origin";
import { isLoopbackRedirectUri } from "@/app/mcp/oauth/redirects";
import { isValidCodeChallenge, isValidCodeVerifier, s256Challenge } from "@/app/mcp/oauth/pkce";
import { signAccessToken, signClientId } from "@/app/mcp/oauth/tokens";
import { validateAuthorizeRequest } from "@/app/mcp/oauth/authorizeRequest";

import {
  BYPASS_HEADER,
  buildAuthorizeUrl,
  bypassHeaderFor,
  checkToolList,
  codeChallengeFromVerifier,
  decodeJwtPayloadUnsafe,
  DEFAULT_BASE,
  EXPECTED_TOOLS,
  formEncode,
  formatReadCheckLine,
  generateCodeVerifier,
  generateState,
  LOCAL_BASE,
  parseArgs,
  parseSseMessages,
  PRODUCTION_BASE,
  READ_TOOL_NAMES,
  readCheckArguments,
  readCheckDetail,
  redact,
  redirectUriFor,
  resolveBase,
  rpc,
  SmokeError,
  songIdFromSearchResult,
  summarizeReadChecks,
} from "../mcp-dev-smoke.mjs";

const KEY = new TextEncoder().encode("a".repeat(MIN_SECRET_BYTES));

describe("resolveBase", () => {
  it("defaults to the dev origin and needs the bypass secret", () => {
    expect(resolveBase(undefined)).toEqual({ ok: true, origin: DEFAULT_BASE, needsBypass: true });
    expect(resolveBase("")).toEqual({ ok: true, origin: DEFAULT_BASE, needsBypass: true });
    expect(DEFAULT_BASE).toBe(PREVIEW_ORIGIN);
  });

  it("accepts an explicit dev origin, trailing slash included", () => {
    expect(resolveBase(DEFAULT_BASE)).toEqual({ ok: true, origin: DEFAULT_BASE, needsBypass: true });
    expect(resolveBase(`${DEFAULT_BASE}/`)).toEqual({ ok: true, origin: DEFAULT_BASE, needsBypass: true });
  });

  it("accepts the local origin and needs no bypass secret", () => {
    expect(resolveBase(LOCAL_BASE)).toEqual({ ok: true, origin: LOCAL_BASE, needsBypass: false });
    expect(LOCAL_BASE).toBe(LOCAL_ORIGIN);
  });

  it("refuses production by name, with a message naming why — and makes no network call to do it", () => {
    expect(PRODUCTION_BASE).toBe(PRODUCTION_ORIGIN);
    const result = resolveBase(PRODUCTION_BASE);
    expect(result.ok).toBe(false);
    expect(result.message).toMatch(/production/i);
    expect(result.message).toMatch(/claude\.ai/i);
  });

  it("refuses any other base", () => {
    for (const other of ["https://example.com", "https://owt-backstage-abc123.vercel.app", "http://127.0.0.1:3000"]) {
      const result = resolveBase(other);
      expect(result.ok).toBe(false);
      expect(result.message).toMatch(/not allowed/i);
    }
  });

  it("refuses an unparseable URL", () => {
    const result = resolveBase("not a url");
    expect(result.ok).toBe(false);
    expect(result.message).toMatch(/not a valid URL/i);
  });
});

describe("parseArgs", () => {
  it("defaults: no base override, open/refresh on, await-revocation and reads off", () => {
    expect(parseArgs([])).toEqual({ base: null, open: true, refresh: true, awaitRevocation: false, reads: false });
  });

  it("parses --base, --no-open, --no-refresh, --await-revocation, --reads together", () => {
    expect(
      parseArgs(["--base", "http://localhost:3000", "--no-open", "--no-refresh", "--await-revocation", "--reads"]),
    ).toEqual({
      base: "http://localhost:3000",
      open: false,
      refresh: false,
      awaitRevocation: true,
      reads: true,
    });
  });

  it("rejects --base with no value", () => {
    expect(() => parseArgs(["--base"])).toThrow(/needs a value/);
    expect(() => parseArgs(["--base", "--no-open"])).toThrow(/needs a value/);
  });

  it("rejects an unrecognized argument", () => {
    expect(() => parseArgs(["--bogus"])).toThrow(/Unrecognized argument/);
  });
});

describe("PKCE — generateCodeVerifier / codeChallengeFromVerifier", () => {
  it("generates a verifier the server's own validator accepts", () => {
    const verifier = generateCodeVerifier();
    expect(isValidCodeVerifier(verifier)).toBe(true);
  });

  it("two verifiers in a row differ", () => {
    expect(generateCodeVerifier()).not.toBe(generateCodeVerifier());
  });

  it("matches the RFC 7636 Appendix B worked example", () => {
    const verifier = "dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk";
    expect(codeChallengeFromVerifier(verifier)).toBe("E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM");
  });

  it("produces exactly what the server's own s256Challenge produces, for a generated verifier", () => {
    const verifier = generateCodeVerifier();
    const challenge = codeChallengeFromVerifier(verifier);
    expect(challenge).toBe(s256Challenge(verifier));
    expect(isValidCodeChallenge(challenge)).toBe(true);
  });
});

describe("generateState", () => {
  it("is a non-empty string and two calls differ", () => {
    const a = generateState();
    const b = generateState();
    expect(typeof a).toBe("string");
    expect(a.length).toBeGreaterThan(0);
    expect(a).not.toBe(b);
  });
});

describe("redirectUriFor", () => {
  it("builds a canonical RFC 8252 loopback URI the server's own validator accepts", () => {
    const uri = redirectUriFor(54321);
    expect(uri).toBe("http://127.0.0.1:54321/callback");
    expect(isLoopbackRedirectUri(uri)).toBe(true);
  });
});

describe("buildAuthorizeUrl", () => {
  it("carries every parameter the server's authorize validator requires", () => {
    const url = buildAuthorizeUrl({
      authorizationEndpoint: `${PREVIEW_ORIGIN}/oauth/authorize`,
      clientId: "client-token",
      redirectUri: "http://127.0.0.1:1234/callback",
      codeChallenge: "c".repeat(43),
      state: "the-state",
      resource: resourceFor(PREVIEW_ORIGIN),
    });
    const parsed = new URL(url);
    expect(parsed.origin + parsed.pathname).toBe(`${PREVIEW_ORIGIN}/oauth/authorize`);
    expect(parsed.searchParams.get("response_type")).toBe("code");
    expect(parsed.searchParams.get("client_id")).toBe("client-token");
    expect(parsed.searchParams.get("redirect_uri")).toBe("http://127.0.0.1:1234/callback");
    expect(parsed.searchParams.get("code_challenge")).toBe("c".repeat(43));
    expect(parsed.searchParams.get("code_challenge_method")).toBe("S256");
    expect(parsed.searchParams.get("state")).toBe("the-state");
    expect(parsed.searchParams.get("resource")).toBe(resourceFor(PREVIEW_ORIGIN));
    // Every SINGLE_VALUED_PARAM appears exactly once.
    for (const name of ["response_type", "client_id", "redirect_uri", "state", "code_challenge", "code_challenge_method"]) {
      expect(parsed.searchParams.getAll(name)).toHaveLength(1);
    }
  });

  it("round-trips through the real server-side validator (render, not an error)", async () => {
    const redirectUri = redirectUriFor(48213);
    const clientId = await signClientId({ key: KEY, origin: PREVIEW_ORIGIN, redirectUris: [redirectUri] });
    const verifier = generateCodeVerifier();
    const challenge = codeChallengeFromVerifier(verifier);
    const state = generateState();
    const url = buildAuthorizeUrl({
      authorizationEndpoint: `${PREVIEW_ORIGIN}/oauth/authorize`,
      clientId,
      redirectUri,
      codeChallenge: challenge,
      state,
      resource: resourceFor(PREVIEW_ORIGIN),
    });
    const validation = await validateAuthorizeRequest(new URL(url).searchParams, { origin: PREVIEW_ORIGIN, key: KEY });
    expect(validation.kind).toBe("render");
    if (validation.kind === "render") {
      expect(validation.request.clientId).toBe(clientId);
      expect(validation.request.redirectUri).toBe(redirectUri);
      expect(validation.request.codeChallenge).toBe(challenge);
      expect(validation.request.state).toBe(state);
      expect(validation.request.resource).toBe(resourceFor(PREVIEW_ORIGIN));
    }
  });
});

describe("bypassHeaderFor", () => {
  it("agrees with the header name e2e/service-readiness/lib/bypass.ts sends", () => {
    expect(BYPASS_HEADER).toBe(SERVER_BYPASS_HEADER);
    expect(BYPASS_HEADER).toBe("x-vercel-protection-bypass");
  });

  it("returns the header only when a secret is given", () => {
    expect(bypassHeaderFor("s3cr3t")).toEqual({ "x-vercel-protection-bypass": "s3cr3t" });
    expect(bypassHeaderFor(null)).toEqual({});
    expect(bypassHeaderFor("")).toEqual({});
  });
});

describe("formEncode", () => {
  it("encodes fields in order, URL-encoding special characters", () => {
    expect(
      formEncode([
        ["grant_type", "authorization_code"],
        ["code", "a b+c"],
        ["redirect_uri", "http://127.0.0.1:1234/callback"],
      ]),
    ).toBe("grant_type=authorization_code&code=a+b%2Bc&redirect_uri=http%3A%2F%2F127.0.0.1%3A1234%2Fcallback");
  });

  it("omits null/undefined values", () => {
    expect(
      formEncode([
        ["a", "1"],
        ["b", null],
        ["c", undefined],
        ["d", "2"],
      ]),
    ).toBe("a=1&d=2");
  });
});

describe("parseSseMessages", () => {
  it("parses a single SSE-framed JSON-RPC message", () => {
    const text = 'event: message\ndata: {"jsonrpc":"2.0","id":1,"result":{"ok":true}}\n\n';
    expect(parseSseMessages(text)).toEqual([{ jsonrpc: "2.0", id: 1, result: { ok: true } }]);
  });

  it("parses multiple events and ignores blank ones", () => {
    const text = 'data: {"a":1}\n\n\n\ndata: {"a":2}\n\n';
    expect(parseSseMessages(text)).toEqual([{ a: 1 }, { a: 2 }]);
  });

  it("returns an empty array for text with no data: line", () => {
    expect(parseSseMessages("event: message\n\n")).toEqual([]);
    expect(parseSseMessages("")).toEqual([]);
  });
});

describe("redact", () => {
  it("keeps an 8-char prefix and the length, never the rest", () => {
    const token = "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIx.abc";
    const result = redact(token);
    expect(result.startsWith(token.slice(0, 8))).toBe(true);
    expect(result).toContain(`${token.length} chars`);
    expect(result).not.toContain(token.slice(9));
  });

  it("handles empty and short strings without throwing", () => {
    expect(redact("")).toBe("(empty)");
    expect(redact("ab")).toBe(`ab… (2 chars)`);
  });

  it("handles non-string input", () => {
    expect(redact(undefined)).toBe("(empty)");
    expect(redact(null)).toBe("(empty)");
  });
});

describe("decodeJwtPayloadUnsafe", () => {
  it("decodes a real access token's payload, grant id included, without a key", async () => {
    const token = await signAccessToken({ key: KEY, origin: PREVIEW_ORIGIN, sub: "member-1", grantId: "mcpOauthGrant.abc" });
    const claims = decodeJwtPayloadUnsafe(token.token);
    expect(claims).toMatchObject({ typ: "at", iss: PREVIEW_ORIGIN, sub: "member-1", grant: "mcpOauthGrant.abc" });
  });

  it("decodes even a token signed with a KEY IT DOES NOT HAVE — it never verifies", async () => {
    const otherKey = new TextEncoder().encode("b".repeat(MIN_SECRET_BYTES));
    const token = await signAccessToken({ key: otherKey, origin: PREVIEW_ORIGIN, sub: "x", grantId: "mcpOauthGrant.y" });
    expect(decodeJwtPayloadUnsafe(token.token)).toMatchObject({ grant: "mcpOauthGrant.y" });
  });

  it("returns null for anything not shaped like a JWT", () => {
    expect(decodeJwtPayloadUnsafe("not-a-jwt")).toBeNull();
    expect(decodeJwtPayloadUnsafe("a.b")).toBeNull();
    expect(decodeJwtPayloadUnsafe("a.b.c.d")).toBeNull();
    expect(decodeJwtPayloadUnsafe(undefined)).toBeNull();
    expect(decodeJwtPayloadUnsafe(null)).toBeNull();
  });

  it("returns null for a middle segment that is not valid base64url JSON", () => {
    expect(decodeJwtPayloadUnsafe("a.not-json-not-even-base64!!!.c")).toBeNull();
  });

  it("returns null when the decoded segment is valid base64url but not a JSON object", async () => {
    const notAnObject = Buffer.from("[1,2,3]", "utf8").toString("base64url");
    expect(decodeJwtPayloadUnsafe(`a.${notAnObject}.c`)).toBeNull();
    const bareString = Buffer.from('"hello"', "utf8").toString("base64url");
    expect(decodeJwtPayloadUnsafe(`a.${bareString}.c`)).toBeNull();
  });
});

describe("rpc", () => {
  it("builds a JSON-RPC 2.0 envelope, params omitted when undefined", () => {
    expect(rpc("tools/list")).toEqual({ jsonrpc: "2.0", id: 1, method: "tools/list" });
    expect(rpc("tools/call", { name: "ping" }, 7)).toEqual({
      jsonrpc: "2.0",
      id: 7,
      method: "tools/call",
      params: { name: "ping" },
    });
  });
});

describe("checkToolList", () => {
  const readOnly = { readOnlyHint: true, openWorldHint: false };

  it("accepts the exact eight names, in order, all annotated readOnlyHint/openWorldHint", () => {
    const tools = EXPECTED_TOOLS.map((name) => ({ name, annotations: readOnly }));
    expect(checkToolList(tools)).toEqual({ ok: true });
  });

  it("refuses a wrong count or a wrong order", () => {
    const tooFew = EXPECTED_TOOLS.slice(0, 1).map((name) => ({ name, annotations: readOnly }));
    expect(checkToolList(tooFew).ok).toBe(false);

    const reordered = [...EXPECTED_TOOLS].reverse().map((name) => ({ name, annotations: readOnly }));
    expect(checkToolList(reordered).ok).toBe(false);
  });

  it("refuses a tool missing openWorldHint: false (a stale registration)", () => {
    const tools = EXPECTED_TOOLS.map((name) => ({ name, annotations: { readOnlyHint: true } }));
    const result = checkToolList(tools);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.message).toContain(EXPECTED_TOOLS[0]);
  });

  it("refuses a tool declared writable", () => {
    const tools = EXPECTED_TOOLS.map((name) => ({ name, annotations: { readOnlyHint: false, openWorldHint: false } }));
    expect(checkToolList(tools).ok).toBe(false);
  });
});

describe("readCheckArguments", () => {
  it("every fixed tool has {} or a trivial short query, never a write shape", () => {
    for (const name of READ_TOOL_NAMES) {
      if (name === "get_song") continue;
      expect(readCheckArguments(name, null)).toBeTypeOf("object");
    }
    expect(readCheckArguments("search_songs", null)).toEqual({ query: "a" });
  });

  it("get_song takes the songId handed in from search_songs's result", () => {
    expect(readCheckArguments("get_song", "song-123")).toEqual({ songId: "song-123" });
  });

  it("get_song throws (not a per-tool FAIL) when no songId was ever found — a script-ordering bug", () => {
    expect(() => readCheckArguments("get_song", null)).toThrow(/songId/);
  });
});

describe("songIdFromSearchResult", () => {
  it("reads the first song's id, ignoring everything else in the payload", () => {
    expect(songIdFromSearchResult({ songs: [{ id: "song-1", title: "Grande" }, { id: "song-2" }] })).toBe("song-1");
  });

  it("returns null for an empty or malformed payload — never throws", () => {
    expect(songIdFromSearchResult({ songs: [] })).toBeNull();
    expect(songIdFromSearchResult({})).toBeNull();
    expect(songIdFromSearchResult(null)).toBeNull();
    expect(songIdFromSearchResult({ songs: [{}] })).toBeNull();
  });
});

describe("readCheckDetail", () => {
  it("counts only — a payload carrying a name never leaks it into the detail string", () => {
    const detail = readCheckDetail("get_member_availability", {
      members: [{ memberId: "mem-1", name: "Ana Confidencial" }],
    });
    expect(detail).toBe("1 members");
    expect(detail).not.toContain("Ana");
  });

  it("reports both counts for get_participation, and falls back to a fixed word for an unknown shape", () => {
    expect(readCheckDetail("get_participation", { members: [1, 2], services: [1] })).toBe("2 members, 1 services");
    expect(readCheckDetail("get_service", {})).toBe("1 service");
    expect(readCheckDetail("nonexistent_tool", { x: 1 })).toBe("ok");
    expect(readCheckDetail("list_services", null)).toBe("ok");
  });
});

describe("formatReadCheckLine / summarizeReadChecks", () => {
  it("formats a PASS and a FAIL line, and a counts-only summary", () => {
    expect(formatReadCheckLine("list_services", { ok: true, detail: "3 services" })).toBe("  PASS list_services — 3 services");
    expect(formatReadCheckLine("get_song", { ok: false, detail: "HTTP 500" })).toBe("  FAIL get_song — HTTP 500");
    expect(summarizeReadChecks([{ ok: true }, { ok: true }, { ok: false }])).toBe("  reads: 2/3 passed");
  });
});

describe("SmokeError", () => {
  it("formats the server's fixed error (and description, when present)", () => {
    const err = new SmokeError(401, { error: "invalid_token" });
    expect(err.status).toBe(401);
    expect(err.message).toBe("HTTP 401 invalid_token");

    const withDescription = new SmokeError(400, { error: "invalid_request", error_description: "bad thing" });
    expect(withDescription.message).toBe("HTTP 400 invalid_request — bad thing");
  });

  it("names a missing error field rather than throwing on a malformed body", () => {
    expect(new SmokeError(500, null).message).toBe("HTTP 500 (no error field)");
    expect(new SmokeError(500, {}).message).toBe("HTTP 500 (no error field)");
  });
});

describe("a signed client id proves this script's registration contract still matches the server (control)", () => {
  it("verifies through the same jose SignJWT shape the server's tokens.ts produces", async () => {
    // Not a script export — a sanity control that the fixtures above (KEY length,
    // PREVIEW_ORIGIN) are wired the way the real signing functions expect, so a
    // future drift in MIN_SECRET_BYTES fails a test here instead of only in prod.
    const token = await new SignJWT({ typ: "at", iss: PREVIEW_ORIGIN, aud: resourceFor(PREVIEW_ORIGIN), sub: "s", grant: "g", jti: "j" })
      .setProtectedHeader({ alg: "HS256" })
      .setIssuedAt()
      .setExpirationTime("1h")
      .sign(KEY);
    expect(decodeJwtPayloadUnsafe(token)).toMatchObject({ grant: "g" });
  });
});
