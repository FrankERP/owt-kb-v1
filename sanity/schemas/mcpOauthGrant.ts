import { defineType } from "sanity";

import { GRANT_FIELD, MCP_OAUTH_GRANT_TYPE } from "../../app/mcp/oauth/documentTypes";

/**
 * Internal MCP OAuth grant (P0 auth spec O4/O5/O9).
 *
 * One document per authorized MCP connection: the member id (`sub`), a HASH of
 * the client id (never the raw client id, never a token or code), the issuing
 * origin, timestamps, the current refresh `jti` and the revocation flag. The
 * dataset answers unauthenticated PUBLISHED reads, so every field here is
 * treated as public (O5) — a member id is already public, and a refresh `jti`
 * or client hash cannot be replayed without the signing secret.
 *
 * NOT editable content: hidden and read-only in the Studio; never authored by
 * hand. Revocation is a guarded script (O9), never a hand edit. `_id` is
 * `mcpOauthGrant.<uuid>` (dotted, so the public reader never surfaces it as a
 * slug).
 *
 * The type name (`MCP_OAUTH_GRANT_TYPE`) and every field's `name:`
 * (`GRANT_FIELD.*`) are IMPORTED from the import-free
 * `app/mcp/oauth/documentTypes.ts` (controller ruling R10) — the same source
 * every write `app/mcp/oauth/grantStore.ts` makes is built against, so the two
 * can never drift. Only `title`/`type`/`description` are hand-written here.
 * `documentTypes.ts` itself carries zero imports, which is what makes it safe
 * to pull into this file: the embedded Studio (`/studio`) bundles every schema
 * file for the browser, and a schema must never drag `node:crypto`/`jose` (both
 * reachable from `grantDocument.ts`) into that bundle.
 * `app/mcp/oauth/__tests__/documentTypes.test.ts` asserts this schema's
 * declared field names equal `GRANT_FIELDS` exactly, and that this file's
 * import closure never reaches `node:crypto`/`jose`.
 */
export const mcpOauthGrant = defineType({
  name: MCP_OAUTH_GRANT_TYPE,
  title: "MCP OAuth Grant (internal)",
  type: "document",
  hidden: true,
  readOnly: true,
  description: "Interno: estado de concesión OAuth del servidor MCP. No editar ni borrar a mano.",
  fields: [
    {
      name: GRANT_FIELD.sub,
      title: "Miembro (sub)",
      type: "string",
      description: "Sanity id del miembro autorizado.",
    },
    {
      name: GRANT_FIELD.clientHash,
      title: "Hash del cliente",
      type: "string",
      description: "sha256 del client id firmado — nunca el client id en claro.",
    },
    {
      name: GRANT_FIELD.origin,
      title: "Origin",
      type: "string",
      description: "Origen canónico que emitió la concesión.",
    },
    { name: GRANT_FIELD.createdAt, title: "Creado", type: "datetime" },
    {
      name: GRANT_FIELD.lastRefreshAt,
      title: "Último refresh",
      type: "datetime",
      description: "Ausente hasta el primer refresh.",
    },
    { name: GRANT_FIELD.currentRefreshJti, title: "Refresh jti actual", type: "string" },
    { name: GRANT_FIELD.revoked, title: "Revocado", type: "boolean" },
    {
      name: GRANT_FIELD.revokedAt,
      title: "Revocado el",
      type: "datetime",
      description: "Ausente salvo que esté revocado.",
    },
    {
      name: GRANT_FIELD.revokedReason,
      title: "Motivo de revocación",
      type: "string",
      description: "Ausente salvo que esté revocado.",
    },
  ],
  preview: {
    select: { sub: "sub", origin: "origin", revoked: "revoked" },
    prepare(sel: { sub?: string; origin?: string; revoked?: boolean }) {
      return {
        title: sel.sub ?? "(sin miembro)",
        subtitle: `${sel.origin ?? "?"} · ${sel.revoked ? "revocado" : "activo"}`,
      };
    },
  },
});
