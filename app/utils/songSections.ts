/**
 * Which sections a song detail page will actually paint.
 *
 * Extracted from `posts/[slug]/page.tsx` so it can be tested: the page is a
 * server component with no harness, and this list decides three things at once
 * — whether `SectionNav` renders (more than one), which `<section>`s render, and
 * whether the "no content yet" state renders (none). A quiet mistake in any of
 * the flags shows up as a header over an empty box, which reads as a
 * half-loaded page rather than an empty one.
 *
 * The flag that earned the extraction is `body`. It is an ARRAY, so `!!post.body`
 * is true for `[]` — and `[]` is exactly what clearing the "Letra" field writes
 * (`textToBody("")` returns `[]`, and the PATCH `.set`s it). Truthiness therefore
 * claimed lyrics for the commonest way a song loses them.
 *
 * No "use client": the page is a Server Component (ADR-0028).
 */

export interface SongSection {
  id: "audio" | "tutoriales" | "referencia" | "letra" | "historial";
  label: string;
  show: boolean;
}

/** Only what the section list reads — deliberately narrower than `Post`. */
export interface SongSectionInput {
  audioTracks?: unknown[] | null;
  tutorials2?: unknown[] | null;
  chords?: unknown[] | null;
  body?: unknown[] | null;
  referenceLinks?: unknown[] | null;
  musicalReferenceUrl?: string | null;
  lyricsVideoUrl?: string | null;
}

const filled = (v: unknown[] | null | undefined): boolean => (v?.length ?? 0) > 0;

/**
 * The sections that will paint, in page order. `historyCount` is separate
 * because play history is a second read, not a field on the song.
 */
export function songSections(
  post: SongSectionInput | null | undefined,
  historyCount: number,
): SongSection[] {
  // Chords count as lyrics: they render inside the «Letra» section, so a song
  // with a chart and no words still has something to show there.
  const hasLyrics = filled(post?.body) || filled(post?.chords);
  const hasRefLinks =
    !!post?.musicalReferenceUrl || !!post?.lyricsVideoUrl || filled(post?.referenceLinks);

  return [
    { id: "audio" as const,      label: "Audio",      show: filled(post?.audioTracks) },
    { id: "tutoriales" as const, label: "Tutoriales", show: filled(post?.tutorials2) },
    { id: "referencia" as const, label: "Referencia", show: hasRefLinks },
    { id: "letra" as const,      label: "Letra",      show: hasLyrics },
    { id: "historial" as const,  label: "Historial",  show: historyCount > 0 },
  ].filter((s) => s.show);
}
