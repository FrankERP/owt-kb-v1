import { NextRequest, NextResponse } from "next/server";
import { requireActiveManager } from "@/app/utils/authGuards";
import { writeClient } from "@/sanity/lib/serverClient";
import { revalidateServiceViews } from "@/app/utils/revalidate";
import { revalidatePath } from "next/cache";
import { NOTIFY_PREF_FIELD, wantsNotification, type NotifyKind } from "@/app/utils/notifyPrefs";

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
  await writeClient.delete(id);
  revalidateServiceViews();
  revalidatePath("/me");
  return NextResponse.json({ ok: true });
}
