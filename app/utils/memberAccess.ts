import { serverClient } from "@/sanity/lib/serverClient";
import {
  normalizeMinistries,
  normalizeMinistryRoles,
  isMinistryId,
  type MinistryId,
  type MinistryRole,
} from "@/app/ministries";

const TTL_MS = 30_000;

/** What every permission decision reads about a member. */
export type MemberAccess = {
  active: boolean;
  role: string | null;
  ministries: MinistryId[];
  managesMinistries: MinistryId[];
  ministryRoles: MinistryRole[];
};
type Entry = MemberAccess & { expires: number };
const cache = new Map<string, Entry>();

/** The stored fields `accessFromDoc` reads — and the projection that fetches them. */
export type MemberAccessDoc = {
  _id: string;
  disabled?: boolean;
  role?: string | null;
  ministries?: unknown;
  managesMinistries?: unknown;
  ministryRoles?: unknown;
};
const ACCESS_PROJECTION = "{ _id, disabled, role, ministries, managesMinistries, ministryRoles }";

/**
 * THE normalization from a stored member to its access snapshot — pure, so the
 * ministry-guard equivalence test runs raw documents through the very code the
 * guards read (a forgotten projection or an un-normalized `ministries` would
 * show up there, not in production).
 *
 * A missing/deleted member gets NO ministries: `active:false` already blocks
 * both guards, and [] is the shape that stays safe if that ever changes. An
 * existing member goes through the SHARED normalizer — the same function the
 * admin form seeds from, so storage and UI can never disagree about what absent
 * means. `ministryRoles` is read against the NORMALIZED ministries: a level in a
 * ministry the person is not in grants nothing (ADR-0075).
 */
export function accessFromDoc(doc: MemberAccessDoc | null): MemberAccess {
  const active = !!doc && doc.disabled !== true;
  const role = doc?.role ?? null;
  const ministries = doc ? normalizeMinistries(doc.ministries) : [];
  const managesMinistries = doc && Array.isArray(doc.managesMinistries)
    ? doc.managesMinistries.filter(isMinistryId)
    : [];
  const ministryRoles = doc ? normalizeMinistryRoles(doc.ministryRoles, ministries) : [];
  return { active, role, ministries, managesMinistries, ministryRoles };
}

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
): Promise<MemberAccess> {
  if (!sanityId) return accessFromDoc(null);
  const now = Date.now();
  const hit = cache.get(sanityId);
  if (hit && hit.expires > now) {
    const { expires: _expires, ...access } = hit;
    return access;
  }

  const doc = await serverClient.fetch<MemberAccessDoc | null>(
    `*[_type == "teamMembers" && _id == $id][0]${ACCESS_PROJECTION}`,
    { id: sanityId },
  );
  const access = accessFromDoc(doc);
  cache.set(sanityId, { ...access, expires: now + TTL_MS });
  return access;
}

/**
 * Live "is this member still allowed in" check, backed by the same 30s TTL cache
 * as getMemberAccess. A member is active iff their teamMembers doc exists and
 * disabled !== true.
 */
export async function isMemberActive(sanityId: string | undefined | null): Promise<boolean> {
  return (await getMemberAccess(sanityId)).active;
}
