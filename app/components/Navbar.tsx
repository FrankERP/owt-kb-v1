import React from "react";
import Link from "next/link";
import Image from "next/image";
import NavMenu from "./NavMenu";
import NavLinks from "./NavLinks";
import CueStrip from "./ui/CueStrip";
import { NAVBAR_H_CLASS } from "@/app/utils/navbarHeight";

interface Props {
  title: string;
  author?: string;
  tags?: boolean;
  schedule?: boolean;
  /**
   * The next-service cue under the title (R7 / spec §12.8). Default on: every
   * route wants it except the two whose own header already carries the
   * countdown. `CueStrip` also checks the pathname itself — this prop is the
   * belt to that suspenders, and it keeps the suppression readable at the page.
   */
  cue?: boolean;
}

// Plain (non-async) component: it reads no session server-side, so any page that
// renders it can still be statically/ISR rendered. Session + notification badge
// are resolved client-side in NavMenu.
const Navbar = ({ title = "", author = "", tags = false, schedule = false, cue = true }: Props) => {
  return (
    <nav aria-label="Navegación superior" className="brand-navbar sticky top-0 z-50 pt-[env(safe-area-inset-top)]">
      <div className={`relative z-[1] mx-auto max-w-7xl ${NAVBAR_H_CLASS} flex items-center gap-3 sm:gap-5 ps-[max(1.25rem,env(safe-area-inset-left))] pe-[max(1.25rem,env(safe-area-inset-right))]`}>

        {/* Backstage brand lockup */}
        <Link
          href="/"
          aria-label="Ir a Backstage"
          className="flex shrink-0 items-center gap-3 lg:gap-4 active:scale-[0.985] transition-transform duration-fast ease-out-brand"
        >
          <Image
            src="/icons/backstage-v2-192.png"
            alt=""
            width={64}
            height={64}
            // The first thing on every page. `priority` = eager + fetchpriority=high,
            // so it never paints as an empty rounded square first (spec Part III #3).
            priority
            className="brand-lockup-mark h-12 w-12 rounded-[14px] lg:h-16 lg:w-16 lg:rounded-[18px]"
          />
          <div className="hidden leading-none sm:block">
            <p className="font-display text-base sm:text-lg lg:text-2xl uppercase tracking-[0.12em] text-ink">
              Backstage
            </p>
            <p className="mt-1 hidden font-label text-[10px] uppercase tracking-[0.22em] text-ink-dim sm:block lg:text-[11px]">
              Oasis Worship Team
            </p>
          </div>
        </Link>
        {/* Centered block: on desktop the link row takes the centre and the
            page's own heading carries the title; on phones the bar keeps the
            title and the tab bar carries navigation. */}
        <div className="pointer-events-none absolute left-1/2 top-1/2 flex w-1/3 -translate-x-1/2 -translate-y-1/2 flex-col items-center justify-center lg:w-auto lg:max-w-[60%]">
          <div className="lg:hidden w-full min-w-0 flex flex-col items-center overflow-hidden">
            <p className="font-display text-sm sm:text-lg lg:text-xl uppercase tracking-[0.1em] text-ink truncate w-full text-center">
              {title}
            </p>
            {author && (
              <p className="font-label text-[10px] lg:text-[11px] text-ink-dim uppercase tracking-widest truncate w-full text-center">
                {author}
              </p>
            )}
            {cue && <CueStrip />}
          </div>
          <NavLinks schedule={schedule} tags={tags} />
          {/* Desktop: a second line under the link row, where the phone layout
              puts it under the title. */}
          {cue && <div className="hidden lg:block">
            <CueStrip />
          </div>}
        </div>

        {/* Right: single avatar/menu */}
        <div className="ml-auto shrink-0">
          <NavMenu />
        </div>

      </div>
    </nav>
  );
};

export default Navbar;
