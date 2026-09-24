import { defineType } from "sanity";

import { CODE_REDEMPTION_FIELD, MCP_OAUTH_CODE_REDEMPTION_TYPE } from "../../app/mcp/oauth/documentTypes";

/**
 * Internal MCP OAuth code-redemption replay guard (P0 auth spec O4).
 *
 * The `_id` is `mcpOauthCode.<sha256 hex of the authorization code's jti>` —
 * the ONLY payload is `redeemedAt`, because `create()` on this deterministic
 * id is itself the replay guard (`redeemCode` in `grantStore.ts`): only one
 * `create()` for a given hashed jti can ever win. Nothing in this document is
 * usable without the signing secret (O5).
 *
 * NOT editable content: hidden and read-only in the Studio; never authored by
 * hand.
 *
 * The type name (`MCP_OAUTH_CODE_REDEMPTION_TYPE`) and the field's `name:`
 * (`CODE_REDEMPTION_FIELD.redeemedAt`) are IMPORTED from the import-free
 * `app/mcp/oauth/documentTypes.ts` (controller ruling R10) — see the longer
 * comment on `mcpOauthGrant.ts` for why that module is safe to import here.
 * `app/mcp/oauth/__tests__/documentTypes.test.ts` asserts this schema's
 * declared field names equal `CODE_REDEMPTION_FIELDS` exactly, and that this
 * file's import closure never reaches `node:crypto`/`jose`.
 */
export const mcpOauthCodeRedemption = defineType({
  name: MCP_OAUTH_CODE_REDEMPTION_TYPE,
  title: "MCP OAuth Code Redemption (internal)",
  type: "document",
  hidden: true,
  readOnly: true,
  description: "Interno: registro de canje de código OAuth (evita reintentos). No editar ni borrar a mano.",
  fields: [{ name: CODE_REDEMPTION_FIELD.redeemedAt, title: "Canjeado el", type: "datetime" }],
  preview: {
    select: { redeemedAt: "redeemedAt" },
    prepare(sel: { redeemedAt?: string }) {
      return {
        title: "Código OAuth canjeado",
        subtitle: sel.redeemedAt ?? "sin fecha",
      };
    },
  },
});
