// MCP OAuth core — the origin this deployment serves, its one resource, and the
// signing secret. Pure: no framework, no I/O beyond reading the env it is handed.
//
// ONE DEPLOYMENT, ONE ISSUER (spec I10). The canonical origin is chosen by
// `VERCEL_ENV` and nothing else; the request's `Host` can only MATCH it, never
// choose it. Every other host — the other alias, a per-deployment
// `*.vercel.app` URL, loopback on a Vercel box — is refused, so a deployment
// never advertises or honours another deployment's endpoints, and a token or
// client id minted on dev carries dev's `iss` and fails here even if the two
// secrets were ever equal.

export const PRODUCTION_ORIGIN = "https://owt-backstage.vercel.app";
export const PREVIEW_ORIGIN = "https://dev-owt-backstage.vercel.app";
export const LOCAL_ORIGIN = "http://localhost:3000";

/** Shortest `MCP_OAUTH_SECRET` accepted, in UTF-8 BYTES (HS256 wants ≥ 256 bits). */
export const MIN_SECRET_BYTES = 32;

/** The env shape these helpers read. `process.env` satisfies it. */
export type OAuthEnv = Readonly<Record<string, string | undefined>>;

/**
 * The one origin this deployment serves: production → the production alias,
 * preview → the dev alias, unset/`development` → local. Any other value → null
 * (every host is then refused: fail closed).
 */
export function canonicalOrigin(env: OAuthEnv = process.env): string | null {
  const vercelEnv = env.VERCEL_ENV;
  if (vercelEnv === "production") return PRODUCTION_ORIGIN;
  if (vercelEnv === "preview") return PREVIEW_ORIGIN;
  if (vercelEnv === undefined || vercelEnv === "" || vercelEnv === "development") return LOCAL_ORIGIN;
  return null;
}

/**
 * What the origin check reads from a request: its headers, nothing else. A
 * route handler's `Request` satisfies it, and so does `{ headers: await
 * headers() }` in a Server Component, which has no `Request` (R17).
 */
export type RequestHeadersSource = Pick<Request, "headers">;

/**
 * The canonical origin when the request's `Host` header is exactly the
 * canonical host (port included; case-insensitive), else null. Callers answer
 * 404 on null — use `mcpRoutePreflight`, which does.
 */
export function resolveOrigin(request: RequestHeadersSource, env: OAuthEnv = process.env): string | null {
  const origin = canonicalOrigin(env);
  if (!origin) return null;
  const host = request.headers.get("host");
  if (!host) return null;
  return host.toLowerCase() === new URL(origin).host ? origin : null;
}

/** The one protected resource this authorization server issues tokens for (RFC 8707). */
export function resourceFor(origin: string): string {
  return origin + "/api/mcp";
}

/** RFC 9728 metadata URL for `resourceFor(origin)` (path-suffixed well-known form). */
export function resourceMetadataUrl(origin: string): string {
  return origin + "/.well-known/oauth-protected-resource/api/mcp";
}

export type ResourceResolution =
  | { ok: true; resource: string }
  | { ok: false; error: "invalid_target" };

/**
 * Validate a client-sent RFC 8707 `resource` (a single value or every value of
 * a repeated parameter). Absent → this origin's resource. Present → every value
 * must equal it EXACTLY (no trailing slash, no case folding), else
 * `invalid_target`. The empty string is present, not absent.
 */
export function resolveResource(
  presented: string | readonly string[] | null | undefined,
  origin: string,
): ResourceResolution {
  const resource = resourceFor(origin);
  const values = presented == null ? [] : typeof presented === "string" ? [presented] : presented;
  for (const value of values) {
    if (value !== resource) return { ok: false, error: "invalid_target" };
  }
  return { ok: true, resource };
}

export type SecretLoad = { ok: true; key: Uint8Array } | { ok: false };

/**
 * The HS256 key: the UTF-8 bytes of `MCP_OAUTH_SECRET`, used verbatim (never
 * trimmed). Missing or shorter than `MIN_SECRET_BYTES` bytes → `{ ok: false }`,
 * so an empty or weak key can never sign or verify anything.
 */
export function loadSecret(env: OAuthEnv = process.env): SecretLoad {
  const raw = env.MCP_OAUTH_SECRET;
  if (typeof raw !== "string") return { ok: false };
  const key = new TextEncoder().encode(raw);
  if (key.byteLength < MIN_SECRET_BYTES) return { ok: false };
  return { ok: true, key };
}
