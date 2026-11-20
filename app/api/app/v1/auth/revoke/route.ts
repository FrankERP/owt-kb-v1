// POST /api/app/v1/auth/revoke — «Cerrar sesión» from the app (ADR-0091, spec
// D9, RFC 7009 shape). Form: `token` (a refresh token) + `client_id`. When the
// token verifies and its grant belongs to that client and this origin, the
// grant is revoked (`app_sign_out`). Answers 200 whether or not the token was
// valid (no oracle), and 503 only when a valid token's revocation write failed
// (RFC 7009 §2.2.1). The app deletes its tokens and data whatever the answer.
// Ungated by the session middleware (`api/app/v1` exclusion); authenticated by
// the refresh token itself.

import { appPreflight } from "@/app/appAuth/preflight";
import { isAppClientId } from "@/app/appAuth/clients";
import { verifyAppRefreshToken } from "@/app/appAuth/tokens";
import { APP_REVOKE_REASON, loadAppGrant, revokeAppGrant } from "@/app/appAuth/grantStore";
import { formParam, readAppForm } from "@/app/appAuth/form";
import { appPreflightResponse, appTokenError, jsonNoStore } from "@/app/appAuth/responses";

export const dynamic = "force-dynamic";
export const revalidate = 0;

const OK = () => jsonNoStore({}, 200);

export async function POST(request: Request): Promise<Response> {
  const preflight = appPreflight(request);
  if (!preflight.ok) return appPreflightResponse(preflight.status);
  const { origin, key } = preflight;

  const read = await readAppForm(request);
  if (!read.ok) return appTokenError("invalid_request");
  const token = formParam(read.form, "token");
  const clientId = formParam(read.form, "client_id");
  if (token === null || clientId === null) return appTokenError("invalid_request");
  if (!isAppClientId(clientId)) return appTokenError("invalid_client");

  const verified = await verifyAppRefreshToken(token, { key, origin });
  if (!verified.ok) return OK();

  const lookup = await loadAppGrant(verified.claims.grantId, { fresh: true });
  if (!lookup.ok) {
    if (lookup.reason === "revoked") return OK();
    console.error("[app-auth] revoke: grant read failed");
    return appTokenError("temporarily_unavailable");
  }
  const grant = lookup.grant;
  if (grant.clientId !== clientId || grant.sub !== verified.claims.sub || grant.origin !== origin) return OK();

  const revoked = await revokeAppGrant(grant._id, APP_REVOKE_REASON.signOut);
  if (!revoked.ok) {
    console.error("[app-auth] revoke: revocation write failed");
    return appTokenError("temporarily_unavailable");
  }
  return OK();
}
