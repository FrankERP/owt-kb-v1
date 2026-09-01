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
import { NOTIFY_PREF_FIELD, wantsNotification, type NotifyKind } from "@/app/utils/notifyPrefs";
import { validateMinistryWrite } from "@/app/ministries";

const EMAIL_KINDS = Object.keys(NOTIFY_PREF_FIELD) as NotifyKind[];

export async function PATCH(
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
  const body = await req.json() as {
    member_name?: string;
    alias?: string;
    email?: string;
    role?: string;
    memberType?: string[];
    ministries?: string[];
    managesMinistries?: string[];
    // Legacy fallback field. No UI writes it any more (§5 of the notification
    // design takes it out of both panels); it stays accepted because it is what
    // an unset per-type field falls back to.
    notifEmail?: boolean;
    emailAssigned?: boolean;
    emailRemoved?: boolean;
    emailRoleChanged?: boolean;
    emailSetlist?: boolean;
    emailProposals?: boolean;
  };

  const VALID_ROLES = ["super-admin", "admin", "content-editor", "member"];
  const VALID_MEMBER_TYPES = ["voz", "instrumento", "foh", "sunday_lead", "saturday_lead", "support"];

  if (body.role !== undefined && !VALID_ROLES.includes(body.role)) {
    return NextResponse.json({ error: "Invalid role" }, { status: 400 });
  }

  const patch: Record<string, unknown> = {};
  if (body.member_name?.trim()) patch.member_name = body.member_name.trim();
  if (typeof body.alias === "string") patch.alias = body.alias.trim();
  if (body.email?.trim()) patch.email = body.email.trim().toLowerCase();
  if (body.role) patch.role = body.role;
  // Keep only recognised member types (drops unknown values rather than storing them).
  if (Array.isArray(body.memberType)) patch.memberType = body.memberType.filter(t => VALID_MEMBER_TYPES.includes(t));

  // Ministry membership/management. The guard is `!== undefined`, so a body that
  // never mentions a field leaves the stored value ALONE — the form sends only
  // what the admin touched, and an unconditional write here would let an
  // unrelated typo fix hand a kids-only volunteer the whole worship catalog
  // (`ministries: []` reads back as `["worship"]`) and wipe a Kids leader's
  // management. Must stay ABOVE the "Nothing to update" check, or a
  // ministries-only PATCH 400s as an empty update.
  for (const field of ["ministries", "managesMinistries"] as const) {
    if (body[field] === undefined) continue;
    const error = validateMinistryWrite(field, body[field]);
    if (error) return NextResponse.json({ error }, { status: 400 });
    patch[field] = body[field];
  }

  // The five per-type email toggles, keyed off the same map every sender uses.
  const notifPatch: Record<string, unknown> = {};
  if (typeof body.notifEmail === "boolean") notifPatch["notifPrefs.email"] = body.notifEmail;
  for (const kind of EMAIL_KINDS) {
    const field = NOTIFY_PREF_FIELD[kind];
    const value = (body as Record<string, unknown>)[field];
    if (typeof value === "boolean") notifPatch[`notifPrefs.${field}`] = value;
  }

  if (Object.keys(patch).length === 0 && Object.keys(notifPatch).length === 0) {
    return NextResponse.json({ error: "Nothing to update" }, { status: 400 });
  }

  let mutation = writeClient.patch(id).set(patch);
  if (Object.keys(notifPatch).length > 0) {
    mutation = mutation.setIfMissing({ notifPrefs: {} }).set(notifPatch);
  }
  const doc = await mutation.commit();
  // A renamed member's name/alias surfaces on ISR schedule/home/me views.
  revalidateServiceViews();
  revalidatePath("/me");
  // `emailPrefs` is RESOLVED through the shared resolver, never the raw fields:
  // with no data migration the five are unset for anyone who opted out of the
  // legacy `email`, and an unset boolean would render as its `true` default —
  // five switches ON for a member receiving nothing.
  const p = (doc as { notifPrefs?: Record<string, unknown> }).notifPrefs ?? {};
  const emailPrefs = Object.fromEntries(
    EMAIL_KINDS.map((kind) => [NOTIFY_PREF_FIELD[kind], wantsNotification(p, kind)]),
  );
  return NextResponse.json({ ...doc, emailPrefs });
}

export async function DELETE(
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
