// The native app's admin doors (A-W1, A-W2): after `requireAppSession(request, { needs: "manager" })`
// and its content-editor check, ONE fresh access read decides again, because the token's level is
// up to 30 seconds old. Not active → 401 `account_disabled`; no longer a manager, or now a
// content-editor → 403; a failed read → 503. Never a write after any of them.

import { fetchMemberAccessFresh, type MemberAccess } from "@/app/utils/memberAccess";
import { meetsNeeds } from "./levels";
import { appForbiddenResponse, appUnauthorizedResponse, appUnavailableResponse } from "./responses";

/** Null when the caller is still an admin or super-admin; otherwise the response to send. */
export async function refuseUnlessFreshAdmin(memberId: string): Promise<Response | null> {
  let fresh: MemberAccess;
  try {
    fresh = await fetchMemberAccessFresh(memberId);
  } catch {
    return appUnavailableResponse();
  }
  if (!fresh.active) return appUnauthorizedResponse("account_disabled");
  if (!meetsNeeds(fresh, "manager") || fresh.role === "content-editor") return appForbiddenResponse();
  return null;
}
