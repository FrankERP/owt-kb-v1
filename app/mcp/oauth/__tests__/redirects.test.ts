// app/mcp/oauth/__tests__/redirects.test.ts
import { describe, it, expect } from "vitest";
import {
  CHATGPT_REDIRECT_URI,
  CLAUDE_AI_REDIRECT_URI,
  REDIRECT_TARGET_LABEL,
  isLoopbackRedirectUri,
  isRedirectUriAllowed,
  matchRegisteredRedirect,
  redirectTargetKind,
  shouldLogRefusedRedirect,
} from "../redirects";
import { LOCAL_ORIGIN, PREVIEW_ORIGIN, PRODUCTION_ORIGIN } from "../origin";

const ALL_ORIGINS = [PRODUCTION_ORIGIN, PREVIEW_ORIGIN, LOCAL_ORIGIN];

const LOOPBACKS = [
  "http://127.0.0.1:51004/oauth2redirect/example-provider",
  "http://localhost:33418/callback",
  "http://127.0.0.1:8080/",
  "http://localhost:1/cb?x=1",
  "http://127.0.0.1/", // port-less: VS Code registers it and binds a free port at login (RFC 8252 §7.3)
  "http://localhost/cb",
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

describe("ChatGPT callback (ADR-0083)", () => {
  it("is the documented stable constant", () => {
    expect(CHATGPT_REDIRECT_URI).toBe("https://chatgpt.com/connector_platform_oauth_redirect");
  });

  it("is accepted on every known origin", () => {
    for (const origin of ALL_ORIGINS) {
      expect(isRedirectUriAllowed(CHATGPT_REDIRECT_URI, origin)).toBe(true);
      expect(redirectTargetKind(CHATGPT_REDIRECT_URI, origin)).toBe("chatgpt");
    }
  });

  it("near misses and the per-connection form are refused everywhere", () => {
    const refused = [
      "http://chatgpt.com/connector_platform_oauth_redirect",
      "https://chatgpt.com/connector_platform_oauth_redirect/",
      "https://chatgpt.com/connector_platform_oauth_redirect?x=1",
      "https://chatgpt.com/connector_platform_oauth_redirect#",
      "https://CHATGPT.com/connector_platform_oauth_redirect",
      "https://chatgpt.com:443/connector_platform_oauth_redirect",
      "https://chatgpt.com.evil.example/connector_platform_oauth_redirect",
      "https://evil.chatgpt.com/connector_platform_oauth_redirect",
      "https://user@chatgpt.com/connector_platform_oauth_redirect",
      "https://chatgpt.com/connector/oauth/abc123",
      "https://chatgpt.com/connector/oauth/",
      "https://vscode.dev/redirect",
      "https://insiders.vscode.dev/redirect",
      "cursor://anysphere.cursor-mcp/oauth/callback",
    ];
    for (const origin of ALL_ORIGINS) {
      for (const uri of refused) {
        expect(isRedirectUriAllowed(uri, origin), `${uri} @ ${origin}`).toBe(false);
        expect(redirectTargetKind(uri, origin), `${uri} @ ${origin}`).toBeNull();
      }
    }
  });
});

describe("redirectTargetKind", () => {
  it("names each allowed kind, with a consent label", () => {
    expect(redirectTargetKind(CLAUDE_AI_REDIRECT_URI, PRODUCTION_ORIGIN)).toBe("claude");
    expect(redirectTargetKind(CHATGPT_REDIRECT_URI, PRODUCTION_ORIGIN)).toBe("chatgpt");
    expect(redirectTargetKind(LOOPBACKS[0], PRODUCTION_ORIGIN)).toBe("loopback");
    expect(REDIRECT_TARGET_LABEL.claude).toBe("Claude (claude.ai)");
    expect(REDIRECT_TARGET_LABEL.chatgpt).toBe("ChatGPT (chatgpt.com)");
    expect(REDIRECT_TARGET_LABEL.loopback).toBe("Un programa en esta computadora");
  });

  it("refuses everything on an unknown origin", () => {
    for (const uri of [CLAUDE_AI_REDIRECT_URI, CHATGPT_REDIRECT_URI, LOOPBACKS[0]]) {
      expect(redirectTargetKind(uri, "https://evil.example")).toBeNull();
      expect(redirectTargetKind(uri, "")).toBeNull();
    }
    expect(redirectTargetKind(undefined, PRODUCTION_ORIGIN)).toBeNull();
  });
});

describe("loopback (RFC 8252)", () => {
  it("is accepted on every known origin, production included (ADR-0083)", () => {
    for (const uri of LOOPBACKS) {
      for (const origin of ALL_ORIGINS) expect(isRedirectUriAllowed(uri, origin), `${uri} @ ${origin}`).toBe(true);
    }
  });

  it("refuses anything that is not a plain, canonical http loopback", () => {
    const refused = [
      "https://127.0.0.1:8080/cb", // https is not the loopback scheme
      "http://127.0.0.1:80/cb", // default port is normalised away → not canonical
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
      for (const origin of ALL_ORIGINS) {
        expect(isRedirectUriAllowed(uri, origin), `${JSON.stringify(uri)} @ ${origin}`).toBe(false);
      }
    }
  });

  it("accepts the canonical loopback forms", () => {
    for (const uri of LOOPBACKS) expect(isLoopbackRedirectUri(uri), uri).toBe(true);
  });
});

describe("matchRegisteredRedirect (RFC 8252 §7.3 port variance)", () => {
  it("an exactly registered allowed URI matches", () => {
    expect(matchRegisteredRedirect(CLAUDE_AI_REDIRECT_URI, [CLAUDE_AI_REDIRECT_URI], PRODUCTION_ORIGIN)).toBe(true);
    expect(matchRegisteredRedirect(CHATGPT_REDIRECT_URI, [CHATGPT_REDIRECT_URI], PRODUCTION_ORIGIN)).toBe(true);
  });

  it("a loopback URI matches a registered loopback that differs only in its port", () => {
    expect(matchRegisteredRedirect("http://127.0.0.1:54321/", ["http://127.0.0.1/"], PRODUCTION_ORIGIN)).toBe(true);
    expect(matchRegisteredRedirect("http://127.0.0.1/", ["http://127.0.0.1:33418/"], PRODUCTION_ORIGIN)).toBe(true);
    expect(matchRegisteredRedirect("http://localhost:5/cb?a=1", ["http://localhost:9/cb?a=1"], PREVIEW_ORIGIN)).toBe(true);
  });

  it("everything but the port must match, and the hosts are not interchangeable", () => {
    const registered = ["http://127.0.0.1:33418/cb"];
    expect(matchRegisteredRedirect("http://127.0.0.1:5/other", registered, PRODUCTION_ORIGIN)).toBe(false);
    expect(matchRegisteredRedirect("http://localhost:5/cb", registered, PRODUCTION_ORIGIN)).toBe(false);
    expect(matchRegisteredRedirect("http://127.0.0.1:5/cb?x=1", registered, PRODUCTION_ORIGIN)).toBe(false);
    expect(matchRegisteredRedirect("http://127.0.0.1:5/cb", ["http://localhost:33418/cb"], PRODUCTION_ORIGIN)).toBe(false);
  });

  it("a non-loopback URI never matches by anything but exact equality", () => {
    expect(matchRegisteredRedirect(CLAUDE_AI_REDIRECT_URI, ["http://127.0.0.1/"], PRODUCTION_ORIGIN)).toBe(false);
    expect(matchRegisteredRedirect(CHATGPT_REDIRECT_URI, [CLAUDE_AI_REDIRECT_URI], PRODUCTION_ORIGIN)).toBe(false);
  });

  it("O1: a registered URI that is off this origin's list never matches, whatever the client id says", () => {
    expect(matchRegisteredRedirect("https://evil.example/cb", ["https://evil.example/cb"], PRODUCTION_ORIGIN)).toBe(false);
    expect(matchRegisteredRedirect("https://vscode.dev/redirect", ["https://vscode.dev/redirect"], PREVIEW_ORIGIN)).toBe(false);
  });

  it("an unknown origin matches nothing", () => {
    expect(matchRegisteredRedirect(CLAUDE_AI_REDIRECT_URI, [CLAUDE_AI_REDIRECT_URI], "https://evil.example")).toBe(false);
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
  it("is true for claude.ai / claude.com / chatgpt.com / openai.com and their subdomains", () => {
    for (const uri of [
      "https://chatgpt.com/connector/oauth/abc123",
      "https://chatgpt.com/connector_platform_oauth_redirect/",
      "https://auth.openai.com/cb",
      "https://openai.com/x",
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
      "https://chatgpt.com.evil.example/cb",
      "https://evilopenai.com/cb",
      "https://vscode.dev/redirect",
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
      "https://chatgpt.com/x\n<forged line>",
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
