import { NextRequest, NextResponse } from "next/server";
import { requireMinistryMember } from "@/app/utils/authGuards";
import { serverClient } from "@/sanity/lib/serverClient";

// Session-gated redirect to a rehearsal mix (spec 2026-09-20-rehearsal-mixes
// §8.1, decision D2). Bytes never pass through Vercel: this answers 302 to
// cdn.sanity.io, and that is the whole of the protection — it hides the URL
// from anyone without a worship session and lets access be withdrawn when a
// member leaves; past the redirect the member holds the raw URL. Same guard as
// /api/song/[id]: the catalog is a worship surface.

const CDN_HOST = "cdn.sanity.io";

export async function GET(req: NextRequest, { params }: { params: Promise<{ songId: string; key: string }> }) {
  const worship = await requireMinistryMember("worship");
  if (!worship) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const { songId, key } = await params;
  const mix = await serverClient.fetch<{ url?: string; filename?: string } | null>(
    `*[_type == "post" && _id == $id][0].rehearsalMixes[_key == $key][0]{
      "url": audioFile.asset->url,
      "filename": audioFile.asset->originalFilename
    }`,
    { id: songId, key },
  );
  if (!mix?.url) return NextResponse.json({ error: "Not found" }, { status: 404 });

  let target: URL;
  try { target = new URL(mix.url); } catch { return NextResponse.json({ error: "Not found" }, { status: 404 }); }
  if (target.hostname !== CDN_HOST) return NextResponse.json({ error: "Not found" }, { status: 404 });

  let location = target.toString();
  if (req.nextUrl.searchParams.get("download") === "1") {
    // Sanity's documented download hook: `?dl=<name>` sets content-disposition.
    // Encode with encodeURIComponent (%20 for spaces), not URLSearchParams
    // (which would emit `+`) — Sanity's CDN expects the former.
    const dl = encodeURIComponent(mix.filename || `${key}.mp3`);
    location += (target.search ? "&" : "?") + `dl=${dl}`;
  }
  const res = NextResponse.redirect(location, 302);
  res.headers.set("Cache-Control", "private, no-store");
  return res;
}
