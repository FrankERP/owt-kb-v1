import { defineType } from "sanity";

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
 * The type name and this field list MIRROR `MCP_OAUTH_GRANT_TYPE` /
 * `GRANT_FIELDS` in `app/mcp/oauth/documentTypes.ts` — the source every write
 * `app/mcp/oauth/grantStore.ts` makes is built against. This file does not
 * import that module: a Sanity schema must never pull `node:crypto`/`jose`
 * into the embedded Studio bundle (controller ruling R10), and
 * `documentTypes.ts` is import-free specifically so it COULD be imported
 * safely — the two are kept in exact sync instead by
 * `app/mcp/oauth/__tests__/documentTypes.test.ts`, which asserts this schema's
 * declared field names equal `GRANT_FIELDS` exactly.
 */
export const mcpOauthGrant = defineType({
  name: "mcpOauthGrant",
  title: "MCP OAuth Grant (internal)",
  type: "document",
  hidden: true,
  readOnly: true,
  description: "Interno: estado de concesión OAuth del servidor MCP. No editar ni borrar a mano.",
  fields: [
    { name: "sub", title: "Miembro (sub)", type: "string", description: "Sanity id del miembro autorizado." },
    {
      name: "clientHash",
      title: "Hash del cliente",
      type: "string",
      description: "sha256 del client id firmado — nunca el client id en claro.",
    },
    { name: "origin", title: "Origin", type: "string", description: "Origen canónico que emitió la concesión." },
    { name: "createdAt", title: "Creado", type: "datetime" },
    {
      name: "lastRefreshAt",
      title: "Último refresh",
      type: "datetime",
      description: "Ausente hasta el primer refresh.",
    },
    { name: "currentRefreshJti", title: "Refresh jti actual", type: "string" },
    { name: "revoked", title: "Revocado", type: "boolean" },
    {
      name: "revokedAt",
      title: "Revocado el",
      type: "datetime",
      description: "Ausente salvo que esté revocado.",
    },
    {
      name: "revokedReason",
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
