import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/auth";
import { writeClient } from "@/sanity/lib/serverClient";

async function requireSuperAdmin() {
  const session = await getServerSession(authOptions);
  if (session?.user.role !== "super-admin") return null;
  return session;
}

function key() {
  return Math.random().toString(36).slice(2, 9);
}

function toRefs(ids: string[]) {
  return ids.map((id) => ({ _type: "reference" as const, _ref: id, _key: key() }));
}

function toInstrumentSlots(slots: { instrument: string; personId: string }[]) {
  return slots.map((s) => ({
    _type: "instrument_slot" as const,
    _key: key(),
    instrument: s.instrument,
    person: { _type: "reference" as const, _ref: s.personId },
  }));
}

function toFohSlots(slots: { role: string; personId: string }[]) {
  return slots.map((s) => ({
    _type: "foh_slot" as const,
    _key: key(),
    role: s.role,
    person: { _type: "reference" as const, _ref: s.personId },
  }));
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  if (!await requireSuperAdmin()) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const body = await req.json() as {
    _type: "sunday_role" | "saturday_role" | "special_role";
    date: string;
    service_name?: string;
    leads?: string[];
    bgvs?: string[];
    chorus?: string[];
    instruments?: { instrument: string; personId: string }[];
    foh?: { role: string; personId: string }[];
  };

  const dateField = body._type === "special_role" ? "date" : "week";

  const doc = await writeClient
    .patch(params.id)
    .set({
      [dateField]: body.date,
      ...(body._type === "special_role" ? { service_name: body.service_name ?? "" } : {}),
      Lead:        toRefs(body.leads ?? []),
      BGVs:        toRefs(body.bgvs ?? []),
      Chorus:      toRefs(body.chorus ?? []),
      instruments: toInstrumentSlots(body.instruments ?? []),
      foh_team:    toFohSlots(body.foh ?? []),
    })
    .commit();

  return NextResponse.json(doc);
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: { id: string } }
) {
  if (!await requireSuperAdmin()) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  await writeClient.delete(params.id);
  return NextResponse.json({ ok: true });
}
