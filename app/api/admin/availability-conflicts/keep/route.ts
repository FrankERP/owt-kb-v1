import { NextRequest, NextResponse } from "next/server";
import { setConflictKept } from "@/app/utils/availabilityFixCommit";
import { withVerificationRunContext } from "@/app/utils/srVerificationRunContext";
import { conflictAdmin } from "../guard";

export const maxDuration = 60;

const TYPES = ["sunday_role", "saturday_role", "special_role"] as const;
const DAY = /^\d{4}-\d{2}-\d{2}$/;
const str = (v: unknown): v is string => typeof v === "string" && v.length > 0;

/**
 * «Mantener» (`kept: true`) and «Deshacer» (`kept: false`) on one conflict (ADR-0079). A kept
 * conflict is never proposed or emailed again while it lasts.
 */
export const POST = withVerificationRunContext(postHandler);

async function postHandler(req: NextRequest) {
  const guard = await conflictAdmin();
  if (!guard.ok) return guard.response;
  const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  if (!body || !str(body.roleId) || !str(body.memberId) || !str(body.date) || !DAY.test(body.date) || typeof body.kept !== "boolean"
    || !TYPES.includes(body.serviceKind as (typeof TYPES)[number]) || typeof body.published !== "boolean" || (body.rev !== undefined && !str(body.rev))) {
    return NextResponse.json({ error: "invalid_request" }, { status: 400 });
  }
  const out = await setConflictKept({
    roleId: body.roleId,
    memberId: body.memberId,
    date: body.date,
    serviceKind: body.serviceKind as (typeof TYPES)[number],
    published: body.published,
    kept: body.kept,
    actor: guard.memberId,
    ...(typeof body.rev === "string" ? { rev: body.rev } : {}),
  });
  return NextResponse.json(out.body, { status: out.status });
}
