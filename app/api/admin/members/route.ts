import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/auth";
import { serverClient } from "@/sanity/lib/serverClient";

async function requireSuperAdmin() {
  const session = await getServerSession(authOptions);
  if (session?.user.role !== "super-admin") return null;
  return session;
}

export async function GET() {
  if (!await requireSuperAdmin()) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const members = await serverClient.fetch(
    `*[_type == "teamMembers"] | order(member_name asc) {
      _id, member_name, alias, email, role, memberType,
      "hasPassword": defined(passwordHash) && passwordHash != ""
    }`
  );

  return NextResponse.json(members);
}

export async function POST(req: NextRequest) {
  if (!await requireSuperAdmin()) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { member_name, email, role } = await req.json() as {
    member_name?: string;
    email?: string;
    role?: string;
  };

  if (!member_name?.trim() || !email?.trim()) {
    return NextResponse.json({ error: "name and email required" }, { status: 400 });
  }

  const slug = member_name.toLowerCase().replace(/\s+/g, "-").replace(/[^a-z0-9-]/g, "");

  const doc = await serverClient.create({
    _type: "teamMembers",
    member_name: member_name.trim(),
    email: email.trim().toLowerCase(),
    role: role ?? "member",
    slug: { _type: "slug", current: slug },
  });

  return NextResponse.json(doc, { status: 201 });
}
