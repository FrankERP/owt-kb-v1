// The live-setlist writer (Service Readiness A2 §5) — the domain body of
// `PUT /api/admin/setlists`, moved here VERBATIM so the MCP `edit_setlist` tool
// calls the very same code path. The admin route keeps only its authorization
// prefix and JSON parse; it cannot export this function itself, because Next
// type-checks a route module's export set against a fixed list.
//
// Body: `{ week, type, roleId?, observed, songs: [{ songId, play_key?, medley_tag?, leadIds? }] }`
// where `observed` is A1's UNCHANGED observed state from the setlist GET.
//
// - An observed singleton requires the SAME target id and `_rev`.
// - An observed `none` permits only deterministic creation at
//   `featuredSongs.<week>` / `saturdarSongs.<week>` — the deterministic id is the
//   mutex, so a concurrent creation loses with `409` instead of duplicating the
//   target.
// - A duplicate group, a raw `drafts.*` overlay, an invalid target, a stale
//   identity/revision, or a concurrent creation all return `409` with NO write.
// - A weekend save asserts/heartbeats the owned weekend target lock in the SAME
//   transaction; a special save revision-guards the special role document.
//
// Boundary, and nothing else, differs from the route it came from: each
// refusal RETURNS `{ ok: false, status, body }` instead of sending it, success
// returns the same JSON as `body` plus `effects`, and the two post-commit
// helpers' return values (their descriptors) are captured at their existing
// call sites. A commit that fails for any reason other than a revision/creation
// conflict still THROWS, exactly as the route's 500 did.
//
// This module is a registered protected writer (`PROTECTED_RUNTIME_WRITERS`,
// `app/utils/setlistSaveCommit.ts#module`), its callers are pinned by
// `serviceCommitCallers.test.ts`, and it is a delivery-capable import for the
// SR-verification run-context scan. Adding a caller means touching that pin.

import "server-only";

import { writeClient } from "@/sanity/lib/serverClient";
import {
  notifySetlistSaved,
  queueSetlistNotice,
  revalidateSetlistSave,
  serviceParticipants,
  type SetlistNoticeDescriptor,
  type SetlistPushDescriptor,
} from "@/app/utils/serviceMutationSideEffects";
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
  type SetlistServiceKind,
} from "@/app/utils/setlistWriteRequest";
import { isWorshipNight } from "@/app/utils/serviceFormat";
import { leadSeatIds, validateSongLeads } from "@/app/utils/songLeads";
import type { CommitOutcome } from "@/app/utils/commitOutcome";

/**
 * The outbox `setlist` subject a save captured PRE-COMMIT: the service role that
 * owns the target, its publication flag, its participants and the songs stored
 * before this save. Null when no role owns the target.
 */
export interface SetlistSaveSubject {
  roleId: string;
  roleType: "sunday_role" | "saturday_role" | "special_role";
  published: unknown;
  beforeSongs: unknown;
  knownRecipients: string[];
}

/**
 * What a committed save already held, for a caller that must report it. Nothing
 * here is re-read after the commit.
 */
export interface SetlistSaveEffects {
  /** The service kind the request named. */
  kind: SetlistServiceKind;
  week: string;
  /**
   * The role that owns the target, as the server resolved it: the special role
   * itself, or the weekend's owning role. Null for a weekend with no role yet.
   */
  roleId: string | null;
  /** The written document: the created/patched weekend setlist, or the special role. */
  setlistId: string | null;
  created: boolean;
  /** The stored `setlist_song` items exactly as written, with their new `_key`s (leaders' too). */
  songs: Record<string, unknown>[];
  subject: SetlistSaveSubject | null;
  /**
   * `notifySetlistSaved`'s descriptor. Null when it was not called — a draft
   * service or a role-less week — or when it swallowed a failure.
   */
  push: SetlistPushDescriptor | null;
  /** `queueSetlistNotice`'s descriptor. Null for a role-less week, or when it skipped silently. */
  notice: SetlistNoticeDescriptor | null;
}

