// `/api/mcp` — every tool call finishes INSIDE the route handler (P3 plan
// step 1, finding F2), whatever the protocol era.
//
// WHY THIS EXISTS. Next resolves a route's pending `revalidatePath` tags ONCE,
// when the handler's promise resolves; a tag pushed later is never executed,
// and nothing reports it. In the 2025-06-18 (legacy) era the SDK answers a
// `tools/call` with an SSE `Response` at once and runs the tool afterwards —
// so without the route's completion gate (`completeResponse`), a write tool's
// `revalidatePath` would run after the handler returned and be dropped
// silently. `after()` registered that late is in the same position.
//
// The stand-in tool below takes `ping`'s place (so the ordinary request
// builders reach it unchanged) and does what a write tool will: it yields a
// MACROTASK first — real work awaits I/O, and a synchronous body would land
// before the route's continuation either way and prove nothing — then calls
// `revalidatePath` and registers an `after()` callback. Each case asserts both
// happened BEFORE `await POST(...)` resolved, and that the client still gets
// exactly one JSON-RPC result in the framing it expects.
//
// Two cases are regression guards — they fail on a route that returns the
// SDK's `Response` as-is: the legacy era, and a 2026-07-28 call whose tool
// sends a notification mid-call (which upgrades that exchange to SSE early).
// The plain 2026-07-28 case passes either way and is here as documentation.
// Two more fail when the forwarded request follows the client's abort signal
// (a disconnect mid-call, both eras — ruling P3-R10), and one when the
// completion gate is not awaited inside the route's `try` (a broken stream).
//
// The auth harness is the minimum `mcpRoute.test.ts` uses to reach a tool: the
// REAL grant store over the in-memory dataset, a mocked live member record.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const h = await vi.hoisted(async () => {
  // `serverInfo.version` is read once, when the route module loads.
  vi.stubEnv("VERCEL_GIT_COMMIT_SHA", "0123456789abcdef0123456789abcdef01234567");
  const { createInMemorySanity } = await import("./inMemorySanity");
  return {
    ...createInMemorySanity(),
    getMemberAccess: vi.fn(),
    /** The stand-in tool's side effects, in the order they happened. */
    sequence: [] as string[],
    afterCallbacks: [] as (() => unknown)[],
    /**
     * When on, the stand-in tool sends a request-scoped notification before its
     * macrotask. In the 2026-07-28 era that upgrades the exchange to SSE and
     * settles the `Response` while the tool is still running (the SDK's
     * `PerRequestHTTPServerTransport.send`).
     */
    notifyFirst: { enabled: false },
    /**
     * When set, the stand-in tool aborts this controller — the CLIENT's signal,
     * the one Next aborts when the socket closes — while its I/O is pending.
     */
    disconnect: { controller: null as AbortController | null },
    /** Every request the route handed to the MCP handler, in order. */
    forwarded: [] as Request[],
    /** When on, the MCP handler answers with an SSE body that errors mid-stream. */
    brokenStream: { enabled: false },
  };
});

vi.mock("@/app/utils/memberAccess", () => ({ getMemberAccess: (id: string) => h.getMemberAccess(id) }));
vi.mock("@/sanity/lib/serverClient", () => ({ writeClient: h.writeClient, serverClient: { fetch: vi.fn() } }));
// The read tools' clients must never reach `sanity/env.ts`, which throws when
// `NEXT_PUBLIC_SANITY_*` is unset (as under vitest). Nothing here calls them.
vi.mock("@/sanity/lib/operationalClient", () => ({
  operationalClient: { fetch: vi.fn() },
  rawIntegrityClient: { fetch: vi.fn() },
}));

vi.mock("next/cache", () => ({
  revalidatePath: (path: string) => void h.sequence.push(`revalidatePath ${path}`),
}));
vi.mock("next/server", async (importOriginal) => {
  const mod = await importOriginal<typeof import("next/server")>();
  return {
    ...mod,
    after: (fn: () => unknown) => {
      h.sequence.push("after registered");
      h.afterCallbacks.push(fn);
    },
  };
});

