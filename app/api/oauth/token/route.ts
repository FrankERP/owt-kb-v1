// app/api/oauth/token/route.ts
//
// The OAuth token endpoint (P0 plan step 8, spec O1/O2/O4/O6) — the ONLY place
// grants are created and refresh tokens rotate. Two grants:
//
//   authorization_code — the code verifies (signature, typ, iss, 60 s); the
//     client_id verifies for THIS origin and hashes to the code's `client`; the
//     presented redirect_uri equals the code's exactly, is one of the client's
//     registered URIs AND is on this origin's allowlist (re-checked here, never
//     trusted from the code or the client id — O1); the PKCE verifier matches;
//     a `resource`, if sent, is the code's; the subject is still a live,
//     non-disabled super-admin (O2). Only THEN is the code redeemed — a
//     `create()` that fails on conflict, so a replay is refused (O4) — and a
//     grant created.
//   refresh_token — the refresh token verifies; the grant is read FRESH (never
//     from the 30 s cache, which only the MCP route's revocation check may use);
//     a missing or revoked grant, a client_id that does not hash to the grant's
//     `clientHash` (RFC 6749 §6), a refresh token whose `sub` is not the grant's
//     (R13) or a subject who is no longer a live super-admin are all refused;
//     then `rotateRefresh` — which refuses a foreign-origin grant (R9), revokes
//     the WHOLE grant on a superseded jti (O4) and refuses without revoking on a
//     lost revision race.
//
// Tokens are issued only after a successful redemption + grant creation, or a
// successful rotation. Every refusal is an RFC 6749 §5.2 JSON error with a fixed
// description; nothing presented is ever echoed, and nothing here logs a token,
// a code, a verifier or a client_id — a server failure logs a fixed stage name
// and, at most, the Sanity status code.
//
// Ungated: excluded from the session middleware at the exact path
// `api/oauth/token$` (`app/utils/routeMatcher.ts`, P0 step 5). Public clients
// only (`token_endpoint_auth_method: "none"`), so any client authentication —
// a `client_secret` or an `Authorization: Basic` header — is `invalid_client`.

import { getMemberAccess } from "@/app/utils/memberAccess";
import { createGrant, loadGrant, redeemCode, rotateRefresh } from "@/app/mcp/oauth/grantStore";
import { mcpRoutePreflight } from "@/app/mcp/oauth/guard";
import { resolveResource } from "@/app/mcp/oauth/origin";
import { isRedirectUriAllowed } from "@/app/mcp/oauth/redirects";
import { jsonNoStore, oauthErrorResponse } from "@/app/mcp/oauth/responses";
import {
  checkCodeBinding,
  clientHashOf,
  signAccessToken,
  signRefreshToken,
  verifyAuthorizationCode,
  verifyClientId,
  verifyRefreshToken,
} from "@/app/mcp/oauth/tokens";

export const dynamic = "force-dynamic";
export const revalidate = 0;

/**
 * Cap on the bytes actually read. The largest valid form carries a client id
 * (a signed token over a registration of at most 4 KB) and a code that embeds
 * one of its redirect URIs — both base64url, so ~4/3 their payload — plus a
 * verifier of at most 128 characters. Same cap as the consent POST.
 */
const MAX_BODY_BYTES = 32 * 1024;

const FORM_MEDIA_TYPE = "application/x-www-form-urlencoded";

/**
 * Parameters that may appear at most once (RFC 6749 §3.2). `resource` is the
 * exception, as at authorize (R20): RFC 8707 §2 allows it more than once, and
 * `resolveResource` requires every copy to equal this origin's resource.
 */
const SINGLE_VALUED_PARAMS = [
  "grant_type",
  "code",
  "redirect_uri",
  "client_id",
  "code_verifier",
  "refresh_token",
  "scope",
  "client_secret",
] as const;

