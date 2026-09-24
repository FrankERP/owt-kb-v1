import { defineType } from "sanity";

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
 * The type name and this field list MIRROR `MCP_OAUTH_CODE_REDEMPTION_TYPE` /
 * `CODE_REDEMPTION_FIELDS` in `app/mcp/oauth/documentTypes.ts` (not imported —
 * see the comment on `mcpOauthGrant.ts` / controller ruling R10).
 * `app/mcp/oauth/__tests__/documentTypes.test.ts` asserts this schema's
 * declared field names equal `CODE_REDEMPTION_FIELDS` exactly.
 */
export const mcpOauthCodeRedemption = defineType({
  name: "mcpOauthCodeRedemption",
  title: "MCP OAuth Code Redemption (internal)",
  type: "document",
  hidden: true,
  readOnly: true,
  description: "Interno: registro de canje de código OAuth (evita reintentos). No editar ni borrar a mano.",
  fields: [{ name: "redeemedAt", title: "Canjeado el", type: "datetime" }],
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
