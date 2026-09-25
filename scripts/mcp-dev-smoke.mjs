/**
 * Local MCP client for the P0 step-12 DEV SMOKE (spec
 * docs/superpowers/specs/2026-09-22-owt-mcp-design-v2.md). Walks the WHOLE
 * OAuth handshake against a deployment of this app's own MCP server and calls
 * `ping` — the thing no off-the-shelf MCP inspector can do here, because
 * those run OAuth in the browser, where CORS and Vercel's Deployment
 * Protection bypass header are both a problem. This script IS the client: it
 * runs RFC 8252's loopback redirect itself and sends
 * `x-vercel-protection-bypass` on every request to dev (discovery,
 * registration, token, MCP alike).
 *
 * FRANK ONLY, on dev. Step 3 of the handshake needs HIS browser, already
 * signed in to the app AND to Vercel (so the consent screen at
 * `/oauth/authorize` and the Deployment Protection wall in front of it both
 * pass) — no agent can complete that click. The token exchange also creates a
 * REAL grant in the shared Sanity dataset preview writes to (CLAUDE.md
 * "Preview writes to the real Sanity dataset"), so an unattended or repeated
 * run is not a dry run. `--base https://owt-backstage.vercel.app` and a
 * missing `SR_VERIFY_BYPASS_SECRET` are the two invocations anyone may run to
 * PROVE this script refuses — neither makes a network call (see
 * `resolveBase` for the first, and the bypass-secret check at the top of
 * `main()` for the second).
 *
 *   node --env-file=.env.local scripts/mcp-dev-smoke.mjs
 *     … the full handshake against https://dev-owt-backstage.vercel.app:
 *       discovery → registration (loopback redirect) → consent (opens the
 *       default browser) → token → initialize/tools-list/ping → refresh →
 *       ping again → prints the grant id and the exact revoke command.
 *   node --env-file=.env.local scripts/mcp-dev-smoke.mjs --reads
 *     … same, and after `ping` (still inside step 7, before refresh) calls
 *       each of the seven P1 read tools once — list_services, get_service,
 *       search_songs, get_song (using the first song search_songs found),
 *       get_member_availability, get_participation, list_proposals — with no
 *       arguments or a trivial one, printing one PASS/FAIL line per tool and
 *       a counts-only summary (never a name or any other personal data). No
 *       write tool exists (DV1); this remains a read-only smoke.
 *   node --env-file=.env.local scripts/mcp-dev-smoke.mjs --await-revocation
 *     … same, then pauses for Enter after printing the revoke command — run
 *       `revoke-mcp-grant.mjs --id <id> --apply` in another terminal, press
 *       Enter, and this polls `tools/list` every 10 s for up to 60 s for the
 *       401 that proves the revocation landed.
 *   node --env-file=.env.local scripts/mcp-dev-smoke.mjs --base http://localhost:3000
 *     … same, against a local `next dev` — no bypass secret needed there.
 *   … --no-open prints the authorize URL instead of opening it (macOS `open`).
 *   … --no-refresh skips step 8 (the refresh-token round trip).
 *
 * SR_VERIFY_BYPASS_SECRET (docs/SECRETS.md) is required for the dev base.
 * Never printed — see `redact()`. Nothing this script handles (the bypass
 * secret, the client id, PKCE verifier, authorization code, access token,
 * refresh token) is ever written to disk or logged past an 8-character
 * prefix plus its length.
 *
 * The smoke calls `ping` always, and — only with `--reads` — the seven P1
 * read tools once each (DV1: reads only). It calls no write tool; none exist.
 *
 * Every exported function below is pure — no network, no filesystem, no
 * `process`/env access — and is what `scripts/__tests__/mcpDevSmoke.test.ts`
 * exercises without a network. `main()` (the network calls, the loopback HTTP
 * listener, spawning `open`, reading stdin) runs only when this file is
 * executed directly, gated the same way `scripts/revoke-mcp-grant.mjs` is.
 */
import { createHash, randomBytes } from "node:crypto";
import { execFileSync } from "node:child_process";
import { createServer } from "node:http";
import { createInterface } from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";
import { pathToFileURL } from "node:url";

// ── constants ────────────────────────────────────────────────────────────

export const DEFAULT_BASE = "https://dev-owt-backstage.vercel.app";
export const LOCAL_BASE = "http://localhost:3000";
export const PRODUCTION_BASE = "https://owt-backstage.vercel.app";

