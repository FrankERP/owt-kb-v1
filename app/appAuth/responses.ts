// Native-app sign-in — the JSON answers of the app door and of
// `requireAppSession`. Fixed codes only; nothing here accepts an Error, so a
// stack, a token or a code has no path into a body. All `no-store`.

import { jsonNoStore } from "@/app/mcp/oauth/responses";

export { jsonNoStore };

/** Preflight refusal: 404 for a foreign host, 503 for the kill switch or a missing secret. */
export function appPreflightResponse(status: 404 | 503): Response {
  return status === 404
    ? jsonNoStore({ error: "not_found" }, 404)
    : jsonNoStore({ error: "temporarily_unavailable" }, 503);
}

/**
 * The guard's 401. `invalid_token` (expired, malformed, revoked: the app
 * refreshes, then signs in) vs `account_disabled` (the member is no longer
 * active: the app signs out AND shows «Tu acceso está desactivado»).
 */
export function appUnauthorizedResponse(cause: "no_token" | "invalid_token" | "account_disabled"): Response {
  const challenge = cause === "no_token" ? "Bearer" : `Bearer error="invalid_token"`;
  return jsonNoStore({ error: cause === "no_token" ? "unauthorized" : cause }, 401, { "WWW-Authenticate": challenge });
}

export function appForbiddenResponse(): Response {
  return jsonNoStore({ error: "forbidden" }, 403);
}

/** A Sanity outage or a missing token: retry later — never read as a sign-out. */
export function appUnavailableResponse(retryAfterSeconds = 5): Response {
  return jsonNoStore({ error: "temporarily_unavailable" }, 503, { "Retry-After": String(retryAfterSeconds) });
}

export type AppTokenErrorCode =
  | "invalid_request"
  | "invalid_client"
  | "invalid_grant"
  | "unsupported_grant_type"
  | "temporarily_unavailable"
  | "server_error";

/**
 * RFC 6749 §5.2 token-endpoint error with a fixed description. 503 for `temporarily_unavailable`,
 * with `Retry-After: 1` unless `retryAfter: false` (the lost refresh race, where retrying the SAME
 * refresh token would be a reuse and revoke the grant).
 */
export function appTokenError(error: AppTokenErrorCode, description?: string, opts: { retryAfter?: boolean } = {}): Response {
  const status = error === "server_error" ? 500 : error === "temporarily_unavailable" ? 503 : 400;
  const body = description === undefined ? { error } : { error, error_description: description };
  const retry = error === "temporarily_unavailable" && opts.retryAfter !== false;
  return jsonNoStore(body, status, retry ? { "Retry-After": "1" } : {});
}
