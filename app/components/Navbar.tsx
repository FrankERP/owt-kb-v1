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
    <nav aria-label="Navegación superior" className="sticky top-0 z-50 border-b border-[#003572]/20 dark:border-[#00bfff]/20 bg-[#C8D8EB]/80 dark:bg-[#010b17]/80 backdrop-blur-sm pt-[env(safe-area-inset-top)]">
      <div className="mx-auto max-w-7xl h-14 lg:h-20 transition-[height] duration-300 flex items-center gap-4 ps-[max(1.5rem,env(safe-area-inset-left))] pe-[max(1.5rem,env(safe-area-inset-right))]">

        {/* Logo */}
        <Link href="/" className="shrink-0">
          <Image
            src="/LogoOasis.png"
            alt="Oasis Worship Team"
            width={40}
            height={40}
            className="h-10 lg:h-14 w-auto"
          />
        </Link>

        {/* Centered title */}
        <div className="flex-1 min-w-0 flex flex-col items-center justify-center overflow-hidden pointer-events-none">
          <p className="font-display text-base sm:text-xl lg:text-2xl uppercase tracking-wide truncate w-full text-center">
            {title}
          </p>
          {author && (
            <p className="font-label text-[10px] lg:text-xs text-gray-500 dark:text-gray-400 uppercase tracking-widest truncate w-full text-center">
              {author}
            </p>
          )}
        </div>

        {/* Right: single avatar/menu */}
        <div className="shrink-0">
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
