import React from "react";
import Link from "next/link";
import Image from "next/image";

interface Props {
  title: string;
  author?: string;
  tags?: boolean;
  schedule?: boolean;
}

const Navbar = ({ title = "", author = "", tags = false, schedule = false }: Props) => {
  return (
    <nav className="sticky top-0 z-50 border-b border-[#003572]/20 dark:border-[#00bfff]/20 bg-[#C8D8EB]/80 dark:bg-[#010b17]/80 backdrop-blur-sm">
      <div className="relative mx-auto max-w-7xl px-6 h-14 lg:h-24 flex items-center">

        <Link href="/" className="shrink-0">
          <Image
            src="/LogoOasis.png"
            alt="Oasis Worship Team"
            width={40}
            height={40}
            className="h-10 lg:h-16 w-auto"
          />
        </Link>

        <div className="absolute inset-x-0 px-16 flex flex-col items-center justify-center pointer-events-none overflow-hidden">
          <p className="font-display text-xs sm:text-sm md:text-lg lg:text-3xl uppercase tracking-wide truncate w-full text-center">
            {title}
          </p>
          {author && (
            <p className="font-label text-xs lg:text-lg text-gray-500 dark:text-gray-400 uppercase tracking-widest truncate w-full text-center">
              {author}
            </p>
          )}
        </div>

        <div className="ml-auto shrink-0 flex items-center gap-4">
          {schedule && (
            <Link
              href="/schedule"
              className="font-label text-xs lg:text-lg uppercase tracking-widest text-gray-500 dark:text-gray-400 hover:text-[#00bfff] dark:hover:text-[#00bfff] transition-colors"
            >
              Calendario
            </Link>
          )}
          {tags && (
            <Link
              href="/tag"
              className="font-label text-xs lg:text-lg uppercase tracking-widest text-gray-500 dark:text-gray-400 hover:text-[#00bfff] dark:hover:text-[#00bfff] transition-colors"
            >
              #tags
            </Link>
          )}
        </div>

      </div>
    </nav>
  );
};

export default Navbar;
