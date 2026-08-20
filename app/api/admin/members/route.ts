import { NextRequest, NextResponse } from "next/server";
import { requireActiveManager } from "@/app/utils/authGuards";
import { writeClient } from "@/sanity/lib/serverClient";
import { operationalClient } from "@/sanity/lib/operationalClient";
import { validateMinistryWrite } from "@/app/ministries";

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

  const members = await operationalClient.fetch(
    `*[_type == "teamMembers"] | order(member_name asc) {
      _id, member_name, alias, email, role, memberType, notifPrefs, ministries, managesMinistries,
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

  const body = await req.json() as {
    member_name?: string;
    alias?: string;
    email?: string;
    role?: string;
    memberType?: string[];
    ministries?: string[];
    managesMinistries?: string[];
  };
  const { member_name, alias, email, role, memberType, ministries, managesMinistries } = body;

  if (!member_name?.trim() || !email?.trim()) {
    return NextResponse.json({ error: "name and email required" }, { status: 400 });
  }

  // The SAME validator PATCH uses, so create and edit cannot drift: an
  // explicitly empty `ministries` is rejected rather than stored, and an
  // absent one stays absent (absent ⇒ worship by the storage contract; writing
  // `[]` here would read back as full worship access).
  for (const field of ["ministries", "managesMinistries"] as const) {
    if (body[field] === undefined) continue;
    const error = validateMinistryWrite(field, body[field]);
    if (error) return NextResponse.json({ error }, { status: 400 });
  }

  const slug = member_name.toLowerCase().replace(/\s+/g, "-").replace(/[^a-z0-9-]/g, "");

  const doc = await writeClient.create({
    _type: "teamMembers",
    member_name: member_name.trim(),
    ...(alias?.trim() ? { alias: alias.trim() } : {}),
    email: email.trim().toLowerCase(),
    role: role ?? "member",
    memberType: memberType ?? [],
    ...(ministries !== undefined ? { ministries } : {}),
    ...(managesMinistries !== undefined ? { managesMinistries } : {}),
    slug: { _type: "slug", current: slug },
  });

  return NextResponse.json(doc, { status: 201 });
}
