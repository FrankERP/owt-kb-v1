// Who is calling a month tool: the grant's member id (`sub`) and the canonical origin of the
// deployment that authenticated the call. Both come from the `authInfo` `app/api/mcp/route.ts`
// builds after its bearer check (P0); a proposal is bound to both (D10). Missing either is no
// principal at all, and the tools refuse (fail closed).

import type { ServerContext } from "@modelcontextprotocol/server";

export interface McpPrincipal {
  sub: string;
  origin: string;
}

export function principalOf(ctx: Pick<ServerContext, "http"> | undefined): McpPrincipal | null {
  const auth = ctx?.http?.authInfo;
  const sub = auth?.extra?.sub;
  const resource = auth?.resource;
  if (typeof sub !== "string" || !sub || !(resource instanceof URL)) return null;
  return { sub, origin: resource.origin };
}
