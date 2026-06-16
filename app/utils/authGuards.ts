import { getServerSession, type Session } from "next-auth";
import { authOptions } from "@/auth";
import { isMemberActive } from "./memberAccess";

export type ActiveSession = Session | null;

/**
 * Returns the session only if the (effective) member is still active.
 * Returns null for: no session, no sanityId, or a disabled/removed member.
 * Use the effective sanityId so an impersonated-but-disabled target is blocked.
 */
export async function requireActiveSession(): Promise<ActiveSession | null> {
  const session = await getServerSession(authOptions);
  const sanityId = session?.user?.sanityId;
  if (!sanityId) return null;
  if (!(await isMemberActive(sanityId))) return null;
  return session;
}

/** As above, but also requires an admin/super-admin/content-editor role. */
export async function requireActiveManager(): Promise<ActiveSession | null> {
  const session = await requireActiveSession();
  const role = session?.user?.role;
  if (!session || !role || !["super-admin", "admin", "content-editor"].includes(role)) return null;
  return session;
}
