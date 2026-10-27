import { NextRequest, NextResponse } from "next/server";

import { requireActiveManager } from "@/app/utils/authGuards";
import { serviceError } from "@/app/utils/serviceMutation";
import {
  deleteServiceThreadMessage,
  editServiceThreadMessage,
} from "@/app/utils/serviceThreadCommit";
import { withVerificationRunContext } from "@/app/utils/srVerificationRunContext";

function reject(res: { status: number; body: unknown }) {
  return NextResponse.json(res.body, { status: res.status });
}

type Params = { params: Promise<{ roleId: string; key: string }> };

// Declared BEFORE the handlers: `protectedReadAudit` treats `export const X =` as
// the start of that method's region.
// Wrapped because the module they call can deliver (`srVerificationRunContext.test.ts`
// scans by import); these two send nothing, and an unmarked request behaves as before.
export const PATCH = withVerificationRunContext(patchHandler);
export const DELETE = withVerificationRunContext(deleteHandler);

/**
 * Edit (PATCH `{ body }`) or delete (DELETE) ONE message an admin wrote in a
 * service thread (ADR-0065, amended 2026-10-24). Only its AUTHOR may. Everything
 * after authorization is `editServiceThreadMessage` / `deleteServiceThreadMessage`
 * (`app/utils/serviceThreadCommit.ts`), which the MCP tools call too; the author
 * rule, the open-thread rule and their reasons live there.
 */
async function managerId(): Promise<{ id: string | null } | null> {
  const session = await requireActiveManager();
  if (!session || session.user.role === "content-editor") return null;
  return { id: session.user.sanityId ?? null };
}

const FORBIDDEN = () => NextResponse.json({ error: "Forbidden" }, { status: 403 });

async function patchHandler(req: NextRequest, { params }: Params) {
  const { roleId, key } = await params;
  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    return reject(serviceError("invalid_request", { details: { issues: ["json"] } }));
  }
  const actor = await managerId();
  if (!actor) return FORBIDDEN();
  const outcome = await editServiceThreadMessage(roleId, key, raw, actor);
  return NextResponse.json(outcome.body, { status: outcome.status });
}

async function deleteHandler(_req: NextRequest, { params }: Params) {
  const { roleId, key } = await params;
  const actor = await managerId();
  if (!actor) return FORBIDDEN();
  const outcome = await deleteServiceThreadMessage(roleId, key, actor);
  return NextResponse.json(outcome.body, { status: outcome.status });
}
