// app/api/oauth/register/route.ts
//
// RFC 7591 dynamic client registration — STATELESS (P0 plan step 6, spec's
// registration ADR). The client id IS the signed token `signClientId` mints;
// nothing is written to Sanity, so there is no unauthenticated write and no
// cap to exhaust. Reached publicly: excluded from the session middleware at
// the exact path `api/oauth/register$` (`app/utils/routeMatcher.ts`, P0 step
// 5), because this is the first endpoint that accepts input from anyone on
// the internet without a session — every input is validated before it does
// anything with it, and the handler never imports `writeClient` or the grant
// store, not even transitively for types.

import { mcpRoutePreflight } from "@/app/mcp/oauth/guard";
import { registrationErrorResponse, jsonNoStore } from "@/app/mcp/oauth/responses";
import { isRedirectUriAllowed, shouldLogRefusedRedirect } from "@/app/mcp/oauth/redirects";
import { signClientId } from "@/app/mcp/oauth/tokens";

export const dynamic = "force-dynamic";
export const revalidate = 0;

/** RFC 7591 hard cap on this route's request body (spec O3: nothing is kept, so no store cap applies). */
const MAX_BODY_BYTES = 4096;
const MIN_REDIRECT_URIS = 1;
const MAX_REDIRECT_URIS = 5;
const MAX_CLIENT_NAME_LENGTH = 200;

/** What this server supports — stated in every 201, never negotiated with the caller (R14). */
const SUPPORTED_GRANT_TYPES = ["authorization_code", "refresh_token"] as const;
const SUPPORTED_RESPONSE_TYPES = ["code"] as const;

