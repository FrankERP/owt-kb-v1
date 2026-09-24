// MCP OAuth core — every error response the OAuth and MCP routes send.
//
// All of them are small JSON bodies with `Cache-Control: no-store`, built from a
// fixed error code and (optionally) a fixed description. Nothing here ever
// accepts an Error, so a stack trace, a token, a code or a client id has no path
// into a response body.

import { resourceMetadataUrl } from "./origin";

/** A JSON response that no cache may store. */
export function jsonNoStore(body: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      ...headers,
      "Content-Type": "application/json",
      "Cache-Control": "no-store",
    },
  });
}

/** Preflight refusal: a host outside the canonical set. */
export function notFoundResponse(): Response {
  return jsonNoStore({ error: "not_found" }, 404);
}

/** Preflight refusal: kill switch on, or no usable signing secret. Deliberately one body for both. */
export function unavailableResponse(): Response {
  return jsonNoStore({ error: "temporarily_unavailable" }, 503);
}

/**
 * The MCP route's 401 (RFC 6750 + RFC 9728). With no bearer token presented the
 * challenge carries NO `error` (RFC 6750 §3.1); for every other cause —
 * malformed, expired, wrong audience, revoked grant, demoted member —
 * `error="invalid_token"`. Both point at this origin's resource metadata.
 */
export function mcpUnauthorizedResponse(origin: string, cause: "no_token" | "invalid_token"): Response {
  const metadata = `resource_metadata="${resourceMetadataUrl(origin)}"`;
  const challenge =
    cause === "no_token" ? `Bearer ${metadata}` : `Bearer error="invalid_token", ${metadata}`;
  return jsonNoStore(
    { error: cause === "no_token" ? "unauthorized" : "invalid_token" },
    401,
    { "WWW-Authenticate": challenge },
  );
}

export type OAuthTokenErrorCode =
  | "invalid_grant"
  | "invalid_request"
  | "invalid_client"
  | "unsupported_grant_type"
  | "invalid_target"
  | "server_error";

/**
 * RFC 6749 §5.2 token-endpoint error. 400 for every client-side code —
 * including `invalid_client`: our clients are public (`none` auth), and a 401
 * would owe a `WWW-Authenticate` challenge for a scheme we do not offer — and
 * 500 for `server_error`.
 */
export function oauthErrorResponse(error: OAuthTokenErrorCode, description?: string): Response {
  return jsonNoStore(errorBody(error, description), error === "server_error" ? 500 : 400);
}

export type RegistrationErrorCode = "invalid_redirect_uri" | "invalid_client_metadata";

/** RFC 7591 §3.2.2 registration error: always 400. */
export function registrationErrorResponse(error: RegistrationErrorCode, description?: string): Response {
  return jsonNoStore(errorBody(error, description), 400);
}

const MAX_DESCRIPTION_LENGTH = 200;

function errorBody(error: string, description?: string): { error: string; error_description?: string } {
  if (description === undefined) return { error };
  // RFC 6749 §5.2: error_description is %x20-21 / %x23-5B / %x5D-7E — no quote,
  // no backslash, no control characters, so nothing multi-line can ride along.
  const clean = description
    .replace(/[^\x20-\x21\x23-\x5B\x5D-\x7E]/g, "")
    .trim()
    .slice(0, MAX_DESCRIPTION_LENGTH);
  return clean ? { error, error_description: clean } : { error };
}
