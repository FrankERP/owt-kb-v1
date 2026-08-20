import { serverClient } from "@/sanity/lib/serverClient";
import { normalizeMinistries, isMinistryId, type MinistryId } from "@/app/ministries";

const TTL_MS = 30_000;
type Entry = {
  active: boolean;
  role: string | null;
  ministries: MinistryId[];
  managesMinistries: MinistryId[];
  expires: number;
};
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
 *
 * It also carries the member's ministry membership and management, so the
 * ministry guards read them live from the same snapshot rather than from a JWT.
 */
export async function getMemberAccess(
  sanityId: string | undefined | null,
): Promise<{
  active: boolean;
  role: string | null;
  ministries: MinistryId[];
  managesMinistries: MinistryId[];
}> {
  if (!sanityId) return { active: false, role: null, ministries: [], managesMinistries: [] };
  const now = Date.now();
  const hit = cache.get(sanityId);
  if (hit && hit.expires > now) {
    return {
      active: hit.active, role: hit.role,
      ministries: hit.ministries, managesMinistries: hit.managesMinistries,
    };
  }

  const doc = await serverClient.fetch<{
    _id: string;
    disabled?: boolean;
    role?: string | null;
    ministries?: unknown;
    managesMinistries?: unknown;
  } | null>(
    `*[_type == "teamMembers" && _id == $id][0]{ _id, disabled, role, ministries, managesMinistries }`,
    { id: sanityId },
  );
  const active = !!doc && doc.disabled !== true;
  const role = doc?.role ?? null;
  // A missing/deleted member gets NO ministries: `active:false` already blocks both
  // guards, and [] is the shape that stays safe if that ever changes. An existing
  // member goes through the SHARED normalizer — the same function the admin form
  // seeds from, so storage and UI can never disagree about what absent means.
  const ministries = doc ? normalizeMinistries(doc.ministries) : [];
  const managesMinistries = doc && Array.isArray(doc.managesMinistries)
    ? doc.managesMinistries.filter(isMinistryId)
    : [];
  cache.set(sanityId, { active, role, ministries, managesMinistries, expires: now + TTL_MS });
  return { active, role, ministries, managesMinistries };
}

/**
 * Live "is this member still allowed in" check, backed by the same 30s TTL cache
 * as getMemberAccess. A member is active iff their teamMembers doc exists and
 * disabled !== true.
 */
export async function isMemberActive(sanityId: string | undefined | null): Promise<boolean> {
  return (await getMemberAccess(sanityId)).active;
}
