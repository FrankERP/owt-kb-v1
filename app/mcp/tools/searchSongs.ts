// MCP tool `search_songs` (P1 step 5): the song catalogue search /biblioteca
// runs, reused unmodified over a server-side load. Follows `ping.ts`'s four
// rules: a strict zod input, `readOnlyHint`, Spanish copy, and a handler that
// never throws — every failure is `runReadTool`'s fixed Spanish error (E1).
//
// One catalogue load per call: the posts and the LIVE tag vocabulary
// (`loadSongCatalogue`), so an unknown tag slug is always checked against
// today's tags, never a hard-coded list (I13).

import type { CallToolResult, McpServer } from "@modelcontextprotocol/server";
import { z } from "zod";
import { refusalResult, runReadTool, successResult } from "../reads/errors";
import { loadSongCatalogue } from "../reads/songCatalogue";
import {
  hasSearchCriteria,
  liveTagSlugsOf,
  NO_CRITERIA_MESSAGE,
  searchSongs as searchSongsOver,
  validateSearchSongs,
} from "../reads/songPresenter";

export const SEARCH_SONGS_INPUT = z
  .object({
    query: z.string().max(200).optional(),
    tags: z.array(z.string().max(100)).max(50).optional(),
    limit: z.number().int().min(1).max(50).optional(),
  })
  .strict();

export type SearchSongsArgs = z.infer<typeof SEARCH_SONGS_INPUT>;

export const CATALOGUE_UNREADABLE_MESSAGE =
  "No se pudo leer el catálogo de canciones, así que no se puede buscar. Intenta de nuevo en un momento.";

export const SEARCH_SONGS_DESCRIPTION =
  "Busca canciones en la biblioteca del equipo de alabanza, con el mismo motor de /biblioteca (coincidencia sin acentos; " +
  "una búsqueda de 2 caracteres o menos usa coincidencia por substring, 3 o más usa relevancia difusa por título, artista " +
  "y tonalidad). Requiere query, tags, o ambos. tags son slugs de la taxonomía viva del equipo (tempo — up-beat, down-beat, " +
  "transition — Y temas, p. ej. amor, gratitud): dentro de un mismo eje basta con UNA coincidencia, entre ejes se exige " +
  "cada uno. Una etiqueta desconocida se rechaza y lista las etiquetas válidas. limit (1–50, por defecto 20) acota los " +
  "resultados, ya ordenados por relevancia (o alfabéticamente sin query). Cada resultado trae id, slug, title, artist " +
  "(autor legado + autores referenciados), key y tags (slugs). Solo canciones publicadas: una copia de borrador de Sanity " +
  "nunca aparece. Solo lee: no cambia nada.";

/** The tool's whole behaviour, callable without a server (the route registers it below). */
export async function searchSongsResult(args: SearchSongsArgs): Promise<CallToolResult> {
  return runReadTool("search_songs", async () => {
    // Shape first: an empty call is refused before any read, exactly as a
    // `drafts.*` serviceId is in `get_service`.
    if (!hasSearchCriteria(args)) return refusalResult(NO_CRITERIA_MESSAGE);

    const catalogue = await loadSongCatalogue();
    if (!catalogue.ok) return refusalResult(CATALOGUE_UNREADABLE_MESSAGE);

    const validated = validateSearchSongs(args, liveTagSlugsOf(catalogue.tags));
    if (!validated.ok) return refusalResult(validated.message);

    const songs = searchSongsOver(catalogue.posts, validated);
    return successResult({ songs });
  });
}

/** Registers `search_songs` on a per-request MCP server. */
export function registerSearchSongs(server: McpServer): void {
  server.registerTool(
    "search_songs",
    {
      title: "Buscar canciones",
      description: SEARCH_SONGS_DESCRIPTION,
      inputSchema: SEARCH_SONGS_INPUT,
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async (args) => searchSongsResult(args),
  );
}
