import { Post } from "@/app/utils/interface";
import { groupBySections } from "@/app/utils/lyrics";
import { client } from "@/sanity/lib/client";
import Link from "next/link";
import { PortableText } from "next-sanity";
import Image from "next/image";
import { urlFor } from "@/sanity/lib/image";
import { notFound } from "next/navigation";
import Navbar from "@/app/components/Navbar";
import SectionNav from "@/app/components/SectionNav";
import ChordChart from "@/app/components/ChordChart";
import EditSongButton from "@/app/components/EditSongButton";
import SongAudioSection from "@/app/components/SongAudioSection";

interface Params {
  params: Promise<{ slug: string }>;
}

async function getPost(slug: string) {
  const query = `
    *[_type == "post" && slug.current == $slug][0] {
      _id,
      title,
      author,
      authors[] -> { _id, slug, name },
      slug,
      publishDate,
      excerpt,
      timeSig,
      bpm,
      key,
      body,
      tags[] -> { _id, slug, name },
      referenceLinks[]{ label, url },
      musicalReferenceUrl,
      lyricsVideoUrl,
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
      chords[]{ key, content },
    }`;
  return await client.fetch(query, { slug });
}

async function getSongHistory(songId: string) {
  const query = `
    *[_type in ["featuredSongs", "saturdarSongs"] && references($songId)] | order(week desc)[0..2] {
      week,
      _type,
      "play_key": songs[song._ref == $songId][0].play_key,
      "pairedSongs": songs[song._ref != $songId][] {
        "title": song->title,
        "slug": song->slug,
        play_key,
      },
    }`;
  return await client.fetch(query, { songId });
}

export const revalidate = 3600;

