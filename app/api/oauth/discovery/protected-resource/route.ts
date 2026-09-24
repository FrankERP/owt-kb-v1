// app/api/oauth/discovery/protected-resource/route.ts
//
// RFC 9728 protected-resource metadata for `/api/mcp`. Reached publicly
// through two `/.well-known/oauth-protected-resource` `beforeFiles` rewrites
// in next.config.mjs — the bare RFC 9728 default path and the path-suffixed
// form under `/api/mcp` that `resourceMetadataUrl` points at. This route path
// itself stays behind the session middleware, same as the AS metadata route.

import { mcpRoutePreflight } from "@/app/mcp/oauth/guard";
import { jsonNoStore } from "@/app/mcp/oauth/responses";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function GET(request: Request): Promise<Response> {
  const preflight = mcpRoutePreflight(request);
  if (!preflight.ok) return preflight.response;
  const { origin, resource } = preflight;

  return jsonNoStore({
    resource,
    authorization_servers: [origin],
    bearer_methods_supported: ["header"],
  });
}
