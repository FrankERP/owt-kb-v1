import "server-only";

// The HMACs of the rule tools (admin parity phase 4, slice R; ADR-0084), under `MCP_OAUTH_SECRET` with
// their own labels — key separation, as `peopleTokens.ts` and `songTokens.ts`.
//
// The check's token is `<iat>.<mac>`, the MAC over `{rev, edits, lines}` with the issue time inside it (R7).
// One MAC, not slice M's two halves: the rules document's `_rev` moves only when the rules are saved, so a
// save that landed answers «no cambiaría nada» on its own (its lines are empty) and needs no «ya estaba
// guardado» path. `rev` travels only inside the MAC — never in a line or the tool's text (KH-1).
//
// New rule items take `<prefix>-` + 12 hex of HMAC(`mcp-rule-ids|rev|edits|i/j`) (R8). The ids do NOT
// depend on the token, so the check (which has none yet) and the save build the same document.
//
// Rotating the secret voids every pending rules check: the save answers «vuelve a revisar»
// (`docs/SECRETS.md`).

import { createHmac } from "node:crypto";

import type { NewRuleId, RuleEdit } from "@/app/utils/ruleEdits";
import { canonicalJson, sameMac } from "../monthProposals/changeSetTokens";

const TOKEN_LABEL = "mcp-rule-edits|";
const ID_LABEL = "mcp-rule-ids|";

/** How long a rules check stays good, in seconds. */
export const RULE_TOKEN_TTL_S = 30 * 60;

export interface RuleEditsBinding {
  rev: string;
  edits: readonly RuleEdit[];
  lines: readonly string[];
}

function mac(key: Uint8Array, iat: number, b: RuleEditsBinding): string {
  return createHmac("sha256", key)
    .update(`${TOKEN_LABEL}${iat}|${canonicalJson({ rev: b.rev, edits: b.edits, lines: b.lines })}`, "utf8")
    .digest()
    .toString("base64url");
}

export function ruleEditsToken(key: Uint8Array, b: RuleEditsBinding, nowS: number): string {
  return `${nowS}.${mac(key, nowS, b)}`;
}

export type RuleTokenCheck = { ok: true; expired: boolean } | { ok: false };

/** The token against a fresh `{rev, edits, lines}`: any difference, or a malformed token, is `ok: false`. */
export function checkRuleEditsToken(key: Uint8Array, token: string, b: RuleEditsBinding, nowS: number): RuleTokenCheck {
  const [iatText, given, extra] = token.split(".");
  if (extra !== undefined || !iatText || !given || !/^\d{1,12}$/.test(iatText)) return { ok: false };
  const iat = Number(iatText);
  if (!sameMac(given, mac(key, iat, b))) return { ok: false };
  return { ok: true, expired: nowS - iat > RULE_TOKEN_TTL_S || iat - nowS > 60 };
}

/** R8: the id maker for one `(rev, edits)`. */
export function ruleItemIds(key: Uint8Array, edits: readonly RuleEdit[]): (rev: string) => NewRuleId {
  const body = canonicalJson(edits);
  return (rev) => (prefix, i, j) =>
    `${prefix}-${createHmac("sha256", key).update(`${ID_LABEL}${rev}|${body}|${i}/${j}`, "utf8").digest().toString("hex").slice(0, 12)}`;
}
