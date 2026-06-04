import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/auth";
import { serverClient, writeClient } from "@/sanity/lib/serverClient";

async function requireManager() {
  const session = await getServerSession(authOptions);
  const role = session?.user.role;
  if (role !== "super-admin" && role !== "admin") return null;
  return session;
}

function key() {
  return Math.random().toString(36).slice(2, 9);
}

function nWeeksAgo(n: number): string {
  const d = new Date();
  d.setDate(d.getDate() - n * 7);
  return d.toLocaleDateString("sv", { timeZone: "America/Mexico_City" });
}

const SONG_PROJECTION = `{
  _id, title, author, key, "slug": slug.current
}`;

const SETLIST_SONGS_PROJECTION = `songs[] {
  play_key,
  "song": song-> ${SONG_PROJECTION}
}`;

// ── GET /api/admin/setlists?week=YYYY-MM-DD&type=sunday|saturday|special&roleId=ID
export async function GET(req: NextRequest) {
  if (!await requireManager()) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { searchParams } = req.nextUrl;
  const week   = searchParams.get("week");
  const type   = searchParams.get("type") as "sunday" | "saturday" | "special" | null;
  const roleId = searchParams.get("roleId");

  if (!type) {
    return NextResponse.json({ error: "type is required" }, { status: 400 });
  }

  // Build recentSongs map (past 8 weeks, both sunday and saturday setlists)
  const cutoff = nWeeksAgo(8);
  const recentRaw = await serverClient.fetch(
    `{
      "sunday":   *[_type == "featuredSongs"  && week >= $cutoff] { week, ${SETLIST_SONGS_PROJECTION} },
      "saturday": *[_type == "saturdarSongs"  && week >= $cutoff] { week, ${SETLIST_SONGS_PROJECTION} },
      "special":  *[_type == "special_role"   && date >= $cutoff && defined(songs)] { "week": date, ${SETLIST_SONGS_PROJECTION} }
    }`,
    { cutoff }
  );

  // Build map songId → most recent ISO date used (excluding the current week to avoid self-warning)
  const recentSongs: Record<string, string> = {};
  const excludeWeek = week ?? "";
  for (const list of [...recentRaw.sunday, ...recentRaw.saturday, ...recentRaw.special]) {
    if (list.week === excludeWeek) continue;
    for (const entry of (list.songs ?? [])) {
      if (!entry?.song?._id) continue;
      const prev = recentSongs[entry.song._id];
      if (!prev || list.week > prev) recentSongs[entry.song._id] = list.week;
    }
  }

  // Fetch the actual setlist for this service
  let setlistId: string | null = null;
  let songs: unknown[] = [];

  if (type === "sunday" && week) {
    const doc = await serverClient.fetch(
      `*[_type == "featuredSongs" && week == $week][0] { _id, ${SETLIST_SONGS_PROJECTION} }`,
      { week }
    );
    setlistId = doc?._id ?? null;
    songs     = doc?.songs ?? [];
  } else if (type === "saturday" && week) {
    const doc = await serverClient.fetch(
      `*[_type == "saturdarSongs" && week == $week][0] { _id, ${SETLIST_SONGS_PROJECTION} }`,
      { week }
    );
    setlistId = doc?._id ?? null;
    songs     = doc?.songs ?? [];
  } else if (type === "special" && roleId) {
    const doc = await serverClient.fetch(
      `*[_type == "special_role" && _id == $id][0] { _id, ${SETLIST_SONGS_PROJECTION} }`,
      { id: roleId }
    );
    setlistId = doc?._id ?? null;
    songs     = doc?.songs ?? [];
  }

  return NextResponse.json({ setlistId, songs, recentSongs });
}

// ── PUT /api/admin/setlists
// Body: { week, type, roleId?, songs: [{ songId, play_key }] }
export async function PUT(req: NextRequest) {
  if (!await requireManager()) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const body = await req.json() as {
    week?: string;
    type: "sunday" | "saturday" | "special";
    roleId?: string;
    songs: { songId: string; play_key: string }[];
  };

  const songDocs = (body.songs ?? []).map(s => ({
    _type: "setlist_song" as const,
    _key: key(),
    play_key: s.play_key,
    song: { _type: "reference" as const, _ref: s.songId },
  }));

  if (body.type === "sunday" && body.week) {
    const existing = await serverClient.fetch(
      `*[_type == "featuredSongs" && week == $week][0]._id`,
      { week: body.week }
    );
    if (existing) {
      await writeClient.patch(existing).set({ songs: songDocs }).commit();
    } else {
      await writeClient.create({ _type: "featuredSongs", week: body.week, songs: songDocs });
    }
  } else if (body.type === "saturday" && body.week) {
    const existing = await serverClient.fetch(
      `*[_type == "saturdarSongs" && week == $week][0]._id`,
      { week: body.week }
    );
    if (existing) {
      await writeClient.patch(existing).set({ songs: songDocs }).commit();
    } else {
      await writeClient.create({ _type: "saturdarSongs", week: body.week, songs: songDocs });
    }
  } else if (body.type === "special" && body.roleId) {
    const targetType = await serverClient.fetch(
      `*[_id == $id][0]._type`,
      { id: body.roleId }
    );
    if (targetType !== "special_role") {
      return NextResponse.json({ error: "roleId must reference a special_role document" }, { status: 400 });
    }
    await writeClient.patch(body.roleId).set({ songs: songDocs }).commit();
  } else {
    return NextResponse.json({ error: "week (for sunday/saturday) or roleId (for special) required" }, { status: 400 });
  }

  return NextResponse.json({ ok: true });
}