export async function saveSetlist(raw: unknown): Promise<CommitOutcome<SetlistSaveEffects>> {
  const parsed = parseSetlistWriteRequest(raw);
  if (!parsed.ok) {
    return { ok: false, ...serviceError("invalid_request", { details: { issues: parsed.issues } }) };
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
  /**
   * The outbox `setlist` subject: the SERVICE ROLE that owns this target, its
   * participants, and the songs stored BEFORE this save — all captured PRE-COMMIT
   * from documents this handler has already loaded (§2). Read back inside the
   * post-commit `after()` block they would be the POST-write state, so every
   * notice would compare the new setlist against itself and say nothing.
   * Null when no role owns the target: there are no participants to notify and no
   * id to key the subject on (§4).
   */
  let subject: { roleId: string; roleType: "sunday_role" | "saturday_role" | "special_role";
    published: unknown; beforeSongs: unknown; knownRecipients: string[] } | null = null;
  /** What this target allows for per-song leaders (spec §4.1). A weekend setlist allows none. */
  let leadTarget: { worshipNight: boolean; leadIds: ReadonlySet<string> } = {
    worshipNight: false,
    leadIds: new Set(),
  };

  if (request.setlistType) {
    const target = await loadWeekendSetlistTarget(request.setlistType, week);
    if (!target.ok) {
      return { ok: false, ...serviceError(target.failure.code, { details: target.failure.details }) };
    }
    server = target.target.server;
    if (server.state === "single") {
      targetId = server.id;
      targetRev = server.rev;
    }
    const roleType = request.setlistType === "featuredSongs" ? "sunday_role" : "saturday_role";
    const coordination = await loadWeekendCoordination({ roleType, week });
    if (!coordination.ok) {
      return {
        ok: false,
        ...serviceError(coordination.failure.code, { details: coordination.failure.details }),
      };
    }
    lock = coordination.coordination.lock;
    bootstrapped = coordination.coordination.bootstrapped;
    const owner = coordination.coordination.role;
    if (owner) {
      subject = {
        roleId: owner._id,
        roleType,
        published: owner.published,
        // `target.record` is nullable — no setlist document yet is `[]`.
        beforeSongs: target.target.record?.songs ?? [],
        knownRecipients: serviceParticipants(owner),
      };
    }
  } else {
    const target = await loadSpecialSetlistTarget(request.roleId as string, week);
    if (!target.ok) {
      return { ok: false, ...serviceError(target.failure.code, { details: target.failure.details }) };
    }
    server = target.target.server;
    // The special role IS the setlist target, so its own revision serializes this
    // save whether or not it already stores a `songs` field.
    targetId = target.target.role._id;
    targetRev = target.target.role._rev;
    subject = {
      roleId: target.target.role._id,
      roleType: "special_role",
      published: target.target.role.published,
      beforeSongs: target.target.role.songs ?? [],
      knownRecipients: serviceParticipants(target.target.role),
    };
    // Checked against the role THIS request loaded; the patch below asserts
    // that same `_rev`, so a Lead change landing in between fails the write.
    leadTarget = {
      worshipNight: isWorshipNight(target.target.role),
      leadIds: leadSeatIds(target.target.role.Lead),
    };
  }

  // ── The observed state must still be exactly current ──────────────────────
  const mismatch = compareObservedTarget(observed, server);
  if (mismatch) {
    return {
      ok: false,
      ...serviceError("stale_revision", {
        details: { detail: mismatch, week, type: request.kind, observed, server },
      }),
    };
  }

  // After the observed-target check on purpose: when the editor's view is
  // stale (a Lead change moved the role _rev), the admin gets the 409 reload
  // path, not a 400 that a retry cannot clear.
  const leadCheck = validateSongLeads(request.songs, leadTarget);
  if (!leadCheck.ok) {
    return { ok: false, ...serviceError("invalid_request", { details: { issues: leadCheck.issues } }) };
  }

  // ── One guarded transaction ───────────────────────────────────────────────
  const now = nowIso();
  const songs = buildSetlistSongDocs(request.songs, nextKey);
  let tx = writeClient.transaction();
  let createdId: string | null = null;

  if (server.state === "none" && request.setlistType) {
    const doc = buildWeekendSetlistDocument({ setlistType: request.setlistType, week, songs });
    if (!doc) {
      return { ok: false, ...serviceError("invalid_request", { details: { issues: ["week"] } }) };
    }
    createdId = doc._id;
    // `create` (never `createIfNotExists`): a concurrent creation must be TOLD.
    tx = tx.create(doc);
  } else {
    if (!targetId || !targetRev) {
      return { ok: false, ...serviceError("integrity_conflict", { details: { detail: "target_identity" } }) };
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
    return {
      ok: false,
      ...serviceError(bootstrapped ? "bootstrap_completed_reload" : "stale_revision", {
        details: {
          week,
          type: request.kind,
          detail: kind === "already_exists" ? "concurrent_creation" : "revision_moved",
        },
      }),
    };
  }

  // ── Post-commit side effects (§7), all through the one shared module ───────
  // Invalidate the statically-cached pages so the edit appears immediately, then
  // notify the existing setlist audience. The audience derives from committed
  // canonical server state across all five seat paths — never a client list — and
  // a failed notification never fails the save.
  revalidateSetlistSave();
  // What the two helpers below report they queued; null when a helper is not called.
  let push: SetlistPushDescriptor | null = null;
  let notice: SetlistNoticeDescriptor | null = null;
  // Draft ⇒ silent, the same rule the debounced email below applies via
  // `subject.published` and the same one `queueRoleCreatedNotice` states: the
  // service is admin-only until it is published, and publishing is what notifies.
  // This push was the one path that skipped it, so saving songs onto a DRAFT
  // service pushed "Ya están las canciones de este servicio" to every member on
  // the default `all` preference — landing them on a page where the service does
  // not exist, because every member-facing read filters `published != false`.
  // `!== false` grandfathers a missing flag, exactly as the rest of the module does.
  // `subject &&`, not `subject?.` — a weekend setlist saved before its role exists
  // has NO owning role, and `publishedSetlist(role, songs)` then returns null, so
  // members see nothing at all. Notifying there is the same failure as notifying
  // for a draft, only stronger. The debounced email already declines it
  // (`setlistUpsert` returns null on a missing roleId) and docs/NOTIFICATIONS.md
  // states it as a rule: "A weekend setlist saved before its role exists never
  // notifies." The push was the half that did not honour it.
  if (subject && subject.published !== false) push = await notifySetlistSaved(week);
  // The DEBOUNCED email (§2): one `setlist` notice for this service, keyed on the
  // owning role so this writer and the approve path share one subject — two keys
  // would mean two outbox documents and two emails for one change.
  if (subject) {
    notice = queueSetlistNotice({
      roleId: subject.roleId,
      roleType: subject.roleType,
      serviceDate: week,
      published: subject.published,
      beforeSongs: subject.beforeSongs,
      hasSongs: songs.length > 0,
      knownRecipients: subject.knownRecipients,
    });
  }

  const effects: SetlistSaveEffects = {
    kind: request.kind,
    week,
    roleId: subject?.roleId ?? null,
    setlistId: createdId ?? targetId,
    created: !!createdId,
    songs,
    subject,
    push,
    notice,
  };
  return {
    ok: true,
    status: 200,
    body: { ok: true, setlistId: createdId ?? targetId, created: !!createdId },
    effects,
  };
}
