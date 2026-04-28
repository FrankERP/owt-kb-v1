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
    `*[_type == "teamMembers" && _id == $id][0] { unavailableDates }`,
    { id: session.user.sanityId }
  );

  return NextResponse.json({ unavailableDates: member?.unavailableDates ?? [] });
}

export async function PATCH(req: NextRequest) {
  const session = await getSessionMember();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { unavailableDates } = await req.json() as { unavailableDates: string[] };

  if (!Array.isArray(unavailableDates)) {
    return NextResponse.json({ error: "unavailableDates must be an array" }, { status: 400 });
  }

  // Validate all entries are ISO date strings
  const valid = unavailableDates.filter(d => /^\d{4}-\d{2}-\d{2}$/.test(d));

  const doc = await writeClient
    .patch(session.user.sanityId)
    .set({ unavailableDates: valid })
    .commit();

  return NextResponse.json({ unavailableDates: (doc as any).unavailableDates ?? [] });
}
