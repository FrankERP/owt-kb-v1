import { NextResponse } from "next/server";
import { requireActiveManager } from "@/app/utils/authGuards";
import { readAdminProposals } from "@/app/utils/adminProposalsRead";

export async function GET() {
  const session = await requireActiveManager();
  if (!session) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  // Restricted to admin and super-admin (not content-editor)
  if (session.user.role === "content-editor") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  // The query and its contract notes live in `adminProposalsRead.ts`, which the native app's
  // `GET /api/app/v1/admin/proposals` shares (A-W1).
  const proposals = await readAdminProposals();

  return NextResponse.json(proposals);
}
