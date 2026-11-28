// PUT /api/app/v1/admin/service-threads/[roleId]/team-notes — an admin edits the «Mensaje para el
// equipo» of a service's LIVE setlist from the native app (A-W2 spec D3). The app's door to the
// SAME writer the web's `…/team-notes` route calls (`saveTeamNotes`): the observed-target rule, the
// one-field write under that `_rev` and «sends nothing» are the writer's. A resend after a lost
// answer meets a moved `_rev` (409), which the app resolves by reading again (D5).
//
// The app's checks (D3.1): `requireAppSession` (a manager), not a content-editor; a malformed id
// is 404 before any read; a fresh access read; the JSON read; a writer throw → 503; a success as
// `appTeamNotesAnswer`, a refusal as `appRefusal`. Wrapped because the module it calls can deliver
// (`srVerificationRunContext.test.ts` scans by import), as the web route is; this writer sends
// nothing.

import { requireAppSession } from "@/app/appAuth/requireAppSession";
import { appForbiddenResponse, appUnavailableResponse, jsonNoStore } from "@/app/appAuth/responses";
import { refuseUnlessFreshAdmin } from "@/app/appAuth/freshAdmin";
import { isCanonicalDocumentId } from "@/app/utils/roleWriteRequest";
import { saveTeamNotes } from "@/app/utils/serviceThreadCommit";
import { withVerificationRunContext } from "@/app/utils/srVerificationRunContext";
import { appRefusal } from "@/app/utils/appAdminProposals";
import { appTeamNotesAnswer } from "@/app/utils/appServiceMessages";
import { readJsonBody } from "@/app/utils/appServiceMessagesDoor";

export const dynamic = "force-dynamic";

export const PUT = withVerificationRunContext(putHandler);

async function putHandler(request: Request, { params }: { params: Promise<{ roleId: string }> }): Promise<Response> {
  const auth = await requireAppSession(request, { needs: "manager" });
  if (!auth.ok) return auth.response;
  if (auth.session.access.role === "content-editor") return appForbiddenResponse();
  const adminId = auth.session.sanityId;

  const { roleId } = await params;
  if (!isCanonicalDocumentId(roleId)) return jsonNoStore({ error: "not_found" }, 404);

  const refused = await refuseUnlessFreshAdmin(adminId);
  if (refused) return refused;

  const body = await readJsonBody(request);
  if ("response" in body) return body.response;

  let result: { status: number; body: unknown };
  try {
    result = await saveTeamNotes(roleId, body.raw);
  } catch (err) {
    console.error("[app/v1/admin/service-threads] team notes failed", err instanceof Error ? err.name : "unknown");
    return appUnavailableResponse();
  }
  const answer = result.status >= 200 && result.status < 300 ? appTeamNotesAnswer(result) : appRefusal(result);
  return jsonNoStore(answer.body, answer.status);
}
