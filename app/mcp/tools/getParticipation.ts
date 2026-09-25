// MCP tool `get_participation` (P1 step 6): the Servicios sidebar's own
// participation aggregation (`computeParticipation`), fed from one service
// snapshot's roles and seat-referenced members. Follows `ping.ts`'s four
// rules: a strict zod input, `readOnlyHint`, Spanish copy, and a handler that
// never throws — every failure is `runReadTool`'s fixed Spanish error (E1).
//
// One snapshot per call (`loadServiceSnapshot`): every service dated in the
// month, drafts included, feeds `computeParticipation` exactly as the sidebar
// does (see `participationPresenter.ts`'s header for the month-set finding). A
// failed roles read is refused, never answered with zero participation; a
// failed members read keeps the counts and reports null names with a note.

import type { CallToolResult, McpServer } from "@modelcontextprotocol/server";
import { z } from "zod";
import { serviceTodayIso } from "@/app/components/admin/serviceReadiness";
import { refusalResult, runReadTool, successResult } from "../reads/errors";
import { presentParticipation } from "../reads/participationPresenter";
import { CATALOGUE_UNREADABLE_MESSAGE, catalogueUnreadable } from "../reads/servicePresenter";
import { loadServiceSnapshot } from "../reads/serviceSnapshot";

export const GET_PARTICIPATION_INPUT = z
  .object({
    month: z
      .string()
      .regex(/^\d{4}-(0[1-9]|1[0-2])$/)
      .optional(),
  })
  .strict();

export type GetParticipationArgs = z.infer<typeof GET_PARTICIPATION_INPUT>;

export const GET_PARTICIPATION_DESCRIPTION =
  "Calcula la participación del equipo de alabanza en un mes (month: \"YYYY-MM\"; por defecto el mes actual en " +
  "America/Mexico_City), a partir de TODOS los servicios con esa fecha propia, borradores incluidos — igual que la " +
  "barra lateral de /admin → Servicios. Cada miembro con al menos un asiento aparece con memberId, name (o null si no " +
  "se pudo resolver), sunLead, satLead, sunBGV, satBGV, coro, especial (todo asiento de voz de un especial), total " +
  "(incluye especial), instrWeeks y fohWeeks (semanas distintas con ese asiento; un sábado cuenta en la semana del " +
  "domingo siguiente, un especial en la del domingo en curso o el que sigue). Un asiento cuyo miembro no tiene " +
  "documento (una referencia colgante) aparece con missing: true, nunca se descarta; si la lectura de miembros falló, " +
  "todos aparecen con unresolved: true y una nota. services trae serviceId, date, kind y published " +
  "(\"draft\" | \"published\") de cada servicio incluido, para saber qué cuentan incluyen borradores. Si no se pudo " +
  "leer el catálogo de servicios, la herramienta responde con un error, nunca con participación en cero. Solo lee: no " +
  "cambia nada.";

/** The tool's whole behaviour, callable without a server (the route registers it below). */
export async function getParticipationResult(args: GetParticipationArgs): Promise<CallToolResult> {
  return runReadTool("get_participation", async () => {
    const month = args.month ?? serviceTodayIso().slice(0, 7);
    const snapshot = await loadServiceSnapshot();
    // No roles read means no catalogue: never answer "zero participation" from nothing.
    if (catalogueUnreadable(snapshot)) {
      return refusalResult(CATALOGUE_UNREADABLE_MESSAGE, { failedSources: [...snapshot.readiness.failedSources] });
    }
    return successResult(presentParticipation(snapshot, month));
  });
}

/** Registers `get_participation` on a per-request MCP server. */
export function registerGetParticipation(server: McpServer): void {
  server.registerTool(
    "get_participation",
    {
      title: "Ver participación del mes",
      description: GET_PARTICIPATION_DESCRIPTION,
      inputSchema: GET_PARTICIPATION_INPUT,
      annotations: { readOnlyHint: true },
    },
    async (args) => getParticipationResult(args),
  );
}
