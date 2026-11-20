// POST /api/app/v1/auth/token — the native apps' token endpoint (ADR-0091,
// spec §3.3). The ONLY place app grants are created and refresh tokens rotate.
//
//   authorization_code — the code verifies (key, iss, typ `app-code`, 60 s); the
//     client_id equals the code's; the redirect_uri equals the code's exactly
//     AND is one of that client's redirects on THIS origin (re-checked, never
//     trusted from the code); PKCE S256 matches; the person is live-active.
//     Only then is the code redeemed (`create()`, a replay is refused) and the
//     grant created.
//   refresh_token — the refresh token verifies; the grant is read FRESH;
//     it belongs to this client and this subject; the person is live-active;
//     then the store rotates: a superseded jti revokes the whole grant, a lost
//     revision race answers 503 `temporarily_unavailable` (NOT revoked, and
//     distinguishable from `invalid_grant`, so the app retries instead of
//     signing out).
//
// An inactive person is `invalid_grant` with the fixed description
// `account_disabled`, so the app can say «Tu acceso está desactivado». A
// Sanity failure (a missing token included) is 503, never `invalid_grant`.
// Public clients only: any client authentication is refused. Nothing presented
// is ever echoed or logged; a failure logs a fixed stage name and at most a
// status code. Ungated by the session middleware (`api/app/v1` exclusion).

import { getMemberAccess } from "@/app/utils/memberAccess";
import { appPreflight } from "@/app/appAuth/preflight";
import { isAppClientId, isRedirectAllowed } from "@/app/appAuth/clients";
import {
  appCodeBindingHolds,
  signAppAccessToken,
  signAppRefreshToken,
  verifyAppCode,
  verifyAppRefreshToken,
} from "@/app/appAuth/tokens";
import { createAppGrant, loadAppGrant, redeemAppCode, rotateAppRefresh } from "@/app/appAuth/grantStore";
import { formParam, readAppForm } from "@/app/appAuth/form";
import { appPreflightResponse, appTokenError, jsonNoStore } from "@/app/appAuth/responses";

export const dynamic = "force-dynamic";
export const revalidate = 0;

const SINGLE_VALUED = ["grant_type", "code", "redirect_uri", "client_id", "code_verifier", "refresh_token"] as const;

const D = {
  form: "the body must be a small application/x-www-form-urlencoded UTF-8 form",
  duplicate: "a parameter was sent more than once",
  clientAuth: "client authentication is not supported: clients are public",
  grantType: "only authorization_code and refresh_token are supported",
  codeParams: "code, redirect_uri, client_id and code_verifier are required",
  refreshParams: "refresh_token and client_id are required",
  client: "unknown client_id",
  grant: "the grant is invalid, expired, revoked or was issued to another client",
  disabled: "account_disabled",
  retry: "try again",
  // A concurrent refresh of the SAME token won the rotation (spec D7). The app must NOT resend this
  // refresh token — it is already superseded, and presenting it again revokes the grant — but
  // re-read the tokens the winning call stored (docs/MOBILE.md: refreshes are single-flight).
  inProgress: "refresh_in_progress",
} as const;

type Stage = "member lookup" | "code redemption" | "grant creation" | "grant read" | "refresh rotation" | "token signing";

function statusOf(cause: unknown): number | null {
  return typeof cause === "object" && cause !== null && typeof (cause as { statusCode?: unknown }).statusCode === "number"
    ? (cause as { statusCode: number }).statusCode
    : null;
}

/** A Sanity-side failure: 503, so the app keeps its tokens and retries later. */
function unavailable(stage: Stage, cause?: unknown): Response {
  const status = statusOf(cause);
  console.error(`[app-auth] token: ${stage} failed${status !== null ? ` (status ${status})` : ""}`);
  return appTokenError("temporarily_unavailable", D.retry);
}

async function subjectStatus(sub: string): Promise<"live" | "disabled" | "error"> {
  try {
    return (await getMemberAccess(sub)).active ? "live" : "disabled";
  } catch {
    return "error";
  }
}

interface Ctx {
  origin: string;
  key: Uint8Array;
}

async function issue(ctx: Ctx, g: { sub: string; grantId: string; refreshJti: string }): Promise<Response> {
  try {
    const access = await signAppAccessToken({ ...ctx, sub: g.sub, grantId: g.grantId });
    const refresh = await signAppRefreshToken({ ...ctx, sub: g.sub, grantId: g.grantId, jti: g.refreshJti });
    return jsonNoStore(
      { access_token: access.token, token_type: "Bearer", expires_in: access.expiresIn, refresh_token: refresh },
      200,
      { Pragma: "no-cache" },
    );
  } catch {
    console.error("[app-auth] token: token signing failed");
    return appTokenError("server_error");
  }
}

