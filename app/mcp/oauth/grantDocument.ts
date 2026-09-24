// MCP OAuth core — the two OAuth-state document shapes, as pure builders.
//
// The dataset answers unauthenticated PUBLISHED reads, so everything stored is
// treated as public (spec O5): no token, no secret, no client id — only a member
// id, a client HASH, the issuing origin, timestamps, the current refresh `jti`
// and the revocation flag. Both documents use DOTTED ids, which the public
// reader does not see.
//
// Every write `grantStore.ts` makes is built here, so the schema (step 3) can
// assert "the writer never sets a field outside GRANT_FIELDS" against these
// functions without a Sanity client.

import { randomUUID } from "node:crypto";
import { clientHashOf, sha256Hex } from "./tokens";

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

const GRANT_ID_RE = /^mcpOauthGrant\.[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/** A fresh `mcpOauthGrant.<uuid>` id. */
export function newGrantId(): string {
  return GRANT_ID_PREFIX + randomUUID();
}

/** Exactly the shape `newGrantId` produces. */
export function isGrantId(id: unknown): id is string {
  return typeof id === "string" && GRANT_ID_RE.test(id);
}

export interface NewGrantDocument {
  _id: string;
  _type: typeof MCP_OAUTH_GRANT_TYPE;
  sub: string;
  clientHash: string;
  origin: string;
  createdAt: string;
  currentRefreshJti: string;
  revoked: false;
}

/**
 * The document `createGrant` writes. Takes the client id and stores only its
 * hash, so a raw client id cannot be stored by mistake. `lastRefreshAt`,
 * `revokedAt` and `revokedReason` are absent until a refresh or a revocation.
 */
export function buildGrantDocument(input: {
  id: string;
  sub: string;
  clientId: string;
  origin: string;
  refreshJti: string;
  createdAt: string;
}): NewGrantDocument {
  return {
    _id: input.id,
    _type: MCP_OAUTH_GRANT_TYPE,
    sub: input.sub,
    clientHash: clientHashOf(input.clientId),
    origin: input.origin,
    createdAt: input.createdAt,
    currentRefreshJti: input.refreshJti,
    revoked: false,
  };
}

/** The `set` of a refresh rotation. */
export function buildRefreshRotationPatch(input: { refreshJti: string; at: string }): {
  currentRefreshJti: string;
  lastRefreshAt: string;
} {
  return { currentRefreshJti: input.refreshJti, lastRefreshAt: input.at };
}

/** The `set` of a revocation. */
export function buildRevocationPatch(input: { reason: string; at: string }): {
  revoked: true;
  revokedAt: string;
  revokedReason: string;
} {
  return { revoked: true, revokedAt: input.at, revokedReason: input.reason };
}

/** `mcpOauthCode.<sha256 hex of the code's jti>`. */
export function codeRedemptionId(jti: string): string {
  return CODE_REDEMPTION_ID_PREFIX + sha256Hex(jti);
}

/** The document `redeemCode` creates — `create()` on this deterministic id is the replay guard. */
export function buildCodeRedemptionDocument(input: { jti: string; redeemedAt: string }): {
  _id: string;
  _type: typeof MCP_OAUTH_CODE_REDEMPTION_TYPE;
  redeemedAt: string;
} {
  return { _id: codeRedemptionId(input.jti), _type: MCP_OAUTH_CODE_REDEMPTION_TYPE, redeemedAt: input.redeemedAt };
}

/** A grant as read back from the dataset. */
export interface StoredGrant {
  _id: string;
  _rev: string;
  sub: string;
  clientHash: string;
  origin: string;
  createdAt: string | null;
  lastRefreshAt: string | null;
  currentRefreshJti: string;
  /** True unless the stored flag is exactly `false` (fail closed). */
  revoked: boolean;
}

function nonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.length > 0;
}

/**
 * Parse a fetched grant. A missing or malformed document → null (the store
 * treats null as revoked, so deleting OAuth documents can only ever shut
 * access). `revoked` is false only when the stored flag is exactly `false`.
 */
export function parseGrantDocument(raw: unknown): StoredGrant | null {
  if (!raw || typeof raw !== "object") return null;
  const d = raw as Record<string, unknown>;
  if (
    !nonEmptyString(d._id) ||
    !nonEmptyString(d._rev) ||
    !nonEmptyString(d.sub) ||
    !nonEmptyString(d.clientHash) ||
    !nonEmptyString(d.origin) ||
    !nonEmptyString(d.currentRefreshJti)
  ) {
    return null;
  }
  return {
    _id: d._id,
    _rev: d._rev,
    sub: d.sub,
    clientHash: d.clientHash,
    origin: d.origin,
    createdAt: typeof d.createdAt === "string" ? d.createdAt : null,
    lastRefreshAt: typeof d.lastRefreshAt === "string" ? d.lastRefreshAt : null,
    currentRefreshJti: d.currentRefreshJti,
    revoked: d.revoked !== false,
  };
}
