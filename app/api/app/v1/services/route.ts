// GET /api/app/v1/services — the native app's «Próximos servicios» (ADR-0091): the worship
// services from today (CDMX) through the Calendario's 95-day window, with the team, the setlist
// and the pastor's message, and the caller's own seats decided by member id
// (`app/utils/appServices.ts` holds the read and its rules).

import { requireAppSession } from "@/app/appAuth/requireAppSession";
import { appUnavailableResponse, jsonNoStore } from "@/app/appAuth/responses";
import { operationalClient } from "@/sanity/lib/operationalClient";
import { APP_SERVICES_QUERY, appServicesWindow, buildAppServices, type AppServicesRows } from "@/app/utils/appServices";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function GET(request: Request): Promise<Response> {
  const auth = await requireAppSession(request, { needs: { ministry: "worship", as: "member" } });
  if (!auth.ok) return auth.response;

  const today = new Date().toLocaleDateString("sv", { timeZone: "America/Mexico_City" });
  const { from, to } = appServicesWindow(today);

  let rows: AppServicesRows;
  try {
    // Published perspective: a `drafts.*` overlay is never a member's service.
    rows = await operationalClient.fetch<AppServicesRows>(APP_SERVICES_QUERY, { from, to });
  } catch {
    return appUnavailableResponse();
  }

  return jsonNoStore({ today, services: buildAppServices(rows ?? {}, auth.session.sanityId) });
}