export async function generateStaticParams() {
  const slugs: string[] = await client.fetch(`*[_type == "post" && defined(slug.current)].slug.current`);
  return slugs.map((slug) => ({ slug }));
}

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
  const { slug } = await params;
  const post: Post = await getPost(slug);

  if (!post) notFound();

  const history: Array<{
    week: string;
    _type: string;
    play_key?: string;
    pairedSongs: Array<{ title: string; slug: { current: string }; play_key?: string }>;
  }> = await getSongHistory(post._id);

  const hasAudio        = (post?.audioTracks?.length ?? 0) > 0;
  const hasInlineChords = (post?.chords?.length ?? 0) > 0;
  const hasTutorials = (post?.tutorials2?.length ?? 0) > 0;
  const hasBody      = !!post?.body;
  const hasLyrics    = hasBody || hasInlineChords;
  const hasHistory   = history.length > 0;
  const hasMusicalRef = !!post?.musicalReferenceUrl;
  const hasLyricsVid  = !!post?.lyricsVideoUrl;
  const hasRefLinks   = hasMusicalRef || hasLyricsVid || (post?.referenceLinks?.length ?? 0) > 0;

  const sections = [
    { id: "letra",      label: "Letra",        show: hasLyrics },
    { id: "audio",      label: "Audio",        show: hasAudio },
    { id: "tutoriales", label: "Tutoriales",   show: hasTutorials },
    { id: "referencia", label: "Referencia",   show: hasRefLinks },
    { id: "historial",  label: "Historial",    show: hasHistory },
  ].filter((s) => s.show);

  return (
    <div>
      <Navbar title={post?.title} author={post?.author} tags schedule />

      {/* ── Hero ─────────────────────────────────────────────────────────── */}
      <div className="relative bg-[#001f3f] dark:bg-[#00162e] border-b border-[#003572] dark:border-[#00bfff]/15">
        {/* Edit control — inline, top-right (self-gates to editors); avoids a floating FAB over the lyrics */}
        <div className="absolute top-4 right-4 z-10">
          <EditSongButton post={post} inline />
        </div>
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

          {post?.authors && post.authors.length > 0 ? (
            <div className="flex flex-wrap justify-center gap-x-2 gap-y-1 mb-8">
              {post.authors.map((a, i) => (
                <span key={a._id} className="font-body text-lg text-[#C8D8EB]/60">
                  <Link href={`/author/${a.slug.current}`} className="hover:text-[#00bfff] transition-colors">
                    {a.name}
                  </Link>
                  {i < post.authors!.length - 1 && <span className="text-[#C8D8EB]/30">,</span>}
                </span>
              ))}
            </div>
          ) : post?.author ? (
            <p className="font-body text-lg text-[#C8D8EB]/60 mb-8">{post.author}</p>
          ) : null}

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
      {sections.length > 1 && <SectionNav sections={sections} />}

      {/* ── Content ──────────────────────────────────────────────────────── */}
      <div className="max-w-7xl mx-auto px-6 py-12 space-y-20">

        {/* Letra / Body */}
        {hasLyrics && (
          <section id="letra">
            <SectionHeader>Letra</SectionHeader>
            {hasInlineChords ? (
              <ChordChart charts={post.chords!} />
            ) : (
              <div className="prose prose-sm sm:prose dark:prose-invert prose-p:leading-relaxed prose-p:!mt-0 prose-p:!mb-0 prose-headings:font-display prose-headings:uppercase prose-headings:!mt-6 prose-headings:!mb-1 columns-1 sm:columns-2 gap-10 max-w-4xl mx-auto">
                {groupBySections(post.body).map((group, i) => (
                  <div key={i} className="break-inside-avoid">
                    <PortableText value={group} components={myPortableTextComponents} />
                  </div>
                ))}
              </div>
            )}
          </section>
        )}

        {/* Audio */}
        {hasAudio && (
          <section id="audio">
            <SectionHeader>Audio</SectionHeader>
            <SongAudioSection
              tracks={post.audioTracks!}
              songTitle={post.title}
              songSlug={post.slug.current}
            />
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

        {/* Reference Links */}
        {hasRefLinks && (
          <section id="referencia">
            <SectionHeader>Versión de referencia</SectionHeader>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 max-w-2xl mx-auto">
              {(post.musicalReferenceUrl || (post.referenceLinks?.[0]?.url)) && (
                <a href={post.musicalReferenceUrl || post.referenceLinks![0].url}
                  target="_blank" rel="noopener noreferrer"
                  className="flex items-center gap-4 p-4 rounded-xl border border-[#003572]/25 dark:border-[#00bfff]/15 hover:border-[#00bfff]/50 hover:bg-[#00bfff]/5 transition-colors group">
                  <span className="flex items-center justify-center w-11 h-11 rounded-full bg-[#00bfff]/12 text-[#00bfff] shrink-0">
                    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round"><path d="M9 18V5l12-2v13" /><circle cx="6" cy="18" r="3" /><circle cx="18" cy="16" r="3" /></svg>
                  </span>
                  <span className="flex-1">
                    <span className="block font-display text-sm font-semibold group-hover:text-[#00bfff] transition-colors">Referencia musical</span>
                    <span className="block font-body text-xs text-[#C8D8EB]/60 dark:text-[#C8D8EB]/50">Para ensayar — músicos</span>
                  </span>
                </a>
              )}
              {post.lyricsVideoUrl && (
                <a href={post.lyricsVideoUrl}
                  target="_blank" rel="noopener noreferrer"
                  className="flex items-center gap-4 p-4 rounded-xl border border-[#003572]/25 dark:border-[#00bfff]/15 hover:border-[#00bfff]/50 hover:bg-[#00bfff]/5 transition-colors group">
                  <span className="flex items-center justify-center w-11 h-11 rounded-full bg-[#00bfff]/12 text-[#00bfff] shrink-0">
                    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round"><path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3z" /><path d="M19 10v2a7 7 0 0 1-14 0v-2" /><line x1="12" y1="19" x2="12" y2="22" /></svg>
                  </span>
                  <span className="flex-1">
                    <span className="block font-display text-sm font-semibold group-hover:text-[#00bfff] transition-colors">Versión con letra</span>
                    <span className="block font-body text-xs text-[#C8D8EB]/60 dark:text-[#C8D8EB]/50">Letra en español</span>
                  </span>
                </a>
              )}
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
  block: {
    h1: ({ children }: any) => <h1 className="break-after-avoid">{children}</h1>,
    h2: ({ children }: any) => <h2 className="break-after-avoid">{children}</h2>,
    h3: ({ children }: any) => <h3 className="break-after-avoid">{children}</h3>,
  },
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
