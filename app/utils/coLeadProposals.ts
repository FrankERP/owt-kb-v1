// app/utils/coLeadProposals.ts
//
// A service can have more than one Lead, and each lead makes their OWN proposal
// doc. On /me we want each lead to SEE — persistently, where they already look —
// that a co-lead has a proposal in flight for a service they share. This picks,
// per service, the single most salient co-lead proposal to surface.
import type { ProposalStatus } from "./interface";

export interface RawLeadProposal {
  status: ProposalStatus;
  service_ref: string;
  leadId: string;
  leadName?: string;
}

export interface CoLeadProposal {
  status: ProposalStatus;
  leadName: string;
}

// Higher = more worth surfacing. A submitted proposal (pending / changes) is the
// strongest "someone is on this" signal; an approved one means the setlist is
// already decided; a bare draft is the weakest.
const RANK: Record<ProposalStatus, number> = {
  pending: 3,
  changes_requested: 2,
  approved: 1,
  draft: 0,
};

/**
 * service_ref → the most salient co-lead proposal (excluding my own). When
 * several co-leads have proposals on one service, the most actionable status
 * wins. Proposals authored by `myId` are never included.
 */
export function selectCoLeadProposals(
  raw: RawLeadProposal[],
  myId: string,
): Map<string, CoLeadProposal> {
  const byService = new Map<string, CoLeadProposal>();
  for (const p of raw) {
    if (p.leadId === myId) continue;
    const cur = byService.get(p.service_ref);
    if (!cur || RANK[p.status] > RANK[cur.status]) {
      byService.set(p.service_ref, { status: p.status, leadName: p.leadName || "Tu co-líder" });
    }
  }
  return byService;
}