/** Fixed, internals-free `error_description`s. */
const DESCRIPTION = {
  contentType: `Content-Type must be ${FORM_MEDIA_TYPE}`,
  tooLarge: "request body too large",
  notUtf8: "request body is not UTF-8",
  duplicate: "a parameter was sent more than once",
  clientAuthentication: "client authentication is not supported: clients are public",
  missingGrantType: "grant_type is required",
  unsupportedGrantType: "only authorization_code and refresh_token are supported",
  codeParams: "code, redirect_uri, client_id and code_verifier are required",
  refreshParams: "refresh_token and client_id are required",
  invalidClient: "client_id is not valid for this server",
  invalidGrant: "the grant is invalid, expired, revoked or was issued to another client",
  invalidTarget: "resource is not this server's MCP resource",
} as const;

/** What a server failure names in the log — a fixed stage, never the error. */
type FailureStage =
  | "member lookup"
  | "code redemption"
  | "grant creation"
  | "grant read"
  | "refresh rotation"
  | "token signing";

const invalidRequest = (description: string) => oauthErrorResponse("invalid_request", description);
const invalidClient = () => oauthErrorResponse("invalid_client", DESCRIPTION.invalidClient);
const invalidGrant = () => oauthErrorResponse("invalid_grant", DESCRIPTION.invalidGrant);
const invalidTarget = () => oauthErrorResponse("invalid_target", DESCRIPTION.invalidTarget);

/**
 * A fixed 500. The log line carries the stage and, when the cause has one, a
 * numeric status code — never the cause's message, which is Sanity's text.
 */
function serverError(stage: FailureStage, cause?: unknown): Response {
  const status =
    typeof cause === "object" && cause !== null && typeof (cause as { statusCode?: unknown }).statusCode === "number"
      ? (cause as { statusCode: number }).statusCode
      : null;
  console.error(`[mcp-oauth] token: ${stage} failed${status !== null ? ` (status ${status})` : ""}`);
  return oauthErrorResponse("server_error");
}

function isFormContentType(header: string | null): boolean {
  if (!header) return false;
  // Ignore parameters (e.g. `; charset=UTF-8`) — the media type is what matters.
  return header.split(";")[0]?.trim().toLowerCase() === FORM_MEDIA_TYPE;
}

type BodyReadResult = { ok: true; bytes: Uint8Array } | { ok: false };

/**
 * Reads the body, aborting the moment more than `maxBytes` have arrived — the
 * cap applies to what is actually read, never only to a declared
 * Content-Length. Same shape as registration's and the consent POST's.
 */
async function readCappedBody(request: Request, maxBytes: number): Promise<BodyReadResult> {
  const reader = request.body?.getReader();
  if (!reader) return { ok: true, bytes: new Uint8Array(0) };
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    if (value && value.byteLength > 0) {
      total += value.byteLength;
      if (total > maxBytes) {
        await reader.cancel().catch(() => {});
        return { ok: false };
      }
      chunks.push(value);
    }
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return { ok: true, bytes };
}

async function readForm(request: Request): Promise<URLSearchParams | Response> {
  if (!isFormContentType(request.headers.get("content-type"))) return invalidRequest(DESCRIPTION.contentType);
  const declaredLength = request.headers.get("content-length");
  if (declaredLength !== null) {
    const n = Number(declaredLength);
    if (Number.isFinite(n) && n > MAX_BODY_BYTES) return invalidRequest(DESCRIPTION.tooLarge);
  }
  const body = await readCappedBody(request, MAX_BODY_BYTES);
  if (!body.ok) return invalidRequest(DESCRIPTION.tooLarge);
  try {
    return new URLSearchParams(new TextDecoder("utf-8", { fatal: true }).decode(body.bytes));
  } catch {
    return invalidRequest(DESCRIPTION.notUtf8);
  }
}

/** A single-valued parameter's value; absent and empty are both "missing". */
function param(form: URLSearchParams, name: string): string | null {
  const value = form.get(name);
  return value === null || value === "" ? null : value;
}

