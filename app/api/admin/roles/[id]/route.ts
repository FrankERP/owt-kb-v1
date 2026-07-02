import { NextRequest, NextResponse, after } from "next/server";

export const maxDuration = 60;
import { requireActiveManager } from "@/app/utils/authGuards";
import { serverClient, writeClient } from "@/sanity/lib/serverClient";
import { addedAssignees } from "@/app/utils/notifyTargets";
import { sendPush } from "@/app/utils/push";
import { sendAssignmentEmails } from "@/app/utils/assignmentEmail";
import { revalidateServiceViews } from "@/app/utils/revalidate";
import { revalidatePath } from "next/cache";

function allAssignees(b: { leads?: string[]; bgvs?: string[]; chorus?: string[]; instruments?: { personId: string }[]; foh?: { personId: string }[] }): string[] {
  return [
    ...(b.leads ?? []), ...(b.bgvs ?? []), ...(b.chorus ?? []),
    ...(b.instruments ?? []).map((i) => i.personId),
    ...(b.foh ?? []).map((f) => f.personId),
  ].filter(Boolean);
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
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await requireActiveManager();
  if (!session) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  // Restricted to admin and super-admin (not content-editor)
  if (session.user.role === "content-editor") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { id } = await params;
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

  const prevDoc = await serverClient.fetch<{ leads?: string[]; bgvs?: string[]; chorus?: string[]; inst?: string[]; foh?: string[]; published?: boolean } | null>(
    `*[_id == $id][0]{ "leads": Lead[]._ref, "bgvs": BGVs[]._ref, "chorus": Chorus[]._ref, "inst": instruments[].person._ref, "foh": foh_team[].person._ref, "published": published }`,
    { id }
  );

  const doc = await writeClient
    .patch(id)
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

  const prevIds = prevDoc ? [...(prevDoc.leads ?? []), ...(prevDoc.bgvs ?? []), ...(prevDoc.chorus ?? []), ...(prevDoc.inst ?? []), ...(prevDoc.foh ?? [])].filter(Boolean) : [];
  const added = addedAssignees(prevIds, allAssignees(body));
  if (prevDoc?.published !== false) {   // published or grandfathered; drafts stay silent
    after(async () => {
      await sendPush(added, "assignments", {
        title: "Servicio actualizado",
        body: `Te asignaron para el ${body.date}.`,
        path: "/me",
      });
      await sendAssignmentEmails(added, { type: body._type, date: body.date, body });
    });
  }

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
  // Restricted to admin and super-admin (not content-editor)
  if (session.user.role === "content-editor") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { id } = await params;
  await writeClient.delete(id);
  revalidateServiceViews();
  revalidatePath("/me");
  return NextResponse.json({ ok: true });
}