async function exchangeCode(form: URLSearchParams, ctx: Ctx): Promise<Response> {
  const code = formParam(form, "code");
  const redirectUri = formParam(form, "redirect_uri");
  const clientId = formParam(form, "client_id");
  const codeVerifier = formParam(form, "code_verifier");
  if (code === null || redirectUri === null || clientId === null || codeVerifier === null) {
    return appTokenError("invalid_request", D.codeParams);
  }
  if (!isAppClientId(clientId)) return appTokenError("invalid_client", D.client);

  const verified = await verifyAppCode(code, ctx);
  if (!verified.ok) return appTokenError("invalid_grant", D.grant);
  const claims = verified.claims;

  if (!isRedirectAllowed(clientId, redirectUri, ctx.origin)) return appTokenError("invalid_grant", D.grant);
  if (!appCodeBindingHolds(claims, { clientId, redirectUri, codeVerifier })) return appTokenError("invalid_grant", D.grant);

  const subject = await subjectStatus(claims.sub);
  if (subject === "error") return unavailable("member lookup");
  if (subject === "disabled") return appTokenError("invalid_grant", D.disabled);

  const redeemed = await redeemAppCode(claims.jti);
  if (!redeemed.ok) {
    return redeemed.reason === "replay" ? appTokenError("invalid_grant", D.grant) : unavailable("code redemption", redeemed.cause);
  }

  const grant = await createAppGrant({ sub: claims.sub, clientId, origin: ctx.origin });
  if (!grant.ok) return unavailable("grant creation", grant.cause);
  return issue(ctx, { sub: claims.sub, grantId: grant.grantId, refreshJti: grant.refreshJti });
}

async function refresh(form: URLSearchParams, ctx: Ctx): Promise<Response> {
  const refreshToken = formParam(form, "refresh_token");
  const clientId = formParam(form, "client_id");
  if (refreshToken === null || clientId === null) return appTokenError("invalid_request", D.refreshParams);
  if (!isAppClientId(clientId)) return appTokenError("invalid_client", D.client);

  const verified = await verifyAppRefreshToken(refreshToken, ctx);
  if (!verified.ok) return appTokenError("invalid_grant", D.grant);
  const rt = verified.claims;

  const lookup = await loadAppGrant(rt.grantId, { fresh: true });
  if (!lookup.ok) {
    return lookup.reason === "revoked" ? appTokenError("invalid_grant", D.grant) : unavailable("grant read", lookup.cause);
  }
  const grant = lookup.grant;
  if (grant.clientId !== clientId || grant.sub !== rt.sub) return appTokenError("invalid_grant", D.grant);

  const subject = await subjectStatus(grant.sub);
  if (subject === "error") return unavailable("member lookup");
  if (subject === "disabled") return appTokenError("invalid_grant", D.disabled);

  const rotated = await rotateAppRefresh(grant, rt.jti, ctx.origin);
  if (!rotated.ok) {
    if (rotated.reason === "server_error") return unavailable("refresh rotation", rotated.cause);
    if (rotated.reason === "conflict") return appTokenError("temporarily_unavailable", D.inProgress, { retryAfter: false });
    if (rotated.reason === "reuse_revoked") {
      console.warn(`[app-auth] token: superseded refresh token presented; grant ${grant._id} revoked`);
    }
    return appTokenError("invalid_grant", D.grant);
  }
  return issue(ctx, { sub: grant.sub, grantId: grant._id, refreshJti: rotated.refreshJti });
}

export async function POST(request: Request): Promise<Response> {
  const preflight = appPreflight(request);
  if (!preflight.ok) return appPreflightResponse(preflight.status);
  const ctx: Ctx = { origin: preflight.origin, key: preflight.key };

  const read = await readAppForm(request);
  if (!read.ok) return appTokenError("invalid_request", D.form);
  const form = read.form;

  const authorization = request.headers.get("authorization");
  if ((authorization !== null && /^basic(?:\s|$)/i.test(authorization.trim())) || form.has("client_secret")) {
    return appTokenError("invalid_client", D.clientAuth);
  }
  if (SINGLE_VALUED.some((n) => form.getAll(n).length > 1)) return appTokenError("invalid_request", D.duplicate);

  const grantType = formParam(form, "grant_type");
  if (grantType === "authorization_code") return exchangeCode(form, ctx);
  if (grantType === "refresh_token") return refresh(form, ctx);
  return appTokenError(grantType === null ? "invalid_request" : "unsupported_grant_type", D.grantType);
}
