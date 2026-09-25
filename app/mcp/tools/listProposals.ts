// MCP tool `list_proposals` (P1 step 7): a service's or a month's setlist
// proposals, with the LIVE `messages[]` thread and whether it is still open —
// never the frozen `lead_notes` / `admin_notes` / `team_notes` archive (ledger
// A7). Follows `ping.ts`'s four rules: a strict zod input, `readOnlyHint`,
// Spanish copy, and a handler that never throws — every failure is
// `runReadTool`'s fixed Spanish error (spec E1).
//
// One snapshot per call (`loadServiceSnapshot`). `{ serviceId }` reuses
// `get_service`'s own selector validation and resolution (`parseServiceSelector`
// / `resolveService`), so a serviceId is refused or resolved exactly the same
// way. `{ month }` defaults to the current CDMX month. D6: a single service's
// thread comes back whole; a month view caps each proposal's `messages` to the
// last 10 (chronological), flagged `truncated`, with `messagesTotal` always
// the full count. Unread state is never reported (ADR-0024).

import type { CallToolResult, McpServer } from "@modelcontextprotocol/server";
import { z } from "zod";
import { serviceTodayIso } from "@/app/components/admin/serviceReadiness";
import { refusalResult, runReadTool, successResult } from "../reads/errors";
import {
  LIST_PROPOSALS_UNREADABLE_MESSAGE,
  presentProposalsForMonth,
  presentProposalsForService,
  proposalContentIds,
  proposalsForMonth,
  proposalsForService,
  proposalsUnreadable,
} from "../reads/proposalPresenter";
import { parseServiceSelector, resolveService, type ServiceSelector } from "../reads/servicePresenter";
import { loadMemberNames, loadServiceSnapshot } from "../reads/serviceSnapshot";
import { loadSongTitles } from "../reads/songTitles";

export const LIST_PROPOSALS_INPUT = z
  .object({
    serviceId: z.string().max(200).optional(),
    month: z
      .string()
      .regex(/^\d{4}-(0[1-9]|1[0-2])$/)
      .optional(),
  })
  .strict();

export type ListProposalsArgs = z.infer<typeof LIST_PROPOSALS_INPUT>;

export const LIST_PROPOSALS_DESCRIPTION =
  "Lista las propuestas de setlist del equipo de alabanza, con su conversación VIVA (la del campo messages; nunca las " +
  "notas congeladas lead_notes/admin_notes/team_notes) y si esa conversación sigue abierta. Selecciona con UNO de: " +
  '{ serviceId } — las propuestas de ESE servicio, con la misma validación que get_service — o { month: "YYYY-MM" } ' +
  "(por defecto el mes actual en America/Mexico_City) — las propuestas cuya fecha de servicio cae en ese mes. Cada " +
  "propuesta trae proposalId, serviceId (el servicio al que se vincula, o null si el vínculo no se puede resolver, " +
  "nunca una adivinanza), serviceDate, kind, status, lead y contributors (con nombre), songs (con título y tono), " +
  "threadOpen (la conversación sigue abierta mientras no haya pasado la fecha del servicio, sin importar el status), " +
  "messagesTotal (el total real del hilo) y messages. Con { serviceId } se devuelve la conversación completa; con " +
  "{ month } cada propuesta trae solo sus últimos 10 mensajes, en orden cronológico, con truncated: true cuando se " +
  "omitieron mensajes anteriores. lead y cada contributor traen missing: true cuando la referencia no nombra a nadie " +
  "(o no hay referencia), y unresolved: true cuando falló la lectura de nombres — ese fallo nunca oculta las " +
  "propuestas, solo deja los nombres sin resolver y agrega una nota en notes. En songs, song trae missing: true " +
  "cuando la canción referenciada ya no existe (la lectura de títulos funcionó, esa referencia ya no resuelve); si " +
  "esa lectura falló, title queda en null sin missing y también se agrega una nota. No hay estado de leído/no leído: " +
  "ningún documento lo guarda, así que esta herramienta nunca lo reporta. Si no se pudieron leer los servicios o las " +
  "propuestas, responde con un error, nunca con una lista vacía. Solo lee: no cambia nada.";

/** The tool's whole behaviour, callable without a server (the route registers it below). */
export async function listProposalsResult(args: ListProposalsArgs): Promise<CallToolResult> {
  return runReadTool("list_proposals", async () => {
    if (args.serviceId !== undefined && args.month !== undefined) {
      return refusalResult("serviceId no se combina con month. Usa uno solo, o ninguno para el mes actual.");
    }

    // Shape first: a drafts.* id or a malformed one is refused before any read (mirrors get_service).
    let selector: ServiceSelector | undefined;
    if (args.serviceId !== undefined) {
      const parsed = parseServiceSelector({ serviceId: args.serviceId });
      if (!parsed.ok) return refusalResult(parsed.message);
      selector = parsed.selector;
    }

    const snapshot = await loadServiceSnapshot();
    // Roles resolve the weekend link and the {serviceId} selector; proposals are the content itself.
    if (proposalsUnreadable(snapshot)) {
      return refusalResult(LIST_PROPOSALS_UNREADABLE_MESSAGE, { failedSources: [...snapshot.readiness.failedSources] });
    }

    const today = serviceTodayIso();

    if (selector) {
      const resolved = resolveService(snapshot, selector, today);
      if (!resolved.ok) return refusalResult(resolved.message, { candidates: resolved.candidates });

      const rows = proposalsForService(snapshot, resolved.role);
      const ids = proposalContentIds(rows);
      const [members, songs] = await Promise.all([
        loadMemberNames(ids.memberIds, snapshot.membersById),
        loadSongTitles(ids.songIds),
      ]);
      return successResult(presentProposalsForService(snapshot, resolved.role, { members, songs }, today));
    }

    const month = args.month ?? today.slice(0, 7);
    const rows = proposalsForMonth(snapshot, month);
    const ids = proposalContentIds(rows);
    const [members, songs] = await Promise.all([
      loadMemberNames(ids.memberIds, snapshot.membersById),
      loadSongTitles(ids.songIds),
    ]);
    return successResult(presentProposalsForMonth(snapshot, month, { members, songs }, today));
  });
}

/** Registers `list_proposals` on a per-request MCP server. */
export function registerListProposals(server: McpServer): void {
  server.registerTool(
    "list_proposals",
    {
      title: "Listar propuestas de setlist",
      description: LIST_PROPOSALS_DESCRIPTION,
      inputSchema: LIST_PROPOSALS_INPUT,
      annotations: { readOnlyHint: true },
    },
    async (args) => listProposalsResult(args),
  );
}
