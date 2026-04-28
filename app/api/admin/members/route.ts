import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/auth";
import { serverClient, writeClient } from "@/sanity/lib/serverClient";

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
      unavailableDates,
      "hasPassword": defined(passwordHash) && passwordHash != "",
      "photoUrl": coalesce(profilePhoto.asset->url, googlePhotoUrl)
    }`
  );

  return NextResponse.json(members);
}

export async function POST(req: NextRequest) {
  if (!await requireSuperAdmin()) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { member_name, alias, email, role, memberType } = await req.json() as {
    member_name?: string;
    alias?: string;
    email?: string;
    role?: string;
    memberType?: string[];
  };

  if (!member_name?.trim() || !email?.trim()) {
    return NextResponse.json({ error: "name and email required" }, { status: 400 });
  }

  const slug = member_name.toLowerCase().replace(/\s+/g, "-").replace(/[^a-z0-9-]/g, "");

  const doc = await writeClient.create({
    _type: "teamMembers",
    member_name: member_name.trim(),
    ...(alias?.trim() ? { alias: alias.trim() } : {}),
    email: email.trim().toLowerCase(),
    role: role ?? "member",
    memberType: memberType ?? [],
    slug: { _type: "slug", current: slug },
  });

  return NextResponse.json(doc, { status: 201 });
}
