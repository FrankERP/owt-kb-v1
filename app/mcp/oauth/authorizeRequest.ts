// MCP OAuth — the ONE authorize-request validator (ruling R18), shared by the
// consent page (`app/(client)/oauth/authorize/page.tsx`) and the POST that
// mints codes (`app/api/oauth/authorize/route.ts`). The POST re-runs it on the
// posted fields and never trusts the page.
//
// Pure: no session, no `server-only`, no Sanity. It reads the raw parameters,
// this deployment's origin and the signing key, and returns exactly one of:
//
//   render         — every rule held; the normalized request to show and post
//   error-page     — the client or its redirect target could not be VERIFIED,
//                    so nothing may be redirected anywhere (RFC 6749 §4.1.2.1:
//                    an unverified redirect target is never followed)
//   error-redirect — the redirect target IS verified, so the error goes back
//                    to it with `error`, `state` (when there was exactly one)
//                    and `iss` (RFC 9207)
//
// Rules, in this order:
//   1. `client_id` present once and verifies for THIS origin (its `iss`), else error-page;
//   2. `redirect_uri` present once, EXACTLY one of the client's registered URIs,
//      AND on this origin's allowlist — re-checked here, never trusted from the
//      client token alone (spec O1) — else error-page. A refused claude-host URI
//      is logged, as registration does;
//   3. no other authorize parameter repeated, else invalid_request (RFC 6749
//      §3.1). `resource` is the exception: RFC 8707 §2 allows it more than
//      once, and `resolveResource` requires every copy to equal ours;
//   4. `response_type` present (else invalid_request) and exactly `code`
//      (else unsupported_response_type);
//   5. `code_challenge_method` exactly `S256` and a well-formed challenge —
//      `plain`, an absent method (RFC 7636 defaults it to plain) and a
//      missing challenge are all invalid_request;
//   6. `resource` resolves to this origin's resource, else invalid_target;
//   `scope` — absent or unknown — is accepted and ignored (one implicit
//   scope); `state` is carried through unchanged; unrecognized parameters are
//   ignored (RFC 6749 §3.1).

import { resolveResource } from "./origin";
import { isSupportedChallengeMethod, isValidCodeChallenge } from "./pkce";
import { isRedirectUriAllowed, shouldLogRefusedRedirect } from "./redirects";
import { verifyClientId } from "./tokens";

/** The authorize parameters that may appear at most once (RFC 6749 §3.1). */
const SINGLE_VALUED_PARAMS = [
  "response_type",
  "client_id",
  "redirect_uri",
  "scope",
  "state",
  "code_challenge",
  "code_challenge_method",
] as const;

/** A validated, normalized authorization request — exactly what the consent form posts back. */
export interface ValidatedAuthorizeRequest {
  clientId: string;
  /** Verified: one of the client's registered URIs AND on this origin's allowlist. */
  redirectUri: string;
  responseType: "code";
  codeChallenge: string;
  codeChallengeMethod: "S256";
  /** Always this origin's resource (`resourceFor(origin)`), whether or not the client sent one. */
  resource: string;
  /** Carried through unchanged; null when the request had none. */
  state: string | null;
}

export type AuthorizeErrorPageReason = "invalid_client" | "invalid_redirect_uri";

export type AuthorizeRedirectError =
  | "invalid_request"
  | "unsupported_response_type"
  | "invalid_target"
  | "access_denied";

export type AuthorizeValidation =
  | {
      kind: "render";
      request: ValidatedAuthorizeRequest;
      client: {
        /** Self-declared at registration and NOT verified; null when none was registered. */
        name: string | null;
        /** Registration time (epoch seconds), from the client id's `iat`. */
        issuedAt: number;
        /** Seconds since registration, never negative. */
        ageSeconds: number;
      };
    }
  | { kind: "error-page"; reason: AuthorizeErrorPageReason }
  | { kind: "error-redirect"; error: AuthorizeRedirectError; location: string };

export interface AuthorizeContext {
  /** This deployment's canonical origin — from `mcpRoutePreflight`, never from the request. */
  origin: string;
  /** The HS256 key — from `mcpRoutePreflight`. */
  key: Uint8Array;
  /** Clock override for tests; defaults to now. */
  now?: Date;
}

/** Fixed, internals-free `error_description`s (RFC 6749 §4.1.2.1 charset). */
const DESCRIPTION = {
  duplicate: "a parameter was sent more than once",
  missingResponseType: "response_type is required",
  unsupportedResponseType: "only response_type code is supported",
  pkce: "PKCE with code_challenge_method S256 is required",
  invalidTarget: "resource is not this server's MCP resource",
} as const;

/**
 * `redirectUri` with `params` appended to its query. The URI's own query is
 * kept byte for byte (RFC 6749 §3.1.2: it MUST be retained) and each value is
 * encoded exactly once. A null/undefined value is omitted; an empty string is
 * sent as empty.
 */
export function authorizationResponseUrl(
  redirectUri: string,
  params: Record<string, string | null | undefined>,
): string {
  const url = new URL(redirectUri);
  const extra = new URLSearchParams();
  for (const [name, value] of Object.entries(params)) {
    if (value !== null && value !== undefined) extra.append(name, value);
  }
  const existing = url.search.slice(1);
  url.search = existing ? `${existing}&${extra.toString()}` : extra.toString();
  return url.href;
}

