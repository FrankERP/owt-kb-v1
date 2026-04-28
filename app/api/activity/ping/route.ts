import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/auth";
import { writeClient } from "@/sanity/lib/serverClient";

export async function POST() {
  const session = await getServerSession(authOptions);
  if (!session?.user?.sanityId) {
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
