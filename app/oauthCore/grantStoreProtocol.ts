import "server-only";

// OAuth grant-store PROTOCOL — the one implementation of grant creation, the
// cached/fresh read, refresh rotation with reuse detection, revocation and
// single-use code redemption, shared by two document families (ADR-0091):
//   - the MCP connector's (`app/mcp/oauth/grantStore.ts`, `mcpOauthGrant.*`);
//   - the native apps' (`app/appAuth/grantStore.ts`, `appAuthGrant.*`).
// Extracted UNCHANGED from the MCP store (spec 2026-11-19 D6): two copies of a
// security protocol drift, one cannot.
//
// The Sanity client is INJECTED: each family's store module imports
// `writeClient` itself and passes it in, so the clients guard of each tree
// keeps seeing the import where it is used. Methods are called on the client
// object at CALL time, never destructured at creation, so a test's spy on the
// object sees every call.
//
// Nothing here throws: every outcome is a typed result, and every unexpected
// Sanity failure is `{ ok: false, reason: "server_error", cause }`. This module
// logs nothing.

import { randomUUID } from "node:crypto";
import { sanityConflictKind } from "@/app/utils/roleWriteRequest";

/** Same TTL as `app/utils/memberAccess.ts`: a revocation bites within 30 s. */
export const GRANT_CACHE_TTL_MS = 30_000;

/** `revokedReason` written when a superseded refresh token is presented. */
export const REVOKE_REASON_REFRESH_REUSE = "refresh_token_reuse";

/** What the protocol itself reads from a parsed grant. */
export interface ProtocolGrant {
  _id: string;
  _rev: string;
  sub: string;
  origin: string;
  currentRefreshJti: string;
  /** True unless the stored flag is exactly `false` (fail closed). */
  revoked: boolean;
}

declare const freshGrantBrand: unique symbol;
/**
 * A grant read with `loadGrant(id, { fresh: true })`. Only this type can be
 * rotated: a CACHED grant may carry a superseded `currentRefreshJti` (another
 * instance rotated it), and comparing a legitimate refresh against it would
 * revoke the grant for nothing.
 */
export type Fresh<G> = G & { readonly [freshGrantBrand]: true };

export type GrantStoreFailure = { ok: false; reason: "server_error"; cause: unknown };

export type GrantLookup<G> =
  | { ok: true; grant: G }
  /** Revoked flag set, document missing, or document malformed — all the same to a caller. */
  | { ok: false; reason: "revoked" }
  | GrantStoreFailure;

export type RotateRefreshResult =
  | { ok: true; refreshJti: string }
  /** revoked: grant already revoked. wrong_origin: issued by another deployment (not revoked by us).
   *  reuse_revoked: a superseded jti was presented and the whole grant is now revoked.
   *  conflict: a concurrent write won the revision race — refused, NOT revoked. */
  | { ok: false; reason: "revoked" | "wrong_origin" | "reuse_revoked" | "conflict" }
  | GrantStoreFailure;

/** The chained patch builder the protocol uses. */
export interface ProtocolPatch {
  ifRevisionId(rev: string): ProtocolPatch;
  set(attrs: Record<string, unknown>): ProtocolPatch;
  commit(): Promise<unknown>;
}

/** The transaction builder `revokeAllGrants` uses (one atomic commit). */
export interface ProtocolTransaction {
  patch(id: string, ops: (p: ProtocolPatch) => ProtocolPatch): ProtocolTransaction;
  commit(): Promise<unknown>;
}

/** The slice of a Sanity client the protocol needs. `writeClient` satisfies it. */
export interface ProtocolClient {
  create(doc: { _id: string; _type: string }): Promise<unknown>;
  fetch(query: string, params: Record<string, unknown>): Promise<unknown>;
  patch(id: string): ProtocolPatch;
  transaction(): ProtocolTransaction;
}

