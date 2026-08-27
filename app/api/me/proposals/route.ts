import { NextRequest, NextResponse } from "next/server";

// The post-commit `after()` fan-out queues the debounced lead-notes notice and
// (from Task 11) hosts a sweep; give it room to finish past the response.
export const maxDuration = 60;

import { requireMinistryMember } from "@/app/utils/authGuards";
import { writeClient } from "@/sanity/lib/serverClient";
import { operationalClient } from "@/sanity/lib/operationalClient";
import {
  notifyProposalPending,
  queueLeadNotesNotice,
} from "@/app/utils/serviceMutationSideEffects";
import { mergeContributor, type StoredContributor } from "@/app/utils/proposalContributors";
import { serviceError } from "@/app/utils/serviceMutation";
import { canonicalLeadRefs, pickUnique } from "@/app/utils/serviceReadSelect";
import { canonicalProposalByIdQuery } from "@/app/utils/serviceReadQueries";
import { sanityConflictKind } from "@/app/utils/roleWriteRequest";
import { loadCanonicalRole, nextKey, nowIso } from "@/app/utils/roleWriteOps";
import { loadProposalGroup, loadWeekendCoordination } from "@/app/utils/serviceWriteTargets";
import { buildProposalSongDocs, compareObservedTarget } from "@/app/utils/setlistWriteRequest";
import {
  deterministicProposalId,
  parseProposalSaveRequest,
  targetFromCanonicalRole,
} from "@/app/utils/proposalWriteRequest";
import { buildProposalMessage, isLeadNote } from "@/app/utils/proposalMessageWrite";
import {
  THREAD_AFTER_APPEND_QUERY,
  THREAD_MESSAGES,
  type ThreadMessageRow,
} from "@/app/utils/proposalMessageRead";
import { withVerificationRunContext } from "@/app/utils/srVerificationRunContext";

function reject(res: { status: number; body: unknown }) {
  return NextResponse.json(res.body, { status: res.status });
}

/** Contributors as `mergeContributor` expects them (the projection flattens `person`). */
function storedContributors(value: unknown): StoredContributor[] {
  if (!Array.isArray(value)) return [];
  const out: StoredContributor[] = [];
  for (const raw of value) {
    if (!raw || typeof raw !== "object") continue;
    const row = raw as { _key?: unknown; person?: unknown };
    if (typeof row._key !== "string" || !row._key) continue;
    const ref = typeof row.person === "string" ? row.person : (row.person as { _ref?: string } | null)?._ref;
    out.push({ _key: row._key, ...(ref ? { person: { _ref: ref } } : {}) });
  }
  return out;
}

// GET /api/me/proposals — the shared proposal for every service the current user
// is a Lead on (not only ones they authored). Mirrors the /me superset.
export async function GET() {
  // Setlist proposals are a worship surface; membership, not just a session.
  const session = await requireMinistryMember("worship");
  if (!session) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  // GET reads through the canonical (published-perspective) client so a
  // `drafts.*` proposal/role overlay can never surface in a member's list.
  const proposals = await operationalClient.fetch(
    `*[_type == "setlistProposal" && $id in service_ref->Lead[]._ref] | order(service_date asc) {
      _id, _rev, service_type, service_date, status, lead_notes, team_notes, admin_notes, submitted_at, reviewed_at,
      ${THREAD_MESSAGES},
      "service_ref": service_ref._ref
    }`,
    { id: session.user.sanityId }
  );

  return NextResponse.json(proposals);
}

/**
 * Create / save / resubmit the ONE shared proposal for a service (A2 §6).
 *
 * Body: `{ roleId, observed, songs, leadNotes?, teamNotes?, status: "draft" | "pending" }`
 *
 * - The service target (type + date) is refreshed from the AUTHORIZED canonical
 *   role; it is never accepted from the client.
 * - The existing proposal is resolved through A1's two indexes (`service_ref` and
 *   target key), never an arbitrary `order()[0]`, and a duplicate/ambiguous group
 *   or a raw draft is `409` with no write.
 * - When a proposal exists, the EXACT observed id + revision is required; when
 *   none exists, only a deterministic-id create is permitted — that id is the
 *   first-create mutex between two co-leads.
 * - The weekend target lock (or the special role's own revision) is asserted in
 *   the SAME transaction.
 */
