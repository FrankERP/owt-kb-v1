type PracticeSong = {
  musicalReferenceUrl?: string;
  lyricsVideoUrl?: string;
  referenceLinks?: Array<{ url: string }>;
  tutorials2?: Array<{ url: string }>;
};

export function pickPracticeVideoUrl(song: PracticeSong, mode: "musica" | "letras"): string | null {
  const legacy = [...(song.referenceLinks ?? []), ...(song.tutorials2 ?? [])].map((l) => l.url);
  const musical = song.musicalReferenceUrl ?? legacy[0] ?? null;
  if (mode === "letras") return song.lyricsVideoUrl ?? musical;
  return musical;
}

// Extract the 11-char YouTube video id from any common URL form. Handles the
// path-based forms (youtu.be/ID, /embed/ID, /shorts/ID) and the query form
// (watch?v=ID) even when `v` isn't the first query param (e.g. ?si=…&v=ID).
export function extractYouTubeId(url?: string | null): string | null {
  if (!url) return null;
  const path = url.match(/(?:youtu\.be\/|\/embed\/|\/shorts\/|\/live\/)([A-Za-z0-9_-]{11})/);
  if (path) return path[1];
  const query = url.match(/[?&]v=([A-Za-z0-9_-]{11})/);
  return query ? query[1] : null;
}
