import { NextRequest, NextResponse } from "next/server";

import { requireActiveManager } from "@/app/utils/authGuards";
import { writeClient } from "@/sanity/lib/serverClient";
import { operationalClient } from "@/sanity/lib/operationalClient";
import { serviceError } from "@/app/utils/serviceMutation";
import { isCanonicalDocumentId, sanityConflictKind } from "@/app/utils/roleWriteRequest";
import { loadCanonicalRole, nowIso, type StoredLock } from "@/app/utils/roleWriteOps";
import { targetFromCanonicalRole } from "@/app/utils/proposalWriteRequest";
import {
  loadSpecialSetlistTarget,
  loadWeekendCoordination,
  loadWeekendSetlistTarget,
} from "@/app/utils/serviceWriteTargets";
import type { ServerTarget } from "@/app/utils/setlistWriteRequest";
import { compareObservedTarget } from "@/app/utils/setlistWriteRequest";
import { parseTeamNotesEdit } from "@/app/utils/serviceMessageEdit";
import { revalidateServiceViews } from "@/app/utils/revalidate";

function reject(res: { status: number; body: unknown }) {
  return NextResponse.json(res.body, { status: res.status });
}

// Declared BEFORE the handler: `protectedReadAudit` treats `export const PUT =` as
// the start of the PUT region.
export const PUT = putHandler;

/**
 * PUT /api/admin/service-threads/[roleId]/team-notes — edit the «Mensaje para el
 * equipo» of a service's LIVE setlist after it is published (ADR-0065, amended
 * 2026-10-24). Before this, the only writer was the proposal approval, which
 * copies the lead's note; a note in the wrong place could only be fixed in Studio.
 *
 * Body `{ teamNotes, observed: { id, rev } }` — `observed` is the setlist target
 * the dialog loaded (`GET …/messages`): the weekend `featuredSongs` /
 * `saturdarSongs` document, or a special's role (its setlist lives on the role).
 * It resolves that target exactly as the setlist PUT does (`loadWeekendSetlistTarget`
 * / `loadSpecialSetlistTarget`: duplicates and raw drafts fail closed), compares
 * it with `compareObservedTarget` and writes ONE field under that `_rev`. A
 * weekend write heartbeats the owned target lock in the same transaction, like
 * every weekend setlist writer. An empty note unsets the field.
 *
 * Deliberately NOT the setlist PUT: that one replaces the whole song list and
 * notifies the team («Ya están las canciones», the debounced setlist email). A
 * note fix must do neither. Sends nothing; revalidates the pages that show it.
 *
 * No setlist yet ⇒ 409 `no_setlist`: the note travels with a setlist, and the
 * leads' proposal is where it starts.
 *
 * A later approval of the leads' proposal still overwrites the note with the
 * proposal's own (that is what approving means) — the dialog says so.
 */
async function putHandler(req: NextRequest, { params }: { params: Promise<{ roleId: string }> }) {
  const session = await requireActiveManager();
  if (!session) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  if (session.user.role === "content-editor") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { roleId } = await params;
  if (!isCanonicalDocumentId(roleId)) {
    return reject(serviceError("invalid_request", { details: { issues: ["roleId"] } }));
  }

  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    return reject(serviceError("invalid_request", { details: { issues: ["json"] } }));
  }
  const parsed = parseTeamNotesEdit(raw);
  if (!parsed.ok) {
    return reject(serviceError("invalid_request", { details: { issues: parsed.issues } }));
  }
  const { teamNotes, observed } = parsed.value;

  const lookup = await loadCanonicalRole(roleId);
  if (lookup.state === "none" || !lookup.role) {
    return reject(serviceError("not_found", { details: { roleId } }));
  }
  if (lookup.state !== "single") {
    return reject(serviceError("ambiguous_target", { details: { roleId, state: lookup.state } }));
  }
  const target = targetFromCanonicalRole(lookup.role);
  if (!target) {
    return reject(serviceError("integrity_conflict", { details: { roleId, detail: "role_target" } }));
  }

  let server: ServerTarget;
  let lock: StoredLock | null = null;
  if (target.serviceType === "special") {
    const loaded = await loadSpecialSetlistTarget(roleId, target.serviceDate);
    if (!loaded.ok) return reject(serviceError(loaded.failure.code, { details: loaded.failure.details }));
    server = loaded.target.server;
  } else {
    const setlistType = target.serviceType === "sunday" ? "featuredSongs" : "saturdarSongs";
    const roleType = target.serviceType === "sunday" ? "sunday_role" : "saturday_role";
    const [loaded, coordination] = await Promise.all([
      loadWeekendSetlistTarget(setlistType, target.serviceDate),
      loadWeekendCoordination({ roleType, week: target.serviceDate }),
    ]);
    if (!loaded.ok) return reject(serviceError(loaded.failure.code, { details: loaded.failure.details }));
    if (!coordination.ok) {
      return reject(serviceError(coordination.failure.code, { details: coordination.failure.details }));
    }
    server = loaded.target.server;
    lock = coordination.coordination.lock;
  }

  if (server.state === "none") {
    return reject(serviceError("stale_revision", { details: { roleId, detail: "no_setlist" } }));
  }
  const mismatch = compareObservedTarget({ state: "single", ...observed }, server);
  if (mismatch) {
    return reject(serviceError("stale_revision", { details: { roleId, detail: mismatch } }));
  }

  // Unchanged: write nothing and hand back the observed target as it is. A
  // patch that changes nothing need not move `_rev`, and answering with the
  // transaction id then would leave the dialog asserting a revision that does
  // not exist — a 409 on its next save.
  //
  // Read HERE, pinned to the revision just compared: the loaders' shared
  // projections (`SETLIST_PROJECTION`, `ROLE_PROJECTION`) do not carry
  // `team_notes`, and reading it from them made every note look empty, so
  // clearing one was taken for "unchanged" and never written (dev, 2026-10-24).
  // No row = the document moved since: fall through, and the write's
  // `ifRevisionId` answers 409.
  const atRev = await operationalClient.fetch<{ notes?: string | null } | null>(
    `*[_id == $id && _rev == $rev][0]{ "notes": team_notes }`,
    { id: server.id, rev: server.rev },
  );
  if (atRev && (atRev.notes ?? "") === teamNotes) {
    return NextResponse.json({ ok: true, teamNotes: teamNotes || null, observed: { id: server.id, rev: server.rev } });
  }

  const rev = server.rev;
  let tx = writeClient
    .transaction()
    .patch(server.id, (p) => (teamNotes ? p.ifRevisionId(rev).set({ team_notes: teamNotes }) : p.ifRevisionId(rev).unset(["team_notes"])));
  if (lock) {
    const lockRev = lock._rev;
    tx = tx.patch(lock._id, (p) => p.ifRevisionId(lockRev).set({ updatedAt: nowIso() }));
  }
  let transactionId: string;
  try {
    ({ transactionId } = await tx.commit());
  } catch (err) {
    if (!sanityConflictKind(err)) throw err;
    return reject(serviceError("stale_revision", { details: { roleId, detail: "revision_moved" } }));
  }

  revalidateServiceViews();
  // A mutated document's new `_rev` IS the transaction id, so the dialog can save
  // again without reloading.
  return NextResponse.json({
    ok: true,
    teamNotes: teamNotes || null,
    observed: { id: server.id, rev: transactionId },
  });
}
