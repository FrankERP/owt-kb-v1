import { NextRequest, NextResponse } from "next/server";
import { applyAvailabilityFix } from "@/app/utils/availabilityFixCommit";
import { withVerificationRunContext } from "@/app/utils/srVerificationRunContext";
import { conflictAdmin } from "../guard";

export const maxDuration = 60;

interface ApplyBody {
  roleId?: unknown;
  rev?: unknown;
  memberId?: unknown;
  replacements?: unknown;
}

const str = (v: unknown): v is string => typeof v === "string" && v.length > 0;

/**
 * «Aplicar» / «Elegir otro» (ADR-0079): the chosen replacement for EVERY seat the person holds
 * (`to: null` leaves an instrument or FOH seat empty; the writer refuses it on a voice seat),
 * judged again on a fresh read, then written through `/admin`'s own edit writer. The handler
 * authorizes and parses only; the rest is `applyAvailabilityFix`.
 */
export const POST = withVerificationRunContext(postHandler);

async function postHandler(req: NextRequest) {
  const guard = await conflictAdmin();
  if (!guard.ok) return guard.response;
  const body = (await req.json().catch(() => null)) as ApplyBody | null;
  const replacements = Array.isArray(body?.replacements) ? body.replacements : null;
  if (!body || !str(body.roleId) || !str(body.rev) || !str(body.memberId) || !replacements
    || !replacements.every((r) => r && str((r as { rowId?: unknown }).rowId) && (str((r as { to?: unknown }).to) || (r as { to?: unknown }).to === null))) {
    return NextResponse.json({ error: "invalid_request" }, { status: 400 });
  }
  const out = await applyAvailabilityFix({
    roleId: body.roleId,
    rev: body.rev,
    memberId: body.memberId,
    replacements: replacements as Array<{ rowId: string; to: string | null }>,
    actor: guard.memberId,
  });
  return NextResponse.json(out.body, { status: out.status });
}
