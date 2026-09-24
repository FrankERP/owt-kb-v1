// app/api/mcp/route.ts
//
// The MCP endpoint (P0 plan step 9, spec I6/O2/E1): Streamable HTTP through
// `mcp-handler`, stateless, one tool (`ping`). Ungated by the session
// middleware (`api/mcp(?:/|$)` in `app/utils/routeMatcher.ts`, P0 step 5), so
// it authenticates EVERY request itself, on every method, and nothing reaches
// the MCP server — no `initialize`, no `tools/list`, no tool — until all of
// these hold, in this order:
//
//   1. the preflight (`mcpRoutePreflight`): kill switch → 503, a host that is
//      not this deployment's canonical one → 404, no signing secret → 503;
//   2. a bearer token in the `Authorization` header — the ONLY place one is
//      read; a token in the query string or the body is never looked at;
//   3. the access token verifies: signature, `typ: "at"`, `iss` = this origin,
//      `aud` = this origin's MCP resource, not expired;
//   4. its grant exists and is not revoked (30 s cache — a revocation bites
//      within 30 s, spec O9);
//   5. the grant belongs to the token's subject and to this origin (R13);
//   6. the subject is an existing, non-disabled member whose LIVE role is
//      `super-admin` (`getMemberAccess`, 30 s).
//
// A refusal from step 2 on is a 401 with the RFC 9728 challenge (R7): no
// `error` when no bearer token was presented at all (RFC 6750 §3.1 — that
// includes another scheme and an empty `Bearer`), `error="invalid_token"` for
// everything else. A failure to READ the grant or the member is a fixed 500
// instead: the token is not at fault, and a 401 would send the client off to
// refresh or reconnect for a dataset hiccup. Nothing is echoed and nothing
// here logs a token — a server failure logs a fixed stage name and, at most,
// a numeric status code.

import type { AuthInfo } from "@modelcontextprotocol/server";
import { createMcpHandler } from "mcp-handler";
import { getMemberAccess } from "@/app/utils/memberAccess";
import { loadGrant } from "@/app/mcp/oauth/grantStore";
import { type McpPreflight, mcpRoutePreflight } from "@/app/mcp/oauth/guard";
import { resourceMetadataUrl } from "@/app/mcp/oauth/origin";
import { jsonNoStore, mcpUnauthorizedResponse } from "@/app/mcp/oauth/responses";
import { verifyAccessToken } from "@/app/mcp/oauth/tokens";
import { MCP_SERVER_NAME, mcpServerVersion } from "@/app/mcp/serverInfo";
import { registerPing } from "@/app/mcp/tools/ping";

export const dynamic = "force-dynamic";
export const revalidate = 0;

/** Read once per instance: the commit is fixed for the life of a deployment (R22). */
const SERVER_INFO = { name: MCP_SERVER_NAME, version: mcpServerVersion() };

/**
 * Built ONCE per module. `mcp-handler` still creates a fresh `McpServer` per
 * request and runs this init on it — stateless, nothing shared between
 * callers. One `register<Tool>` call per tool file in `app/mcp/tools/`.
 */
const mcpHandler = createMcpHandler(
  (server) => {
    registerPing(server, { version: SERVER_INFO.version });
  },
  { serverInfo: SERVER_INFO },
);

/**
 * `AuthInfo.token` is a required string in the SDK's type, but neither the SDK
 * nor `mcp-handler` ever reads it, so the raw bearer never leaves this route:
 * the principal travels as `clientId`/`extra`, and `token` carries this marker.
 */
const REDACTED_TOKEN = "[redacted]";

/** RFC 6750 §2.1 `b64token`. A JWT (base64url segments and dots) always matches. */
const B64TOKEN_RE = /^[A-Za-z0-9\-._~+/]+=*$/;

type PresentedBearer = { kind: "absent" } | { kind: "malformed" } | { kind: "token"; token: string };

/**
 * The bearer token from the `Authorization` header — the only place one is
 * accepted. No header, another scheme, or `Bearer` with nothing after it are
 * all "no bearer token presented"; a credential that is not a `b64token` is
 * malformed. The scheme is case-insensitive (RFC 7235 §2.1).
 */
