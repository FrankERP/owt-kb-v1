import "server-only";

// Native-app sign-in — the server read behind «Apps conectadas» (ADR-0091, spec
// D9): the signed-in person's LIVE app grants on THIS deployment, as rows the
// panel can show. Never while impersonating (the list would be the target's).
// A failed read renders nothing rather than breaking Ajustes.

import { canonicalOrigin } from "@/app/mcp/oauth/origin";
import { listLiveAppGrants } from "./grantStore";
import type { ConnectedAppRow } from "@/app/components/ConnectedAppsPanel";

export async function loadConnectedApps(user: { sanityId: string; isImpersonating?: boolean }): Promise<ConnectedAppRow[]> {
  if (user.isImpersonating) return [];
  const origin = canonicalOrigin();
  if (!origin) return [];
  const listed = await listLiveAppGrants(user.sanityId, origin);
  if (!listed.ok) return [];
  return listed.grants.map((g) => ({
    id: g._id,
    platform: g.label === "ios" || g.label === "android" ? g.label : null,
    createdAt: g.createdAt,
    lastUsedAt: g.lastRefreshAt,
  }));
}
