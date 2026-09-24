// MCP OAuth core — every token this authorization server mints, and their
// verification. `jose` (direct dependency, exact pin — spec O6), HS256, key =
// the UTF-8 bytes of `MCP_OAUTH_SECRET` (never NEXTAUTH_SECRET).
//
// Four kinds, told apart by the PAYLOAD claim `typ`; every one carries
// `iss = origin`:
//   client — the stateless DCR client id: { redirect_uris, client_name?, iat }, no expiry
//   code   — { sub, client: sha256(client_id), redirect_uri, code_challenge, resource, jti }, 60 s
//   at     — { sub, aud: resource, grant, jti }, 7 d
//   rt     — { sub, grant, jti }, 30 d
//
// Verification pins `algorithms: ["HS256"]`, `issuer: origin`, the exact `typ`,
// and REQUIRES every claim the kind carries (jose `requiredClaims`, plus
// `audience` on access tokens) — never "where present". Any failure of any kind
// returns a typed `{ ok: false }`; nothing throws past this module.

import { createHash, randomUUID } from "node:crypto";
import { SignJWT, errors, jwtVerify, type JWTPayload } from "jose";
import { MIN_SECRET_BYTES, resourceFor } from "./origin";
import { verifyPkce } from "./pkce";

export const CODE_TTL_SECONDS = 60;
export const ACCESS_TOKEN_TTL_SECONDS = 7 * 24 * 60 * 60;
export const REFRESH_TOKEN_TTL_SECONDS = 30 * 24 * 60 * 60;

type TokenKind = "client" | "code" | "at" | "rt";

export type TokenFailure = { ok: false; reason: "invalid" | "expired" };
export type TokenVerification<T> = { ok: true; claims: T } | TokenFailure;

const INVALID: TokenFailure = { ok: false, reason: "invalid" };
const EXPIRED: TokenFailure = { ok: false, reason: "expired" };

/** Lowercase hex SHA-256 of a UTF-8 string. */
export function sha256Hex(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

/** The `client` claim of a code and `clientHash` of a grant: sha256 hex of the WHOLE client_id. */
export function clientHashOf(clientId: string): string {
  return sha256Hex(clientId);
}

interface SignBase {
  key: Uint8Array;
  origin: string;
  /** Clock override for tests; defaults to now. */
  now?: Date;
}

interface VerifyOptions {
  key: Uint8Array;
  origin: string;
  /** Clock override for tests; defaults to now. */
  now?: Date;
}

function epochSeconds(now: Date | undefined): number {
  return Math.floor((now ?? new Date()).getTime() / 1000);
}

async function sign(
  claims: Record<string, unknown>,
  key: Uint8Array,
  now: Date | undefined,
  ttlSeconds: number | null,
): Promise<string> {
  if (!(key instanceof Uint8Array) || key.byteLength < MIN_SECRET_BYTES) {
    throw new Error("MCP OAuth signing key is missing or too short");
  }
  const iat = epochSeconds(now);
  const payload: JWTPayload = { ...claims, iat };
  if (ttlSeconds !== null) payload.exp = iat + ttlSeconds;
  return new SignJWT(payload).setProtectedHeader({ alg: "HS256" }).sign(key);
}

async function verifyKind(
  token: unknown,
  kind: TokenKind,
  opts: VerifyOptions,
  requiredClaims: string[],
  audience?: string,
): Promise<{ ok: true; payload: JWTPayload } | TokenFailure> {
  if (typeof token !== "string" || token === "") return INVALID;
  if (!(opts.key instanceof Uint8Array) || opts.key.byteLength < MIN_SECRET_BYTES) return INVALID;
  try {
    const { payload } = await jwtVerify(token, opts.key, {
      algorithms: ["HS256"],
      issuer: opts.origin,
      ...(audience !== undefined ? { audience } : {}),
      requiredClaims: ["typ", "iss", ...requiredClaims],
      currentDate: opts.now,
    });
    if (payload.typ !== kind || payload.iss !== opts.origin) return INVALID;
    return { ok: true, payload };
  } catch (err) {
    // JWTExpired is only thrown after the signature has verified.
    return err instanceof errors.JWTExpired ? EXPIRED : INVALID;
  }
}

function nonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.length > 0;
}

