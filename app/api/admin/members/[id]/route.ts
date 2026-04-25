import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/auth";
import { serverClient } from "@/sanity/lib/serverClient";

async function requireSuperAdmin() {
  const session = await getServerSession(authOptions);
  if (session?.user.role !== "super-admin") return null;
  return session;
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  if (!await requireSuperAdmin()) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const body = await req.json() as {
    member_name?: string;
    email?: string;
    role?: string;
  };

  const patch: Record<string, string> = {};
  if (body.member_name?.trim()) patch.member_name = body.member_name.trim();
  if (body.email?.trim()) patch.email = body.email.trim().toLowerCase();
  if (body.role) patch.role = body.role;

  if (Object.keys(patch).length === 0) {
    return NextResponse.json({ error: "Nothing to update" }, { status: 400 });
  }

  const doc = await serverClient.patch(params.id).set(patch).commit();
  return NextResponse.json(doc);
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: { id: string } }
) {
  if (!await requireSuperAdmin()) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  await serverClient.delete(params.id);
  return NextResponse.json({ ok: true });
}
