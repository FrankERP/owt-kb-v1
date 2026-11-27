// POST /api/app/v1/admin/proposal-messages/[proposalId] — an admin writes in a setlist proposal's
// private thread from the native app (A-W1 spec D3.3,
// `docs/superpowers/specs/2026-11-27-native-admin-proposal-review-design.md`). The app's door to the
// SAME writer `/admin`'s `POST /api/admin/proposals/[id]/messages` calls
// (`postAdminProposalMessage`): the body contract, the open-thread rule, the cap, the append
// without `ifRevisionId` and the lead push are the writer's, unchanged. This handler adds only the
// app's own checks, as the decision door does:
//
//  1. `requireAppSession` (a manager), and not a content-editor — the web's rule exactly;
//  2. a malformed id is 404 before any read;
//  3. a FRESH access read: not active → 401 `account_disabled`, no longer a manager or now a
//     content-editor → 403, a failed read → 503, never a write;
//  4. any throw from the writer answers 503;
//  5. a success goes out as `appMessageAnswer` (the thread as names and `mine`, never a member id);
//     a refusal as `appRefusal`.
//
// The answer's `rev` is read AFTER the append, which asserts no revision: the app must never adopt
// it as the revision it decides on (spec D4). Wrapped in `withVerificationRunContext` because the
// writer sends a push; `appAuthStatic.test.ts` accepts exactly this wrapped form.

import { requireAppSession } from "@/app/appAuth/requireAppSession";
import { appForbiddenResponse, appUnauthorizedResponse, appUnavailableResponse, jsonNoStore } from "@/app/appAuth/responses";
import { meetsNeeds } from "@/app/appAuth/levels";
import { fetchMemberAccessFresh, type MemberAccess } from "@/app/utils/memberAccess";
import { serviceError } from "@/app/utils/serviceMutation";
import { isCanonicalDocumentId } from "@/app/utils/roleWriteRequest";
import { postAdminProposalMessage, type ProposalMessageResult } from "@/app/utils/proposalMessageCommit";
import { withVerificationRunContext } from "@/app/utils/srVerificationRunContext";
import { appMessageAnswer } from "@/app/utils/appProposalEditor";
import { appRefusal } from "@/app/utils/appAdminProposals";

// The writer's post-commit `after()` push to the lead; give it room.
export const maxDuration = 60;
export const dynamic = "force-dynamic";

export const POST = withVerificationRunContext(postHandler);

async function postHandler(request: Request, { params }: { params: Promise<{ proposalId: string }> }): Promise<Response> {
  const auth = await requireAppSession(request, { needs: "manager" });
  if (!auth.ok) return auth.response;
  if (auth.session.access.role === "content-editor") return appForbiddenResponse();
  const adminId = auth.session.sanityId;

  const { proposalId } = await params;
  if (!isCanonicalDocumentId(proposalId)) return jsonNoStore({ error: "not_found" }, 404);

  let fresh: MemberAccess;
  try {
    fresh = await fetchMemberAccessFresh(adminId);
  } catch {
    return appUnavailableResponse();
  }
  if (!fresh.active) return appUnauthorizedResponse("account_disabled");
  if (!meetsNeeds(fresh, "manager") || fresh.role === "content-editor") return appForbiddenResponse();

  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    const res = serviceError("invalid_request", { details: { issues: ["json"] } });
    return jsonNoStore({ error: res.body.error, conflict: res.body.conflict, details: { issues: ["json"] } }, res.status);
  }

  let result: ProposalMessageResult;
  try {
    result = await postAdminProposalMessage({ adminId, proposalId, raw });
  } catch (err) {
    console.error("[app/v1/admin/proposal-messages] post failed", err instanceof Error ? err.name : "unknown");
    return appUnavailableResponse();
  }
  const answer = result.status >= 200 && result.status < 300 ? appMessageAnswer(result, adminId) : appRefusal(result);
  return jsonNoStore(answer.body, answer.status);
}
