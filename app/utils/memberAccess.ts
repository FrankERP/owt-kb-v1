import { serverClient } from "@/sanity/lib/serverClient";

const TTL_MS = 30_000;
type Entry = { active: boolean; expires: number };
const cache = new Map<string, Entry>();

/** For tests only. */
export function __clearMemberAccessCache() { cache.clear(); }

/**
 * Live "is this member still allowed in" check, backed by a 30s TTL cache.
 * A member is active iff their teamMembers doc exists and disabled !== true.
 * Reads via serverClient (useCdn:false) so the flag is never CDN-stale.
 */
export async function isMemberActive(sanityId: string | undefined | null): Promise<boolean> {
  if (!sanityId) return false;
  const now = Date.now();
  const hit = cache.get(sanityId);
  if (hit && hit.expires > now) return hit.active;

  const doc = await serverClient.fetch<{ _id: string; disabled?: boolean } | null>(
    `*[_type == "teamMembers" && _id == $id][0]{ _id, disabled }`,
    { id: sanityId }
  );
  const active = !!doc && doc.disabled !== true;
  cache.set(sanityId, { active, expires: now + TTL_MS });
  return active;
}
