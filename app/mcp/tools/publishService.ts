// MCP tool `publish_service` (P3 step 9): publish ONE service in `mode: "ready"`
// ONLY — never `override`, never `recover` — through the same server-authoritative
// domain writer `/admin` → Servicios' «Publicar» calls: `publishReady`
// (`app/utils/publishReadyCommit.ts`), via the write foundation's
// `runWriteTool`/`callDomain` (step 7).
//
// NO OVERRIDE, BY SHAPE (I4 / roadmap "expose no override"). The strict schema
// is `{ serviceId, rev }` only: no `mode`, no `acknowledgedBlockers`. There is no
// way to construct a call that names blockers to acknowledge, so an override or a
// recovery cannot be EXPRESSED, let alone sent — `publishServiceBody` below is the
// one place the domain body is built, and it never carries `override`,
// `acknowledgedBlockers` or `recover`.
//
// A workflow blocker (empty team, availability conflict, active proposal,
// incomplete setlist) can only be overridden from `/admin`; a hard integrity
// blocker cannot be overridden anywhere. This tool never has to say which case it
// is: `refusalFor` already renders every blocker it names in words, read from
// `details.services[].reasons` (never the top-level code, F10), and already
// appends the one Spanish note about where an override lives
// (`PUBLISH_OVERRIDE_NOTE`, step 7) — this file must never append it again.
//
// SHAPE, TWICE (the same review-round-1 fix task 8 carries forward).
// `isCanonicalDocumentId`/`isRevisionString` are the exact predicates
// `publishReady`'s own request parser checks `serviceId`/`rev` against. Both the
// exported zod schema AND `publishServiceResult` itself check them: the schema so
// the SDK's own validation refuses a `drafts.*` id or a whitespace-containing rev
// before this function is even called in production, and the function's own
// `pre`-phase check so calling it directly — every test in this file's own suite
// does — still refuses cleanly, in Spanish, with ZERO domain calls.
//
// A RETRY IS NEVER A NO-OP. Unlike `unpublish_service`, `ready` mode has no
// success no-op: a service that is already published is a REFUSAL
// (`already_published`, one of `publishVerdict`'s reasons), and the first call
// that really published one moves its revision, so a retry with the same `rev`
// is refused `stale_revision` too — `refusalFor` reports both together, leading
// with «ya está publicado».
//
// SUCCESS is reported from `outcome.effects` (`PublishReadyEffects`) ONLY —
// never re-derived: `publishNotifications`/`resolveNotifications` (step 7's
// `reports.ts`) turn the two post-commit descriptors (the assignment push +
// consolidated email batch, and the «Setlist listo» outbox notice) into the
// exact same QUEUED report every other write tool gives, with names resolved
// through one `safeReportRead`. The «Setlist listo» notice is queued only if the
// service turns out to have songs — decided inside `after()`, after this
// response — so its entry says so as a condition, never as a promise.
//
// `revalidateRolePublication()` touches three paths (`/`, `/schedule`, `/me`);
// this tool states that plainly rather than re-deriving it from the writer.

import type { CallToolResult, McpServer } from "@modelcontextprotocol/server";
import { z } from "zod";
import { isCanonicalDocumentId, isRevisionString } from "@/app/utils/roleWriteRequest";
import { publishReady } from "@/app/utils/publishReadyCommit";
import { admissionRefusal, refusalFor } from "../writes/refusals";
import { runWriteTool } from "../writes/runWriteTool";
import { OUTBOX_SWEEP_NOTE, publishNotifications, resolveNotifications } from "../writes/reports";

const SERVICE_ID_MESSAGE = "serviceId no es un id de servicio válido; usa el que devuelve get_service.";
const REV_MESSAGE = "rev no es una revisión válida; usa la que devuelve get_service.";

export const PUBLISH_SERVICE_INPUT = z
  .object({
    serviceId: z.string().refine(isCanonicalDocumentId, { message: SERVICE_ID_MESSAGE }),
    rev: z.string().refine(isRevisionString, { message: REV_MESSAGE }),
  })
  .strict();

export type PublishServiceArgs = z.infer<typeof PUBLISH_SERVICE_INPUT>;

export const PUBLISH_SERVICE_DESCRIPTION =
  "Publica UN servicio del equipo de alabanza (published: true), exactamente como «Publicar» en /admin → " +
  "Servicios en modo listo. Vuelve a leer el servicio en el servidor y recalcula la verificación de publicación " +
  "(la misma que usa get_service en readiness.publishCheck) antes de escribir: nunca confía en lo que el llamador " +
  "leyó antes. Si el servicio tiene bloqueos, se rechaza y el mensaje los lista en español; un bloqueo de flujo " +
  "(equipo vacío, conflicto de disponibilidad, propuesta activa, setlist incompleto) solo se puede forzar desde " +
  "/admin, y uno de integridad nunca se puede forzar — esta herramienta no admite reconocer bloqueos ni forzar " +
  "nada. Si el servicio ya está publicado, se rechaza («ya está publicado»); una repetición con la misma rev " +
  "después de publicar también se rechaza, porque la revisión ya cambió. Al publicar: cada asignado actual recibe " +
  "una notificación push «Nuevo servicio asignado» y un correo de asignación consolidado; si el servicio tiene " +
  "canciones también se encola, de inmediato, un aviso «Setlist listo» a sus participantes (eso se decide después " +
  "de responder); y /, /schedule y /me se actualizan. serviceId y rev deben venir tal cual de get_service o " +
  "list_services. Solo publica: no acepta ningún modo de forzar ni de recuperar un resultado.";

/** The exact domain body this tool ever sends — `ready` mode, one role, nothing else. */
export function publishServiceBody(args: PublishServiceArgs) {
  return { mode: "ready" as const, roles: [{ id: args.serviceId, rev: args.rev }] };
}

/** The tool's whole behaviour, callable without a server (the route registers it below). */
export async function publishServiceResult(args: PublishServiceArgs): Promise<CallToolResult> {
  return runWriteTool("publish_service", async ({ callDomain }) => {
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

    const outcome = await callDomain(() => publishReady(publishServiceBody(args)));
    if (!outcome.ok) return refusalFor(outcome);

    const pending = publishNotifications(outcome.effects);
    const notifications = await resolveNotifications(pending);
    const sweepNote = outcome.effects.notice ? OUTBOX_SWEEP_NOTE : null;

    const text = [
      "Servicio publicado. /, /schedule y /me se actualizan.",
      ...notifications.map((n) => n.summary),
      ...(sweepNote ? [sweepNote] : []),
    ].join(" ");

    return {
      content: [{ type: "text", text }],
      structuredContent: {
        ok: true,
        serviceId: args.serviceId,
        published: "published",
        notifications,
        ...(sweepNote ? { sweepNote } : {}),
      },
    };
  });
}

/** Registers `publish_service` on a per-request MCP server. */
export function registerPublishService(server: McpServer): void {
  server.registerTool(
    "publish_service",
    {
      title: "Publicar un servicio",
      description: PUBLISH_SERVICE_DESCRIPTION,
      inputSchema: PUBLISH_SERVICE_INPUT,
      annotations: {
        readOnlyHint: false,
        destructiveHint: true,
        idempotentHint: false,
        openWorldHint: false,
      },
    },
    async (args) => publishServiceResult(args),
  );
}
