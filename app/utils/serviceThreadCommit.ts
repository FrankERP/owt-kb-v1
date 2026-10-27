// The service conversation's writers (ADR-0065), after authorization: one
// message appended to `serviceThread.<roleId>`, an admin's edit or delete of
// their own message, the ONE «Mensaje del pastor», and the live setlist's
// «Mensaje para el equipo». The `/api/admin/service-threads/[roleId]/…` routes
// authorize a NextAuth session and call these; the MCP connector's message
// tools call the same functions with the member its bearer names (admin parity
// phase 3), so both surfaces refuse, write and notify through one code path
// (ADR-0043).
//
// Every function returns a `CommitOutcome`: `body` and `status` are EXACTLY what
// the route sends. The rationale for each rule lives beside it, moved here from
// the routes unchanged.

import { after } from "next/server";
import { writeClient } from "@/sanity/lib/serverClient";
import { operationalClient } from "@/sanity/lib/operationalClient";
import { serviceError } from "@/app/utils/serviceMutation";
import { isCanonicalDocumentId, sanityConflictKind } from "@/app/utils/roleWriteRequest";
import { loadCanonicalRole, nextKey, nowIso, type StoredLock } from "@/app/utils/roleWriteOps";
import { canonicalLeadRefs } from "@/app/utils/serviceReadSelect";
import { targetFromCanonicalRole } from "@/app/utils/proposalWriteRequest";
import { attempt, attemptSync } from "@/app/utils/serviceMutationSideEffects";
import { revalidateServiceViews } from "@/app/utils/revalidate";
import {
  buildProposalMessage,
  parseProposalMessageRequest,
  PROPOSAL_MESSAGES_MAX,
  type ProposalMessage,
} from "@/app/utils/proposalMessageWrite";
import { isThreadOpen } from "@/app/utils/proposalThread";
import type { ThreadMessageRow } from "@/app/utils/proposalMessageRead";
import {
  PASTOR_MESSAGE,
  SERVICE_THREAD_BY_ID_QUERY,
  SERVICE_THREAD_TYPE,
  serviceThreadId,
  type PastorMessageRow,
} from "@/app/utils/serviceThread";
import {
  isMessageKey,
  parseMessageEdit,
  parsePastorMessageEdit,
  parseTeamNotesEdit,
  pastorMessageStamp,
} from "@/app/utils/serviceMessageEdit";
import { notifyLeadsAboutServiceMessage } from "@/app/utils/serviceThreadNotify";
import { serviceIdentity } from "@/app/utils/emailServiceLabel";
import {
  loadSpecialSetlistTarget,
  loadWeekendCoordination,
  loadWeekendSetlistTarget,
} from "@/app/utils/serviceWriteTargets";
import { compareObservedTarget, type ServerTarget } from "@/app/utils/setlistWriteRequest";
import type { CommitOutcome } from "@/app/utils/commitOutcome";

/**
 * Who is writing: the `teamMembers` id the caller authorized (the session's
 * `sanityId`, or the MCP bearer's subject) and the name the leads' email shows.
 * `id` may be null only on the session path, exactly as before the extraction.
 */
export interface ThreadActor {
  id: string | null;
  name: string;
}

/** What a committed append held, for a caller that reports it. */
export interface ThreadMessageEffects {
  message: ProposalMessage;
  /** Whether the leads' push + email was registered (a published service). */
  notified: boolean;
  /** The service's Lead seat as loaded pre-commit. */
  leadIds: string[];
}

function refuse(res: { status: number; body: unknown }): { ok: false; status: number; body: Record<string, unknown> } {
  return { ok: false, status: res.status, body: res.body as Record<string, unknown> };
}

const FORBIDDEN_NOT_AUTHOR = { ok: false as const, status: 403, body: { error: "Forbidden", code: "not_author" } };

