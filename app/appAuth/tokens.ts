// Native-app sign-in — every token the app door mints, and their verification
// (ADR-0091, spec D2/D7). HS256 with the UTF-8 bytes of `APP_AUTH_SECRET`
// (never `MCP_OAUTH_SECRET`, never `NEXTAUTH_SECRET`). Three kinds, told apart
// by the payload claim `typ`, every one with `iss = origin`:
//   app-code — { sub, client, redirect_uri, code_challenge, jti }, 60 s
//   app-at   — { sub, aud: <origin>/api/app, grant, jti }, 1 h
//   app-rt   — { sub, grant, jti }, 90 d
// The `typ` values never collide with the MCP door's (`code`, `at`, `rt`).
//
// Verification pins `algorithms: ["HS256"]`, `issuer`, the exact `typ`, and
// REQUIRES every claim the kind carries. Any failure returns a typed
// `{ ok: false }`; nothing throws past this module.

import { randomUUID } from "node:crypto";
import { SignJWT, errors, jwtVerify, type JWTPayload } from "jose";
import { MIN_SECRET_BYTES } from "@/app/mcp/oauth/origin";
import { verifyPkce } from "@/app/mcp/oauth/pkce";
import { appAudienceFor } from "./preflight";
import { isAppClientId, type AppClientId } from "./clients";

export const APP_CODE_TTL_SECONDS = 60;
export const APP_ACCESS_TOKEN_TTL_SECONDS = 60 * 60;
export const APP_REFRESH_TOKEN_TTL_SECONDS = 90 * 24 * 60 * 60;

type Kind = "app-code" | "app-at" | "app-rt";

export type AppTokenFailure = { ok: false; reason: "invalid" | "expired" };
export type AppTokenVerification<T> = { ok: true; claims: T } | AppTokenFailure;

const INVALID: AppTokenFailure = { ok: false, reason: "invalid" };
const EXPIRED: AppTokenFailure = { ok: false, reason: "expired" };

interface Ctx {
  key: Uint8Array;
  origin: string;
  /** Clock override for tests; defaults to now. */
  now?: Date;
}

function usableKey(key: unknown): key is Uint8Array {
  return key instanceof Uint8Array && key.byteLength >= MIN_SECRET_BYTES;
}

async function sign(claims: Record<string, unknown>, ctx: Ctx, ttlSeconds: number): Promise<string> {
  if (!usableKey(ctx.key)) throw new Error("app sign-in key is missing or too short");
  const iat = Math.floor((ctx.now ?? new Date()).getTime() / 1000);
  const payload: JWTPayload = { ...claims, iss: ctx.origin, iat, exp: iat + ttlSeconds };
  return new SignJWT(payload).setProtectedHeader({ alg: "HS256" }).sign(ctx.key);
}

async function verifyKind(
  token: unknown,
  kind: Kind,
  ctx: Ctx,
  requiredClaims: string[],
  audience?: string,
): Promise<{ ok: true; payload: JWTPayload } | AppTokenFailure> {
  if (typeof token !== "string" || token === "") return INVALID;
  if (!usableKey(ctx.key)) return INVALID;
  try {
    const { payload } = await jwtVerify(token, ctx.key, {
      algorithms: ["HS256"],
      issuer: ctx.origin,
      ...(audience !== undefined ? { audience } : {}),
      requiredClaims: ["typ", "iss", "exp", ...requiredClaims],
      currentDate: ctx.now,
    });
    if (payload.typ !== kind || payload.iss !== ctx.origin) return INVALID;
    return { ok: true, payload };
  } catch (err) {
    // `expired` only for an expired token of THIS kind (jose checks exp before our typ check).
    if (err instanceof errors.JWTExpired && err.payload?.typ === kind) return EXPIRED;
    return INVALID;
  }
}

function nonEmpty(value: unknown): value is string {
  return typeof value === "string" && value.length > 0;
}

// ── authorization code ─────────────────────────────────────────────────────

export interface AppCodeClaims {
  sub: string;
  clientId: AppClientId;
  redirectUri: string;
  codeChallenge: string;
  jti: string;
}

