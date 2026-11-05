import { NextRequest, NextResponse } from "next/server";
import { requireActiveManager } from "@/app/utils/authGuards";
import {
  MEMBER_DELETE_ERROR,
  MEMBER_HAS_REFERENCES_MESSAGE,
  MEMBER_POOL_CLEANUP_FAILED_MESSAGE,
  isSanityReferentialIntegrityError,
  solverPoolCleanupPatch,
} from "@/app/utils/memberDelete";
import { revalidateServiceViews } from "@/app/utils/revalidate";
import { sanityConflictKind } from "@/app/utils/roleWriteRequest";
import { SOLVER_CONFIG_DOC_ID } from "@/app/utils/solverConfigWriteRequest";
import { operationalClient } from "@/sanity/lib/operationalClient";
import { writeClient } from "@/sanity/lib/serverClient";
import { revalidatePath } from "next/cache";
import { patchMember } from "@/app/utils/memberCommit";
import { withVerificationRunContext } from "@/app/utils/srVerificationRunContext";

// Wrapped because the module it calls is a `*Commit` (`srVerificationRunContext.test.ts` scans by
// import); a people write sends nothing, and an unmarked request behaves as before.
export const PATCH = withVerificationRunContext(patchHandler);
export const DELETE = withVerificationRunContext(deleteHandler);

/**
 * Edit a person. Everything after authorization is `patchMember` (`app/utils/memberCommit.ts`), which
 * the MCP `save_member_changes` shares: the same validation, plus D5 (a repeated email), D12 (a
 * repeated name or alias) and D6 (a renamed person's solver rules move with them, in one transaction).
 */
async function patchHandler(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await requireActiveManager();
  if (!session) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  // PATCH is super-admin only
  if (session.user.role !== "super-admin") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  const { id } = await params;
  const outcome = await patchMember(id, await req.json(), session.user.sanityId ?? "");
  return NextResponse.json(outcome.body, { status: outcome.status });
}

async function deleteHandler(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await requireActiveManager();
  if (!session) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  // DELETE is super-admin only
  if (session.user.role !== "super-admin") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { id } = await params;

  try {
    await writeClient.delete(id);
  } catch (err) {
    if (isSanityReferentialIntegrityError(err)) {
      return NextResponse.json(
        {
          error: MEMBER_DELETE_ERROR.HAS_REFERENCES,
          message: MEMBER_HAS_REFERENCES_MESSAGE,
          offerRetire: true,
        },
        { status: 409 },
      );
    }
    throw err;
  }

  const stored = await operationalClient.fetch<{
    _rev?: string;
    sundayLeads?: unknown;
    saturdayLeads?: unknown;
    support?: unknown;
  } | null>(
    `*[_id == $docId][0]{ _rev, sundayLeads, saturdayLeads, support }`,
    { docId: SOLVER_CONFIG_DOC_ID },
  );

  if (!stored || typeof stored._rev !== "string") {
    revalidateServiceViews();
    revalidatePath("/me");
    return NextResponse.json({ ok: true });
  }

  const patch = solverPoolCleanupPatch(stored, id);
  if (!patch) {
    revalidateServiceViews();
    revalidatePath("/me");
    return NextResponse.json({ ok: true });
  }

  try {
    await writeClient
      .patch(SOLVER_CONFIG_DOC_ID)
      .ifRevisionId(stored._rev)
      .set(patch)
      .commit();
  } catch (err) {
    const body = {
      error: MEMBER_DELETE_ERROR.POOL_CLEANUP_FAILED,
      message: MEMBER_POOL_CLEANUP_FAILED_MESSAGE,
      deleted: true as const,
      ...(sanityConflictKind(err) ? { kind: "stale_revision" as const } : {}),
    };
    return NextResponse.json(body, { status: 409 });
  }

  revalidateServiceViews();
  revalidatePath("/me");
  return NextResponse.json({ ok: true });
}
