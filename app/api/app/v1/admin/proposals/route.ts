// GET /api/app/v1/admin/proposals — an admin's setlist proposals on the native app (A-W1 spec D3.1,
// `docs/superpowers/specs/2026-11-27-native-admin-proposal-review-design.md`): the review queue
// whatever its date, plus every other proposal whose service is today or later in CDMX, through the
// same projection `/admin`'s «Propuestas» reads (`adminProposalsRead.ts`).
//
// Who may read it is the web's rule exactly: an active manager who is not a content-editor (admin
// or super-admin), with no ministry check (inherited deliberately, FrankERP/owt-kb-v1#8). The
// answer names people, never their member ids (`appAdminProposals.ts`).

import { requireAppSession } from "@/app/appAuth/requireAppSession";
import { appForbiddenResponse, appUnavailableResponse, jsonNoStore } from "@/app/appAuth/responses";
import { readAdminProposalsForApp, type AdminProposalRow } from "@/app/utils/adminProposalsRead";
import { buildAppAdminProposals } from "@/app/utils/appAdminProposals";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function GET(request: Request): Promise<Response> {
  const auth = await requireAppSession(request, { needs: "manager" });
  if (!auth.ok) return auth.response;
  if (auth.session.access.role === "content-editor") return appForbiddenResponse();

  const me = auth.session.sanityId;
  const today = new Date().toLocaleDateString("sv", { timeZone: "America/Mexico_City" });
  let rows: AdminProposalRow[];
  try {
    rows = await readAdminProposalsForApp(today);
  } catch {
    return appUnavailableResponse();
  }
  return jsonNoStore(buildAppAdminProposals(rows, me, today));
}
