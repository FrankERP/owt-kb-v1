// MCP OAuth core — the redirect-URI allowlist (spec O1; ADR-0083 opens it to
// more agents).
//
// Re-checked at registration, authorize AND token against the resolving origin
// — never read from anything stored and never trusted from a client id alone.
// A client id is also signed for ONE origin (its `iss`), so a client
// registered on dev is refused by production whatever this list says.
//
// The list is CLOSED, the same on the three known origins (production,
// preview, local); any other origin allows nothing:
//
//   claude.ai  → CLAUDE_AI_REDIRECT_URI, exactly
//   ChatGPT    → CHATGPT_REDIRECT_URI, exactly (the stable form OpenAI uses
//                for an authorization server with RFC 9207 issuer
//                identification, which this one has)
//   loopback   → an RFC 8252 loopback URI: the code lands on the browser's own
//                machine, so a remote attacker who registers one gains nothing
//
// Why not «any https URI»: registration is open (ADR-0039), so an open list
// would let anyone register their own callback and send an admin the authorize
// link; one careless «Permitir» would hand the code to a stranger. With a
// closed list the code only reaches Claude's or OpenAI's callback, or the
// user's own computer.

import { LOCAL_ORIGIN, PREVIEW_ORIGIN, PRODUCTION_ORIGIN } from "./origin";

/**
 * The one redirect URI claude.ai's hosted surfaces (web, Desktop, mobile) use.
 * Source: claude.com/docs/connectors/building/authentication, fetched
 * 2026-09-23. Compared by exact string. If Claude ever changes it, the connector
 * fails CLOSED (registration refuses) until this constant is updated through the
 * normal pipeline — refused URIs on a known agent host are logged by the routes
 * (see `shouldLogRefusedRedirect`) so the change is visible.
 */
export const CLAUDE_AI_REDIRECT_URI = "https://claude.ai/api/mcp/auth_callback";

/**
 * ChatGPT's stable redirect URI, used for an authorization server that supports
 * RFC 9207 issuer identification (`authorization_response_iss_parameter_supported`,
 * which `/.well-known/oauth-authorization-server` advertises). Source:
 * developers.openai.com/apps-sdk/build/auth, fetched 2026-11-05. The
 * per-connection form `https://chatgpt.com/connector/oauth/{id}` is NOT allowed:
 * OpenAI uses it only for servers without issuer identification. A refused
 * chatgpt.com URI is logged, so a change shows up.
 */
export const CHATGPT_REDIRECT_URI = "https://chatgpt.com/connector_platform_oauth_redirect";

/** Which kind of agent a redirect URI belongs to. */
export type RedirectTargetKind = "claude" | "chatgpt" | "loopback";

/** Printable ASCII, no space: no whitespace or control character survives. */
const PRINTABLE_RE = /^[\x21-\x7E]+$/;

/**
 * RFC 8252 loopback redirect: `http:`, host exactly `127.0.0.1` or `localhost`,
 * an optional port, any path and query, no userinfo, no fragment. The string
 * must also already be in canonical WHATWG form (`new URL(uri).href === uri`),
 * so what is checked here is byte-for-byte what a browser will navigate to —
 * no `127.1`, no `LOCALHOST`, no `..`, no backslash tricks. The port is
 * optional because a native client may register `http://127.0.0.1/` and bind a
 * free port at login (RFC 8252 §7.3; VS Code registers exactly that).
 *
 * `localhost` is kept although RFC 8252 §8.3 prefers the IP literal: either way
 * the code reaches the browser's own machine, and clients register it.
 */
export function isLoopbackRedirectUri(uri: unknown): boolean {
  return parseLoopback(uri) !== null;
}

