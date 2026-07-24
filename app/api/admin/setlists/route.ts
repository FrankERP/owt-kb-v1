import { NextRequest, NextResponse } from "next/server";
import { requireActiveManager } from "@/app/utils/authGuards";
import { serverClient, writeClient } from "@/sanity/lib/serverClient";
import { operationalClient, rawIntegrityClient } from "@/sanity/lib/operationalClient";
import { revalidateServiceViews } from "@/app/utils/revalidate";
import { setlistRecipientIds, assignedMemberRefsQuery } from "@/app/utils/notifyTargets";
import { sendPush } from "@/app/utils/push";
import { isValidServiceDate } from "@/app/utils/serviceReadModel";
import { pickUnique } from "@/app/utils/serviceReadSelect";
import {
  editorRecentSetlistsQuery,
  editorSpecialRoleQuery,
  editorWeekendSetlistQuery,
  rawRoleDraftForBaseQuery,
  rawSetlistDraftsForWeekQuery,
} from "@/app/utils/serviceReadQueries";
import { buildSetlistRead, type CanonicalSetlistRecord } from "@/app/utils/setlistReadContract";

function key() {
  return Math.random().toString(36).slice(2, 9);
}

function nWeeksAgo(n: number): string {
  const d = new Date();
  d.setDate(d.getDate() - n * 7);
  return d.toLocaleDateString("sv", { timeZone: "America/Mexico_City" });
}

const SERVICE_KINDS = ["sunday", "saturday", "special"] as const;
type ServiceKind = (typeof SERVICE_KINDS)[number];

interface EditorSetlistDoc {
  _id?: string;
  _rev?: string;
  _type?: string;
  date?: string;
  hasSongs?: boolean;
  songs?: unknown;
}

function draftIdsOf(rows: unknown): string[] {
  if (!Array.isArray(rows)) return [];
  const out: string[] = [];
  for (const row of rows) {
    const id = (row as { _id?: unknown } | null)?._id;
    if (typeof id === "string" && id) out.push(id);
  }
  return out;
}

/** Editor-projected songs; an absent stored field is an empty list, not malformed content. */
function songsOf(doc: EditorSetlistDoc): unknown {
  if (doc.hasSongs === false) return [];
  return doc.songs ?? [];
}

// ── GET /api/admin/setlists?week=YYYY-MM-DD&type=sunday|saturday|special&roleId=ID
// Additive canonical read contract (A1 §4): the pre-existing `setlistId`,
// `songs` and `recentSongs` fields are preserved on every success branch, plus
// an explicit `targetState`. Request identity is validated BEFORE any target is
// queried, so a malformed/mismatched request is a 400 and never `targetState:
// "none"`. Ambiguity (duplicate / draft overlay / malformed record) is an
// explicit non-editable state, never an arbitrary `[0]` pick.
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
  const week = searchParams.get("week");
  const rawType = searchParams.get("type");
  const roleId = searchParams.get("roleId");

  // ── 1. Request identity validation (before any target read) ───────────────
  if (!rawType || !(SERVICE_KINDS as readonly string[]).includes(rawType)) {
    return NextResponse.json(
      { error: "type must be one of sunday, saturday, special", code: "invalid_type" },
      { status: 400 },
    );
  }
  const type = rawType as ServiceKind;

  if (!isValidServiceDate(week)) {
    return NextResponse.json(
      { error: "week must be a valid YYYY-MM-DD service date", code: "invalid_service_date" },
      { status: 400 },
    );
  }
  const serviceDate: string = week;

  if (type === "special" && !roleId) {
    return NextResponse.json(
      { error: "roleId is required for a special service", code: "missing_role_id" },
      { status: 400 },
    );
  }

  try {
    // For a special service the role document IS the setlist target, so
    // resolving it both validates request identity and carries the content.
    let specialRole: EditorSetlistDoc | null = null;
    if (type === "special" && roleId) {
      const roleQ = editorSpecialRoleQuery(roleId);
      const rows = await operationalClient.fetch<EditorSetlistDoc[]>(roleQ.query, roleQ.params);
      specialRole = pickUnique(rows);
      if (!specialRole || specialRole._type !== "special_role") {
        return NextResponse.json(
          {
            error: "roleId must resolve to exactly one canonical special_role",
            code: "special_role_unresolved",
          },
          { status: 400 },
        );
      }
      if (!isValidServiceDate(specialRole.date) || specialRole.date !== serviceDate) {
        return NextResponse.json(
          {
            error: "roleId does not match the requested service date",
            code: "special_role_date_mismatch",
          },
          { status: 400 },
        );
      }
    }

    // ── 2. Repeat-song history (past 8 weeks, all three service kinds) ───────
    const recentQ = editorRecentSetlistsQuery(nWeeksAgo(8));
    const setlistType = type === "sunday" ? "featuredSongs" : "saturdarSongs";

    let recentRaw: Record<string, { week?: string; songs?: unknown }[]>;
    let records: CanonicalSetlistRecord[];
    let draftIds: string[];

    if (type === "special" && specialRole) {
      const draftQ = rawRoleDraftForBaseQuery(specialRole._id ?? "");
      const [recent, drafts] = await Promise.all([
        operationalClient.fetch<Record<string, { week?: string; songs?: unknown }[]>>(
          recentQ.query,
          recentQ.params,
        ),
        rawIntegrityClient.fetch<unknown[]>(draftQ.query, draftQ.params),
      ]);
      recentRaw = recent;
      draftIds = draftIdsOf(drafts);
      // A special role with no stored `songs` field is zero setlist targets.
      records =
        specialRole.hasSongs === false
          ? []
          : [{ id: specialRole._id ?? "", rev: specialRole._rev ?? "", songs: songsOf(specialRole) }];
    } else {
      const setlistQ = editorWeekendSetlistQuery(setlistType, serviceDate);
      const draftQ = rawSetlistDraftsForWeekQuery(setlistType, serviceDate);
      const [recent, canonical, drafts] = await Promise.all([
        operationalClient.fetch<Record<string, { week?: string; songs?: unknown }[]>>(
          recentQ.query,
          recentQ.params,
        ),
        operationalClient.fetch<EditorSetlistDoc[]>(setlistQ.query, setlistQ.params),
        rawIntegrityClient.fetch<unknown[]>(draftQ.query, draftQ.params),
      ]);
      recentRaw = recent;
      draftIds = draftIdsOf(drafts);
      records = (canonical ?? []).map((doc) => ({
        id: doc._id ?? "",
        rev: doc._rev ?? "",
        songs: songsOf(doc),
      }));
    }

    // Map songId → most recent past use, excluding this service's own date so a
    // setlist never warns about itself.
    const recentSongs: Record<string, string> = {};
    const lists = [
      ...(recentRaw?.sunday ?? []),
      ...(recentRaw?.saturday ?? []),
      ...(recentRaw?.special ?? []),
    ];
    for (const list of lists) {
      if (!list || list.week === serviceDate || typeof list.week !== "string") continue;
      const entries = Array.isArray(list.songs) ? list.songs : [];
      for (const entry of entries as { song?: { _id?: string } }[]) {
        const id = entry?.song?._id;
        if (!id) continue;
        const prev = recentSongs[id];
        if (!prev || list.week > prev) recentSongs[id] = list.week;
      }
    }

    return NextResponse.json(buildSetlistRead(records, draftIds, recentSongs));
  } catch (err) {
    console.error("[admin/setlists] canonical read failed:", err);
    return NextResponse.json({ error: "Setlist read failed" }, { status: 500 });
  }
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
