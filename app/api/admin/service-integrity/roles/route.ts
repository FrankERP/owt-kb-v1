import { NextResponse } from "next/server";
import { requireActiveManager } from "@/app/utils/authGuards";
import { operationalClient, rawIntegrityClient } from "@/sanity/lib/operationalClient";
import {
  canonicalMembersByIdsQuery,
  canonicalRolesQuery,
  rawRoleDraftsQuery,
} from "@/app/utils/serviceReadQueries";
import { buildRoleTargets, collectRoleMemberRefs } from "@/app/utils/serviceReadSummary";
import type { CanonicalMember } from "@/app/utils/serviceReadModel";

// GET /api/admin/service-integrity/roles
// Read-only role integrity summary (canonical targets + raw draft evidence).
// Restricted to admin and super-admin (not content-editor); not an access
// expansion — same contract as the existing service-admin routes.
export async function GET() {
  const session = await requireActiveManager();
  if (!session) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  if (session.user.role === "content-editor") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  try {
    const rolesQ = canonicalRolesQuery();
    const draftsQ = rawRoleDraftsQuery();
    const [canonicalRoles, rawRoleDrafts] = await Promise.all([
      operationalClient.fetch<unknown[]>(rolesQ.query, rolesQ.params),
      rawIntegrityClient.fetch<unknown[]>(draftsQ.query, draftsQ.params),
    ]);

    const memberRefs = collectRoleMemberRefs(canonicalRoles);
    const membersById = new Map<string, CanonicalMember>();
    if (memberRefs.length) {
      const membersQ = canonicalMembersByIdsQuery(memberRefs);
      const members = await operationalClient.fetch<CanonicalMember[]>(membersQ.query, membersQ.params);
      for (const m of members ?? []) membersById.set(m._id, m);
    }

    const summary = buildRoleTargets(canonicalRoles, rawRoleDrafts, membersById);
    return NextResponse.json(summary);
  } catch (err) {
    console.error("[service-integrity/roles] read failed:", err);
    return NextResponse.json({ error: "Integrity read failed" }, { status: 500 });
  }
}