export const BYPASS_HEADER = "x-vercel-protection-bypass";
export const BYPASS_SECRET_ENV = "SR_VERIFY_BYPASS_SECRET";

export const LEGACY_PROTOCOL_VERSION = "2025-06-18";

const CALLBACK_PATH = "/callback";
const CALLBACK_TIMEOUT_MS = 5 * 60 * 1000;
const REVOCATION_POLL_INTERVAL_MS = 10_000;
const REVOCATION_POLL_TIMEOUT_MS = 60_000;
const TOTAL_STEPS = 10;

// ── pure helpers (unit-tested without any network) ─────────────────────────

/** Parse argv into `{ base, open, refresh, awaitRevocation, reads }`, or throw. Pure. */
export function parseArgs(argv) {
  const args = { base: null, open: true, refresh: true, awaitRevocation: false, reads: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--base") {
      const v = argv[i + 1];
      if (v === undefined || v.startsWith("--")) throw new Error("--base needs a value");
      args.base = v;
      i++;
    } else if (a === "--no-open") {
      args.open = false;
    } else if (a === "--no-refresh") {
      args.refresh = false;
    } else if (a === "--await-revocation") {
      args.awaitRevocation = true;
    } else if (a === "--reads") {
      args.reads = true;
    } else {
      throw new Error(`Unrecognized argument: ${a}`);
    }
  }
  return args;
}

/**
 * Base-URL validation — the ONE place production and any unlisted origin are
 * refused, before anything makes a network call. `rawBase` is `--base` or
 * null/empty for the default. Pure.
 */
export function resolveBase(rawBase) {
  const raw = (rawBase ?? "").trim();
  const candidate = raw === "" ? DEFAULT_BASE : raw;
  let url;
  try {
    url = new URL(candidate);
  } catch {
    return { ok: false, message: `--base "${candidate}" is not a valid URL.` };
  }
  const origin = url.origin;
  if (origin === PRODUCTION_BASE) {
    return {
      ok: false,
      message:
        `Refusing ${PRODUCTION_BASE}: this script is the DEV smoke client only. ` +
        "Production's redirect-URI allowlist has no loopback entry (app/mcp/oauth/redirects.ts) " +
        "and its connector is added from claude.ai, never from this script.",
    };
  }
  if (origin === DEFAULT_BASE) return { ok: true, origin, needsBypass: true };
  if (origin === LOCAL_BASE) return { ok: true, origin, needsBypass: false };
  return {
    ok: false,
    message: `--base "${origin}" is not allowed. Use ${DEFAULT_BASE} (default) or ${LOCAL_BASE} for a local run.`,
  };
}

/** RFC 7636 §4.1 code verifier: 43 chars of base64url (a subset of the allowed charset). Pure. */
export function generateCodeVerifier() {
  return randomBytes(32).toString("base64url");
}

/** `BASE64URL(SHA256(ASCII(verifier)))` (RFC 7636 §4.2) — same formula as `app/mcp/oauth/pkce.ts`. Pure. */
export function codeChallengeFromVerifier(verifier) {
  return createHash("sha256").update(verifier, "ascii").digest("base64url");
}

/** A random CSRF `state`. Pure. */
export function generateState() {
  return randomBytes(16).toString("hex");
}

/** The RFC 8252 loopback redirect URI for a bound port, in canonical form. Pure. */
export function redirectUriFor(port) {
  return `http://127.0.0.1:${port}${CALLBACK_PATH}`;
}

/**
 * The `/oauth/authorize` URL the consent page reads — every parameter the
 * validator in `app/mcp/oauth/authorizeRequest.ts` requires, S256 only. Pure.
 */
export function buildAuthorizeUrl({ authorizationEndpoint, clientId, redirectUri, codeChallenge, state, resource }) {
  const url = new URL(authorizationEndpoint);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("client_id", clientId);
  url.searchParams.set("redirect_uri", redirectUri);
  url.searchParams.set("code_challenge", codeChallenge);
  url.searchParams.set("code_challenge_method", "S256");
  url.searchParams.set("state", state);
  url.searchParams.set("resource", resource);
  return url.toString();
}

