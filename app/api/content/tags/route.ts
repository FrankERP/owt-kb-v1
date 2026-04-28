import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/auth";
import { serverClient, writeClient } from "@/sanity/lib/serverClient";

type OWTRole = "super-admin" | "admin" | "content-editor" | "member";
const CONTENT_ROLES: OWTRole[] = ["super-admin", "admin", "content-editor"];

async function requireContentRole() {
  const session = await getServerSession(authOptions);
  if (!CONTENT_ROLES.includes(session?.user.role as OWTRole)) return null;
  return session;
}

export async function GET() {
  if (!await requireContentRole()) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const tags = await serverClient.fetch(
    `*[_type == "tag"] | order(name asc) { _id, name, slug }`
  );

  return NextResponse.json(tags);
}

export async function POST(req: NextRequest) {
  if (!await requireContentRole()) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { name } = await req.json() as { name?: string };
  if (!name?.trim()) {
    return NextResponse.json({ error: "name required" }, { status: 400 });
  }

  const slug = name.trim().toLowerCase().replace(/\s+/g, "-").replace(/[^a-z0-9-]/g, "");

  const tag = await writeClient.create({
    _type: "tag",
    name: name.trim(),
    slug: { _type: "slug", current: slug },
  });

  return NextResponse.json(tag, { status: 201 });
}
