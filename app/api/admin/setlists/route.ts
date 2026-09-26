import { NextRequest, NextResponse } from "next/server";

// The post-commit `after()` fan-out queues the debounced setlist notice and (from
// Task 11) hosts a sweep; give it room to finish past the response.
export const maxDuration = 60;

import { requireActiveManager } from "@/app/utils/authGuards";
import { operationalClient, rawIntegrityClient } from "@/sanity/lib/operationalClient";
import { isValidServiceDate } from "@/app/utils/serviceReadModel";
import { pickUnique } from "@/app/utils/serviceReadSelect";
import { serviceError } from "@/app/utils/serviceMutation";
import {
  editorRecentSetlistsQuery,
  editorSpecialRoleQuery,
  editorWeekendSetlistQuery,
  rawRoleDraftForBaseQuery,
  rawSetlistDraftsForWeekQuery,
} from "@/app/utils/serviceReadQueries";
import { buildSetlistRead, type CanonicalSetlistRecord } from "@/app/utils/setlistReadContract";
import { leadRosterOf } from "@/app/utils/songLeads";
import { withVerificationRunContext } from "@/app/utils/srVerificationRunContext";
import { recentSongUses, weeksAgoIso } from "@/app/utils/setlistRecentSongs";
import { saveSetlist } from "@/app/utils/setlistSaveCommit";

function reject(res: { status: number; body: unknown }) {
  return NextResponse.json(res.body, { status: res.status });
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
  format?: string;
  leadRoster?: unknown;
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
// A3 §3: outbound-delivery evidence emitted anywhere under this handler — including
// its post-commit `after()` fan-out — carries the in-flight verification run's markers.
// An unmarked ordinary request establishes nothing and behaves exactly as before.
export const GET = withVerificationRunContext(getHandler);

async function getHandler(req: NextRequest) {
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
    const recentQ = editorRecentSetlistsQuery(weeksAgoIso(8));
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
    const recentSongs = recentSongUses(recentRaw, serviceDate);

    const read = buildSetlistRead(records, draftIds, recentSongs);
    // A special also tells the editor whether it is a worship night and who is
    // in its Lead — the only people a song may name as leader (spec §6).
    return NextResponse.json(
      type === "special" && specialRole
        ? { ...read, format: specialRole.format ?? null, leadRoster: leadRosterOf(specialRole.leadRoster) }
        : read,
    );
  } catch (err) {
    console.error("[admin/setlists] canonical read failed:", err);
    return NextResponse.json({ error: "Setlist read failed" }, { status: 500 });
  }
}

/**
 * Manual live-setlist save (A2 §5).
 *
 * Body: `{ week, type, roleId?, observed, songs: [{ songId, play_key?, medley_tag?, leadIds? }] }`
 * where `observed` is A1's UNCHANGED observed state from the GET above.
 *
 * - An observed singleton requires the SAME target id and `_rev`.
 * - An observed `none` permits only deterministic creation at
 *   `featuredSongs.<week>` / `saturdarSongs.<week>` — the deterministic id is the
 *   mutex, so a concurrent creation loses with `409` instead of duplicating the
 *   target.
 * - A duplicate group, a raw `drafts.*` overlay, an invalid target, a stale
 *   identity/revision, or a concurrent creation all return `409` with NO write.
 * - A weekend save asserts/heartbeats the owned weekend target lock in the SAME
 *   transaction; a special save revision-guards the special role document.
 *
 * This handler authorizes and parses JSON only. Everything after that is
 * `saveSetlist` (`app/utils/setlistSaveCommit.ts`), the one setlist writer the MCP
 * `edit_setlist` tool calls too; its outcome's `body` and `status` are sent as-is.
 */
// A3 §3: outbound-delivery evidence emitted anywhere under this handler — including
// its post-commit `after()` fan-out — carries the in-flight verification run's markers.
// An unmarked ordinary request establishes nothing and behaves exactly as before.
export const PUT = withVerificationRunContext(putHandler);

async function putHandler(req: NextRequest) {
  const session = await requireActiveManager();
  if (!session) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  // Restricted to admin and super-admin (not content-editor)
  if (session.user.role === "content-editor") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    return reject(serviceError("invalid_request", { details: { issues: ["json"] } }));
  }
  const outcome = await saveSetlist(raw);
  return NextResponse.json(outcome.body, { status: outcome.status });
}
