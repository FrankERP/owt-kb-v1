// PUT /api/app/v1/admin/service-threads/[roleId]/pastor-message — an admin sets, edits or clears
// a service's ONE «Mensaje del pastor» from the native app (A-W2 spec D3). The app's door to the
// SAME writer the web's `…/pastor-message` route calls (`setPastorMessage`): the observed-stamp
// rule, the `ifRevisionId` write and «only a message that APPEARS on a published service notifies
// the leads» are the writer's. A resend after a lost answer meets a moved stamp (409) before any
// write or notice, which the app resolves by reading again (D5).
//
// The app's checks (D3.1): `requireAppSession` (a manager), not a content-editor; a malformed id
// is 404 before any read; a fresh access read; the JSON read; a writer throw → 503; a success as
// `appPastorAnswer` (no member id), a refusal as `appRefusal`. Wrapped because the writer sends
// mail.

import { requireAppSession } from "@/app/appAuth/requireAppSession";
import { appForbiddenResponse, appUnavailableResponse, jsonNoStore } from "@/app/appAuth/responses";
import { refuseUnlessFreshAdmin } from "@/app/appAuth/freshAdmin";
import { isCanonicalDocumentId } from "@/app/utils/roleWriteRequest";
import { serviceThreadId } from "@/app/utils/serviceThread";
import { setPastorMessage } from "@/app/utils/serviceThreadCommit";
import { withVerificationRunContext } from "@/app/utils/srVerificationRunContext";
import { appRefusal } from "@/app/utils/appAdminProposals";
import { appPastorAnswer } from "@/app/utils/appServiceMessages";
import { actorNameOf, readJsonBody } from "@/app/utils/appServiceMessagesDoor";

// The writer's post-commit `after()` push and email to the leads; give it room.
export const maxDuration = 60;
export const dynamic = "force-dynamic";

export const PUT = withVerificationRunContext(putHandler);

async function putHandler(request: Request, { params }: { params: Promise<{ roleId: string }> }): Promise<Response> {
  const auth = await requireAppSession(request, { needs: "manager" });
  if (!auth.ok) return auth.response;
  if (auth.session.access.role === "content-editor") return appForbiddenResponse();
  const adminId = auth.session.sanityId;

  const { roleId } = await params;
  if (!isCanonicalDocumentId(roleId) || !serviceThreadId(roleId)) return jsonNoStore({ error: "not_found" }, 404);

  const refused = await refuseUnlessFreshAdmin(adminId);
  if (refused) return refused;

  const body = await readJsonBody(request);
  if ("response" in body) return body.response;

  let result: { status: number; body: unknown };
  let name = "";
  try {
    name = await actorNameOf(adminId);
    result = await setPastorMessage(roleId, body.raw, { id: adminId, name });
  } catch (err) {
    console.error("[app/v1/admin/service-threads] pastor message failed", err instanceof Error ? err.name : "unknown");
    return appUnavailableResponse();
  }
  const answer = result.status >= 200 && result.status < 300 ? appPastorAnswer(result, name) : appRefusal(result);
  return jsonNoStore(answer.body, answer.status);
}