function parseLoopback(uri: unknown): URL | null {
  if (typeof uri !== "string" || !PRINTABLE_RE.test(uri)) return null;
  if (uri.includes("#")) return null;
  let url: URL;
  try {
    url = new URL(uri);
  } catch {
    return null;
  }
  if (url.protocol !== "http:") return null;
  if (url.hostname !== "127.0.0.1" && url.hostname !== "localhost") return null;
  if (url.username !== "" || url.password !== "") return null;
  return url.href === uri ? url : null;
}

/** Whether `origin` is one this server serves (the allowlist applies to these only). */
function isKnownOrigin(origin: string): boolean {
  return origin === PRODUCTION_ORIGIN || origin === PREVIEW_ORIGIN || origin === LOCAL_ORIGIN;
}

/**
 * The kind of agent behind an allowed redirect URI on `origin`, or `null` when
 * the URI is not allowed there. The ONLY source of the consent screen's «Se
 * conecta a» label and of a new grant's `client` field (ADR-0083).
 */
export function redirectTargetKind(uri: unknown, origin: string): RedirectTargetKind | null {
  if (typeof uri !== "string" || !isKnownOrigin(origin)) return null;
  if (uri === CLAUDE_AI_REDIRECT_URI) return "claude";
  if (uri === CHATGPT_REDIRECT_URI) return "chatgpt";
  if (isLoopbackRedirectUri(uri)) return "loopback";
  return null;
}

/** Whether `uri` is an allowed redirect URI for a client of `origin`. */
export function isRedirectUriAllowed(uri: unknown, origin: string): boolean {
  return redirectTargetKind(uri, origin) !== null;
}

/**
 * Whether `requested` may be used as the redirect of a client that registered
 * `registered`, on `origin`: it is allowed there, AND it is one of the
 * registered URIs exactly, OR it is a loopback URI that equals a registered
 * loopback URI in everything but the port (RFC 8252 §7.3: a native client binds
 * a free port at login). Protocol, hostname, path and query must match;
 * `localhost` and `127.0.0.1` are not interchangeable.
 *
 * Port variance applies to «is it registered» only. Whether the token request
 * names the SAME redirect as the authorization request is the code binding's
 * exact check (`checkCodeBinding`), which this never replaces.
 */
export function matchRegisteredRedirect(requested: unknown, registered: readonly string[], origin: string): boolean {
  if (!isRedirectUriAllowed(requested, origin)) return false;
  const uri = requested as string;
  if (registered.includes(uri)) return true;
  const asked = parseLoopback(uri);
  if (asked === null) return false;
  return registered.some((candidate) => {
    const known = parseLoopback(candidate);
    return (
      known !== null &&
      known.protocol === asked.protocol &&
      known.hostname === asked.hostname &&
      known.pathname === asked.pathname &&
      known.search === asked.search
    );
  });
}

/** What the consent screen shows for each kind (Spanish UI). */
export const REDIRECT_TARGET_LABEL: Readonly<Record<RedirectTargetKind, string>> = {
  claude: "Claude (claude.ai)",
  chatgpt: "ChatGPT (chatgpt.com)",
  loopback: "Un programa en esta computadora",
};

/** Longest raw string `shouldLogRefusedRedirect` will consider (R11). */
const MAX_LOGGED_REDIRECT_URI_LENGTH = 2048;

/** Hosts whose refused redirect URIs are worth a log line: a known agent may have moved its callback. */
const LOGGED_HOSTS = ["claude.ai", "claude.com", "chatgpt.com", "openai.com"] as const;

/**
 * Whether a REFUSED redirect URI is worth logging: its host is one of
 * `LOGGED_HOSTS` or a subdomain of one — i.e. a known agent may have moved its
 * callback. The routes do the logging (of the URI only); this module never logs.
 *
 * R11: the raw string is checked BEFORE it ever reaches `new URL()`. The
 * WHATWG parser strips `\n`/`\t` from the input first, so a hostname check on
 * the PARSED url alone would still match for
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
  return LOGGED_HOSTS.some((known) => host === known || host.endsWith(`.${known}`));
}