// ── client id (stateless DCR) ──────────────────────────────────────────────

export interface ClientIdClaims {
  redirectUris: string[];
  clientName: string | null;
  /** Registration time (epoch seconds) — the consent screen shows its age. */
  issuedAt: number;
}

/** Mint a client id. No expiry: DCR clients are long-lived; grants are what get revoked. */
export function signClientId(
  input: SignBase & { redirectUris: readonly string[]; clientName?: string },
): Promise<string> {
  const claims: Record<string, unknown> = {
    typ: "client",
    iss: input.origin,
    redirect_uris: [...input.redirectUris],
  };
  if (input.clientName !== undefined) claims.client_name = input.clientName;
  return sign(claims, input.key, input.now, null);
}

/**
 * Verify a client id minted by THIS origin. Requires typ, iss, iat and a
 * non-empty array of string redirect_uris. Does NOT apply the redirect
 * allowlist — callers re-check every URI with `isRedirectUriAllowed`.
 */
export async function verifyClientId(
  token: unknown,
  opts: VerifyOptions,
): Promise<TokenVerification<ClientIdClaims>> {
  const res = await verifyKind(token, "client", opts, ["iat"]);
  if (!res.ok) return res;
  const { redirect_uris: uris, client_name: name, iat } = res.payload;
  if (!Array.isArray(uris) || uris.length === 0 || !uris.every(nonEmptyString)) return INVALID;
  if (name !== undefined && typeof name !== "string") return INVALID;
  if (typeof iat !== "number") return INVALID;
  return { ok: true, claims: { redirectUris: [...uris], clientName: name ?? null, issuedAt: iat } };
}

// ── authorization code ─────────────────────────────────────────────────────

export interface AuthorizationCodeClaims {
  sub: string;
  /** sha256 hex of the client_id the code was issued to. */
  clientHash: string;
  redirectUri: string;
  codeChallenge: string;
  /** Always `resourceFor(origin)`. */
  resource: string;
  jti: string;
  expiresAt: number;
}

/**
 * Mint a 60 s authorization code bound to the client (by hash), the exact
 * redirect_uri, the S256 challenge and this origin's resource, with a fresh
 * random `jti` (the single-use key `redeemCode` consumes).
 */
export function signAuthorizationCode(
  input: SignBase & { sub: string; clientId: string; redirectUri: string; codeChallenge: string },
): Promise<string> {
  return sign(
    {
      typ: "code",
      iss: input.origin,
      sub: input.sub,
      client: clientHashOf(input.clientId),
      redirect_uri: input.redirectUri,
      code_challenge: input.codeChallenge,
      resource: resourceFor(input.origin),
      jti: randomUUID(),
    },
    input.key,
    input.now,
    CODE_TTL_SECONDS,
  );
}

/**
 * Verify a code minted by THIS origin: signature, typ, iss, exp and every
 * binding claim required, `resource` must be this origin's. Replay is NOT
 * checked here — that is `redeemCode(claims.jti)`.
 */
export async function verifyAuthorizationCode(
  token: unknown,
  opts: VerifyOptions,
): Promise<TokenVerification<AuthorizationCodeClaims>> {
  const res = await verifyKind(token, "code", opts, [
    "exp",
    "sub",
    "client",
    "redirect_uri",
    "code_challenge",
    "resource",
    "jti",
  ]);
  if (!res.ok) return res;
  const p = res.payload;
  if (
    !nonEmptyString(p.sub) ||
    !nonEmptyString(p.client) ||
    !nonEmptyString(p.redirect_uri) ||
    !nonEmptyString(p.code_challenge) ||
    !nonEmptyString(p.jti) ||
    typeof p.exp !== "number" ||
    p.resource !== resourceFor(opts.origin)
  ) {
    return INVALID;
  }
  return {
    ok: true,
    claims: {
      sub: p.sub,
      clientHash: p.client,
      redirectUri: p.redirect_uri,
      codeChallenge: p.code_challenge,
      resource: p.resource,
      jti: p.jti,
      expiresAt: p.exp,
    },
  };
}

export type CodeBindingCheck =
  | { ok: true }
  | { ok: false; reason: "client_mismatch" | "redirect_uri_mismatch" | "pkce_mismatch" };