/**
 * Append one admin message to a service's thread — from the service card, with
 * or without a proposal.
 *
 * The message lands in `serviceThread.<roleId>`, NOT in a proposal: minting a
 * proposal to hold a message would make the role undeletable and immovable
 * (`roleDependencies` blocks on any proposal) and turn its readiness into
 * "Revisar propuesta". Every reader (the card's dialog, the proposal card, the
 * lead's editor) shows this thread together with the proposal's own.
 *
 * Deliberate, and the same as `admin/proposals/[id]/messages`:
 *  - **No `ifRevisionId`.** Two admins posting at once must both land.
 *    `createIfNotExists` + `setIfMissing` + `append` in one transaction is what
 *    makes the first message and every later one the same write.
 *  - **`isThreadOpen` is enforced here**, not only in the UI.
 *  - **`kind`** is `admin_change_request`, the admin kind the proposal messages
 *    route uses too. The pastor's message has its own writer (`…/pastor-message`).
 *
 * Written here even when a proposal exists: one writer and one notification
 * rule behind the card's button, never a choice decided by a race with the
 * lead's first save. The proposal's readers show it anyway.
 *
 * **No ministry check**, inherited deliberately from the proposal message route
 * beside it, so a kids-only `admin` can post here; tightening both is
 * FrankERP/owt-kb-v1#8.
 *
 * Nothing to revalidate: no ISR page reads a thread's `messages` (the proposal
 * page is `revalidate = 0`, the admin list is an API read). Its `pastor_message`
 * IS read by `/` and `/schedule`, so that field's writer revalidates; this one
 * never touches it.
 */
export async function postServiceThreadMessage(
  roleId: string,
  raw: unknown,
  actor: ThreadActor,
): Promise<CommitOutcome<ThreadMessageEffects>> {
  const adminId = actor.id;
  const threadId = serviceThreadId(roleId);
  if (!isCanonicalDocumentId(roleId) || !threadId) {
    return refuse(serviceError("invalid_request", { details: { issues: ["roleId"] } }));
  }

  const parsed = parseProposalMessageRequest(raw);
  if (!parsed.ok) {
    return refuse(serviceError("invalid_request", { details: { issues: parsed.issues } }));
  }

  const lookup = await loadCanonicalRole(roleId);
  if (lookup.state === "none" || !lookup.role) {
    return refuse(serviceError("not_found", { details: { roleId } }));
  }
  if (lookup.state !== "single") {
    return refuse(serviceError("ambiguous_target", { details: { roleId, state: lookup.state } }));
  }
  const role = lookup.role;
  const target = targetFromCanonicalRole(role);
  if (!target) {
    return refuse(serviceError("integrity_conflict", { details: { roleId, detail: "role_target" } }));
  }
  if (!isThreadOpen({ serviceDate: target.serviceDate })) {
    return refuse(serviceError("invalid_request", { details: { issues: ["thread_closed"] } }));
  }

  // A growth bound, not a boundary — racy by construction, as on the proposal.
  const existing = await operationalClient.fetch<{ count?: number } | null>(
    `*[_type == "${SERVICE_THREAD_TYPE}" && _id == $threadId][0]{ "count": count(messages) }`,
    { threadId },
  );
  if ((existing?.count ?? 0) >= PROPOSAL_MESSAGES_MAX) {
    return refuse(serviceError("invalid_request", { details: { issues: ["messages_full"] } }));
  }

  const message = buildProposalMessage({
    authorId: adminId,
    authorRole: "admin",
    // The pastor's message is no longer a chat message (it is the thread's ONE
    // `pastor_message`, `…/pastor-message`); `pastor_note` items posted before
    // 2026-10-24 still render with their label.
    kind: "admin_change_request",
    body: parsed.value.body,
    now: nowIso(),
    key: nextKey(),
  });
  if (!message) {
    return refuse(serviceError("invalid_request", { details: { issues: ["body"] } }));
  }

  // PRE-COMMIT: the audience is the role's Lead seat as loaded here, and the
  // email's service label comes from the same read.
  const leadIds = canonicalLeadRefs(role);
  const published = role.published !== false;
  const authorName = actor.name;

  try {
    await writeClient
      .transaction()
      .createIfNotExists({
        _id: threadId,
        _type: SERVICE_THREAD_TYPE,
        // A plain STRING, never a reference — not even a weak one. GROQ's
        // `references()` matches weak references too, and `roleDependencies`
        // turns every document referencing a role into a dependency: one message
        // would block «Limpiar mes», a role delete and a date move.
        role_id: roleId,
        messages: [],
      })
      .patch(threadId, (p) => p.setIfMissing({ messages: [] }).append("messages", [message]))
      .commit();
  } catch (err) {
    // Nothing is asserted, so a 409 is a genuine Sanity write conflict.
    if (!sanityConflictKind(err)) throw err;
    return refuse(serviceError("stale_revision", { details: { id: threadId } }));
  }

  // Push AND email to the service's leads (never the author) — see
  // `serviceThreadNotify.ts` for why this differs from a proposal's admin message.
  // Skipped for an unpublished service: its leads cannot open the proposal page
  // yet (it 404s on `published == false`); they read it once the month is.
  //
  // Swallowed and logged: a delivery failure must not turn a stored message into
  // an error response (the retry would be a permanent duplicate). The callback
  // AWAITS so delivery finishes before the runtime freezes the instance.
  if (published) {
    attemptSync("service thread message notify register", () =>
      after(() =>
        attempt("service thread message notify", () =>
          notifyLeadsAboutServiceMessage({
            leadIds,
            authorId: adminId,
            authorName,
            roleId,
            roleType: role._type,
            serviceDate: target.serviceDate,
            identity: serviceIdentity(role),
            body: message.body,
          }),
        ),
      ),
    );
  }

  // The read-back is for the RESPONSE ONLY and is guarded: the write already
  // committed, and `messages: null` tells the client to keep what it shows.
  let fresh: { messages?: ThreadMessageRow[] | null } | null = null;
  try {
    fresh = await operationalClient.fetch<{ messages?: ThreadMessageRow[] | null } | null>(
      SERVICE_THREAD_BY_ID_QUERY,
      { threadId },
    );
  } catch (err) {
    console.error("[serviceThread] post-commit read failed:", err);
  }

  return {
    ok: true,
    status: 200,
    body: {
      ok: true,
      message,
      messages: fresh ? (fresh.messages ?? []) : null,
    },
    effects: { message, notified: published, leadIds: [...leadIds] },
  };
}