// The REAL mcp-handler, observed: the wrapper records the request the route
// hands it, and can answer with an SSE body that errors instead of dispatching.
vi.mock("mcp-handler", async (importOriginal) => {
  const actual = await importOriginal<typeof import("mcp-handler")>();
  return {
    ...actual,
    createMcpHandler: (...args: Parameters<typeof actual.createMcpHandler>) => {
      const handler = actual.createMcpHandler(...args);
      return async (request: Request) => {
        h.forwarded.push(request);
        if (h.brokenStream.enabled) {
          const body = new ReadableStream<Uint8Array>({
            start(controller) {
              controller.enqueue(new TextEncoder().encode('event: message\ndata: {"jsonrpc":"2.0",'));
              controller.error(new Error("stream failure with internal detail"));
            },
          });
          return new Response(body, { status: 200, headers: { "content-type": "text/event-stream" } });
        }
        return handler(request);
      };
    },
  };
});

// The stand-in for a write tool, registered under `ping`'s name.
vi.mock("@/app/mcp/tools/ping", async () => {
  const { z } = await import("zod");
  const { revalidatePath } = await import("next/cache");
  const { after } = await import("next/server");
  return {
    registerPing: (server: import("@modelcontextprotocol/server").McpServer) => {
      server.registerTool(
        "ping",
        { inputSchema: z.object({}).strict(), annotations: { readOnlyHint: true, openWorldHint: false } },
        async (_args, ctx) => {
          if (h.notifyFirst.enabled) {
            // Progress needs no server capability (a log message would need `logging`).
            await ctx.mcpReq.notify({
              method: "notifications/progress",
              params: { progressToken: "completion-test", progress: 1 },
            });
          }
          const io = new Promise((resolve) => setTimeout(resolve, 0));
          // The client goes away while the tool's I/O is pending.
          h.disconnect.controller?.abort();
          await io;
          revalidatePath("/schedule");
          after(() => {});
          h.sequence.push("tool returned");
          return { content: [{ type: "text", text: "done" }] };
        },
      );
    },
  };
});

import { POST } from "@/app/api/mcp/route";
import { __clearGrantCache, createGrant } from "@/app/mcp/oauth/grantStore";
import { PREVIEW_ORIGIN } from "@/app/mcp/oauth/origin";
import { signAccessToken } from "@/app/mcp/oauth/tokens";

const KEY = new TextEncoder().encode("s".repeat(32));
const PREVIEW_HOST = "dev-owt-backstage.vercel.app";
const LEGACY_PROTOCOL = "2025-06-18";
const MODERN_PROTOCOL = "2026-07-28";
const MODERN_META = {
  "io.modelcontextprotocol/protocolVersion": MODERN_PROTOCOL,
  "io.modelcontextprotocol/clientCapabilities": {},
  "io.modelcontextprotocol/clientInfo": { name: "vitest", version: "0" },
};
/** Everything the tool must have done by the time `POST` resolves. */
const DONE_INSIDE_THE_HANDLER = ["revalidatePath /schedule", "after registered", "tool returned"];

async function liveToken(): Promise<string> {
  const created = await createGrant({ sub: "frank", clientId: "client-id-under-test", origin: PREVIEW_ORIGIN });
  if (!created.ok) throw new Error("fixture: grant not created");
  const { token } = await signAccessToken({ key: KEY, origin: PREVIEW_ORIGIN, sub: "frank", grantId: created.grantId });
  return token;
}

/** A 2025-06-18 `tools/call` for the stand-in tool; `signal` plays the client's connection. */
function legacyToolCall(token: string, signal?: AbortSignal): Request {
  return new Request("https://ignored.example/api/mcp", {
    method: "POST",
    ...(signal ? { signal } : {}),
    headers: {
      host: PREVIEW_HOST,
      accept: "application/json, text/event-stream",
      "content-type": "application/json",
      "mcp-protocol-version": LEGACY_PROTOCOL,
      authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "ping", arguments: {} } }),
  });
}

