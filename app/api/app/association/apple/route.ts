// GET /.well-known/apple-app-site-association (rewritten here, next.config.mjs).
// Static JSON, no I/O, the same on every origin: which iOS app may receive the
// sign-in callback (app/appAuth/appleAssociation.ts, ADR-0091). Apple's CDN
// fetches it without cookies and refuses a redirect, which is why the public
// path is the `.well-known` rewrite, excluded from the session middleware.

import { appleAppSiteAssociation } from "@/app/appAuth/appleAssociation";

export const dynamic = "force-static";

export function GET(): Response {
  return new Response(JSON.stringify(appleAppSiteAssociation()), {
    status: 200,
    headers: { "Content-Type": "application/json", "Cache-Control": "public, max-age=3600" },
  });
}
