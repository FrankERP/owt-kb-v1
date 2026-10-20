// What the admin assistant's tools hand the model (ADR-0060). NEUTRAL and pure: the server
// module runs the MCP's own read handlers and passes their payloads through these, so a test
// can pin exactly what reaches the model without Sanity or the API.
//
// Why views at all, rather than the MCP payloads as they are: those carry what a WRITE tool
// needs — seat item keys, revisions, observations, readiness blockers — and the assistant has
// no write tool. Every field cut here is input tokens nobody would read, paid on every later
// turn of the conversation, since the whole conversation is resent each time.

import type { GetServicePayload, ListServicesPayload, SeatItem, SeatPath } from "@/app/mcp/reads/servicePresenter";
import type { GetSongPayload } from "@/app/mcp/reads/songPresenter";

/** The play history the song view keeps, newest first. The MCP's is unbounded on purpose. */
export const CHAT_PLAY_HISTORY_LIMIT = 12;

/** Longest lyrics or chart text handed to the model in one call, in characters. */
export const CHAT_LYRICS_MAX_CHARS = 15_000;

/** `get_song` without its rehearsal mixes (audio data the assistant cannot play) and with a bounded history. */
export function chatSongView(payload: GetSongPayload): Record<string, unknown> {
  const { rehearsalMixes: _mixes, playHistory, ...rest } = payload;
  return {
    ...rest,
    playHistory: playHistory.slice(0, CHAT_PLAY_HISTORY_LIMIT),
    playHistoryTotal: playHistory.length,
  };
}

function seatName(seat: SeatItem): string | null {
  return seat.alias?.trim() || seat.name?.trim() || null;
}

const SEAT_LABEL: Record<SeatPath, string> = {
  Lead: "lead",
  BGVs: "bgvs",
  Chorus: "chorus",
  instruments: "instruments",
  foh_team: "foh",
};

/** `get_service` reduced to who serves and what is sung: no ids, keys, revisions or readiness. */
export function chatServiceView(payload: GetServicePayload): Record<string, unknown> {
  const team: Record<string, unknown[]> = {};
  for (const path of Object.keys(SEAT_LABEL) as SeatPath[]) {
    const seats = payload.seats[path] ?? [];
    team[SEAT_LABEL[path]] = seats.map((seat) => {
      const name = seatName(seat) ?? "(sin nombre)";
      if (path === "instruments") return { name, instrument: seat.instrument ?? null };
      if (path === "foh_team") return { name, role: seat.role ?? null };
      return name;
    });
  }
  const songs = (payload.setlist?.rows ?? []).map((row) => ({
    songId: row.song?.id ?? null,
    title: row.song?.title ?? null,
    author: row.song?.author ?? null,
    key: row.key,
    medley: row.medleyTag,
    ...(row.leads ? { leads: row.leads.map((lead) => lead.alias?.trim() || lead.name?.trim() || "(sin nombre)") } : {}),
  }));
  return {
    kind: payload.kind,
    date: payload.date,
    ...(payload.kind === "special" ? { name: payload.name ?? null, time: payload.time ?? null, format: payload.format ?? null } : {}),
    published: payload.published,
    team,
    setlist: payload.setlist ? songs : null,
    ...(payload.notes?.length ? { notes: payload.notes } : {}),
  };
}

/** `list_services` reduced to the calendar: what, when, and whether members can see it. */
export function chatServiceListView(payload: ListServicesPayload): Record<string, unknown> {
  return {
    month: payload.month,
    services: payload.services.map((s) => ({
      date: s.date,
      kind: s.kind,
      ...(s.kind === "special" ? { name: s.name ?? null, time: s.time ?? null } : {}),
      published: s.published,
    })),
    ...(payload.failedSources?.length ? { incomplete: true } : {}),
  };
}

/** The lyrics read's row (`SONG_LYRICS_QUERY` in `adminChatServer.ts`). */
export interface SongLyricsRow {
  _id: string;
  title: string | null;
  key: string | null;
  lyricsText: string | null;
  charts: { key: string | null; content: string | null }[] | null;
}

function clip(text: string): { text: string; truncated?: true } {
  return text.length > CHAT_LYRICS_MAX_CHARS ? { text: text.slice(0, CHAT_LYRICS_MAX_CHARS), truncated: true } : { text };
}

const sameKey = (a: string | null | undefined, b: string | null | undefined): boolean =>
  !!a && !!b && a.trim().toLowerCase() === b.trim().toLowerCase();

/**
 * A song's words as the song page shows them (ADR-0018): when a chord chart exists the page
 * shows the chart and hides `body`, so the model gets the chart — the one in the asked key, else
 * the song's base key, else the first — and is told which other keys exist. Without a chart it
 * gets `body` as plain text.
 */
export function chatLyricsView(row: SongLyricsRow, requestedKey?: string): Record<string, unknown> {
  const charts = (row.charts ?? []).filter((c) => typeof c.content === "string" && c.content.trim().length > 0);
  const base = { title: row.title, baseKey: row.key };
  if (charts.length > 0) {
    const chosen =
      charts.find((c) => sameKey(c.key, requestedKey)) ?? charts.find((c) => sameKey(c.key, row.key)) ?? charts[0]!;
    const { text, truncated } = clip(chosen.content!);
    return {
      ...base,
      source: "chord_chart",
      chartKey: chosen.key,
      chart: text,
      ...(truncated ? { truncated } : {}),
      otherChartKeys: charts.filter((c) => c !== chosen).map((c) => c.key),
    };
  }
  const lyrics = row.lyricsText?.trim() ?? "";
  if (lyrics.length > 0) {
    const { text, truncated } = clip(lyrics);
    return { ...base, source: "lyrics", lyrics: text, ...(truncated ? { truncated } : {}) };
  }
  return { ...base, source: "none", note: "Esta canción no tiene letra ni acordes guardados en la app." };
}
