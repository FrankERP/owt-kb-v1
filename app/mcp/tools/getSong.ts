// MCP tool `get_song` (P1 step 5): one song's declared field set (ledger A8) —
// never the two existing song-page projections — plus its weekend play history
// (D4). Follows `ping.ts`'s four rules: a strict zod input (which of
// `{ songId } | { slug }` was given is decided by `parseGetSongSelector`, with a
// Spanish refusal), `readOnlyHint`, Spanish copy, and a handler that never
// throws — every failure is `runReadTool`'s fixed Spanish error (E1).
//
// Two reads per call: the one song document, and the weekend setlist rows its
// play history is computed from (`songDetail.ts`). Neither is the eight-read
// service snapshot `get_service` builds — a single song needs neither the
// roles nor the readiness domains.

import type { CallToolResult, McpServer } from "@modelcontextprotocol/server";
import { z } from "zod";
import { serviceTodayIso } from "@/app/components/admin/serviceReadiness";
import { refusalResult, runReadTool, successResult } from "../reads/errors";
import { loadSongDetailById, loadSongDetailBySlug, loadWeekendSetlistRows } from "../reads/songDetail";
import { parseGetSongSelector, presentSong } from "../reads/songPresenter";

export const GET_SONG_INPUT = z
  .object({
    songId: z.string().max(200).optional(),
    slug: z.string().max(200).optional(),
  })
  .strict();

export type GetSongArgs = z.infer<typeof GET_SONG_INPUT>;

export const SONG_UNREADABLE_MESSAGE = "No se pudo leer la canción. Intenta de nuevo en un momento.";

const NOT_FOUND_MESSAGE = "No existe una canción con ese id o slug.";
const AMBIGUOUS_MESSAGE =
  "Hay más de una canción con ese slug; esto es un problema de datos en Studio. Usa songId en su lugar.";

export const GET_SONG_DESCRIPTION =
  "Devuelve UNA canción de la biblioteca del equipo de alabanza con un conjunto de campos propio (no el del editor ni el de " +
  "la página de la canción): title, authors (nombres de authors[]), artist (el autor legado), keys (la tonalidad base más " +
  "las de cada acorde de guitarra y las de cada PDF, sin duplicados, la base primero), bpm, timeSig, tags ({slug, title}), " +
  "referenceLinks (enlaces de referencia, la URL de referencia musical, el video de letra, la URL de letra en PDF y los " +
  "tutoriales), lyrics (\"visible\" | \"hidden_by_chart\" | \"none\" — un acorde de guitarra oculta la letra aunque exista, " +
  "y una letra vacía siempre es \"none\") junto con hasChordChart, rehearsalMixes agrupados por tono ({tone, mixes: " +
  "[{mixKey, kind, family, track, bpm}]}, nunca la forma de onda ni el audio) y playHistory: los domingos y sábados en que " +
  "se tocó antes de hoy en America/Mexico_City ([{date, service, key}], más reciente primero), SIN LÍMITE de cuántos " +
  "(la página de la canción corta en los últimos 20; esta herramienta no) — los especiales NO cuentan. " +
  "Selecciona con songId (el id canónico de Sanity) o slug, nunca ambos. Un songId drafts.* se rechaza: no es una canción. " +
  "Nunca incluye la letra, el contenido de los acordes ni ninguna URL de audio. Solo lee: no cambia nada.";

/** The tool's whole behaviour, callable without a server (the route registers it below). */
export async function getSongResult(args: GetSongArgs): Promise<CallToolResult> {
  return runReadTool("get_song", async () => {
    const parsed = parseGetSongSelector(args);
    if (!parsed.ok) return refusalResult(parsed.message);

    const detail =
      parsed.selector.by === "id" ? await loadSongDetailById(parsed.selector.songId) : await loadSongDetailBySlug(parsed.selector.slug);
    if (!detail.ok) return refusalResult(SONG_UNREADABLE_MESSAGE);
    if (detail.rows.length === 0) return refusalResult(NOT_FOUND_MESSAGE);
    if (detail.rows.length > 1) return refusalResult(AMBIGUOUS_MESSAGE);

    const playHistory = await loadWeekendSetlistRows();
    const payload = presentSong(detail.rows[0]!, serviceTodayIso(), { playHistory });
    return successResult(payload);
  });
}

/** Registers `get_song` on a per-request MCP server. */
export function registerGetSong(server: McpServer): void {
  server.registerTool(
    "get_song",
    {
      title: "Ver una canción",
      description: GET_SONG_DESCRIPTION,
      inputSchema: GET_SONG_INPUT,
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async (args) => getSongResult(args),
  );
}
