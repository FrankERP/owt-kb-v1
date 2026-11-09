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

/**
 * Whether a call reads every ministry's members (`adminMembersQuery`'s `all`), bound from the LIVE
 * tier the route put in `extra` exactly as the members GET binds it from the live role
 * (`members/route.ts`: `role === "super-admin"`). Only `"full"` (a live super-admin) reads all; a
 * worship admin (`"admin"`), and anything absent or unknown, reads worship only — fail closed.
 * This scopes a read; it never refuses or hides a tool (ADR-0083 rejected per-handler refusals).
 */
export function readsAllMembers(ctx: Pick<ServerContext, "http"> | undefined): boolean {
  return ctx?.http?.authInfo?.extra?.tier === "full";
}

/**
 * A month tool's caller: the principal, and the member-read scope its handler binds once
 * (`readsAllMembers`) and passes to every `loadV3PlanSources` call it makes.
 */
export interface MonthPrincipal extends McpPrincipal {
  allMembers: boolean;
}

export function monthPrincipalOf(ctx: Pick<ServerContext, "http"> | undefined): MonthPrincipal | null {
  const principal = principalOf(ctx);
  return principal ? { ...principal, allMembers: readsAllMembers(ctx) } : null;
}
