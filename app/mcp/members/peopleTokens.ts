import "server-only";

// The HMACs of the people tools (admin parity phase 4, slice M, D3/D7), under `MCP_OAUTH_SECRET` with
// their own labels — key separation, as `changeSetTokens.ts` and `songTokens.ts`.
//
// Both tokens are `<iat>.<call>.<result>`:
//
//   · `call`   binds WHO and WHAT was asked, and when: the person (or the batch) and the edits, with the
//              issue time. It is verified FIRST (§7.6), before anything is re-rendered, so a retry after
//              a save that landed can answer «ya estaba guardado» / «ya estaban» without its lines —
//              which no longer match, because the change is now the stored state;
//   · `result` binds what the check SHOWED: the same plus its rendered lines (the before/after, every
//              rule D6 renames, every D12 warning). The save re-renders them from a fresh read and
//              refuses on any difference, so a rule added or a field changed between check and save
//              cannot be written unseen.
//
// A token dies `PEOPLE_TOKEN_TTL_S` after issue. A create's person `i` gets the id
// `HMAC(key, "mcp-member-id|" + token + "|" + i)`, first 128 bits, written as a UUID (every member id
// is one), so a retry after an unknown outcome names the same documents and never makes a second
// account (D7).
//
// Rotating the secret voids every pending people check: the save answers «vuelve a revisar»
// (`docs/SECRETS.md`).

import { createHmac } from "node:crypto";

import { canonicalJson, sameMac } from "../monthProposals/changeSetTokens";

const EDITS_CALL = "mcp-member-edits-call|";
const EDITS_RESULT = "mcp-member-edits|";
const CREATE_CALL = "mcp-member-create-call|";
const CREATE_RESULT = "mcp-member-create|";
const ID_LABEL = "mcp-member-id|";

/** How long a people check stays good, in seconds. */
export const PEOPLE_TOKEN_TTL_S = 30 * 60;

function mac(key: Uint8Array, label: string, iat: number, value: unknown): string {
  return createHmac("sha256", key).update(`${label}${iat}|${canonicalJson(value)}`, "utf8").digest().toString("base64url");
}

export type TokenCall = { ok: true; iat: number; expired: boolean } | { ok: false };

function checkCall(key: Uint8Array, token: string, label: string, value: unknown, nowS: number): TokenCall {
  const [iatText, call, result, extra] = token.split(".");
  if (extra !== undefined || !iatText || !call || !result || !/^\d{1,12}$/.test(iatText)) return { ok: false };
  const iat = Number(iatText);
  if (!sameMac(call, mac(key, label, iat, value))) return { ok: false };
  return { ok: true, iat, expired: nowS - iat > PEOPLE_TOKEN_TTL_S || iat - nowS > 60 };
}

function sameResult(key: Uint8Array, token: string, label: string, value: unknown): boolean {
  const [iatText, , result] = token.split(".");
  if (!iatText || !result || !/^\d{1,12}$/.test(iatText)) return false;
  return sameMac(result, mac(key, label, Number(iatText), value));
}

// ── Edits (check_member_changes → save_member_changes) ───────────────────────

export interface MemberEditsCall {
  memberId: string;
  edits: unknown;
}

export function memberEditsToken(key: Uint8Array, input: MemberEditsCall & { lines: readonly string[] }, nowS: number): string {
  const call = { memberId: input.memberId, edits: input.edits };
  return `${nowS}.${mac(key, EDITS_CALL, nowS, call)}.${mac(key, EDITS_RESULT, nowS, { ...call, lines: input.lines })}`;
}

export function checkMemberEditsCall(key: Uint8Array, token: string, input: MemberEditsCall, nowS: number): TokenCall {
  return checkCall(key, token, EDITS_CALL, { memberId: input.memberId, edits: input.edits }, nowS);
}

export function sameMemberEditsResult(key: Uint8Array, token: string, input: MemberEditsCall & { lines: readonly string[] }): boolean {
  return sameResult(key, token, EDITS_RESULT, { memberId: input.memberId, edits: input.edits, lines: input.lines });
}

// ── Create (check_new_members → create_members) ──────────────────────────────

export function memberCreateToken(key: Uint8Array, input: { batch: unknown; lines: readonly string[] }, nowS: number): string {
  return `${nowS}.${mac(key, CREATE_CALL, nowS, { batch: input.batch })}.${mac(key, CREATE_RESULT, nowS, { batch: input.batch, lines: input.lines })}`;
}

export function checkMemberCreateCall(key: Uint8Array, token: string, batch: unknown, nowS: number): TokenCall {
  return checkCall(key, token, CREATE_CALL, { batch }, nowS);
}

export function sameMemberCreateResult(key: Uint8Array, token: string, input: { batch: unknown; lines: readonly string[] }): boolean {
  return sameResult(key, token, CREATE_RESULT, { batch: input.batch, lines: input.lines });
}

/** Person `i`'s id: the first 128 bits of the id HMAC, as a UUID (version and variant bits set). */
export function memberCreateIds(key: Uint8Array, token: string, count: number): string[] {
  return Array.from({ length: count }, (_, i) => {
    const b = createHmac("sha256", key).update(`${ID_LABEL}${token}|${i}`, "utf8").digest().subarray(0, 16);
    b[6] = (b[6] & 0x0f) | 0x40;
    b[8] = (b[8] & 0x3f) | 0x80;
    const h = b.toString("hex");
    return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
  });
}
