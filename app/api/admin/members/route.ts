import { NextRequest, NextResponse } from "next/server";
import { requireActiveManager } from "@/app/utils/authGuards";
import { operationalClient } from "@/sanity/lib/operationalClient";
import { adminMembersQuery } from "@/app/utils/serviceReadQueries";
import { createMember } from "@/app/utils/memberCommit";
import { withVerificationRunContext } from "@/app/utils/srVerificationRunContext";

// Wrapped because the module it calls is a `*Commit` (`srVerificationRunContext.test.ts` scans by
// import); a people write sends nothing, and an unmarked request behaves as before.
export const POST = withVerificationRunContext(postHandler);

// Reading the member list is needed by the Servicios/Disponibilidad panels (admin-accessible).
// Creating/editing members stays super-admin only (Miembros section).

export async function GET() {
  const session = await requireActiveManager();
  if (!session) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  // GET is restricted to admin and super-admin (not content-editor)
  if (session.user.role === "content-editor") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  // Worship admins see worship members only; a super-admin sees everyone,
  // because they are the only role that can edit `ministries` at all.
  const q = adminMembersQuery(session.user.role === "super-admin");
  const members = await operationalClient.fetch(q.query, q.params);

  return NextResponse.json(members);
}

async function postHandler(req: NextRequest) {
  const session = await requireActiveManager();
  if (!session) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  // POST is super-admin only
  if (session.user.role !== "super-admin") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  // Everything after authorization is `createMember` (`app/utils/memberCommit.ts`), which the MCP
  // `create_members` shares: the same validation, plus a refused repeated email (D5) and name (D12).
  const outcome = await createMember(await req.json());
  return NextResponse.json(outcome.body, { status: outcome.status });
}
