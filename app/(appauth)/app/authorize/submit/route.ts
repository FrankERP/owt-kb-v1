// POST /app/authorize/submit — the ONLY thing that mints a native-app
// authorization code (ADR-0091, spec §3.2). Behind the session middleware, like
// the page (`/api/oauth/authorize` on the MCP door is gated the same way); the
// handler still re-checks everything itself:
//
//   1. preflight (404/503);
//   2. CSRF: `Sec-Fetch-Site` present → must be `same-origin`; absent → `Origin`
//      must be present and equal the canonical origin (`null` refused);
//   3. the form, through the SAME validator the page ran;
//   4. the person: live session, not impersonating, live-active, not Android ≤ 11;
//   5. exactly one `decision`: `deny` → `access_denied` to the verified redirect;
//      `allow` → a 60 s code bound to the person, the client, the exact redirect
//      and the S256 challenge, 303 to the redirect with `code`, `state`, `iss`.
//
// Every refusal of the PERSON (or of a request whose client or redirect does
// not verify) is a page shown in the browser, never a redirect. A GET — what a
// sign-in round trip turns the POST into when the session expired between the
// screen and the tap — never mints a code (spec §10 A9).

import { appPreflight } from "@/app/appAuth/preflight";
import {
  appAuthorizeErrorLocation,
  appAuthorizeSuccessLocation,
  validateAppAuthorizeRequest,
} from "@/app/appAuth/authorizeRequest";
import { AUTHORIZE_REFUSAL_TEXT, checkAuthorizePerson } from "@/app/appAuth/authorizePerson";
import { readAppForm } from "@/app/appAuth/form";
import { signAppCode } from "@/app/appAuth/tokens";
import { sameOriginPost } from "@/app/appAuth/sameOrigin";
import { appAuthHtmlPage } from "@/app/appAuth/htmlPage";

export const dynamic = "force-dynamic";
export const revalidate = 0;

function seeOther(location: string): Response {
  return new Response(null, { status: 303, headers: { Location: location, "Cache-Control": "no-store" } });
}

export async function POST(request: Request): Promise<Response> {
  const preflight = appPreflight(request);
  if (!preflight.ok) {
    return appAuthHtmlPage("No disponible", "La entrada a la app no está disponible en este momento.", preflight.status);
  }
  const { origin, key } = preflight;

  if (!sameOriginPost(request.headers, origin)) {
    return appAuthHtmlPage("Solicitud no válida", "Vuelve a la app y toca Entrar otra vez.", 403);
  }

  const read = await readAppForm(request);
  if (!read.ok) return appAuthHtmlPage("Solicitud no válida", "Vuelve a la app y toca Entrar otra vez.", 400);
  const form = read.form;

  const validation = validateAppAuthorizeRequest(form, origin);
  if (validation.kind === "error-page") {
    return appAuthHtmlPage("Solicitud no válida", "Esta solicitud no viene de la app Backstage. No se autorizó nada.", 400);
  }

  const person = await checkAuthorizePerson(request.headers);
  if (!person.ok) {
    const text = AUTHORIZE_REFUSAL_TEXT[person.reason];
    return appAuthHtmlPage(text.title, text.body, person.reason === "unavailable" ? 503 : 403);
  }

  const decisions = form.getAll("decision");
  const decision = decisions.length === 1 ? decisions[0] : null;
  if (decision !== "allow" && decision !== "deny") {
    return appAuthHtmlPage("Solicitud no válida", "Vuelve a la app y toca Entrar otra vez.", 400);
  }

  // A verified redirect with a later rule broken: only a POST crafted outside the page gets here.
  if (validation.kind === "error-redirect") return seeOther(validation.location);
  const authz = validation.request;

  if (decision === "deny") {
    return seeOther(appAuthorizeErrorLocation(authz.redirectUri, origin, "access_denied", authz.state));
  }

  let code: string;
  try {
    code = await signAppCode({
      key,
      origin,
      sub: person.sanityId,
      clientId: authz.clientId,
      redirectUri: authz.redirectUri,
      codeChallenge: authz.codeChallenge,
    });
  } catch {
    console.error("[app-auth] authorize: could not sign an authorization code");
    return appAuthHtmlPage("No disponible", "No se pudo entrar en este momento. Intenta de nuevo en un rato.", 500);
  }
  return seeOther(appAuthorizeSuccessLocation(authz.redirectUri, origin, code, authz.state));
}

/** A GET never mints a code (spec §10 A9). */
export async function GET(): Promise<Response> {
  return appAuthHtmlPage("Vuelve a la app", "Vuelve a la app y toca Entrar otra vez.", 405, { Allow: "POST" });
}
