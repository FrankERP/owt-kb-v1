// PATCH / DELETE /api/app/v1/admin/service-threads/[roleId]/messages/[key] — an admin edits or
// deletes ONE message of their own in a service's thread from the native app (A-W2 spec D3). The
// app's door to the SAME writers the web's `…/messages/[key]` route calls
// (`editServiceThreadMessage` / `deleteServiceThreadMessage`): the author rule, the open-thread
// rule and the one-path write are the writers'. Neither notifies anyone, so a resend after a lost
// answer is safe (an edit sets the same body; a second delete is a 404 the app reads as done).
//
// The app's checks (D3.1): `requireAppSession` (a manager), not a content-editor; a malformed id
// or key is 404 before any read; a fresh access read; the JSON read (PATCH); a writer throw → 503;
// a success as `appServiceMessagesAnswer`, a refusal as `appRefusal`.
//
// Wrapped because the module they call can deliver (`srVerificationRunContext.test.ts` scans by
// import), exactly as the web route is; these two send nothing.

import { requireAppSession } from "@/app/appAuth/requireAppSession";
import { appForbiddenResponse, appUnavailableResponse, jsonNoStore } from "@/app/appAuth/responses";
import { refuseUnlessFreshAdmin } from "@/app/appAuth/freshAdmin";
import { isCanonicalDocumentId } from "@/app/utils/roleWriteRequest";
import { serviceThreadId } from "@/app/utils/serviceThread";
import { isMessageKey } from "@/app/utils/serviceMessageEdit";
import { deleteServiceThreadMessage, editServiceThreadMessage } from "@/app/utils/serviceThreadCommit";
import { withVerificationRunContext } from "@/app/utils/srVerificationRunContext";
import { appRefusal } from "@/app/utils/appAdminProposals";
import { appServiceMessagesAnswer } from "@/app/utils/appServiceMessages";
import { readJsonBody } from "@/app/utils/appServiceMessagesDoor";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ roleId: string; key: string }> };

export const PATCH = withVerificationRunContext(patchHandler);
export const DELETE = withVerificationRunContext(deleteHandler);

async function patchHandler(request: Request, { params }: Params): Promise<Response> {
  const auth = await requireAppSession(request, { needs: "manager" });
  if (!auth.ok) return auth.response;
  if (auth.session.access.role === "content-editor") return appForbiddenResponse();
  const adminId = auth.session.sanityId;

  const { roleId, key } = await params;
  if (!isCanonicalDocumentId(roleId) || !serviceThreadId(roleId) || !isMessageKey(key)) {
    return jsonNoStore({ error: "not_found" }, 404);
  }
  const refused = await refuseUnlessFreshAdmin(adminId);
  if (refused) return refused;

  const body = await readJsonBody(request);
  if ("response" in body) return body.response;

  let result: { status: number; body: unknown };
  try {
    result = await editServiceThreadMessage(roleId, key, body.raw, { id: adminId });
  } catch (err) {
    console.error("[app/v1/admin/service-threads] edit failed", err instanceof Error ? err.name : "unknown");
    return appUnavailableResponse();
  }
  const answer = result.status >= 200 && result.status < 300 ? appServiceMessagesAnswer(result, adminId) : appRefusal(result);
  return jsonNoStore(answer.body, answer.status);
}

async function deleteHandler(request: Request, { params }: Params): Promise<Response> {
  const auth = await requireAppSession(request, { needs: "manager" });
  if (!auth.ok) return auth.response;
  if (auth.session.access.role === "content-editor") return appForbiddenResponse();
  const adminId = auth.session.sanityId;

  const { roleId, key } = await params;
  if (!isCanonicalDocumentId(roleId) || !serviceThreadId(roleId) || !isMessageKey(key)) {
    return jsonNoStore({ error: "not_found" }, 404);
  }
  const refused = await refuseUnlessFreshAdmin(adminId);
  if (refused) return refused;

  let result: { status: number; body: unknown };
  try {
    result = await deleteServiceThreadMessage(roleId, key, { id: adminId });
  } catch (err) {
    console.error("[app/v1/admin/service-threads] delete failed", err instanceof Error ? err.name : "unknown");
    return appUnavailableResponse();
  }
  const answer = result.status >= 200 && result.status < 300 ? appServiceMessagesAnswer(result, adminId) : appRefusal(result);
  return jsonNoStore(answer.body, answer.status);
}
