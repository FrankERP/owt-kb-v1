// One service's conversation for the MCP message tools (admin parity phase 3): the same read the
// «Mensajes del servicio» dialog makes (`GET /api/admin/service-threads/[roleId]/messages`, through
// `serviceConversationQuery`), and the name the leads' email shows for the member a bearer names.
//
// The client is imported HERE, from `sanity/lib/operationalClient`, like `serviceSnapshot.ts`: the
// protected-read audit recognises only clients imported from that module. No GROQ lives in this
// file: it executes the canonical builders only.

import "server-only";

import { operationalClient } from "@/sanity/lib/operationalClient";
import { serviceConversationQuery } from "@/app/utils/serviceReadQueries";
import { serviceThreadId, type ConversationRead } from "@/app/utils/serviceThread";
import { loadMemberNames } from "./serviceSnapshot";

/** The conversation of one role id, or `null` when no such service exists. Throws on a failed read. */
export async function loadServiceConversation(roleId: string): Promise<ConversationRead | null> {
  const threadId = serviceThreadId(roleId);
  if (!threadId) return null;
  const bound = serviceConversationQuery(roleId, threadId);
  const data = await operationalClient.fetch<ConversationRead | null>(bound.query, bound.params);
  return data?.service ? data : null;
}

/**
 * The display name of the member a bearer names — `alias`, else `member_name` — for the leads'
 * email («Frank te escribió…»), as the session's `alias || name` does on `/admin`. `""` when the
 * read fails or finds nobody: the email then reads without a name, never with someone else's.
 */
export async function loadActorName(memberId: string): Promise<string> {
  const lookup = await loadMemberNames([memberId], new Map());
  const member = lookup.byId.get(memberId);
  return member?.alias?.trim() || member?.member_name?.trim() || "";
}
