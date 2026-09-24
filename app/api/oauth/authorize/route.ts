// app/api/oauth/authorize/route.ts
//
// The consent POST (P0 plan step 7, spec O1/O8) — the ONLY thing that mints an
// authorization code. `/oauth/authorize` renders the consent screen; its
// «Permitir»/«Cancelar» form posts here.
//
// Registration is open to anyone, so without this step a super-admin browser
// that opened someone else's authorize link would be issued a code silently
// (the confused-deputy attack). A code is therefore minted only when ALL of:
//   - the request is a POST (GET is 405, so no link, prefetch or redirect can
//     ever mint one) from this deployment's own origin (R16) — and the
//     NextAuth cookie is `SameSite=Lax`, so a cross-site POST has no session;
//   - the posted fields re-validate from scratch through the SAME validator
//     the page used (R18) — the page is never trusted;
//   - the session is live, not impersonating, and the member's LIVE role
//     (`getMemberAccess`, not the session copy) is `super-admin`;
//   - `decision=allow` was pressed. Nothing is remembered between requests.
//
// Gated by the session middleware (`proxy.ts`), deliberately: a cookie-less
// POST never reaches this file. The null-session branch below is defensive.
// Every redirect is 303 See Other (RFC 9700 §4.12) to the VERIFIED
// redirect_uri; every refusal of the human (no session, wrong role,
// impersonation, a request whose client or redirect target does not verify)
// is JSON shown in the browser and redirected NOWHERE. Minting a code writes
// nothing: this file never imports `writeClient` or the grant store, not even
// transitively outside the existing session guards (see the import-closure
// test in `oauthAuthorizeRoute.test.ts`). Nothing here logs a code, a token or
// a client_id.

import { requireActiveSession } from "@/app/utils/authGuards";
import { getMemberAccess } from "@/app/utils/memberAccess";
import { authorizationResponseUrl, authorizeErrorLocation, validateAuthorizeRequest } from "@/app/mcp/oauth/authorizeRequest";
import { mcpRoutePreflight } from "@/app/mcp/oauth/guard";
import { jsonNoStore } from "@/app/mcp/oauth/responses";
import { signAuthorizationCode } from "@/app/mcp/oauth/tokens";

export const dynamic = "force-dynamic";
export const revalidate = 0;

/**
 * Cap on the bytes actually read. A valid form is a client id (a signed token
 * carrying at most a 4 KB registration), one of its redirect URIs, a 43-char
 * challenge, the resource and the client's `state` — far below this.
 */
const MAX_BODY_BYTES = 32 * 1024;

const FORM_MEDIA_TYPE = "application/x-www-form-urlencoded";

function isFormContentType(header: string | null): boolean {
  if (!header) return false;
  // Ignore parameters (e.g. `; charset=UTF-8`) — the media type is what matters.
  return header.split(";")[0]?.trim().toLowerCase() === FORM_MEDIA_TYPE;
}

function badRequest(description: string): Response {
  return jsonNoStore({ error: "invalid_request", error_description: description }, 400);
}

/** 303 See Other: the browser follows with a GET and never re-POSTs the form. */
function seeOther(location: string): Response {
  return new Response(null, { status: 303, headers: { Location: location, "Cache-Control": "no-store" } });
}

type BodyReadResult = { ok: true; bytes: Uint8Array } | { ok: false };

/**
 * Reads the body, aborting the moment more than `maxBytes` have arrived — the
 * cap applies to what is actually read, never only to a declared
 * Content-Length. Same shape as registration's (`app/api/oauth/register/route.ts`).
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
  if (!isFormContentType(request.headers.get("content-type"))) {
    return badRequest(`Content-Type must be ${FORM_MEDIA_TYPE}`);
  }
  const declaredLength = request.headers.get("content-length");
  if (declaredLength !== null) {
    const n = Number(declaredLength);
    if (Number.isFinite(n) && n > MAX_BODY_BYTES) return badRequest("request body too large");
  }
  const body = await readCappedBody(request, MAX_BODY_BYTES);
  if (!body.ok) return badRequest("request body too large");
  try {
    return new URLSearchParams(new TextDecoder("utf-8", { fatal: true }).decode(body.bytes));
  } catch {
    return badRequest("request body is not UTF-8");
  }
}

export async function POST(request: Request): Promise<Response> {
  // 1. The one preflight: kill switch → 503, foreign host → 404, no secret → 503.
  const preflight = mcpRoutePreflight(request);
  if (!preflight.ok) return preflight.response;
  const { origin, key } = preflight;

  // 2. R16: a browser POST names its origin; anything but ours is refused.
  const requestOrigin = request.headers.get("origin");
  if (requestOrigin !== null && requestOrigin !== origin) {
    return jsonNoStore({ error: "forbidden" }, 403);
  }

  // 3. The form, capped.
  const form = await readForm(request);
  if (form instanceof Response) return form;

  // 4. The SAME validator the page ran. An unverified client or redirect
  //    target is refused here and redirected nowhere.
  const validation = await validateAuthorizeRequest(form, { origin, key });
  if (validation.kind === "error-page") return badRequest("invalid client_id or redirect_uri");

  // 5. The human: a live, non-impersonating super-admin — by the LIVE role.
  //    Refusals are shown to them, never sent to the client.
  const session = await requireActiveSession();
  if (!session) return jsonNoStore({ error: "unauthorized" }, 401);
  if (session.user.isImpersonating) return jsonNoStore({ error: "forbidden" }, 403);
  const access = await getMemberAccess(session.user.sanityId);
  if (!access.active || access.role !== "super-admin") return jsonNoStore({ error: "forbidden" }, 403);

  // 6. Exactly one decision, exactly one of the two buttons.
  const decisions = form.getAll("decision");
  const decision = decisions.length === 1 ? decisions[0] : null;
  if (decision !== "allow" && decision !== "deny") return badRequest("decision must be allow or deny");

  // 7. A request that verified its redirect target but failed a later rule
  //    goes back to that target with the error (only a POST crafted outside
  //    the page can get here — the page never renders such a form).
  if (validation.kind === "error-redirect") return seeOther(validation.location);

  const { request: authz } = validation;

  // 8. «Cancelar».
  if (decision === "deny") {
    return seeOther(authorizeErrorLocation(authz.redirectUri, origin, "access_denied", authz.state));
  }

  // 9. «Permitir»: a 60 s code bound to this member, the client (by hash), the
  //    exact redirect_uri, the S256 challenge and this origin's resource.
  let code: string;
  try {
    code = await signAuthorizationCode({
      key,
      origin,
      sub: session.user.sanityId,
      clientId: authz.clientId,
      redirectUri: authz.redirectUri,
      codeChallenge: authz.codeChallenge,
    });
  } catch {
    // Fixed line only: never the error, the client_id or anything signed.
    console.error("[mcp-oauth] authorize: could not sign an authorization code");
    return jsonNoStore({ error: "server_error" }, 500);
  }
  return seeOther(authorizationResponseUrl(authz.redirectUri, { code, state: authz.state, iss: origin }));
}

/** A GET never issues a code (O8): the consent page is `/oauth/authorize`, and approval is a POST. */
export async function GET(request: Request): Promise<Response> {
  const preflight = mcpRoutePreflight(request);
  if (!preflight.ok) return preflight.response;
  return jsonNoStore({ error: "method_not_allowed" }, 405, { Allow: "POST" });
}