/** Public clients only: a client secret or HTTP Basic credentials are refused, not ignored. */
function attemptsClientAuthentication(request: Request, form: URLSearchParams): boolean {
  const authorization = request.headers.get("authorization");
  if (authorization !== null && /^basic(?:\s|$)/i.test(authorization.trim())) return true;
  return form.has("client_secret");
}

/** O2: the subject is an existing, non-disabled member whose LIVE role is super-admin. */
async function subjectStatus(sub: string): Promise<"live" | "refused" | "error"> {
  try {
    const access = await getMemberAccess(sub);
    return access.active && access.role === "super-admin" ? "live" : "refused";
  } catch {
    return "error";
  }
}

interface Context {
  origin: string;
  key: Uint8Array;
}

/** Access (7 d, `aud` = this origin's resource) + refresh (30 d, the store's jti). */
async function issueTokens(
  ctx: Context,
  grant: { sub: string; grantId: string; refreshJti: string },
): Promise<Response> {
  let access: { token: string; expiresIn: number };
  let refresh: string;
  try {
    access = await signAccessToken({ key: ctx.key, origin: ctx.origin, sub: grant.sub, grantId: grant.grantId });
    refresh = await signRefreshToken({
      key: ctx.key,
      origin: ctx.origin,
      sub: grant.sub,
      grantId: grant.grantId,
      jti: grant.refreshJti,
    });
  } catch {
    return serverError("token signing");
  }
  return jsonNoStore(
    { access_token: access.token, token_type: "Bearer", expires_in: access.expiresIn, refresh_token: refresh },
    200,
    { Pragma: "no-cache" },
  );
}

async function exchangeAuthorizationCode(form: URLSearchParams, ctx: Context): Promise<Response> {
  const code = param(form, "code");
  const redirectUri = param(form, "redirect_uri");
  const clientId = param(form, "client_id");
  const codeVerifier = param(form, "code_verifier");
  if (code === null || redirectUri === null || clientId === null || codeVerifier === null) {
    return invalidRequest(DESCRIPTION.codeParams);
  }

  // 1. The client, minted by THIS origin.
  const client = await verifyClientId(clientId, ctx);
  if (!client.ok) return invalidClient();

  // 2. The code: signature, typ, iss, 60 s expiry, this origin's resource.
  const verified = await verifyAuthorizationCode(code, ctx);
  if (!verified.ok) return invalidGrant();
  const claims = verified.claims;

  // 3. O1: the redirect target is one of the client's registered URIs AND on
  //    this origin's allowlist — re-checked here, never trusted from the code
  //    or the client id alone.
  if (!client.claims.redirectUris.includes(redirectUri) || !isRedirectUriAllowed(redirectUri, ctx.origin)) {
    return invalidGrant();
  }

  // 4. O4: the code is bound to this client (by hash), this exact redirect_uri
  //    and this PKCE verifier.
  if (!checkCodeBinding(claims, { clientId, redirectUri, codeVerifier }).ok) return invalidGrant();

  // 5. RFC 8707: a resource, if sent (once or more), is the code's.
  const resource = resolveResource(form.getAll("resource"), ctx.origin);
  if (!resource.ok || resource.resource !== claims.resource) return invalidTarget();

  // 6. O2: the subject is still a live super-admin.
  const subject = await subjectStatus(claims.sub);
  if (subject === "error") return serverError("member lookup");
  if (subject === "refused") return invalidGrant();

  // 7. Only now consume the code. A conflict on the redemption id is a replay.
  const redeemed = await redeemCode(claims.jti);
  if (!redeemed.ok) {
    return redeemed.reason === "replay" ? invalidGrant() : serverError("code redemption", redeemed.cause);
  }

  // 8. The grant — bound to the subject, the client (stored as its hash) and this origin.
  const grant = await createGrant({ sub: claims.sub, clientId, origin: ctx.origin });
  if (!grant.ok) return serverError("grant creation", grant.cause);

  return issueTokens(ctx, { sub: claims.sub, grantId: grant.grantId, refreshJti: grant.refreshJti });
}

