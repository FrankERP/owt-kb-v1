import { NextRequest, NextResponse } from "next/server";
import { requireActiveManager } from "@/app/utils/authGuards";
import { serverClient, writeClient } from "@/sanity/lib/serverClient";
import { sendPush } from "@/app/utils/push";
import { revalidateServiceViews } from "@/app/utils/revalidate";

function rkey() {
  return Math.random().toString(36).slice(2, 9);
}

// PATCH /api/admin/proposals/[id]
// Body: { action: "approve" | "request_changes", adminNotes?: string }
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await requireActiveManager();
  if (!session) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  // Restricted to admin and super-admin (not content-editor)
  if (session.user.role === "content-editor") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { id } = await params;
  const body = await req.json() as {
    action: "approve" | "request_changes";
    adminNotes?: string;
  };

  const proposal = await serverClient.fetch(
    `*[_type == "setlistProposal" && _id == $id][0] {
      _id, service_type, service_date, status,
      "service_ref_id": service_ref._ref,
      songs[] {
        _key, play_key, medley_tag, "song_id": song._ref
      }
    }`,
    { id }
  );

  if (!proposal) {
    return NextResponse.json({ error: "Proposal not found" }, { status: 404 });
  }

  const now = new Date().toISOString();

  if (body.action === "request_changes") {
    await writeClient.patch(id).set({
      status: "changes_requested",
      admin_notes: body.adminNotes ?? "",
      reviewed_at: now,
    }).commit();
    try {
      const leadId = await serverClient.fetch<string | null>(`*[_id == $id][0].lead._ref`, { id });
      if (leadId) {
        void sendPush([leadId], "proposals", {
          title: "Cambios solicitados",
          body: "Revisaron tu propuesta y pidieron cambios.",
          path: "/me",
        });
      }
    } catch (err) {
      console.error("[push] notify failed:", err);
    }
    return NextResponse.json({ ok: true, status: "changes_requested" });
  }

  if (body.action === "approve") {
    // Write the setlist to the appropriate Sanity document
    const songDocs = (proposal.songs ?? []).map((s: { _key: string; play_key: string; medley_tag?: string; song_id: string }) => ({
      _type: "setlist_song" as const,
      _key: rkey(),
      play_key: s.play_key,
      ...(s.medley_tag ? { medley_tag: s.medley_tag } : {}),
      song: { _type: "reference" as const, _ref: s.song_id },
    }));

    const type: string = proposal.service_type;
    const date: string = proposal.service_date;
    const refId: string = proposal.service_ref_id;

    if (type === "sunday" && date) {
      const existing = await serverClient.fetch(
        `*[_type == "featuredSongs" && week == $week][0]._id`,
        { week: date }
      );
      if (existing) {
        await writeClient.patch(existing).set({ songs: songDocs }).commit();
      } else {
        await writeClient.create({ _type: "featuredSongs", week: date, songs: songDocs });
      }
    } else if (type === "saturday" && date) {
      const existing = await serverClient.fetch(
        `*[_type == "saturdarSongs" && week == $week][0]._id`,
        { week: date }
      );
      if (existing) {
        await writeClient.patch(existing).set({ songs: songDocs }).commit();
      } else {
        await writeClient.create({ _type: "saturdarSongs", week: date, songs: songDocs });
      }
    } else if (type === "special" && refId) {
      await writeClient.patch(refId).set({ songs: songDocs }).commit();
    } else {
      return NextResponse.json({ error: "Cannot determine service target" }, { status: 400 });
    }

    // Mark proposal approved
    await writeClient.patch(id).set({
      status: "approved",
      reviewed_at: now,
    }).commit();

    // Supersede other outstanding proposals for the SAME service: the setlist is
    // now decided, so any competing draft/pending/changes_requested proposals for
    // this date+type (or special ref) would linger as stale duplicates.
    try {
      let staleIds: string[] = [];
      if (type === "special" && refId) {
        staleIds = await serverClient.fetch<string[]>(
          `*[_type == "setlistProposal" && _id != $id && status != "approved" && service_ref._ref == $refId]._id`,
          { id, refId }
        );
      } else if ((type === "sunday" || type === "saturday") && date) {
        staleIds = await serverClient.fetch<string[]>(
          `*[_type == "setlistProposal" && _id != $id && status != "approved" && service_type == $type && service_date == $date]._id`,
          { id, type, date }
        );
      }
      for (const staleId of staleIds) {
        await writeClient.delete(staleId);
      }
    } catch (err) {
      console.error("[proposals] superseded-proposal cleanup failed:", err);
    }

    try {
      const leadId = await serverClient.fetch<string | null>(`*[_id == $id][0].lead._ref`, { id });
      if (leadId) {
        void sendPush([leadId], "proposals", {
          title: "Propuesta aprobada",
          body: "Tu propuesta fue aprobada.",
          path: "/me",
        });
      }
    } catch (err) {
      console.error("[push] notify failed:", err);
    }

    // The approved proposal just wrote the real setlist — refresh the cached
    // home/schedule/song pages so it shows without waiting for ISR expiry.
    revalidateServiceViews();

    return NextResponse.json({ ok: true, status: "approved" });
  }

  return NextResponse.json({ error: "Unknown action" }, { status: 400 });
}
