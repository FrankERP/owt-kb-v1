import "server-only";

// Native-app sign-in — `requireAppSession`, the ONE guard every
// `/api/app/v1/*` handler runs first (except the token and revoke endpoints),
// with a declared `needs` level and no default (ADR-0091, spec D8):
//
//   1. preflight: kill switch → 503, foreign host → 404, no secret → 503;
//   2. `Authorization: Bearer <token>`, else 401;
//   3. the access token: HS256, iss, typ `app-at`, aud `<origin>/api/app`;
//      expired/invalid → 401 `invalid_token`;
//   4. the grant (30 s cache): revoked/missing/malformed → 401; `sub` and
//      `origin` must match; a READ FAILURE → 503, never 401;
//   5. LIVE access (`getMemberAccess`, 30 s cache): not active → 401
//      `account_disabled`; a read failure → 503;
//   6. the declared level on that live access → else 403.
//
// Never: impersonation (`sub` is always the person who signed in), a role read
// from the token, or a write trusting this access where the writer re-reads
// fresh (writers keep calling `fetchMemberAccessFresh`, ADR-0081 W1).

import { getMemberAccess, type MemberAccess } from "@/app/utils/memberAccess";
import { appPreflight } from "./preflight";
import { verifyAppAccessToken } from "./tokens";
import { loadAppGrant } from "./grantStore";
import { meetsNeeds, type AppNeeds } from "./levels";
import type { AppPlatform } from "./clients";
import {
  appForbiddenResponse,
  appPreflightResponse,
  appUnauthorizedResponse,
  appUnavailableResponse,
} from "./responses";

export interface AppSession {
  sanityId: string;
  access: MemberAccess;
  platform: AppPlatform;
  grantId: string;
  origin: string;
}

export type AppSessionResult = { ok: true; session: AppSession } | { ok: false; response: Response };

const BEARER_RE = /^Bearer ([A-Za-z0-9\-._~+/]+=*)$/i; // the scheme is case-insensitive (RFC 7235 §2.1)

export async function requireAppSession(request: Request, opts: { needs: AppNeeds }): Promise<AppSessionResult> {
  const preflight = appPreflight(request);
  if (!preflight.ok) return { ok: false, response: appPreflightResponse(preflight.status) };
  const { origin, key } = preflight;

  const authorization = request.headers.get("authorization");
  if (authorization === null) return { ok: false, response: appUnauthorizedResponse("no_token") };
  const match = BEARER_RE.exec(authorization.trim());
  if (!match) return { ok: false, response: appUnauthorizedResponse("invalid_token") };

  const verified = await verifyAppAccessToken(match[1], { key, origin });
  if (!verified.ok) return { ok: false, response: appUnauthorizedResponse("invalid_token") };
  const { sub, grantId } = verified.claims;

  const lookup = await loadAppGrant(grantId);
  if (!lookup.ok) {
    return {
      ok: false,
      response: lookup.reason === "revoked" ? appUnauthorizedResponse("invalid_token") : appUnavailableResponse(),
    };
  }
  const grant = lookup.grant;
  if (grant.sub !== sub || grant.origin !== origin) return { ok: false, response: appUnauthorizedResponse("invalid_token") };

  let access: MemberAccess;
  try {
    access = await getMemberAccess(sub);
  } catch {
    return { ok: false, response: appUnavailableResponse() };
  }
  if (!access.active) return { ok: false, response: appUnauthorizedResponse("account_disabled") };
  if (!meetsNeeds(access, opts.needs)) return { ok: false, response: appForbiddenResponse() };

  return { ok: true, session: { sanityId: sub, access, platform: grant.platform, grantId: grant._id, origin } };
}
