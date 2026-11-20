import { NextResponse } from "next/server";
import { requireActiveSession } from "@/app/utils/authGuards";
import { fetchMemberAccessFresh } from "@/app/utils/memberAccess";
import { canonicalOrigin } from "@/app/mcp/oauth/origin";
import { APP_REVOKE_REASON, revokeAllAppGrants } from "@/app/appAuth/grantStore";

// «Cerrar sesiones de la app» on a member in /admin (ADR-0091, spec D9): a lost
// phone. Super-admin only, read on LIVE access (a fresh snapshot, not the JWT's
// role and not the 30 s cache, so a demotion bites on the next request), and
// refused while impersonating (the session's identity would be the target's).
//
// Revokes every live app grant of that member on THIS deployment, in one Sanity
// transaction: all or none, and a failure answers 503 so the button can say «No
// se pudo cerrar; intenta de nuevo». It does not span origins (spec D9). A member
// with no live grant answers 200 with `revoked: 0`; the id is not pinned to a
// member type because the write touches only `appAuthGrant` documents whose
// `sub` equals it — an id that is not a member's simply matches none.

export async function POST(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await requireActiveSession();
  const actorId = session?.user?.sanityId;
  if (!session || !actorId) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  if (session.user.isImpersonating) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  const access = await fetchMemberAccessFresh(actorId);
  if (!access.active || access.role !== "super-admin") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const origin = canonicalOrigin();
  if (!origin) {
    return NextResponse.json({ error: "No se pudo cerrar; intenta de nuevo." }, { status: 503 });
  }

  const { id } = await params;
  if (typeof id !== "string" || id === "") {
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  }

  const outcome = await revokeAllAppGrants(id, origin, APP_REVOKE_REASON.admin);
  if (!outcome.ok) {
    console.error("[app-auth] admin revoke-all failed", outcome.cause);
    return NextResponse.json({ error: "No se pudo cerrar; intenta de nuevo." }, { status: 503 });
  }
  return NextResponse.json({ ok: true, revoked: outcome.revoked });
}
