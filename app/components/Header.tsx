import Link from "next/link";
import React from "react";
import { Advent_Pro, Jura } from "next/font/google";
interface Props {
  title: string;
  tags?: boolean;
  author?: string;
}

const titleFont3 = Advent_Pro({ weight: "600", subsets: ["latin"] });
const authorFont = Jura({ weight: "600", subsets: ["latin"] });

const Header = ({ title = "", tags = false, author = "" }: Props) => {
  return (
    <header className="pb-14 px-4 mb-12 text-center shadow-[#002249] mx-auto min-w-10 w-full sm:w-[75vw] md:w-[50vw] max-w-2xl  shadow-bottom dark:shadow-[#00bfff]">
      <h1 className={`${titleFont3.className} text-bold uppercase text-2xl sm:text-3xl md:text-4xl lg:text-5xl mb-2`}>{title}</h1>
      {author ? (
        <h2 className={`${authorFont.className} text-bold uppercase text-lg sm:text-md md:text-lg lg:text-xl mb-4`}>{author}</h2>
      ) : (
        <h2 className={`${authorFont.className}  uppercase text-lg sm:text-md md:text-lg lg:text-xl mb-4`}>{"\u00A0"}</h2>
      )}
      {tags ? (
        <div className={`${authorFont.className}  text-bold text-lg mt-2 hover:text-[#00bfff]`}>
          <Link href="/tag">#tags</Link>
        </div>
      ) : (
        <div className="text-md mt-2 text-gray-500">{"\u00A0"}</div>
      )}
    </header>
  );
};

export default Header;