/** A 2026-07-28 `tools/call` for the stand-in tool: the envelope in `_meta`, plus the standard headers. */
function modernToolCall(token: string, signal?: AbortSignal): Request {
  return new Request("https://ignored.example/api/mcp", {
    method: "POST",
    ...(signal ? { signal } : {}),
    headers: {
      host: PREVIEW_HOST,
      accept: "application/json, text/event-stream",
      "content-type": "application/json",
      "mcp-protocol-version": MODERN_PROTOCOL,
      "mcp-method": "tools/call",
      "mcp-name": "ping",
      authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "tools/call",
      params: { name: "ping", arguments: {}, _meta: MODERN_META },
    }),
  });
}

/**
 * Sends the request and returns the tool's side effects AS OF the instant
 * `POST` resolved, plus the body — read in full, so a tool still running when
 * `POST` resolved finishes here and cannot leak into the next case.
 */
async function send(request: Request): Promise<{ res: Response; atResolve: string[]; body: string }> {
  const res = await POST(request);
  const atResolve = [...h.sequence];
  const body = await res.text();
  return { res, atResolve, body };
}

function sseMessages(text: string): Record<string, unknown>[] {
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
    .map((data) => JSON.parse(data) as Record<string, unknown>);
}

function expectToolResult(message: Record<string, unknown> | undefined) {
  expect(message?.id).toBe(1);
  expect(message?.error).toBeUndefined();
  expect(message?.result).toMatchObject({ content: [{ type: "text", text: "done" }] });
}

beforeEach(() => {
  vi.clearAllMocks();
  h.reset();
  h.sequence.length = 0;
  h.afterCallbacks.length = 0;
  h.notifyFirst.enabled = false;
  h.disconnect.controller = null;
  h.forwarded.length = 0;
  h.brokenStream.enabled = false;
  __clearGrantCache();
  vi.stubEnv("VERCEL_ENV", "preview");
  vi.stubEnv("MCP_OAUTH_SECRET", "s".repeat(32));
  h.getMemberAccess.mockResolvedValue({ active: true, role: "super-admin", ministries: ["worship"], managesMinistries: [] });
});

afterEach(async () => {
  // A tool a failing case left running needs one macrotask to finish; let it
  // land HERE, not in the next case's sequence.
  await new Promise((resolve) => setTimeout(resolve, 0));
  vi.unstubAllEnvs();
});

describe("/api/mcp — a tool call finishes inside the handler (F2)", () => {
  it("legacy era (2025-06-18): revalidatePath and after() run before POST resolves, and the SSE body is one result", async () => {
    const { res, atResolve, body } = await send(legacyToolCall(await liveToken()));

    // THE regression guard: without the completion gate, the SDK hands back the
    // SSE Response first and the tool's side effects land after it.
    expect(atResolve).toEqual(DONE_INSIDE_THE_HANDLER);
    expect(h.afterCallbacks).toHaveLength(1);

    // The framing the client parses is unchanged: an SSE stream carrying one JSON-RPC result.
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toMatch(/^text\/event-stream/);
    const messages = sseMessages(body);
    expect(messages).toHaveLength(1);
    expectToolResult(messages[0]);
  });

  it("modern era (2026-07-28), a plain result: settles as JSON after the tool returns — passes with or without the gate", async () => {
    // Documentation, not the regression guard: the SDK's "auto" response mode
    // already holds the Response until the result exists, and the gate hands a
    // non-SSE response through untouched.
    const { res, atResolve, body } = await send(modernToolCall(await liveToken()));

    expect(atResolve).toEqual(DONE_INSIDE_THE_HANDLER);
    expect(h.afterCallbacks).toHaveLength(1);

    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toMatch(/^application\/json/);
    expectToolResult(JSON.parse(body) as Record<string, unknown>);
  });

  it("modern era (2026-07-28), a notification mid-call: the SSE upgrade is held to completion too", async () => {
    // The hazard is not legacy-only: a request-scoped notification upgrades a
    // modern exchange to SSE and settles the Response while the tool is still
    // running — the same early return the legacy era always makes.
    h.notifyFirst.enabled = true;
    const { res, atResolve, body } = await send(modernToolCall(await liveToken()));

    expect(atResolve).toEqual(DONE_INSIDE_THE_HANDLER);
    expect(h.afterCallbacks).toHaveLength(1);

    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toMatch(/^text\/event-stream/);
    const messages = sseMessages(body);
    // The notification frame, then the result.
    expect(messages.map((m) => m.method ?? "result")).toEqual(["notifications/progress", "result"]);
    expectToolResult(messages[1]);
  });
});

