import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/auth";
import { serverClient } from "@/sanity/lib/serverClient";

export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const q = req.nextUrl.searchParams.get("q")?.trim() ?? "";

  const songs = await serverClient.fetch(
    q
      ? `*[_type == "post" && (title match $pattern || author match $pattern)] | order(title asc) [0..29] {
           _id, title, author, key, "slug": slug.current
         }`
      : `*[_type == "post"] | order(title asc) [0..49] {
           _id, title, author, key, "slug": slug.current
         }`,
    { pattern: `${q}*` }
  );

  return NextResponse.json(songs);
}
