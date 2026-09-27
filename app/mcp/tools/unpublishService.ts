// MCP tool `unpublish_service` (P3 step 8): hide ONE published service
// (`published: false`), through the same narrow domain writer `/admin`'s
// «Ocultar» button calls — `unpublishRoles` (`app/utils/roleUnpublishCommit.ts`)
// — via the write foundation's `runWriteTool`/`callDomain` (step 7).
//
// Unpublish is a SEPARATE safety capability (the writer's own header): it does
// not use publish readiness and accepts no blocker acknowledgements. A
// published service may be hidden even when its team, availability, setlist or
// proposal is unsafe, incomplete, conflicted or invalid — that is precisely
// when hiding it matters. So this tool makes NO admission READ of its own
// before calling the domain, and `serviceId`/`rev` (from `get_service` or
// `list_services`) become the counterpart's own request body, unchanged.
// `mode: "recover"` is never sent — this tool always performs the write,
// never a read-only outcome check.
//
// SHAPE, twice (review round 1, IMPORTANT). `isCanonicalDocumentId`/
// `isRevisionString` are the exact predicates `unpublishRoles`'s own parser
// checks `serviceId`/`rev` against (bounded, no whitespace, never `drafts.*`).
// Both the exported zod schema AND `unpublishServiceResult` itself check them:
// the schema so the SDK's own validation refuses a `drafts.*` id or a
// whitespace-containing rev before this function is even called in
// production, and the function's own `pre`-phase check so calling it directly
// — every test in this repo does, and any future caller might — still refuses
// cleanly, in Spanish, with ZERO domain calls, rather than reaching
// `unpublishRoles`'s parser and rendering its `invalid_request` /
// `issues: ["role_id" | "role_rev"]` (which needs its own translation in
// `refusals.ts`'s `ISSUE_COPY` regardless, since a request can still reach the
// domain with a shape only the domain's OWN, slightly different rules reject).
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
import { isCanonicalDocumentId, isRevisionString } from "@/app/utils/roleWriteRequest";
import { unpublishRoles } from "@/app/utils/roleUnpublishCommit";
import { admissionRefusal, refusalFor } from "../writes/refusals";
import { runWriteTool } from "../writes/runWriteTool";

const SERVICE_ID_MESSAGE = "serviceId no es un id de servicio válido; usa el que devuelve get_service.";
const REV_MESSAGE = "rev no es una revisión válida; usa la que devuelve get_service.";

export const UNPUBLISH_SERVICE_INPUT = z
  .object({
    serviceId: z.string().refine(isCanonicalDocumentId, { message: SERVICE_ID_MESSAGE }),
    rev: z.string().refine(isRevisionString, { message: REV_MESSAGE }),
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
    // The schema already checks this (the SDK refuses malformed input before
    // this function runs at all), but this function is also called directly —
    // every test in this file's own suite does — so it re-checks itself: zero
    // domain calls for a shape the domain would refuse anyway.
    if (!isCanonicalDocumentId(args.serviceId)) {
      return admissionRefusal("invalid_request", "invalid_service_id", SERVICE_ID_MESSAGE);
    }
    if (!isRevisionString(args.rev)) {
      return admissionRefusal("invalid_request", "invalid_revision", REV_MESSAGE);
    }

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
