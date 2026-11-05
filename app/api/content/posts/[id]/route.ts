import { NextRequest, NextResponse } from "next/server";
import { requireActiveManager } from "@/app/utils/authGuards";
import { writeClient } from "@/sanity/lib/serverClient";
import { revalidateSongViews } from "@/app/utils/revalidate";
import { patchSong, SONG_ERROR } from "@/app/utils/songSaveCommit";
import { withVerificationRunContext } from "@/app/utils/srVerificationRunContext";
import { storedRevisionOfType } from "@/app/utils/typePin";
import { sanityConflictKind } from "@/app/utils/roleWriteRequest";

// Wrapped because the module it calls is a `*Commit` (`srVerificationRunContext.test.ts` scans by
// import); a song write sends nothing, and an unmarked request behaves as before.
export const PATCH = withVerificationRunContext(patchHandler);
export const DELETE = withVerificationRunContext(deleteHandler);

/**
 * Edit a song. Everything after authorization is `patchSong` (`app/utils/songSaveCommit.ts`), which
 * the MCP `save_song_edits` calls too.
 */
async function patchHandler(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  if (!await requireActiveManager()) {
    return NextResponse.json({ error: SONG_ERROR.forbidden }, { status: 403 });
  }
  const { id } = await params;
  const outcome = await patchSong(id, await req.json());
  return NextResponse.json(outcome.body, { status: outcome.status });
}

async function deleteHandler(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await requireActiveManager();
  if (!session) {
    return NextResponse.json({ error: SONG_ERROR.forbidden }, { status: 403 });
  }
  // DELETE requires admin or super-admin (not content-editor)
  if (session.user.role === "content-editor") {
    return NextResponse.json({ error: SONG_ERROR.forbidden }, { status: 403 });
  }

  // W9: this route deletes SONGS only. Any other id — a member, a service, a private Jóvenes event
  // — answers 404 without saying whether it exists, and the delete is pinned to the revision read,
  // so the document judged to be a song is the one deleted.
  const { id } = await params;
  const rev = await storedRevisionOfType(id, "post");
  if (!rev) {
    return NextResponse.json({ error: "Canción no encontrada." }, { status: 404 });
  }
  try {
    await writeClient
      .transaction()
      .patch(id, (p) => p.ifRevisionId(rev).set({}))
      .delete(id)
      .commit();
  } catch (err) {
    if (sanityConflictKind(err) === "revision_mismatch") {
      return NextResponse.json({ error: "Alguien más cambió esta canción; recarga." }, { status: 409 });
    }
    throw err;
  }
  revalidateSongViews();
  return NextResponse.json({ ok: true });
}
