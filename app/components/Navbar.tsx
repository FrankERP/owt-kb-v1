import React from "react";
import Link from "next/link";
import Image from "next/image";
import NavMenu from "./NavMenu";

interface Props {
  title: string;
  author?: string;
  tags?: boolean;
  schedule?: boolean;
}

// Plain (non-async) component: it reads no session server-side, so any page that
// renders it can still be statically/ISR rendered. Session + notification badge
// are resolved client-side in NavMenu.
const Navbar = ({ title = "", author = "", tags = false, schedule = false }: Props) => {
  return (
    <nav aria-label="Navegación superior" className="brand-navbar sticky top-0 z-50 pt-[env(safe-area-inset-top)]">
      <div className="relative z-[1] mx-auto max-w-7xl h-20 lg:h-24 transition-[height] duration-300 flex items-center gap-3 sm:gap-5 ps-[max(1.25rem,env(safe-area-inset-left))] pe-[max(1.25rem,env(safe-area-inset-right))]">

        {/* Backstage brand lockup */}
        <Link href="/" aria-label="Ir a Backstage" className="flex shrink-0 items-center gap-3 lg:gap-4">
          <Image
            src="/icons/backstage-v2-192.png"
            alt=""
            width={64}
            height={64}
            className="brand-lockup-mark h-12 w-12 rounded-[14px] lg:h-16 lg:w-16 lg:rounded-[18px]"
          />
          <div className="leading-none">
            <p className="font-display text-base sm:text-lg lg:text-2xl uppercase tracking-[0.12em] text-brand-frost">
              Backstage
            </p>
            <p className="mt-1 hidden font-label text-[8px] uppercase tracking-[0.22em] text-brand-steel sm:block lg:text-[10px]">
              Oasis Worship Team
            </p>
          </div>
        </Link>

        {/* Centered title */}
        <div className="flex-1 min-w-0 flex flex-col items-center justify-center overflow-hidden pointer-events-none sm:absolute sm:left-1/2 sm:top-1/2 sm:w-1/3 sm:-translate-x-1/2 sm:-translate-y-1/2">
          <p className="font-display text-xs sm:text-lg lg:text-xl uppercase tracking-[0.1em] text-brand-frost truncate w-full text-center">
            {title}
          </p>
          {author && (
            <p className="font-label text-[9px] lg:text-[10px] text-brand-steel uppercase tracking-widest truncate w-full text-center">
              {author}
            </p>
          )}
        </div>

        {/* Right: single avatar/menu */}
        <div className="shrink-0 sm:ml-auto">
          <NavMenu
            showSchedule={schedule}
            showTags={tags}
          />
        </div>

      </div>
    </nav>
  );
};

export default Navbar;
