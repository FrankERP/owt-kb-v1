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
import { loadSongDetailById, loadSongDetailBySlug, loadWeekendSetlistRows, type SongDetailRow } from "../reads/songDetail";
import { parseGetSongSelector, presentSong } from "../reads/songPresenter";
import { loadSongForEdit } from "../reads/songEditReads";
import { lyricsGate } from "@/app/utils/songEdits";

export const GET_SONG_INPUT = z
  .object({
    songId: z.string().max(200).optional(),
    slug: z.string().max(200).optional(),
  })
  .strict();

export type GetSongArgs = z.infer<typeof GET_SONG_INPUT>;

/**
 * The MCP's own schema: `full` exists only here. The in-app assistant registers `get_song` with
 * `GET_SONG_INPUT` (ADR-0060) and never sees the lyrics text, the charts or the writer's `rev`.
 */
export const GET_SONG_FULL_INPUT = GET_SONG_INPUT.extend({ full: z.boolean().optional() }).strict();

export type GetSongFullArgs = z.infer<typeof GET_SONG_FULL_INPUT>;

export const SONG_UNREADABLE_MESSAGE = "No se pudo leer la canción. Intenta de nuevo en un momento.";

const NOT_FOUND_MESSAGE = "No existe una canción con ese id o slug.";
const AMBIGUOUS_MESSAGE =
  "Hay más de una canción con ese slug; esto es un problema de datos en Studio. Usa songId en su lugar.";

/**
 * The shared-slug refusal, naming every candidate in the TEXT (`songId («title»)`,
 * by id) as well as in `structuredContent` — the SDK adds no text fallback for an
 * object payload, and a client that reads only `content` needs a songId to retry with.
 */
function ambiguousSlugRefusal(rows: readonly SongDetailRow[]): CallToolResult {
  const candidates = rows
    .map((row) => ({ songId: row._id, title: row.title ?? null }))
    .sort((a, b) => (a.songId < b.songId ? -1 : a.songId > b.songId ? 1 : 0));
  const labels = candidates.map((c) => `${c.songId} (${c.title ? `«${c.title}»` : "sin título"})`);
  return refusalResult(`${AMBIGUOUS_MESSAGE} Candidatos: ${labels.join("; ")}.`, { candidates });
}

export const GET_SONG_DESCRIPTION =
  "Devuelve UNA canción de la biblioteca del equipo de alabanza con un conjunto de campos propio (no el del editor ni el de " +
  "la página de la canción): title, authors (nombres de authors[]), artist (el autor legado), keys (la tonalidad base más " +
  "las de cada acorde de guitarra y las de cada PDF, sin duplicados, la base primero), bpm, timeSig, tags ({slug, title}), " +
  "referenceLinks (enlaces de referencia, la URL de referencia musical, el video de letra, la URL de letra en PDF y los " +
  "tutoriales), lyrics (\"visible\" | \"hidden_by_chart\" | \"none\" — un acorde de guitarra oculta la letra aunque exista, " +
  "y una letra vacía siempre es \"none\") junto con hasChordChart, rehearsalMixes agrupados por tono ({tone, mixes: " +
  "[{mixKey, kind, family, track, bpm}]}, nunca la forma de onda ni el audio) y playHistory: los domingos y sábados en que " +
  "se tocó antes de hoy en America/Mexico_City ([{date, service, key}], más reciente primero), SIN LÍMITE de cuántos " +
  "(la página de la canción solo muestra los 3 más recientes; esta herramienta no recorta) — los especiales NO cuentan. " +
  "Selecciona con songId (el id canónico de Sanity) o slug, nunca ambos. Un songId drafts.* se rechaza: no es una canción. " +
  "Un slug que comparten varias canciones se rechaza y lista los candidatos (songId y título). " +
  "Sin full no incluye la letra ni el contenido de los acordes; nunca incluye una URL de audio. Con full: true añade " +
  "rev, lyricsText (la letra en el texto del editor: «# » encabezado, **negrita**, *cursiva*), lyricsEditable (si se " +
  "puede cambiar desde el chat sin perder formato) y charts [{chartKey, key, content}]: úsalo antes de check_song_edits " +
  "para copiar los pasajes exactos. Solo lee: no cambia nada.";

/** The tool's whole behaviour, callable without a server (the route registers it below). */
export async function getSongResult(args: GetSongFullArgs): Promise<CallToolResult> {
  return runReadTool("get_song", async () => {
    const { full, ...selector } = args;
    const parsed = parseGetSongSelector(selector);
    if (!parsed.ok) return refusalResult(parsed.message);

    const detail =
      parsed.selector.by === "id" ? await loadSongDetailById(parsed.selector.songId) : await loadSongDetailBySlug(parsed.selector.slug);
    if (!detail.ok) return refusalResult(SONG_UNREADABLE_MESSAGE);
    if (detail.rows.length === 0) return refusalResult(NOT_FOUND_MESSAGE);
    if (detail.rows.length > 1) return ambiguousSlugRefusal(detail.rows);

    const playHistory = await loadWeekendSetlistRows();
    const payload = presentSong(detail.rows[0]!, serviceTodayIso(), { playHistory });
    if (!full) return successResult(payload);

    // The editable song (S3, D8): read by id, so a slug selector reads the one song it resolved.
    const song = await loadSongForEdit(detail.rows[0]!._id);
    if (!song) return refusalResult(SONG_UNREADABLE_MESSAGE);
    const gate = lyricsGate(song.body);
    return successResult({
      ...payload,
      songId: song._id,
      rev: song._rev,
      lyricsText: gate.text,
      lyricsEditable: gate.structural && gate.nfc,
      charts: (song.chords ?? [])
        .filter((c) => c && typeof c._key === "string")
        .map((c) => ({ chartKey: c._key as string, key: c.key ?? "", content: c.content ?? "" })),
    });
  });
}

/** Registers `get_song` on a per-request MCP server. */
export function registerGetSong(server: McpServer): void {
  server.registerTool(
    "get_song",
    {
      title: "Ver una canción",
      description: GET_SONG_DESCRIPTION,
      inputSchema: GET_SONG_FULL_INPUT,
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async (args) => getSongResult(args),
  );
}
