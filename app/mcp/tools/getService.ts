// MCP tool `get_service` (P1 step 4): one service, exactly as /admin →
// Servicios shows it, plus the observations a later write asserts (spec I7).
// Follows `ping.ts`'s four rules: a strict zod input (which fields combine into
// ONE selector is decided by `parseServiceSelector`, with a Spanish refusal),
// `readOnlyHint`, Spanish copy, and a handler that never throws — every failure
// is `runReadTool`'s fixed Spanish error (spec E1).
//
// One snapshot per call (`loadServiceSnapshot`): the seats, the setlist rows,
// the readiness and every `_rev` / `_key` come from that one load. Two content
// reads follow — names for members the snapshot's seat map lacks, and song
// titles — neither of which carries a revision.

import type { CallToolResult, McpServer } from "@modelcontextprotocol/server";
import { z } from "zod";
import { serviceTodayIso } from "@/app/components/admin/serviceReadiness";
import { SETLIST_SERVICE_KINDS } from "@/app/utils/setlistWriteRequest";
import { refusalResult, runReadTool, successResult } from "../reads/errors";
import {
  CATALOGUE_UNREADABLE_MESSAGE,
  catalogueUnreadable,
  parseServiceSelector,
  presentService,
  resolveService,
  serviceContentIds,
} from "../reads/servicePresenter";
import { loadMemberNames, loadServiceSnapshot } from "../reads/serviceSnapshot";
import { loadSongTitles } from "../reads/songTitles";

export const GET_SERVICE_INPUT = z
  .object({
    serviceId: z.string().max(200).optional(),
    date: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/)
      .optional(),
    kind: z.enum(SETLIST_SERVICE_KINDS).optional(),
    name: z.string().max(200).optional(),
  })
  .strict();

export type GetServiceArgs = z.infer<typeof GET_SERVICE_INPUT>;

export const GET_SERVICE_DESCRIPTION =
  "Devuelve UN servicio del equipo de alabanza tal como lo muestra /admin → Servicios: su identidad (serviceId, kind, date; " +
  "y para un especial name, time y format), su estado de publicación (published: \"draft\" | \"published\" — un servicio sin " +
  "el campo es anterior a los borradores y está publicado; publishedRaw es el valor guardado), los cinco grupos de asientos " +
  "con nombres (Lead, BGVs, Chorus, instruments, foh_team), el setlist (canciones con título, autor, tono y medleys; en una " +
  "noche de alabanza, los líderes de cada canción) y readiness: los bloqueos para publicar (blockers, en español), la " +
  "siguiente acción, los conflictos de disponibilidad y las notas de integridad. readiness.publishCheck.passesNow dice si la " +
  "verificación de publicación por servicio pasa ahora; un servicio ya publicado lo indica con alreadyPublished: true. " +
  "Selecciona con UNO de: { serviceId }; { date, kind: \"sunday\" | \"saturday\" } (date es el día del servicio, YYYY-MM-DD; " +
  "el de un sábado es la fecha del sábado); { date, kind: \"special\", name? }; { date } si ese día hay un solo servicio; o {} " +
  "para el próximo servicio desde hoy en America/Mexico_City, INCLUIDOS los borradores (los miembros no los ven). Un " +
  "selector ambiguo se rechaza y lista los candidatos. observations (roleId, roleRev, seatItemKeys y setlist) es lo que una " +
  "escritura posterior necesita: pásalo SIN CAMBIOS, tal como llegó; nunca lo construyas ni lo edites a mano. Un setlist en " +
  "estado \"ambiguous\", \"draft_overlay\", \"invalid\" o \"unknown\" es uno en el que el editor de setlist no escribiría. " +
  "Solo lee: no cambia nada.";

/** The tool's whole behaviour, callable without a server (the route registers it below). */
export async function getServiceResult(args: GetServiceArgs): Promise<CallToolResult> {
  return runReadTool("get_service", async () => {
    // Shape first: a drafts.* id or a mixed selector is refused before any read.
    const parsed = parseServiceSelector(args);
    if (!parsed.ok) return refusalResult(parsed.message);

    const snapshot = await loadServiceSnapshot();
    // No roles read means no catalogue: never answer "no such service" from nothing.
    if (catalogueUnreadable(snapshot)) {
      return refusalResult(CATALOGUE_UNREADABLE_MESSAGE, { failedSources: [...snapshot.readiness.failedSources] });
    }

    const resolved = resolveService(snapshot, parsed.selector, serviceTodayIso());
    if (!resolved.ok) return refusalResult(resolved.message, { candidates: resolved.candidates });

    const ids = serviceContentIds(snapshot, resolved.role);
    const [members, songs] = await Promise.all([
      loadMemberNames(ids.memberIds, snapshot.membersById),
      loadSongTitles(ids.songIds),
    ]);
    const payload = presentService(snapshot, resolved.role, { members, songs });
    return successResult(resolved.sameDayOthers ? { ...payload, sameDayOthers: resolved.sameDayOthers } : payload);
  });
}

/** Registers `get_service` on a per-request MCP server. */
export function registerGetService(server: McpServer): void {
  server.registerTool(
    "get_service",
    {
      title: "Ver un servicio",
      description: GET_SERVICE_DESCRIPTION,
      inputSchema: GET_SERVICE_INPUT,
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async (args) => getServiceResult(args),
  );
}