function presentedBearer(request: Request): PresentedBearer {
  const header = request.headers.get("authorization");
  if (header === null) return { kind: "absent" };
  const value = header.trim();
  const gap = value.search(/\s/);
  const scheme = gap === -1 ? value : value.slice(0, gap);
  if (scheme.toLowerCase() !== "bearer") return { kind: "absent" };
  const credentials = gap === -1 ? "" : value.slice(gap).trim();
  if (credentials === "") return { kind: "absent" };
  if (!B64TOKEN_RE.test(credentials)) return { kind: "malformed" };
  return { kind: "token", token: credentials };
}

/** A fixed 500: a stage name and, when the cause has one, a numeric status code — never the error. */
function serverError(stage: "grant read" | "member lookup" | "unexpected", cause?: unknown): Response {
  const status =
    typeof cause === "object" && cause !== null && typeof (cause as { statusCode?: unknown }).statusCode === "number"
      ? (cause as { statusCode: number }).statusCode
      : null;
  console.error(`[mcp] route: ${stage} failure${status !== null ? ` (status ${status})` : ""}`);
  return jsonNoStore({ error: "server_error" }, 500);
}

type Authentication = { ok: true; authInfo: AuthInfo } | { ok: false; response: Response };

/** Steps 2–6 of the header comment. Only `ok: true` lets a request reach the MCP server. */
async function authenticate(
  request: Request,
  preflight: Extract<McpPreflight, { ok: true }>,
): Promise<Authentication> {
  const { origin, key, resource } = preflight;
  const unauthorized = (cause: "no_token" | "invalid_token"): Authentication => ({
    ok: false,
    response: mcpUnauthorizedResponse(origin, cause),
  });

  // 2. The bearer token, from the Authorization header only.
  const bearer = presentedBearer(request);
  if (bearer.kind === "absent") return unauthorized("no_token");
  if (bearer.kind === "malformed") return unauthorized("invalid_token");

  // 3. The access token: signature, typ, iss, aud, exp.
  const verified = await verifyAccessToken(bearer.token, { key, origin });
  if (!verified.ok) return unauthorized("invalid_token");
  const claims = verified.claims;

  // 4. The grant, from the 30 s cache: missing, malformed and revoked all read as revoked.
  const lookup = await loadGrant(claims.grantId);
  if (!lookup.ok) {
    return lookup.reason === "revoked"
      ? unauthorized("invalid_token")
      : { ok: false, response: serverError("grant read", lookup.cause) };
  }
  const grant = lookup.grant;

  // 5. R13: the grant is the token's subject's, and was issued on this origin.
  if (grant.sub !== claims.sub || grant.origin !== origin) return unauthorized("invalid_token");

  // 6. O2: the subject is still an existing, non-disabled super-admin.
  let access: Awaited<ReturnType<typeof getMemberAccess>>;
  try {
    access = await getMemberAccess(claims.sub);
  } catch {
    return { ok: false, response: serverError("member lookup") };
  }
  if (!access.active || access.role !== "super-admin") return unauthorized("invalid_token");

  return {
    ok: true,
    authInfo: {
      token: REDACTED_TOKEN,
      clientId: grant.clientHash,
      scopes: [],
      expiresAt: claims.expiresAt,
      resource: new URL(resource),
      resourceMetadataUrl: resourceMetadataUrl(origin),
      extra: { sub: claims.sub, grantId: grant._id },
    },
  };
}

async function handle(request: Request): Promise<Response> {
  try {
    // 1. The one preflight: kill switch → 503, foreign host → 404, no secret → 503.
    const preflight = mcpRoutePreflight(request);
    if (!preflight.ok) return preflight.response;

    // 2–6. The bearer check. Nothing below runs unless it passes.
    const auth = await authenticate(request, preflight);
    if (!auth.ok) return auth.response;

    // `mcp-handler` hands `request.auth` to the SDK, which gives it to tools
    // as `ctx.http.authInfo` — the same thing its own `withMcpAuth` does. Set
    // only here, after every check has passed.
    request.auth = auth.authInfo;
    return await mcpHandler(request);
  } catch {
    // Never echo or log the error: it may carry request data.
    return serverError("unexpected");
  }
}

export const GET = handle;
export const POST = handle;
export const DELETE = handle;
