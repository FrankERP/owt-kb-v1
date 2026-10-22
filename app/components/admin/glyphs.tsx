// The admin's shared line glyphs — `currentColor` strokes on a 24-unit box, so a
// glyph takes the control's own colour and weight. An emoji does not: Apple's 📅
// is a red-and-white picture and ⛶ a platform-dependent weight, which is why the
// Servicios toolbar and the planner's full-screen toggle lead with these instead
// (2026-10-22). `AdminRail`'s Servicios item draws the same calendar, from here,
// so the toolbar's «Generar mes» cannot drift from the rail item it sits under.
//
// `size` is the rendered box in px; the stroke scales with it (the rail draws at
// 20 px / 1.75, a button at 14 px / 2 — the `stroke` default follows the size so
// a small glyph stays legible).

export function CalendarGlyph({ size = 14, strokeWidth = size >= 18 ? 1.75 : 2 }: { size?: number; strokeWidth?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <rect x="3" y="4" width="18" height="17" rx="2" />
      <path d="M3 10h18M8 2v4M16 2v4" />
    </svg>
  );
}

export function ExpandGlyph({ size = 14, strokeWidth = size >= 18 ? 1.75 : 2 }: { size?: number; strokeWidth?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M8 3H5a2 2 0 0 0-2 2v3M21 8V5a2 2 0 0 0-2-2h-3M3 16v3a2 2 0 0 0 2 2h3M16 21h3a2 2 0 0 0 2-2v-3" />
    </svg>
  );
}
