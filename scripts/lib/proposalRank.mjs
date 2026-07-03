// scripts/lib/proposalRank.mjs
//
// Winner-selection ranking for the shared-proposal migration: when a service has
// more than one legacy proposal, we KEEP the most advanced one and delete the
// rest. `approved` ranks HIGHEST here because an approved proposal backs the live
// published setlist — losing it would corrupt data.
//
// ⚠️ This is the INVERSE of the /me surfacing rank in
// app/utils/proposalContributors.ts era (`coLeadProposals` ranked `approved`
// LOWEST, because a done setlist shouldn't nag). Keep the two separate — never
// merge them.

export const ADVANCEMENT_RANK = {
  approved: 3,
  pending: 2,
  changes_requested: 1,
  draft: 0,
};

export function advancementRank(status) {
  return ADVANCEMENT_RANK[status] ?? 0;
}
