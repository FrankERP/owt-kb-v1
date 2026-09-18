"use client";

// Nav fixture (spec §5.11): the phone tab bar with its «Más» sheet OPEN, and the
// song page's section nav. Hermetic: props only — BottomNavBar is the
// presentational half (BottomNav itself reads the session and is never hosted
// here). `CueDialogProvider` is mounted directly, as DialogFixture explains.
//
// The bar is `fixed bottom-0 … lg:hidden`, so the DESKTOP capture shows only the
// section nav and the copy below it — the bar is the phone project's subject.
// The root carries `pb-24` so the bar never covers the section nav there.

import { useState } from "react";
import { CueDialogProvider } from "@/app/components/ui/CueDialogProvider";
import BottomNavBar, { HomeIcon, CalendarIcon, MusicIcon, KidsIcon, AdminIcon } from "@/app/components/BottomNavBar";
import SectionNav from "@/app/components/SectionNav";

function Nav() {
  // Open on first render and stay open — the baseline needs the sheet PRESENT,
  // not a button a harness would have to click before every capture.
  const [moreOpen, setMoreOpen] = useState(true);
  return (
    <div data-gallery-surface="nav" className="space-y-10 pb-24">
      <SectionNav
        sections={[
          { id: "audio", label: "Audio" },
          { id: "letra", label: "Letra" },
          { id: "historial", label: "Historial" },
        ]}
      />
      <p className="text-sm opacity-80">La barra inferior está fija abajo con su hoja «Más» abierta.</p>
      <BottomNavBar
        tabs={[
          { href: "/", label: "Inicio", icon: <HomeIcon />, match: (p) => p === "/" },
          { href: "/schedule", label: "Calendario", icon: <CalendarIcon />, match: (p) => p.startsWith("/schedule") },
          { href: "/biblioteca", label: "Biblioteca", icon: <MusicIcon />, match: (p) => p.startsWith("/biblioteca") },
        ]}
        activeHref="/schedule"
        moreRows={[
          { href: "/kids", label: "Kids", icon: <KidsIcon /> },
          { href: "/admin", label: "Admin", icon: <AdminIcon /> },
        ]}
        moreOpen={moreOpen}
        onMore={setMoreOpen}
      />
    </div>
  );
}

export function NavFixture() {
  return (
    <CueDialogProvider>
      <Nav />
    </CueDialogProvider>
  );
}
