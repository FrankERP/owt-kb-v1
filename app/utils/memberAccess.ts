import { serverClient } from "@/sanity/lib/serverClient";

const TTL_MS = 30_000;
type Entry = { active: boolean; role: string | null; expires: number };
const cache = new Map<string, Entry>();

/** For tests only. */
export function __clearMemberAccessCache() { cache.clear(); }

/**
 * Live member-access snapshot, backed by a 30s TTL cache: whether the member is
 * still allowed in (doc exists and disabled !== true) AND their current role.
 * Reads via serverClient (useCdn:false) so neither field is ever CDN-stale.
 *
 * Returning the role here lets the auth layer refresh a stale JWT role promptly
 * (within the TTL) instead of trusting a role baked in at sign-in for 7 days.
 */
export async function getMemberAccess(
  sanityId: string | undefined | null,
): Promise<{ active: boolean; role: string | null }> {
  if (!sanityId) return { active: false, role: null };
  const now = Date.now();
  const hit = cache.get(sanityId);
  if (hit && hit.expires > now) return { active: hit.active, role: hit.role };

  const doc = await serverClient.fetch<{ _id: string; disabled?: boolean; role?: string | null } | null>(
    `*[_type == "teamMembers" && _id == $id][0]{ _id, disabled, role }`,
    { id: sanityId },
  );
  const active = !!doc && doc.disabled !== true;
  const role = doc?.role ?? null;
  cache.set(sanityId, { active, role, expires: now + TTL_MS });
  return { active, role };
}

/**
 * Live "is this member still allowed in" check, backed by the same 30s TTL cache
 * as getMemberAccess. A member is active iff their teamMembers doc exists and
 * disabled !== true.
 */
export async function isMemberActive(sanityId: string | undefined | null): Promise<boolean> {
  return (await getMemberAccess(sanityId)).active;
}