describe("/api/mcp — a client that disconnects mid-call does not cut the tool short (P3-R10)", () => {
  // Next aborts the incoming request's signal when the socket closes. Were the
  // forwarded copy to follow it, the SDK would end the exchange early — the
  // legacy leg tears its stream down, the modern leg answers 499 — and
  // `handle()` would return with the tool still running. These fail without
  // `signal: null` in `forwardedRequest`.

  it("legacy era: the tool finishes inside the handler, and the SDK never sees the abort", async () => {
    const client = new AbortController();
    h.disconnect.controller = client;
    const { res, atResolve, body } = await send(legacyToolCall(await liveToken(), client.signal));

    expect(client.signal.aborted).toBe(true);
    expect(atResolve).toEqual(DONE_INSIDE_THE_HANDLER);
    expect(h.afterCallbacks).toHaveLength(1);
    // The focused runtime check: the request the MCP server was handed does not follow the client's signal.
    expect(h.forwarded).toHaveLength(1);
    expect(h.forwarded[0]!.signal.aborted).toBe(false);
    // The exchange completed normally; on Vercel it is written to a closed socket.
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toMatch(/^text\/event-stream/);
    const messages = sseMessages(body);
    expect(messages).toHaveLength(1);
    expectToolResult(messages[0]);
  });

  it("modern era: the tool finishes inside the handler, and the answer is the result, not a 499", async () => {
    const client = new AbortController();
    h.disconnect.controller = client;
    const { res, atResolve, body } = await send(modernToolCall(await liveToken(), client.signal));

    expect(client.signal.aborted).toBe(true);
    expect(atResolve).toEqual(DONE_INSIDE_THE_HANDLER);
    expect(h.afterCallbacks).toHaveLength(1);
    expect(h.forwarded).toHaveLength(1);
    expect(h.forwarded[0]!.signal.aborted).toBe(false);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toMatch(/^application\/json/);
    expectToolResult(JSON.parse(body) as Record<string, unknown>);
  });
});

describe("/api/mcp — an SSE body that errors is the fixed 500 (E1)", () => {
  it("is caught inside handle(): 500 server_error, nothing echoed or logged", async () => {
    // Holds only while `completeResponse` is awaited INSIDE the route's try: a
    // bare `return completeResponse(…)` would reject POST instead.
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      h.brokenStream.enabled = true;
      const res = await POST(legacyToolCall(await liveToken()));

      expect(h.forwarded).toHaveLength(1);
      expect(res.status).toBe(500);
      expect(res.headers.get("cache-control")).toBe("no-store");
      const text = await res.text();
      expect(JSON.parse(text)).toEqual({ error: "server_error" });
      expect(text).not.toMatch(/internal detail|jsonrpc/);
      const logged = consoleError.mock.calls.map((call) => call.map(String).join(" ")).join("\n");
      expect(logged).toBe("[mcp] route: unexpected failure");
    } finally {
      consoleError.mockRestore();
    }
  });
});
