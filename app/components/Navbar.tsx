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
  const showMobileWordmark = title === "OWT";

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
          <div className={`leading-none ${showMobileWordmark ? "" : "hidden sm:block"}`}>
            <p className="font-display text-base sm:text-lg lg:text-2xl uppercase tracking-[0.12em] text-brand-frost">
              Backstage
            </p>
            <p className="mt-1 hidden font-label text-[8px] uppercase tracking-[0.22em] text-brand-steel sm:block lg:text-[10px]">
              Oasis Worship Team
            </p>
          </div>
        </Link>

        {/* Centered title */}
        <div className="pointer-events-none absolute left-1/2 top-1/2 flex w-1/3 min-w-0 -translate-x-1/2 -translate-y-1/2 flex-col items-center justify-center overflow-hidden">
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
        <div className="ml-auto shrink-0">
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
