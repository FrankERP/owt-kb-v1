// MCP OAuth core — the redirect-URI allowlist, per origin (spec O1).
//
// Re-checked at registration, authorize AND token against the resolving origin
// — never read from anything stored and never trusted from a client id alone —
// so a client registered on dev with a loopback redirect is refused by
// production even though both deployments share one dataset.
//
//   production       → CLAUDE_AI_REDIRECT_URI only
//   preview / local  → CLAUDE_AI_REDIRECT_URI + RFC 8252 loopback (dev smoke client)
//   any other origin → nothing

import { LOCAL_ORIGIN, PREVIEW_ORIGIN, PRODUCTION_ORIGIN } from "./origin";

/**
 * The one redirect URI claude.ai's hosted surfaces (web, Desktop, mobile) use.
 * Source: claude.com/docs/connectors/building/authentication, fetched
 * 2026-09-23. Compared by exact string. If Claude ever changes it, the connector
 * fails CLOSED (registration refuses) until this constant is updated through the
 * normal pipeline — refused claude.ai/claude.com URIs are logged by the routes
 * (see `shouldLogRefusedRedirect`) so the change is visible.
 */
export const CLAUDE_AI_REDIRECT_URI = "https://claude.ai/api/mcp/auth_callback";

/** Printable ASCII, no space: no whitespace or control character survives. */
const PRINTABLE_RE = /^[\x21-\x7E]+$/;

/**
 * RFC 8252 loopback redirect: `http:`, host exactly `127.0.0.1` or `localhost`,
 * an explicit port, any path and query, no userinfo, no fragment. The string
 * must also already be in canonical WHATWG form (`new URL(uri).href === uri`),
 * so what is checked here is byte-for-byte what a browser will navigate to —
 * no `127.1`, no `LOCALHOST`, no `..`, no backslash tricks.
 */
export function isLoopbackRedirectUri(uri: unknown): boolean {
  if (typeof uri !== "string" || !PRINTABLE_RE.test(uri)) return false;
  if (uri.includes("#")) return false;
  let url: URL;
  try {
    url = new URL(uri);
  } catch {
    return false;
  }
  if (url.protocol !== "http:") return false;
  if (url.hostname !== "127.0.0.1" && url.hostname !== "localhost") return false;
  if (url.port === "") return false;
  if (url.username !== "" || url.password !== "") return false;
  return url.href === uri;
}

/** Whether `uri` is an allowed redirect URI for a client of `origin`. */
export function isRedirectUriAllowed(uri: unknown, origin: string): boolean {
  if (typeof uri !== "string") return false;
  if (origin === PRODUCTION_ORIGIN) return uri === CLAUDE_AI_REDIRECT_URI;
  if (origin === PREVIEW_ORIGIN || origin === LOCAL_ORIGIN) {
    return uri === CLAUDE_AI_REDIRECT_URI || isLoopbackRedirectUri(uri);
  }
  return false;
}

/** Longest raw string `shouldLogRefusedRedirect` will consider (R11). */
const MAX_LOGGED_REDIRECT_URI_LENGTH = 2048;

/**
 * Whether a REFUSED redirect URI is worth logging: its host is `claude.ai`,
 * `claude.com` or a subdomain of either — i.e. Claude may have moved its
 * callback. The routes do the logging (of the URI only); this module never logs.
 *
 * R11: the raw string is checked BEFORE it ever reaches `new URL()`. The
 * WHATWG parser strips `\n`/`\t` from the input first, so a hostname check on
 * the PARSED url alone would still say "claude" for
 * `"https://claude.ai/x\n<forged line>"` — printable-ASCII and the 2048-char
 * cap close both the log-injection and the multi-KB-string paths.
 */
export function shouldLogRefusedRedirect(uri: unknown): boolean {
  if (typeof uri !== "string") return false;
  if (uri.length > MAX_LOGGED_REDIRECT_URI_LENGTH) return false;
  if (!PRINTABLE_RE.test(uri)) return false;
  let host: string;
  try {
    host = new URL(uri).hostname;
  } catch {
    return false;
  }
  return (
    host === "claude.ai" ||
    host === "claude.com" ||
    host.endsWith(".claude.ai") ||
    host.endsWith(".claude.com")
  );
}
