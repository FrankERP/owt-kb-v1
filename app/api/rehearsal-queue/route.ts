import { NextRequest, NextResponse } from "next/server";
import { requireMinistryMember } from "@/app/utils/authGuards";
import { serverClient } from "@/sanity/lib/serverClient";
import type { QueueMix } from "@/app/utils/rehearsalQueue";

// The rehearsal mixes of a setlist's songs, for «Ensayar el setlist» (2026-10-22).
// Read on the press, not with the page: Inicio stays as light as it was, and only
// a member who actually rehearses pays for the read. Slim on purpose — no peaks,
// no `active` envelope (the waveform is the song page's), and never an asset URL:
// the client plays every mix through `/api/audio/[song]/[key]` (decision D2).
// Same guard as that route and `/api/song/[id]`: the catalog is a worship surface.

const MAX_IDS = 40;

export async function POST(req: NextRequest) {
  const worship = await requireMinistryMember("worship");
  if (!worship) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  let body: { ids?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Bad request" }, { status: 400 });
  }
  const ids = Array.isArray(body.ids)
    ? [...new Set(body.ids.filter((id): id is string => typeof id === "string" && id.length > 0 && id.length <= 200))]
    : [];
  if (ids.length === 0 || ids.length > MAX_IDS) return NextResponse.json({ error: "Bad request" }, { status: 400 });

  const rows = await serverClient.fetch<{ _id: string; mixes: QueueMix[] | null }[]>(
    `*[_type == "post" && _id in $ids]{ _id, "mixes": rehearsalMixes[]{ _key, kind, family, track, tone } }`,
    { ids },
  );
  const mixes: Record<string, QueueMix[]> = {};
  for (const row of rows) mixes[row._id] = row.mixes ?? [];
  return NextResponse.json({ mixes }, { headers: { "Cache-Control": "private, no-store" } });
}
