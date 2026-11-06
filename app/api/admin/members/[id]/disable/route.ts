import { NextRequest, NextResponse } from "next/server";
import { getToken } from "next-auth/jwt";
import { requireActiveManager } from "@/app/utils/authGuards";
import { setMemberDisabled } from "@/app/utils/memberCommit";
import { withVerificationRunContext } from "@/app/utils/srVerificationRunContext";

function operatorIds(token: Awaited<ReturnType<typeof getToken>>): Set<string> {
  const ids = new Set<string>();
  if (!token || typeof token === "string") return ids;
  if (typeof token.sanityId === "string" && token.sanityId) ids.add(token.sanityId);
  const real = token.__realAdmin?.sanityId;
  if (typeof real === "string" && real) ids.add(real);
  return ids;
}

// Wrapped because the module it calls is a `*Commit` (`srVerificationRunContext.test.ts` scans by
// import); a people write sends nothing, and an unmarked request behaves as before.
export const PATCH = withVerificationRunContext(patchHandler);

/**
 * Disable or re-enable a person's access. Everything after authorization is `setMemberDisabled`
 * (`app/utils/memberCommit.ts`), which the MCP `set_member_access` shares.
 */
async function patchHandler(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await requireActiveManager();
  if (!session) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  if (session.user.role !== "super-admin") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { id } = await params;
  const body = await req.json() as { disabled?: boolean };
  if (typeof body.disabled !== "boolean") {
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  }

  const token = await getToken({ req, secret: process.env.NEXTAUTH_SECRET });
  const outcome = await setMemberDisabled(id, body.disabled, { operatorIds: operatorIds(token) });
  return NextResponse.json(outcome.body, { status: outcome.status });
}
