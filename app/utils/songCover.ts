// A song's picture on a setlist row (ADR-0087): the cover of the ALBUM it comes from, stored on
// the song itself (`post.albumArt`, a Sanity image an editor can replace in the Studio).
//
// Frank chose the album's cover over the still of the song's YouTube video (2026-11-12, on the
// first screenshots): a still is a 16:9 frame with the lyric video's own title painted on it,
// and cropped square it reads as a clipping. A song with no cover has NO picture — the row draws
// a neutral tile with a note on it — never the video still as a stand-in, so a set is not half
// covers and half clippings.
//
// NEUTRAL — no React.

/** The longest side a cover is ever drawn at (52 CSS px) at 3×, rounded up. */
const COVER_PX = 160;

/**
 * The square, sized URL of a stored cover, or null. Only a Sanity image URL is accepted: the
 * value comes from `SONG_COVER_GROQ`, and anything else is not a picture this app stored.
 *
 * `fm=jpg`, never `auto=format` and never the original's own format: the field accepts
 * whatever an editor drags into the Studio, and a WebP or AVIF cover would decode on the
 * web and fail silently in the iOS WKWebView — the rule `avatarSrc` and `heroPhotoSrc`
 * follow. A cover has no transparency to lose.
 */
export function songCoverUrl(assetUrl?: string | null): string | null {
  if (typeof assetUrl !== "string" || !assetUrl.startsWith("https://cdn.sanity.io/images/")) return null;
  return `${assetUrl.split("?")[0]}?w=${COVER_PX}&h=${COVER_PX}&fit=crop&fm=jpg`;
}

/** The GROQ projection a setlist row reads its cover from, relative to a `songs[]` item. */
export const SONG_COVER_GROQ = `song->albumArt.asset->url`;