/** The error redirect for a request whose redirect_uri has already been verified. */
export function authorizeErrorLocation(
  redirectUri: string,
  origin: string,
  error: AuthorizeRedirectError,
  state: string | null,
  description?: string,
): string {
  return authorizationResponseUrl(redirectUri, {
    error,
    ...(description !== undefined ? { error_description: description } : {}),
    state,
    iss: origin,
  });
}

/**
 * The consent form's hidden fields for a validated request, in a fixed order.
 * Re-validating them yields the same request, which is what the POST does.
 * `state` is included only when the request had one (an empty one included).
 */
export function authorizeFormFields(request: ValidatedAuthorizeRequest): [string, string][] {
  const fields: [string, string][] = [
    ["response_type", request.responseType],
    ["client_id", request.clientId],
    ["redirect_uri", request.redirectUri],
    ["code_challenge", request.codeChallenge],
    ["code_challenge_method", request.codeChallengeMethod],
    ["resource", request.resource],
  ];
  if (request.state !== null) fields.push(["state", request.state]);
  return fields;
}

/**
 * A page's `searchParams` record as `URLSearchParams`, repeated parameters
 * kept (Next gives them as arrays) so the validator can refuse them.
 */
export function searchParamsFromRecord(record: Record<string, string | string[] | undefined>): URLSearchParams {
  const params = new URLSearchParams();
  for (const [name, value] of Object.entries(record)) {
    if (value === undefined) continue;
    for (const v of Array.isArray(value) ? value : [value]) params.append(name, v);
  }
  return params;
}

/** Same line, same encoding as registration's (`app/api/oauth/register/route.ts`). */
function logRefusedRedirect(uri: string): void {
  if (shouldLogRefusedRedirect(uri)) {
    // Never the client_id, never the state — just the refused URI.
    console.warn("[mcp-oauth] refused redirect_uri from a claude host:", JSON.stringify(uri));
  }
}

/** Validates an authorization request. Never throws; see the header for the rules. */
export async function validateAuthorizeRequest(
  params: URLSearchParams,
  ctx: AuthorizeContext,
): Promise<AuthorizeValidation> {
  const { origin, key } = ctx;
  const now = ctx.now ?? new Date();

  // 1. The client — or an error page.
  const clientIds = params.getAll("client_id");
  if (clientIds.length !== 1) return { kind: "error-page", reason: "invalid_client" };
  const clientId = clientIds[0]!;
  const client = await verifyClientId(clientId, { key, origin, now });
  if (!client.ok) return { kind: "error-page", reason: "invalid_client" };

  // 2. The redirect target — or an error page. Nothing below may run until it
  //    is verified, because everything below redirects to it.
  const redirectUris = params.getAll("redirect_uri");
  if (redirectUris.length !== 1) return { kind: "error-page", reason: "invalid_redirect_uri" };
  const redirectUri = redirectUris[0]!;
  if (!client.claims.redirectUris.includes(redirectUri) || !isRedirectUriAllowed(redirectUri, origin)) {
    logRefusedRedirect(redirectUri);
    return { kind: "error-page", reason: "invalid_redirect_uri" };
  }

  // From here on every error goes back to the verified redirect_uri.
  const states = params.getAll("state");
  const state = states.length === 1 ? states[0]! : null;
  const fail = (error: AuthorizeRedirectError, description: string): AuthorizeValidation => ({
    kind: "error-redirect",
    error,
    location: authorizeErrorLocation(redirectUri, origin, error, state, description),
  });

  // 3. No repeated parameter (a repeated `state` is not echoed: `state` is null above).
  if (SINGLE_VALUED_PARAMS.some((name) => params.getAll(name).length > 1)) {
    return fail("invalid_request", DESCRIPTION.duplicate);
  }

  // 4. response_type.
  const responseType = params.get("response_type");
  if (responseType === null) {
    return fail("invalid_request", DESCRIPTION.missingResponseType);
  }
  if (responseType !== "code") {
    return fail("unsupported_response_type", DESCRIPTION.unsupportedResponseType);
  }

  // 5. PKCE, S256 only.
  const method = params.get("code_challenge_method");
  const codeChallenge = params.get("code_challenge");
  if (!isSupportedChallengeMethod(method) || !isValidCodeChallenge(codeChallenge)) {
    return fail("invalid_request", DESCRIPTION.pkce);
  }

  // 6. resource (RFC 8707).
  const resource = resolveResource(params.getAll("resource"), origin);
  if (!resource.ok) return fail("invalid_target", DESCRIPTION.invalidTarget);

  const issuedAt = client.claims.issuedAt;
  return {
    kind: "render",
    request: {
      clientId,
      redirectUri,
      responseType: "code",
      codeChallenge,
      codeChallengeMethod: "S256",
      resource: resource.resource,
      state,
    },
    client: {
      name: client.claims.clientName,
      issuedAt,
      ageSeconds: Math.max(0, Math.floor(now.getTime() / 1000) - issuedAt),
    },
  };
}
