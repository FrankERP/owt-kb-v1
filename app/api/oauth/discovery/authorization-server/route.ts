// app/api/oauth/discovery/authorization-server/route.ts
//
// RFC 8414 authorization-server metadata for this deployment's MCP server.
// Reached publicly only through the `/.well-known/oauth-authorization-server`
// `beforeFiles` rewrite in next.config.mjs — this route path itself stays
// behind the session middleware (P0 plan step 5 adds the `.well-known`
// exclusion; this route's own path is never added to it).
//
// `client_id_metadata_document_supported` is deliberately OMITTED: advertising
// it would let claude.ai skip Dynamic Client Registration for CIMD, and the
// approved spec's O1 keeps registration on stateless DCR.

import { mcpRoutePreflight } from "@/app/mcp/oauth/guard";
import { jsonNoStore } from "@/app/mcp/oauth/responses";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function GET(request: Request): Promise<Response> {
  const preflight = mcpRoutePreflight(request);
  if (!preflight.ok) return preflight.response;
  const { origin } = preflight;

  return jsonNoStore({
    issuer: origin,
    authorization_endpoint: `${origin}/oauth/authorize`,
    token_endpoint: `${origin}/api/oauth/token`,
    registration_endpoint: `${origin}/api/oauth/register`,
    response_types_supported: ["code"],
    grant_types_supported: ["authorization_code", "refresh_token"],
    code_challenge_methods_supported: ["S256"],
    token_endpoint_auth_methods_supported: ["none"],
    authorization_response_iss_parameter_supported: true,
  });
}
