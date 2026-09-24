// MCP OAuth-state document contract — type names, `_id` prefixes and field
// names/lists only. NO IMPORTS, by design (controller ruling R10): both
// `sanity/schemas/mcpOauthGrant.ts` and `sanity/schemas/mcpOauthCodeRedemption.ts`
// IMPORT this module directly (never mirror it) — the schema files, the
// writers in `grantDocument.ts`, and every test read the exact same source,
// so the two can never drift. The embedded Studio (`/studio`) bundles every
// schema file into a browser build, and `grantDocument.ts` itself pulls in
// `node:crypto` and `./tokens` (which pulls in `jose`) — neither may reach
// that bundle, and no CI gate builds `/studio` to catch it if it leaked in.
// Keeping THIS module free of imports is what makes it safe for a schema
// file to import: the same shape `sanity/structure.ts` already relies on for
// `app/utils/studioProtection.ts`, which is also import-free.
//
// `grantDocument.ts` imports and re-exports every name here, so its existing
// callers keep importing from `./grantDocument` unchanged.

export const MCP_OAUTH_GRANT_TYPE = "mcpOauthGrant";
export const MCP_OAUTH_CODE_REDEMPTION_TYPE = "mcpOauthCodeRedemption";
export const GRANT_ID_PREFIX = "mcpOauthGrant.";
export const CODE_REDEMPTION_ID_PREFIX = "mcpOauthCode.";

/** Every field an `mcpOauthGrant` may carry besides `_id`/`_type`, in field order. */
export const GRANT_FIELDS = [
  "sub",
  "clientHash",
  "origin",
  "createdAt",
  "lastRefreshAt",
  "currentRefreshJti",
  "revoked",
  "revokedAt",
  "revokedReason",
] as const;
export type GrantField = (typeof GRANT_FIELDS)[number];

/**
 * The same names, keyed by themselves. `sanity/schemas/mcpOauthGrant.ts` reads
 * `GRANT_FIELD.sub` for a field's `name:` — indexing `GRANT_FIELDS[0]` reads
 * badly and would silently break if the array were ever reordered.
 * `app/mcp/oauth/__tests__/documentTypes.test.ts` asserts `Object.values(GRANT_FIELD)`
 * equals `GRANT_FIELDS` exactly, order included, so the two definitions can
 * never drift from each other.
 */
export const GRANT_FIELD = {
  sub: "sub",
  clientHash: "clientHash",
  origin: "origin",
  createdAt: "createdAt",
  lastRefreshAt: "lastRefreshAt",
  currentRefreshJti: "currentRefreshJti",
  revoked: "revoked",
  revokedAt: "revokedAt",
  revokedReason: "revokedReason",
} as const satisfies Record<GrantField, GrantField>;

/** Every field an `mcpOauthCodeRedemption` may carry besides `_id`/`_type` (the id holds the hashed jti). */
export const CODE_REDEMPTION_FIELDS = ["redeemedAt"] as const;
export type CodeRedemptionField = (typeof CODE_REDEMPTION_FIELDS)[number];

/** Same shape as {@link GRANT_FIELD}, for the one code-redemption field. */
export const CODE_REDEMPTION_FIELD = {
  redeemedAt: "redeemedAt",
} as const satisfies Record<CodeRedemptionField, CodeRedemptionField>;
