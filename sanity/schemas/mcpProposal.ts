import { defineType } from "sanity";

import { MCP_PROPOSAL_TYPE, PROPOSAL_FIELD } from "../../app/mcp/monthProposals/documentTypes";

/**
 * Internal MCP month proposal (P4 on solver v3, D6).
 *
 * One document per successful `solve_month`, and one per revision saved in the editor (with
 * `parent`, `revision` and `root`; plan 2026-10-21, ADR-0062): who solved it (origin and member id), when it
 * expires (7 days), the rules revision and months it was solved for, and the plan itself as one
 * JSON string (`payload`) bound by a SHA-256 `digest`, plus the JSON string `state` that
 * `apply_schedule` grows. `_id` is `mcpProposal.<handle>` — dotted, so an untokened read never
 * serves it.
 *
 * NOT editable content: hidden and read-only in the Studio, never authored by hand. Written only
 * by `app/mcp/monthProposals/proposalStore.ts`; expired records are swept by the tools (D12).
 *
 * The type name and every field's `name:` are IMPORTED from the import-free
 * `app/mcp/monthProposals/documentTypes.ts`, as `mcpOauthGrant` does (ruling R10), so the schema
 * and the writer can never drift and no `node:crypto` reaches the Studio bundle.
 */
export const mcpProposal = defineType({
  name: MCP_PROPOSAL_TYPE,
  title: "MCP Month Proposal (internal)",
  type: "document",
  hidden: true,
  readOnly: true,
  description: "Interno: propuesta de mes del conector MCP. No editar ni borrar a mano.",
  fields: [
    { name: PROPOSAL_FIELD.origin, title: "Origin", type: "string" },
    { name: PROPOSAL_FIELD.principal, title: "Miembro (sub)", type: "string" },
    { name: PROPOSAL_FIELD.createdAt, title: "Creada", type: "datetime" },
    { name: PROPOSAL_FIELD.expiresAt, title: "Vence", type: "datetime" },
    { name: PROPOSAL_FIELD.engine, title: "Motor", type: "string" },
    {
      name: PROPOSAL_FIELD.rulesRev,
      title: "Revisión de reglas",
      type: "string",
      description: "Ausente cuando las reglas guardadas no existían (se usaron las de fábrica).",
    },
    { name: PROPOSAL_FIELD.months, title: "Meses", type: "array", of: [{ type: "string" }] },
    { name: PROPOSAL_FIELD.requestId, title: "Request id", type: "string" },
    {
      name: PROPOSAL_FIELD.parent,
      title: "Revisión de",
      type: "string",
      description: "Solo en una revisión hecha en el editor: la propuesta de la que salió.",
    },
    { name: PROPOSAL_FIELD.revision, title: "Revisión", type: "number" },
    { name: PROPOSAL_FIELD.root, title: "Propuesta original", type: "string" },
    { name: PROPOSAL_FIELD.payload, title: "Plan (JSON)", type: "text" },
    { name: PROPOSAL_FIELD.digest, title: "Digest", type: "string" },
    { name: PROPOSAL_FIELD.state, title: "Avance (JSON)", type: "text" },
  ],
  preview: {
    select: { months: "months", expiresAt: "expiresAt" },
    prepare(sel: { months?: string[]; expiresAt?: string }) {
      return { title: (sel.months ?? []).join(" + ") || "(sin meses)", subtitle: `vence ${sel.expiresAt ?? "?"}` };
    },
  },
});
