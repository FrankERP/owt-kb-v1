// MCP OAuth-state document contract — type names, `_id` prefixes and field
// lists only. NO IMPORTS, by design (controller ruling R10): both
// `sanity/schemas/mcpOauthGrant.ts` and `sanity/schemas/mcpOauthCodeRedemption.ts`
// import this module directly, and the embedded Studio (`/studio`) bundles
// every schema file into a browser build. `grantDocument.ts` pulls in
// `node:crypto` and `./tokens` (which pulls in `jose`) — neither belongs in
// that bundle, and no CI gate builds `/studio` to catch it if it leaked in.
// Keeping this module free of imports is what makes it safe for a schema file
// to import: the same shape `sanity/structure.ts` already relies on for
// `app/utils/studioProtection.ts`, which is also import-free.
//
// `grantDocument.ts` imports and re-exports every name here, so its existing
// callers keep importing from `./grantDocument` unchanged.

export const MCP_OAUTH_GRANT_TYPE = "mcpOauthGrant";
export const MCP_OAUTH_CODE_REDEMPTION_TYPE = "mcpOauthCodeRedemption";
export const GRANT_ID_PREFIX = "mcpOauthGrant.";
export const CODE_REDEMPTION_ID_PREFIX = "mcpOauthCode.";

/** Every field an `mcpOauthGrant` may carry besides `_id`/`_type`. */
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

/** Every field an `mcpOauthCodeRedemption` may carry besides `_id`/`_type` (the id holds the hashed jti). */
export const CODE_REDEMPTION_FIELDS = ["redeemedAt"] as const;
export type CodeRedemptionField = (typeof CODE_REDEMPTION_FIELDS)[number];
