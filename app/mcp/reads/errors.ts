// app/mcp/reads/errors.ts — the P1 read tools' shared result builders (spec
// E1). NEUTRAL: no `server-only`, no Sanity import. Every read tool's handler
// wraps its work in `runReadTool` so a Sanity error's message — a host, a
// dataset name, a bare `token=…` query string — can never reach the model,
// exactly as `ping.ts` already does for its one failure mode. See that file's
// header for the four-rule pattern every tool follows; this module is what a
// read tool with dataset calls, not just a static payload, reuses instead of
// re-deriving the same catch block per tool.
//
// `refusalResult` is for a handler that DECIDES, without throwing, that it
// cannot honor the call — an ambiguous name, an unknown id (spec D8). That is
// not a dataset failure, so it carries its own specific Spanish message
// (never the fixed one) and may attach candidate data for the model to retry
// with. `successResult` is `ping.ts`'s own success shape, pulled out so every
// tool builds it the same way: JSON text for a client that reads only
// `content`, plus `structuredContent` for one that reads the typed payload.

import type { CallToolResult } from "@modelcontextprotocol/server";

/** The one message a dataset failure ever shows the model. Never templated. */
export const READ_TOOL_FAILURE_MESSAGE = "No se pudo completar la consulta. Intenta de nuevo en un momento.";

/**
 * Runs a read tool's handler and catches every throw — synchronous or a
 * rejected promise, both land in this one `catch`. On a throw, logs a FIXED
 * tag and the tool name ONLY: never the error's message, its stack, a token or
 * a query. Returns the fixed Spanish tool error instead of letting the SDK
 * surface `error.message`, which is Sanity's own text.
 */
export async function runReadTool(
  toolName: string,
  handler: () => CallToolResult | Promise<CallToolResult>,
): Promise<CallToolResult> {
  try {
    return await handler();
  } catch {
    console.error("[mcp-read] tool failed:", toolName);
    return { isError: true, content: [{ type: "text", text: READ_TOOL_FAILURE_MESSAGE }] };
  }
}

/**
 * A validation refusal — an ambiguous selector, an unknown id — with the
 * caller's own Spanish message. `structuredContent`, when given, is data the
 * model can act on (e.g. `{ candidates }`), never anything from the dataset's
 * internals.
 */
export function refusalResult(message: string, structuredContent?: Record<string, unknown>): CallToolResult {
  return {
    isError: true,
    content: [{ type: "text", text: message }],
    ...(structuredContent !== undefined ? { structuredContent } : {}),
  };
}

/**
 * A successful read: the payload as JSON text (for a client that reads only
 * `content`) and as `structuredContent` (for one that reads the typed
 * payload) — `ping.ts`'s own shape (`pingResult`), shared here so every read
 * tool builds it identically.
 */
export function successResult<T extends Record<string, unknown>>(payload: T): CallToolResult {
  return {
    content: [{ type: "text", text: JSON.stringify(payload) }],
    structuredContent: { ...payload },
  };
}
