// MCP OAuth core — the ONE preflight every OAuth and MCP route runs first
// (discovery, registration, authorize, token and the MCP endpoint), from the
// commit that creates the route.

import { type OAuthEnv, loadSecret, resolveOrigin, resourceFor } from "./origin";
import { notFoundResponse, unavailableResponse } from "./responses";

export type McpPreflight =
  | {
      ok: true;
      /** The canonical origin of this deployment — the issuer, always. */
      origin: string;
      /** `resourceFor(origin)` — the only audience this server issues or accepts. */
      resource: string;
      /** HS256 key bytes of `MCP_OAUTH_SECRET` (≥ 32 bytes). */
      key: Uint8Array;
    }
  | { ok: false; response: Response };

/**
 * Applied IN THIS ORDER, first refusal wins:
 *  1. `MCP_DISABLED` non-empty (any value, "0" included) → 503 — the kill
 *     switch (spec O2) answers before anything else is looked at;
 *  2. `Host` is not this deployment's canonical host → 404;
 *  3. `MCP_OAUTH_SECRET` missing or < 32 bytes → 503 (fail closed).
 * A route returns `response` verbatim on `ok: false`.
 */
export function mcpRoutePreflight(request: Request, env: OAuthEnv = process.env): McpPreflight {
  if ((env.MCP_DISABLED ?? "") !== "") return { ok: false, response: unavailableResponse() };
  const origin = resolveOrigin(request, env);
  if (!origin) return { ok: false, response: notFoundResponse() };
  const secret = loadSecret(env);
  if (!secret.ok) return { ok: false, response: unavailableResponse() };
  return { ok: true, origin, resource: resourceFor(origin), key: secret.key };
}
