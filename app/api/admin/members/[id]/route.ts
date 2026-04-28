import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/auth";
import { writeClient } from "@/sanity/lib/serverClient";

async function requireSuperAdmin() {
  const session = await getServerSession(authOptions);
  if (session?.user.role !== "super-admin") return null;
  return session;
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  if (!await requireSuperAdmin()) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { id } = await params;
  const body = await req.json() as {
    member_name?: string;
    alias?: string;
    email?: string;
    role?: string;
    memberType?: string[];
  };

  const patch: Record<string, unknown> = {};
  if (body.member_name?.trim()) patch.member_name = body.member_name.trim();
  if (body.alias !== undefined) patch.alias = body.alias.trim();
  if (body.email?.trim()) patch.email = body.email.trim().toLowerCase();
  if (body.role) patch.role = body.role;
  if (Array.isArray(body.memberType)) patch.memberType = body.memberType;

  if (Object.keys(patch).length === 0) {
    return NextResponse.json({ error: "Nothing to update" }, { status: 400 });
  }

  const doc = await writeClient.patch(id).set(patch).commit();
  return NextResponse.json(doc);
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  if (!await requireSuperAdmin()) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { id } = await params;
  await writeClient.delete(id);
  return NextResponse.json({ ok: true });
}
