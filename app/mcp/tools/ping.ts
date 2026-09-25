// MCP tool `ping` — the connector's health check: it proves the bearer check
// let the caller in and says which deployment answered. Reads nothing from the
// dataset (`ping.test.ts` walks its import closure to keep it that way).
//
// ONE FILE PER TOOL. Each tool module exports a `register<Tool>(server, deps)`
// that the MCP route calls inside `createMcpHandler`'s init, and follows the
// same four rules:
//   1. `inputSchema` is a STRICT zod object, so an unknown argument is refused
//      rather than ignored (spec I13). The SDK validates it before the handler
//      runs and answers a refusal as a tool error (`isError: true`).
//   2. `annotations` are explicit: reads say `readOnlyHint: true,
//      openWorldHint: false` (this server never reaches outside its own
//      dataset); every write is declared destructive (spec I14).
//   3. `title` and `description` are Spanish, like the rest of the app.
//   4. The handler never throws. The SDK would put `error.message` — Sanity's
//      text, a stack-ish detail — into the tool result, so every failure is
//      caught here and becomes a fixed Spanish tool error (spec E1). The log
//      line is fixed too: never the error, never anything from the request.
// The route has already authenticated the caller before any of this runs
// (spec I6); a tool that needs the principal reads `ctx.http?.authInfo`.
// `ctx.http?.req` carries only the headers the SDK needs (`FORWARDED_HEADERS`
// in `app/api/mcp/route.ts`) — never `Authorization`, a cookie or Vercel's
// bypass header, so no credential can be read from it.

import type { CallToolResult, McpServer } from "@modelcontextprotocol/server";
import { z } from "zod";
import { MCP_SERVER_NAME } from "../serverInfo";

const TIME_ZONE = "America/Mexico_City";

const FAILURE_MESSAGE = "No se pudo completar la comprobación. Inténtalo de nuevo.";

export interface PingPayload {
  ok: true;
  server: string;
  version: string;
  /** The current instant as ISO-8601 wall-clock time in America/Mexico_City, with its UTC offset. */
  now: string;
}

const wallClock = new Intl.DateTimeFormat("en-US", {
  timeZone: TIME_ZONE,
  hourCycle: "h23",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
});

function pad2(n: number): string {
  return String(n).padStart(2, "0");
}

/**
 * `instant` as `YYYY-MM-DDTHH:mm:ss±HH:MM` in America/Mexico_City, to the
 * second. The offset is DERIVED — the zone's wall clock minus the instant — so
 * it follows the time-zone rules (UTC-5 under the pre-2022 daylight saving,
 * UTC-6 today) instead of a hard-coded `-06:00`, and nothing here reads the
 * process time zone (UTC on Vercel).
 */
export function mexicoCityTimestamp(instant: Date): string {
  const parts: Record<string, string> = {};
  for (const part of wallClock.formatToParts(instant)) parts[part.type] = part.value;
  const [year, month, day, hour, minute, second] = [
    parts.year,
    parts.month,
    parts.day,
    parts.hour,
    parts.minute,
    parts.second,
  ].map(Number) as [number, number, number, number, number, number];
  const wallAsUtc = Date.UTC(year, month - 1, day, hour, minute, second);
  const wholeSecond = Math.floor(instant.getTime() / 1000) * 1000;
  const offsetMinutes = Math.round((wallAsUtc - wholeSecond) / 60_000);
  const sign = offsetMinutes < 0 ? "-" : "+";
  const abs = Math.abs(offsetMinutes);
  return (
    `${String(year).padStart(4, "0")}-${pad2(month)}-${pad2(day)}` +
    `T${pad2(hour)}:${pad2(minute)}:${pad2(second)}` +
    `${sign}${pad2(Math.floor(abs / 60))}:${pad2(abs % 60)}`
  );
}

/**
 * The tool's result: the payload as JSON text (for clients that read only
 * `content`) and as `structuredContent`. A failure is a fixed Spanish tool
 * error. `clock` is injectable for tests.
 */
export function pingResult(version: string, clock: () => Date = () => new Date()): CallToolResult {
  try {
    const payload: PingPayload = { ok: true, server: MCP_SERVER_NAME, version, now: mexicoCityTimestamp(clock()) };
    return {
      content: [{ type: "text", text: JSON.stringify(payload) }],
      structuredContent: { ...payload },
    };
  } catch {
    console.error("[mcp] ping: failed");
    return { content: [{ type: "text", text: FAILURE_MESSAGE }], isError: true };
  }
}

/** Registers `ping` on a per-request MCP server. `version` is the deployment's (`mcpServerVersion`). */
export function registerPing(server: McpServer, deps: { version: string }): void {
  server.registerTool(
    "ping",
    {
      title: "Comprobar conexión",
      description:
        "Comprueba que el servidor MCP de OWT Backstage responde y que tu conexión es válida. " +
        "No recibe argumentos y no lee ni escribe datos del equipo. Devuelve { ok, server, version, now }: " +
        "version es el commit desplegado y now es la hora actual en America/Mexico_City, con su desfase UTC.",
      inputSchema: z.object({}).strict(),
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async () => pingResult(deps.version),
  );
}
