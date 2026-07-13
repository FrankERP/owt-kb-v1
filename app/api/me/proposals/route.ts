import { NextRequest, NextResponse } from "next/server";
import { requireActiveSession } from "@/app/utils/authGuards";
import { serverClient, writeClient } from "@/sanity/lib/serverClient";
import { notifyProposalSubmitted } from "@/app/utils/proposalNotify";
import { mergeContributor, type StoredContributor } from "@/app/utils/proposalContributors";

function rkey() {
  return Math.random().toString(36).slice(2, 9);
}

// A Sanity create-id collision or an ifRevisionId mismatch both surface as a
// ClientError with statusCode 409.
function isConflict(err: unknown): boolean {
  const e = err as { statusCode?: number; response?: { statusCode?: number } } | null;
  return e?.statusCode === 409 || e?.response?.statusCode === 409;
}

// GET /api/me/proposals — the shared proposal for every service the current user
// is a Lead on (not only ones they authored). Mirrors the /me superset.
export async function GET() {
  const session = await requireActiveSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const proposals = await serverClient.fetch(
    `*[_type == "setlistProposal" && $id in service_ref->Lead[]._ref] | order(service_date asc) {
      _id, service_type, service_date, status, lead_notes, team_notes, admin_notes, submitted_at, reviewed_at,
      "service_ref": service_ref._ref
    }`,
    { id: session.user.sanityId }
  );

  return NextResponse.json(proposals);
}

// POST /api/me/proposals — create or update the ONE shared proposal for a service.
// Body: { roleId, songs:[{songId, play_key, medley_tag?}], leadNotes, teamNotes, status, rev? }
export async function POST(req: NextRequest) {
  const session = await requireActiveSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await req.json() as {
    roleId: string;
    songs: Array<{ songId: string; play_key: string; medley_tag?: string }>;
    leadNotes?: string;
    teamNotes?: string;
    status: "draft" | "pending";
    rev?: string | null;
  };

  const { roleId, songs, leadNotes, teamNotes, status, rev } = body;
  if (!roleId) {
    return NextResponse.json({ error: "roleId required" }, { status: 400 });
  }
  if (status !== "draft" && status !== "pending") {
    return NextResponse.json({ error: "status must be 'draft' or 'pending'" }, { status: 400 });
  }

  const leadId = session.user.sanityId;

  // Authorise + derive service_type/service_date server-side: caller must be a
  // Lead on this (published) service. This is what makes editing the shared doc
  // safe — only assigned leads write.
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
    ...(s.medley_tag ? { medley_tag: s.medley_tag } : {}),
    song: { _type: "reference" as const, _ref: s.songId },
  }));

  const now = new Date().toISOString();

  // Find the shared proposal for this service. Matches legacy random-id docs too
  // (keyed on service content, not id). order()[0] makes "exactly one wins"
  // robust if a stray duplicate ever slipped through.
  const existing = await serverClient.fetch<{
    _id: string; _rev: string; status: string; contributors?: StoredContributor[];
  } | null>(
    `*[_type == "setlistProposal" && service_ref._ref == $roleId] | order(_createdAt asc)[0]{
      _id, _rev, status, contributors
    }`,
    { roleId }
  );

  // ── Create path ──────────────────────────────────────────────────────────
  // Deterministic _id is a create-mutex: two co-leads who both see "no doc" and
  // both create for the same service collide on the id — the second throws and
  // we surface 409 (reload). Uses create() (not createIfNotExists) precisely so
  // the loser is told, rather than silently no-op'd.
  if (!existing) {
    try {
      const created = await writeClient.create({
        _id: `setlistProposal.${roleId}`,
        _type: "setlistProposal",
        service_type: serviceType,
        service_ref: { _type: "reference", _ref: roleId },
        service_date: serviceDate,
        lead: { _type: "reference", _ref: leadId },
        contributors: [{ _type: "contributor", _key: rkey(), person: { _type: "reference", _ref: leadId } }],
        last_edited_by: { _type: "reference", _ref: leadId },
        last_edited_at: now,
        songs: songDocs,
        status,
        lead_notes: leadNotes ?? "",
        team_notes: teamNotes ?? "",
        ...(status === "pending" ? { submitted_at: now, submitted_by: { _type: "reference", _ref: leadId } } : {}),
      });
      if (status === "pending") {
        await notifyProposalSubmitted({ leadId, roleId, serviceType, serviceDate });
      }
      return NextResponse.json({ _id: created._id, _rev: created._rev, status });
    } catch (err) {
      if (isConflict(err)) return NextResponse.json({ error: "stale" }, { status: 409 });
      throw err;
    }
  }

  // ── Update path ──────────────────────────────────────────────────────────
  // Never mutate an approved shared doc via the member path — it already wrote
  // the live setlist; re-opening is an admin-only transition (see admin route).
  if (existing.status === "approved") {
    return NextResponse.json({ error: "approved" }, { status: 409 });
  }
  // Never blind-overwrite an existing doc without a matching revision.
  if (!rev) {
    return NextResponse.json({ error: "stale" }, { status: 409 });
  }

  const nextContributors = mergeContributor(existing.contributors, leadId, rkey);

  try {
    await writeClient
      .patch(existing._id)
      .ifRevisionId(rev)
      .set({
        songs: songDocs,
        status,
        lead_notes: leadNotes ?? "",
        team_notes: teamNotes ?? "",
        contributors: nextContributors,
        last_edited_by: { _type: "reference", _ref: leadId },
        last_edited_at: now,
        ...(status === "pending" ? { submitted_at: now, submitted_by: { _type: "reference", _ref: leadId } } : {}),
      })
      .commit();
  } catch (err) {
    if (isConflict(err)) return NextResponse.json({ error: "stale" }, { status: 409 });
    throw err;
  }

  if (status === "pending") {
    await notifyProposalSubmitted({ leadId, roleId, serviceType, serviceDate });
  }

  // Return the fresh revision so the client can keep editing without a reload.
  const freshRev = await serverClient.fetch<string | null>(`*[_id == $id][0]._rev`, { id: existing._id });
  return NextResponse.json({ _id: existing._id, _rev: freshRev, status });
}
