"use client";

// The phone tab bar's PRESENTATIONAL half (R6 Task 7). `BottomNav` keeps the
// session, the pathname and the height measurement; everything that paints
// lives here, driven by props alone, so the theme gallery can host the bar
// without a session provider (the gallery route is public and prerendered —
// ADR-0017 — and `useSession` there would break both). The rendered DOM is
// exactly what `BottomNav` rendered before the split.

import Link from "next/link";
import { haptic } from "@/app/utils/haptics";
import SlidingIndicator from "./ui/SlidingIndicator";
import CueDialog from "./ui/CueDialog";

export type Tab = { href: string; label: string; icon: React.ReactNode; match: (p: string) => boolean };
export type MoreRow = { href: string; label: string; icon: React.ReactNode };

export default function BottomNavBar({
  tabs,
  activeHref,
  moreRows,
  moreOpen,
  onMore,
  onNavigate,
  barRef,
}: {
  tabs: Tab[];
  activeHref: string;
  moreRows: MoreRow[];
  moreOpen: boolean;
  onMore: (open: boolean) => void;
  onNavigate?: () => void;
  barRef?: React.Ref<HTMLElement>;
}) {
  const rowClass = "flex min-h-[44px] w-full items-center gap-3 px-5 py-3 font-label text-xs uppercase tracking-widest text-ink hover:bg-accent/5";

  return (
    <>
      <nav
        ref={barRef}
        aria-label="Navegación principal"
        className="fixed bottom-0 inset-x-0 z-50 lg:hidden bg-surface-base/90 backdrop-blur-sm border-t border-accent/15"
        style={{ paddingBottom: "env(safe-area-inset-bottom)" }}
      >
        {/* `min-h-16`, not `h-16`. The measured height published as
            `--bottom-nav-h` is only honest if the bar may actually grow: with a
            fixed height a label that needs a second line at «Máximo» text size
            would overflow a box still reporting 64px, and every consumer of the
            variable (toasts, the audio player, the song FAB) would clear the
            wrong amount. */}
        <div className="flex items-stretch min-h-16 max-w-7xl mx-auto">
          {tabs.map((tab) => {
            const active = tab.match(activeHref);
            return (
              <Link
                key={tab.href}
                href={tab.href}
                onClick={() => { void haptic("selection"); onMore(false); onNavigate?.(); }}
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
              onClick={() => { void haptic("selection"); onMore(true); }}
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

      <CueDialog open={moreOpen} mode="sheet" size="sm" title="Más" label="Más" onDismiss={() => onMore(false)}>
        <div className="divide-y divide-accent/10">
          {moreRows.map((row) => (
            <Link key={row.href} href={row.href} onClick={() => onMore(false)} className={rowClass}>
              {row.icon}{row.label}
            </Link>
          ))}
        </div>
      </CueDialog>
    </>
  );
}

export function HomeIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden>
      <path d="M3 11.5 12 4l9 7.5" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M5 10v10h14V10" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export function CalendarIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="4" width="18" height="18" rx="2" />
      <line x1="16" y1="2" x2="16" y2="6" />
      <line x1="8" y1="2" x2="8" y2="6" />
      <line x1="3" y1="10" x2="21" y2="10" />
    </svg>
  );
}

export function MusicIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
      <path d="M9 18V5l12-2v13" />
      <circle cx="6" cy="18" r="3" />
      <circle cx="18" cy="16" r="3" />
    </svg>
  );
}

export function KidsIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <circle cx="12" cy="6" r="3" />
      <path d="M5 21c0-4 3-6 7-6s7 2 7 6" />
      <path d="M9 12v3M15 12v3" />
    </svg>
  );
}

export function PlanIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <rect x="3" y="4" width="18" height="17" rx="2" />
      <path d="M3 9h18" />
      <path d="M8 13h3M8 17h6" />
    </svg>
  );
}

export function AdminIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
    </svg>
  );
}

export function MoreIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="5" r="1" fill="currentColor" stroke="none" />
      <circle cx="12" cy="12" r="1" fill="currentColor" stroke="none" />
      <circle cx="12" cy="19" r="1" fill="currentColor" stroke="none" />
    </svg>
  );
}
