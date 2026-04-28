import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/auth";
import { serverClient, writeClient } from "@/sanity/lib/serverClient";

async function getSessionMember() {
  const session = await getServerSession(authOptions);
  if (!session?.user?.sanityId) return null;
  return session;
}

export async function GET() {
  const session = await getSessionMember();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const member = await serverClient.fetch(
    `*[_type == "teamMembers" && _id == $id][0] {
      _id, member_name, alias, email, role, memberType,
      "photoUrl": coalesce(profilePhoto.asset->url, googlePhotoUrl),
      "hasPassword": defined(passwordHash) && passwordHash != ""
    }`,
    { id: session.user.sanityId }
  );

  return NextResponse.json(member);
}

export async function PATCH(req: NextRequest) {
  const session = await getSessionMember();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await req.json() as { alias?: string; email?: string };
  const patch: Record<string, unknown> = {};
  if (body.alias !== undefined) patch.alias = body.alias.trim();
  if (body.email?.trim()) patch.email = body.email.trim().toLowerCase();

  if (Object.keys(patch).length === 0) {
    return NextResponse.json({ error: "Nothing to update" }, { status: 400 });
  }

  const doc = await writeClient.patch(session.user.sanityId).set(patch).commit();
  return NextResponse.json(doc);
}
