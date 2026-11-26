import { requireWorshipPage } from "@/app/utils/worshipPageGate";
import { notFound } from "next/navigation";
import Navbar from "@/app/components/Navbar";
import type { ComponentProps } from "react";
import ProposalEditor from "./ProposalEditor";
import { readProposalEditor } from "@/app/utils/proposalEditorRead";

export const revalidate = 0;

export default async function ProposePage({
  params,
}: {
  params: Promise<{ roleId: string }>;
}) {
  const { roleId } = await params;

  // Worship surface living under /me: the setlist-proposal editor. It fails
  // closed for a non-Lead by data shape (the read below requires the member in
  // Lead[]._ref), but that is defence in depth, not a gate — a kids-only member
  // must be blocked by the gate, not by the query happening to come back empty.
  const session = await requireWorshipPage(`/me/propose/${roleId}`);
  const leadId = session.user.sanityId;

  // The role (caller in Lead[], published), its shared proposal and the service
  // conversation, read by the one helper the native app's editor read shares.
  // `null` covers a non-Lead, a draft service and a malformed stored date.
  const read = await readProposalEditor(roleId, leadId);
  if (!read) notFound();
  const { roleDoc, serviceType, serviceDate, proposal: shared, thread } = read;

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
          // The read is typed with GROQ's nulls; the editor's props predate that
          // typing (the fetch used to return `any`) and handle a missing field the same way.
          proposal={(shared ?? null) as ComponentProps<typeof ProposalEditor>["proposal"]}
          earlierMessages={thread.messages}
          pastorMessage={thread.pastorMessage}
          currentUserId={leadId}
        />
      </div>
    </div>
  );
}
