import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/auth";
import { serverClient, writeClient } from "@/sanity/lib/serverClient";

function rkey() {
  return Math.random().toString(36).slice(2, 9);
}

// GET /api/me/proposals — all proposals for the current user
export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const proposals = await serverClient.fetch(
    `*[_type == "setlistProposal" && lead._ref == $id] | order(service_date asc) {
      _id, service_type, service_date, status, lead_notes, admin_notes, submitted_at, reviewed_at,
      "service_ref": service_ref._ref
    }`,
    { id: session.user.sanityId }
  );

  return NextResponse.json(proposals);
}

// POST /api/me/proposals — create or update a proposal
// Body: { roleId, serviceType, serviceDate, songs: [{songId, play_key}], leadNotes, status }
export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await req.json() as {
    roleId: string;
    serviceType: "sunday" | "saturday" | "special";
    serviceDate: string;
    songs: Array<{ songId: string; play_key: string }>;
    leadNotes?: string;
    status: "draft" | "pending";
  };

  const { roleId, serviceType, serviceDate, songs, leadNotes, status } = body;
  if (!roleId || !serviceType || !serviceDate) {
    return NextResponse.json({ error: "roleId, serviceType, serviceDate required" }, { status: 400 });
  }

  const leadId = session.user.sanityId;

  // Verify user is Lead on this service
  const roleDoc = await serverClient.fetch(
    `*[_id == $id && $leadId in Lead[]._ref][0]._id`,
    { id: roleId, leadId }
  );
  if (!roleDoc) {
    return NextResponse.json({ error: "Not a Lead on this service" }, { status: 403 });
  }

  const songDocs = songs.map(s => ({
    _type: "proposal_song" as const,
    _key: rkey(),
    play_key: s.play_key,
    song: { _type: "reference" as const, _ref: s.songId },
  }));

  const now = new Date().toISOString();

  // Upsert: find existing proposal for (lead, service_ref)
  const existing = await serverClient.fetch(
    `*[_type == "setlistProposal" && lead._ref == $leadId && service_ref._ref == $roleId][0]._id`,
    { leadId, roleId }
  );

  if (existing) {
    const patch = writeClient.patch(existing).set({
      songs: songDocs,
      status,
      lead_notes: leadNotes ?? "",
      ...(status === "pending" ? { submitted_at: now } : {}),
    });
    await patch.commit();
    return NextResponse.json({ _id: existing, status });
  }

  const created = await writeClient.create({
    _type: "setlistProposal",
    service_type: serviceType,
    service_ref: { _type: "reference", _ref: roleId },
    service_date: serviceDate,
    lead: { _type: "reference", _ref: leadId },
    songs: songDocs,
    status,
    lead_notes: leadNotes ?? "",
    ...(status === "pending" ? { submitted_at: now } : {}),
  });

  return NextResponse.json({ _id: created._id, status });
}
