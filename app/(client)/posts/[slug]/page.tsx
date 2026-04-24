import { Post } from "@/app/utils/interface";
import { client } from "@/sanity/lib/client";
import Link from "next/link";
import { PortableText } from "next-sanity";
import Image from "next/image";
import { urlFor } from "@/sanity/lib/image";
import { notFound } from "next/navigation";
import Navbar from "@/app/components/Navbar";

interface Params {
  params: { slug: string };
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
      tags[] -> { _id, slug, name },
      tutorials2[]{ title, url },
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
  return await client.fetch(query);
}

async function getSongHistory(songId: string) {
  const query = `
    *[_type in ["featuredSongs", "saturdarSongs"] && references("${songId}")] | order(week desc)[0..2] {
      week,
      _type,
      "play_key": songs[song._ref == "${songId}"][0].play_key,
      "pairedSongs": songs[song._ref != "${songId}"][] {
        "title": song->title,
        "slug": song->slug,
        play_key,
      },
    }`;
  return await client.fetch(query);
}

export const revalidate = 60;

// ─── Sub-components ──────────────────────────────────────────────────────────

function SectionHeader({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex items-center gap-4 mb-8">
      <div className="flex-1 h-px bg-[#003572]/20 dark:bg-[#00bfff]/10" />
      <h2 className="font-display text-lg font-bold uppercase tracking-widest shrink-0">
        {children}
      </h2>
      <div className="flex-1 h-px bg-[#003572]/20 dark:bg-[#00bfff]/10" />
    </div>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────

const Page = async ({ params }: Params) => {
  const post: Post = await getPost(params?.slug);

  if (!post) notFound();

  const history: Array<{
    week: string;
    _type: string;
    play_key?: string;
    pairedSongs: Array<{ title: string; slug: { current: string }; play_key?: string }>;
  }> = await getSongHistory(post._id);

  const pdfFiles = [
    ...(post?.lyricsURL ? [{ url: post.lyricsURL, title: "Letra" }] : []),
    ...(post?.chordsPDF?.map((c) => ({
      url: c.chordsURL,
      title: `Acordes${c.key ? ` — ${c.key}` : ""}`,
    })) ?? []),
  ];

  const hasAudio     = (post?.audioTracks?.length ?? 0) > 0;
  const hasChords    = pdfFiles.length > 0;
  const hasTutorials = (post?.tutorials2?.length ?? 0) > 0;
  const hasBody      = !!post?.body;
  const hasHistory   = history.length > 0;

  const sections = [
    { id: "letra",      label: "Letra",      show: hasBody },
    { id: "audio",      label: "Audio",      show: hasAudio },
    { id: "acordes",    label: "Acordes",    show: hasChords },
    { id: "tutoriales", label: "Tutoriales", show: hasTutorials },
    { id: "historial",  label: "Historial",  show: hasHistory },
  ].filter((s) => s.show);

  return (
    <div>
      <Navbar title={post?.title} author={post?.author} />

      {/* ── Hero ─────────────────────────────────────────────────────────── */}
      <div className="bg-[#001f3f] dark:bg-[#00162e] border-b border-[#003572] dark:border-[#00bfff]/15">
        <div className="max-w-7xl mx-auto px-6 pt-10 pb-12 flex flex-col items-center text-center">

          {post?.tags && post.tags.length > 0 && (
            <div className="flex flex-wrap justify-center gap-3 mb-5">
              {post.tags.map((tag) => (
                <Link key={tag._id} href={`/tag/${tag.slug.current}`}>
                  <span className="font-label text-xs uppercase tracking-widest text-[#00bfff]/60 hover:text-[#00bfff] transition-colors">
                    #{tag.name}
                  </span>
                </Link>
              ))}
            </div>
          )}

          <h1 className="font-display text-xl sm:text-3xl lg:text-4xl xl:text-5xl font-bold text-white leading-tight mb-2 text-balance break-words">
            {post?.title}
          </h1>

          {post?.author && (
            <p className="font-body text-lg text-[#C8D8EB]/60 mb-8">
              {post.author}
            </p>
          )}

          <div className="flex flex-wrap justify-center gap-3">
            {post?.key && (
              <span className="font-label text-sm px-3 py-1 rounded-full border border-[#00bfff]/40 text-[#00bfff]">
                {post.key}
              </span>
            )}
            {post?.bpm && (
              <span className="font-label text-sm px-3 py-1 rounded-full border border-[#C8D8EB]/20 text-[#C8D8EB]/60">
                {post.bpm} BPM
              </span>
            )}
            {post?.timeSig && (
              <span className="font-label text-sm px-3 py-1 rounded-full border border-[#C8D8EB]/20 text-[#C8D8EB]/60">
                {post.timeSig}
              </span>
            )}
          </div>
        </div>
      </div>

      {/* ── Section nav ──────────────────────────────────────────────────── */}
      {sections.length > 1 && (
        <div className="sticky top-14 z-40 bg-[#C8D8EB]/90 dark:bg-[#010b17]/90 backdrop-blur-sm border-b border-[#003572]/15 dark:border-[#00bfff]/10">
          <div className="max-w-7xl mx-auto px-6 flex justify-center gap-1 overflow-x-auto">
            {sections.map((s) => (
              <a
                key={s.id}
                href={`#${s.id}`}
                className="font-label text-xs uppercase tracking-widest px-4 py-3 text-gray-500 dark:text-gray-400 hover:text-[#00bfff] dark:hover:text-[#00bfff] border-b-2 border-transparent hover:border-[#00bfff] transition-colors whitespace-nowrap"
              >
                {s.label}
              </a>
            ))}
          </div>
        </div>
      )}

      {/* ── Content ──────────────────────────────────────────────────────── */}
      <div className="max-w-7xl mx-auto px-6 py-12 space-y-20">

        {/* Letra / Body */}
        {hasBody && (
          <section id="letra">
            <SectionHeader>Letra</SectionHeader>
            <div className="prose prose-sm sm:prose dark:prose-invert prose-p:leading-7 prose-headings:font-display prose-headings:uppercase columns-1 sm:columns-2 gap-10 max-w-4xl mx-auto">
              <PortableText
                value={post.body}
                components={myPortableTextComponents}
              />
            </div>
          </section>
        )}

        {/* Audio */}
        {hasAudio && (
          <section id="audio">
            <SectionHeader>Audio</SectionHeader>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
              {post.audioTracks!.map((track, i) =>
                track.audioFileURL ? (
                  <div
                    key={i}
                    className="rounded-xl border border-[#003572]/25 dark:border-[#00bfff]/15 p-5 space-y-4"
                  >
                    <div>
                      <p className="font-display text-base font-semibold leading-snug">
                        {track.title}
                      </p>
                      {track.tone && (
                        <p className="font-label text-xs text-[#00bfff] uppercase tracking-wide mt-1">
                          {track.tone}
                        </p>
                      )}
                    </div>
                    <audio controls className="w-full">
                      <source src={track.audioFileURL} type="audio/mpeg" />
                    </audio>
                    <a
                      href={track.audioFileURL}
                      download={`${post.title} — ${track.title}.mp3`}
                      className="block text-center font-label text-xs uppercase tracking-widest text-gray-500 dark:text-gray-400 hover:text-[#00bfff] dark:hover:text-[#00bfff] transition-colors"
                    >
                      Descargar ↓
                    </a>
                  </div>
                ) : null
              )}
            </div>
          </section>
        )}

        {/* Acordes & PDFs */}
        {hasChords && (
          <section id="acordes">
            <SectionHeader>Acordes y Letras</SectionHeader>
            <div className="flex flex-wrap justify-center gap-5">
              {pdfFiles.map((pdf, i) => (
                <div
                  key={i}
                  className="w-full max-w-xs rounded-xl border border-[#003572]/25 dark:border-[#00bfff]/15 p-6 flex flex-col items-center gap-5 text-center"
                >
                  {/* Document icon */}
                  <div className="w-14 h-14 rounded-xl bg-[#003572]/15 dark:bg-[#00bfff]/10 flex items-center justify-center shrink-0">
                    <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="text-[#00bfff]">
                      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                      <polyline points="14 2 14 8 20 8" />
                      <line x1="16" y1="13" x2="8" y2="13" />
                      <line x1="16" y1="17" x2="8" y2="17" />
                      <polyline points="10 9 9 9 8 9" />
                    </svg>
                  </div>

                  <p className="font-display text-base font-semibold leading-snug">
                    {pdf.title}
                  </p>

                  <div className="flex flex-col gap-2 w-full">
                    <a
                      href={pdf.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="w-full rounded-lg border border-[#00bfff]/40 text-[#00bfff] font-label text-xs uppercase tracking-widest py-2 hover:bg-[#00bfff]/10 transition-colors"
                    >
                      Abrir ↗
                    </a>
                    <a
                      href={pdf.url}
                      download={`${post.title} — ${pdf.title}.pdf`}
                      className="w-full rounded-lg border border-[#003572]/25 dark:border-[#00bfff]/15 font-label text-xs uppercase tracking-widest py-2 text-gray-500 dark:text-gray-400 hover:text-[#00bfff] hover:border-[#00bfff]/40 transition-colors"
                    >
                      Descargar ↓
                    </a>
                  </div>
                </div>
              ))}
            </div>
          </section>
        )}

        {/* Tutoriales */}
        {hasTutorials && (
          <section id="tutoriales">
            <SectionHeader>Tutoriales</SectionHeader>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
              {post.tutorials2!.map((tutorial, i) => (
                <div
                  key={i}
                  className="rounded-xl border border-[#003572]/25 dark:border-[#00bfff]/15 overflow-hidden"
                >
                  <div className="aspect-video">
                    <iframe
                      src={tutorial.url}
                      width="100%"
                      height="100%"
                      className="border-0"
                      title={tutorial.title}
                      allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture web-share"
                      referrerPolicy="strict-origin-when-cross-origin"
                      allowFullScreen
                    />
                  </div>
                  {tutorial.title && (
                    <div className="px-4 py-3 border-t border-[#003572]/15 dark:border-[#00bfff]/10">
                      <p className="font-display text-sm font-semibold leading-snug">
                        {tutorial.title}
                      </p>
                    </div>
                  )}
                </div>
              ))}
            </div>
          </section>
        )}

        {/* Historial */}
        {hasHistory && (
          <section id="historial">
            <SectionHeader>Última vez tocada</SectionHeader>
            <div className="flex flex-col gap-4 max-w-xl mx-auto">
              {history.map((entry, i) => (
                <div
                  key={i}
                  className="rounded-xl border border-[#003572]/25 dark:border-[#00bfff]/15 overflow-hidden"
                >
                  {/* Header row: day + date + key */}
                  <div className="flex items-center justify-between px-5 py-3 bg-[#003572]/10 dark:bg-[#00bfff]/5 border-b border-[#003572]/15 dark:border-[#00bfff]/10">
                    <div>
                      <p className="font-label text-[10px] uppercase tracking-widest text-gray-500 dark:text-gray-400 mb-0.5">
                        {entry._type === "featuredSongs" ? "Domingo" : "Sábado"}
                      </p>
                      <p className="font-body text-sm md:text-base font-semibold">
                        {new Date(entry.week.slice(0, 10) + "T12:00:00").toLocaleDateString("es-ES", {
                          year: "numeric",
                          month: "long",
                          day: "numeric",
                        })}
                      </p>
                    </div>
                    {entry.play_key && (
                      <span className="font-label text-sm px-3 py-1 rounded-full border border-[#00bfff]/40 text-[#00bfff] shrink-0">
                        {entry.play_key}
                      </span>
                    )}
                  </div>

                  {/* Paired songs */}
                  {entry.pairedSongs?.length > 0 && (
                    <ol className="px-5 py-3 space-y-2">
                      {entry.pairedSongs.map((song, j) => (
                        <li key={j} className="flex items-center justify-between gap-4">
                          <Link
                            href={`/posts/${song.slug.current}`}
                            className="font-body text-sm md:text-base hover:text-[#00bfff] transition-colors truncate"
                          >
                            {song.title}
                          </Link>
                          {song.play_key && (
                            <span className="font-label text-xs text-[#00bfff]/70 shrink-0">
                              {song.play_key}
                            </span>
                          )}
                        </li>
                      ))}
                    </ol>
                  )}
                </div>
              ))}
            </div>
          </section>
        )}

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
        className="rounded-xl"
      />
    ),
  },
};
