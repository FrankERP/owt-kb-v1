// MCP tool `get_member_availability` (P1 step 6, spec I5): who on the worship
// team is unavailable in a month, from `teamMembers` filtered with
// `WORSHIP_AUDIENCE_GROQ_FILTER` — never the `$all`-bypassing
// `WORSHIP_MEMBER_GROQ_FILTER`, so a kids-only member never appears here, not
// even by id, whoever is asking. Follows `ping.ts`'s four rules: a strict zod
// input (`memberId` and `name` are mutually exclusive, decided by
// `parseMemberAvailabilitySelector`, with a Spanish refusal), `readOnlyHint`,
// Spanish copy, and a handler that never throws — every failure is
// `runReadTool`'s fixed Spanish error (spec E1).
//
// One read per call: the whole worship-audience directory. No selector answers
// the whole team; `memberId` or `name` narrows to one, refusing an unknown id,
// a kids-only id, or an ambiguous name with its candidates (D8).

import type { CallToolResult, McpServer } from "@modelcontextprotocol/server";
import { z } from "zod";
import { serviceTodayIso } from "@/app/components/admin/serviceReadiness";
import { refusalResult, runReadTool, successResult } from "../reads/errors";
import {
  parseMemberAvailabilitySelector,
  presentMemberAvailabilityList,
  resolveMembers,
} from "../reads/memberAvailabilityPresenter";
import { loadWorshipMemberDirectory } from "../reads/memberDirectory";

export const GET_MEMBER_AVAILABILITY_INPUT = z
  .object({
    month: z
      .string()
      .regex(/^\d{4}-(0[1-9]|1[0-2])$/)
      .optional(),
    memberId: z.string().max(200).optional(),
    name: z.string().max(200).optional(),
  })
  .strict();

export type GetMemberAvailabilityArgs = z.infer<typeof GET_MEMBER_AVAILABILITY_INPUT>;

export const DIRECTORY_UNREADABLE_MESSAGE =
  "No se pudo leer el directorio de miembros del equipo de alabanza. Intenta de nuevo en un momento.";

export const GET_MEMBER_AVAILABILITY_DESCRIPTION =
  "Devuelve la disponibilidad de miembros del equipo de Alabanza en un mes (month: \"YYYY-MM\"; por defecto el mes actual " +
  "en America/Mexico_City). Lista SOLO al equipo de alabanza: un miembro cuyo único ministerio es Oasis Kids nunca " +
  "aparece aquí, ni siquiera por memberId. Sin memberId ni name devuelve a todo el equipo, ordenado por nombre; " +
  "memberId (el id canónico de Sanity) o name (comparado sin acentos ni mayúsculas contra member_name o alias) " +
  "seleccionan a uno solo — nunca ambos a la vez. Un id desconocido o de un miembro solo de Kids se rechaza con el " +
  "mismo mensaje, para no revelar cuál fue; un nombre ambiguo se rechaza y lista los candidatos. Cada miembro trae " +
  "memberId, name, alias, tipo (las etiquetas de Tipo/memberType) y disabled — reportado siempre, incluso true: " +
  "disabled quita el acceso a la app, no la elegibilidad para servir. unavailable trae las fechas de ese mes que el " +
  "miembro marcó no disponible, con su nota cuando existe. Solo lee: no cambia nada.";

/** The tool's whole behaviour, callable without a server (the route registers it below). */
export async function getMemberAvailabilityResult(args: GetMemberAvailabilityArgs): Promise<CallToolResult> {
  return runReadTool("get_member_availability", async () => {
    // Shape first: a mixed selector or a malformed field is refused before any read.
    const parsed = parseMemberAvailabilitySelector(args);
    if (!parsed.ok) return refusalResult(parsed.message);

    const directory = await loadWorshipMemberDirectory();
    if (!directory.ok) return refusalResult(DIRECTORY_UNREADABLE_MESSAGE);

    const resolved = resolveMembers(directory.members, parsed.selector);
    if (!resolved.ok) return refusalResult(resolved.message, { candidates: resolved.candidates });

    const month = args.month ?? serviceTodayIso().slice(0, 7);
    return successResult(presentMemberAvailabilityList(resolved.members, month));
  });
}

/** Registers `get_member_availability` on a per-request MCP server. */
export function registerGetMemberAvailability(server: McpServer): void {
  server.registerTool(
    "get_member_availability",
    {
      title: "Ver disponibilidad de un miembro",
      description: GET_MEMBER_AVAILABILITY_DESCRIPTION,
      inputSchema: GET_MEMBER_AVAILABILITY_INPUT,
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async (args) => getMemberAvailabilityResult(args),
  );
}
