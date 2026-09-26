// app/mcp/toolTiming.ts — the ONE timing line every MCP tool call logs (P3
// step 7). NEUTRAL: no `server-only`, no Sanity import.
//
// WHY IT EXISTS. Vercel's runtime logs on this plan carry no request duration
// (observed 2026-09-25: neither the logs API nor `vercel logs --json` has a
// duration field, and the Observability API answers 404 on Hobby). So the read
// runner (`runReadTool`, `reads/errors.ts`) and the write runner
// (`runWriteTool`, `writes/runWriteTool.ts`) each log exactly one line per call,
// from their `finally`, in this shape:
//
//   [mcp] tool=<name> outcome=<ok|refused|error> code=<code|-> ms=<n>
//
// Read it with `vercel logs <deployment> --json`: each record's `message`
// carries the line. It is how the P1 latency figure and P3's live-proof
// durations are measured (docs/MCP.md, «Known behaviours»).
//
// WHAT IT NEVER CARRIES: an argument, an id, a member or service name, a
// payload, an error message. `name` is the tool's own registered name (a
// constant), `code` is a machine code from the writers' own vocabulary and is
// dropped to `-` unless it is a bare lowercase token, and `ms` is an integer.
//
// `console.info`, never `console.error`: this is a measurement, not a failure,
// and the P1 tool tests spy on `console.error` to prove a failure logs nothing
// secret.

import type { CallToolResult } from "@modelcontextprotocol/server";

export type ToolOutcome = "ok" | "refused" | "error";

/** A code is logged only when it is a bare machine token; anything else is `-`. */
const SAFE_CODE = /^[a-z][a-z0-9_]{0,63}$/;

/**
 * The outcome and code a returned result reports: `refused` for a tool error
 * the handler returned on purpose (`isError: true`), `ok` otherwise. The code is
 * `structuredContent.code` when the result carries one (the write refusals do),
 * else `-`.
 */
export function resultOutcome(result: CallToolResult): { outcome: ToolOutcome; code: string } {
  const outcome: ToolOutcome = result.isError ? "refused" : "ok";
  const content: unknown = result.structuredContent;
  const raw = content && typeof content === "object" ? (content as Record<string, unknown>).code : undefined;
  const code = typeof raw === "string" && SAFE_CODE.test(raw) ? raw : "-";
  return { outcome, code };
}

/** The timing line, exactly. `ms` is rounded to a non-negative integer. */
export function toolTimingLine(name: string, outcome: ToolOutcome, code: string, ms: number): string {
  const safeCode = SAFE_CODE.test(code) ? code : "-";
  const safeMs = Number.isFinite(ms) ? Math.max(0, Math.round(ms)) : 0;
  return `[mcp] tool=${name} outcome=${outcome} code=${safeCode} ms=${safeMs}`;
}

/** Logs the timing line for one tool call. Never throws. */
export function logToolTiming(name: string, outcome: ToolOutcome, code: string, startedAt: number): void {
  try {
    console.info(toolTimingLine(name, outcome, code, performance.now() - startedAt));
  } catch {
    // A logging failure must never change a tool's result.
  }
}

/** The start mark `logToolTiming` measures from. */
export function toolTimingStart(): number {
  return performance.now();
}
