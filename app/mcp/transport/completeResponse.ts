// app/mcp/transport/completeResponse.ts
//
// The completion gate of `/api/mcp` (P3 plan step 1, finding F2): every MCP
// exchange finishes INSIDE the route handler, whatever the protocol era.
//
// WHY. Next resolves a route's pending `revalidatePath` tags once, when the
// handler's promise resolves; a tag pushed after that is never executed, and
// nothing says so. An `after()` registered that late is in the same position.
// The SDK can hand the route an SSE `Response` while the tool is still running:
//   - 2025-06-18 (legacy): every `tools/call` is answered with an SSE stream at
//     once, and the tool runs afterwards;
//   - 2026-07-28: the "auto" response mode settles JSON after the result — but
//     a request-scoped notification sent mid-call upgrades the exchange to SSE
//     and settles the `Response` right then, with the tool still running.
// So a write tool's cache invalidation would be dropped silently. Reading the
// stream to its end before returning keeps the tool's whole body inside the
// handler. `mcpToolCompletion.test.ts` is the guard.
//
// Safe because `/api/mcp` holds no stream by design (`maxSubscriptions: 0`,
// `listChanged: false` — see the route): every stream it serves ends with its
// one JSON-RPC response. The SSE framing is unchanged, so clients parse the
// body exactly as before; what they lose is only incremental delivery — the
// keep-alive comments and any notification now arrive together with the result.
//
// Its own module (not a helper inside `route.ts`, whose exports Next pins to
// the HTTP methods and the route config) so anything that drives the MCP
// handler — the route, a local spike — exercises this exact code.

const EVENT_STREAM = "text/event-stream";

/** The media type of a `Content-Type` value: its parameters dropped, lower-cased. */
function mediaType(contentType: string | null): string {
  return (contentType ?? "").split(";", 1)[0]!.trim().toLowerCase();
}

/**
 * `response`, finished: an SSE response is read to its end and returned as a
 * new `Response` with the same status and headers and the same bytes; anything
 * else is returned untouched. A stream that errors rejects here — the caller's
 * catch handles it.
 */
export async function completeResponse(response: Response): Promise<Response> {
  if (mediaType(response.headers.get("content-type")) !== EVENT_STREAM) return response;
  const text = await response.text();
  return new Response(text, { status: response.status, statusText: response.statusText, headers: response.headers });
}
