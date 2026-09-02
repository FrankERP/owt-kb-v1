import { requireWorshipPage } from "@/app/utils/worshipPageGate";
import { notFound } from "next/navigation";
import { THREAD_MESSAGES } from "@/app/utils/proposalMessageRead";
import { operationalClient } from "@/sanity/lib/operationalClient";
import Navbar from "@/app/components/Navbar";
import ProposalEditor from "./ProposalEditor";
import { pickUnique, serviceDayKey } from "@/app/utils/serviceReadSelect";

export const revalidate = 0;

type ServiceType = "sunday" | "saturday" | "special";

type RoleDoc = {
  _id: string;
  _type: string;
  week?: string;
  date?: string;
  service_name?: string;
};

async function getRoleDoc(roleId: string, leadId: string) {
  // Try all three role types — only returns if the user is a Lead on this doc.
  // Canonical (published-perspective) client: a `drafts.*` overlay is never an
  // editable service. `published != false` is the separate, app-level
  // member-visibility gate and stays. Returned as an array and collapsed with
  // `pickUnique` — an exact-id match can only be ambiguous if the read contract
  // is violated, in which case we fail closed (404) rather than pick one.
  const docs = await operationalClient.fetch<RoleDoc[]>(
    `*[_id == $id && (_type == "sunday_role" || _type == "saturday_role" || _type == "special_role") && $leadId in Lead[]._ref && published != false] {
      _id, _type, week, date, service_name
    }`,
    { id: roleId, leadId }
  );
  return pickUnique(docs);
}

// The ONE shared proposal for this service (matches legacy random-id docs too).
// `order(_createdAt asc)[0]` is deterministic and deliberately identical to the
// selection in POST /api/me/proposals, so the editor always loads exactly the
// document the writer will patch.
async function getSharedProposal(roleId: string) {
  return operationalClient.fetch(
    `*[_type == "setlistProposal" && service_ref._ref == $roleId] | order(_createdAt asc)[0] {
      _id, _rev, status, lead_notes, team_notes, admin_notes,
      ${THREAD_MESSAGES},
      "createdById": lead->_id,
      "contributors": contributors[]{ "id": person->_id, "name": coalesce(person->alias, person->member_name) },
      songs[] {
        _key, play_key, medley_tag,
        "song_id": song._ref,
        "title": song->title,
        "author": song->author,
        "key": song->key
      }
    }`,
    { roleId }
  );
}

export default async function ProposePage({
  params,
}: {
  params: Promise<{ roleId: string }>;
}) {
  const { roleId } = await params;

  // Worship surface living under /me: the setlist-proposal editor. It fails
  // closed for a non-Lead by data shape (the GROQ below requires the member in
  // Lead[]._ref), but that is defence in depth, not a gate — a kids-only member
  // must be blocked by the gate, not by the query happening to come back empty.
  const session = await requireWorshipPage(`/me/propose/${roleId}`);
  const leadId = session.user.sanityId;

  const roleDoc = await getRoleDoc(roleId, leadId);
  if (!roleDoc) notFound();

  const shared = await getSharedProposal(roleId);

  const serviceType: ServiceType =
    roleDoc._type === "sunday_role" ? "sunday" :
    roleDoc._type === "saturday_role" ? "saturday" : "special";

  // A role whose stored date is missing or malformed cannot be proposed against
  // (the writer derives service_date from it) — fail closed rather than sending
  // the editor a bogus date.
  const serviceDate = serviceDayKey(roleDoc.week ?? roleDoc.date);
  if (!serviceDate) notFound();

  return (
    <div>
      <Navbar title="Propuesta" tags schedule />
      <div className="mx-auto max-w-2xl px-6 pt-10 pb-20">
        <ProposalEditor
          roleDoc={{
            _id: roleDoc._id,
            _type: roleDoc._type,
            week: roleDoc.week,
            date: roleDoc.date,
            service_name: roleDoc.service_name,
            service_type: serviceType,
            service_date: serviceDate,
          }}
          proposal={shared ?? null}
          currentUserId={leadId}
        />
      </div>
    </div>
  );
}
