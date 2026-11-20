// Native-app sign-in state — document contract: type names, `_id` prefixes and
// field names only. NO IMPORTS, by design (spec 2026-11-19 D6, the pattern of
// `app/mcp/oauth/documentTypes.ts`): the two Sanity schema files
// (`sanity/schemas/appAuthGrant.ts`, `sanity/schemas/appAuthCodeRedemption.ts`)
// import this module, and the embedded Studio bundles every schema file into a
// browser build — `app/appAuth/*` pulls in `jose` and `node:crypto`, which must
// never reach it. `app/appAuth/__tests__/documentTypes.test.ts` asserts this
// file has no `import`.

export const APP_AUTH_GRANT_TYPE = "appAuthGrant";
export const APP_AUTH_CODE_REDEMPTION_TYPE = "appAuthCodeRedemption";
export const APP_GRANT_ID_PREFIX = "appAuthGrant.";
export const APP_CODE_REDEMPTION_ID_PREFIX = "appAuthCode.";

/** Every field an `appAuthGrant` may carry besides `_id`/`_type`, in field order. */
export const APP_GRANT_FIELDS = [
  "sub",
  "clientId",
  "platform",
  "origin",
  "createdAt",
  "lastRefreshAt",
  "currentRefreshJti",
  "revoked",
  "revokedAt",
  "revokedReason",
] as const;
export type AppGrantField = (typeof APP_GRANT_FIELDS)[number];

/** The same names keyed by themselves, for the schema's `name:`. */
export const APP_GRANT_FIELD = {
  sub: "sub",
  clientId: "clientId",
  platform: "platform",
  origin: "origin",
  createdAt: "createdAt",
  lastRefreshAt: "lastRefreshAt",
  currentRefreshJti: "currentRefreshJti",
  revoked: "revoked",
  revokedAt: "revokedAt",
  revokedReason: "revokedReason",
} as const satisfies Record<AppGrantField, AppGrantField>;

/** Every field an `appAuthCodeRedemption` may carry besides `_id`/`_type` (the id holds the hashed jti). */
export const APP_CODE_REDEMPTION_FIELDS = ["redeemedAt"] as const;

export const APP_CODE_REDEMPTION_FIELD = { redeemedAt: "redeemedAt" } as const;

/** The two app clients and the platform each one is. */
export const APP_PLATFORMS = ["ios", "android"] as const;
