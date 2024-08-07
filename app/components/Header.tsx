import Link from "next/link";
import React from "react";

interface Props {
  title: string;
  tags?: boolean;
  author?: string;
}

const Header = ({ title = "", tags = false, author = "" }: Props) => {
  return (
    <header className="pb-14 px-4 mb-12 text-center border-b dark:border-[#00bfff] border-[#002249] mx-auto min-w-10 w-full sm:w-[75vw] md:w-[50vw] max-w-2xl font-bold">
      <h1 className="uppercase text-2xl sm:text-3xl md:text-4xl lg:text-5xl mb-2">{title}</h1>
      {author ? (
        <h2 className="uppercase text-lg sm:text-md md:text-lg lg:text-xl mb-4">{author}</h2>
      ) : (
        <h2 className="uppercase text-lg sm:text-md md:text-lg lg:text-xl mb-4">{"\u00A0"}</h2>
      )}
      {tags ? (
        <div className="text-md mt-2 hover:text-[#00bfff]">
          <Link href="/tag">#tags</Link>
        </div>
      ) : (
        <div className="text-md mt-2 text-gray-500">{"\u00A0"}</div>
      )}
    </header>
  );
};

export default Header;
