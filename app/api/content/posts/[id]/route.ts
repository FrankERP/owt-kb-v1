import { NextRequest, NextResponse } from "next/server";
import { requireActiveManager } from "@/app/utils/authGuards";
import { writeClient } from "@/sanity/lib/serverClient";
import { textToBody } from "@/app/utils/lyrics";
import { revalidateSongViews } from "@/app/utils/revalidate";
import { normalizeChordCharts } from "@/app/utils/chordChartWrite";
import { isSafeHttpUrl, normalizeLinkRows } from "@/app/utils/linkRowWrite";

function rng() { return Math.random().toString(36).slice(2, 9); }

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  if (!await requireActiveManager()) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { id } = await params;
  const body = await req.json() as {
    title?: string;
    author?: string;
    key?: string;
    bpm?: string;
    timeSig?: string;
    lyrics?: string;
    chords?: Array<{ _key?: string; key: string; content: string }>;
    referenceLinks?: Array<{ label: string; url: string }>;
    musicalReferenceUrl?: string;
    lyricsVideoUrl?: string;
    tutorials?: Array<{ title: string; url: string }>;
    tagIds?: string[];
    authorIds?: string[];
  };

  // Both lists drop their blank «Agregar» row rather than 400ing the whole
  // PATCH over it — see `linkRowWrite.ts`. A row with a label but no URL still
  // fails, and the error names it.
  const links = normalizeLinkRows(body.referenceLinks, {
    type: "referenceLink", labelField: "label", humanName: "Links de referencia", mintKey: rng,
  });
  if (!links.ok) {
    return NextResponse.json({ error: links.error }, { status: 400 });
  }
  const tutorials = normalizeLinkRows(body.tutorials, {
    type: "tutorial", labelField: "title", humanName: "Tutoriales", mintKey: rng,
  });
  if (!tutorials.ok) {
    return NextResponse.json({ error: tutorials.error }, { status: 400 });
  }
  for (const u of [body.musicalReferenceUrl, body.lyricsVideoUrl]) {
    if (u != null && u !== "" && !isSafeHttpUrl(u)) {
      return NextResponse.json({ error: "reference URLs must use http(s)" }, { status: 400 });
    }
  }

  // Ownership/type guard: this is the song-content editor endpoint, so the
  // target MUST be a `post`. Without this, a manager (incl. content-editor)
  // could PATCH any doc by _id — overwriting a teamMembers / role /
  // setlistProposal doc's title/author/body/tags.
  const target = await writeClient.fetch<{ _type: string } | null>(
    `*[_id == $id][0]{ _type }`, { id }
  );
  if (!target) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  if (target._type !== "post") {
    return NextResponse.json({ error: "Not a song" }, { status: 400 });
  }

  const patch: Record<string, unknown> = {};
  if (body.title?.trim())  patch.title  = body.title.trim();
  if (body.authorIds != null) {
    const names: Array<{ _id: string; name: string }> = await writeClient.fetch(
      `*[_type=="author" && _id in $ids]{ _id, name }`, { ids: body.authorIds }
    );
    const byId = new Map(names.map((n) => [n._id, n.name]));
    patch.author = body.authorIds.map((id) => byId.get(id)).filter(Boolean).join(", ");
    patch.authors = body.authorIds.filter((id) => byId.has(id)).map((id) => ({ _type: "reference", _ref: id, _key: rng() }));
  } else if (body.author != null) {
    patch.author = body.author.trim();
  }
  if (body.key    != null) patch.key    = body.key.trim();
  if (body.bpm    != null) patch.bpm    = body.bpm ? Number(body.bpm) : null;
  if (body.timeSig != null) patch.timeSig = body.timeSig.trim();
  if (body.lyrics  != null) patch.body  = textToBody(body.lyrics);
  if (body.chords  != null) {
    const normalized = normalizeChordCharts(body.chords, rng);
    if (!normalized.ok) {
      return NextResponse.json({ error: normalized.error }, { status: 400 });
    }
    patch.chords = normalized.charts;
  }
  if (body.referenceLinks != null) patch.referenceLinks = links.rows;
  if (body.musicalReferenceUrl != null) patch.musicalReferenceUrl = body.musicalReferenceUrl || undefined;
  if (body.lyricsVideoUrl != null)      patch.lyricsVideoUrl = body.lyricsVideoUrl || undefined;
  if (body.tutorials != null) patch.tutorials2 = tutorials.rows;
  if (body.tagIds != null) {
    patch.tags = body.tagIds.map((id) => ({
      _type: "reference", _ref: id, _key: rng(),
    }));
  }

  const doc = await writeClient.patch(id).set(patch).commit();
  revalidateSongViews();
  return NextResponse.json(doc);
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await requireActiveManager();
  if (!session) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  // DELETE requires admin or super-admin (not content-editor)
  if (session.user.role === "content-editor") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { id } = await params;
  await writeClient.delete(id);
  revalidateSongViews();
  return NextResponse.json({ ok: true });
}
