// A person on a meeting as a face: their profile photo, the one `/me` shows and the worship team
// block draws (the profile belongs to the person, not to a ministry), or two initials in a circle
// when they have none (`initialsOf`, the house rule). «Tú» takes the app's one green ring; a seat
// with nobody is a dashed, empty circle, so an unfilled seat is seen before it is read.
//
// The photo is a BACKGROUND painted over the initials, not an `<img>` that replaces them. This
// module is neutral (no hooks), so it cannot hear a failed load the way `TeamSections`' avatar
// does, and an `<img>` that fails draws the browser's broken-image glyph (measured in Chromium,
// even with an empty `alt`). A background that fails paints nothing, so a revoked Google URL or a
// deleted asset leaves the initials, before hydration too.
//
// NEUTRAL — no hooks.
import { avatarSrc, initialsOf } from "../../utils/teamSections";

const SIZE = { sm: "h-6 w-6 text-[9px]", md: "h-9 w-9 text-[11px]" } as const;
/** A URL as a CSS `url()` value, or null for one this does not paint. Only `https:` (what both
 *  sources store: Sanity's CDN and Google). Quoted, with the quote, the backslash and EVERY control
 *  character escaped: CSS ends a string at a newline, and a form feed is one, so a stored URL
 *  could otherwise close the string and add declarations of its own to a server-rendered `style`. */
function cssUrl(url: string): string | null {
  if (!url.startsWith("https://")) return null;
  return `url("${url.replace(/["\\\u0000-\u001f\u007f]/g, (c) => encodeURIComponent(c))}")`;
}

export default function PersonAvatar({
  name,
  photo = null,
  mine = false,
  size = "md",
  className = "",
}: {
  name: string | null;
  /** The member's profile photo URL. Ignored for a seat nobody holds. */
  photo?: string | null;
  mine?: boolean;
  size?: keyof typeof SIZE;
  className?: string;
}) {
  const look = mine
    ? "border-2 border-positive-fg bg-positive-fg/10 text-positive-fg"
    : name
      ? "border border-ink/10 bg-surface-raised text-ink"
      : "border border-dashed border-ink/25 text-ink-dim";
  const image = name && photo ? cssUrl(avatarSrc(photo)) : null;
  return (
    <span
      aria-hidden="true"
      // `pointer-events-none`: `relative` (for the photo) makes this a positioned box, and a
      // positioned box paints ABOVE a stretched hit area that comes before it, such as the fold
      // button's `::after` over a card's head. A face is decoration; a tap on it must reach
      // whatever is under it.
      className={`pointer-events-none relative flex shrink-0 items-center justify-center overflow-hidden rounded-full font-label ${SIZE[size]} ${look} ${className}`}
    >
      {name ? initialsOf(name) : ""}
      {image && (
        // `avatarSrc` asks Sanity for a small JPEG: the iOS WKWebView fails to decode WebP (the
        // reason `MeHeader`'s and `TeamSections`' avatars are served unoptimized).
        <span data-photo="" className="absolute inset-0 bg-cover bg-center" style={{ backgroundImage: image }} />
      )}
    </span>
  );
}
