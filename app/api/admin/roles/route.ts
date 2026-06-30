import { NextRequest, NextResponse } from "next/server";
import { requireActiveManager } from "@/app/utils/authGuards";
import { serverClient, writeClient } from "@/sanity/lib/serverClient";
import { sendPush } from "@/app/utils/push";
import { sendAssignmentEmails } from "@/app/utils/assignmentEmail";

function allAssignees(b: { leads?: string[]; bgvs?: string[]; chorus?: string[]; instruments?: { personId: string }[]; foh?: { personId: string }[] }): string[] {
  return [
    ...(b.leads ?? []), ...(b.bgvs ?? []), ...(b.chorus ?? []),
    ...(b.instruments ?? []).map((i) => i.personId),
    ...(b.foh ?? []).map((f) => f.personId),
  ].filter(Boolean);
}

type ServiceType = "sunday_role" | "saturday_role" | "special_role";

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

export async function GET() {
  const session = await requireActiveManager();
  if (!session) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  // Restricted to admin and super-admin (not content-editor)
  if (session.user.role === "content-editor") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const SONG_PROJ = `{ _id, title, author, key, "slug": slug.current }`;
  const SETLIST_SONGS = `songs[]{ play_key, medley_tag, "song": song->${SONG_PROJ} }`;

  const roles = await serverClient.fetch(`
    *[_type in ["sunday_role", "saturday_role", "special_role"]]
    | order(coalesce(week, date) asc) {
      _id, _type, service_name, published,
      "date": coalesce(week, date),
      "leads": Lead[]->{_id, member_name, alias},
      "bgvs": BGVs[]->{_id, member_name, alias},
      "chorus": Chorus[]->{_id, member_name, alias},
      "instruments": instruments[]{instrument, "person": person->{_id, member_name, alias}},
      "foh": foh_team[]{role, "person": person->{_id, member_name, alias}},
      "songs": select(
        _type == "sunday_role"   => *[_type == "featuredSongs"  && week == ^.week][0].${SETLIST_SONGS},
        _type == "saturday_role" => *[_type == "saturdarSongs"  && week == ^.week][0].${SETLIST_SONGS},
        ${SETLIST_SONGS}
      )
    }
  `);

  return NextResponse.json(roles);
}

export async function POST(req: NextRequest) {
  const session = await requireActiveManager();
  if (!session) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  // Restricted to admin and super-admin (not content-editor)
  if (session.user.role === "content-editor") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const body = await req.json() as {
    _type: ServiceType;
    date: string;
    service_name?: string;
    published?: boolean;
    leads?: string[];
    bgvs?: string[];
    chorus?: string[];
    instruments?: { instrument: string; personId: string }[];
    foh?: { role: string; personId: string }[];
  };

  if (!body._type || !body.date) {
    return NextResponse.json({ error: "_type and date required" }, { status: 400 });
  }

  const dateField = body._type === "special_role" ? "date" : "week";

  const doc = await writeClient.create({
    _type: body._type,
    [dateField]: body.date,
    ...(body._type === "special_role" && body.service_name ? { service_name: body.service_name } : {}),
    Lead:        toRefs(body.leads ?? []),
    BGVs:        toRefs(body.bgvs ?? []),
    Chorus:      toRefs(body.chorus ?? []),
    instruments: toInstrumentSlots(body.instruments ?? []),
    foh_team:    toFohSlots(body.foh ?? []),
    published:   body.published === true,   // default false = draft
  });

  const added = allAssignees(body); // brand-new doc → everyone is "added"
  if (body.published === true) {
    void sendPush(added, "assignments", {
      title: "Nuevo servicio asignado",
      body: `Te asignaron para el ${body.date}.`,
      path: "/me",
    });
    void sendAssignmentEmails(added, { type: body._type, date: body.date, body });
  }

  return NextResponse.json(doc, { status: 201 });
}
