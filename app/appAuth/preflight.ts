// Native-app sign-in — the signing secret and the ONE preflight every app-door
// route and `requireAppSession` run first (ADR-0091).
//
// The origin rules are the MCP door's (`app/mcp/oauth/origin.ts`, imported,
// never copied): one canonical origin per deployment, chosen by `VERCEL_ENV`;
// the request's `Host` can only match it. The key is a DIFFERENT secret,
// `APP_AUTH_SECRET`, so a token of one door can never verify at the other even
// if a `typ` or `aud` check were dropped. `origin.ts`'s `loadSecret` is
// hard-wired to `MCP_OAUTH_SECRET`, hence this module's own loader.

import { MIN_SECRET_BYTES, resolveOrigin, type OAuthEnv, type RequestHeadersSource } from "@/app/mcp/oauth/origin";

export type AppSecretLoad = { ok: true; key: Uint8Array } | { ok: false };

/** The HS256 key: the UTF-8 bytes of `APP_AUTH_SECRET`, verbatim. Missing or < 32 bytes → refused. */
export function loadAppSecret(env: OAuthEnv = process.env): AppSecretLoad {
  const raw = env.APP_AUTH_SECRET;
  if (typeof raw !== "string") return { ok: false };
  const key = new TextEncoder().encode(raw);
  if (key.byteLength < MIN_SECRET_BYTES) return { ok: false };
  return { ok: true, key };
}

/** `<origin>/api/app` — the one audience of an app access token. */
export function appAudienceFor(origin: string): string {
  return origin + "/api/app";
}

export type AppPreflight =
  | { ok: true; origin: string; key: Uint8Array }
  | { ok: false; status: 404 | 503 };

/**
 * In this order, first refusal wins:
 *  1. `APP_AUTH_DISABLED` non-empty (any value) → 503, the kill switch;
 *  2. `Host` is not this deployment's canonical host → 404;
 *  3. `APP_AUTH_SECRET` missing or < 32 bytes → 503 (fail closed).
 */
export function appPreflight(request: RequestHeadersSource, env: OAuthEnv = process.env): AppPreflight {
  if ((env.APP_AUTH_DISABLED ?? "") !== "") return { ok: false, status: 503 };
  const origin = resolveOrigin(request, env);
  if (!origin) return { ok: false, status: 404 };
  const secret = loadAppSecret(env);
  if (!secret.ok) return { ok: false, status: 503 };
  return { ok: true, origin, key: secret.key };
}
