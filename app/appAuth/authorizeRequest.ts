// Native-app sign-in — the ONE authorize-request validator, shared by the
// confirmation page (`/app/authorize`) and the POST that mints codes
// (`/app/authorize/submit`), which re-runs it on the posted fields and never
// trusts the page (ADR-0091, spec §3.1). Pure: no session, no Sanity.
//
// Rules, in this order, first failure wins:
//   1. `client_id` present once and one of the two app clients → else error PAGE;
//   2. `redirect_uri` present once and EXACTLY one of that client's redirects
//      for THIS origin (the scheme only on localhost) → else error PAGE — an
//      unverified target is never redirected to;
//   3. no parameter repeated → invalid_request (error REDIRECT from here on);
//   4. `response_type` exactly `code`;
//   5. PKCE: `code_challenge_method` exactly `S256` and a well-formed challenge;
//   6. `state` present, 16–256 printable ASCII;
//   7. `scope` and `resource` absent (one implicit scope, one audience).
// Unknown parameters are ignored (RFC 6749 §3.1).

import { authorizationResponseUrl } from "@/app/mcp/oauth/authorizeRequest";
import { isSupportedChallengeMethod, isValidCodeChallenge } from "@/app/mcp/oauth/pkce";
import { isAppClientId, isRedirectAllowed, type AppClientId } from "./clients";

const SINGLE_VALUED = [
  "response_type",
  "client_id",
  "redirect_uri",
  "state",
  "code_challenge",
  "code_challenge_method",
  "scope",
  "resource",
] as const;

const STATE_RE = /^[\x21-\x7E]{16,256}$/;

export interface ValidatedAppAuthorize {
  clientId: AppClientId;
  redirectUri: string;
  codeChallenge: string;
  state: string;
}

export type AppAuthorizeError = "invalid_request" | "unsupported_response_type" | "invalid_scope" | "access_denied";

export type AppAuthorizeValidation =
  | { kind: "render"; request: ValidatedAppAuthorize }
  | { kind: "error-page"; reason: "invalid_client" | "invalid_redirect_uri" }
  | { kind: "error-redirect"; error: AppAuthorizeError; location: string };

/** The error redirect to an already-verified redirect_uri, with `state` and `iss` (RFC 9207). */
export function appAuthorizeErrorLocation(
  redirectUri: string,
  origin: string,
  error: AppAuthorizeError,
  state: string | null,
): string {
  return authorizationResponseUrl(redirectUri, { error, state, iss: origin });
}

/** The success redirect: the code, the state and the issuer. */
export function appAuthorizeSuccessLocation(redirectUri: string, origin: string, code: string, state: string): string {
  return authorizationResponseUrl(redirectUri, { code, state, iss: origin });
}

/** The confirmation form's hidden fields, in a fixed order; re-validating them yields the same request. */
export function appAuthorizeFormFields(request: ValidatedAppAuthorize): [string, string][] {
  return [
    ["response_type", "code"],
    ["client_id", request.clientId],
    ["redirect_uri", request.redirectUri],
    ["code_challenge", request.codeChallenge],
    ["code_challenge_method", "S256"],
    ["state", request.state],
  ];
}

export function validateAppAuthorizeRequest(params: URLSearchParams, origin: string): AppAuthorizeValidation {
  const clientIds = params.getAll("client_id");
  if (clientIds.length !== 1 || !isAppClientId(clientIds[0])) return { kind: "error-page", reason: "invalid_client" };
  const clientId = clientIds[0];

  const redirectUris = params.getAll("redirect_uri");
  if (redirectUris.length !== 1 || !isRedirectAllowed(clientId, redirectUris[0], origin)) {
    return { kind: "error-page", reason: "invalid_redirect_uri" };
  }
  const redirectUri = redirectUris[0]!;

  const states = params.getAll("state");
  const state = states.length === 1 ? states[0]! : null;
  const fail = (error: AppAuthorizeError): AppAuthorizeValidation => ({
    kind: "error-redirect",
    error,
    location: appAuthorizeErrorLocation(redirectUri, origin, error, state),
  });

  if (SINGLE_VALUED.some((name) => params.getAll(name).length > 1)) return fail("invalid_request");
  const responseType = params.get("response_type");
  if (responseType === null) return fail("invalid_request");
  if (responseType !== "code") return fail("unsupported_response_type");
  const method = params.get("code_challenge_method");
  const codeChallenge = params.get("code_challenge");
  if (!isSupportedChallengeMethod(method) || !isValidCodeChallenge(codeChallenge)) return fail("invalid_request");
  if (state === null || !STATE_RE.test(state)) return fail("invalid_request");
  if (params.has("scope") || params.has("resource")) return fail("invalid_scope");

  return { kind: "render", request: { clientId, redirectUri, codeChallenge, state } };
}
