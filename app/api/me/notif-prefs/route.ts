import { NextRequest, NextResponse } from "next/server";
import { requireActiveSession } from "@/app/utils/authGuards";
import { writeClient } from "@/sanity/lib/serverClient";

export async function PATCH(req: NextRequest) {
  const session = await requireActiveSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await req.json() as { email?: boolean };
  if (typeof body.email !== "boolean") {
    return NextResponse.json({ error: "email must be a boolean" }, { status: 400 });
  }

  const doc = await writeClient
    .patch(session.user.sanityId)
    .setIfMissing({ notifPrefs: {} })
    .set({ "notifPrefs.email": body.email })
    .commit();

  const email = (doc as { notifPrefs?: { email?: boolean } }).notifPrefs?.email;
  return NextResponse.json({ email: email !== false });
}
