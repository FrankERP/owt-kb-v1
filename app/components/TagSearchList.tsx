"use client";

import { useState } from "react";
import { Tag } from "../utils/interface";
import Link from "next/link";
import { Jura, Urbanist } from "next/font/google";

const labelFont = Jura({ weight: "600", subsets: ["latin"] });
const tagFont = Urbanist({ weight: "600", subsets: ["latin"] });

interface Props {
  tags: Tag[];
}

export default function TagSearchList({ tags }: Props) {
  const [query, setQuery] = useState("");

  const filtered = query.trim()
    ? tags.filter((t) =>
        t.name.toLowerCase().includes(query.toLowerCase())
      )
    : tags;

  return (
    <div>
      <div className="flex justify-center px-4 mb-6">
        <input
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Buscar etiquetas..."
          className={`${labelFont.className} w-full max-w-md px-4 py-2 rounded-lg border border-[#003572] dark:border-[#00bfff] bg-transparent focus:outline-none focus:ring-2 focus:ring-[#00bfff] text-sm`}
        />
      </div>
      <div className="container mx-auto px-4 grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-6">
        {filtered.length > 0 ? (
          filtered.map((tag) => (
            <Link key={tag._id} href={`/tag/${tag.slug.current}`}>
              <div className="bg-white dark:bg-[#010b17] dark:border dark:border-[#00bfff] shadow-md rounded-lg p-4 hover:bg-[#00bfff] hover:text-white transition-transform transform hover:scale-105">
                <h3 className={`${tagFont.className} text-lg capitalize`}>
                  #{tag.name}
                </h3>
                <p className="text-sm text-gray-500">
                  {tag?.postCount} post{tag?.postCount !== 1 && "s"}
                </p>
              </div>
            </Link>
          ))
        ) : (
          <p className="col-span-full text-center text-gray-500 py-8">
            No se encontraron etiquetas.
          </p>
        )}
      </div>
    </div>
  );
}
