import React from "react";
import Link from "next/link";
import Image from "next/image";
import { getServerSession } from "next-auth";
import { authOptions } from "@/auth";
import NavMenu from "./NavMenu";

interface Props {
  title: string;
  author?: string;
  tags?: boolean;
  schedule?: boolean;
}

const Navbar = async ({ title = "", author = "", tags = false, schedule = false }: Props) => {
  const session = await getServerSession(authOptions);

  return (
    <nav className="sticky top-0 z-50 border-b border-[#003572]/20 dark:border-[#00bfff]/20 bg-[#C8D8EB]/80 dark:bg-[#010b17]/80 backdrop-blur-sm">
      <div className="mx-auto max-w-7xl px-6 h-14 lg:h-20 flex items-center gap-4">

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
            user={session?.user ?? null}
            showSchedule={schedule}
            showTags={tags}
          />
        </div>

      </div>
    </nav>
  );
};

export default Navbar;
