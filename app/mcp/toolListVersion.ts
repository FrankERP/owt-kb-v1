// The tool list's own version, so a client with a stale copy hears about it (ADR-0069).
//
// claude.ai reads `tools/list` when the connector connects and keeps that copy: names, descriptions
// and input schemas. It does not act on `notifications/tools/list_changed` (and this stateless server
// could not send one anyway, `listChanged: false` in the route), so after a release that changes the
// list Claude goes on calling tools from the old one until Frank refreshes the connector. Nothing in
// a call says which copy the client holds, so every model-visible tool carries one more optional
// argument, `toolsVersion`, whose description asks for a fixed value: the digest of the list as this
// deployment serves it. A call that sends another value, or none, came from an older copy. The tool
// still runs (the server validates every argument it accepts, so an old copy cannot slip anything
// past it); its answer just gains one more text line asking Claude to tell the user to refresh.
//
// The digest covers everything a client caches about a tool, and nothing else: a release that
// changes only code behind the tools keeps it, so it does not nag. App-only tools (the card's twins)
// are left alone: the card, not the model, calls them.

import { createHash } from "node:crypto";
import type { CallToolResult, McpServer } from "@modelcontextprotocol/server";
import { z } from "zod";

export const TOOLS_VERSION_ARG = "toolsVersion";

/** Model-facing; appended to a stale caller's answer. Exported for the tests. */
export const STALE_TOOL_LIST_NOTE =
  "Aviso del servidor OWT Backstage: la lista de herramientas que tienes guardada es de una versión anterior " +
  "(este resultado sí es válido). Dile al usuario, en una frase y sin repetirlo si ya se lo dijiste en esta " +
  "conversación, que actualice el conector: Ajustes → Conectores → OWT Backstage → menú «⋯» → «Refresh tools list» " +
  "(si no aparece, Desconectar y Conectar), y que siga en un chat nuevo.";

type ToolConfig = {
  title?: string;
  description?: string;
  inputSchema?: unknown;
  outputSchema?: unknown;
  annotations?: unknown;
  _meta?: { ui?: { visibility?: readonly string[] } } & Record<string, unknown>;
};
type ToolHandler = (args: Record<string, unknown>, ctx: unknown) => CallToolResult | Promise<CallToolResult>;
type RegisterTool = (name: string, config: ToolConfig, handler: ToolHandler) => unknown;

/** Only the card calls a tool whose visibility is `["app"]`; it is bundled from this deployment. */
function appOnly(config: ToolConfig): boolean {
  const visibility = config._meta?.ui?.visibility;
  return Array.isArray(visibility) && !visibility.includes("model");
}

function jsonSchemaOf(schema: unknown): unknown {
  return schema instanceof z.ZodType ? z.toJSONSchema(schema) : null;
}

/**
 * The digest of every tool `register` puts on a server, as a client would cache it: name, title,
 * description, input and output schemas, annotations and `_meta`, in registration order. Runs
 * `register` against a recorder that keeps the tool definitions and ignores everything else.
 */
export function toolListDigest(register: (server: McpServer) => void): string {
  const tools: unknown[] = [];
  const recorder = {
    registerTool: (name: string, config: ToolConfig) => {
      tools.push({
        name,
        title: config.title ?? null,
        description: config.description ?? null,
        input: jsonSchemaOf(config.inputSchema),
        output: jsonSchemaOf(config.outputSchema),
        annotations: config.annotations ?? null,
        meta: config._meta ?? null,
      });
    },
    registerResource: () => undefined,
  };
  register(recorder as unknown as McpServer);
  return createHash("sha256").update(JSON.stringify(tools)).digest("hex").slice(0, 8);
}

/**
 * Makes every model-visible tool `server` registers from now on carry `toolsVersion`: the schema
 * gains it as an optional string, the handler never sees it, and an answer to a call whose value is
 * not `version` gains `STALE_TOOL_LIST_NOTE`. Call it first thing in the route's init.
 */
export function versionToolList(server: McpServer, version: string): void {
  const register = (server.registerTool as unknown as RegisterTool).bind(server);
  const versioned: RegisterTool = (name, config, handler) => {
    if (appOnly(config) || !(config.inputSchema instanceof z.ZodObject)) return register(name, config, handler);
    const inputSchema = config.inputSchema.safeExtend({
      [TOOLS_VERSION_ARG]: z
        .string()
        .max(32)
        .optional()
        .describe(`Pásalo siempre, con el valor "${version}": es la versión de esta lista de herramientas.`),
    });
    return register(name, { ...config, inputSchema }, async (args, ctx) => {
      const { [TOOLS_VERSION_ARG]: sent, ...rest } = args ?? {};
      const result = await handler(rest, ctx);
      if (sent === version) return result;
      return { ...result, content: [...(result.content ?? []), { type: "text", text: STALE_TOOL_LIST_NOTE }] };
    });
  };
  (server as unknown as { registerTool: RegisterTool }).registerTool = versioned;
}
