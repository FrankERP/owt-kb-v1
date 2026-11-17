// A song's picture on a setlist row (ADR-0088): the cover of the ALBUM it comes from, stored on
// the song itself (`post.albumArt`, a Sanity image an editor can replace in the Studio).
//
// Frank chose the album's cover over the still of the song's YouTube video (2026-11-12, on the
// first screenshots): a still is a 16:9 frame with the lyric video's own title painted on it,
// and cropped square it reads as a clipping. A song with no cover has NO picture — the row draws
// a neutral tile with a note on it — never the video still as a stand-in, so a set is not half
// covers and half clippings.
//
// NEUTRAL — no React.

/** A row's cover: the longest side a tile is drawn at (52 CSS px) at 3×, rounded up. */
const COVER_PX = 160;
/**
 * The two larger sizes (ADR-0088), each the drawn side at 3× rounded up: the Biblioteca
 * shelf's card (132 CSS px) and the song page's own cover (208 CSS px from `md`). Named
 * sizes, never a free number: every distinct `w`/`h` is a distinct image the CDN renders
 * and a phone caches, so a caller picks one of three.
 */
export const COVER_SIZE = { tile: COVER_PX, shelf: 400, hero: 640 } as const;
export type CoverSize = keyof typeof COVER_SIZE;

/**
 * The square, sized URL of a stored cover, or null. Only a Sanity image URL is accepted: the
 * value comes from `SONG_COVER_GROQ`, and anything else is not a picture this app stored.
 *
 * `fm=jpg`, never `auto=format` and never the original's own format: the field accepts
 * whatever an editor drags into the Studio, and a WebP or AVIF cover would decode on the
 * web and fail silently in the iOS WKWebView — the rule `avatarSrc` and `heroPhotoSrc`
 * follow. A cover has no transparency to lose.
 */
export function songCoverUrl(assetUrl?: string | null, size: CoverSize = "tile"): string | null {
  if (typeof assetUrl !== "string" || !assetUrl.startsWith("https://cdn.sanity.io/images/")) return null;
  const px = COVER_SIZE[size];
  return `${assetUrl.split("?")[0]}?w=${px}&h=${px}&fit=crop&fm=jpg`;
}

/** The GROQ projection a setlist row reads its cover from, relative to a `songs[]` item. */
export const SONG_COVER_GROQ = `song->albumArt.asset->url`;

/** The same cover read from the song document itself (the Biblioteca, the song page). */
export const POST_COVER_GROQ = `albumArt.asset->url`;
