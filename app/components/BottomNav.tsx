"use client";

// The phone tab bar (spec §5.0, §19.1, decision B). Worship tabs: Inicio ·
// Calendario · Biblioteca. Kids: Kids (+ Planear Kids when managesKids). ONE
// ministry at a time — the page's (`navSections.ts`, Frank 2026-10-29).
// Plus a «Más» tab and its sheet ONLY when there is something the tabs cannot
// hold (the switch to the other ministry, Admin in worship) — Tema, Cerrar sesión AND «Yo» all live in
// the avatar menu (NavMenu) now, one home per destination (M1 follow-up F1,
// F2). A bar with fewer than two items (tabs + «Más») is not a bar and
// renders nothing — the kids-only volunteer with no planner rights. It
// publishes its MEASURED height as --bottom-nav-h on <html> the way the
// impersonation banner publishes --impersonation-h, so every fixed-bottom
// element (toasts, the audio transport, the song FAB) clears it without a
// constant anyone can drift from — bottomNavOffsetSync.test.ts is the guard.
// Ministry filtering is COSMETIC (the pages enforce), as NavLinks.tsx and
// ADR-0020 say.

import { useEffect, useRef, useState } from "react";
import { usePathname } from "next/navigation";
import { useSession } from "next-auth/react";
import BottomNavBar, { type Tab, KidsIcon, PlanIcon, AdminIcon, HomeIcon, CalendarIcon, MusicIcon } from "./BottomNavBar";
import { SECTION_LABEL, availableSections, currentSection, navAccess, sectionHome } from "./navSections";

export const NAV_H_VAR = "--bottom-nav-h";
export const NAV_CLASS = "has-bottom-nav";

export default function BottomNav() {
  const { data: session } = useSession();
  const pathname = usePathname() ?? "/";
  const [moreOpen, setMoreOpen] = useState(false);
  const barRef = useRef<HTMLElement | null>(null);
  const user = session?.user ?? null;
  const authHidden = !user || pathname.startsWith("/auth") || pathname.startsWith("/studio");

  // One ministry at a time (Frank, 2026-10-29): the tabs are the current
  // section's, and «Más» carries the switch to the other one — never its tabs.
  const access = navAccess(user ?? {});
  const section = currentSection(pathname, access);
  const otherSections = availableSections(access).filter((s) => s !== section);

  const tabs: Tab[] = section === "worship"
    ? [
        { href: "/", label: "Inicio", icon: <HomeIcon />, match: (p) => p === "/" },
        { href: "/schedule", label: "Calendario", icon: <CalendarIcon />, match: (p) => p.startsWith("/schedule") },
        { href: "/biblioteca", label: "Biblioteca", icon: <MusicIcon />, match: (p) => /^\/(biblioteca|posts)/.test(p) },
      ]
    : section === "kids"
    ? [
        { href: "/kids", label: "Kids", icon: <KidsIcon />, match: (p) => p === "/kids" },
        ...(access.managesKids ? [{ href: "/kids/admin", label: "Planear Kids", icon: <PlanIcon />, match: (p: string) => p.startsWith("/kids/admin") }] : []),
      ]
    : [];

  // «Más» holds only what the tabs cannot fit — the avatar menu (NavMenu) now
  // owns Tema, Cerrar sesión, «Yo» and Super admin. When no row applies, there
  // is nothing to hold: the bar shows the tabs and the sheet never opens.
  const moreRows = [
    ...otherSections.map((s) => ({
      href: sectionHome(s, access),
      label: SECTION_LABEL[s],
      icon: s === "kids" ? <KidsIcon /> : <HomeIcon />,
    })),
    // Worship's admin, so it lives in the worship section only.
    ...(section === "worship" && access.isAdmin ? [{ href: "/admin", label: "Admin", icon: <AdminIcon /> }] : []),
  ];

  // A bar with fewer than two items (tabs + «Más») is not a bar — the
  // kids-only volunteer with no planner rights has one tab and no «Más» row,
  // so there is nothing worth a fixed bottom bar for. Their avatar menu still
  // carries Mi semana.
  const hidden = authHidden || tabs.length + (moreRows.length > 0 ? 1 : 0) < 2;

  // Measured, not a constant: the bar wraps to two lines at the largest text
  // scale, and the safe-area inset differs per device. Published only while the
  // bar is on screen (the media query below hides it at lg), cleared on unmount.
  //
  // `offsetParent` is a shortcut for "not display:none, not detached", but
  // jsdom returns `null` for it on every element regardless of layout — using
  // it here would read the bar as off-screen even when it is genuinely
  // rendered under test. `getComputedStyle(bar).display !== "none"` gives the
  // same real-browser answer (the `lg:hidden` media query sets `display:
  // none`) without the jsdom false negative.
  useEffect(() => {
    if (hidden) return;
    const root = document.documentElement;
    const publish = () => {
      const bar = barRef.current;
      const onScreen = bar && getComputedStyle(bar).display !== "none";
      if (bar && onScreen && bar.offsetHeight) {
        root.style.setProperty(NAV_H_VAR, `${bar.offsetHeight}px`);
        root.classList.add(NAV_CLASS);
      } else {
        root.style.removeProperty(NAV_H_VAR);
        root.classList.remove(NAV_CLASS);
      }
    };
    publish();
    const ro = typeof ResizeObserver !== "undefined" && barRef.current ? new ResizeObserver(publish) : null;
    if (ro && barRef.current) ro.observe(barRef.current);
    window.addEventListener("resize", publish);
    return () => {
      ro?.disconnect();
      window.removeEventListener("resize", publish);
      root.style.removeProperty(NAV_H_VAR);
      root.classList.remove(NAV_CLASS);
    };
  }, [hidden]);

  if (hidden) return null;

  return (
    <BottomNavBar
      tabs={tabs}
      activeHref={pathname}
      moreRows={moreRows}
      moreOpen={moreOpen}
      onMore={setMoreOpen}
      barRef={barRef}
    />
  );
}
