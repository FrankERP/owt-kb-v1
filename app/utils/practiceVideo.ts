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