/**
 * Spec O4 at the token endpoint: the presented client_id, redirect_uri (exact
 * string) and PKCE verifier must match what the code was bound to. Every
 * failure maps to `invalid_grant`.
 */
export function checkCodeBinding(
  claims: AuthorizationCodeClaims,
  presented: { clientId: string; redirectUri: string; codeVerifier: unknown },
): CodeBindingCheck {
  if (clientHashOf(presented.clientId) !== claims.clientHash) return { ok: false, reason: "client_mismatch" };
  if (presented.redirectUri !== claims.redirectUri) return { ok: false, reason: "redirect_uri_mismatch" };
  if (!verifyPkce(presented.codeVerifier, claims.codeChallenge)) return { ok: false, reason: "pkce_mismatch" };
  return { ok: true };
}

// ── access token ───────────────────────────────────────────────────────────

export interface AccessTokenClaims {
  sub: string;
  grantId: string;
  jti: string;
  /** Always `resourceFor(origin)`. */
  resource: string;
  expiresAt: number;
}

/** Mint a 7-day access token with `aud = resourceFor(origin)` and a fresh `jti`. */
export async function signAccessToken(
  input: SignBase & { sub: string; grantId: string },
): Promise<{ token: string; expiresIn: number }> {
  const token = await sign(
    {
      typ: "at",
      iss: input.origin,
      aud: resourceFor(input.origin),
      sub: input.sub,
      grant: input.grantId,
      jti: randomUUID(),
    },
    input.key,
    input.now,
    ACCESS_TOKEN_TTL_SECONDS,
  );
  return { token, expiresIn: ACCESS_TOKEN_TTL_SECONDS };
}

/**
 * Verify an access token minted by THIS origin for THIS resource. `aud` must be
 * exactly the string `resourceFor(origin)` (an array, even one containing it, is
 * refused). Does NOT check the grant or the member — the MCP route does, via
 * `loadGrant` and the live member check.
 */
export async function verifyAccessToken(
  token: unknown,
  opts: VerifyOptions,
): Promise<TokenVerification<AccessTokenClaims>> {
  const resource = resourceFor(opts.origin);
  const res = await verifyKind(token, "at", opts, ["exp", "aud", "sub", "grant", "jti"], resource);
  if (!res.ok) return res;
  const p = res.payload;
  if (
    p.aud !== resource ||
    !nonEmptyString(p.sub) ||
    !nonEmptyString(p.grant) ||
    !nonEmptyString(p.jti) ||
    typeof p.exp !== "number"
  ) {
    return INVALID;
  }
  return { ok: true, claims: { sub: p.sub, grantId: p.grant, jti: p.jti, resource, expiresAt: p.exp } };
}

// ── refresh token ──────────────────────────────────────────────────────────

export interface RefreshTokenClaims {
  sub: string;
  grantId: string;
  jti: string;
  expiresAt: number;
}

/**
 * Mint a 30-day refresh token. Its `jti` is the grant's `currentRefreshJti`, as
 * returned by `createGrant` or `rotateRefresh` — never made up by the caller.
 */
export function signRefreshToken(
  input: SignBase & { sub: string; grantId: string; jti: string },
): Promise<string> {
  return sign(
    { typ: "rt", iss: input.origin, sub: input.sub, grant: input.grantId, jti: input.jti },
    input.key,
    input.now,
    REFRESH_TOKEN_TTL_SECONDS,
  );
}

/**
 * Verify a refresh token minted by THIS origin. Does NOT consult the grant —
 * the token route follows with `loadGrant(id, { fresh: true })` and
 * `rotateRefresh`.
 */
export async function verifyRefreshToken(
  token: unknown,
  opts: VerifyOptions,
): Promise<TokenVerification<RefreshTokenClaims>> {
  const res = await verifyKind(token, "rt", opts, ["exp", "sub", "grant", "jti"]);
  if (!res.ok) return res;
  const p = res.payload;
  if (!nonEmptyString(p.sub) || !nonEmptyString(p.grant) || !nonEmptyString(p.jti) || typeof p.exp !== "number") {
    return INVALID;
  }
  return { ok: true, claims: { sub: p.sub, grantId: p.grant, jti: p.jti, expiresAt: p.exp } };
}