/** What a document family supplies. Every write is built by the family's pure builders. */
export interface GrantStoreConfig<G extends ProtocolGrant, NewInput> {
  grantType: string;
  isGrantId(id: unknown): id is string;
  newGrantId(): string;
  /** The fields `parseGrantDocument` reads; the read query projects exactly these. */
  readFields: readonly string[];
  buildGrantDocument(
    input: NewInput & { id: string; refreshJti: string; createdAt: string },
  ): { _id: string; _type: string; currentRefreshJti: string };
  parseGrantDocument(raw: unknown): G | null;
  buildRefreshRotationPatch(input: { refreshJti: string; at: string }): Record<string, unknown>;
  buildRevocationPatch(input: { reason: string; at: string }): Record<string, unknown>;
  buildCodeRedemptionDocument(input: { jti: string; redeemedAt: string }): { _id: string; _type: string };
  /** How long an unused grant stays usable (its refresh-token lifetime): the «live» window of the list reads. */
  refreshLifetimeMs: number;
}

/** One row of a person's live grants (the `/me` list). */
export interface LiveGrantRow {
  _id: string;
  createdAt: string | null;
  lastRefreshAt: string | null;
  /** The family's own per-grant label field (the app's `platform`), or null. */
  label: string | null;
}

export interface GrantStore<G extends ProtocolGrant, NewInput> {
  /** The read query — projects exactly `readFields`. */
  readonly grantQuery: string;
  createGrant(input: NewInput): Promise<{ ok: true; grantId: string; refreshJti: string } | GrantStoreFailure>;
  loadGrant(id: string, opts: { fresh: true }): Promise<GrantLookup<Fresh<G>>>;
  loadGrant(id: string, opts?: { fresh?: boolean }): Promise<GrantLookup<G>>;
  rotateRefresh(grant: Fresh<G>, presentedJti: string, origin: string): Promise<RotateRefreshResult>;
  revokeGrant(id: string, reason: string): Promise<{ ok: true } | GrantStoreFailure>;
  redeemCode(jti: string): Promise<{ ok: true } | { ok: false; reason: "replay" } | GrantStoreFailure>;
  /**
   * The LIVE grants of `sub` issued by `origin`: not revoked, and used (or created)
   * within the refresh lifetime. `labelField` names the family's label field.
   */
  listLiveGrants(
    sub: string,
    origin: string,
    opts: { now: Date; labelField: string },
  ): Promise<{ ok: true; grants: LiveGrantRow[] } | GrantStoreFailure>;
  /** Revoke every live grant of `sub` on `origin` in ONE transaction: all or none. */
  revokeAllGrants(
    sub: string,
    origin: string,
    reason: string,
    opts: { now: Date },
  ): Promise<{ ok: true; revoked: number } | GrantStoreFailure>;
  /** For tests only. */
  clearCache(): void;
}

const REVOKED = Object.freeze({ ok: false, reason: "revoked" } as const);

/** The ISO instant from which a grant last used before it is dead. */
function liveSince(now: Date, lifetimeMs: number): string {
  return new Date(now.getTime() - lifetimeMs).toISOString();
}

