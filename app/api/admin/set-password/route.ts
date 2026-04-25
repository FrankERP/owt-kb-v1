import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/auth";
import bcrypt from "bcryptjs";
import { serverClient } from "@/sanity/lib/serverClient";

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session || session.user.role !== "super-admin") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const body = await req.json();
  const { sanityMemberId, password } = body as { sanityMemberId?: string; password?: string };

  if (!sanityMemberId || !password || password.length < 8) {
    return NextResponse.json({ error: "sanityMemberId and password (min 8 chars) required" }, { status: 400 });
  }

  const hash = await bcrypt.hash(password, 12);

  await serverClient
    .patch(sanityMemberId)
    .set({ passwordHash: hash })
    .commit();

  return NextResponse.json({ ok: true });
}
