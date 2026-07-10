import { NextRequest, NextResponse } from "next/server";
import { requireActiveManager } from "@/app/utils/authGuards";
import { writeClient } from "@/sanity/lib/serverClient";
import { revalidateServiceViews } from "@/app/utils/revalidate";
import { revalidatePath } from "next/cache";

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
    notifEmail?: boolean;
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

  if (Object.keys(patch).length === 0 && typeof body.notifEmail !== "boolean") {
    return NextResponse.json({ error: "Nothing to update" }, { status: 400 });
  }

  let mutation = writeClient.patch(id).set(patch);
  if (typeof body.notifEmail === "boolean") {
    mutation = mutation.setIfMissing({ notifPrefs: {} }).set({ "notifPrefs.email": body.notifEmail });
  }
  const doc = await mutation.commit();
  // A renamed member's name/alias surfaces on ISR schedule/home/me views.
  revalidateServiceViews();
  revalidatePath("/me");
  return NextResponse.json(doc);
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
