import type { Metadata, Viewport } from "next";
import { Advent_Pro, Urbanist, Jura } from "next/font/google";
import "./globals.css";
import { Provider } from "../utils/Provider";
import ActivityPing from "../components/ActivityPing";
import ImpersonationBanner from "../components/ImpersonationBanner";
import AudioPlayer from "../components/AudioPlayer";
import SongSheet from "../components/SongSheet";
import NativeAuthBootstrap from "../components/NativeAuthBootstrap";
import TextScaleBootstrap from "../components/TextScaleBootstrap";

const displayFont = Advent_Pro({
  weight: "600",
  subsets: ["latin"],
  variable: "--font-display",
});
const bodyFont = Urbanist({
  subsets: ["latin"],
  weight: ["400", "600", "800"],
  variable: "--font-body",
});
const labelFont = Jura({
  weight: "600",
  subsets: ["latin"],
  variable: "--font-label",
});

export const metadata: Metadata = {
  title: "Oasis Worship Team",
  description: "Knowledge base for the Oasis Worship Team — songs, setlists, and role assignments.",
  manifest: "/manifest.webmanifest",
  icons: {
    icon: [
      { url: "/favicon.ico", sizes: "any" },
      { url: "/icons/icon-192.png", type: "image/png", sizes: "192x192" },
    ],
    apple: [{ url: "/icons/apple-touch-icon.png", sizes: "180x180" }],
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
  themeColor: "#010b17",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="es" suppressHydrationWarning>
      <body
        className={`
          ${displayFont.variable} ${bodyFont.variable} ${labelFont.variable}
          font-body
          min-h-screen
          bg-[#C8D8EB] text-[#003572]
          dark:bg-[#010b17] dark:text-[#C8D8EB]
          dark:selection:bg-teal-600
        `}
      >
        <Provider>
          <ImpersonationBanner />
          <ActivityPing />
          <main className="mx-auto max-w-7xl pb-0">{children}</main>
          <NativeAuthBootstrap />
          <TextScaleBootstrap />
          <AudioPlayer />
          <SongSheet />
        </Provider>
      </body>
    </html>
  );
}
