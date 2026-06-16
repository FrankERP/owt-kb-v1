import { NextRequest, NextResponse } from "next/server";
import { requireActiveManager } from "@/app/utils/authGuards";
import { serverClient, writeClient } from "@/sanity/lib/serverClient";

export async function GET() {
  if (!await requireActiveManager()) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const tags = await serverClient.fetch(
    `*[_type == "tag"] | order(name asc) { _id, name, slug }`
  );

  return NextResponse.json(tags);
}

export async function POST(req: NextRequest) {
  if (!await requireActiveManager()) {
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
