import { NextRequest, NextResponse } from "next/server";
import { requireActiveManager } from "@/app/utils/authGuards";
import { isMinistryId } from "@/app/ministries";
import { writeClient, serverClient } from "@/sanity/lib/serverClient";
import { revalidateServiceViews } from "@/app/utils/revalidate";
import { revalidatePath } from "next/cache";
import {
  nextRetiredFrom,
  validateRetirement,
} from "@/app/utils/memberRetirement";

interface StoredMember {
  _id: string;
  _rev: string;
  ministries?: unknown;
  retiredFrom?: unknown;
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await requireActiveManager();
  if (!session) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  if (session.user.role !== "super-admin") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { id } = await params;
  const body = await req.json() as { ministry?: string; retire?: boolean };
  const { ministry, retire } = body;

  if (!isMinistryId(ministry) || typeof retire !== "boolean") {
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  }

  const stored = await serverClient.fetch<StoredMember | null>(
    `*[_type == "teamMembers" && _id == $id][0]{ _id, _rev, ministries, retiredFrom }`,
    { id },
  );
  if (!stored?._rev) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  if (retire) {
    const err = validateRetirement(stored, ministry);
    if (err) return NextResponse.json({ error: err }, { status: 400 });
  }

  const next = nextRetiredFrom(stored.retiredFrom, ministry, retire);
  const mutation = writeClient.patch(id).ifRevisionId(stored._rev);
  const doc = next === undefined
    ? await mutation.unset(["retiredFrom"]).commit()
    : await mutation.set({ retiredFrom: next }).commit();

  revalidateServiceViews();
  revalidatePath("/me");
  return NextResponse.json(doc);
}
