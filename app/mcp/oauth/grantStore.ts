import "server-only";

// MCP OAuth core — the grant store: the only code that reads or writes OAuth
// state in Sanity. `server-only` because it imports `writeClient` (a write token).
//
// Nothing here throws: every outcome is a typed result, and every unexpected
// Sanity failure is `{ ok: false, reason: "server_error", cause }` — `cause` is
// the Sanity error for the route to log; it never contains a token, a code or a
// client id (none of those is ever sent to Sanity). This module logs nothing.

import { randomUUID } from "node:crypto";
import { writeClient } from "@/sanity/lib/serverClient";
import { sanityConflictKind } from "@/app/utils/roleWriteRequest";
import {
  MCP_OAUTH_GRANT_TYPE,
  buildCodeRedemptionDocument,
  buildGrantDocument,
  buildRefreshRotationPatch,
  buildRevocationPatch,
  isGrantId,
  newGrantId,
  parseGrantDocument,
  type StoredGrant,
} from "./grantDocument";

export type { StoredGrant } from "./grantDocument";

/** Same TTL as `app/utils/memberAccess.ts`: a revocation bites within 30 s (spec O2/O9). */
export const GRANT_CACHE_TTL_MS = 30_000;

/** `revokedReason` written when a superseded refresh token is presented (spec O4). */
export const REVOKE_REASON_REFRESH_REUSE = "refresh_token_reuse";

declare const freshGrantBrand: unique symbol;
/**
 * A grant read with `loadGrant(id, { fresh: true })`. Only this type can be
 * rotated: a CACHED grant may carry a superseded `currentRefreshJti` (another
 * instance rotated it), and comparing a legitimate refresh against it would
 * revoke the grant for nothing.
 */
export type FreshGrant = StoredGrant & { readonly [freshGrantBrand]: true };

export type GrantStoreFailure = { ok: false; reason: "server_error"; cause: unknown };

export type GrantLookup<G extends StoredGrant = StoredGrant> =
  | { ok: true; grant: G }
  /** Revoked flag set, document missing, or document malformed — all the same to a caller. */
  | { ok: false; reason: "revoked" }
  | GrantStoreFailure;

type CachedLookup = { ok: true; grant: StoredGrant } | { ok: false; reason: "revoked" };

const REVOKED = Object.freeze({ ok: false, reason: "revoked" } as const);

const cache = new Map<string, { lookup: CachedLookup; expires: number }>();

/** For tests only. */
export function __clearGrantCache() {
  cache.clear();
}

const GRANT_QUERY = `*[_type == $type && _id == $id][0]{
  _id, _rev, sub, clientHash, origin, createdAt, lastRefreshAt, currentRefreshJti, revoked
}`;

/**
 * Create a live grant for `sub`, bound to the client (stored as its hash) and to
 * the issuing `origin`, at a fresh `mcpOauthGrant.<uuid>` id. Returns the id and
 * the first refresh `jti` to mint the refresh token with.
 */
export async function createGrant(input: {
  sub: string;
  clientId: string;
  origin: string;
}): Promise<{ ok: true; grantId: string; refreshJti: string } | GrantStoreFailure> {
  const doc = buildGrantDocument({
    id: newGrantId(),
    sub: input.sub,
    clientId: input.clientId,
    origin: input.origin,
    refreshJti: randomUUID(),
    createdAt: new Date().toISOString(),
  });
  try {
    await writeClient.create(doc);
  } catch (cause) {
    return { ok: false, reason: "server_error", cause };
  }
  return { ok: true, grantId: doc._id, refreshJti: doc.currentRefreshJti };
}

/**
 * Read a grant. `ok: true` only for a live grant; revoked, missing and
 * malformed documents are all `reason: "revoked"` (so deleting OAuth documents
 * can only ever shut access). Answers from a 30 s per-id cache — live and
 * revoked results alike — unless `fresh: true`, which always reads and then
 * refreshes the cache entry. A read failure is never cached.
 *
 * The MCP route may use the cache. The refresh path MUST use `fresh: true`:
 * only a `FreshGrant` can be passed to `rotateRefresh`.
 */
