// app/mcp/oauth/__tests__/redirects.test.ts
import { describe, it, expect } from "vitest";
import {
  CLAUDE_AI_REDIRECT_URI,
  isLoopbackRedirectUri,
  isRedirectUriAllowed,
  shouldLogRefusedRedirect,
} from "../redirects";
import { LOCAL_ORIGIN, PREVIEW_ORIGIN, PRODUCTION_ORIGIN } from "../origin";

const ALL_ORIGINS = [PRODUCTION_ORIGIN, PREVIEW_ORIGIN, LOCAL_ORIGIN];

const LOOPBACKS = [
  "http://127.0.0.1:51004/oauth2redirect/example-provider",
  "http://localhost:33418/callback",
  "http://127.0.0.1:8080/",
  "http://localhost:1/cb?x=1",
];

describe("claude.ai callback", () => {
  it("is the documented constant", () => {
    expect(CLAUDE_AI_REDIRECT_URI).toBe("https://claude.ai/api/mcp/auth_callback");
  });

  it("is accepted on every origin", () => {
    for (const origin of ALL_ORIGINS) {
      expect(isRedirectUriAllowed(CLAUDE_AI_REDIRECT_URI, origin)).toBe(true);
    }
  });

  it("near misses are refused everywhere (exact string match)", () => {
    const nearMisses = [
      "https://claude.ai/api/mcp/auth_callback/",
      "https://claude.ai/api/mcp/auth_callback?x=1",
      "https://claude.ai/api/mcp/auth_callback#",
      "https://claude.ai/api/mcp/other_callback",
      "https://claude.ai/api/mcp",
      "http://claude.ai/api/mcp/auth_callback",
      "https://Claude.ai/api/mcp/auth_callback",
      "https://claude.ai:443/api/mcp/auth_callback",
      "https://claude.com/api/mcp/auth_callback",
      "https://evil.claude.ai/api/mcp/auth_callback",
      "https://claude.ai.evil.example/api/mcp/auth_callback",
      " https://claude.ai/api/mcp/auth_callback",
      "https://claude.ai/api/mcp/auth_callback ",
    ];
    for (const origin of ALL_ORIGINS) {
      for (const uri of nearMisses) {
        expect(isRedirectUriAllowed(uri, origin), `${uri} @ ${origin}`).toBe(false);
      }
    }
  });
});

describe("loopback (RFC 8252)", () => {
  it("a loopback redirect presented to production is refused", () => {
    for (const uri of LOOPBACKS) {
      expect(isRedirectUriAllowed(uri, PRODUCTION_ORIGIN), uri).toBe(false);
    }
  });

  it("loopback is accepted on preview and local", () => {
    for (const uri of LOOPBACKS) {
      expect(isRedirectUriAllowed(uri, PREVIEW_ORIGIN), uri).toBe(true);
      expect(isRedirectUriAllowed(uri, LOCAL_ORIGIN), uri).toBe(true);
    }
  });

  it("refuses anything that is not a plain http loopback with an explicit port", () => {
    const refused = [
      "https://127.0.0.1:8080/cb", // https is not the loopback scheme
      "http://127.0.0.1/cb", // no port
      "http://localhost/cb",
      "http://127.0.0.1:80/cb", // default port is normalised away → not explicit
      "http://127.0.0.2:8080/cb", // not exactly 127.0.0.1
      "http://[::1]:8080/cb",
      "http://127.1:8080/cb", // non-canonical spelling of 127.0.0.1
      "http://LOCALHOST:8080/cb", // non-canonical case
      "http://localhost.evil.example:8080/cb",
      "http://evil.example:8080/cb",
      "http://user@127.0.0.1:8080/cb", // userinfo
      "http://user:pw@localhost:8080/cb",
      "http://localhost:8080@evil.example/cb", // userinfo that looks like a host
      "http://127.0.0.1:8080/cb#frag", // fragment
      "http://127.0.0.1:8080/cb#", // empty fragment is still a fragment
      "http://127.0.0.1:8080/a/../cb", // non-canonical path
      "http://127.0.0.1:8080/c b", // whitespace
      "http://127.0.0.1:8080/cb\n",
      "http://127.0.0.1:8080\\@evil.example",
      "http://127.0.0.1:8080", // no path: href would differ from the registered string
      "127.0.0.1:8080/cb",
      "",
    ];
    for (const uri of refused) {
      expect(isLoopbackRedirectUri(uri), JSON.stringify(uri)).toBe(false);
      expect(isRedirectUriAllowed(uri, PREVIEW_ORIGIN), JSON.stringify(uri)).toBe(false);
    }
  });

  it("accepts the canonical loopback forms", () => {
    for (const uri of LOOPBACKS) expect(isLoopbackRedirectUri(uri), uri).toBe(true);
  });
});

describe("unknown origin", () => {
  it("allows nothing, not even the claude callback", () => {
    expect(isRedirectUriAllowed(CLAUDE_AI_REDIRECT_URI, "https://evil.example")).toBe(false);
    expect(isRedirectUriAllowed(LOOPBACKS[0], "https://evil.example")).toBe(false);
  });

  it("non-string input is refused", () => {
    expect(isRedirectUriAllowed(undefined, PREVIEW_ORIGIN)).toBe(false);
    expect(isRedirectUriAllowed(["https://claude.ai/api/mcp/auth_callback"], PREVIEW_ORIGIN)).toBe(false);
  });
});

describe("shouldLogRefusedRedirect", () => {
  it("is true for claude.ai / claude.com and their subdomains", () => {
    for (const uri of [
      "https://claude.ai/api/mcp/auth_callback/",
      "https://claude.com/api/mcp/auth_callback",
      "https://www.claude.com/x",
      "https://api.claude.ai/cb",
      "http://claude.ai/api/mcp/auth_callback",
    ]) {
      expect(shouldLogRefusedRedirect(uri), uri).toBe(true);
    }
  });

  it("is false for everything else", () => {
    for (const uri of [
      "https://evilclaude.ai/cb",
      "https://claude.ai.evil.example/cb",
      "https://claude.co/cb",
      "http://127.0.0.1:8080/cb",
      "not a url",
      "",
    ]) {
      expect(shouldLogRefusedRedirect(uri), uri).toBe(false);
    }
    expect(shouldLogRefusedRedirect(undefined)).toBe(false);
  });

  it("refuses a claude host once whitespace/control characters are present (R11: log-injection)", () => {
    // The WHATWG URL parser strips \n and \t before parsing, so a naive
    // hostname check on the PARSED url would still say "claude" for a string
    // that carries a forged log line. The raw string must be rejected first.
    for (const uri of [
      "https://claude.ai/x\n<forged line>",
      "https://claude.ai/x\t<forged>",
      "https://claude.ai/x\r\nSet-Cookie: evil=1",
      "https://claude.ai/\u0000cb",
    ]) {
      expect(shouldLogRefusedRedirect(uri), JSON.stringify(uri)).toBe(false);
    }
  });

  it("refuses a claude host once the raw string exceeds 2048 characters (R11: size cap)", () => {
    const short = `https://claude.ai/${"a".repeat(2000)}`;
    expect(short.length).toBeLessThanOrEqual(2048);
    expect(shouldLogRefusedRedirect(short)).toBe(true);

    const long = `https://claude.ai/${"a".repeat(3000)}`;
    expect(long.length).toBeGreaterThan(2048);
    expect(shouldLogRefusedRedirect(long)).toBe(false);
  });
});
