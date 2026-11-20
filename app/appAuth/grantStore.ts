import "server-only";

// Native-app sign-in — the grant store: the only code that reads or writes app
// sign-in state in Sanity (ADR-0091, spec D6). The protocol (cache, fresh reads,
// rotation with reuse detection, revocation, single-use codes, the live list
// and the all-or-none revoke) is `app/oauthCore/grantStoreProtocol.ts`, shared
// with the MCP connector; this module is the app family's instance.
//
// Fail closed on a missing token (spec §10 A5): the grant documents have dotted
// ids, which an UNTOKENED read answers as «no record» with no error — and «no
// record» reads as revoked, which would sign every phone out. So every call
// refuses as `server_error` (→ 503) when the write token is absent.

import { writeClient } from "@/sanity/lib/serverClient";
import {
  createGrantStore,
  type Fresh,
  type GrantLookup,
  type GrantStoreFailure,
  type LiveGrantRow,
  type ProtocolClient,
  type RotateRefreshResult,
} from "@/app/oauthCore/grantStoreProtocol";
import { APP_AUTH_GRANT_TYPE } from "./documentTypes";
import {
  APP_GRANT_READ_FIELDS,
  buildAppCodeRedemptionDocument,
  buildAppGrantDocument,
  buildAppRefreshRotationPatch,
  buildAppRevocationPatch,
  isAppGrantId,
  newAppGrantId,
  parseAppGrantDocument,
  type AppGrant,
} from "./grantDocument";
import type { AppClientId } from "./clients";
import { APP_REFRESH_TOKEN_TTL_SECONDS } from "./tokens";

export type { AppGrant, GrantLookup, GrantStoreFailure, LiveGrantRow, RotateRefreshResult };
export type FreshAppGrant = Fresh<AppGrant>;

/** Revocation reasons this door writes. */
export const APP_REVOKE_REASON = {
  signOut: "app_sign_out",
  member: "member_revoked",
  admin: "admin_revoked",
} as const;

const store = createGrantStore<AppGrant, { sub: string; clientId: AppClientId; origin: string }>(
  writeClient as unknown as ProtocolClient,
  {
    grantType: APP_AUTH_GRANT_TYPE,
    isGrantId: isAppGrantId,
    newGrantId: newAppGrantId,
    readFields: APP_GRANT_READ_FIELDS,
    buildGrantDocument: buildAppGrantDocument,
    parseGrantDocument: parseAppGrantDocument,
    buildRefreshRotationPatch: buildAppRefreshRotationPatch,
    buildRevocationPatch: buildAppRevocationPatch,
    buildCodeRedemptionDocument: buildAppCodeRedemptionDocument,
    refreshLifetimeMs: APP_REFRESH_TOKEN_TTL_SECONDS * 1000,
  },
);

/** Read at call time, so a test can set it per case. */
function missingToken(): GrantStoreFailure | null {
  return (process.env.SANITY_WRITE_TOKEN ?? "") === ""
    ? { ok: false, reason: "server_error", cause: new Error("SANITY_WRITE_TOKEN is not set") }
    : null;
}

/** For tests only. */
export function __clearAppGrantCache() {
  store.clearCache();
}

export async function createAppGrant(input: { sub: string; clientId: AppClientId; origin: string }) {
  return missingToken() ?? store.createGrant(input);
}

export function loadAppGrant(id: string, opts: { fresh: true }): Promise<GrantLookup<FreshAppGrant>>;
export function loadAppGrant(id: string, opts?: { fresh?: boolean }): Promise<GrantLookup<AppGrant>>;
export async function loadAppGrant(id: string, opts?: { fresh?: boolean }): Promise<GrantLookup<AppGrant>> {
  return missingToken() ?? store.loadGrant(id, opts);
}

export async function rotateAppRefresh(grant: FreshAppGrant, presentedJti: string, origin: string): Promise<RotateRefreshResult> {
  return missingToken() ?? store.rotateRefresh(grant, presentedJti, origin);
}

export async function revokeAppGrant(id: string, reason: string): Promise<{ ok: true } | GrantStoreFailure> {
  return missingToken() ?? store.revokeGrant(id, reason);
}

export async function redeemAppCode(jti: string) {
  return missingToken() ?? store.redeemCode(jti);
}

/** The LIVE grants of a person on this origin, newest use first («Apps conectadas»). */
export async function listLiveAppGrants(sub: string, origin: string, now: Date = new Date()) {
  return missingToken() ?? store.listLiveGrants(sub, origin, { now, labelField: "platform" });
}

/** Revoke every live grant of a person on this origin, all or none. */
export async function revokeAllAppGrants(sub: string, origin: string, reason: string, now: Date = new Date()) {
  return missingToken() ?? store.revokeAllGrants(sub, origin, reason, { now });
}
