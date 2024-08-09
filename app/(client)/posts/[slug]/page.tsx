import { Post } from "@/app/utils/interface";
import { client } from "@/sanity/lib/client";
import React from "react";
import { VT323 } from "next/font/google";
import Link from "next/link";
import { PortableText } from "next-sanity";
import Image from "next/image";
import { urlFor } from "@/sanity/lib/image";
import { notFound } from "next/navigation";
import Navbar from "@/app/components/Navbar";

const date = VT323({ weight: "400", subsets: ["latin"] });

interface Params {
  params: {
    slug: string;
  };
}

async function getPost(slug: string) {
  const query = `
    *[_type == "post" && slug.current == "${slug}"][0] {
      _id,
      title,
      author,
      slug,
      publishDate,
      excerpt,
      body,
      tags[] -> {
        _id,
        slug,
        name,
      },
      "lyricsURL": lyrics.asset->url,
      "chordsURL": chords.asset->url,
      "bothURL": bothPDF.asset->url,
  }`;
  const post = await client.fetch(query);
  return post;
}

export const revalidate = 60;

const Page = async ({ params }: Params) => {
  const post: Post = await getPost(params?.slug);

  if (!post) {
    notFound();
  }

  const pdfFiles = [
    { url: post?.lyricsURL, title: "Lyrics PDF" },
    { url: post?.chordsURL, title: "Chords PDF" },
    { url: post?.bothURL, title: "Chords and Lyrics PDF" }
  ].filter(pdf => pdf.url);

  return (
    <div>
      <Navbar title={post?.title} author={post?.author} />
      <div className="text-center">
        <span className={`${date.className}`}>
          {(() => {
            const formattedDate = new Date(post?.publishDate).toLocaleDateString("es-ES", {
              weekday: "long",
              year: "numeric",
              month: "long",
              day: "numeric",
            });
            return (
              formattedDate.charAt(0).toUpperCase() + formattedDate.slice(1)
            );
          })()}
        </span>
        <div className="mt-5">
          {post?.tags?.map((tag) => (
            <Link key={tag?._id} href={`/tag/${tag?.slug?.current}`}>
              <span className="mr-2 p-1 text-gray-500 rounded-sm lowercase dark:border-gray-900">
                #{tag?.name}
              </span>
            </Link>
          ))}
        </div>
        <div className={richTextStyles}>
          <PortableText
            value={post?.body}
            components={myPortableTextComponents}
          />
        </div>

        {/* Sección deslizable para los PDFs */}
        <div className="mt-10 overflow-x-auto">
          <div className="flex space-x-4">
            {pdfFiles.map((pdf, index) => (
              <div key={index} className="flex-shrink-0 lg:w-[33vw] md:w-[50vw] sm:w-[100vw]">
                <h3 className="text-xl font-bold mb-4">{pdf.title}</h3>
                <iframe
                  src={pdf.url}
                  width="100%"
                  height="600px"
                  className="border-0"
                ></iframe>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
};

export default Page;

const myPortableTextComponents = {
  types: {
    image: ({ value }: any) =>
      <Image
        src={urlFor(value).url()}
        alt="Post"
        width={700}
        height={700}
      />,
  },
};

const richTextStyles = `
  mt-14
  text-justify
  max-w-2xl
  m-auto
  prose-headings:my-5
  prose-heading:text-2xl
  prose-p:mb-5
  prose-p:leading-7
`;
