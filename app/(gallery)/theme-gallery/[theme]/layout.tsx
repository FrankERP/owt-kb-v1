// Theme gallery — root layout (Child A2 step 1).
//
// A THIRD ROOT LAYOUT, deliberately. See ADR-0015.
//
// It sits AT the dynamic `[theme]` segment, not above it, for two reasons that
// together leave no other arrangement:
//   1. Next 16 passes a layout only the params from the root segment down to THAT
//      layout, so a layout at `app/(gallery)/layout.tsx` sits two segments above
//      `[theme]` and receives `{}` — it could not read the theme at all.
//   2. It must NOT be nested under `app/(client)`, because next-themes 0.4.6 makes a
//      nested `ThemeProvider` a literal pass-through (`useContext(L) ? Fragment : X`).
//      the app provider's own theme in `app/utils/Provider.tsx` would therefore be
//      un-overridable from inside, and the whole point of this route is to render
//      BOTH themes regardless of what the app's own provider resolves to.
//
// A layout with no `layout.js` above it IS a root layout, so this path is both valid
// and the only one that works. There is no `app/layout.tsx`; `(admin)` and `(client)`
// are already sibling root layouts.
//
// NO PROVIDER. `app/(client)/layout.tsx` wraps everything in `<Provider>` and renders
// `ActivityPing`, which fetches on mount. This route reads no session and performs no
// network I/O of any kind.

import type { Metadata } from "next";
import { displayFont, bodyFont, labelFont } from "../../../brandFonts";

// The `(client)` one specifically: it carries the `@layer base` font bindings, while
// `app/(admin)/globals.css` is three bare `@tailwind` directives. Import the wrong one
// and every visual-regression baseline renders at fallback metrics, invalidating the
// review this route exists to enable.
import "../../../(client)/globals.css";
import "../../../brand.css";

export const metadata: Metadata = {
  title: "Theme gallery",
  robots: { index: false, follow: false },
};

/** The only two values the `[theme]` segment may take. */
export const THEMES = ["dark", "light"] as const;
export type Theme = (typeof THEMES)[number];

export default async function ThemeGalleryLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ theme: string }>;
}) {
  const { theme } = await params;

  return (
    <html
      lang="es"
      suppressHydrationWarning
      className={`${theme} ${displayFont.variable} ${bodyFont.variable} ${labelFont.variable}`}
    >
      {/*
        The <body> class list is load-bearing, not cosmetic.

        `.brand-atmosphere` IS the opaque page wash — `background-color:
        rgb(var(--surface-base-rgb))` plus six gradient layers. 14 of the 15
        colour-carrying `.brand-*` classes are alpha-composited over whatever sits
        behind them (`.brand-surface` alone is a gradient at 0.68/0.82/0.76 over
        `rgb(var(--surface-console-rgb) / 0.72)`; `brand.css` carries 65 such
        occurrences). Slice B2 rewrote these bodies off `--brand-blackout` and
        `--brand-console` onto the roles; the spellings above are the current ones
        and the 65 is unchanged, since B2 renamed variables without adding or
        removing an occurrence.
        Without this, every swatch paints over the bare UA canvas and every baseline is
        wrong in a way a reviewer cannot see by looking at it.

        It also carries the AA gate's input: "the lightest rendered `brand-atmosphere`
        point in dark" is not observable in a gallery whose body does not render it.

        Matches both real root layouts EXCEPT `selection:*`, which is a text-selection
        affordance no baseline exercises.
      */}
      <body className="brand-atmosphere font-body min-h-screen bg-surface-base text-ink">
        {children}
      </body>
    </html>
  );
}