/**
 * Edit or delete ONE message an admin wrote in a service thread (ADR-0065,
 * amended 2026-10-24). Only its AUTHOR may, checked here against the stored
 * `author` reference — an admin cannot rewrite what another admin said, and
 * nobody edits a lead's words (those live on the proposal, which this never
 * touches).
 *
 * Both write ONE path, `messages[_key=="<key>"]`, with no `ifRevisionId`: the
 * author of a stored message never changes, so the check below cannot go stale,
 * and asserting the thread's `_rev` would refuse an edit whenever anyone appended
 * meanwhile. A message deleted in between makes the edit a no-op, not an error.
 * An edit stamps `edited_at` («editado»); neither notifies anyone.
 *
 * Only while the conversation is open (`isThreadOpen`, as on the POST): once the
 * service has passed, what was said is the record of it.
 */
async function authorizeOwnMessage(
  roleId: string,
  key: string,
  actorId: string | null,
): Promise<{ refusal: CommitOutcome<never>; threadId?: never } | { refusal?: never; threadId: string }> {
  const threadId = serviceThreadId(roleId);
  if (!isCanonicalDocumentId(roleId) || !threadId || !isMessageKey(key)) {
    return { refusal: refuse(serviceError("invalid_request", { details: { issues: ["roleId", "key"] } })) };
  }
  const lookup = await loadCanonicalRole(roleId);
  const target = lookup.state === "single" && lookup.role ? targetFromCanonicalRole(lookup.role) : null;
  if (!target) return { refusal: refuse(serviceError("not_found", { details: { roleId } })) };
  if (!isThreadOpen({ serviceDate: target.serviceDate })) {
    return { refusal: refuse(serviceError("invalid_request", { details: { issues: ["thread_closed"] } })) };
  }
  const message = await operationalClient.fetch<{ author?: string | null } | null>(
    `*[_type == "${SERVICE_THREAD_TYPE}" && _id == $threadId][0].messages[_key == $key][0]{ "author": author._ref }`,
    { threadId, key },
  );
  if (!message) return { refusal: refuse(serviceError("not_found", { details: { key } })) };
  if (!actorId || message.author !== actorId) return { refusal: FORBIDDEN_NOT_AUTHOR };
  return { threadId };
}

