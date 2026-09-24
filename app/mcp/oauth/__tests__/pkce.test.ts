// app/mcp/oauth/__tests__/pkce.test.ts
import { describe, it, expect, vi, beforeEach } from "vitest";

// Wrap timingSafeEqual so the tests can prove WHEN it is (and is not) reached.
vi.mock("node:crypto", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:crypto")>();
  return { ...actual, timingSafeEqual: vi.fn(actual.timingSafeEqual) };
});

import { timingSafeEqual } from "node:crypto";
import {
  isSupportedChallengeMethod,
  isValidCodeChallenge,
  isValidCodeVerifier,
  s256Challenge,
  verifyPkce,
} from "../pkce";

// RFC 7636 Appendix B.
const RFC_VERIFIER = "dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk";
const RFC_CHALLENGE = "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM";

// Block body: a hook that RETURNS a function has it called as teardown.
beforeEach(() => {
  vi.mocked(timingSafeEqual).mockClear();
});

describe("challenge method", () => {
  it("S256 only — plain, absent and wrong case are refused", () => {
    expect(isSupportedChallengeMethod("S256")).toBe(true);
    expect(isSupportedChallengeMethod("plain")).toBe(false);
    expect(isSupportedChallengeMethod("s256")).toBe(false);
    expect(isSupportedChallengeMethod(undefined)).toBe(false);
    expect(isSupportedChallengeMethod(null)).toBe(false);
    expect(isSupportedChallengeMethod("")).toBe(false);
  });
});

describe("verifier shape (RFC 7636 §4.1)", () => {
  it("43–128 chars of [A-Za-z0-9-._~]", () => {
    expect(isValidCodeVerifier("a".repeat(43))).toBe(true);
    expect(isValidCodeVerifier("a".repeat(128))).toBe(true);
    expect(isValidCodeVerifier("Az09-._~".repeat(6))).toBe(true);
    expect(isValidCodeVerifier(RFC_VERIFIER)).toBe(true);
  });

  it("wrong length is refused", () => {
    expect(isValidCodeVerifier("a".repeat(42))).toBe(false);
    expect(isValidCodeVerifier("a".repeat(129))).toBe(false);
    expect(isValidCodeVerifier("")).toBe(false);
  });

  it("wrong charset is refused", () => {
    for (const ch of ["+", "/", "=", " ", "é", "\n", "%"]) {
      expect(isValidCodeVerifier("a".repeat(42) + ch)).toBe(false);
    }
    expect(isValidCodeVerifier(undefined)).toBe(false);
    expect(isValidCodeVerifier(42)).toBe(false);
  });
});

describe("challenge shape", () => {
  it("exactly 43 base64url chars", () => {
    expect(isValidCodeChallenge(RFC_CHALLENGE)).toBe(true);
    expect(isValidCodeChallenge(RFC_CHALLENGE.slice(1))).toBe(false);
    expect(isValidCodeChallenge(RFC_CHALLENGE + "=")).toBe(false);
    expect(isValidCodeChallenge(RFC_CHALLENGE.slice(1) + "+")).toBe(false);
    expect(isValidCodeChallenge(undefined)).toBe(false);
  });
});

describe("verifyPkce", () => {
  it("matches the RFC 7636 Appendix B vector", () => {
    expect(s256Challenge(RFC_VERIFIER)).toBe(RFC_CHALLENGE);
  });

  it("a correct S256 round trip passes through timingSafeEqual", () => {
    const verifier = "x".repeat(20) + "-._~" + "Y".repeat(30);
    expect(verifyPkce(verifier, s256Challenge(verifier))).toBe(true);
    expect(verifyPkce(RFC_VERIFIER, RFC_CHALLENGE)).toBe(true);
    expect(timingSafeEqual).toHaveBeenCalled();
  });

  it("a wrong verifier fails", () => {
    expect(verifyPkce("b".repeat(43), RFC_CHALLENGE)).toBe(false);
  });

  it("plain PKCE (challenge === verifier) fails", () => {
    expect(verifyPkce(RFC_VERIFIER, RFC_VERIFIER)).toBe(false);
  });

  it("a malformed verifier fails without hashing a comparison", () => {
    expect(verifyPkce("a".repeat(42), RFC_CHALLENGE)).toBe(false);
    expect(verifyPkce("a".repeat(129), RFC_CHALLENGE)).toBe(false);
    expect(verifyPkce(RFC_VERIFIER.slice(0, 42) + "+", RFC_CHALLENGE)).toBe(false);
    expect(verifyPkce(undefined, RFC_CHALLENGE)).toBe(false);
    expect(timingSafeEqual).not.toHaveBeenCalled();
  });

  it("unequal lengths → false without calling timingSafeEqual", () => {
    expect(verifyPkce(RFC_VERIFIER, RFC_CHALLENGE.slice(1))).toBe(false);
    expect(verifyPkce(RFC_VERIFIER, RFC_CHALLENGE + "A")).toBe(false);
    expect(verifyPkce(RFC_VERIFIER, "")).toBe(false);
    expect(verifyPkce(RFC_VERIFIER, undefined)).toBe(false);
    expect(timingSafeEqual).not.toHaveBeenCalled();
  });
});