/**
 * Request headers carrying the bypass secret, or `{}` when there is none —
 * same contract as `bypassHeaders` in `e2e/service-readiness/lib/bypass.ts`
 * (duplicated rather than imported: that module is TypeScript under `e2e/`,
 * and this script runs under plain `node`, same reasoning as
 * `scripts/revoke-mcp-grant.mjs`'s header comment. The cross-check lives in
 * `scripts/__tests__/mcpDevSmoke.test.ts`, which imports both).
 */
export function bypassHeaderFor(secret) {
  return secret ? { [BYPASS_HEADER]: secret } : {};
}

/** `application/x-www-form-urlencoded` body from `[name, value][]`, omitting nullish values. Pure. */
export function formEncode(fields) {
  const params = new URLSearchParams();
  for (const [name, value] of fields) {
    if (value !== null && value !== undefined) params.append(name, value);
  }
  return params.toString();
}

/**
 * Parses an SSE-framed body into its JSON-RPC message(s) — same shape as the
 * `sseMessages` helper in `app/api/__tests__/mcpRoute.test.ts`. Pure.
 */
export function parseSseMessages(text) {
  return text
    .split(/\r?\n\r?\n/)
    .map((event) =>
      event
        .split(/\r?\n/)
        .filter((line) => line.startsWith("data:"))
        .map((line) => line.slice(5).replace(/^ /, ""))
        .join("\n"),
    )
    .filter((data) => data !== "")
    .map((data) => JSON.parse(data));
}

/**
 * A value's first 8 characters plus its length — never the value itself.
 * Every secret, code and token this script prints goes through this. Pure.
 */
export function redact(value) {
  if (typeof value !== "string" || value.length === 0) return "(empty)";
  return `${value.slice(0, 8)}… (${value.length} chars)`;
}

/**
 * Decodes a JWT's payload WITHOUT verifying it — this client has no secret to
 * verify with. `null` for anything not shaped like a JWT. Pure.
 */
export function decodeJwtPayloadUnsafe(token) {
  if (typeof token !== "string") return null;
  const parts = token.split(".");
  if (parts.length !== 3) return null;
  try {
    const json = Buffer.from(parts[1], "base64url").toString("utf8");
    const payload = JSON.parse(json);
    return typeof payload === "object" && payload !== null && !Array.isArray(payload) ? payload : null;
  } catch {
    return null;
  }
}

/** A JSON-RPC request envelope, matching `mcpRoute.test.ts`'s `rpc()`. Pure. */
export function rpc(method, params, id = 1) {
  return { jsonrpc: "2.0", id, method, ...(params !== undefined ? { params } : {}) };
}

// ── tools/list check (P1 step 8) ────────────────────────────────────────────

/** The registration this deployment is expected to carry (`app/api/mcp/route.ts`), in order. */
export const EXPECTED_TOOLS = [
  "ping",
  "get_service",
  "list_services",
  "search_songs",
  "get_song",
  "get_member_availability",
  "get_participation",
  "list_proposals",
];

/**
 * Checks a `tools/list` result against `EXPECTED_TOOLS`: the exact names, in
 * order, each declared `readOnlyHint: true, openWorldHint: false` — the same
 * assertion `mcpRoute.test.ts`'s own tools/list test makes. Pure — takes the
 * already-parsed `tools` array, never the network response.
 */
export function checkToolList(tools) {
  const names = Array.isArray(tools) ? tools.map((t) => (t && typeof t.name === "string" ? t.name : null)) : [];
  if (JSON.stringify(names) !== JSON.stringify(EXPECTED_TOOLS)) {
    return { ok: false, message: `expected tools ${JSON.stringify(EXPECTED_TOOLS)}, got ${JSON.stringify(names)}` };
  }
  for (const tool of tools) {
    const a = tool && tool.annotations;
    if (!a || a.readOnlyHint !== true || a.openWorldHint !== false) {
      return {
        ok: false,
        message: `${tool && tool.name} is not annotated { readOnlyHint: true, openWorldHint: false }`,
      };
    }
  }
  return { ok: true };
}

// ── --reads pass (P1 step 8, DV1: reads only, after ping) ──────────────────

/**
 * The seven read tools the `--reads` pass exercises, in this order, always
 * after `ping` and before any refresh/revocation step — never a write tool,
 * because none exist (DV1).
 */
export const READ_TOOL_NAMES = [
  "list_services",
  "get_service",
  "search_songs",
  "get_song",
  "get_member_availability",
  "get_participation",
  "list_proposals",
];

