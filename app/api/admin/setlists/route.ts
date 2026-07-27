import { NextRequest, NextResponse } from "next/server";
import { requireActiveManager } from "@/app/utils/authGuards";
import { writeClient } from "@/sanity/lib/serverClient";
import { operationalClient, rawIntegrityClient } from "@/sanity/lib/operationalClient";
import {
  notifySetlistSaved,
  revalidateSetlistSave,
} from "@/app/utils/serviceMutationSideEffects";
import { isValidServiceDate } from "@/app/utils/serviceReadModel";
import { pickUnique } from "@/app/utils/serviceReadSelect";
import { serviceError } from "@/app/utils/serviceMutation";
import { sanityConflictKind } from "@/app/utils/roleWriteRequest";
import { nextKey, nowIso, type StoredLock } from "@/app/utils/roleWriteOps";
import {
  loadSpecialSetlistTarget,
  loadWeekendCoordination,
  loadWeekendSetlistTarget,
} from "@/app/utils/serviceWriteTargets";
import {
  buildSetlistSongDocs,
  buildWeekendSetlistDocument,
  compareObservedTarget,
  parseSetlistWriteRequest,
  type ServerTarget,
} from "@/app/utils/setlistWriteRequest";
import {
  editorRecentSetlistsQuery,
  editorSpecialRoleQuery,
  editorWeekendSetlistQuery,
  rawRoleDraftForBaseQuery,
  rawSetlistDraftsForWeekQuery,
} from "@/app/utils/serviceReadQueries";
import { buildSetlistRead, type CanonicalSetlistRecord } from "@/app/utils/setlistReadContract";
import { withVerificationRunContext } from "@/app/utils/srVerificationRunContext";

function reject(res: { status: number; body: unknown }) {
  return NextResponse.json(res.body, { status: res.status });
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

/**
 * Manual live-setlist save (A2 §5).
 *
 * Body: `{ week, type, roleId?, observed, songs: [{ songId, play_key?, medley_tag? }] }`
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
  const parsed = parseSetlistWriteRequest(raw);
  if (!parsed.ok) {
    return reject(serviceError("invalid_request", { details: { issues: parsed.issues } }));
  }
  const request = parsed.value;
  const { week, observed } = request;

  // ── Resolve the canonical target and its coordination token ───────────────
  let server: ServerTarget;
  /** The revision this transaction must assert on the target document. */
  let targetRev: string | null = null;
  let targetId: string | null = null;
  let lock: StoredLock | null = null;
  let bootstrapped = false;

  if (request.setlistType) {
    const target = await loadWeekendSetlistTarget(request.setlistType, week);
    if (!target.ok) {
      return reject(serviceError(target.failure.code, { details: target.failure.details }));
    }
    server = target.target.server;
    if (server.state === "single") {
      targetId = server.id;
      targetRev = server.rev;
    }
    const coordination = await loadWeekendCoordination({
      roleType: request.setlistType === "featuredSongs" ? "sunday_role" : "saturday_role",
      week,
    });
    if (!coordination.ok) {
      return reject(
        serviceError(coordination.failure.code, { details: coordination.failure.details }),
      );
    }
    lock = coordination.coordination.lock;
    bootstrapped = coordination.coordination.bootstrapped;
  } else {
    const target = await loadSpecialSetlistTarget(request.roleId as string, week);
    if (!target.ok) {
      return reject(serviceError(target.failure.code, { details: target.failure.details }));
    }
    server = target.target.server;
    // The special role IS the setlist target, so its own revision serializes this
    // save whether or not it already stores a `songs` field.
    targetId = target.target.role._id;
    targetRev = target.target.role._rev;
  }

  // ── The observed state must still be exactly current ──────────────────────
  const mismatch = compareObservedTarget(observed, server);
  if (mismatch) {
    return reject(
      serviceError("stale_revision", {
        details: { detail: mismatch, week, type: request.kind, observed, server },
      }),
    );
  }

  // ── One guarded transaction ───────────────────────────────────────────────
  const now = nowIso();
  const songs = buildSetlistSongDocs(request.songs, nextKey);
  let tx = writeClient.transaction();
  let createdId: string | null = null;

  if (server.state === "none" && request.setlistType) {
    const doc = buildWeekendSetlistDocument({ setlistType: request.setlistType, week, songs });
    if (!doc) {
      return reject(serviceError("invalid_request", { details: { issues: ["week"] } }));
    }
    createdId = doc._id;
    // `create` (never `createIfNotExists`): a concurrent creation must be TOLD.
    tx = tx.create(doc);
  } else {
    if (!targetId || !targetRev) {
      return reject(serviceError("integrity_conflict", { details: { detail: "target_identity" } }));
    }
    const rev = targetRev;
    // `_type` is never sent: it is immutable per document id.
    tx = tx.patch(targetId, (p) => p.ifRevisionId(rev).set({ songs }));
  }
  if (lock) {
    const lockRev = lock._rev;
    tx = tx.patch(lock._id, (p) => p.ifRevisionId(lockRev).set({ updatedAt: now }));
  }

  try {
    await tx.commit();
  } catch (err) {
    const kind = sanityConflictKind(err);
    if (!kind) throw err;
    return reject(
      serviceError(bootstrapped ? "bootstrap_completed_reload" : "stale_revision", {
        details: {
          week,
          type: request.kind,
          detail: kind === "already_exists" ? "concurrent_creation" : "revision_moved",
        },
      }),
    );
  }

  // ── Post-commit side effects (§7), all through the one shared module ───────
  // Invalidate the statically-cached pages so the edit appears immediately, then
  // notify the existing setlist audience. The audience derives from committed
  // canonical server state across all five seat paths — never a client list — and
  // a failed notification never fails the save.
  revalidateSetlistSave();
  await notifySetlistSaved(week);

  return NextResponse.json({ ok: true, setlistId: createdId ?? targetId, created: !!createdId });
}
