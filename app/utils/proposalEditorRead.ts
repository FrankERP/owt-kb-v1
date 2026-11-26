import "server-only";

// The setlist-proposal editor's reads: the service the caller leads, its ONE shared proposal and
// the service conversation. Called by the web editor (`/me/propose/[roleId]`) and by the native
// app's editor read (`GET /api/app/v1/proposals/[roleId]`, ADR-0091 W1), so both editors open on
// exactly the same documents.
//
// This module imports `operationalClient` itself and runs every fetch, rather than taking a client:
// the protected-read audit records a site only where a file fetches through a client it imports, so
// a helper handed its client would take these reads out of the audit (spec D3).

import { operationalClient } from "@/sanity/lib/operationalClient";
import { THREAD_MESSAGES, type ThreadMessageRow } from "./proposalMessageRead";
import { pickUnique, serviceDayKey } from "./serviceReadSelect";
import { SERVICE_THREAD_BY_ID_QUERY, serviceThreadId, type PastorMessageRow } from "./serviceThread";
import type { ProposalStatus } from "./interface";

export type ProposalServiceType = "sunday" | "saturday" | "special";

export interface ProposalRoleDoc {
  _id: string;
  _type: string;
  week?: string;
  date?: string;
  service_name?: string;
}

/** The shared proposal as the editors read it. Every field may be missing on stored data. */
export interface SharedProposalRow {
  _id: string;
  _rev: string;
  status: ProposalStatus;
  lead_notes?: string | null;
  team_notes?: string | null;
  admin_notes?: string | null;
  pastor_message?: string | null;
  messages?: ThreadMessageRow[] | null;
  createdById?: string | null;
  contributors?: Array<{ id?: string | null; name?: string | null } | null> | null;
  songs?: Array<{
    _key?: string;
    play_key?: string | null;
    medley_tag?: string | null;
    song_id?: string | null;
    title?: string | null;
    author?: string | null;
    key?: string | null;
  } | null> | null;
}

export interface ServiceThreadRead {
  messages: ThreadMessageRow[];
  pastorMessage: string | null;
}

export interface ProposalEditorRead {
  roleDoc: ProposalRoleDoc;
  serviceType: ProposalServiceType;
  serviceDate: string;
  proposal: SharedProposalRow | null;
  thread: ServiceThreadRead;
}

async function getRoleDoc(roleId: string, leadId: string): Promise<ProposalRoleDoc | null> {
  // Try all three role types — only returns if the user is a Lead on this doc.
  // Canonical (published-perspective) client: a `drafts.*` overlay is never an
  // editable service. `published != false` is the separate, app-level
  // member-visibility gate and stays. Returned as an array and collapsed with
  // `pickUnique` — an exact-id match can only be ambiguous if the read contract
  // is violated, in which case we fail closed (404) rather than pick one.
  const docs = await operationalClient.fetch<ProposalRoleDoc[]>(
    `*[_id == $id && (_type == "sunday_role" || _type == "saturday_role" || _type == "special_role") && $leadId in Lead[]._ref && published != false] {
      _id, _type, week, date, service_name
    }`,
    { id: roleId, leadId }
  );
  return pickUnique(docs);
}

// The ONE shared proposal for this service, chosen by `service_ref` with
// `order(_createdAt asc)[0]`, which is deterministic. The writer resolves its
// target over two indexes (`service_ref` and the target key); a legacy proposal
// reachable only by its target key shows here as «none», and the writer then
// answers every save with a 409 (spec W1, known gaps).
async function getSharedProposal(roleId: string): Promise<SharedProposalRow | null> {
  return operationalClient.fetch<SharedProposalRow | null>(
    `*[_type == "setlistProposal" && service_ref._ref == $roleId] | order(_createdAt asc)[0] {
      _id, _rev, status, lead_notes, team_notes, admin_notes,
      // ADR-0087: the editor re-sends this on every save, so the read MUST carry it.
      pastor_message,
      ${THREAD_MESSAGES},
      "createdById": lead->_id,
      "contributors": contributors[]{ "id": person->_id, "name": coalesce(person->alias, person->member_name) },
      songs[] {
        _key, play_key, medley_tag,
        "song_id": song._ref,
        "title": song->title,
        "author": song->author,
        "key": song->key
      }
    }`,
    { roleId }
  );
}

// What admins wrote to this service's leads from its card (ADR-0065) — the
// conversation and the pastor's message. Read for every visit, proposal or not:
// the lead needs it most BEFORE choosing songs, and once the proposal exists it
// is part of the same conversation.
async function getServiceThread(roleId: string): Promise<ServiceThreadRead> {
  const threadId = serviceThreadId(roleId);
  if (!threadId) return { messages: [], pastorMessage: null };
  const thread = await operationalClient.fetch<
    { messages?: ThreadMessageRow[] | null; pastor_message?: PastorMessageRow | null } | null
  >(SERVICE_THREAD_BY_ID_QUERY, { threadId });
  return { messages: thread?.messages ?? [], pastorMessage: thread?.pastor_message?.body || null };
}

/**
 * Everything the editor opens on, or `null` when the caller may not edit this service's proposal:
 * the role does not exist, is a draft (`published == false`), does not list the caller in `Lead[]`,
 * or has a stored date that fails `serviceDayKey` (the writer derives `service_date` from it).
 * A failed read throws; the caller decides how to answer.
 */
export async function readProposalEditor(roleId: string, leadId: string): Promise<ProposalEditorRead | null> {
  const roleDoc = await getRoleDoc(roleId, leadId);
  if (!roleDoc) return null;

  // A role whose stored date is missing or malformed cannot be proposed against
  // (the writer derives service_date from it) — fail closed rather than sending
  // the editor a bogus date.
  const serviceDate = serviceDayKey(roleDoc.week ?? roleDoc.date);
  if (!serviceDate) return null;

  const [proposal, thread] = await Promise.all([getSharedProposal(roleId), getServiceThread(roleId)]);

  const serviceType: ProposalServiceType =
    roleDoc._type === "sunday_role" ? "sunday" :
    roleDoc._type === "saturday_role" ? "saturday" : "special";

  return { roleDoc, serviceType, serviceDate, proposal: proposal ?? null, thread };
}
