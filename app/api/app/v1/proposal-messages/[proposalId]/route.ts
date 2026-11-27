// POST /api/app/v1/proposal-messages/[proposalId] — a Lead writes in a saved proposal's private
// thread from the native app (ADR-0091 W1b; spec
// `docs/superpowers/specs/2026-11-27-native-proposal-message-design.md`). The app's door to the SAME
// writer the web's `POST /api/me/proposals/[id]/messages` calls: the body contract, the
// Lead-of-this-published-service check on the canonical proposal, the open-thread rule, the
// append without `ifRevisionId` and the notices are the writer's, unchanged. This handler adds
// only the app's own checks, as the W1 save door does (`app/api/app/v1/proposals/route.ts`):
//
//  1. `requireAppSession` (token, grant, cached access, worship member);
//  2. a malformed id is 404 before any read;
//  3. a FRESH access read, because this is a write: not active → 401 `account_disabled`, no longer
//     a worship member → 403, a failed read → 503, never a write;
//  4. the author's name for the approved-proposal push: ONE guarded live read, `""` on failure
//     (the push's nameless wording) — cosmetic, it never blocks the message;
//  5. any throw from the writer answers 503, never a bare 500;
//  6. a success goes out as `appMessageAnswer`: the thread as names and `mine`, never a member id.
//
// Wrapped in `withVerificationRunContext` because the writer can send email and push (the
// SR-verification scan); `appAuthStatic.test.ts` accepts exactly this wrapped form.

import { requireAppSession } from "@/app/appAuth/requireAppSession";
import { appForbiddenResponse, appUnauthorizedResponse, appUnavailableResponse, jsonNoStore } from "@/app/appAuth/responses";
import { meetsNeeds } from "@/app/appAuth/levels";
import { fetchMemberAccessFresh, type MemberAccess } from "@/app/utils/memberAccess";
import { serviceError } from "@/app/utils/serviceMutation";
import { isCanonicalDocumentId } from "@/app/utils/roleWriteRequest";
import { postProposalMessage, type ProposalMessageResult } from "@/app/utils/proposalMessageCommit";
import { withVerificationRunContext } from "@/app/utils/srVerificationRunContext";
import { appMessageAnswer } from "@/app/utils/appProposalEditor";
import { serverClient } from "@/sanity/lib/serverClient";

// The writer's post-commit `after()` fan-out queues the debounced lead-notes notice; give it room.
export const maxDuration = 60;
export const dynamic = "force-dynamic";

/** The same projection the app door's sign-in page reads (`app/(appauth)/app/authorize/page.tsx`). */
const AUTHOR_NAME_QUERY = `*[_type == "teamMembers" && _id == $id][0]{ "name": coalesce(alias, member_name) }`;

async function authorNameOf(memberId: string): Promise<string> {
  try {
    const row = await serverClient.fetch<{ name?: unknown } | null>(AUTHOR_NAME_QUERY, { id: memberId });
    return typeof row?.name === "string" ? row.name.trim() : "";
  } catch {
    return "";
  }
}

async function postHandler(request: Request, { params }: { params: Promise<{ proposalId: string }> }): Promise<Response> {
  const auth = await requireAppSession(request, { needs: { ministry: "worship", as: "member" } });
  if (!auth.ok) return auth.response;
  const leadId = auth.session.sanityId;

  const { proposalId } = await params;
  if (!isCanonicalDocumentId(proposalId)) return jsonNoStore({ error: "not_found" }, 404);

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

  const authorName = await authorNameOf(leadId);

  let result: ProposalMessageResult;
  try {
    result = await postProposalMessage({ leadId, authorName, proposalId, raw });
  } catch (err) {
    console.error("[app/v1/proposal-messages] post failed", err instanceof Error ? err.name : "unknown");
    return appUnavailableResponse();
  }
  const answer = appMessageAnswer(result, leadId);
  return jsonNoStore(answer.body, answer.status);
}

export const POST = withVerificationRunContext(postHandler);
