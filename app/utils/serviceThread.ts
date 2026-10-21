// What admins write to a service's leads from the service card (ADR-0064).
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

/** The thread of one service by `$threadId`, for the lead's editor. */
export const SERVICE_THREAD_BY_ID_QUERY = `*[_type == "${SERVICE_THREAD_TYPE}" && _id == $threadId][0]{
  _id, _rev,
  ${THREAD_MESSAGES}
}`;
