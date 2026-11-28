// GET /api/app/v1/admin/service-threads/[roleId] — one service's «Mensajes del servicio» for an
// admin on the native app (A-W2 spec D2, `docs/superpowers/specs/2026-11-28-native-service-messages-design.md`):
// the pastor's message, the «Mensaje para el equipo» and where it lives, the shared proposal's
// status and offered pastor's text, and the two threads, APART. The same read the web dialog's GET
// makes (`serviceConversationQuery`), shaped by `buildAppServiceMessages`: names and `mine`, never a
// member id.
//
// Who may read it is the web's rule: an active manager who is not a content-editor, with no ministry
// check (FrankERP/owt-kb-v1#8), decided again on a fresh access read. This module sends nothing, so
// it is not wrapped; its own source must never name a delivery-capable module (the SR scan matches
// substrings of this file).

import { requireAppSession } from "@/app/appAuth/requireAppSession";
import { appForbiddenResponse, appUnavailableResponse, jsonNoStore } from "@/app/appAuth/responses";
import { refuseUnlessFreshAdmin } from "@/app/appAuth/freshAdmin";
import { operationalClient } from "@/sanity/lib/operationalClient";
import { isCanonicalDocumentId } from "@/app/utils/roleWriteRequest";
import { serviceThreadId, type ConversationRead } from "@/app/utils/serviceThread";
import { serviceConversationQuery } from "@/app/utils/serviceReadQueries";
import { buildAppServiceMessages } from "@/app/utils/appServiceMessages";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function GET(request: Request, { params }: { params: Promise<{ roleId: string }> }): Promise<Response> {
  const auth = await requireAppSession(request, { needs: "manager" });
  if (!auth.ok) return auth.response;
  if (auth.session.access.role === "content-editor") return appForbiddenResponse();
  const me = auth.session.sanityId;

  const { roleId } = await params;
  const threadId = serviceThreadId(roleId);
  if (!isCanonicalDocumentId(roleId) || !threadId) return jsonNoStore({ error: "not_found" }, 404);

  const refused = await refuseUnlessFreshAdmin(me);
  if (refused) return refused;

  let read: ConversationRead | null;
  try {
    const bound = serviceConversationQuery(roleId, threadId);
    read = await operationalClient.fetch<ConversationRead | null>(bound.query, bound.params);
  } catch {
    return appUnavailableResponse();
  }
  const answer = read?.service ? buildAppServiceMessages(read, me) : null;
  if (!answer) return jsonNoStore({ error: "not_found" }, 404);
  return jsonNoStore(answer);
}
