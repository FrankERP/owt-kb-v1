// MCP OAuth core — the two OAuth-state document shapes, as pure builders.
//
// The dataset answers unauthenticated PUBLISHED reads, so everything stored is
// treated as public (spec O5): no token, no secret, no client id — only a member
// id, a client HASH, the issuing origin, the kind of agent it went to
// (`client`, ADR-0083), timestamps, the current refresh `jti` and the
// revocation flag. Both documents use DOTTED ids, which the public
// reader does not see.
//
// Every write `grantStore.ts` makes is built here, so the schema (step 3) can
// assert "the writer never sets a field outside GRANT_FIELDS" against these
// functions without a Sanity client.
//
// The type names, `_id` prefixes and field lists/names themselves live in the
// import-free `./documentTypes` (controller ruling R10), because the two
// Sanity schema files import them directly and a schema file must never drag
// `node:crypto`/`jose` into the embedded Studio bundle. They are re-exported
// here unchanged, so every existing caller of this module keeps working.

import { randomUUID } from "node:crypto";
import { clientHashOf, sha256Hex } from "./tokens";
import { PRODUCTION_ORIGIN } from "./origin";
import type { RedirectTargetKind } from "./redirects";
import {
  CODE_REDEMPTION_FIELD,
  CODE_REDEMPTION_FIELDS,
  CODE_REDEMPTION_ID_PREFIX,
  GRANT_FIELD,
  GRANT_FIELDS,
  GRANT_ID_PREFIX,
  MCP_OAUTH_CODE_REDEMPTION_TYPE,
  MCP_OAUTH_GRANT_TYPE,
  type GrantField,
} from "./documentTypes";

export {
  CODE_REDEMPTION_FIELD,
  CODE_REDEMPTION_FIELDS,
  CODE_REDEMPTION_ID_PREFIX,
  GRANT_FIELD,
  GRANT_FIELDS,
  GRANT_ID_PREFIX,
  MCP_OAUTH_CODE_REDEMPTION_TYPE,
  MCP_OAUTH_GRANT_TYPE,
};
export type { GrantField };

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
  client: RedirectTargetKind;
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
  client: RedirectTargetKind;
  refreshJti: string;
  createdAt: string;
}): NewGrantDocument {
  return {
    _id: input.id,
    _type: MCP_OAUTH_GRANT_TYPE,
    sub: input.sub,
    clientHash: clientHashOf(input.clientId),
    origin: input.origin,
    client: input.client,
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
  /** The stored kind of agent, or null when absent (a grant from before ADR-0083). Read it through `effectiveGrantClient`. */
  client: RedirectTargetKind | null;
  createdAt: string | null;
  lastRefreshAt: string | null;
  currentRefreshJti: string;
  /** True unless the stored flag is exactly `false` (fail closed). */
  revoked: boolean;
}

function nonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.length > 0;
}

const CLIENT_KINDS: readonly RedirectTargetKind[] = ["claude", "chatgpt", "loopback"];

/**
 * The fields `parseGrantDocument` reads — and so the fields the store's grant
 * query MUST project (`grantStore.ts` builds its projection from this list). A
 * field missing from the projection would read back as absent, silently.
 */
export const GRANT_READ_FIELDS = [
  "_id",
  "_rev",
  "sub",
  "clientHash",
  "origin",
  "client",
  "createdAt",
  "lastRefreshAt",
  "currentRefreshJti",
  "revoked",
] as const;

/**
 * The moment before which a production grant with no stored `client` is known
 * to be Claude's: until ADR-0083's release, production accepted only the
 * claude.ai redirect. It must precede the first PRODUCTION deployment of the
 * code that writes `client`, and is set in the commit that goes to `main`.
 */
export const LEGACY_GRANT_CUTOFF = "2026-11-05T18:00:00.000Z";

/**
 * The kind of agent a grant belongs to, for deciding whether it gets the
 * app-only card tools (ADR-0083). The stored `client` when present. When it is
 * absent, `"claude"` ONLY for a production grant created before
 * `LEGACY_GRANT_CUTOFF` — anything else (a newer grant, a dev or local grant, an
 * unreadable `createdAt`) is `"loopback"`, so a read that ever lost `client`
 * again would withhold the app tools, never hand them to another host.
 */
export function effectiveGrantClient(grant: Pick<StoredGrant, "client" | "origin" | "createdAt">): RedirectTargetKind {
  if (grant.client !== null) return grant.client;
  if (grant.origin !== PRODUCTION_ORIGIN || grant.createdAt === null) return "loopback";
  const created = Date.parse(grant.createdAt);
  if (!Number.isFinite(created)) return "loopback";
  return created < Date.parse(LEGACY_GRANT_CUTOFF) ? "claude" : "loopback";
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
  // `client` is absent on a grant from before ADR-0083; any other value is malformed (→ revoked).
  let client: RedirectTargetKind | null = null;
  if (d.client !== undefined && d.client !== null) {
    if (!CLIENT_KINDS.includes(d.client as RedirectTargetKind)) return null;
    client = d.client as RedirectTargetKind;
  }
  return {
    _id: d._id,
    _rev: d._rev,
    sub: d.sub,
    clientHash: d.clientHash,
    origin: d.origin,
    client,
    createdAt: typeof d.createdAt === "string" ? d.createdAt : null,
    lastRefreshAt: typeof d.lastRefreshAt === "string" ? d.lastRefreshAt : null,
    currentRefreshJti: d.currentRefreshJti,
    revoked: d.revoked !== false,
  };
}
