import "server-only";

// The three HMACs of the saved-month editor (admin parity phase 1, F3, F5, F6), each under
// `MCP_OAUTH_SECRET` with its own label — key separation, not key reuse (as `memberTokens.ts`):
//
//   · the month-scoped member token (F6): `memberTokens` with root `month|YYYY-MM`, so the input
//     is "mcp-member-token|month|" + YYYY-MM + "|" + memberId. A proposal's root is a handle, never
//     `month|…`, so a proposal token names nobody here and the reverse;
//   · the waiver token (F5): "mcp-service-waiver|" + service + "|" + baseRev + "|" + the finding key
//     + "|" + the rule's wording. Minted only by the app-only check when Frank answers «Asignar de
//     todos modos»; binding `baseRev` makes a token die with the write it was minted for, and the
//     wording makes it die with a reworded rule;
//   · the change-set MAC (F3): "mcp-service-change|" + the canonical JSON of {service, baseRev,
//     target, diff} as they cross the wire. A «ya estaba» service's base is gone, so its signed diff
//     is the only record of what it changed — the save trusts it for grouping only because of this.
//
// Rotating the secret invalidates every pending change set and token: the next save answers
// «revisa de nuevo» (`docs/SECRETS.md`).

import { createHmac, timingSafeEqual } from "node:crypto";

import { findingKeyText, type FindingKey } from "./proposalDocument";
import { memberTokens, type MemberTokens } from "./memberTokens";

const WAIVER_LABEL = "mcp-service-waiver|";
const CHANGE_LABEL = "mcp-service-change|";
export const WAIVER_TOKEN_RE = /^[A-Za-z0-9_-]{22}$/;
export const CHANGE_MAC_RE = /^[A-Za-z0-9_-]{43}$/;

/** The month-scoped tokens (F6) over the ids this call may name. */
export function monthMemberTokens(key: Uint8Array, month: string, ids: Iterable<string>): MemberTokens {
  return memberTokens(key, `month|${month}`, ids);
}

export function waiverToken(key: Uint8Array, input: { service: string; baseRev: string; finding: FindingKey; sentence: string }): string {
  return createHmac("sha256", key)
    .update(`${WAIVER_LABEL}${input.service}|${input.baseRev}|${findingKeyText(input.finding)}|${input.sentence}`, "utf8")
    .digest()
    .subarray(0, 16)
    .toString("base64url");
}

/** JSON with object keys sorted and `undefined` members dropped: one text per value. */
export function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value !== null && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, v]) => v !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonicalJson(v)}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

export function changeMac(key: Uint8Array, change: { service: string; baseRev: string; target: unknown; diff: unknown }): string {
  const body = canonicalJson({ service: change.service, baseRev: change.baseRev, target: change.target, diff: change.diff });
  return createHmac("sha256", key).update(`${CHANGE_LABEL}${body}`, "utf8").digest().toString("base64url");
}

export function sameMac(given: string, expected: string): boolean {
  if (!CHANGE_MAC_RE.test(given)) return false;
  const a = Buffer.from(given);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}
