// POST /api/app/v1/admin/service-threads/[roleId]/messages — an admin writes to a service's leads
// from the native app (A-W2 spec D3). The app's door to the SAME writer the web's
// `POST /api/admin/service-threads/[roleId]/messages` calls (`postServiceThreadMessage`): the body
// contract, the open-thread rule, the cap, the append with no `ifRevisionId` and the leads' push +
// email are the writer's, unchanged. This handler adds only the app's own checks (D3.1):
//
//  1. `requireAppSession` (a manager), not a content-editor;
//  2. a malformed id is 404 before any read;
//  3. a FRESH access read (401 `account_disabled` / 403 / 503), never a write after a refusal;
//  4. the JSON read (400 `json`);
//  5. any throw from the writer answers 503 — on this door the one answer whose landing is unknown,
//     which the app resolves by reading the thread before it offers a resend (no idempotency);
//  6. a success goes out as `appServiceMessagesAnswer` (the service thread, names and `mine`), a
//     refusal as `appRefusal`.
//
// Wrapped in `withVerificationRunContext` because the writer sends mail; `appAuthStatic.test.ts`
// accepts exactly this wrapped form.

import { requireAppSession } from "@/app/appAuth/requireAppSession";
import { appForbiddenResponse, appUnavailableResponse, jsonNoStore } from "@/app/appAuth/responses";
import { refuseUnlessFreshAdmin } from "@/app/appAuth/freshAdmin";
import { isCanonicalDocumentId } from "@/app/utils/roleWriteRequest";
import { serviceThreadId } from "@/app/utils/serviceThread";
import { postServiceThreadMessage } from "@/app/utils/serviceThreadCommit";
import { withVerificationRunContext } from "@/app/utils/srVerificationRunContext";
import { appRefusal } from "@/app/utils/appAdminProposals";
import { appServiceMessagesAnswer } from "@/app/utils/appServiceMessages";
import { actorNameOf, readJsonBody } from "@/app/utils/appServiceMessagesDoor";

// The writer's post-commit `after()` push and email to the leads; give it room.
export const maxDuration = 60;
export const dynamic = "force-dynamic";

export const POST = withVerificationRunContext(postHandler);

async function postHandler(request: Request, { params }: { params: Promise<{ roleId: string }> }): Promise<Response> {
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
  try {
    const name = await actorNameOf(adminId);
    result = await postServiceThreadMessage(roleId, body.raw, { id: adminId, name });
  } catch (err) {
    console.error("[app/v1/admin/service-threads] post failed", err instanceof Error ? err.name : "unknown");
    return appUnavailableResponse();
  }
  const answer = result.status >= 200 && result.status < 300 ? appServiceMessagesAnswer(result, adminId) : appRefusal(result);
  return jsonNoStore(answer.body, answer.status);
}
