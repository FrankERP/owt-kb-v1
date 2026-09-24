// MCP OAuth core — PKCE (RFC 7636), S256 only. `plain` (and an absent method,
// which RFC 7636 defaults to `plain`) is refused.

import { createHash, timingSafeEqual } from "node:crypto";

const VERIFIER_RE = /^[A-Za-z0-9\-._~]{43,128}$/;
/** base64url(sha256(…)) without padding is always exactly 43 characters. */
const CHALLENGE_RE = /^[A-Za-z0-9_-]{43}$/;

/** True only for exactly `"S256"`. */
export function isSupportedChallengeMethod(method: unknown): method is "S256" {
  return method === "S256";
}

/** RFC 7636 §4.1: 43–128 characters of `[A-Za-z0-9-._~]`. */
export function isValidCodeVerifier(verifier: unknown): verifier is string {
  return typeof verifier === "string" && VERIFIER_RE.test(verifier);
}

/** An S256 challenge's shape: exactly 43 base64url characters, no padding. */
export function isValidCodeChallenge(challenge: unknown): challenge is string {
  return typeof challenge === "string" && CHALLENGE_RE.test(challenge);
}

/** `BASE64URL(SHA256(ASCII(verifier)))` (RFC 7636 §4.2). */
export function s256Challenge(verifier: string): string {
  return createHash("sha256").update(verifier, "ascii").digest("base64url");
}

/**
 * Whether `verifier` answers `challenge` under S256. A malformed verifier fails
 * before any comparison; unequal lengths fail without calling
 * `timingSafeEqual` (which throws on them); equal lengths are compared in
 * constant time.
 */
export function verifyPkce(verifier: unknown, challenge: unknown): boolean {
  if (!isValidCodeVerifier(verifier) || typeof challenge !== "string") return false;
  const expected = Buffer.from(s256Challenge(verifier), "utf8");
  const presented = Buffer.from(challenge, "utf8");
  if (expected.length !== presented.length) return false;
  return timingSafeEqual(expected, presented);
}
