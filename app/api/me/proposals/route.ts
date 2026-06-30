import { NextRequest, NextResponse } from "next/server";
import { requireActiveSession } from "@/app/utils/authGuards";
import { serverClient, writeClient } from "@/sanity/lib/serverClient";
import { sendPush } from "@/app/utils/push";

function rkey() {
  return Math.random().toString(36).slice(2, 9);
}

// GET /api/me/proposals — all proposals for the current user
export async function GET() {
  const session = await requireActiveSession();
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
  const session = await requireActiveSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await req.json() as {
    roleId: string;
    songs: Array<{ songId: string; play_key: string }>;
    leadNotes?: string;
    status: "draft" | "pending";
  };

  const { roleId, songs, leadNotes, status } = body;
  if (!roleId) {
    return NextResponse.json({ error: "roleId required" }, { status: 400 });
  }
  if (status !== "draft" && status !== "pending") {
    return NextResponse.json({ error: "status must be 'draft' or 'pending'" }, { status: 400 });
  }

  const leadId = session.user.sanityId;

  // Verify user is Lead on this service AND derive service_type/service_date server-side
  const roleDoc = await serverClient.fetch(
    `*[_id == $id && $leadId in Lead[]._ref && published != false][0]{ _id, _type, week, date }`,
    { id: roleId, leadId }
  );
  if (!roleDoc) {
    return NextResponse.json({ error: "Not a Lead on this service" }, { status: 403 });
  }

  const serviceType =
    roleDoc._type === "sunday_role"   ? "sunday"   :
    roleDoc._type === "saturday_role" ? "saturday" :
    roleDoc._type === "special_role"  ? "special"  : null;
  if (!serviceType) {
    return NextResponse.json({ error: "Unsupported role type" }, { status: 400 });
  }
  const serviceDate: string | undefined = roleDoc.week ?? roleDoc.date;
  if (!serviceDate) {
    return NextResponse.json({ error: "Role document missing date" }, { status: 400 });
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
    if (status === "pending") {
      try {
        const adminIds = await serverClient.fetch<string[]>(
          `*[_type == "teamMembers" && role in ["super-admin","admin"]]._id`
        );
        void sendPush(adminIds, "proposals", { title: "Nueva propuesta", body: "Hay una propuesta de setlist por revisar.", path: "/admin" });
      } catch (err) {
        console.error("[push] notify failed:", err);
      }
    }
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

  if (status === "pending") {
    try {
      const adminIds = await serverClient.fetch<string[]>(
        `*[_type == "teamMembers" && role in ["super-admin","admin"]]._id`
      );
      void sendPush(adminIds, "proposals", { title: "Nueva propuesta", body: "Hay una propuesta de setlist por revisar.", path: "/admin" });
    } catch (err) {
      console.error("[push] notify failed:", err);
    }
  }

  return NextResponse.json({ _id: created._id, status });
}
