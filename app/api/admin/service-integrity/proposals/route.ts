import { NextResponse } from "next/server";
import { requireActiveManager } from "@/app/utils/authGuards";
import { operationalClient, rawIntegrityClient } from "@/sanity/lib/operationalClient";
import {
  canonicalProposalsQuery,
  canonicalRolesQuery,
  rawProposalDraftsQuery,
} from "@/app/utils/serviceReadQueries";
import { buildProposalSummary } from "@/app/utils/serviceReadSummary";

// GET /api/admin/service-integrity/proposals
// Read-only proposal integrity summary. Each proposal's `service_ref` is
// resolved to a canonical role (published perspective) so grouping validity and
// both indexes (by service ref, by target key) can be computed. Restricted to
// admin and super-admin (not content-editor).
export async function GET() {
  const session = await requireActiveManager();
  if (!session) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  if (session.user.role === "content-editor") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  try {
    const proposalsQ = canonicalProposalsQuery();
    const draftsQ = rawProposalDraftsQuery();
    const rolesQ = canonicalRolesQuery();
    const [canonicalProposals, rawProposalDrafts, canonicalRoles] = await Promise.all([
      operationalClient.fetch<unknown[]>(proposalsQ.query, proposalsQ.params),
      rawIntegrityClient.fetch<unknown[]>(draftsQ.query, draftsQ.params),
      operationalClient.fetch<unknown[]>(rolesQ.query, rolesQ.params),
    ]);

    const rolesById = new Map<string, unknown>();
    for (const r of canonicalRoles ?? []) {
      if (r && typeof r === "object") {
        const id = (r as Record<string, unknown>)._id;
        if (typeof id === "string" && id) rolesById.set(id, r);
      }
    }

    const summary = buildProposalSummary(
      canonicalProposals ?? [],
      rawProposalDrafts ?? [],
      (serviceRef) => rolesById.get(serviceRef) ?? null,
    );
    return NextResponse.json(summary);
  } catch (err) {
    console.error("[service-integrity/proposals] read failed:", err);
    return NextResponse.json({ error: "Integrity read failed" }, { status: 500 });
  }
}
