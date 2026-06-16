import { NextRequest, NextResponse } from "next/server";
import { requireActiveManager } from "@/app/utils/authGuards";
import { serverClient, writeClient } from "@/sanity/lib/serverClient";

// Reading the member list is needed by the Servicios/Disponibilidad panels (admin-accessible).
// Creating/editing members stays super-admin only (Miembros section).

export async function GET() {
  const session = await requireActiveManager();
  if (!session) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  // GET is restricted to admin and super-admin (not content-editor)
  if (session.user.role === "content-editor") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const members = await serverClient.fetch(
    `*[_type == "teamMembers"] | order(member_name asc) {
      _id, member_name, alias, email, role, memberType,
      unavailableDates, unavailabilityNotes,
      "hasPassword": defined(passwordHash) && passwordHash != "",
      "photoUrl": coalesce(profilePhoto.asset->url, googlePhotoUrl)
    }`
  );

  return NextResponse.json(members);
}

export async function POST(req: NextRequest) {
  const session = await requireActiveManager();
  if (!session) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  // POST is super-admin only
  if (session.user.role !== "super-admin") {
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
