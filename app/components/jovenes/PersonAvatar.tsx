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
/** A URL as a CSS `url()` value: quoted, with the characters that could end the string escaped,
 *  so nothing a stored URL holds can add a second declaration. */
const cssUrl = (url: string) => `url("${url.replace(/["\\\n\r]/g, (c) => encodeURIComponent(c))}")`;

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
  return (
    <span
      aria-hidden="true"
      className={`relative flex shrink-0 items-center justify-center overflow-hidden rounded-full font-label ${SIZE[size]} ${look} ${className}`}
    >
      {name ? initialsOf(name) : ""}
      {name && photo && (
        // `avatarSrc` asks Sanity for a small JPEG: the iOS WKWebView fails to decode WebP (the
        // reason `MeHeader`'s and `TeamSections`' avatars are served unoptimized).
        <span data-photo="" className="absolute inset-0 bg-cover bg-center" style={{ backgroundImage: cssUrl(avatarSrc(photo)) }} />
      )}
    </span>
  );
}
