// Native-app sign-in pages — their own ROOT layout (ADR-0091, spec §3.1/§3.5).
//
// The confirmation screen («¿Entrar a la app Backstage?») and the inert
// callback pages are shown inside the app's sign-in sheet, so they carry none
// of the `(client)` shell: no navbar, tab bar, assistant bubble, provider or
// activity ping. This layout imports NOTHING that reads a session, cookie,
// network or env (the pattern of `(gallery)`, ADR-0017) — guarded by
// `app/appAuth/__tests__/appAuthPagesIsolation.test.ts`. The authorize page
// reads the session itself; the callback pages read nothing.
//
// Dark only (the brand's `:root`): following the device would need a script or
// the next-themes provider, and these pages carry no script on purpose.

import type { Metadata, Viewport } from "next";
import { bodyFont, displayFont, labelFont } from "../brandFonts";
import "../(client)/globals.css";
import "../brand.css";

export const metadata: Metadata = {
  title: "Backstage",
  robots: { index: false, follow: false },
};

export const viewport: Viewport = { width: "device-width", initialScale: 1, viewportFit: "cover" };

export default function AppAuthLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="es" className={`${displayFont.variable} ${bodyFont.variable} ${labelFont.variable}`}>
      <body className="brand-atmosphere font-body min-h-screen bg-surface-base text-ink">{children}</body>
    </html>
  );
}