/** Every read check's fixed arguments except `get_song`'s (see `readCheckArguments`). `search_songs` runs a short, one-letter query on purpose — the SUBSTRING path (`libraryIndex.ts`), not the fuzzy one — sure to match something in a real Spanish song catalogue. */
const FIXED_READ_ARGS = {
  list_services: {},
  get_service: {},
  search_songs: { query: "a" },
  get_member_availability: {},
  get_participation: {},
  list_proposals: {},
};

/**
 * The arguments for one `--reads` check. `get_song` is the one exception: its
 * `songId` comes from `search_songs`'s OWN result earlier in the same pass
 * (`songIdFromSearchResult`) — there is no other id this script has. Throws
 * when that never happened — `main()`'s per-tool `try` (`READ_TOOL_NAMES`'s
 * loop) catches it like any other failure and prints it as `get_song`'s OWN
 * FAIL line, so the message names the likely real cause instead of reading
 * like a network error: `search_songs` itself failing, or a `{ query: "a" }`
 * search that matched no song in this deployment's catalogue — never a
 * script-ordering bug, since `READ_TOOL_NAMES` always runs `search_songs`
 * before `get_song`. Pure.
 */
export function readCheckArguments(name, songId) {
  if (name === "get_song") {
    if (typeof songId !== "string" || songId === "") {
      throw new Error(
        "get_song needs a songId, but search_songs failed or returned no songs earlier in this pass " +
          "(see its own PASS/FAIL line above)",
      );
    }
    return { songId };
  }
  const args = FIXED_READ_ARGS[name];
  if (args === undefined) throw new Error(`no fixed arguments for "${name}"`);
  return args;
}

/** The first song id `search_songs`'s own tool result named, or null. Pure — takes the ALREADY-PARSED payload, never the raw text. */
export function songIdFromSearchResult(payload) {
  const songs = payload && typeof payload === "object" ? payload.songs : null;
  const first = Array.isArray(songs) ? songs[0] : null;
  return first && typeof first === "object" && typeof first.id === "string" ? first.id : null;
}

function arrayLength(v) {
  return Array.isArray(v) ? v.length : 0;
}

/**
 * A short, SAFE detail for a PASS line: counts only — never a name, a
 * message body, an email or any other personal data (the brief's own rule
 * for this pass's output). Falls back to a fixed word when a tool's payload
 * carries no obvious count. Pure.
 */
export function readCheckDetail(name, payload) {
  if (!payload || typeof payload !== "object") return "ok";
  if (name === "list_services") return `${arrayLength(payload.services)} services`;
  if (name === "get_service") return "1 service";
  if (name === "search_songs") return `${arrayLength(payload.songs)} songs`;
  if (name === "get_song") return "1 song";
  if (name === "get_member_availability") return `${arrayLength(payload.members)} members`;
  if (name === "get_participation") {
    return `${arrayLength(payload.members)} members, ${arrayLength(payload.services)} services`;
  }
  if (name === "list_proposals") return `${arrayLength(payload.proposals)} proposals`;
  return "ok";
}

/** One check's PASS/FAIL line. Pure. */
export function formatReadCheckLine(name, outcome) {
  return outcome.ok ? `  PASS ${name} — ${outcome.detail}` : `  FAIL ${name} — ${outcome.detail}`;
}

/** The `--reads` pass' closing summary line: counts only. Pure. */
export function summarizeReadChecks(outcomes) {
  const passed = outcomes.filter((o) => o.ok).length;
  return `  reads: ${passed}/${outcomes.length} passed`;
}

