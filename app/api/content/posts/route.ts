import { NextRequest, NextResponse } from "next/server";
import { requireActiveManager } from "@/app/utils/authGuards";
import { serverClient } from "@/sanity/lib/serverClient";
import { createSong, SONG_ERROR } from "@/app/utils/songSaveCommit";
import { withVerificationRunContext } from "@/app/utils/srVerificationRunContext";

export async function GET() {
  if (!await requireActiveManager()) {
    return NextResponse.json({ error: SONG_ERROR.forbidden }, { status: 403 });
  }

  const posts = await serverClient.fetch(
    `*[_type == "post"] | order(title asc) {
      _id, title, author, slug, key, bpm, timeSig, publishDate,
      musicalReferenceUrl, lyricsVideoUrl,
      body,
      authors[]->{ _id, name },
      chords[]{ _key, key, content },
      referenceLinks[]{ label, url },
      tags[]->{ _id, name, slug }
    }`
  );

  return NextResponse.json(posts);
}

// Wrapped because the module it calls is a `*Commit` (`srVerificationRunContext.test.ts` scans by
// import); a song write sends nothing, and an unmarked request behaves as before.
export const POST = withVerificationRunContext(postHandler);

/**
 * Create a song. Everything after authorization is `createSong` (`app/utils/songSaveCommit.ts`),
 * which the MCP `create_song` calls too.
 */
async function postHandler(req: NextRequest) {
  if (!await requireActiveManager()) {
    return NextResponse.json({ error: SONG_ERROR.forbidden }, { status: 403 });
  }
  const outcome = await createSong(await req.json());
  return NextResponse.json(outcome.body, { status: outcome.status });
}
