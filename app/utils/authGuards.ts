import { getServerSession, type Session } from "next-auth";
import { authOptions } from "@/auth";
import { getMemberAccess, isMemberActive } from "./memberAccess";
import { isMinistryManager, isMinistryMember } from "./ministryAccess";
import type { MinistryId } from "@/app/ministries";

export type ActiveSession = Session | null;

/**
 * Returns the session only if the (effective) member is still active.
 * Returns null for: no session, no sanityId, or a disabled/removed member.
 * Use the effective sanityId so an impersonated-but-disabled target is blocked.
 */
export async function requireActiveSession(): Promise<ActiveSession> {
  const session = await getServerSession(authOptions);
  const sanityId = session?.user?.sanityId;
  if (!sanityId) return null;
  if (!(await isMemberActive(sanityId))) return null;
  return session;
}

/** As above, but also requires an admin/super-admin/content-editor role. */
export async function requireActiveManager(): Promise<ActiveSession> {
  const session = await requireActiveSession();
  const role = session?.user?.role;
  if (!session || !role || !["super-admin", "admin", "content-editor"].includes(role)) return null;
  return session;
}

/**
 * Active session AND ministry MEMBERSHIP (or super-admin). Two-way isolation:
 * worship admin/content-editor roles grant nothing here — only membership or
 * super-admin. Absent/empty `ministries` normalizes to ["worship"] upstream.
 */
export async function requireMinistryMember(ministry: MinistryId): Promise<ActiveSession> {
  const session = await requireActiveSession();
  const sanityId = session?.user?.sanityId;
  if (!session || !sanityId) return null;
  return isMinistryMember(await getMemberAccess(sanityId), ministry) ? session : null;
}

/**
 * Active session AND ministry MANAGEMENT (or super-admin). Plain `admin` does
 * NOT pass for a ministry it does not manage (Frank, 2026-08-19): a worship
 * admin has no kids access. Management does not imply membership — except in a
 * leveled ministry (Jóvenes), where management IS the `admin` level of a member
 * (`isMinistryManager`, ADR-0075).
 */
export async function requireMinistryManager(ministry: MinistryId): Promise<ActiveSession> {
  const session = await requireActiveSession();
  const sanityId = session?.user?.sanityId;
  if (!session || !sanityId) return null;
  return isMinistryManager(await getMemberAccess(sanityId), ministry) ? session : null;
}
