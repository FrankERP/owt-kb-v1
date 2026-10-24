import { NextRequest, NextResponse } from "next/server";

import { requireActiveManager } from "@/app/utils/authGuards";
import { writeClient } from "@/sanity/lib/serverClient";
import { operationalClient } from "@/sanity/lib/operationalClient";
import { serviceError } from "@/app/utils/serviceMutation";
import { isCanonicalDocumentId } from "@/app/utils/roleWriteRequest";
import { loadCanonicalRole, nowIso } from "@/app/utils/roleWriteOps";
import { targetFromCanonicalRole } from "@/app/utils/proposalWriteRequest";
import { isThreadOpen } from "@/app/utils/proposalThread";
import type { ThreadMessageRow } from "@/app/utils/proposalMessageRead";
import {
  SERVICE_THREAD_BY_ID_QUERY,
  SERVICE_THREAD_TYPE,
  serviceThreadId,
} from "@/app/utils/serviceThread";
import { isMessageKey, parseMessageEdit } from "@/app/utils/serviceMessageEdit";

function reject(res: { status: number; body: unknown }) {
  return NextResponse.json(res.body, { status: res.status });
}

type Params = { params: Promise<{ roleId: string; key: string }> };

// Declared BEFORE the handlers: `protectedReadAudit` treats `export const X =` as
// the start of that method's region.
export const PATCH = patchHandler;
export const DELETE = deleteHandler;

/**
 * Edit (PATCH `{ body }`) or delete (DELETE) ONE message an admin wrote in a
 * service thread (ADR-0065, amended 2026-10-24). Only its AUTHOR may, checked
 * here against the stored `author` reference — an admin cannot rewrite what
 * another admin said, and nobody edits a lead's words (those live on the
 * proposal, which this never touches).
 *
 * Both write ONE path, `messages[_key=="<key>"]`, with no `ifRevisionId`: the
 * author of a stored message never changes, so the check above cannot go stale,
 * and asserting the thread's `_rev` would refuse an edit whenever anyone appended
 * meanwhile. A message deleted in between makes the edit a no-op, not an error.
 * An edit stamps `edited_at` («editado»); neither notifies anyone.
 *
 * Only while the conversation is open (`isThreadOpen`, as on the POST): once the
 * service has passed, what was said is the record of it.
 */
async function authorize(
  roleId: string,
  key: string,
): Promise<{ error: NextResponse; threadId?: never } | { error?: never; threadId: string }> {
  const session = await requireActiveManager();
  if (!session || session.user.role === "content-editor") {
    return { error: NextResponse.json({ error: "Forbidden" }, { status: 403 }) };
  }
  const threadId = serviceThreadId(roleId);
  if (!isCanonicalDocumentId(roleId) || !threadId || !isMessageKey(key)) {
    return { error: reject(serviceError("invalid_request", { details: { issues: ["roleId", "key"] } })) };
  }
  const lookup = await loadCanonicalRole(roleId);
  const target = lookup.state === "single" && lookup.role ? targetFromCanonicalRole(lookup.role) : null;
  if (!target) return { error: reject(serviceError("not_found", { details: { roleId } })) };
  if (!isThreadOpen({ serviceDate: target.serviceDate })) {
    return { error: reject(serviceError("invalid_request", { details: { issues: ["thread_closed"] } })) };
  }
  const message = await operationalClient.fetch<{ author?: string | null } | null>(
    `*[_type == "${SERVICE_THREAD_TYPE}" && _id == $threadId][0].messages[_key == $key][0]{ "author": author._ref }`,
    { threadId, key },
  );
  if (!message) return { error: reject(serviceError("not_found", { details: { key } })) };
  const me = session.user.sanityId ?? null;
  if (!me || message.author !== me) {
    return { error: NextResponse.json({ error: "Forbidden", code: "not_author" }, { status: 403 }) };
  }
  return { threadId };
}

async function respond(threadId: string) {
  // Guarded read-back, as on the POST: `messages: null` = keep what you show.
  try {
    const fresh = await operationalClient.fetch<{ messages?: ThreadMessageRow[] | null } | null>(
      SERVICE_THREAD_BY_ID_QUERY,
      { threadId },
    );
    return NextResponse.json({ ok: true, messages: fresh?.messages ?? [] });
  } catch (err) {
    console.error("[serviceThread] post-commit read failed:", err);
    return NextResponse.json({ ok: true, messages: null });
  }
}

async function patchHandler(req: NextRequest, { params }: Params) {
  const { roleId, key } = await params;
  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    return reject(serviceError("invalid_request", { details: { issues: ["json"] } }));
  }
  const parsed = parseMessageEdit(raw);
  if (!parsed.ok) return reject(serviceError("invalid_request", { details: { issues: parsed.issues } }));

  const auth = await authorize(roleId, key);
  if (auth.error) return auth.error;
  const path = `messages[_key=="${key}"]`;
  await writeClient
    .patch(auth.threadId)
    .set({ [`${path}.body`]: parsed.value.body, [`${path}.edited_at`]: nowIso() })
    .commit();
  return respond(auth.threadId);
}

async function deleteHandler(_req: NextRequest, { params }: Params) {
  const { roleId, key } = await params;
  const auth = await authorize(roleId, key);
  if (auth.error) return auth.error;
  await writeClient.patch(auth.threadId).unset([`messages[_key=="${key}"]`]).commit();
  return respond(auth.threadId);
}
