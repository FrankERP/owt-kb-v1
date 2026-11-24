// What admins write to a service's leads from the service card (ADR-0065).
//
// A `serviceThread` holds those messages — typically what the pastor shared
// about that Sunday, often before the leads have created the shared
// `setlistProposal`, and kept here after they do. It is keyed by the ROLE id, exactly like the proposal
// (`setlistProposal.<roleId>`), so a service whose date moves keeps its thread.
//
// It is a separate document ON PURPOSE. The obvious alternative, minting the
// proposal early with no songs, would turn a chat message into a service
// dependency: `roleDependencies` blocks deleting or moving a role that has any
// proposal (of any status), and readiness reads a draft proposal as "Revisar
// propuesta". A message must not change either.
//
// It also holds the service's ONE «Mensaje del pastor» (`pastor_message`, since
// 2026-10-24): a single editable text, not a chat message, shown to the whole
// team on the DayCard and pinned above the leads' proposal.
//
// Pure: no Sanity client, no I/O. Its readers (the card's dialog, the proposal
// card, the lead's editor) render it with the proposal's own thread, ordered by `at`.

import { isCanonicalDocumentId } from "./roleWriteRequest";
import { THREAD_MESSAGES } from "./proposalMessageRead";

export const SERVICE_THREAD_TYPE = "serviceThread";

/**
 * `serviceThread.<roleId>` — dotted, so an untokened read never serves it, and
 * deterministic, so two admins posting at once land in the same document
 * (`createIfNotExists` + `append`, no revision assertion).
 */
export function serviceThreadId(roleId: unknown): string | null {
  if (!isCanonicalDocumentId(roleId)) return null;
  return `${SERVICE_THREAD_TYPE}.${roleId}`;
}

/**
 * The messages of the service thread whose role id is `roleExpr`, as a GROQ
 * expression for a projection — the same row shape as `THREAD_MESSAGES`, so
 * the two lists concatenate. `null` when the service has no thread.
 *
 *     `"earlier_messages": ${serviceThreadMessagesOf("^.service_ref._ref")}`
 */
export function serviceThreadMessagesOf(roleExpr: string): string {
  return `*[_type == "${SERVICE_THREAD_TYPE}" && _id == "${SERVICE_THREAD_TYPE}." + ${roleExpr}][0].${THREAD_MESSAGES}`;
}

/**
 * The pastor's message as the surfaces read it: the text, when it was set and
 * last edited, and who did it (name joined at read time, like a message).
 */
export const PASTOR_MESSAGE = `pastor_message{
    body, at, edited_at,
    "author": author._ref,
    "author_name": coalesce(author->alias, author->member_name)
  }`;

/** The shape `PASTOR_MESSAGE` projects. */
export interface PastorMessageRow {
  body?: string;
  at?: string;
  edited_at?: string | null;
  author?: string | null;
  author_name?: string | null;
}

/**
 * The pastor's message TEXT of the service whose role id is `roleExpr`, for a
 * member-facing projection (the DayCard's readers). `null` when there is none.
 *
 *     `"pastor_message": ${pastorMessageBodyOf("^._id")}`
 */
export function pastorMessageBodyOf(roleExpr: string): string {
  return `*[_type == "${SERVICE_THREAD_TYPE}" && _id == "${SERVICE_THREAD_TYPE}." + ${roleExpr}][0].pastor_message.body`;
}

/** The thread of one service by `$threadId`, for the lead's editor. */
export const SERVICE_THREAD_BY_ID_QUERY = `*[_type == "${SERVICE_THREAD_TYPE}" && _id == $threadId][0]{
  _id, _rev,
  ${THREAD_MESSAGES},
  ${PASTOR_MESSAGE}
}`;

/** What `serviceConversationQuery` (`serviceReadQueries.ts`) reads: the admin GET's and the MCP read's one shape. */
export interface ConversationRead {
  service: {
    _id: string;
    _rev: string;
    _type: string;
    team_notes?: string | null;
    hasSongs?: boolean;
    [k: string]: unknown;
  } | null;
  weekendSetlists?: Array<{ _id: string; _rev: string; _type: string; team_notes?: string | null }> | null;
  [k: string]: unknown;
}

/**
 * Where this service's «Mensaje para el equipo» lives, for the team-notes PUT to
 * assert: a special's role (when it has a setlist), or the ONE weekend setlist
 * document of its type. No setlist is `null` (the dialog says there is none yet);
 * a duplicate pair is `{ unavailable: "ambiguous" }`, so the dialog names the
 * real reason. The PUT refuses both the same way.
 */
export function teamNotesTarget(
  service: NonNullable<ConversationRead["service"]>,
  weekendSetlists: ConversationRead["weekendSetlists"],
  own: { _rev: string; team_notes?: string | null; hasSongs?: boolean },
): { text: string; observed: { id: string; rev: string } } | { unavailable: "ambiguous" } | null {
  if (service._type === "special_role") {
    return own.hasSongs ? { text: own.team_notes ?? "", observed: { id: service._id, rev: own._rev } } : null;
  }
  const type = service._type === "sunday_role" ? "featuredSongs" : "saturdarSongs";
  const rows = (weekendSetlists ?? []).filter((r) => r._type === type);
  if (rows.length > 1) return { unavailable: "ambiguous" };
  if (rows.length !== 1) return null;
  return { text: rows[0].team_notes ?? "", observed: { id: rows[0]._id, rev: rows[0]._rev } };
}