/** A 60 s code bound to the person, the client, the exact redirect and the S256 challenge. */
export function signAppCode(
  input: Ctx & { sub: string; clientId: AppClientId; redirectUri: string; codeChallenge: string },
): Promise<string> {
  return sign(
    {
      typ: "app-code",
      sub: input.sub,
      client: input.clientId,
      redirect_uri: input.redirectUri,
      code_challenge: input.codeChallenge,
      jti: randomUUID(),
    },
    input,
    APP_CODE_TTL_SECONDS,
  );
}

/** Verifies signature, typ, iss, expiry and every binding claim. Replay is the store's `redeemCode`. */
export async function verifyAppCode(token: unknown, ctx: Ctx): Promise<AppTokenVerification<AppCodeClaims>> {
  const res = await verifyKind(token, "app-code", ctx, ["sub", "client", "redirect_uri", "code_challenge", "jti"]);
  if (!res.ok) return res;
  const p = res.payload;
  if (!nonEmpty(p.sub) || !isAppClientId(p.client) || !nonEmpty(p.redirect_uri) || !nonEmpty(p.code_challenge) || !nonEmpty(p.jti)) {
    return INVALID;
  }
  return {
    ok: true,
    claims: { sub: p.sub, clientId: p.client, redirectUri: p.redirect_uri, codeChallenge: p.code_challenge, jti: p.jti },
  };
}

/** The token endpoint's binding check: same client, exact redirect, PKCE verifier. */
export function appCodeBindingHolds(
  claims: AppCodeClaims,
  presented: { clientId: string; redirectUri: string; codeVerifier: unknown },
): boolean {
  return (
    presented.clientId === claims.clientId &&
    presented.redirectUri === claims.redirectUri &&
    verifyPkce(presented.codeVerifier, claims.codeChallenge)
  );
}

// ── access token ───────────────────────────────────────────────────────────

export interface AppAccessClaims {
  sub: string;
  grantId: string;
  jti: string;
}

export async function signAppAccessToken(
  input: Ctx & { sub: string; grantId: string },
): Promise<{ token: string; expiresIn: number }> {
  const token = await sign(
    { typ: "app-at", aud: appAudienceFor(input.origin), sub: input.sub, grant: input.grantId, jti: randomUUID() },
    input,
    APP_ACCESS_TOKEN_TTL_SECONDS,
  );
  return { token, expiresIn: APP_ACCESS_TOKEN_TTL_SECONDS };
}

/** `aud` must be EXACTLY the string `<origin>/api/app` (an array is refused). */
export async function verifyAppAccessToken(token: unknown, ctx: Ctx): Promise<AppTokenVerification<AppAccessClaims>> {
  const audience = appAudienceFor(ctx.origin);
  const res = await verifyKind(token, "app-at", ctx, ["aud", "sub", "grant", "jti"], audience);
  if (!res.ok) return res;
  const p = res.payload;
  if (p.aud !== audience || !nonEmpty(p.sub) || !nonEmpty(p.grant) || !nonEmpty(p.jti)) return INVALID;
  return { ok: true, claims: { sub: p.sub, grantId: p.grant, jti: p.jti } };
}

// ── refresh token ──────────────────────────────────────────────────────────

export interface AppRefreshClaims {
  sub: string;
  grantId: string;
  jti: string;
}

/** Its `jti` is the grant's `currentRefreshJti`, as the store returned it — never made up. */
export function signAppRefreshToken(input: Ctx & { sub: string; grantId: string; jti: string }): Promise<string> {
  return sign({ typ: "app-rt", sub: input.sub, grant: input.grantId, jti: input.jti }, input, APP_REFRESH_TOKEN_TTL_SECONDS);
}

export async function verifyAppRefreshToken(token: unknown, ctx: Ctx): Promise<AppTokenVerification<AppRefreshClaims>> {
  const res = await verifyKind(token, "app-rt", ctx, ["sub", "grant", "jti"]);
  if (!res.ok) return res;
  const p = res.payload;
  if (!nonEmpty(p.sub) || !nonEmpty(p.grant) || !nonEmpty(p.jti)) return INVALID;
  return { ok: true, claims: { sub: p.sub, grantId: p.grant, jti: p.jti } };
}
