// Inicio's photo band (ADR-0070): the team photo behind the greeting.
//
// NEUTRAL module — no "use client" — because `app/(client)/page.tsx` is a Server
// Component and CALLS these (ADR-0028).

/** The stored document, as the page's GROQ projects it. */
export type HomeHero = {
  photo?: string | null;
  /** Sanity's hotspot: the point (0–1, 0–1) the crop keeps in frame. */
  hotspot?: { x?: number | null; y?: number | null } | null;
  heroAlt?: string | null;
};

/** Where the band is cut when the hotspot is unset: faces usually sit above the middle. */
export const HERO_DEFAULT_POSITION = "50% 35%";

/**
 * The URL the band loads: the original JPEG/PNG capped at 1800 px wide, never
 * Next's WebP (the iOS WKWebView fails to decode it — the same reason the avatars
 * are `unoptimized`). A non-Sanity URL is returned as is.
 */
export function heroPhotoSrc(url: string): string {
  if (!url.startsWith("https://cdn.sanity.io/images/")) return url;
  return `${url}${url.includes("?") ? "&" : "?"}w=1800&fit=max&q=78&fm=jpg`;
}

/**
 * `object-position` from the Studio hotspot, so the crop keeps the faces whether
 * the band is wide (desktop) or tall (phone). Each axis clamps to 0–1 and falls
 * back to the default when absent or malformed.
 */
export function heroPhotoPosition(hotspot: HomeHero["hotspot"]): string {
  const axis = (v: unknown, fallback: number): number =>
    typeof v === "number" && Number.isFinite(v) ? Math.min(1, Math.max(0, v)) : fallback;
  if (!hotspot) return HERO_DEFAULT_POSITION;
  const x = axis(hotspot.x, 0.5);
  const y = axis(hotspot.y, 0.35);
  return `${Math.round(x * 100)}% ${Math.round(y * 100)}%`;
}
