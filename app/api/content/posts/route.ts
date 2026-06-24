import { NextRequest, NextResponse } from "next/server";
import { requireActiveManager } from "@/app/utils/authGuards";
import { serverClient, writeClient } from "@/sanity/lib/serverClient";
import { textToBody } from "@/app/utils/lyrics";

function rng() { return Math.random().toString(36).slice(2, 9); }

function isSafeHttpUrl(value: unknown): value is string {
  if (typeof value !== "string") return false;
  try {
    const u = new URL(value);
    return u.protocol === "http:" || u.protocol === "https:";
  } catch { return false; }
}

export async function GET() {
  if (!await requireActiveManager()) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const posts = await serverClient.fetch(
    `*[_type == "post"] | order(title asc) {
      _id, title, author, slug, key, bpm, timeSig, publishDate,
      musicalReferenceUrl, lyricsVideoUrl,
      body,
      chords[]{ key, content },
      referenceLinks[]{ label, url },
      tags[]->{ _id, name, slug }
    }`
  );

  return NextResponse.json(posts);
}

export async function POST(req: NextRequest) {
  if (!await requireActiveManager()) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const body = await req.json() as {
    title: string;
    author?: string;
    key?: string;
    bpm?: string;
    timeSig?: string;
    lyrics?: string;
    chords?: Array<{ key: string; content: string }>;
    referenceLinks?: Array<{ label: string; url: string }>;
    musicalReferenceUrl?: string;
    lyricsVideoUrl?: string;
    tagIds?: string[];
  };

  if (!body.title?.trim()) {
    return NextResponse.json({ error: "title required" }, { status: 400 });
  }

  if (body.referenceLinks?.some((l) => !isSafeHttpUrl(l.url))) {
    return NextResponse.json({ error: "referenceLinks must use http(s)" }, { status: 400 });
  }
  for (const u of [body.musicalReferenceUrl, body.lyricsVideoUrl]) {
    if (u != null && u !== "" && !isSafeHttpUrl(u)) {
      return NextResponse.json({ error: "reference URLs must use http(s)" }, { status: 400 });
    }
  }

  const slugBase = `${body.title}-${body.author ?? ""}`.toLowerCase()
    .replace(/\s+/g, "-").replace(/[^a-z0-9-]/g, "").slice(0, 96);

  const doc = await writeClient.create({
    _type: "post",
    title: body.title.trim(),
    author: body.author?.trim() ?? "",
    slug: { _type: "slug", current: slugBase },
    key: body.key?.trim() ?? "",
    bpm: body.bpm ? Number(body.bpm) : undefined,
    timeSig: body.timeSig?.trim() ?? "",
    body: body.lyrics ? textToBody(body.lyrics) : [],
    chords: (body.chords ?? []).map((c) => ({
      _type: "chord_chart", _key: rng(), key: c.key, content: c.content,
    })),
    referenceLinks: (body.referenceLinks ?? []).map((l) => ({
      _type: "referenceLink", _key: rng(), label: l.label, url: l.url,
    })),
    musicalReferenceUrl: body.musicalReferenceUrl?.trim() || undefined,
    lyricsVideoUrl: body.lyricsVideoUrl?.trim() || undefined,
    tags: (body.tagIds ?? []).map((id) => ({
      _type: "reference", _ref: id, _key: rng(),
    })),
    publishDate: new Date().toISOString(),
  });

  return NextResponse.json(doc, { status: 201 });
}
