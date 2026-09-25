// MCP tool `list_services` (P1 step 4): every service in a month, in /admin →
// Servicios' order, with its publication state (spec I3), its readiness
// blockers (D2 — what publish would refuse, spec I4) and its role `_rev` (I7).
// Same four rules as `ping.ts`; one snapshot per call.
//
// A failed roles read is a refusal, never `services: []` — an empty month and an
// unread catalogue must not look alike. Any other failed domain is listed in
// `failedSources` beside the data; readiness already turns it into a hard
// blocker on every service.

import type { CallToolResult, McpServer } from "@modelcontextprotocol/server";
import { z } from "zod";
import { serviceTodayIso } from "@/app/components/admin/serviceReadiness";
import { refusalResult, runReadTool, successResult } from "../reads/errors";
import { CATALOGUE_UNREADABLE_MESSAGE, catalogueUnreadable, presentServiceList } from "../reads/servicePresenter";
import { loadServiceSnapshot } from "../reads/serviceSnapshot";

export const LIST_SERVICES_INPUT = z
  .object({
    month: z
      .string()
      .regex(/^\d{4}-(0[1-9]|1[0-2])$/)
      .optional(),
  })
  .strict();

export type ListServicesArgs = z.infer<typeof LIST_SERVICES_INPUT>;

export const LIST_SERVICES_DESCRIPTION =
  "Lista los servicios del equipo de alabanza de un mes (month: \"YYYY-MM\"; por defecto el mes actual en " +
  "America/Mexico_City), borradores incluidos, en el orden de /admin → Servicios (fecha y luego hora). Cada servicio trae " +
  "serviceId, roleRev, date (el día del servicio; el de un sábado es la fecha del sábado), kind (\"sunday\" | \"saturday\" | " +
  "\"special\"; un especial también trae name, time y format), published (\"draft\" | \"published\" — un servicio sin el " +
  "campo es anterior a los borradores y está publicado), publishedRaw (el valor guardado) y blockers: lo que hoy impide " +
  "publicarlo, en español (hard: problemas de datos; workflow: pendientes que un admin puede aceptar). failedSources " +
  "aparece si alguna lectura falló; si no se pudo leer el catálogo, la herramienta responde con un error, nunca con una " +
  "lista vacía. serviceId y roleRev son observaciones: pásalos SIN CAMBIOS, tal como llegaron, a una escritura posterior; " +
  "nunca los construyas a mano. Para asientos, setlist y el resto de observations usa get_service. Solo lee: no cambia nada.";

/** The tool's whole behaviour, callable without a server (the route registers it below). */
export async function listServicesResult(args: ListServicesArgs): Promise<CallToolResult> {
  return runReadTool("list_services", async () => {
    const month = args.month ?? serviceTodayIso().slice(0, 7);
    const snapshot = await loadServiceSnapshot();
    if (catalogueUnreadable(snapshot)) {
      return refusalResult(CATALOGUE_UNREADABLE_MESSAGE, { failedSources: [...snapshot.readiness.failedSources] });
    }
    return successResult(presentServiceList(snapshot, month));
  });
}

/** Registers `list_services` on a per-request MCP server. */
export function registerListServices(server: McpServer): void {
  server.registerTool(
    "list_services",
    {
      title: "Listar servicios del mes",
      description: LIST_SERVICES_DESCRIPTION,
      inputSchema: LIST_SERVICES_INPUT,
      annotations: { readOnlyHint: true },
    },
    async (args) => listServicesResult(args),
  );
}
