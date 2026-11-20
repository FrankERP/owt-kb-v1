import "server-only";

// MCP OAuth core — the grant store: the only code that reads or writes MCP
// OAuth state in Sanity. `server-only` because it imports `writeClient` (a
// write token).
//
// The protocol itself (cache, fresh reads, rotation with reuse detection,
// revocation, single-use code redemption) lives in
// `app/oauthCore/grantStoreProtocol.ts`, shared with the native apps' store
// (ADR-0091). This module is the MCP family's instance: it imports
// `writeClient` and the MCP document builders itself and hands them in, and
// keeps every name it always exported.
//
// Nothing here throws: every outcome is a typed result, and every unexpected
// Sanity failure is `{ ok: false, reason: "server_error", cause }` — `cause` is
// the Sanity error for the route to log; it never contains a token, a code or a
// client id (none of those is ever sent to Sanity). This module logs nothing.

import { writeClient } from "@/sanity/lib/serverClient";
import {
  GRANT_CACHE_TTL_MS,
  REVOKE_REASON_REFRESH_REUSE,
  createGrantStore,
  type Fresh,
  type GrantLookup,
  type GrantStoreFailure,
  type ProtocolClient,
  type RotateRefreshResult,
} from "@/app/oauthCore/grantStoreProtocol";
import {
  MCP_OAUTH_GRANT_TYPE,
  buildCodeRedemptionDocument,
  buildGrantDocument,
  buildRefreshRotationPatch,
  buildRevocationPatch,
  isGrantId,
  newGrantId,
  parseGrantDocument,
  GRANT_READ_FIELDS,
  type StoredGrant,
} from "./grantDocument";
import type { RedirectTargetKind } from "./redirects";
import { REFRESH_TOKEN_TTL_SECONDS } from "./tokens";

export type { StoredGrant } from "./grantDocument";
export type { GrantLookup, GrantStoreFailure, RotateRefreshResult };
export { GRANT_CACHE_TTL_MS, REVOKE_REASON_REFRESH_REUSE };

/** A grant read with `loadGrant(id, { fresh: true })` — the only kind `rotateRefresh` takes. */
export type FreshGrant = Fresh<StoredGrant>;

type McpNewGrant = { sub: string; clientId: string; origin: string; client: RedirectTargetKind };

const store = createGrantStore<StoredGrant, McpNewGrant>(writeClient as unknown as ProtocolClient, {
  grantType: MCP_OAUTH_GRANT_TYPE,
  isGrantId,
  newGrantId,
  readFields: GRANT_READ_FIELDS,
  buildGrantDocument,
  parseGrantDocument,
  buildRefreshRotationPatch,
  buildRevocationPatch,
  buildCodeRedemptionDocument,
  refreshLifetimeMs: REFRESH_TOKEN_TTL_SECONDS * 1000,
});

/** For tests only. */
export function __clearGrantCache() {
  store.clearCache();
}

/** Projects exactly what `parseGrantDocument` reads (`GRANT_READ_FIELDS`), so no field can read back absent by omission. */
export const GRANT_QUERY = store.grantQuery;

/**
 * Create a live grant for `sub`, bound to the client (stored as its hash) and to
 * the issuing `origin`, at a fresh `mcpOauthGrant.<uuid>` id. Returns the id and
 * the first refresh `jti` to mint the refresh token with.
 */
export function createGrant(input: McpNewGrant) {
  return store.createGrant(input);
}

/**
 * Read a grant. `ok: true` only for a live grant; revoked, missing and
 * malformed documents are all `reason: "revoked"`. Answers from a 30 s per-id
 * cache unless `fresh: true`. The MCP route may use the cache. The refresh path
 * MUST use `fresh: true`: only a `FreshGrant` can be passed to `rotateRefresh`.
 */
export function loadGrant(id: string, opts: { fresh: true }): Promise<GrantLookup<FreshGrant>>;
export function loadGrant(id: string, opts?: { fresh?: boolean }): Promise<GrantLookup<StoredGrant>>;
export function loadGrant(id: string, opts?: { fresh?: boolean }): Promise<GrantLookup<StoredGrant>> {
  return store.loadGrant(id, opts);
}

/**
 * Rotate the refresh token of a FRESHLY read grant: revoked → refused; another
 * deployment's grant → refused, not revoked; a superseded jti → the whole grant
 * revoked; otherwise rotated under `ifRevisionId`, a lost race refused but NOT
 * revoked (`app/oauthCore/grantStoreProtocol.ts`).
 */
export function rotateRefresh(grant: FreshGrant, presentedJti: string, origin: string): Promise<RotateRefreshResult> {
  return store.rotateRefresh(grant, presentedJti, origin);
}

/** Revoke a grant, unconditionally; refuses — without writing — an id that is not a grant id. */
export function revokeGrant(id: string, reason: string): Promise<{ ok: true } | GrantStoreFailure> {
  return store.revokeGrant(id, reason);
}

/** Mark an authorization code's `jti` redeemed; a second redemption is `replay`. */
export function redeemCode(jti: string) {
  return store.redeemCode(jti);
}
