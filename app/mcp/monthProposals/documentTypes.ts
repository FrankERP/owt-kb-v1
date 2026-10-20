// MCP month-proposal document contract (P4 on solver v3, D6) — type name, `_id` prefix and
// field names only. NO IMPORTS, by design, for the reason `app/mcp/oauth/documentTypes.ts`
// gives (controller ruling R10): `sanity/schemas/mcpProposal.ts` imports this module, the
// embedded Studio bundles every schema file for the browser, and `proposalDocument.ts`
// pulls in `node:crypto`.

export const MCP_PROPOSAL_TYPE = "mcpProposal";
export const PROPOSAL_ID_PREFIX = "mcpProposal.";

/** Every field an `mcpProposal` may carry besides `_id`/`_type`, in field order. */
export const PROPOSAL_FIELDS = [
  "origin",
  "principal",
  "createdAt",
  "expiresAt",
  "engine",
  "rulesRev",
  "months",
  "requestId",
  "payload",
  "digest",
  "state",
] as const;
export type ProposalField = (typeof PROPOSAL_FIELDS)[number];

/** The same names keyed by themselves, for the schema's `name:` (see `GRANT_FIELD`). */
export const PROPOSAL_FIELD = {
  origin: "origin",
  principal: "principal",
  createdAt: "createdAt",
  expiresAt: "expiresAt",
  engine: "engine",
  rulesRev: "rulesRev",
  months: "months",
  requestId: "requestId",
  payload: "payload",
  digest: "digest",
  state: "state",
} as const satisfies Record<ProposalField, ProposalField>;
