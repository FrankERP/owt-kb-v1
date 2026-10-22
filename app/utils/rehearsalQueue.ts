// «Ensayar el setlist» with the rehearsal mixes (2026-10-22): the set's songs, in
// setlist order, as ONE queue for the app's player. Pure and neutral (no "use
// client", no client imports) so it is testable without a DOM and any surface
// may call it (ADR-0028).
//
// Per song the KEY is the set's (`play_key`, else the song's own key), resolved
// the way the song page resolves its dial: `mixesForKey` — the mixes in that key,
// or the NEAREST key's when that one was never rendered. The TRACK is either the
// full band or the member's instrument «al frente» (an UP mix), chosen ONCE for
// the whole set; a song with no mix for that instrument plays its full band
// rather than dropping out of the run. A song with no mixes at all is skipped —
// a gap in the run is better than a YouTube tab opening mid-rehearsal — and named
// in `skipped` so the member is told.
import type { RehearsalMix } from "@/app/utils/interface";
import { groupMixes, mixLabel, mixesForKey } from "@/app/utils/rehearsalMixes";

/** What the queue route sends per mix: no peaks, no envelope, no URL. */
export type QueueMix = Pick<RehearsalMix, "_key" | "kind" | "tone" | "family" | "track">;

export interface QueueSong {
  _id: string;
  title: string;
  slug?: { current?: string } | null;
  play_key?: string | null;
  key?: string | null;
}

/** Structurally `PlayerContext`'s `AudioTrack` — redeclared, not imported, so this
 *  module never reaches into a "use client" file. */
export interface QueueTrack {
  url: string;
  title: string;
  tone?: string;
  songTitle: string;
  songSlug: string;
}

/** The route every mix plays through (never cdn.sanity.io — decision D2). */
export function mixUrl(songId: string, mixKey: string): string {
  return `/api/audio/${encodeURIComponent(songId)}/${encodeURIComponent(mixKey)}`;
}

/**
 * `family` null = the full band. Otherwise an abletonnl family (`SEAT_TO_FAMILY`):
 * that family's first track in the chosen key, else the full band, else whatever
 * the key has first.
 */
export function pickQueueMix(mixes: QueueMix[], key: string | null | undefined, family: string | null): QueueMix | null {
  if (mixes.length === 0) return null;
  const inKey = mixesForKey(mixes, key).mixes;
  if (family) {
    const group = groupMixes(inKey).find((g) => g.family === family);
    if (group) return group.mixes[0];
  }
  return inKey.find((m) => m.kind === "full") ?? inKey[0] ?? null;
}

export function buildRehearsalQueue(
  songs: QueueSong[],
  mixesBySong: Record<string, QueueMix[] | undefined>,
  family: string | null,
): { tracks: QueueTrack[]; skipped: string[] } {
  const tracks: QueueTrack[] = [];
  const skipped: string[] = [];
  for (const song of songs) {
    const mix = pickQueueMix(mixesBySong[song._id] ?? [], song.play_key || song.key, family);
    if (!mix) {
      skipped.push(song.title);
      continue;
    }
    tracks.push({
      url: mixUrl(song._id, mix._key),
      title: mixLabel(mix),
      tone: mix.tone,
      songTitle: song.title,
      songSlug: song.slug?.current ?? "",
    });
  }
  return { tracks, skipped };
}
