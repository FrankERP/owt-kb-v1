import { NextRequest, NextResponse } from "next/server";
import { requireActiveManager } from "@/app/utils/authGuards";
import { writeClient } from "@/sanity/lib/serverClient";
import { revalidateSongViews } from "@/app/utils/revalidate";
import { patchSong, SONG_ERROR } from "@/app/utils/songSaveCommit";
import { withVerificationRunContext } from "@/app/utils/srVerificationRunContext";

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

  const { id } = await params;
  await writeClient.delete(id);
  revalidateSongViews();
  return NextResponse.json({ ok: true });
}
