import { Post } from "@/app/utils/interface";
import { client } from "@/sanity/lib/client";
import React from "react";
import {
	VT323,
	Urbanist,
	Jura,
	Advent_Pro,
} from "next/font/google";
import Link from "next/link";
import { PortableText } from "next-sanity";
import Image from "next/image";
import { urlFor } from "@/sanity/lib/image";
import { notFound } from "next/navigation";
import Navbar from "@/app/components/Navbar";

const date = VT323({ weight: "400", subsets: ["latin"] });
const titleFont = Advent_Pro({ weight: "600", subsets: ["latin"] });
const subtitleFont = Advent_Pro({ weight: "600", subsets: ["latin"] });

const bodyFont = Urbanist({ weight: "600", subsets: ["latin"] });
const tagFont = Jura({ weight: "600", subsets: ["latin"] });

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
			timeSig,
			bpm,
			key,
      body,
      tags[] -> {
        _id,
        slug,
        name,
      },
      tutorials2[]{
        title,
        url
      },
      "lyricsURL": lyrics.asset->url,
      audioTracks[] {
        title,
        tone,
        "audioFileURL": audioFile.asset->url,
      },
      chordsPDF[] {
        title,
        key,
        "chordsURL": chordsPDF.asset->url,
      },
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
		...(post?.lyricsURL ? [{ url: post.lyricsURL, title: "Letra" }] : []),
		...(post?.chordsPDF?.map((c) => ({
			url: c.chordsURL,
			title: `Acordes${c.key ? ` - ${c.key}` : ""}`,
		})) ?? []),
	];

	return (
		<div>
			<Navbar
				title={post?.title}
				author={post?.author}
			/>
			<div className="text-center">
				<span className={`${date.className}`}>
					{(() => {
						const formattedDate = new Date(
							post?.publishDate
						).toLocaleDateString("es-ES", {
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
				<div className={`${tagFont.className} mt-5`}>
					{post?.tags?.map((tag) => (
						<Link
							key={tag?._id}
							href={`/tag/${tag?.slug?.current}`}
						>
							<span className="mr-2 p-1 text-gray-500 rounded-sm lowercase dark:border-gray-900">
								#{tag?.name}
							</span>
						</Link>
					))}
				</div>
				{/* Sección de Audio */}
				{post?.audioTracks?.length > 0 && (
					<div className="min-h-[10vw] overflow-x-auto w-full scroll-snap-x">
						<div className="flex space-x-4 justify-start md:justify-center">
							{post.audioTracks.map((track, index) => (
								track.audioFileURL && (
									<div key={index} className="scroll-snap-align">
										<div className="my-4 justify-center">
											<h3 className={`${bodyFont.className} text-lg font-bold`}>
												{track.title}{track.tone ? ` (${track.tone})` : ""}
											</h3>
											<audio controls>
												<source src={track.audioFileURL} type="audio/mp3" />
												Tu navegador no soporta el elemento de audio.
											</audio>
										</div>
										<a
											href={track.audioFileURL}
											download={`${post.title}-${post.author}-${track.title}.mp3`}
											className={`${tagFont.className} text-[#C8D8EB] dark:text-[#010b17]`}
										>
											<div className="my-4 rounded-xl bg-[#003572] dark:bg-[#a0a4a8] hover:opacity-50">
												Descargar audio
											</div>
										</a>
									</div>
								)
							))}
						</div>
					</div>
				)}
				<div className={richTextStyles}>
					<PortableText
						value={post?.body}
						components={myPortableTextComponents}
					/>
				</div>
        <h2
					className={`${titleFont.className} uppercase font-extrabold text-2xl sm:text-3xl md:text-4xl lg:text-5xl mb-2 shadow-bottom shadow-[#00bfff]`}
				>
					Acordes y Letras
				</h2>

				{/* Section for "Letra" and "Acordes" PDFs */}
				<div className="mt-10 mb-4 mx-10 grid grid-cols-1 sm:grid-cols-2 gap-4">
					{pdfFiles.map((pdf, index) => (
						<div
							key={index}
							className="relative w-full"
						>
							<div
								className={`${subtitleFont.className} text-lg md:text-xl mb-2 md:mb-4`}
							>
								{pdf.title}
							</div>

							<div className="relative">
								<iframe
									src={pdf.url}
									width="100%"
									height="500px" // Adjust the height as needed
									className="border-0"
								></iframe>
								<a
									href={pdf.url}
									target="_blank"
									rel="noopener noreferrer"
									className="absolute inset-0"
									style={{ zIndex: 10 }}
									download={`${post.title}-${post.author}-${pdf.title}.pdf`}
								>
									{/* Empty space to capture clicks */}
								</a>
							</div>
						</div>
					))}
				</div>

				{/* Sección de Tutoriales en Youtube*/}
        <div className="shadow-bottom shadow-[#00bfff]">
				<h2
					className={`${titleFont.className} uppercase font-extrabold text-2xl sm:text-3xl md:text-4xl lg:text-5xl mb-2`}
				>
					Tutoriales
				</h2>
        </div>
				<div className="mt-10 mb-4 mx-4 overflow-x-auto w-full scroll-snap-x">
					<div className="flex space-x-4 justify-start md:justify-center">
						{post?.tutorials2?.map((tutorial, index) => (
							<div
								key={index}
								className="flex-shrink-0 w-full max-w-xs scroll-snap-align"
							>
								<h3
									className={`${subtitleFont.className} text-lg md:text-xl font-bold mb-2`}
								>
									{tutorial.title}
								</h3>
								<iframe
									src={`${tutorial.url}`}
									width="100%"
									height="200px"
									className="border-0"
									title="YouTube video player"
									allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture web-share"
									referrerPolicy="strict-origin-when-cross-origin" 
									allowFullScreen
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
		image: ({ value }: any) => (
			<Image
				src={urlFor(value).url()}
				alt="Post"
				width={700}
				height={700}
			/>
		),
	},
};

const richTextStyles = `
  ${bodyFont.className}
  mt-14
  text-justify
  max-w-2xl
  m-auto
  prose-headings:my-5
  prose-heading:text-2xl
  prose-p:mb-5
  prose-p:leading-7
`;
