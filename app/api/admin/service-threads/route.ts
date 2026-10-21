import { NextResponse } from "next/server";
import { requireActiveManager } from "@/app/utils/authGuards";
import { operationalClient } from "@/sanity/lib/operationalClient";
import { serviceTodayIso } from "@/app/components/admin/serviceReadiness";
import { servicesWithoutProposalQuery } from "@/app/utils/serviceReadQueries";

/**
 * GET /api/admin/service-threads — the upcoming services that have NO setlist
 * proposal yet, each with its pre-proposal conversation (ADR-0064).
 *
 * The admin Propuestas panel lists proposals only, so a service whose leads have
 * not proposed anything had nowhere to receive a message — what the pastor
 * shared about that Sunday, say. This is that list.
 *
 * The query (and why it sees drafts) lives in `servicesWithoutProposalQuery`,
 * with the rest of the admin read model.
 *
 * No ministry check, like `GET /api/admin/proposals` beside it: a kids-only
 * `admin` can read this list too. Tightening both is FrankERP/owt-kb-v1#8.
 *
 * Loaded only when the admin opens the section (the panel fetches lazily), so a
 * plain visit to Propuestas costs no extra Sanity read.
 */
export async function GET() {
  const session = await requireActiveManager();
  if (!session) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  // Restricted to admin and super-admin (not content-editor), like the proposals list.
  if (session.user.role === "content-editor") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const bound = servicesWithoutProposalQuery(serviceTodayIso());
  const services = await operationalClient.fetch(bound.query, bound.params);

  return NextResponse.json(Array.isArray(services) ? services : []);
}
