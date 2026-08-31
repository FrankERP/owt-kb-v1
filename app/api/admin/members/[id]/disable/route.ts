import { NextRequest, NextResponse } from "next/server";
import { getToken } from "next-auth/jwt";
import { requireActiveManager } from "@/app/utils/authGuards";
import { writeClient, serverClient } from "@/sanity/lib/serverClient";
import { revalidateServiceViews } from "@/app/utils/revalidate";
import { revalidatePath } from "next/cache";

interface SuperAdminRow {
  _id: string;
  _rev: string;
  disabled?: boolean | null;
}

interface TargetRow {
  _id: string;
  _rev: string;
  disabled?: boolean | null;
}

function operatorIds(token: Awaited<ReturnType<typeof getToken>>): Set<string> {
  const ids = new Set<string>();
  if (!token || typeof token === "string") return ids;
  if (typeof token.sanityId === "string" && token.sanityId) ids.add(token.sanityId);
  const real = token.__realAdmin?.sanityId;
  if (typeof real === "string" && real) ids.add(real);
  return ids;
}

function writeBackDisabled(
  observed: boolean | null | undefined,
): { set: Record<string, unknown>; unset: string[] } {
  if (observed === true) return { set: { disabled: true }, unset: [] };
  if (observed === false) return { set: { disabled: false }, unset: [] };
  return { set: {}, unset: ["disabled"] };
}

async function commitDisable(
  targetId: string,
  targetRev: string,
  others: SuperAdminRow[],
): Promise<unknown> {
  let tx = writeClient.transaction().patch(targetId, (p) =>
    p.ifRevisionId(targetRev).set({ disabled: true }),
  );
  for (const other of others) {
    const { set, unset } = writeBackDisabled(other.disabled);
    tx = tx.patch(other._id, (p) => {
      let chain = p.ifRevisionId(other._rev).set(set) as typeof p;
      if (unset.length) chain = chain.unset(unset) as typeof p;
      return chain;
    });
  }
  return tx.commit();
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
  const body = await req.json() as { disabled?: boolean };
  if (typeof body.disabled !== "boolean") {
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  }

  const token = await getToken({ req, secret: process.env.NEXTAUTH_SECRET });

  if (!body.disabled) {
    const target = await serverClient.fetch<TargetRow | null>(
      `*[_type == "teamMembers" && _id == $id][0]{ _id, _rev }`,
      { id },
    );
    if (!target?._rev) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }
    const doc = await writeClient
      .patch(id)
      .ifRevisionId(target._rev)
      .set({ disabled: false })
      .commit();
    revalidateServiceViews();
    revalidatePath("/me");
    return NextResponse.json(doc);
  }

  const ops = operatorIds(token);
  if (ops.has(id)) {
    return NextResponse.json(
      { error: "No puedes deshabilitar tu propia cuenta mientras administras." },
      { status: 409 },
    );
  }

  const enabledSuperAdmins = await serverClient.fetch<SuperAdminRow[]>(
    `*[_type == "teamMembers" && role == "super-admin" && disabled != true]{ _id, _rev, disabled }`,
  );
  const othersEnabled = (enabledSuperAdmins ?? []).filter((m) => m._id !== id);
  if (othersEnabled.length === 0) {
    return NextResponse.json(
      { error: "Debe quedar al menos un super-admin habilitado." },
      { status: 409 },
    );
  }

  const target = await serverClient.fetch<TargetRow | null>(
    `*[_type == "teamMembers" && _id == $id][0]{ _id, _rev, disabled }`,
    { id },
  );
  if (!target?._rev) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  if (target.disabled === true) {
    return NextResponse.json(target);
  }

  try {
    const doc = await commitDisable(id, target._rev, othersEnabled);
    revalidateServiceViews();
    revalidatePath("/me");
    return NextResponse.json(doc);
  } catch {
    // Conservative retry after a concurrent write (e.g. `lastSeen` ping → 409).
    const freshTarget = await serverClient.fetch<TargetRow | null>(
      `*[_type == "teamMembers" && _id == $id][0]{ _id, _rev, disabled }`,
      { id },
    );
    if (!freshTarget?._rev) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }
    if (freshTarget.disabled === true) {
      return NextResponse.json(freshTarget);
    }
    const freshOthers = await serverClient.fetch<SuperAdminRow[]>(
      `*[_type == "teamMembers" && role == "super-admin" && disabled != true && _id != $id]{ _id, _rev, disabled }`,
      { id },
    );
    if ((freshOthers ?? []).length === 0) {
      return NextResponse.json(
        { error: "Debe quedar al menos un super-admin habilitado." },
        { status: 409 },
      );
    }
    try {
      const doc = await commitDisable(id, freshTarget._rev, freshOthers ?? []);
      revalidateServiceViews();
      revalidatePath("/me");
      return NextResponse.json(doc);
    } catch {
      return NextResponse.json(
        { error: "Conflicto al deshabilitar — reintenta en un momento." },
        { status: 409 },
      );
    }
  }
}