async function threadAfterWrite(threadId: string): Promise<CommitOutcome<{ threadId: string }>> {
  // Guarded read-back, as on the POST: `messages: null` = keep what you show.
  try {
    const fresh = await operationalClient.fetch<{ messages?: ThreadMessageRow[] | null } | null>(
      SERVICE_THREAD_BY_ID_QUERY,
      { threadId },
    );
    return { ok: true, status: 200, body: { ok: true, messages: fresh?.messages ?? [] }, effects: { threadId } };
  } catch (err) {
    console.error("[serviceThread] post-commit read failed:", err);
    return { ok: true, status: 200, body: { ok: true, messages: null }, effects: { threadId } };
  }
}

/** Edit the body of the actor's own message. The body is parsed BEFORE authorization, as the route did. */
export async function editServiceThreadMessage(
  roleId: string,
  key: string,
  raw: unknown,
  actor: Pick<ThreadActor, "id">,
): Promise<CommitOutcome<{ threadId: string }>> {
  const parsed = parseMessageEdit(raw);
  if (!parsed.ok) return refuse(serviceError("invalid_request", { details: { issues: parsed.issues } }));

  const auth = await authorizeOwnMessage(roleId, key, actor.id);
  if (auth.refusal) return auth.refusal;
  const path = `messages[_key=="${key}"]`;
  await writeClient
    .patch(auth.threadId)
    .set({ [`${path}.body`]: parsed.value.body, [`${path}.edited_at`]: nowIso() })
    .commit();
  return threadAfterWrite(auth.threadId);
}

/** Delete the actor's own message. */
export async function deleteServiceThreadMessage(
  roleId: string,
  key: string,
  actor: Pick<ThreadActor, "id">,
): Promise<CommitOutcome<{ threadId: string }>> {
  const auth = await authorizeOwnMessage(roleId, key, actor.id);
  if (auth.refusal) return auth.refusal;
  await writeClient.patch(auth.threadId).unset([`messages[_key=="${key}"]`]).commit();
  return threadAfterWrite(auth.threadId);
}

interface StoredThread {
  _id: string;
  _rev: string;
  pastor_message?: { body?: string; at?: string; edited_at?: string; author?: { _ref?: string } } | null;
}

/** What a committed pastor-message write did. */
export interface PastorMessageEffects {
  /** `set` (it appeared), `edit`, `clear`, or `none` (clearing what was not there). */
  change: "set" | "edit" | "clear" | "none";
  /** Whether the leads' push + email was registered: only a message that APPEARS on a published service. */
  notified: boolean;
}

/**
 * Set, edit or clear the service's ONE «Mensaje del pastor» (ADR-0065, amended
 * 2026-10-24).
 *
 * Body `{ body, observed }`: `body` empty clears it; `observed` is the stamp the
 * admin saw (`edited_at ?? at`, or null for none). A different stored stamp is a
 * 409 — two admins editing at once never silently overwrite each other — and the
 * write asserts the thread's `_rev` read here, so nothing lands in between.
 * The stamp, not the thread's `_rev`, is what the client observes: a chat message
 * appended meanwhile changes the `_rev` but not the pastor's message, and must
 * not make the admin redo an edit that conflicts with nothing.
 *
 * It lives on `serviceThread.<roleId>`, never on the role (every role writer
 * asserts the role `_rev`) and never on a proposal (ADR-0065).
 *
 * Notifies the leads (push AND email, `pastor: true`) only when a message
 * APPEARS on a published service. An edit or a clear sends nothing: a typo fix
 * must not mail the leads again, and the DayCard always shows the current text.
 */
