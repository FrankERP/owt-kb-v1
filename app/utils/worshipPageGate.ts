import { redirect } from "next/navigation";
import { requireActiveSession, requireMinistryMember, type ActiveSession } from "./authGuards";
import { getMemberAccess } from "./memberAccess";

/**
 * Page gate for worship-only surfaces. Splits the two ways a visitor can fail:
 *
 *  - NO ACTIVE SESSION (no token, or a `disabled`/deleted member still holding a
 *    live cookie — the middleware only proves a token EXISTS, `proxy.ts:26` is
 *    `authorized: ({ token }) => !!token`): bounce to sign-in, exactly as `/me`
 *    already does. Sending this member to `/kids` instead would ping-pong
 *    against that route's own gate forever.
 *  - ACTIVE, BUT NOT A WORSHIP MEMBER: send them to a ministry they actually
 *    belong to.
 *
 * Using this makes a page dynamic (it reads cookies). That is deliberate and
 * knowingly reverses ADR-0007's static-rendering trade for these pages only —
 * see ADR-0020 and ADR-0007's Amendment section.
 *
 * Returns the active session (never null — every failing path redirects, which
 * throws). Pages needing the member's identity, such as `/me/propose/[roleId]`
 * reading `sanityId`, take it from here rather than decoding the session a
 * second time; pages that only need the gate ignore the return value.
 */
export async function requireWorshipPage(callbackPath: string): Promise<NonNullable<ActiveSession>> {
  const session = await requireActiveSession();
  if (!session) redirect(`/auth/signin?callbackUrl=${encodeURIComponent(callbackPath)}`);
  const worship = await requireMinistryMember("worship");
  if (worship) return session;
  // Send them to a ministry they ACTUALLY belong to. Redirecting every
  // non-worship visitor to /kids unconditionally would be correct only under an
  // unstated invariant — "every active member is in worship or kids" — which
  // neither the schema nor a future third ministry guarantees. A member of
  // NEITHER would bounce /kids -> / -> /kids forever, locked out with no
  // self-service recovery. /me is ministry-neutral and gated only on an active
  // session, so it always terminates.
  //
  // The read is free: it is the same 30s-TTL cache entry requireMinistryMember
  // just filled.
  const access = await getMemberAccess(session.user.sanityId);
  redirect(access.ministries.includes("kids") ? "/kids" : "/me");
}
