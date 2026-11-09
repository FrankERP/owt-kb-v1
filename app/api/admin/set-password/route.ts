import { NextRequest, NextResponse } from "next/server";
import { requireActiveManager } from "@/app/utils/authGuards";
import bcrypt from "bcryptjs";
import { writeClient } from "@/sanity/lib/serverClient";
import { storedRevisionOfType } from "@/app/utils/typePin";

export async function POST(req: NextRequest) {
  const session = await requireActiveManager();
  if (!session) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  // Restricted to super-admin only
  if (session.user.role !== "super-admin") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const body = await req.json();
  const { sanityMemberId, password } = body as { sanityMemberId?: string; password?: string };

  if (!sanityMemberId || !password || password.length < 8) {
    return NextResponse.json({ error: "sanityMemberId and password (min 8 chars) required" }, { status: 400 });
  }

  // W9 (ADR-0081): a password goes on a member only; any other id answers 404.
  if (!(await storedRevisionOfType(sanityMemberId, "teamMembers"))) {
    return NextResponse.json({ error: "Miembro no encontrado." }, { status: 404 });
  }

  const hash = await bcrypt.hash(password, 12);

  await writeClient
    .patch(sanityMemberId)
    .set({ passwordHash: hash })
    .commit();

  return NextResponse.json({ ok: true });
}