/** An HTTP failure carrying the server's fixed JSON `error` (and `error_description`, if any). */
export class SmokeError extends Error {
  constructor(status, body) {
    const errorField = body && typeof body === "object" && typeof body.error === "string" ? body.error : "(no error field)";
    const description = body && typeof body === "object" && typeof body.error_description === "string" ? ` — ${body.error_description}` : "";
    super(`HTTP ${status} ${errorField}${description}`);
    this.status = status;
    this.body = body;
  }
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ── orchestration (network, the loopback listener, the browser, stdin) ─────

async function startCallbackServer() {
  const server = createServer();
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  return { server, port: server.address().port };
}

/** Resolves with the callback's query params the first time `CALLBACK_PATH` is hit, or rejects after `timeoutMs`. */
function waitForCallback(server, timeoutMs) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      server.removeListener("request", onRequest);
      reject(new Error(`timed out waiting for the browser callback after ${Math.round(timeoutMs / 1000)}s`));
    }, timeoutMs);
    function onRequest(req, res) {
      let url;
      try {
        url = new URL(req.url, "http://127.0.0.1");
      } catch {
        res.writeHead(400).end("bad request");
        return;
      }
      if (url.pathname !== CALLBACK_PATH) {
        res.writeHead(404).end("not found");
        return;
      }
      clearTimeout(timer);
      server.removeListener("request", onRequest);
      res.writeHead(200, { "Content-Type": "text/plain; charset=utf-8" });
      res.end("You can close this tab and return to the terminal.");
      resolve({
        error: url.searchParams.get("error"),
        code: url.searchParams.get("code"),
        state: url.searchParams.get("state"),
        iss: url.searchParams.get("iss"),
      });
    }
    server.on("request", onRequest);
  });
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const resolved = resolveBase(args.base);
  if (!resolved.ok) {
    console.error(resolved.message);
    process.exit(2);
  }
  const { origin, needsBypass } = resolved;

  let bypassSecret = null;
  if (needsBypass) {
    const raw = process.env[BYPASS_SECRET_ENV];
    if (!raw || !raw.trim()) {
      console.error(
        `${BYPASS_SECRET_ENV} is required to reach ${origin} (Vercel Deployment Protection). ` +
          "Set it in .env.local and run with --env-file=.env.local, or use --base http://localhost:3000 for a local run.",
      );
      process.exit(2);
    }
    bypassSecret = raw.trim();
  }
  const bypass = bypassHeaderFor(bypassSecret);

  let currentStep = 0;
  let currentLabel = "";
  const begin = (n, label) => {
    currentStep = n;
    currentLabel = label;
  };
  const pass = (detail) => console.log(`[${currentStep}/${TOTAL_STEPS}] PASS ${currentLabel}${detail ? ` — ${detail}` : ""}`);

  async function fetchJson(url, options = {}) {
    const res = await fetch(url, { ...options, headers: { ...bypass, ...(options.headers ?? {}) } });
    const text = await res.text();
    let body = null;
    if (text) {
      try {
        body = JSON.parse(text);
      } catch {
        body = null;
      }
    }
    if (!res.ok) throw new SmokeError(res.status, body);
    return body;
  }

  async function mcpRequest(accessToken, body, protocolVersion) {
    const headers = {
      ...bypass,
      authorization: `Bearer ${accessToken}`,
      accept: "application/json, text/event-stream",
      "content-type": "application/json",
    };
    if (protocolVersion) headers["mcp-protocol-version"] = protocolVersion;
    const res = await fetch(`${origin}/api/mcp`, { method: "POST", headers, body: JSON.stringify(body) });
    const text = await res.text();
    return { status: res.status, headers: res.headers, text };
  }

  async function mcpRpc(accessToken, body, protocolVersion) {
    const res = await mcpRequest(accessToken, body, protocolVersion);
    if (res.status !== 200) {
      let parsed = null;
      try {
        parsed = JSON.parse(res.text);
      } catch {
        parsed = null;
      }
      throw new SmokeError(res.status, parsed);
    }
    const contentType = res.headers.get("content-type") ?? "";
    const message = contentType.startsWith("text/event-stream")
      ? (() => {
          const messages = parseSseMessages(res.text);
          if (messages.length !== 1) throw new Error(`expected exactly one SSE message, got ${messages.length}`);
          return messages[0];
        })()
      : JSON.parse(res.text);
    if (message.error) throw new Error(`MCP error: ${JSON.stringify(message.error)}`);
    return message.result;
  }

  let server;
  try {
    // 1. Discovery.
    begin(1, "discovery");
    const protectedResource = await fetchJson(`${origin}/.well-known/oauth-protected-resource/api/mcp`);
    const authServer = await fetchJson(`${origin}/.well-known/oauth-authorization-server`);
    if (authServer.issuer !== origin) throw new Error(`issuer "${authServer.issuer}" !== "${origin}"`);
    const resource = `${origin}/api/mcp`;
    if (protectedResource.resource !== resource) throw new Error(`resource "${protectedResource.resource}" !== "${resource}"`);
    pass(`issuer=${authServer.issuer} resource=${protectedResource.resource}`);

    // Reserve the loopback port before registration — the redirect URI names it.
    const started = await startCallbackServer();
    server = started.server;
    const redirectUri = redirectUriFor(started.port);

    // 2. Registration.
    begin(2, "registration");
    const registration = await fetchJson(`${origin}/api/oauth/register`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        redirect_uris: [redirectUri],
        client_name: "OWT dev smoke",
        token_endpoint_auth_method: "none",
      }),
    });
    const clientId = registration.client_id;
    if (typeof clientId !== "string" || clientId === "") throw new Error("registration returned no client_id");
    pass(`client_id=${redact(clientId)} redirect_uri=${redirectUri}`);

    // 3. Loopback listener (already bound) + PKCE + state.
    begin(3, "loopback listener + PKCE");
    const verifier = generateCodeVerifier();
    const challenge = codeChallengeFromVerifier(verifier);
    const state = generateState();
    const callbackPromise = waitForCallback(server, CALLBACK_TIMEOUT_MS);
    pass(`listening on 127.0.0.1:${started.port}, verifier=${redact(verifier)}, state=${redact(state)}`);

    // 4. Authorize URL.
    begin(4, "authorize URL");
    const authorizeUrl = buildAuthorizeUrl({
      authorizationEndpoint: authServer.authorization_endpoint,
      clientId,
      redirectUri,
      codeChallenge: challenge,
      state,
      resource,
    });
    // The full client_id appears here ON PURPOSE: the URL must be actionable
    // (copy-pasteable / openable), and a client_id is a public identifier —
    // it rides in the browser's URL bar in every OAuth authorization-code
    // flow, this one included. It is not a secret (ADR-0039).
    console.log(`  ${authorizeUrl}`);
    if (args.open) {
      try {
        execFileSync("open", [authorizeUrl], { stdio: "ignore" });
        pass("opened in the default browser (copy the URL above if nothing appeared)");
      } catch (err) {
        pass(`could not auto-open (${err instanceof Error ? err.message : String(err)}) — open the URL above manually`);
      }
    } else {
      pass("--no-open: open the URL above manually");
    }

    // 5. Wait for the callback.
    begin(5, "waiting for the browser callback (up to 5 minutes)");
    const callback = await callbackPromise;
    if (callback.error) throw new Error(`authorize returned an error: ${callback.error}`);
    if (callback.iss !== origin) throw new Error(`callback iss "${callback.iss}" !== "${origin}"`);
    if (callback.state !== state) throw new Error("callback state did not match the one this run generated");
    if (!callback.code) throw new Error("callback carried no code");
    pass(`code=${redact(callback.code)}, state and iss verified`);

    // 6. Token exchange.
    begin(6, "token exchange");
    let tokens = await fetchJson(`${origin}/api/oauth/token`, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: formEncode([
        ["grant_type", "authorization_code"],
        ["code", callback.code],
        ["redirect_uri", redirectUri],
        ["client_id", clientId],
        ["code_verifier", verifier],
        ["resource", resource],
      ]),
    });
    pass(`access_token=${redact(tokens.access_token)}, refresh_token=${redact(tokens.refresh_token)}, expires_in=${tokens.expires_in}s`);

    // 7. initialize, tools/list, tools/call ping [+ --reads sub-step].
    begin(7, args.reads ? "initialize, tools/list, tools/call ping, --reads" : "initialize, tools/list, tools/call ping");
    const initResult = await mcpRpc(tokens.access_token, rpc("initialize", {
      protocolVersion: LEGACY_PROTOCOL_VERSION,
      capabilities: {},
      clientInfo: { name: "owt-mcp-dev-smoke", version: "1" },
    }));
    if (initResult.protocolVersion !== LEGACY_PROTOCOL_VERSION) {
      throw new Error(`initialize returned protocolVersion "${initResult.protocolVersion}"`);
    }
    const listResult = await mcpRpc(tokens.access_token, rpc("tools/list"), LEGACY_PROTOCOL_VERSION);
    const tools = listResult.tools ?? [];
    const toolsCheck = checkToolList(tools);
    if (!toolsCheck.ok) throw new Error(toolsCheck.message);
    const callResult = await mcpRpc(tokens.access_token, rpc("tools/call", { name: "ping", arguments: {} }), LEGACY_PROTOCOL_VERSION);
    const payload = JSON.parse(callResult.content[0].text);
    pass(`ping → ${JSON.stringify(payload)}`);

    // 7b. --reads: one call per read tool, after ping, before refresh (DV1).
    if (args.reads) {
      console.log(`  --reads: ${READ_TOOL_NAMES.join(", ")}`);
      let songId = null;
      const outcomes = [];
      for (const name of READ_TOOL_NAMES) {
        try {
          const toolArgs = readCheckArguments(name, songId);
          const readResult = await mcpRpc(
            tokens.access_token,
            rpc("tools/call", { name, arguments: toolArgs }),
            LEGACY_PROTOCOL_VERSION,
          );
          if (readResult.isError) throw new Error("tool result carried isError: true");
          const readPayload = JSON.parse(readResult.content[0].text);
          if (name === "search_songs") songId = songIdFromSearchResult(readPayload);
          const outcome = { ok: true, detail: readCheckDetail(name, readPayload) };
          outcomes.push(outcome);
          console.log(formatReadCheckLine(name, outcome));
        } catch (err) {
          const outcome = { ok: false, detail: err instanceof Error ? err.message : String(err) };
          outcomes.push(outcome);
          console.log(formatReadCheckLine(name, outcome));
        }
      }
      console.log(summarizeReadChecks(outcomes));
      if (outcomes.some((o) => !o.ok)) {
        throw new Error("one or more --reads checks failed (see the PASS/FAIL lines above)");
      }
    }

    // 8. Refresh, then ping again.
    begin(8, "refresh + ping");
    if (!args.refresh) {
      pass("skipped (--no-refresh)");
    } else {
      const refreshed = await fetchJson(`${origin}/api/oauth/token`, {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body: formEncode([
          ["grant_type", "refresh_token"],
          ["refresh_token", tokens.refresh_token],
          ["client_id", clientId],
        ]),
      });
      const callResult2 = await mcpRpc(refreshed.access_token, rpc("tools/call", { name: "ping", arguments: {} }), LEGACY_PROTOCOL_VERSION);
      const payload2 = JSON.parse(callResult2.content[0].text);
      pass(`new access_token=${redact(refreshed.access_token)}, ping → ${JSON.stringify(payload2)}`);
      tokens = refreshed;
    }

    // 9. Grant id and the exact revoke command.
    begin(9, "grant id and revoke command");
    const claims = decodeJwtPayloadUnsafe(tokens.access_token);
    const grantId = claims?.grant;
    if (typeof grantId !== "string" || grantId === "") throw new Error("could not decode a grant id from the access token");
    console.log(`  grant: ${grantId}`);
    console.log(`  revoke: node --env-file=.env.local scripts/revoke-mcp-grant.mjs --id ${grantId} --apply`);
    pass();

    // 10. Optional: wait for Frank to revoke, then prove the 401 lands.
    begin(10, "await revocation");
    if (!args.awaitRevocation) {
      pass("skipped (pass --await-revocation to run this check after revoking the grant above)");
    } else {
      const rl = createInterface({ input, output });
      await rl.question("Revoke the grant above (in another terminal), then press Enter to start polling… ");
      rl.close();
      const deadline = Date.now() + REVOCATION_POLL_TIMEOUT_MS;
      let revoked = false;
      while (Date.now() < deadline) {
        // Polls `tools/list`, never `tools/call` — the route authenticates
        // BEFORE it dispatches to any method, so a `tools/list` 401 already
        // proves the revocation landed, with no need to actually invoke a tool.
        const res = await mcpRequest(tokens.access_token, rpc("tools/list"), LEGACY_PROTOCOL_VERSION);
        const challenge = res.headers.get("www-authenticate") ?? "";
        if (res.status === 401 && /error="invalid_token"/.test(challenge)) {
          revoked = true;
          break;
        }
        await sleep(REVOCATION_POLL_INTERVAL_MS);
      }
      if (!revoked) throw new Error(`did not observe a 401 invalid_token within ${REVOCATION_POLL_TIMEOUT_MS / 1000}s`);
      pass("401 invalid_token observed");
    }

    server.close();
    console.log("\nAll steps complete.");
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    console.error(`[${currentStep}/${TOTAL_STEPS}] FAIL ${currentLabel} — ${detail}`);
    server?.close();
    process.exit(1);
  }
}

// IMPORTING THIS MODULE MUST BE PURE (same discipline as revoke-mcp-grant.mjs).
// scripts/__tests__/mcpDevSmoke.test.ts imports this file to exercise the
// exported functions above, and must not touch the network, argv or env just
// by doing so.
if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  main();
}
