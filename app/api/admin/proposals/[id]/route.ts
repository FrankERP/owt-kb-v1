import { NextRequest, NextResponse } from "next/server";
import { requireActiveManager } from "@/app/utils/authGuards";
import { serverClient, writeClient } from "@/sanity/lib/serverClient";
import { sendPush } from "@/app/utils/push";
import { revalidateServiceViews } from "@/app/utils/revalidate";

function rkey() {
  return Math.random().toString(36).slice(2, 9);
}

// A Sanity ifRevisionId mismatch surfaces as a ClientError with statusCode 409.
function isConflict(e: unknown): boolean {
  const err = e as { statusCode?: number; response?: { statusCode?: number } };
  return err?.statusCode === 409 || err?.response?.statusCode === 409;
}

// Everyone who should hear a review outcome on a shared proposal: the creator
// plus every contributor, deduped. (GROQ `in` already dedupes on send, but we
// dedupe here too so the set is clean.)
async function reviewRecipients(id: string): Promise<string[]> {
  const doc = await serverClient.fetch<{ lead?: string | null; contributors?: (string | null)[] }>(
    `*[_id == $id][0]{ "lead": lead._ref, "contributors": contributors[].person._ref }`,
    { id }
  );
  return [...new Set([doc?.lead, ...(doc?.contributors ?? [])].filter(Boolean))] as string[];
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
    action: "approve" | "request_changes" | "reopen";
    adminNotes?: string;
  };

  const proposal = await serverClient.fetch(
    `*[_type == "setlistProposal" && _id == $id][0] {
      _id, _rev, service_type, service_date, status, team_notes,
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
      const recipients = await reviewRecipients(id);
      if (recipients.length) {
        void sendPush(recipients, "proposals", {
          title: "Cambios solicitados",
          body: "Revisaron la propuesta y pidieron cambios.",
          path: "/me",
        });
      }
    } catch (err) {
      console.error("[push] notify failed:", err);
    }
    return NextResponse.json({ ok: true, status: "changes_requested" });
  }

  // Re-open an approved setlist for revision (admin-only). Sets the shared doc
  // back to changes_requested; the live setlist doc is left intact until the
  // revised proposal is re-approved. This is the ONLY way an approved proposal
  // becomes editable again (leads cannot self-serve un-approve).
  if (body.action === "reopen") {
    if (proposal.status !== "approved") {
      return NextResponse.json({ error: "Only an approved proposal can be re-opened" }, { status: 409 });
    }
    await writeClient.patch(id).set({
      status: "changes_requested",
      admin_notes: body.adminNotes ?? "",
      reviewed_at: now,
    }).commit();
    try {
      const recipients = await reviewRecipients(id);
      if (recipients.length) {
        void sendPush(recipients, "proposals", {
          title: "Propuesta reabierta",
          body: "Un admin reabrió el setlist para ajustes.",
          path: "/me",
        });
      }
    } catch (err) {
      console.error("[push] notify failed:", err);
    }
    return NextResponse.json({ ok: true, status: "changes_requested" });
  }

  if (body.action === "approve") {
    const type: string = proposal.service_type;
    const date: string = proposal.service_date;
    const refId: string = proposal.service_ref_id;

    // Validate the target BEFORE claiming, so we never mark a proposal approved
    // that we then can't publish.
    const targetOk =
      (type === "sunday" && date) || (type === "saturday" && date) || (type === "special" && refId);
    if (!targetOk) {
      return NextResponse.json({ error: "Cannot determine service target" }, { status: 400 });
    }

    // Claim the proposal FIRST, guarded by the revision we read. If a concurrent
    // lead edit landed since our read, the revision won't match → 409, and we
    // abort BEFORE writing the setlist from a now-stale songs snapshot (the lead
    // edit path allows edits until status === "approved"). This closes the
    // read-then-write lost-update window between the fetch above and this write.
    try {
      await writeClient.patch(id).ifRevisionId(proposal._rev).set({
        status: "approved",
        reviewed_at: now,
      }).commit();
    } catch (err) {
      if (isConflict(err)) {
        return NextResponse.json(
          { error: "La propuesta cambió mientras la revisabas. Recárgala y vuelve a revisar." },
          { status: 409 },
        );
      }
      throw err;
    }

    // proposal.songs is now guaranteed current: no edit landed between the fetch
    // and the revision-guarded claim above.
    const songDocs = (proposal.songs ?? []).map((s: { _key: string; play_key: string; medley_tag?: string; song_id: string }) => ({
      _type: "setlist_song" as const,
      _key: rkey(),
      play_key: s.play_key,
      ...(s.medley_tag ? { medley_tag: s.medley_tag } : {}),
      song: { _type: "reference" as const, _ref: s.song_id },
    }));

    if (type === "sunday" && date) {
      const existing = await serverClient.fetch(
        `*[_type == "featuredSongs" && week == $week][0]._id`,
        { week: date }
      );
      if (existing) {
        await writeClient.patch(existing).set({ songs: songDocs, team_notes: proposal.team_notes ?? "" }).commit();
      } else {
        await writeClient.create({ _type: "featuredSongs", week: date, songs: songDocs, team_notes: proposal.team_notes ?? "" });
      }
    } else if (type === "saturday" && date) {
      const existing = await serverClient.fetch(
        `*[_type == "saturdarSongs" && week == $week][0]._id`,
        { week: date }
      );
      if (existing) {
        await writeClient.patch(existing).set({ songs: songDocs, team_notes: proposal.team_notes ?? "" }).commit();
      } else {
        await writeClient.create({ _type: "saturdarSongs", week: date, songs: songDocs, team_notes: proposal.team_notes ?? "" });
      }
    } else if (type === "special" && refId) {
      await writeClient.patch(refId).set({ songs: songDocs, team_notes: proposal.team_notes ?? "" }).commit();
    }

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
      const recipients = await reviewRecipients(id);
      if (recipients.length) {
        void sendPush(recipients, "proposals", {
          title: "Propuesta aprobada",
          body: "La propuesta de setlist fue aprobada.",
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