export function loadGrant(id: string, opts: { fresh: true }): Promise<GrantLookup<FreshGrant>>;
export function loadGrant(id: string, opts?: { fresh?: boolean }): Promise<GrantLookup<StoredGrant>>;
export async function loadGrant(id: string, opts: { fresh?: boolean } = {}): Promise<GrantLookup<StoredGrant>> {
  if (!isGrantId(id)) return REVOKED;
  const now = Date.now();
  if (!opts.fresh) {
    const hit = cache.get(id);
    if (hit && hit.expires > now) return hit.lookup;
  }
  let raw: unknown;
  try {
    raw = await writeClient.fetch<unknown>(GRANT_QUERY, { id, type: MCP_OAUTH_GRANT_TYPE });
  } catch (cause) {
    return { ok: false, reason: "server_error", cause };
  }
  const grant = parseGrantDocument(raw);
  // Frozen: cached results are shared by reference, so no caller can poison them.
  const lookup: CachedLookup =
    !grant || grant.revoked ? REVOKED : Object.freeze({ ok: true as const, grant: Object.freeze(grant) });
  cache.set(id, { lookup, expires: now + GRANT_CACHE_TTL_MS });
  return lookup;
}

export type RotateRefreshResult =
  | { ok: true; refreshJti: string }
  /** revoked: grant already revoked. wrong_origin: issued by another deployment (not revoked by us).
   *  reuse_revoked: a superseded jti was presented and the whole grant is now revoked.
   *  conflict: a concurrent write won the revision race — refused, NOT revoked. */
  | { ok: false; reason: "revoked" | "wrong_origin" | "reuse_revoked" | "conflict" }
  | GrantStoreFailure;

/**
 * Rotate the refresh token of a FRESHLY read grant, in this order:
 *  1. revoked → refused, no write;
 *  2. `grant.origin !== origin` → refused, no write (a grant is bound to the
 *     deployment that issued it — spec O1 — and one deployment never revokes
 *     another's grant);
 *  3. `presentedJti !== currentRefreshJti` → the whole grant is revoked
 *     (`refresh_token_reuse`) and the request refused (spec O4). If that
 *     revocation cannot be written the result is `server_error`, never success;
 *  4. otherwise `currentRefreshJti`/`lastRefreshAt` are patched under
 *     `ifRevisionId(grant._rev)`; a revision conflict is refused but NOT revoked.
 * On success returns the new `jti` to mint the refresh token with. Drops the
 * cache entry whenever it writes.
 */
export async function rotateRefresh(
  grant: FreshGrant,
  presentedJti: string,
  origin: string,
): Promise<RotateRefreshResult> {
  if (grant.revoked !== false) return REVOKED;
  if (grant.origin !== origin) return { ok: false, reason: "wrong_origin" };
  if (presentedJti !== grant.currentRefreshJti) {
    const revoked = await revokeGrant(grant._id, REVOKE_REASON_REFRESH_REUSE);
    return revoked.ok ? { ok: false, reason: "reuse_revoked" } : revoked;
  }
  const refreshJti = randomUUID();
  try {
    await writeClient
      .patch(grant._id)
      .ifRevisionId(grant._rev)
      .set(buildRefreshRotationPatch({ refreshJti, at: new Date().toISOString() }))
      .commit();
  } catch (cause) {
    // A 409 here is a lost revision race (`revision_mismatch`, or an
    // unclassified mutation conflict): refuse, never revoke.
    if (sanityConflictKind(cause) !== null) return { ok: false, reason: "conflict" };
    return { ok: false, reason: "server_error", cause };
  } finally {
    cache.delete(grant._id);
  }
  return { ok: true, refreshJti };
}

/**
 * Revoke a grant: sets `revoked`, `revokedAt`, `revokedReason`. Unconditional
 * (no revision guard) so a revocation can never lose to a concurrent rotation.
 * Drops the cache entry whether or not the write lands. Refuses — without
 * writing — an id that is not a grant id, so it can never flag another document.
 */
export async function revokeGrant(id: string, reason: string): Promise<{ ok: true } | GrantStoreFailure> {
  if (!isGrantId(id)) {
    return { ok: false, reason: "server_error", cause: new Error("revokeGrant: not a grant id") };
  }
  try {
    await writeClient.patch(id).set(buildRevocationPatch({ reason, at: new Date().toISOString() })).commit();
    return { ok: true };
  } catch (cause) {
    return { ok: false, reason: "server_error", cause };
  } finally {
    cache.delete(id);
  }
}

/**
 * Mark an authorization code's `jti` redeemed. `create()` on the deterministic
 * id `mcpOauthCode.<sha256(jti)>` fails on conflict, so a second redemption is
 * REFUSED as `replay` (spec O4) rather than absorbed. Any other failure is
 * `server_error` — never a replay, never a success.
 */
export async function redeemCode(
  jti: string,
): Promise<{ ok: true } | { ok: false; reason: "replay" } | GrantStoreFailure> {
  try {
    await writeClient.create(buildCodeRedemptionDocument({ jti, redeemedAt: new Date().toISOString() }));
    return { ok: true };
  } catch (cause) {
    if (sanityConflictKind(cause) === "already_exists") return { ok: false, reason: "replay" };
    return { ok: false, reason: "server_error", cause };
  }
}