// `client_name` is shown to a super-admin at consent time (unverified), so it
// must reject anything that can reorder or hide what they read — not just
// C0/C1 control characters (`\p{Cc}`, which the old `[\x00-\x1F\x7F]` only
// half-covered: it caught C0 but not C1 codes like U+0085/U+009B) but format
// characters (`\p{Cf}`, which includes the bidi override U+202E) and the two
// Unicode LINE/PARAGRAPH separators (U+2028/U+2029, category Zl/Zp — Unicode
// does not classify them as Cc or Cf, but they are exactly the same class of
// problem: an invisible way to inject a line break into rendered text).
const CONTROL_OR_FORMAT_CHAR_RE = /[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/u;

function isJsonContentType(header: string | null): boolean {
  if (!header) return false;
  // Ignore parameters (e.g. `; charset=utf-8`) — many JSON-posting HTTP
  // clients add one, and the media type is what matters here.
  const mediaType = header.split(";")[0]?.trim().toLowerCase();
  return mediaType === "application/json";
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((v) => typeof v === "string");
}

type BodyReadResult = { ok: true; bytes: Uint8Array } | { ok: false };

/**
 * Reads the request body, aborting the moment more than `maxBytes` have
 * arrived — the cap applies to what is actually read off the wire, never only
 * to a caller-supplied `Content-Length` (which the route also checks, early
 * and separately, so an obviously oversized declared length is refused
 * without reading anything).
 */
async function readCappedBody(request: Request, maxBytes: number): Promise<BodyReadResult> {
  const reader = request.body?.getReader();
  if (!reader) return { ok: true, bytes: new Uint8Array(0) };
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    if (value && value.byteLength > 0) {
      total += value.byteLength;
      if (total > maxBytes) {
        await reader.cancel().catch(() => {});
        return { ok: false };
      }
      chunks.push(value);
    }
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return { ok: true, bytes };
}

export async function POST(request: Request): Promise<Response> {
  const preflight = mcpRoutePreflight(request);
  if (!preflight.ok) return preflight.response;
  const { origin, key } = preflight;

  if (!isJsonContentType(request.headers.get("content-type"))) {
    return registrationErrorResponse("invalid_client_metadata", "Content-Type must be application/json");
  }

  // Refuse early on an over-cap DECLARED length, before reading anything.
  const declaredLength = request.headers.get("content-length");
  if (declaredLength !== null) {
    const n = Number(declaredLength);
    if (Number.isFinite(n) && n > MAX_BODY_BYTES) {
      return registrationErrorResponse("invalid_client_metadata", "request body too large");
    }
  }

  const bodyRead = await readCappedBody(request, MAX_BODY_BYTES);
  if (!bodyRead.ok) {
    return registrationErrorResponse("invalid_client_metadata", "request body too large");
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(new TextDecoder().decode(bodyRead.bytes));
  } catch {
    return registrationErrorResponse("invalid_client_metadata", "malformed JSON");
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    return registrationErrorResponse("invalid_client_metadata", "request body must be a JSON object");
  }
  const body = parsed as Record<string, unknown>;

  // redirect_uris: 1–5 strings, every one on this origin's allowlist.
  const redirectUris = body.redirect_uris;
  if (
    !Array.isArray(redirectUris) ||
    redirectUris.length < MIN_REDIRECT_URIS ||
    redirectUris.length > MAX_REDIRECT_URIS ||
    !redirectUris.every((u): u is string => typeof u === "string")
  ) {
    return registrationErrorResponse("invalid_client_metadata", "redirect_uris must be an array of 1-5 strings");
  }
  // Check every URI — never short-circuit on the first refusal — so a claude
  // host near-miss later in the array still gets logged even when an earlier
  // URI (e.g. a loopback refused on production) is what's refused first. At
  // most one line per request: only the FIRST refused URI that
  // `shouldLogRefusedRedirect` accepts is logged.
  let hasRefusedUri = false;
  let loggedRefusal = false;
  for (const uri of redirectUris) {
    if (isRedirectUriAllowed(uri, origin)) continue;
    hasRefusedUri = true;
    if (!loggedRefusal && shouldLogRefusedRedirect(uri)) {
      // Never the client_id, never the body — just the refused URI.
      console.warn("[mcp-oauth] refused redirect_uri from a claude host:", JSON.stringify(uri));
      loggedRefusal = true;
    }
  }
  if (hasRefusedUri) {
    return registrationErrorResponse("invalid_redirect_uri");
  }

  // token_endpoint_auth_method: only "none" is ever accepted (public clients).
  const authMethod = body.token_endpoint_auth_method;
  if (authMethod !== undefined && authMethod !== "none") {
    return registrationErrorResponse("invalid_client_metadata", 'token_endpoint_auth_method must be "none"');
  }

  // grant_types / response_types: type-checked only (R14) — never rejected for
  // their CONTENT. The 201 always states what this server actually supports.
  if (body.grant_types !== undefined && !isStringArray(body.grant_types)) {
    return registrationErrorResponse("invalid_client_metadata", "grant_types must be an array of strings");
  }
  if (body.response_types !== undefined && !isStringArray(body.response_types)) {
    return registrationErrorResponse("invalid_client_metadata", "response_types must be an array of strings");
  }

  // client_name: optional, shown unverified on the consent page later — reject
  // anything malformed rather than silently rewrite it. An empty string is
  // treated as ABSENT (no name in the signed token, none echoed) rather than
  // signed as the empty string — there is nothing to show, so there is
  // nothing to validate.
  const clientNameRaw = body.client_name;
  let clientName: string | undefined;
  if (clientNameRaw !== undefined && clientNameRaw !== "") {
    if (
      typeof clientNameRaw !== "string" ||
      clientNameRaw.length > MAX_CLIENT_NAME_LENGTH ||
      CONTROL_OR_FORMAT_CHAR_RE.test(clientNameRaw)
    ) {
      return registrationErrorResponse("invalid_client_metadata", "client_name is invalid");
    }
    clientName = clientNameRaw;
  }

  const now = new Date();
  const issuedAt = Math.floor(now.getTime() / 1000);
  const clientId = await signClientId({
    key,
    origin,
    redirectUris,
    now,
    ...(clientName !== undefined ? { clientName } : {}),
  });

  return jsonNoStore(
    {
      client_id: clientId,
      client_id_issued_at: issuedAt,
      redirect_uris: redirectUris,
      token_endpoint_auth_method: "none",
      grant_types: SUPPORTED_GRANT_TYPES,
      response_types: SUPPORTED_RESPONSE_TYPES,
      ...(clientName !== undefined ? { client_name: clientName } : {}),
    },
    201,
  );
}
