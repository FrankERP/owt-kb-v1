// app/mcp/writes/runWriteTool.ts — the MCP write tools' runner (P3 step 7).
// NEUTRAL: no `server-only`, no Sanity import, no domain import.
//
// Every write tool's handler runs inside `runWriteTool`, exactly as every read
// tool's runs inside `runReadTool` (`../reads/errors.ts`): it catches every
// throw, so a Sanity error's message (a host, a dataset, `token=…`) can never
// reach the model through the SDK's `error.message` (spec E1).
//
// THE PHASE. A read that throws can simply say "try again". A write cannot: a
// throw that happened AFTER the domain started may be a write that landed.
// So the runner tracks one fact — was the domain called yet? — and never
// claims more than it knows:
//
//   - The handler receives `callDomain(fn)`. Every tool calls its `*Commit`
//     function ONLY through it. The call starts in phase `pre`; `callDomain`
//     sets the phase to `domain` synchronously, before it invokes `fn`, and
//     nothing ever sets it back. A throw while the tool builds the report of a
//     committed write therefore still counts as `domain`.
//   - A throw in `pre` (a pre-read, the admission, a resolution, a row
//     translation, an input check) happened before any domain code ran. The
//     tools import no Sanity client and every pre-read is a read, so nothing
//     can have been written: «No se pudo preparar el cambio; vuelve a
//     intentarlo. No se escribió nada.»
//   - A throw in `domain` is an UNKNOWN outcome, never "no se guardó" (spec
//     I9, E1): «No se pudo confirmar si el cambio se guardó. Antes de
//     reintentar, vuelve a leer el servicio con get_service.» A `bootstrap_*`
//     maintenance write happens inside the domain, so it is on this side.
//
// A tool that calls its domain function outside `callDomain` would turn an
// unknown outcome into «No se escribió nada.»; each tool's own test throws from
// the mocked domain function and asserts the unknown-outcome text, which fails
// on exactly that mistake.
//
// Post-commit REPORT reads (member names, a read-back, a hint) must never reach
// this catch: once the domain returned `ok: true` the write is committed, and
// «No se pudo confirmar…» would be false. Each is made through
// `safeReportRead` (below), which catches it where it is made.
//
// There is deliberately no abort signal here (ruling P3-R10): nothing between a
// commit and its revalidate/`after()` may be cut short by a client disconnect.
//
// LOGGING. On a throw: one FIXED tag per phase plus the tool name, nothing
// else — never the error, a stack, an argument or an id. On every call: the
// timing line from `finally` (`../toolTiming.ts`).

import type { CallToolResult } from "@modelcontextprotocol/server";
import { logToolTiming, resultOutcome, toolTimingStart, type ToolOutcome } from "../toolTiming";

/** A throw before the domain was called: nothing was written. */
export const WRITE_PRE_FAILURE_MESSAGE =
  "No se pudo preparar el cambio; vuelve a intentarlo. No se escribió nada.";

/** A throw at or after the domain call: the write may or may not have landed. */
export const WRITE_UNKNOWN_OUTCOME_MESSAGE =
  "No se pudo confirmar si el cambio se guardó. Antes de reintentar, vuelve a leer el servicio con get_service.";

export type WritePhase = "pre" | "domain";

/** Calls a `*Commit` domain function, marking the call as having reached the domain first. */
export type CallDomain = <T>(fn: () => T | Promise<T>) => Promise<T>;

export interface WriteToolContext {
  /** The ONLY way a write tool may call its `*Commit` function. */
  callDomain: CallDomain;
}

/** The fixed log tags, one per phase. Never templated. */
const FAILURE_TAG: Record<WritePhase, string> = {
  pre: "[mcp-write] tool failed before the domain call:",
  domain: "[mcp-write] tool failed at or after the domain call:",
};

const FAILURE_MESSAGE: Record<WritePhase, string> = {
  pre: WRITE_PRE_FAILURE_MESSAGE,
  domain: WRITE_UNKNOWN_OUTCOME_MESSAGE,
};

/**
 * Runs a write tool's handler. A returned result passes through untouched (a
 * refusal included); a throw — synchronous or a rejected promise — becomes the
 * fixed Spanish text of the phase it came from.
 */
export async function runWriteTool(
  toolName: string,
  handler: (ctx: WriteToolContext) => CallToolResult | Promise<CallToolResult>,
): Promise<CallToolResult> {
  const startedAt = toolTimingStart();
  let phase: WritePhase = "pre";
  let outcome: ToolOutcome = "error";
  let code = "-";

  const callDomain: CallDomain = async (fn) => {
    // Synchronously, before `fn` runs: an `async` function's body runs up to
    // its first `await` in the caller's turn, so even a `fn` that throws
    // synchronously is already on the `domain` side.
    phase = "domain";
    return await fn();
  };

  try {
    const result = await handler({ callDomain });
    ({ outcome, code } = resultOutcome(result));
    return result;
  } catch {
    console.error(FAILURE_TAG[phase], toolName);
    return { isError: true, content: [{ type: "text", text: FAILURE_MESSAGE[phase] }] };
  } finally {
    logToolTiming(toolName, outcome, code, startedAt);
  }
}

/** A post-commit report read's result: its value, or the fact that it failed. */
export type ReportRead<T> = { ok: true; value: T } | { ok: false };

/**
 * Runs ONE post-commit report read — member names, the unavailability lookup,
 * the read-back behind a fresh observation or `freshRevs`, the repeat hint —
 * and catches its throw HERE, so it never reaches `runWriteTool`'s catch and a
 * committed write is never reported as an unknown outcome. The caller degrades
 * only the field this read feeds (a name marked unresolved, `observation:
 * null` with «vuelve a leer con get_service», the hint left out).
 *
 * `label` must be a fixed string naming the read; it is logged with a fixed
 * tag, and nothing else is — never the error.
 */
export async function safeReportRead<T>(label: string, read: () => T | Promise<T>): Promise<ReportRead<T>> {
  try {
    return { ok: true, value: await read() };
  } catch {
    console.error("[mcp-write] report read failed:", label);
    return { ok: false };
  }
}