export async function setPastorMessage(
  roleId: string,
  raw: unknown,
  actor: ThreadActor,
): Promise<CommitOutcome<PastorMessageEffects>> {
  const adminId = actor.id;
  const threadId = serviceThreadId(roleId);
  if (!isCanonicalDocumentId(roleId) || !threadId) {
    return refuse(serviceError("invalid_request", { details: { issues: ["roleId"] } }));
  }

  const parsed = parsePastorMessageEdit(raw);
  if (!parsed.ok) {
    return refuse(serviceError("invalid_request", { details: { issues: parsed.issues } }));
  }
  const { body, observed } = parsed.value;

  const lookup = await loadCanonicalRole(roleId);
  if (lookup.state === "none" || !lookup.role) {
    return refuse(serviceError("not_found", { details: { roleId } }));
  }
  if (lookup.state !== "single") {
    return refuse(serviceError("ambiguous_target", { details: { roleId, state: lookup.state } }));
  }
  const role = lookup.role;
  const target = targetFromCanonicalRole(role);
  if (!target) {
    return refuse(serviceError("integrity_conflict", { details: { roleId, detail: "role_target" } }));
  }

  const stored = await operationalClient.fetch<StoredThread | null>(
    `*[_type == "${SERVICE_THREAD_TYPE}" && _id == $threadId][0]{ _id, _rev, pastor_message }`,
    { threadId },
  );
  const before = stored?.pastor_message?.body ? stored.pastor_message : null;
  if (pastorMessageStamp(before) !== observed) {
    return refuse(serviceError("stale_revision", { details: { id: threadId, detail: "pastor_message_moved" } }));
  }

  const now = nowIso();
  const author = adminId ? { author: { _ref: adminId, _type: "reference" as const } } : {};
  const next = body
    ? {
        _type: "pastor_message",
        body,
        ...author,
        // First set keeps its moment; every later save is an edit.
        at: before?.at ?? now,
        ...(before ? { edited_at: now } : {}),
      }
    : null;

  if (!next && !before) {
    // Clearing what is not there: nothing to write.
    return { ok: true, status: 200, body: { ok: true, pastor_message: null }, effects: { change: "none", notified: false } };
  }

  try {
    if (stored) {
      const patch = writeClient.patch(threadId).ifRevisionId(stored._rev);
      await (next ? patch.set({ pastor_message: next }) : patch.unset(["pastor_message"])).commit();
    } else {
      // `create`, never `createIfNotExists`: a thread created meanwhile (a chat
      // message) must be TOLD, and the admin retries against it.
      await writeClient.create({
        _id: threadId,
        _type: SERVICE_THREAD_TYPE,
        // A plain string, never a reference (ADR-0065).
        role_id: roleId,
        messages: [],
        pastor_message: next,
      });
    }
  } catch (err) {
    if (!sanityConflictKind(err)) throw err;
    return refuse(serviceError("stale_revision", { details: { id: threadId } }));
  }

  revalidateServiceViews();

  // Only a message that APPEARS notifies, and only on a published service (its
  // leads cannot open the proposal page while it is a draft).
  const notified = !!next && !before && role.published !== false;
  if (notified && next) {
    const leadIds = canonicalLeadRefs(role);
    const authorName = actor.name;
    attemptSync("pastor message notify register", () =>
      after(() =>
        attempt("pastor message notify", () =>
          notifyLeadsAboutServiceMessage({
            leadIds,
            authorId: adminId,
            authorName,
            roleId,
            roleType: role._type,
            serviceDate: target.serviceDate,
            identity: serviceIdentity(role),
            body,
            pastor: true,
          }),
        ),
      ),
    );
  }

  // Guarded read-back for the response only: the write already committed.
  let fresh: PastorMessageRow | null | undefined;
  try {
    fresh = await operationalClient.fetch<PastorMessageRow | null>(
      `*[_type == "${SERVICE_THREAD_TYPE}" && _id == $threadId][0].${PASTOR_MESSAGE}`,
      { threadId },
    );
  } catch (err) {
    console.error("[pastorMessage] post-commit read failed:", err);
  }
  return {
    ok: true,
    status: 200,
    body: {
      ok: true,
      // `undefined` (read failed) → the client keeps what it sent.
      pastor_message: fresh === undefined ? (next ? { ...next, author: adminId } : null) : (fresh ?? null),
    },
    effects: { change: !next ? "clear" : before ? "edit" : "set", notified },
  };
}

