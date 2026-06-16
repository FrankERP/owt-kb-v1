import { NextResponse } from "next/server";
import { requireActiveSession } from "@/app/utils/authGuards";
import { writeClient } from "@/sanity/lib/serverClient";

export async function POST() {
  const session = await requireActiveSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    await writeClient
      .patch(session.user.sanityId)
      .set({ lastSeen: new Date().toISOString() })
      .commit();
  } catch {
    // Non-fatal — don't break the user's session if tracking fails
  }

  return NextResponse.json({ ok: true });
}
