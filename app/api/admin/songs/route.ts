import { NextRequest, NextResponse } from "next/server";
import { requireActiveManager } from "@/app/utils/authGuards";
import { serverClient } from "@/sanity/lib/serverClient";

export async function GET(req: NextRequest) {
  const session = await requireActiveManager();
  if (!session) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  // Restricted to admin and super-admin (not content-editor)
  if (session.user.role === "content-editor") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const q = req.nextUrl.searchParams.get("q")?.trim() ?? "";

  const songs = await serverClient.fetch(
    q
      ? `*[_type == "post" && title match $pattern] | order(title asc) [0..24] {
           _id, title, author, key, "slug": slug.current
         }`
      : `*[_type == "post"] | order(title asc) [0..24] {
           _id, title, author, key, "slug": slug.current
         }`,
    { pattern: `${q}*` }
  );

  return NextResponse.json(songs);
}
