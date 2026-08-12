import type { Metadata, Viewport } from "next";
import "./globals.css";
import "../brand.css";
import { bodyFont, displayFont, labelFont } from "../brandFonts";
import { Provider } from "../utils/Provider";
import { THEME_MIGRATION_SCRIPT } from "../utils/themePref";
import ActivityPing from "../components/ActivityPing";
import ImpersonationBanner from "../components/ImpersonationBanner";
import AudioPlayer from "../components/AudioPlayer";
import SongSheet from "../components/SongSheet";
import NativeAuthBootstrap from "../components/NativeAuthBootstrap";
import TextScaleBootstrap from "../components/TextScaleBootstrap";

export const metadata: Metadata = {
  title: "Oasis Worship Team",
  applicationName: "Backstage",
  description: "Knowledge base for the Oasis Worship Team — songs, setlists, and role assignments.",
  manifest: "/manifest.webmanifest",
  icons: {
    icon: [
      { url: "/favicon.ico", sizes: "any" },
      { url: "/icons/backstage-v2-32.png", type: "image/png", sizes: "32x32" },
      { url: "/icons/backstage-v2-192.png", type: "image/png", sizes: "192x192" },
      { url: "/icons/backstage-v2-512.png", type: "image/png", sizes: "512x512" },
    ],
    shortcut: [{ url: "/icons/backstage-v2-32.png", type: "image/png", sizes: "32x32" }],
    apple: [{ url: "/icons/backstage-v2-180.png", type: "image/png", sizes: "180x180" }],
  },
  appleWebApp: {
    capable: true,
    title: "Backstage",
    statusBarStyle: "black-translucent",
  },
};

// `viewportFit: "cover"` lets the page extend under the iOS notch/Dynamic Island and
// home indicator, which is what activates the `env(safe-area-inset-*)` values used by
// the Navbar / BottomNav to keep their controls out from under the system bars.
export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  // Static viewport themeColor — the browser chrome colour, read before any CSS is
  // parsed, so it cannot be a token. This is the SERVER-RENDERED INITIAL value, and
  // `ThemeBootstrap` swaps it at runtime on the RESOLVED theme (parent invariant
  // 17), which since Child F means it follows the member's device. Row-level: three of this file's other rows are Child B's own, one of
  // them the `selection:` utility that motivated the var()-integrity guard.
  // eslint-disable-next-line no-restricted-syntax -- pre-CSS viewport colour, see ADR/parent invariant 17
  themeColor: "#010b17",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="es"
      suppressHydrationWarning
      className={`${displayFont.variable} ${bodyFont.variable} ${labelFont.variable}`}
    >
      <body
        className={`
          brand-atmosphere font-body
          min-h-screen
          bg-surface-base text-ink
          selection:bg-accent/35 selection:text-ink
        `}
      >
        {/*
          MUST STAY THE FIRST CHILD OF <body>, IMMEDIATELY BEFORE <Provider>.
          next-themes injects its pre-hydration seed as a plain inline script inside
          its own provider, so document order is what makes this one run first — and
          it has to, because it clears a legacy mirror the seed would otherwise read
          and apply. React components (ThemeBootstrap included) run after BOTH.
          Not `<head>`: this layout renders no <head> element, and React 19 hoists
          only `<script async src>`, never inline dangerouslySetInnerHTML.
          Guarded by themeMigrationScript.test.ts.
        */}
        <script dangerouslySetInnerHTML={{ __html: THEME_MIGRATION_SCRIPT }} />
        <Provider>
          <ImpersonationBanner />
          <ActivityPing />
          <main data-route-main="" tabIndex={-1} className="mx-auto max-w-7xl pb-0 focus:outline-none">
            {children}
          </main>
          <NativeAuthBootstrap />
          <TextScaleBootstrap />
          <AudioPlayer />
          <SongSheet />
        </Provider>
      </body>
    </html>
  );
}
