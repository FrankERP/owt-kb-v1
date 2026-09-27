// MCP tool `unpublish_service` (P3 step 8): hide ONE published service
// (`published: false`), through the same narrow domain writer `/admin`'s
// «Ocultar» button calls — `unpublishRoles` (`app/utils/roleUnpublishCommit.ts`)
// — via the write foundation's `runWriteTool`/`callDomain` (step 7).
//
// Unpublish is a SEPARATE safety capability (the writer's own header): it does
// not use publish readiness and accepts no blocker acknowledgements. A
// published service may be hidden even when its team, availability, setlist or
// proposal is unsafe, incomplete, conflicted or invalid — that is precisely
// when hiding it matters. So this tool makes NO admission read of its own
// before calling the domain: the strict input schema is the only gate, and
// `serviceId`/`rev` (from `get_service` or `list_services`) become the
// counterpart's own request body, unchanged. `mode: "recover"` is never sent —
// this tool always performs the write, never a read-only outcome check.
//
// NO NOTIFICATIONS (F1): hiding a service notifies nobody, by design (A2 §7,
// `roleUnpublishCommit.ts`'s header) — there is no `after()` block to describe,
// so `notifications` is always `[]` and the text says so plainly. `published`
// is always `"draft"` in the success payload: the service either already was
// one, or this call just made it one.
//
// `changed` distinguishes the two success shapes (spec U1): `true` is the real
// `published: false` transition; `false` is `/admin`'s own `200 unpublished: 0`
// no-op (the passed `rev` was already current, and the service was already a
// draft) — reported WITHOUT success wording, and mentioning no refresh, since
// nothing changed. A retry of a call that already hid the service is NOT this
// no-op: the first call moved the revision, so the retry is refused
// `stale_revision` by `loadRoleForWrite`, through `refusalFor`.

import type { CallToolResult, McpServer } from "@modelcontextprotocol/server";
import { z } from "zod";
import { unpublishRoles } from "@/app/utils/roleUnpublishCommit";
import { refusalFor } from "../writes/refusals";
import { runWriteTool } from "../writes/runWriteTool";

export const UNPUBLISH_SERVICE_INPUT = z
  .object({
    serviceId: z.string().min(1).max(200),
    rev: z.string().min(1).max(200),
  })
  .strict();

export type UnpublishServiceArgs = z.infer<typeof UNPUBLISH_SERVICE_INPUT>;

export const UNPUBLISH_SERVICE_DESCRIPTION =
  "Oculta UN servicio del equipo de alabanza (published: false), exactamente como «Ocultar» en /admin → " +
  "Servicios. Es una acción de seguridad aparte de publicar: no usa la verificación de publicación ni acepta " +
  "bloqueos reconocidos, así que un servicio puede ocultarse aunque su equipo, disponibilidad, setlist o " +
  "propuesta estén incompletos, en conflicto o sean inválidos — para eso sirve. No notifica a nadie: ocultar " +
  "es silencioso por diseño, y /schedule y /me dejan de mostrar el servicio de inmediato. serviceId y rev deben " +
  "venir tal cual de get_service o list_services; si rev ya no coincide con la revisión guardada, se rechaza " +
  "(stale_revision) para nunca ocultar por accidente un servicio que cambió desde que lo leíste. Si el servicio " +
  "ya era un borrador y la revisión sigue vigente, no se escribe nada y la respuesta lo dice sin dar la " +
  "impresión de que algo se aplicó.";

/** The tool's whole behaviour, callable without a server (the route registers it below). */
export async function unpublishServiceResult(args: UnpublishServiceArgs): Promise<CallToolResult> {
  return runWriteTool("unpublish_service", async ({ callDomain }) => {
    const outcome = await callDomain(() =>
      unpublishRoles({ roles: [{ id: args.serviceId, rev: args.rev }] }),
    );
    if (!outcome.ok) return refusalFor(outcome);

    const changed = outcome.effects.toPatch.length > 0;
    const text = changed
      ? "Servicio oculto. Nadie recibe aviso; /schedule y /me se actualizan."
      : "Ya estaba oculto: el servicio ya era un borrador. No se cambió nada.";
    return {
      content: [{ type: "text", text }],
      structuredContent: {
        ok: true,
        serviceId: args.serviceId,
        changed,
        published: "draft",
        notifications: [],
      },
    };
  });
}

/** Registers `unpublish_service` on a per-request MCP server. */
export function registerUnpublishService(server: McpServer): void {
  server.registerTool(
    "unpublish_service",
    {
      title: "Ocultar un servicio",
      description: UNPUBLISH_SERVICE_DESCRIPTION,
      inputSchema: UNPUBLISH_SERVICE_INPUT,
      annotations: {
        readOnlyHint: false,
        destructiveHint: true,
        idempotentHint: false,
        openWorldHint: false,
      },
    },
    async (args) => unpublishServiceResult(args),
  );
}
