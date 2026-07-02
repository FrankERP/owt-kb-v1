import { NextRequest, NextResponse } from "next/server";
import { requireActiveManager } from "@/app/utils/authGuards";
import { serverClient, writeClient } from "@/sanity/lib/serverClient";
import { revalidateServiceViews } from "@/app/utils/revalidate";
import { setlistRecipientIds, assignedMemberRefsQuery } from "@/app/utils/notifyTargets";
import { sendPush } from "@/app/utils/push";

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
  medley_tag,
  "song": song-> ${SONG_PROJECTION}
}`;

// ── GET /api/admin/setlists?week=YYYY-MM-DD&type=sunday|saturday|special&roleId=ID
export async function GET(req: NextRequest) {
  const session = await requireActiveManager();
  if (!session) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  // Restricted to admin and super-admin (not content-editor)
  if (session.user.role === "content-editor") {
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
// Body: { week, type, roleId?, songs: [{ songId, play_key, medley_tag? }] }
export async function PUT(req: NextRequest) {
  const session = await requireActiveManager();
  if (!session) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  // Restricted to admin and super-admin (not content-editor)
  if (session.user.role === "content-editor") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const body = await req.json() as {
    week?: string;
    type: "sunday" | "saturday" | "special";
    roleId?: string;
    songs: { songId: string; play_key: string; medley_tag?: string }[];
  };

  const songDocs = (body.songs ?? []).map(s => ({
    _type: "setlist_song" as const,
    _key: key(),
    play_key: s.play_key,
    ...(s.medley_tag ? { medley_tag: s.medley_tag } : {}),
    song: { _type: "reference" as const, _ref: s.songId },
  }));

  let publishedWeek: string | undefined;

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
    publishedWeek = body.week;
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
    publishedWeek = body.week;
  } else if (body.type === "special" && body.roleId) {
    const roleDoc = await serverClient.fetch<{ _type: string; date?: string }>(
      `*[_id == $id][0]{ _type, date }`,
      { id: body.roleId }
    );
    if (roleDoc?._type !== "special_role") {
      return NextResponse.json({ error: "roleId must reference a special_role document" }, { status: 400 });
    }
    await writeClient.patch(body.roleId).set({ songs: songDocs }).commit();
    publishedWeek = roleDoc?.date;
  } else {
    return NextResponse.json({ error: "week (for sunday/saturday) or roleId (for special) required" }, { status: 400 });
  }

  // Invalidate the statically-cached pages so the edit appears immediately.
  revalidateServiceViews();

  // Fire-and-forget: notify setlist subscribers. Never blocks the publish response.
  if (publishedWeek) {
    const week = publishedWeek;
    try {
      const members = await serverClient.fetch<{ _id: string; setlist?: "all" | "assigned" | "off" }[]>(
        `*[_type == "teamMembers"]{ _id, "setlist": notifPrefs.setlist }`
      );
      const roleFilter = `_type in ["sunday_role","saturday_role","special_role"] && (week == $week || date == $week)`;
      const assigned = await serverClient.fetch<string[]>(
        assignedMemberRefsQuery(roleFilter),
        { week }
      );
      void sendPush(setlistRecipientIds(members, assigned), "setlist", {
        title: "Setlist de la semana",
        body: "Ya están las canciones de este servicio.",
        path: "/",
      });
    } catch (err) {
      console.error("[push] notify failed:", err);
    }
  }

  return NextResponse.json({ ok: true });
}
