// Native-app sign-in — the two document shapes, as pure builders and a
// fail-closed parser (ADR-0091, spec D6). Everything stored is treated as
// public: a member id, the PUBLIC client id, the platform, the issuing origin,
// timestamps, the current refresh `jti` and the revocation flag. Dotted ids, so
// the public reader never sees them.

import { createHash, randomUUID } from "node:crypto";
import {
  APP_AUTH_CODE_REDEMPTION_TYPE,
  APP_AUTH_GRANT_TYPE,
  APP_CODE_REDEMPTION_ID_PREFIX,
  APP_GRANT_ID_PREFIX,
} from "./documentTypes";
import { isAppClientId, platformOf, type AppClientId, type AppPlatform } from "./clients";

const APP_GRANT_ID_RE = /^appAuthGrant\.[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

export function newAppGrantId(): string {
  return APP_GRANT_ID_PREFIX + randomUUID();
}

/** Exactly the shape `newAppGrantId` produces — also the type pin of every route that takes a grant id. */
export function isAppGrantId(id: unknown): id is string {
  return typeof id === "string" && APP_GRANT_ID_RE.test(id);
}

export interface AppGrant {
  _id: string;
  _rev: string;
  sub: string;
  clientId: AppClientId;
  platform: AppPlatform;
  origin: string;
  createdAt: string | null;
  lastRefreshAt: string | null;
  currentRefreshJti: string;
  /** True unless the stored flag is exactly `false` (fail closed). */
  revoked: boolean;
}

export const APP_GRANT_READ_FIELDS = [
  "_id",
  "_rev",
  "sub",
  "clientId",
  "platform",
  "origin",
  "createdAt",
  "lastRefreshAt",
  "currentRefreshJti",
  "revoked",
] as const;

export function buildAppGrantDocument(input: {
  id: string;
  sub: string;
  clientId: AppClientId;
  origin: string;
  refreshJti: string;
  createdAt: string;
}) {
  return {
    _id: input.id,
    _type: APP_AUTH_GRANT_TYPE,
    sub: input.sub,
    clientId: input.clientId,
    platform: platformOf(input.clientId),
    origin: input.origin,
    createdAt: input.createdAt,
    currentRefreshJti: input.refreshJti,
    revoked: false as const,
  };
}

export function buildAppRefreshRotationPatch(input: { refreshJti: string; at: string }) {
  return { currentRefreshJti: input.refreshJti, lastRefreshAt: input.at };
}

export function buildAppRevocationPatch(input: { reason: string; at: string }) {
  return { revoked: true as const, revokedAt: input.at, revokedReason: input.reason };
}

export function buildAppCodeRedemptionDocument(input: { jti: string; redeemedAt: string }) {
  return {
    _id: APP_CODE_REDEMPTION_ID_PREFIX + createHash("sha256").update(input.jti, "utf8").digest("hex"),
    _type: APP_AUTH_CODE_REDEMPTION_TYPE,
    redeemedAt: input.redeemedAt,
  };
}

function nonEmpty(value: unknown): value is string {
  return typeof value === "string" && value.length > 0;
}

/**
 * A fetched grant, or null when missing or malformed (the store reads null as
 * revoked). An unknown `clientId`, or a `platform` that disagrees with it, is
 * malformed.
 */
export function parseAppGrantDocument(raw: unknown): AppGrant | null {
  if (!raw || typeof raw !== "object") return null;
  const d = raw as Record<string, unknown>;
  if (!isAppGrantId(d._id) || !nonEmpty(d._rev) || !nonEmpty(d.sub) || !nonEmpty(d.origin) || !nonEmpty(d.currentRefreshJti)) {
    return null;
  }
  if (!isAppClientId(d.clientId) || d.platform !== platformOf(d.clientId)) return null;
  return {
    _id: d._id,
    _rev: d._rev,
    sub: d.sub,
    clientId: d.clientId,
    platform: platformOf(d.clientId),
    origin: d.origin,
    createdAt: typeof d.createdAt === "string" ? d.createdAt : null,
    lastRefreshAt: typeof d.lastRefreshAt === "string" ? d.lastRefreshAt : null,
    currentRefreshJti: d.currentRefreshJti,
    revoked: d.revoked !== false,
  };
}
