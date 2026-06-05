// Shared medley grouping logic used by DayCard, ServicesPanel and SetlistEditor.
// A "run" is either a standalone song or a group of consecutive songs that share
// the same non-empty medley_tag (a medley / mashup performed back-to-back).

export type SongRun<T> =
  | { kind: "single"; song: T; n: number }
  | { kind: "medley"; songs: { song: T; n: number }[] };

export function buildRuns<T extends { medley_tag?: string }>(items: T[]): SongRun<T>[] {
  const runs: SongRun<T>[] = [];
  let counter = 0;
  for (const song of items) {
    counter++;
    if (song.medley_tag) {
      const last = runs[runs.length - 1];
      if (last?.kind === "medley" && last.songs[0].song.medley_tag === song.medley_tag) {
        last.songs.push({ song, n: counter });
      } else {
        runs.push({ kind: "medley", songs: [{ song, n: counter }] });
      }
    } else {
      runs.push({ kind: "single", song, n: counter });
    }
  }
  return runs;
}

// Re-derive medley_tag values from positional adjacency: every maximal run of
// consecutive same-tag songs of length >= 2 gets a fresh unique tag, and any
// orphaned single keeps no tag. Call this after any operation that changes song
// order or membership (reorder, remove) so stored tags always match what the UI
// shows. Idempotent in structure.
export function normalizeMedleyTags<T extends { medley_tag?: string }>(
  items: T[],
  newTag: () => string,
): T[] {
  const result = items.map(e => ({ ...e }));
  let i = 0;
  while (i < result.length) {
    const tag = result[i].medley_tag;
    if (!tag) { i++; continue; }
    let j = i;
    while (j + 1 < result.length && result[j + 1].medley_tag === tag) j++;
    if (j - i + 1 < 2) {
      result[i].medley_tag = undefined;
    } else {
      const fresh = newTag();
      for (let k = i; k <= j; k++) result[k].medley_tag = fresh;
    }
    i = j + 1;
  }
  return result;
}
