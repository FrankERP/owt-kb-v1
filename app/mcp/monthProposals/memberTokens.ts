import "server-only";

// Member tokens (MCP proposal editor plan T1.3, A5): the editing screen names a person back to the
// server, and no member id may cross the wire (KH-1, `monthToolHygiene.test.ts`). A member crosses
// as HMAC-SHA256(`MCP_OAUTH_SECRET`, "mcp-member-token|" + root + "|" + memberId), truncated to 128
// bits, base64url: opaque, stable for one lineage (`root` is its revision-1 handle, signed into
// every revision's header) and different in every other lineage, so a token learned from one
// proposal names nobody in another.
//
// The label keeps this use apart from the secret's OAuth use (HS256 over JWTs): key separation,
// not key reuse. Rotating the secret invalidates the tokens of open screens only; they reload
// (`docs/SECRETS.md`).
//
// Stateless: the server reverses a token by recomputing it over the ids it may name — the pool
// plus the board's seated ids, so a seated member who left the pool can still be cleared.

import { createHmac } from "node:crypto";

import { loadSecret } from "../oauth/origin";

const LABEL = "mcp-member-token|";
export const MEMBER_TOKEN_RE = /^[A-Za-z0-9_-]{22}$/;

export type MemberTokenKey = { ok: true; key: Uint8Array } | { ok: false };

/** The secret, or `{ ok: false }` when it is missing or short — the editor's tools then refuse. */
export function memberTokenKey(env: Readonly<Record<string, string | undefined>> = process.env): MemberTokenKey {
  return loadSecret(env);
}

export function memberToken(key: Uint8Array, root: string, memberId: string): string {
  return createHmac("sha256", key).update(`${LABEL}${root}|${memberId}`, "utf8").digest().subarray(0, 16).toString("base64url");
}

/** Both directions over the ids this call may name; a token outside them resolves to nobody. */
export interface MemberTokens {
  tokenOf(memberId: string): string;
  idOf(token: string): string | null;
}

export function memberTokens(key: Uint8Array, root: string, ids: Iterable<string>): MemberTokens {
  const byId = new Map<string, string>();
  const byToken = new Map<string, string>();
  for (const id of ids) {
    if (byId.has(id)) continue;
    const t = memberToken(key, root, id);
    byId.set(id, t);
    byToken.set(t, id);
  }
  return {
    tokenOf: (id) => byId.get(id) ?? memberToken(key, root, id),
    idOf: (token) => (MEMBER_TOKEN_RE.test(token) ? (byToken.get(token) ?? null) : null),
  };
}
