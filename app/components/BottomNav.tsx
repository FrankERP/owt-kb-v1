"use client";

// The phone tab bar (spec §5.0, §19.1, decision B). Four tabs, plus a fifth
// «Más» tab and its sheet ONLY when there is something the four cannot hold
// (Kids, Planear Kids, Admin) — Tema and Cerrar sesión live in the avatar menu
// (NavMenu) now, one home per destination (M1 follow-up F1). It publishes its
// MEASURED height as --bottom-nav-h on <html> the way the impersonation banner
// publishes --impersonation-h, so every fixed-bottom element (toasts, the audio
// transport, the song FAB) clears it without a constant anyone can drift from —
// bottomNavOffsetSync.test.ts is the guard. Ministry filtering is COSMETIC (the
// pages enforce), as NavLinks.tsx and ADR-0020 say.

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useSession } from "next-auth/react";
import { haptic } from "@/app/utils/haptics";
import SlidingIndicator from "./ui/SlidingIndicator";
import CueDialog from "./ui/CueDialog";

export const NAV_H_VAR = "--bottom-nav-h";
export const NAV_CLASS = "has-bottom-nav";

type Tab = { href: string; label: string; icon: React.ReactNode; match: (p: string) => boolean };

export default function BottomNav() {
  const { data: session } = useSession();
  const pathname = usePathname() ?? "/";
  const [moreOpen, setMoreOpen] = useState(false);
  const barRef = useRef<HTMLElement | null>(null);
  const user = session?.user ?? null;
  const hidden = !user || pathname.startsWith("/auth") || pathname.startsWith("/studio");

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

  if (hidden || !user) return null;

  const role = user.role;
  const isSuper = role === "super-admin";
  const isAdmin = isSuper || role === "admin" || role === "content-editor";
  const ministries = user.ministries ?? ["worship"];
  const inWorship = isSuper || ministries.includes("worship");
  const inKids = isSuper || ministries.includes("kids");
  const managesKids = isSuper || (user.managesMinistries ?? []).includes("kids");

  const tabs: Tab[] = inWorship
    ? [
        { href: "/", label: "Inicio", icon: <HomeIcon />, match: (p) => p === "/" },
        { href: "/schedule", label: "Calendario", icon: <CalendarIcon />, match: (p) => p.startsWith("/schedule") },
        // Biblioteca links to /tag until R1 creates /biblioteca and redirects /tag* (spec §12.2).
        { href: "/tag", label: "Biblioteca", icon: <MusicIcon />, match: (p) => /^\/(tag|posts|author)/.test(p) },
        { href: "/me", label: "Yo", icon: <UserIcon />, match: (p) => p.startsWith("/me") },
      ]
    : [
        { href: "/kids", label: "Kids", icon: <KidsIcon />, match: (p) => p === "/kids" },
        ...(managesKids ? [{ href: "/kids/admin", label: "Planear Kids", icon: <PlanIcon />, match: (p: string) => p.startsWith("/kids/admin") }] : []),
        { href: "/me", label: "Yo", icon: <UserIcon />, match: (p) => p.startsWith("/me") },
      ];

  const rowClass = "flex min-h-[44px] w-full items-center gap-3 px-5 py-3 font-label text-xs uppercase tracking-widest text-ink hover:bg-accent/5";

  // «Más» holds only what the four tabs cannot fit — the avatar menu (NavMenu)
  // now owns Tema and Cerrar sesión. When no row applies, there is nothing to
  // hold: the bar shows four tabs and the sheet never opens.
  const moreRows: { href: string; label: string; icon: React.ReactNode }[] = [
    ...(inWorship && inKids ? [{ href: "/kids", label: "Kids", icon: <KidsIcon /> }] : []),
    ...(inWorship && managesKids ? [{ href: "/kids/admin", label: "Planear Kids", icon: <PlanIcon /> }] : []),
    ...(isAdmin ? [{ href: "/admin", label: "Admin", icon: <AdminIcon /> }] : []),
  ];

  return (
    <>
      <nav
        ref={barRef}
        aria-label="Navegación principal"
        className="fixed bottom-0 inset-x-0 z-50 lg:hidden bg-surface-base/90 backdrop-blur-sm border-t border-accent/15"
        style={{ paddingBottom: "env(safe-area-inset-bottom)" }}
      >
        <div className="flex items-stretch h-16 max-w-7xl mx-auto">
          {tabs.map((tab) => {
            const active = tab.match(pathname);
            return (
              <Link
                key={tab.href}
                href={tab.href}
                onClick={() => { void haptic("selection"); setMoreOpen(false); }}
                aria-current={active ? "page" : undefined}
                className={`relative flex-1 flex flex-col items-center justify-center gap-1 transition-colors duration-fast ease-out-brand ${
                  active ? "text-accent" : "text-mono-500 hover:text-mono-300"
                }`}
              >
                {active && <SlidingIndicator id="bottom-nav" variant="dot" />}
                <span className={`transition-transform duration-fast ease-out-brand ${active ? "-translate-y-0.5" : ""}`}>{tab.icon}</span>
                <span className="font-label text-[10px] uppercase tracking-widest">{tab.label}</span>
              </Link>
            );
          })}
          {moreRows.length > 0 && (
            <button
              type="button"
              onClick={() => { void haptic("selection"); setMoreOpen(true); }}
              aria-haspopup="dialog"
              aria-expanded={moreOpen}
              className={`relative flex-1 flex flex-col items-center justify-center gap-1 transition-colors duration-fast ease-out-brand ${
                moreOpen ? "text-accent" : "text-mono-500 hover:text-mono-300"
              }`}
            >
              <span><MoreIcon /></span>
              <span className="font-label text-[10px] uppercase tracking-widest">Más</span>
            </button>
          )}
        </div>
      </nav>

      <CueDialog open={moreOpen} mode="sheet" size="sm" title="Más" label="Más" onDismiss={() => setMoreOpen(false)}>
        <div className="divide-y divide-accent/10">
          {moreRows.map((row) => (
            <Link key={row.href} href={row.href} onClick={() => setMoreOpen(false)} className={rowClass}>
              {row.icon}{row.label}
            </Link>
          ))}
        </div>
      </CueDialog>
    </>
  );
}

function HomeIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden>
      <path d="M3 11.5 12 4l9 7.5" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M5 10v10h14V10" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function CalendarIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="4" width="18" height="18" rx="2" />
      <line x1="16" y1="2" x2="16" y2="6" />
      <line x1="8" y1="2" x2="8" y2="6" />
      <line x1="3" y1="10" x2="21" y2="10" />
    </svg>
  );
}

function MusicIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
      <path d="M9 18V5l12-2v13" />
      <circle cx="6" cy="18" r="3" />
      <circle cx="18" cy="16" r="3" />
    </svg>
  );
}

function UserIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
      <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
      <circle cx="12" cy="7" r="4" />
    </svg>
  );
}

function KidsIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <circle cx="12" cy="6" r="3" />
      <path d="M5 21c0-4 3-6 7-6s7 2 7 6" />
      <path d="M9 12v3M15 12v3" />
    </svg>
  );
}

function PlanIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <rect x="3" y="4" width="18" height="17" rx="2" />
      <path d="M3 9h18" />
      <path d="M8 13h3M8 17h6" />
    </svg>
  );
}

function AdminIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
    </svg>
  );
}

function MoreIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="5" r="1" fill="currentColor" stroke="none" />
      <circle cx="12" cy="12" r="1" fill="currentColor" stroke="none" />
      <circle cx="12" cy="19" r="1" fill="currentColor" stroke="none" />
    </svg>
  );
}
