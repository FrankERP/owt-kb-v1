import type { Metadata } from "next";
import { Advent_Pro, Urbanist, Jura } from "next/font/google";
import "./globals.css";
import { Provider } from "../utils/Provider";
import BottomNav from "../components/BottomNav";
import ActivityPing from "../components/ActivityPing";
import ImpersonationBanner from "../components/ImpersonationBanner";

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
          <main className="mx-auto max-w-7xl pb-24 lg:pb-0">{children}</main>
          <BottomNav />
        </Provider>
      </body>
    </html>
  );
}
