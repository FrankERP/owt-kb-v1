import { NextRequest, NextResponse } from "next/server";
import { requireActiveManager } from "@/app/utils/authGuards";
import { serverClient, writeClient } from "@/sanity/lib/serverClient";
import { slugifyAuthor } from "@/app/utils/slugifyAuthor.mjs";

export async function GET() {
  if (!await requireActiveManager()) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  const authors = await serverClient.fetch(
    `*[_type == "author"] | order(name asc) { _id, name, slug }`
  );
  return NextResponse.json(authors);
}

export async function POST(req: NextRequest) {
  if (!await requireActiveManager()) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  const { name } = await req.json() as { name?: string };
  if (!name?.trim()) {
    return NextResponse.json({ error: "name required" }, { status: 400 });
  }
  const slug = slugifyAuthor(name.trim());
  // Idempotent by slug: return the existing author instead of creating a
  // duplicate (or slug-colliding) doc that would fragment the taxonomy.
  const existing = await serverClient.fetch(
    `*[_type == "author" && slug.current == $slug][0]{ _id, name, slug }`,
    { slug }
  );
  if (existing) return NextResponse.json(existing);

  const author = await writeClient.create({
    _type: "author",
    name: name.trim(),
    slug: { _type: "slug", current: slug },
  });
  return NextResponse.json(author, { status: 201 });
}
