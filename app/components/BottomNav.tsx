"use client";

// The phone tab bar (spec §5.0, §19.1, decision B). Worship tabs: Inicio ·
// Calendario · Biblioteca. Kids-only: Kids (+ Planear Kids when managesKids).
// Plus a «Más» tab and its sheet ONLY when there is something the tabs cannot
// hold (Kids, Planear Kids, Admin) — Tema, Cerrar sesión AND «Yo» all live in
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

export const NAV_H_VAR = "--bottom-nav-h";
export const NAV_CLASS = "has-bottom-nav";

export default function BottomNav() {
  const { data: session } = useSession();
  const pathname = usePathname() ?? "/";
  const [moreOpen, setMoreOpen] = useState(false);
  const barRef = useRef<HTMLElement | null>(null);
  const user = session?.user ?? null;
  const authHidden = !user || pathname.startsWith("/auth") || pathname.startsWith("/studio");

  const role = user?.role;
  const isSuper = role === "super-admin";
  const isAdmin = isSuper || role === "admin" || role === "content-editor";
  const ministries = user?.ministries ?? ["worship"];
  const inWorship = isSuper || ministries.includes("worship");
  const inKids = isSuper || ministries.includes("kids");
  const managesKids = isSuper || (user?.managesMinistries ?? []).includes("kids");

  const tabs: Tab[] = inWorship
    ? [
        { href: "/", label: "Inicio", icon: <HomeIcon />, match: (p) => p === "/" },
        { href: "/schedule", label: "Calendario", icon: <CalendarIcon />, match: (p) => p.startsWith("/schedule") },
        { href: "/biblioteca", label: "Biblioteca", icon: <MusicIcon />, match: (p) => /^\/(biblioteca|posts)/.test(p) },
      ]
    : [
        { href: "/kids", label: "Kids", icon: <KidsIcon />, match: (p) => p === "/kids" },
        ...(managesKids ? [{ href: "/kids/admin", label: "Planear Kids", icon: <PlanIcon />, match: (p: string) => p.startsWith("/kids/admin") }] : []),
      ];

  // «Más» holds only what the tabs cannot fit — the avatar menu (NavMenu) now
  // owns Tema, Cerrar sesión and «Yo». When no row applies, there is nothing
  // to hold: the bar shows the tabs and the sheet never opens.
  const moreRows = [
    ...(inWorship && inKids ? [{ href: "/kids", label: "Kids", icon: <KidsIcon /> }] : []),
    ...(inWorship && managesKids ? [{ href: "/kids/admin", label: "Planear Kids", icon: <PlanIcon /> }] : []),
    ...(isAdmin ? [{ href: "/admin", label: "Admin", icon: <AdminIcon /> }] : []),
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
