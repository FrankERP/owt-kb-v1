import { requireActiveSession } from "@/app/utils/authGuards";
import { redirect, notFound } from "next/navigation";
import { serverClient } from "@/sanity/lib/serverClient";
import Navbar from "@/app/components/Navbar";
import ProposalEditor from "./ProposalEditor";

export const revalidate = 0;

type ServiceType = "sunday" | "saturday" | "special";

async function getRoleDoc(roleId: string, leadId: string) {
  // Try all three role types — only returns if the user is a Lead on this doc
  const doc = await serverClient.fetch(
    `*[_id == $id && (_type == "sunday_role" || _type == "saturday_role" || _type == "special_role") && $leadId in Lead[]._ref][0] {
      _id, _type, week, date, service_name
    }`,
    { id: roleId, leadId }
  );
  return doc ?? null;
}

async function getProposalsForService(currentLeadId: string, roleId: string) {
  const all = await serverClient.fetch(
    `*[_type == "setlistProposal" && service_ref._ref == $roleId] {
      _id, status, lead_notes, admin_notes,
      "isOwn": lead._ref == $currentLeadId,
      "leadName": coalesce(lead->alias, lead->member_name),
      songs[] {
        _key, play_key,
        "song_id": song._ref,
        "title": song->title,
        "author": song->author,
        "key": song->key
      }
    }`,
    { currentLeadId, roleId }
  );
  const myProposal    = (all as any[]).find(p => p.isOwn)  ?? null;
  const coLeadProposal = (all as any[]).find(p => !p.isOwn) ?? null;
  return { myProposal, coLeadProposal };
}

export default async function ProposePage({
  params,
}: {
  params: Promise<{ roleId: string }>;
}) {
  const session = await requireActiveSession();
  if (!session) redirect("/auth/signin?callbackUrl=/me");

  const { roleId } = await params;
  const leadId = session.user.sanityId;

  const roleDoc = await getRoleDoc(roleId, leadId);
  if (!roleDoc) notFound();

  const { myProposal, coLeadProposal } = await getProposalsForService(leadId, roleId);

  const serviceType: ServiceType =
    roleDoc._type === "sunday_role" ? "sunday" :
    roleDoc._type === "saturday_role" ? "saturday" : "special";

  const serviceDate: string = (roleDoc.week ?? roleDoc.date ?? "").slice(0, 10);

  return (
    <div>
      <Navbar title="Propuesta" />
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
          existingProposal={myProposal ?? null}
          coLeadProposal={coLeadProposal ?? null}
        />
      </div>
    </div>
  );
}
