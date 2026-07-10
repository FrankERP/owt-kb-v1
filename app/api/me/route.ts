import { NextRequest, NextResponse } from "next/server";
import { requireActiveSession } from "@/app/utils/authGuards";
import { serverClient, writeClient } from "@/sanity/lib/serverClient";
import { revalidateServiceViews } from "@/app/utils/revalidate";
import { revalidatePath } from "next/cache";

export async function GET() {
  const session = await requireActiveSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const member = await serverClient.fetch(
    `*[_type == "teamMembers" && _id == $id][0] {
      _id, member_name, alias, email, role, memberType,
      "photoUrl": coalesce(profilePhoto.asset->url, googlePhotoUrl),
      "hasPassword": defined(passwordHash) && passwordHash != ""
    }`,
    { id: session.user.sanityId }
  );

  return NextResponse.json(member);
}

export async function PATCH(req: NextRequest) {
  const session = await requireActiveSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await req.json() as { alias?: string; email?: string };
  const patch: Record<string, unknown> = {};
  // Guard against a non-string alias (null/number) so .trim() can't throw a 500.
  if (typeof body.alias === "string") patch.alias = body.alias.trim();
  if (typeof body.email === "string" && body.email.trim()) {
    const email = body.email.trim().toLowerCase();
    // Reject malformed addresses so we never store an email that would silently
    // break the assignment-email pipeline.
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return NextResponse.json({ error: "Correo electrónico inválido." }, { status: 400 });
    }
    patch.email = email;
  }

  if (Object.keys(patch).length === 0) {
    return NextResponse.json({ error: "Nothing to update" }, { status: 400 });
  }

  const doc = await writeClient.patch(session.user.sanityId).set(patch).commit();
  // A changed alias surfaces on ISR schedule/home/me views.
  revalidateServiceViews();
  revalidatePath("/me");
  return NextResponse.json(doc);
}
