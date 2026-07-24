import { NextResponse } from "next/server";
import { requireActiveManager } from "@/app/utils/authGuards";
import { operationalClient, rawIntegrityClient } from "@/sanity/lib/operationalClient";
import {
  canonicalRolesQuery,
  canonicalSetlistsQuery,
  rawSetlistDraftsQuery,
} from "@/app/utils/serviceReadQueries";
import { buildSetlistTargets } from "@/app/utils/serviceReadSummary";

// GET /api/admin/service-integrity/setlists
// Read-only setlist integrity summary. Weekend setlists are `featuredSongs` /
// `saturdarSongs` (deliberate typo); special-service songs live embedded on the
// `special_role` doc, so canonical roles are fetched to surface those targets.
// Restricted to admin and super-admin (not content-editor).
export async function GET() {
  const session = await requireActiveManager();
  if (!session) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  if (session.user.role === "content-editor") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  try {
    const setlistsQ = canonicalSetlistsQuery();
    const draftsQ = rawSetlistDraftsQuery();
    const rolesQ = canonicalRolesQuery();
    const [canonicalSetlists, rawSetlistDrafts, canonicalRoles] = await Promise.all([
      operationalClient.fetch<unknown[]>(setlistsQ.query, setlistsQ.params),
      rawIntegrityClient.fetch<unknown[]>(draftsQ.query, draftsQ.params),
      operationalClient.fetch<unknown[]>(rolesQ.query, rolesQ.params),
    ]);

    const specialRolesWithSongs = (canonicalRoles ?? []).filter(
      (r): r is Record<string, unknown> =>
        !!r &&
        typeof r === "object" &&
        (r as Record<string, unknown>)._type === "special_role" &&
        (r as Record<string, unknown>).songs !== undefined,
    );

    const summary = buildSetlistTargets(
      canonicalSetlists ?? [],
      rawSetlistDrafts ?? [],
      specialRolesWithSongs,
    );
    return NextResponse.json(summary);
  } catch (err) {
    console.error("[service-integrity/setlists] read failed:", err);
    return NextResponse.json({ error: "Integrity read failed" }, { status: 500 });
  }
}
