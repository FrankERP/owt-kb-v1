// PATCH /api/app/v1/admin/proposals/[proposalId] — an admin decides on a setlist proposal from the
// native app (A-W1 spec D3.2, `docs/superpowers/specs/2026-11-27-native-admin-proposal-review-design.md`).
// The app's door to the SAME writer `/admin`'s `PATCH /api/admin/proposals/[id]` and the MCP
// proposal tools call (`reviewProposal`): the reviewed `rev` asserted, the receipt and
// last-transition replays, the weekend lock, the publish, the notices and the pastor's-message copy
// are the writer's, unchanged. This handler adds only the app's own checks:
//
//  1. `requireAppSession` (token, grant, cached access, a manager), and not a content-editor —
//     the web's rule exactly, with no ministry check (FrankERP/owt-kb-v1#8);
//  2. a malformed id is 404 before any read;
//  3. a FRESH access read, because this is a write: not active → 401 `account_disabled`, no longer
//     a manager or now a content-editor → 403, a failed read → 503, never a write;
//  4. only the three actions `/admin` offers (`approve`, `request_changes`, `reopen`) reach the
//     writer; `reconcile_target` is metadata repair the panel never sends, kept on the web and MCP;
//  5. any throw from the writer answers 503, never a bare 500;
//  6. the answer goes out through `appReviewAnswer`: a refusal reduced to code, conflict and issues.
//
// Wrapped in `withVerificationRunContext` because the writer can send email and push (the
// SR-verification scan); `appAuthStatic.test.ts` accepts exactly this wrapped form.

import { requireAppSession } from "@/app/appAuth/requireAppSession";
import { appForbiddenResponse, appUnauthorizedResponse, appUnavailableResponse, jsonNoStore } from "@/app/appAuth/responses";
import { meetsNeeds } from "@/app/appAuth/levels";
import { fetchMemberAccessFresh, type MemberAccess } from "@/app/utils/memberAccess";
import { serviceError } from "@/app/utils/serviceMutation";
import { isCanonicalDocumentId } from "@/app/utils/roleWriteRequest";
import { reviewProposal } from "@/app/utils/proposalReviewCommit";
import { withVerificationRunContext } from "@/app/utils/srVerificationRunContext";
import { appReviewAnswer } from "@/app/utils/appAdminProposals";

// The writer's post-commit `after()` fan-out queues the debounced setlist notice; give it room.
export const maxDuration = 60;
export const dynamic = "force-dynamic";

/** What `/admin`'s «Propuestas» can send. */
const APP_ACTIONS = new Set(["approve", "request_changes", "reopen"]);

function invalid(issue: string): Response {
  const res = serviceError("invalid_request", { details: { issues: [issue] } });
  return jsonNoStore({ error: res.body.error, conflict: res.body.conflict, details: { issues: [issue] } }, res.status);
}

export const PATCH = withVerificationRunContext(patchHandler);

async function patchHandler(request: Request, { params }: { params: Promise<{ proposalId: string }> }): Promise<Response> {
  const auth = await requireAppSession(request, { needs: "manager" });
  if (!auth.ok) return auth.response;
  if (auth.session.access.role === "content-editor") return appForbiddenResponse();
  const reviewerId = auth.session.sanityId;

  const { proposalId } = await params;
  if (!isCanonicalDocumentId(proposalId)) return jsonNoStore({ error: "not_found" }, 404);

  let fresh: MemberAccess;
  try {
    fresh = await fetchMemberAccessFresh(reviewerId);
  } catch {
    return appUnavailableResponse();
  }
  if (!fresh.active) return appUnauthorizedResponse("account_disabled");
  if (!meetsNeeds(fresh, "manager") || fresh.role === "content-editor") return appForbiddenResponse();

  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    return invalid("json");
  }
  const action = (raw as { action?: unknown } | null)?.action;
  if (typeof action !== "string" || !APP_ACTIONS.has(action)) return invalid("action");

  let answer: { status: number; body: unknown };
  try {
    answer = appReviewAnswer(await reviewProposal(proposalId, raw, { reviewerId }));
  } catch (err) {
    console.error("[app/v1/admin/proposals] decision failed", err instanceof Error ? err.name : "unknown");
    return appUnavailableResponse();
  }
  return jsonNoStore(answer.body, answer.status);
}