/** What a team-notes save did. */
export interface TeamNotesEffects {
  /** False when the stored note already equalled the request (nothing written). */
  written: boolean;
  teamNotes: string | null;
}

/**
 * Edit the «Mensaje para el equipo» of a service's LIVE setlist after it is
 * published (ADR-0065, amended 2026-10-24). Before this, the only writer was the
 * proposal approval, which copies the lead's note; a note in the wrong place
 * could only be fixed in Studio.
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
export async function saveTeamNotes(roleId: string, raw: unknown): Promise<CommitOutcome<TeamNotesEffects>> {
  if (!isCanonicalDocumentId(roleId)) {
    return refuse(serviceError("invalid_request", { details: { issues: ["roleId"] } }));
  }

  const parsed = parseTeamNotesEdit(raw);
  if (!parsed.ok) {
    return refuse(serviceError("invalid_request", { details: { issues: parsed.issues } }));
  }
  const { teamNotes, observed } = parsed.value;

  const lookup = await loadCanonicalRole(roleId);
  if (lookup.state === "none" || !lookup.role) {
    return refuse(serviceError("not_found", { details: { roleId } }));
  }
  if (lookup.state !== "single") {
    return refuse(serviceError("ambiguous_target", { details: { roleId, state: lookup.state } }));
  }
  const target = targetFromCanonicalRole(lookup.role);
  if (!target) {
    return refuse(serviceError("integrity_conflict", { details: { roleId, detail: "role_target" } }));
  }

  let server: ServerTarget;
  let lock: StoredLock | null = null;
  if (target.serviceType === "special") {
    const loaded = await loadSpecialSetlistTarget(roleId, target.serviceDate);
    if (!loaded.ok) return refuse(serviceError(loaded.failure.code, { details: loaded.failure.details }));
    server = loaded.target.server;
  } else {
    const setlistType = target.serviceType === "sunday" ? "featuredSongs" : "saturdarSongs";
    const roleType = target.serviceType === "sunday" ? "sunday_role" : "saturday_role";
    const [loaded, coordination] = await Promise.all([
      loadWeekendSetlistTarget(setlistType, target.serviceDate),
      loadWeekendCoordination({ roleType, week: target.serviceDate }),
    ]);
    if (!loaded.ok) return refuse(serviceError(loaded.failure.code, { details: loaded.failure.details }));
    if (!coordination.ok) {
      return refuse(serviceError(coordination.failure.code, { details: coordination.failure.details }));
    }
    server = loaded.target.server;
    lock = coordination.coordination.lock;
  }

  if (server.state === "none") {
    return refuse(serviceError("stale_revision", { details: { roleId, detail: "no_setlist" } }));
  }
  const mismatch = compareObservedTarget({ state: "single", ...observed }, server);
  if (mismatch) {
    return refuse(serviceError("stale_revision", { details: { roleId, detail: mismatch } }));
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
    return {
      ok: true,
      status: 200,
      body: { ok: true, teamNotes: teamNotes || null, observed: { id: server.id, rev: server.rev } },
      effects: { written: false, teamNotes: teamNotes || null },
    };
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
    return refuse(serviceError("stale_revision", { details: { roleId, detail: "revision_moved" } }));
  }

  revalidateServiceViews();
  // A mutated document's new `_rev` IS the transaction id, so the dialog can save
  // again without reloading.
  return {
    ok: true,
    status: 200,
    body: { ok: true, teamNotes: teamNotes || null, observed: { id: server.id, rev: transactionId } },
    effects: { written: true, teamNotes: teamNotes || null },
  };
}