export function createGrantStore<G extends ProtocolGrant, NewInput>(
  client: ProtocolClient,
  config: GrantStoreConfig<G, NewInput>,
): GrantStore<G, NewInput> {
  type CachedLookup = { ok: true; grant: G } | { ok: false; reason: "revoked" };
  const cache = new Map<string, { lookup: CachedLookup; expires: number }>();
  const grantQuery = `*[_type == $type && _id == $id][0]{ ${config.readFields.join(", ")} }`;

  async function createGrant(input: NewInput): Promise<{ ok: true; grantId: string; refreshJti: string } | GrantStoreFailure> {
    const doc = config.buildGrantDocument({
      ...input,
      id: config.newGrantId(),
      refreshJti: randomUUID(),
      createdAt: new Date().toISOString(),
    });
    try {
      await client.create(doc);
    } catch (cause) {
      return { ok: false, reason: "server_error", cause };
    }
    return { ok: true, grantId: doc._id, refreshJti: doc.currentRefreshJti };
  }

  // Read a grant. `ok: true` only for a live grant; revoked, missing and
  // malformed documents are all `reason: "revoked"` (so deleting OAuth documents
  // can only ever shut access). Answers from a 30 s per-id cache — live and
  // revoked results alike — unless `fresh: true`, which always reads and then
  // refreshes the cache entry. A read failure is never cached.
  async function loadGrant(id: string, opts: { fresh?: boolean } = {}): Promise<GrantLookup<G>> {
    if (!config.isGrantId(id)) return REVOKED;
    const now = Date.now();
    if (!opts.fresh) {
      const hit = cache.get(id);
      if (hit && hit.expires > now) return hit.lookup;
    }
    let raw: unknown;
    try {
      raw = await client.fetch(grantQuery, { id, type: config.grantType });
    } catch (cause) {
      return { ok: false, reason: "server_error", cause };
    }
    const grant = config.parseGrantDocument(raw);
    // Frozen: cached results are shared by reference, so no caller can poison them.
    const lookup: CachedLookup =
      !grant || grant.revoked ? REVOKED : Object.freeze({ ok: true as const, grant: Object.freeze(grant) });
    cache.set(id, { lookup, expires: now + GRANT_CACHE_TTL_MS });
    return lookup;
  }

  // Revoke a grant: unconditional (no revision guard) so a revocation can never
  // lose to a concurrent rotation. Drops the cache entry whether or not the
  // write lands. Refuses — without writing — an id that is not this family's
  // grant id, so it can never flag another document.
  async function revokeGrant(id: string, reason: string): Promise<{ ok: true } | GrantStoreFailure> {
    if (!config.isGrantId(id)) {
      return { ok: false, reason: "server_error", cause: new Error("revokeGrant: not a grant id") };
    }
    try {
      await client.patch(id).set(config.buildRevocationPatch({ reason, at: new Date().toISOString() })).commit();
      return { ok: true };
    } catch (cause) {
      return { ok: false, reason: "server_error", cause };
    } finally {
      cache.delete(id);
    }
  }

  // Rotate the refresh token of a FRESHLY read grant, in this order:
  //  1. revoked → refused, no write;
  //  2. `grant.origin !== origin` → refused, no write (one deployment never
  //     revokes another's grant);
  //  3. `presentedJti !== currentRefreshJti` → the whole grant is revoked
  //     (`refresh_token_reuse`) and the request refused. If that revocation
  //     cannot be written the result is `server_error`, never success;
  //  4. otherwise the rotation patch under `ifRevisionId(grant._rev)`; a
  //     revision conflict is refused but NOT revoked.
  async function rotateRefresh(grant: Fresh<G>, presentedJti: string, origin: string): Promise<RotateRefreshResult> {
    if (grant.revoked !== false) return REVOKED;
    if (grant.origin !== origin) return { ok: false, reason: "wrong_origin" };
    if (presentedJti !== grant.currentRefreshJti) {
      const revoked = await revokeGrant(grant._id, REVOKE_REASON_REFRESH_REUSE);
      return revoked.ok ? { ok: false, reason: "reuse_revoked" } : revoked;
    }
    const refreshJti = randomUUID();
    try {
      await client
        .patch(grant._id)
        .ifRevisionId(grant._rev)
        .set(config.buildRefreshRotationPatch({ refreshJti, at: new Date().toISOString() }))
        .commit();
    } catch (cause) {
      // A 409 here is a lost revision race: refuse, never revoke.
      if (sanityConflictKind(cause) !== null) return { ok: false, reason: "conflict" };
      return { ok: false, reason: "server_error", cause };
    } finally {
      cache.delete(grant._id);
    }
    return { ok: true, refreshJti };
  }

  // `create()` on a deterministic id fails on conflict, so a second redemption
  // is REFUSED as `replay` rather than absorbed. Any other failure is
  // `server_error` — never a replay, never a success.
  async function redeemCode(jti: string): Promise<{ ok: true } | { ok: false; reason: "replay" } | GrantStoreFailure> {
    try {
      await client.create(config.buildCodeRedemptionDocument({ jti, redeemedAt: new Date().toISOString() }));
      return { ok: true };
    } catch (cause) {
      if (sanityConflictKind(cause) === "already_exists") return { ok: false, reason: "replay" };
      return { ok: false, reason: "server_error", cause };
    }
  }

  const LIVE_FILTER =
    "_type == $type && sub == $sub && origin == $origin && revoked == false && " +
    "coalesce(lastRefreshAt, createdAt) > $since";

  async function listLiveGrants(
    sub: string,
    origin: string,
    opts: { now: Date; labelField: string },
  ): Promise<{ ok: true; grants: LiveGrantRow[] } | GrantStoreFailure> {
    // The label field is a constant the family passes, never request input; it is
    // still checked so a typo can never splice GROQ.
    if (!/^[A-Za-z][A-Za-z0-9]*$/.test(opts.labelField)) {
      return { ok: false, reason: "server_error", cause: new Error("listLiveGrants: bad label field") };
    }
    let raw: unknown;
    try {
      raw = await client.fetch(
        `*[${LIVE_FILTER}] | order(coalesce(lastRefreshAt, createdAt) desc)` +
          `{ _id, createdAt, lastRefreshAt, "label": ${opts.labelField} }`,
        { type: config.grantType, sub, origin, since: liveSince(opts.now, config.refreshLifetimeMs) },
      );
    } catch (cause) {
      return { ok: false, reason: "server_error", cause };
    }
    const rows = Array.isArray(raw) ? raw : [];
    const grants: LiveGrantRow[] = [];
    for (const row of rows) {
      if (!row || typeof row !== "object") continue;
      const r = row as Record<string, unknown>;
      if (!config.isGrantId(r._id)) continue;
      grants.push({
        _id: r._id,
        createdAt: typeof r.createdAt === "string" ? r.createdAt : null,
        lastRefreshAt: typeof r.lastRefreshAt === "string" ? r.lastRefreshAt : null,
        label: typeof r.label === "string" ? r.label : null,
      });
    }
    return { ok: true, grants };
  }

  async function revokeAllGrants(
    sub: string,
    origin: string,
    reason: string,
    opts: { now: Date },
  ): Promise<{ ok: true; revoked: number } | GrantStoreFailure> {
    let raw: unknown;
    try {
      raw = await client.fetch(`*[${LIVE_FILTER}]._id`, {
        type: config.grantType,
        sub,
        origin,
        since: liveSince(opts.now, config.refreshLifetimeMs),
      });
    } catch (cause) {
      return { ok: false, reason: "server_error", cause };
    }
    const ids = (Array.isArray(raw) ? raw : []).filter((id): id is string => config.isGrantId(id));
    if (ids.length === 0) return { ok: true, revoked: 0 };
    const set = config.buildRevocationPatch({ reason, at: new Date().toISOString() });
    let tx = client.transaction();
    for (const id of ids) tx = tx.patch(id, (p) => p.set(set));
    try {
      await tx.commit();
      return { ok: true, revoked: ids.length };
    } catch (cause) {
      return { ok: false, reason: "server_error", cause };
    } finally {
      for (const id of ids) cache.delete(id);
    }
  }

  return {
    grantQuery,
    createGrant,
    loadGrant: loadGrant as GrantStore<G, NewInput>["loadGrant"],
    rotateRefresh,
    revokeGrant,
    redeemCode,
    listLiveGrants,
    revokeAllGrants,
    clearCache: () => cache.clear(),
  };
}