// A3 §3: outbound-delivery evidence emitted anywhere under this handler — including
// its post-commit `after()` fan-out — carries the in-flight verification run's markers.
// An unmarked ordinary request establishes nothing and behaves exactly as before.
export const POST = withVerificationRunContext(postHandler);

async function postHandler(req: NextRequest) {
  // Defence in depth — the canonical-role check below already requires the
  // caller to be a Lead on the service — but a worship write stays behind
  // worship membership regardless.
  const session = await requireMinistryMember("worship");
  if (!session) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    return reject(serviceError("invalid_request", { details: { issues: ["json"] } }));
  }
  const parsed = parseProposalSaveRequest(raw);
  if (!parsed.ok) {
    return reject(serviceError("invalid_request", { details: { issues: parsed.issues } }));
  }
  const request = parsed.value;
  const leadId = session.user.sanityId;

  // ── Authorize against the canonical role, and derive the target from it ────
  const lookup = await loadCanonicalRole(request.roleId);
  if (lookup.state === "none") {
    return NextResponse.json({ error: "Not a Lead on this service" }, { status: 403 });
  }
  if (lookup.state !== "single" || !lookup.role) {
    return reject(
      serviceError("ambiguous_target", { details: { roleId: request.roleId, state: lookup.state } }),
    );
  }
  if (lookup.draftIds.length) {
    return reject(
      serviceError("integrity_conflict", {
        details: { roleId: request.roleId, rawDrafts: lookup.draftIds },
      }),
    );
  }
  const role = lookup.role;
  // Member-facing gate: an admin-only draft service is not proposable.
  if (role.published === false || !canonicalLeadRefs(role).includes(leadId)) {
    return NextResponse.json({ error: "Not a Lead on this service" }, { status: 403 });
  }
  const target = targetFromCanonicalRole(role);
  if (!target) {
    return reject(
      serviceError("integrity_conflict", { details: { roleId: request.roleId, detail: "role_target" } }),
    );
  }

  // ── Resolve the shared proposal through BOTH indexes ──────────────────────
  const group = await loadProposalGroup({
    roleId: target.serviceRef,
    serviceDate: target.serviceDate,
    targetKey: target.targetKey,
  });
  if (!group.ok) {
    return reject(serviceError(group.failure.code, { details: group.failure.details }));
  }
  const existing = group.group.existing;
  const server = existing
    ? { state: "single" as const, id: existing._id as string, rev: existing._rev as string }
    : { state: "none" as const };

  const mismatch = compareObservedTarget(request.observed, server);
  if (mismatch) {
    return reject(
      serviceError("stale_revision", {
        details: { detail: mismatch, roleId: target.serviceRef, observed: request.observed, server },
      }),
    );
  }

  // An approved shared proposal already wrote the live setlist; re-opening it is
  // an admin-only transition, never a member save.
  if (existing && existing.status === "approved") {
    return reject(
      serviceError("stale_revision", {
        message: "Esta propuesta ya fue aprobada. Recarga para ver el setlist publicado.",
        details: { detail: "approved", proposalId: existing._id },
      }),
    );
  }

  // ── Coordination token ────────────────────────────────────────────────────
  let lockOp: { id: string; rev: string } | null = null;
  let bootstrapped = false;
  if (target.serviceType === "special") {
    // The special role is its own coordination token: assert its revision with a
    // no-op heartbeat of the unchanged date field, in the business transaction.
    lockOp = null;
  } else {
    const coordination = await loadWeekendCoordination({
      roleType: target.serviceType === "sunday" ? "sunday_role" : "saturday_role",
      week: target.serviceDate,
    });
    if (!coordination.ok) {
      return reject(
        serviceError(coordination.failure.code, { details: coordination.failure.details }),
      );
    }
    if (coordination.coordination.role?._id !== role._id) {
      return reject(
        serviceError("integrity_conflict", {
          details: { roleId: role._id, detail: "target_owner_mismatch" },
        }),
      );
    }
    bootstrapped = coordination.coordination.bootstrapped;
    const lock = coordination.coordination.lock;
    if (lock) lockOp = { id: lock._id, rev: lock._rev };
  }

  // ── One guarded transaction ───────────────────────────────────────────────
  const now = nowIso();
  // The outbox `leadNotes` snapshot, captured PRE-COMMIT from the proposal this
  // handler already loaded (§2). Read back inside the post-commit `after()` block
  // both would be the notes this save just wrote, so every notice would compare a
  // value against itself and say nothing.
  const previousStatus = existing ? existing.status : null;
  const beforeNotes = existing ? existing.lead_notes : "";
  // The index the flush slices the thread from — LEAD NOTES only, counted with
  // the same predicate `LEAD_NOTE_MESSAGES` filters on at flush, over the
  // pre-commit document this handler already loaded. A create has no thread yet,
  // so the count is 0 and `classifyProposalMessages` slices from the start.
  const storedLeadMessages = Array.isArray(existing?.messages)
    ? existing.messages.filter(isLeadNote)
    : [];
  const beforeMessageCount = storedLeadMessages.length;
  // What the lead last SAID, which is what the mirror used to hold and what the
  // append predicate below now compares against. `""` when the thread carries no
  // lead note — including on a create, where every save is a first message.
  const newestLast = storedLeadMessages[storedLeadMessages.length - 1] as
    | { body?: unknown }
    | undefined;
  const newestLeadNoteBody = typeof newestLast?.body === "string" ? newestLast.body : "";

  // ── The submission note becomes a thread message (Child A §2) ─────────────
  //
  // TWO conditions, and BOTH are load-bearing:
  //
  //  - **non-empty**, because "write the newest lead message body"
  //    unconditionally BLANKS a document that has a note and an empty
  //    `messages[]` — reachable in the migration's own release window — and
  //    silently reverts a newer note written by old production code with the
  //    older migrated body, a class the reconcile cannot detect because it
  //    compares exactly those two values.
  //  - **differs (trimmed) from the NEWEST `lead_note` message**, because
  //    `leadNotes` is a one-time initializer in the editor and is re-sent
  //    verbatim on EVERY save. Harmless for a `set`; with an unconditional
  //    append, three draft saves mint three identical bubbles, permanently —
  //    this delivery ships no delete path.
  //
  //    THE "pre-deploy client" ARGUMENT NO LONGER HOLDS, and inverted rather than
  //    merely expired: it was true while the target was the stored `lead_notes`,
  //    which the mirror kept equal to the newest message. A pre-Child-A client
  //    initialises its textarea from that now-FROZEN field, so once any thread
  //    post has happened since the cutover its stale copy DIFFERS from the newest
  //    message, the predicate fires, and the route resurrects the pre-cutover
  //    archive as a fresh bubble — mailed to admins, with no delete path.
  //    Residual, not guarded: the shipped editor sends `""` whenever `proposalId`
  //    is set, so only a tab loaded before Child A's release can produce it.
  //
  // THE COMPARISON TARGET MOVED, and it had to. It used to be the stored
  // `lead_notes`, which was live because this route mirrored it. Nothing writes
  // that field any more, so it is frozen at its pre-cutover value: a lead who
  // posts through the thread and then saves would compare their new text against
  // a stale archive, find it different, and mint a duplicate of the message they
  // just posted. The thread is now the only thing that knows what the lead last
  // said, so the thread is what the predicate reads.
  //
  // When the predicate is false the patch appends nothing and queues nothing: a
  // no-op write still moves `_rev`, and a notice for a message that does not
  // exist resets `servedRecipients` and slides a live debounce.
  const submissionNote = request.leadNotes.trim();
  const notesChanged = submissionNote !== "" && submissionNote !== newestLeadNoteBody.trim();
  const submissionMessage = notesChanged
    ? buildProposalMessage({
        authorId: leadId,
        authorRole: "lead",
        kind: "lead_note",
        body: request.leadNotes,
        now,
        key: nextKey(),
      })
    : null;
  const songs = buildProposalSongDocs(request.songs, nextKey);
  const submitted: Record<string, unknown> =
    request.status === "pending"
      ? { submitted_at: now, submitted_by: { _type: "reference", _ref: leadId } }
      : {};

  let proposalId: string;
  let tx = writeClient.transaction();

  if (existing) {
    proposalId = existing._id as string;
    // Equal to the client-observed revision — `compareObservedTarget` above
    // already refused anything else.
    const rev = existing._rev as string;
    const contributors = mergeContributor(
      storedContributors(existing.contributors),
      leadId,
      nextKey,
    );
    // `_type` is never sent: it is immutable per document id.
    tx = tx.patch(proposalId, (p) => {
      const patched = p.ifRevisionId(rev).set({
        songs,
        status: request.status,
        team_notes: request.teamNotes,
        contributors,
        // Target metadata refreshed from the authorized canonical role.
        service_type: target.serviceType,
        service_date: target.serviceDate,
        last_edited_by: { _type: "reference", _ref: leadId },
        last_edited_at: now,
        ...submitted,
      });
      return submissionMessage
        ? patched.setIfMissing({ messages: [] }).append("messages", [submissionMessage])
        : patched;
    });
  } else {
    const deterministic = deterministicProposalId(target.serviceRef);
    if (!deterministic) {
      return reject(serviceError("invalid_request", { details: { issues: ["roleId"] } }));
    }
    proposalId = deterministic;
    // `create` (never `createIfNotExists`): the co-lead who loses the race is TOLD.
    const created: Record<string, unknown> & { _id: string; _type: string } = {
      _id: deterministic,
      _type: "setlistProposal",
      service_type: target.serviceType,
      service_ref: { _type: "reference", _ref: target.serviceRef },
      service_date: target.serviceDate,
      lead: { _type: "reference", _ref: leadId },
      contributors: [
        { _type: "contributor", _key: nextKey(), person: { _type: "reference", _ref: leadId } },
      ],
      last_edited_by: { _type: "reference", _ref: leadId },
      last_edited_at: now,
      songs,
      status: request.status,
      team_notes: request.teamNotes,
      // A first submission goes through `create`, not a patch, so the array is
      // minted directly and needs no `setIfMissing`. `lead_notes` does NOT ride
      // along any more: seeding a field nothing maintains is worse than not
      // writing it, and a create is the one place a half-removed mirror would
      // look deliberate.
      ...(submissionMessage ? { messages: [submissionMessage] } : {}),
      ...submitted,
    };
    tx = tx.create(created);
  }

  if (lockOp) {
    const lockRev = lockOp.rev;
    tx = tx.patch(lockOp.id, (p) => p.ifRevisionId(lockRev).set({ updatedAt: now }));
  } else if (target.serviceType === "special") {
    const roleRev = role._rev;
    tx = tx.patch(role._id, (p) => p.ifRevisionId(roleRev).set({ date: target.serviceDate }));
  }

  try {
    await tx.commit();
  } catch (err) {
    const kind = sanityConflictKind(err);
    if (!kind) throw err;
    return reject(
      serviceError(bootstrapped ? "bootstrap_completed_reload" : "stale_revision", {
        details: {
          roleId: target.serviceRef,
          detail: kind === "already_exists" ? "concurrent_creation" : "revision_moved",
        },
      }),
    );
  }

  // Post-commit side effect (§7): only a proposal committed as `pending` notifies
  // — the existing admin/co-lead push plus the allowlist- and preference-aware
  // admin email. A draft save is silent, and a failed notification never fails
  // the write that already committed.
  if (request.status === "pending") {
    await notifyProposalPending({
      leadId,
      roleId: target.serviceRef,
      proposalId,
      serviceType: target.serviceType as "sunday" | "saturday" | "special",
      serviceDate: target.serviceDate,
    });
  }
  // The DEBOUNCED lead-notes email (§2). The predicate is that the proposal was
  // ALREADY `pending` / `changes_requested` before this write — a first
  // submission is silent, because `notifyProposalPending` above just mailed
  // admins "Nueva propuesta" about that very same write.
  //
  // **Only when something was appended.** A save that mirrored nothing has no
  // new note to announce, and queuing one anyway resets `servedRecipients` and
  // slides a live debounce for a message that does not exist.
  if (submissionMessage) {
    queueLeadNotesNotice({
      proposalId,
      serviceDate: target.serviceDate,
      previousStatus,
      beforeNotes,
      beforeMessageCount,
    });
  }

  // Return the fresh revision so the client can keep editing without a reload —
  // and the thread with it. Without the thread, a FIRST submission that carried a
  // note renders "Aún no hay mensajes." the instant it succeeds: the editor swaps
  // the textarea for the thread on `proposalId`, and its `messages` state was
  // initialized once from props that predate this very write. Nothing is lost in
  // Sanity; the surface just asserts the opposite of what it stored.
  //
  // BOTH reads are inside the guard, and that is the point: an earlier version
  // wrapped only the thread read, leaving the revision read `await`ed on the line
  // above it — so every content-lake failure the guard was written for threw
  // BEFORE the guard existed, and the lead was told a committed save had failed.
  // A guard defeated by the line above it is worse than no guard, because it
  // reads as protection.
  //
  // **`allSettled`, not `all`.** Each read degrades on its own terms. Under
  // `Promise.all` one rejection zeroed both, so a slow author-name join — the
  // heavier query, it dereferences per message — would discard a perfectly good
  // revision and send `_rev: null`, which drives the editor into "Otro líder
  // actualizó esta propuesta compartida". That banner would be false, and it
  // contradicts the whole point of `messages: null`, which is "keep rendering,
  // nothing is lost".
  //
  // **Why this is TWO queries — convention, not a live hazard.**
  // `THREAD_AFTER_APPEND_QUERY` projects `_rev` too, so merging them is
  // mechanically possible and the sibling messages route already sources its
  // `rev` that way. An earlier version of this comment claimed merging would
  // hand the lead a revision from an "ambiguous group"; that is FALSE and
  // blocking a legitimate simplification with a false reason is the same defect
  // as licensing a real one. Both queries filter `_id == $id`, ids are unique,
  // and the published perspective excludes `drafts.*` — so `pickUnique`'s
  // duplicate branch cannot fire here and `[0]` would be indistinguishable.
  //
  // It stays two because the guarded revision goes through the canonical bound
  // query like every other revision this HANDLER hands out — `GET` above serves
  // `_rev` from an inline GROQ, so the rule is the handler's, not the file's —
  // which is
  // defence-in-depth if that filter is ever widened. Merging them is a
  // legitimate change; it just needs to move `pickUnique`'s protection, not drop
  // it silently.
  const bound = canonicalProposalByIdQuery(proposalId);
  let fresh: { _rev?: string } | null = null;
  let freshMessages: ThreadMessageRow[] | null = null;
  const [revRead, threadRead] = await Promise.allSettled([
    operationalClient.fetch<{ _rev?: string }[]>(bound.query, bound.params),
    operationalClient.fetch<{ messages?: ThreadMessageRow[] | null } | null>(
      THREAD_AFTER_APPEND_QUERY,
      { id: proposalId },
    ),
  ]);
  // The write already committed; neither failure may be reported as one, because
  // the obvious retry is a second save. `_rev: null` degrades correctly on its
  // own — the editor forces a reload rather than saving against an unguarded
  // observation — and `messages: null` means "keep what you are rendering".
  //
  // **One residual the decoupling introduces, named not hidden.** On a FIRST
  // submission whose thread read alone fails, the response is a good `_rev` and
  // `messages: null`, so the editor keeps editing and reveals a thread that is
  // still empty — "Aún no hay mensajes." for a note that IS stored. Under the
  // coupled version this produced `_rev: null` and a forced reload, which showed
  // it. The trade is deliberate: a false "otro líder actualizó" banner on every
  // slow author-name join is worse than an empty thread on a transient failure
  // during a first submission, and the next save or reload resolves it. Nothing
  // is lost either way. Also recorded in the plan's §5, under the same
  // "Residual, named not closed" heading its siblings use.
  if (revRead.status === "fulfilled") fresh = pickUnique(revRead.value);
  else console.error("[proposals] post-commit revision read failed:", revRead.reason);
  if (threadRead.status === "fulfilled") {
    freshMessages = threadRead.value ? (threadRead.value.messages ?? []) : null;
  } else {
    console.error("[proposals] post-commit thread read failed:", threadRead.reason);
  }
  return NextResponse.json({
    _id: proposalId,
    _rev: fresh?._rev ?? null,
    status: request.status,
    // `null` means the read-back failed, NOT that the thread is empty. The
    // client keeps what it has rather than blanking.
    messages: freshMessages,
  });
}
