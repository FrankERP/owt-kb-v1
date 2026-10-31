import { NextResponse } from "next/server";
import { requireActiveManager } from "@/app/utils/authGuards";

/**
 * The availability conflicts' admin guard (ADR-0079): an active manager, never a content-editor,
 * never while impersonating (as `/api/admin/chat`). Answers the member id, or the refusal.
 */
export async function conflictAdmin(): Promise<{ ok: true; memberId: string } | { ok: false; response: NextResponse }> {
  const session = await requireActiveManager();
  if (!session || session.user.role === "content-editor" || session.user.isImpersonating) {
    return { ok: false, response: NextResponse.json({ error: "Forbidden" }, { status: 403 }) };
  }
  return { ok: true, memberId: session.user.sanityId };
}
