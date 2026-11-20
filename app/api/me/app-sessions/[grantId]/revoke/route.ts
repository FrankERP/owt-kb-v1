import { NextResponse } from "next/server";
import { requireActiveSession } from "@/app/utils/authGuards";
import { canonicalOrigin } from "@/app/mcp/oauth/origin";
import { APP_REVOKE_REASON, loadAppGrant, revokeAppGrant } from "@/app/appAuth/grantStore";
import { isAppGrantId } from "@/app/appAuth/grantDocument";

// «Cerrar sesión en ese dispositivo» in «Apps conectadas» (ADR-0091, spec D9).
//
// The person closes ONE of their own native-app sessions. Refused unless the
// grant is theirs (`sub`) AND this deployment's (`origin`), and refused while a
// super-admin impersonates (the list would be the target's). A grant that is not
// theirs, not this deployment's, already revoked or absent answers the same 404,
// so the route is no oracle for anyone else's sessions. The grant is read FRESH:
// the 30 s cache could hide a revocation another path just wrote.

const NOT_FOUND = { error: "Sesión no encontrada." } as const;
const UNAVAILABLE = { error: "No se pudo cerrar; intenta de nuevo." } as const;

export async function POST(
  _req: Request,
  { params }: { params: Promise<{ grantId: string }> },
) {
  const session = await requireActiveSession();
  const sanityId = session?.user?.sanityId;
  if (!session || !sanityId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (session.user.isImpersonating) {
    return NextResponse.json({ error: "Termina la suplantación para cerrar sesiones." }, { status: 403 });
  }
  const origin = canonicalOrigin();
  if (!origin) return NextResponse.json(UNAVAILABLE, { status: 503 });

  const { grantId } = await params;
  // W9: only an app grant id reaches the store; the store's read also pins `_type`.
  if (!isAppGrantId(grantId)) return NextResponse.json(NOT_FOUND, { status: 404 });

  const loaded = await loadAppGrant(grantId, { fresh: true });
  if (!loaded.ok) {
    if (loaded.reason === "server_error") {
      console.error("[app-auth] /me revoke: grant read failed", loaded.cause);
      return NextResponse.json(UNAVAILABLE, { status: 503 });
    }
    return NextResponse.json(NOT_FOUND, { status: 404 });
  }
  if (loaded.grant.sub !== sanityId || loaded.grant.origin !== origin) {
    return NextResponse.json(NOT_FOUND, { status: 404 });
  }

  const revoked = await revokeAppGrant(grantId, APP_REVOKE_REASON.member);
  if (!revoked.ok) {
    console.error("[app-auth] /me revoke: write failed", revoked.cause);
    return NextResponse.json(UNAVAILABLE, { status: 503 });
  }
  return NextResponse.json({ ok: true });
}
