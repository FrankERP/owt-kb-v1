// POST /api/app/v1/proposals — a Lead saves the shared setlist proposal of a service from the native
// app (ADR-0091 W1, spec D2). The app's door to the SAME writer the web's `POST /api/me/proposals`
// calls: the body contract, the canonical-role authorization, the concurrency rules and the
// notifications are the writer's, unchanged. This handler adds only the app's own checks:
//
//  1. `requireAppSession` (token, grant, cached access, worship member);
//  2. a FRESH access read, because this is a write (ADR-0091: writers re-read). Not active → the
//     door's 401 `account_disabled` (the app signs out, as on every endpoint); no longer a worship
//     member → 403; a failed read → 503, never a write. The grant itself rides the 30 s cache;
//  3. any throw from the writer (a failed read before the commit, a non-conflict commit error)
//     answers the door's 503, never a bare 500;
//  4. a success's thread rows go out as the editor read's messages (`appSaveAnswer`): a name and
//     `mine`, never the author's member id.
//
// Wrapped in `withVerificationRunContext` because the writer can send email (the SR-verification
// scan); `appAuthStatic.test.ts` accepts exactly this wrapped form.

import { requireAppSession } from "@/app/appAuth/requireAppSession";
import { appForbiddenResponse, appUnauthorizedResponse, appUnavailableResponse, jsonNoStore } from "@/app/appAuth/responses";
import { meetsNeeds } from "@/app/appAuth/levels";
import { fetchMemberAccessFresh, type MemberAccess } from "@/app/utils/memberAccess";
import { serviceError } from "@/app/utils/serviceMutation";
import { saveProposal, type ProposalSaveResult } from "@/app/utils/proposalSaveCommit";
import { withVerificationRunContext } from "@/app/utils/srVerificationRunContext";
import { appSaveAnswer } from "@/app/utils/appProposalEditor";

// The post-commit `after()` fan-out queues the debounced lead-notes notice; give it room to finish.
export const maxDuration = 60;
export const dynamic = "force-dynamic";

async function postHandler(request: Request): Promise<Response> {
  const auth = await requireAppSession(request, { needs: { ministry: "worship", as: "member" } });
  if (!auth.ok) return auth.response;
  const leadId = auth.session.sanityId;

  let fresh: MemberAccess;
  try {
    fresh = await fetchMemberAccessFresh(leadId);
  } catch {
    return appUnavailableResponse();
  }
  if (!fresh.active) return appUnauthorizedResponse("account_disabled");
  if (!meetsNeeds(fresh, { ministry: "worship", as: "member" })) return appForbiddenResponse();

  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    const invalid = serviceError("invalid_request", { details: { issues: ["json"] } });
    return jsonNoStore(invalid.body, invalid.status);
  }

  let result: ProposalSaveResult;
  try {
    result = await saveProposal({ leadId, raw });
  } catch (err) {
    console.error("[app/v1/proposals] save failed", err instanceof Error ? err.name : "unknown");
    return appUnavailableResponse();
  }
  // The writer's success body carries raw thread rows (author member ids): mapped, as on the read.
  const answer = appSaveAnswer(result, leadId);
  return jsonNoStore(answer.body, answer.status);
}

export const POST = withVerificationRunContext(postHandler);