async function refreshAccessToken(form: URLSearchParams, ctx: Context): Promise<Response> {
  const refreshToken = param(form, "refresh_token");
  const clientId = param(form, "client_id");
  if (refreshToken === null || clientId === null) return invalidRequest(DESCRIPTION.refreshParams);

  // 1. The client, minted by THIS origin.
  const client = await verifyClientId(clientId, ctx);
  if (!client.ok) return invalidClient();

  // 2. The refresh token: signature, typ, iss, 30 d expiry.
  const verified = await verifyRefreshToken(refreshToken, ctx);
  if (!verified.ok) return invalidGrant();
  const rt = verified.claims;

  // 3. The grant, read FRESH: a cached copy may carry a superseded jti, and
  //    comparing a legitimate refresh against it would revoke the grant.
  const lookup = await loadGrant(rt.grantId, { fresh: true });
  if (!lookup.ok) return lookup.reason === "revoked" ? invalidGrant() : serverError("grant read", lookup.cause);
  const grant = lookup.grant;

  // 4. RFC 6749 §6: the grant was issued to this client.
  if (grant.clientHash !== clientHashOf(clientId)) return invalidGrant();

  // 5. R13: the grant belongs to the refresh token's subject.
  if (grant.sub !== rt.sub) return invalidGrant();

  // 6. RFC 8707: a resource, if sent, is this origin's.
  if (!resolveResource(form.getAll("resource"), ctx.origin).ok) return invalidTarget();

  // 7. O2: the subject is still a live super-admin.
  const subject = await subjectStatus(grant.sub);
  if (subject === "error") return serverError("member lookup");
  if (subject === "refused") return invalidGrant();

  // 8. Rotate. Every refusal is invalid_grant; a superseded jti has already
  //    revoked the whole grant inside the store (O4).
  const rotated = await rotateRefresh(grant, rt.jti, ctx.origin);
  if (!rotated.ok) {
    if (rotated.reason === "server_error") return serverError("refresh rotation", rotated.cause);
    if (rotated.reason === "reuse_revoked") {
      // A security event Frank needs to see: the connector must be reconnected.
      console.warn(`[mcp-oauth] token: superseded refresh token presented; grant ${grant._id} revoked`);
    }
    return invalidGrant();
  }

  return issueTokens(ctx, { sub: grant.sub, grantId: grant._id, refreshJti: rotated.refreshJti });
}

export async function POST(request: Request): Promise<Response> {
  // 1. The one preflight: kill switch → 503, foreign host → 404, no secret → 503.
  const preflight = mcpRoutePreflight(request);
  if (!preflight.ok) return preflight.response;
  const ctx: Context = { origin: preflight.origin, key: preflight.key };

  // 2. The form, capped.
  const form = await readForm(request);
  if (form instanceof Response) return form;

  // 3. Public clients only.
  if (attemptsClientAuthentication(request, form)) {
    return oauthErrorResponse("invalid_client", DESCRIPTION.clientAuthentication);
  }

  // 4. No repeated parameter (RFC 6749 §3.2).
  if (SINGLE_VALUED_PARAMS.some((name) => form.getAll(name).length > 1)) {
    return invalidRequest(DESCRIPTION.duplicate);
  }

  // 5. The grant type.
  const grantType = param(form, "grant_type");
  if (grantType === null) return invalidRequest(DESCRIPTION.missingGrantType);
  if (grantType === "authorization_code") return exchangeAuthorizationCode(form, ctx);
  if (grantType === "refresh_token") return refreshAccessToken(form, ctx);
  return oauthErrorResponse("unsupported_grant_type", DESCRIPTION.unsupportedGrantType);
}
