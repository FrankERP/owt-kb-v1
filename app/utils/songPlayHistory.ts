export interface SongPlayHistorySet {
  songs?: Array<{
    songId?: string | null;
    play_key?: string | null;
  }> | null;
}

/** Collect unique performance keys while preserving the source's newest-first order. */
export function buildPreviousKeysBySong(sets: SongPlayHistorySet[]): Map<string, string[]> {
  const keysBySong = new Map<string, string[]>();

  for (const set of sets) {
    for (const song of set.songs ?? []) {
      const songId = song.songId?.trim();
      const playKey = song.play_key?.trim();
      if (!songId || !playKey) continue;

      const keys = keysBySong.get(songId) ?? [];
      if (!keys.includes(playKey)) keys.push(playKey);
      keysBySong.set(songId, keys);
    }
  }

  return keysBySong;
}
