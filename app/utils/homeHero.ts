// Inicio's photo band and the run sheet's one small-caps title (ADR-0070).
//
// NEUTRAL module — no "use client" — because `app/(client)/page.tsx` is a Server
// Component and USES these as values (ADR-0028): a string constant imported from
// a "use client" module arrives there as a client reference, not a string, and
// `${SHEET_TITLE} mb-3` would silently render "[object Object] mb-3".

/**
 * The run sheet's section title: the ONE uppercase on Inicio — 12 px Jura,
 * tracked, muted — over «Setlist», «Equipo» and «Después». `DayCard` (a client
 * module) and the page (a server one) both import it from here.
 */
export const SHEET_TITLE = "font-label text-xs uppercase tracking-[0.22em] text-surface-ink-l70-d50";

/**
 * The page title of a member screen in the display face (the «millones» pass):
 * 46 px on a phone, 76 px from `md`, tight leading, sentence case. Biblioteca,
 * Disponibilidad and Ajustes share it; `MeHeader` (a name, `break-words`) and
 * `ScheduleHeader` (a month name clamped to the viewport) carry their own.
 */
export const PAGE_TITLE = "font-display text-[46px] font-semibold leading-[0.98] tracking-[-0.01em] text-ink md:text-[76px] md:leading-[0.95]";

/**
 * The line under a page title: what matters today, in 17 px body (20 px from
 * `md`), muted — «7 por venir · 1 publicado · 6 borradores». The Control Room
 * tabs share it (phase 5 of the «millones» pass); a count worth the eye sits in
 * a `text-ink` span inside it.
 */
export const PAGE_LEDE = "font-body text-[17px] leading-snug text-ink-dim md:text-xl";

/** Sanity's crop: the fraction (0–1) cut from each edge of the uncropped asset. */
export type HeroCrop = { top?: number | null; bottom?: number | null; left?: number | null; right?: number | null } | null | undefined;

/** The stored document, as the page's GROQ projects it. */
export type HomeHero = {
  photo?: string | null;
  /** Sanity's hotspot: the point (0–1, 0–1) of the UNCROPPED image the crop keeps in frame. */
  hotspot?: { x?: number | null; y?: number | null } | null;
  crop?: HeroCrop;
  heroAlt?: string | null;
};

/** Where the band is cut when the hotspot is unset: faces usually sit above the middle. */
export const HERO_DEFAULT_POSITION = "50% 35%";

const unit = (v: unknown, fallback: number): number =>
  typeof v === "number" && Number.isFinite(v) ? Math.min(1, Math.max(0, v)) : fallback;

/** The crop as four clamped fractions, or null when there is nothing to cut. */
function cropFractions(crop: HeroCrop): { top: number; bottom: number; left: number; right: number } | null {
  if (!crop) return null;
  const c = { top: unit(crop.top, 0), bottom: unit(crop.bottom, 0), left: unit(crop.left, 0), right: unit(crop.right, 0) };
  // A crop that leaves nothing (or a malformed one that overlaps) is no crop.
  if (c.top + c.bottom >= 1 || c.left + c.right >= 1) return null;
  if (c.top === 0 && c.bottom === 0 && c.left === 0 && c.right === 0) return null;
  return c;
}

/** The asset's pixel size, which Sanity bakes into every image URL (`…-4000x3000.jpg`). */
function assetSize(url: string): { w: number; h: number } | null {
  const m = url.match(/-(\d+)x(\d+)\.[a-z0-9]+(?:\?|$)/i);
  return m ? { w: Number(m[1]), h: Number(m[2]) } : null;
}

/**
 * The URL the band loads: the asset capped at 1800 px wide, ALWAYS as JPEG —
 * never Next's WebP (the iOS WKWebView fails to decode it — the same reason the
 * avatars are `unoptimized`), and a PNG's transparency is not wanted under a
 * scrim either. The Studio crop becomes a `rect` (the CDN wants pixels of the
 * uncropped asset, so it needs the size the URL carries; a URL without one is
 * served uncropped). A non-Sanity URL is returned as is.
 */
export function heroPhotoSrc(url: string, crop?: HeroCrop): string {
  if (!url.startsWith("https://cdn.sanity.io/images/")) return url;
  const c = cropFractions(crop);
  const size = assetSize(url);
  const rect =
    c && size
      ? `rect=${Math.round(size.w * c.left)},${Math.round(size.h * c.top)},${Math.round(size.w * (1 - c.left - c.right))},${Math.round(size.h * (1 - c.top - c.bottom))}&`
      : "";
  return `${url}${url.includes("?") ? "&" : "?"}${rect}w=1800&fit=max&q=78&fm=jpg`;
}

/**
 * `object-position` from the Studio hotspot, so the band keeps the faces whether
 * it is wide (desktop) or tall (phone). Sanity stores the hotspot relative to the
 * UNCROPPED image, so with a crop the point is re-expressed inside the cropped
 * one. Each axis clamps to 0–1 and falls back to the default when absent or
 * malformed.
 */
export function heroPhotoPosition(hotspot: HomeHero["hotspot"], crop?: HeroCrop): string {
  if (!hotspot) return HERO_DEFAULT_POSITION;
  let x = unit(hotspot.x, 0.5);
  let y = unit(hotspot.y, 0.35);
  const c = cropFractions(crop);
  if (c) {
    x = unit((x - c.left) / (1 - c.left - c.right), 0.5);
    y = unit((y - c.top) / (1 - c.top - c.bottom), 0.35);
  }
  return `${Math.round(x * 100)}% ${Math.round(y * 100)}%`;
}
