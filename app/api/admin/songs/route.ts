import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/auth";
import { serverClient } from "@/sanity/lib/serverClient";

async function requireManager() {
  const session = await getServerSession(authOptions);
  const role = session?.user.role;
  if (role !== "super-admin" && role !== "admin") return null;
  return session;
}

export async function GET(req: NextRequest) {
  if (!await requireManager()) {
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
