import type { Metadata } from "next";
import { Post } from "@/app/utils/interface";
import { groupBySections } from "@/app/utils/lyrics";
import { client } from "@/sanity/lib/client";
import { serverClient } from "@/sanity/lib/serverClient";
import { operationalClient } from "@/sanity/lib/operationalClient";
import {
  canonicalizePlayHistory,
  playHistoryTargetKey,
  serviceDayKey,
} from "@/app/utils/serviceReadSelect";
import Link from "next/link";
import { PortableText } from "next-sanity";
import type { PortableTextComponents } from "@portabletext/react";
import Image from "next/image";
import { urlFor } from "@/sanity/lib/image";
import { notFound } from "next/navigation";
import { songSections, type SongSection } from "@/app/utils/songSections";
import AssistantPageContext from "@/app/components/assistant/AssistantPageContext";
import Navbar from "@/app/components/Navbar";
import SectionNav from "@/app/components/SectionNav";
import ChordChart from "@/app/components/ChordChart";
import EditSongButton from "@/app/components/EditSongButton";
import SongAudioSection from "@/app/components/SongAudioSection";
import RehearsalPlayer from "@/app/components/song/RehearsalPlayer";
import SongHeroPills from "@/app/components/song/SongHeroPills";
import { TransposeProvider } from "@/app/components/song/TransposeProvider";
import LyricsAutoscroll from "@/app/components/song/LyricsAutoscroll";
import TutorialPoster from "@/app/components/song/TutorialPoster";
import { dimRepeatMarkers, LYRIC_EYEBROW_BLOCK } from "@/app/utils/lyricMarkers";
import { isChordPro } from "@/app/utils/transpose";
import { mixTones } from "@/app/utils/rehearsalMixes";
import { countLyricLines } from "@/app/utils/practice";
import { requireWorshipPage } from "@/app/utils/worshipPageGate";
import { revealProps } from "@/app/utils/reveal";
import { formatKey } from "@/app/utils/formatKey";
import { splitSongTitle } from "@/app/utils/songTitle";
import { SHEET_TITLE } from "@/app/utils/homeHero";
import { ExternalLinkIcon } from "@/app/components/ui/icons";
import { Fragment } from "react";
import { formatHistoryDate } from "@/app/utils/historyDate";

interface Params {
  params: Promise<{ slug: string }>;
}

// Per-song page title/description so browser tabs, bookmarks and shared links
// show the song name instead of the generic site title.
export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const { slug } = await params;
  const post = await client.fetch<{ title?: string; author?: string } | null>(
    `*[_type == "post" && slug.current == $slug][0]{ title, author }`,
    { slug }
  );
  if (!post?.title) return { title: "Canción — Oasis Worship Team" };
  return {
    title: `${post.title} — Oasis Worship Team`,
    description: post.author ? `${post.title} · ${post.author}` : post.title,
  };
}

async function getPost(slug: string) {
  // `order(_id asc)` before `[0]`, here and in `getSongHistory`: both resolve the song
  // by its slug on their own, so a duplicate slug must pick the same document twice.
  const query = `
    *[_type == "post" && slug.current == $slug] | order(_id asc)[0] {
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
      rehearsalMixes[] { _key, kind, track, family, tone, bpm, peaks, active, sourceHash },
      chordsPDF[] {
        title,
        key,
        "chordsURL": chordsPDF.asset->url,
      },
      chords[]{ _key, key, content },
    }`;
  return await client.fetch<Post | null>(query, { slug });
}

interface SongHistoryEntry {
  week: string;
  _type: string;
  play_key?: string;
  pairedSongs: Array<{ title: string; slug: { current: string }; play_key?: string }>;
}

async function getSongHistory(slug: string): Promise<SongHistoryEntry[]> {
  // "Última vez tocada" must reflect PAST plays only. Bound to week < today
  // (America/Mexico_City): a future or this-week setlist has not been played
  // yet — without this bound it would show as the last play with a future date,
  // and an upcoming/draft service would leak its paired-song list to members.
  // (A week bound, not a published-role join: most historical setlists predate
  // role docs, so a role join would erase legitimate play history.)
  const today = new Date().toLocaleDateString("sv", { timeZone: "America/Mexico_City" });
  // Canonical (published-perspective) client so a `drafts.*` setlist overlay
  // never counts as a play. Over-fetch, then canonicalize by target: a duplicate
  // week (ambiguous target) contributes NO rows rather than a false or
  // double-counted play, and only then take the three most recent.
  //
  // Keyed by the SLUG, not the song's id, so it runs alongside `getPost` instead of
  // after it: every read crosses the Atlantic (Sanity is in Belgium, the functions
  // in iad1 — ADR-0075). `^._id` is the song inside the setlist filter, `^.^._id`
  // inside a setlist's `songs[]`.
  const query = `
    *[_type == "post" && slug.current == $slug] | order(_id asc)[0] {
      "rows": *[_type in ["featuredSongs", "saturdarSongs"] && references(^._id) && week < $today] | order(week desc)[0..19] {
        week,
        _type,
        "play_key": songs[song._ref == ^.^._id][0].play_key,
        "pairedSongs": songs[song._ref != ^.^._id][] {
          "title": song->title,
          "slug": song->slug,
          play_key,
        },
      }
    }.rows`;
  const rows = (await operationalClient.fetch<SongHistoryEntry[] | null>(query, { slug, today })) ?? [];
  return canonicalizePlayHistory(rows, playHistoryTargetKey)
    .filter((entry) => serviceDayKey(entry.week) !== null)
    .slice(0, 3)
    .map((entry) => ({
      ...entry,
      // A dangling song reference projects null title/slug — drop it instead of
      // crashing on `song.slug.current` while rendering the paired list.
      pairedSongs: (Array.isArray(entry.pairedSongs) ? entry.pairedSongs : []).filter(
        (song) => !!song?.slug?.current && !!song?.title,
      ),
    }));
}

export const revalidate = 3600;

// No `generateStaticParams`: `requireWorshipPage` makes this page dynamic (ADR-0020),
// so the build's prerender of every slug only bailed out — and since the song and its
// history are read before the gate settles, each attempt would spend two Sanity reads.

// ─── Sub-components ──────────────────────────────────────────────────────────

// Every section's title is the run sheet's small caps (`SHEET_TITLE`, ADR-0070):
// the song's title is the one big line on the page, so a section needs no
// display-size heading or rail of its own. `action` sits on the title's line.
function SectionHeader({ children, action }: { children: React.ReactNode; action?: React.ReactNode }) {
  return (
    <div className="mb-4 flex min-h-[1.75rem] items-center justify-between gap-4">
      <h2 className={SHEET_TITLE}>{children}</h2>
      {action}
    </div>
  );
}

// The sticky bar parks a section below itself: the same inset on every section.
const SECTION_SCROLL =
  "scroll-mt-[calc(8rem+env(safe-area-inset-top)+var(--impersonation-offset))] lg:scroll-mt-[calc(10rem+env(safe-area-inset-top)+var(--impersonation-offset))]";
// From `lg` the lyric sits LEFT beside everything else (play a mix, read without
// scrolling); the DOM keeps the nav's order and the grid places it.
const SIDE = `${SECTION_SCROLL} mb-14 lg:col-start-2`;
// No lyric, no left column: the sections stack in one readable column instead of
// sitting in the right half beside an empty 34rem (~15 songs have no lyrics).
const STACKED = `${SECTION_SCROLL} mb-14`;
const LYRIC = `${SECTION_SCROLL} mb-14 lg:col-start-1 lg:row-start-1 lg:row-span-6`;

// ─── Page ─────────────────────────────────────────────────────────────────────

const Page = async ({ params }: Params) => {
  const { slug } = await params;
  // One round trip for the gate, the song and its history, not three in a row:
  // each read crosses the Atlantic (ADR-0075). The reads start first but the gate is
  // awaited first, so its redirect always wins, even over a failed read (the `catch`
  // only keeps that failure from going unhandled while the gate decides). A visitor
  // the gate turns away — a kids-only member, a disabled one — costs two reads that
  // render nothing.
  const reads = Promise.all([getPost(slug), getSongHistory(slug)]);
  reads.catch(() => {});
  const session = await requireWorshipPage(`/posts/${slug}`);
  const [post, history] = await reads;

  if (!post) notFound();

  // «Cordero y León (Lion and The Lamb)»: the Spanish name is the title, the
  // original joins the authors' line (ADR-0070).
  const title = splitSongTitle(post.title);

  // Preselection only (spec §8.2): the viewer's declared instruments pick which
  // rehearsal row is highlighted. Plain data — this stays a Server Component.
  const myInstruments = post.rehearsalMixes?.length
    ? (await serverClient.fetch<string[] | null>(
        `*[_type == "teamMembers" && _id == $me][0].instruments`,
        { me: session.user.sanityId },
      )) ?? []
    : [];

  // `songSections` owns which of the five paint — see its header for why the
  // `body` flag in particular is worth a tested home.
  const sections = songSections(post, history.length);
  const shows = (id: SongSection["id"]) => sections.some((s) => s.id === id);
  const hasRehearsal    = shows("ensayo");
  const hasAudio        = shows("audio");
  const hasInlineChords = (post?.chords?.length ?? 0) > 0;
  // The hero key is a TRANSPOSER only for a ChordPro chart: a plain-text chart
  // carries no bracketed chords to move, so the drawer would shift the readout
  // and nothing else. It has to be the FIRST chart: `ChordChart` opens on index
  // 0 and only the chart on screen transposes, so a ChordPro chart further down
  // the list would arm a dial over a chart that cannot move.
  const firstChart      = post?.chords?.[0] ?? null;
  const transposable    = !!firstChart && isChordPro(firstChart.content);
  // The dial transposes the CHART, and a chart may be written in a key other
  // than the song's (`post.key`) — a guitar sheet in G for a song sung in Ab.
  // Seat the provider on the chart's key so the dial, the drawer's «(original)»
  // hint and the chart's own readout agree; with no transposable chart the
  // song's own key is what the badge shows.
  const heroKey         = (transposable ? firstChart?.key : null) ?? post?.key ?? null;
  // The schema field is a number, but the interface types it `string` and the
  // catalogue predates both — so parse, and keep an unparsable value VISIBLE as
  // the static pill it has always been rather than dropping the row silently.
  const bpmNumber       = Number(post?.bpm);
  const bpm             = Number.isFinite(bpmNumber) && bpmNumber > 0 ? bpmNumber : null;
  const bpmText         = post?.bpm && bpm === null ? String(post.bpm) : null;
  const hasTutorials    = shows("tutoriales");
  const hasLyrics       = shows("letra");
  const side            = hasLyrics ? SIDE : STACKED;
  // How long the autoscroll should take: every chart's lines when there are
  // charts (the section renders them all), otherwise one PortableText BLOCK per line — an approximation (a long
  // paragraph wraps to several), accepted because the speed is clamped to a
  // readable band either way.
  const lyricLines      = hasInlineChords
    ? (post.chords ?? []).reduce((n, c) => n + countLyricLines(c.content), 0)
    : (post?.body?.length ?? 0);
  const hasHistory      = shows("historial");
  const hasRefLinks     = shows("referencia");
  // The sticky bar's practice cluster takes over the hero's play control, so it
  // offers what the audio section offers first: the first track that actually
  // has a file. Plain data — the page is a Server Component (ADR-0028).
  const firstAudio      = (post?.audioTracks ?? []).find((t) => t.audioFileURL);
  const firstTrack      = firstAudio
    ? {
        url: firstAudio.audioFileURL,
        title: firstAudio.title,
        tone: firstAudio.tone,
        songTitle: post.title,
        songSlug: post.slug.current,
      }
    : null;

  return (
    <div>
      <Navbar title={post?.title} author={post?.author} />
      {/* Tells the assistant bubble which song is on screen (ADR-0060). */}
      <AssistantPageContext label={`Canción: ${post.title}`} refs={[{ kind: "song", id: post._id, label: post.title }]} />

      {/* ONE transposition seat for the whole page (R4 ruling 2): the hero's key
          picker and ChordChart's ± pair write the same value, so the key shown
          above the chart can never disagree with the chart. */}
      <TransposeProvider nativeKey={heroKey}>

      {/* ── Hero: a title on the plain page, as Inicio's greeting (ADR-0070) —
          no painted band, no centred stack; the edit control keeps its corner. */}
      <div id="song-hero" className="relative">
        <div className="absolute right-4 top-4 z-10 md:right-6 md:top-6">
          <EditSongButton post={post} inline />
        </div>
        <div className="mx-auto flex max-w-7xl flex-col px-6 pb-10 pt-8 md:pb-12 md:pt-12">
          <h1 {...revealProps(0)} className="max-w-4xl text-balance break-words pr-14 font-display text-[2.875rem] font-semibold leading-[0.98] tracking-tight text-ink md:pr-0 md:text-[4.75rem]">
            {title.main}
          </h1>

          {(title.original || (post?.authors && post.authors.length > 0) || post?.author) && (
            <p {...revealProps(1)} className="mt-4 font-body text-[17px] leading-snug text-ink-muted md:text-xl">
              {title.original}
              {title.original && ((post?.authors && post.authors.length > 0) || post?.author) ? " · " : ""}
              {post?.authors && post.authors.length > 0
                ? post.authors.map((a, i) => (
                    <Fragment key={a._id}>
                      {i > 0 && ", "}
                      <Link href={`/biblioteca?author=${encodeURIComponent(a.slug.current)}`} className="transition-colors hover:text-accent">
                        {a.name}
                      </Link>
                    </Fragment>
                  ))
                : post?.author}
            </p>
          )}

          <div className="mt-6">
            <SongHeroPills
              keyLabel={heroKey}
              bpm={bpm}
              bpmText={bpmText}
              timeSig={post?.timeSig ?? null}
              transposable={transposable}
              mixTones={mixTones(post?.rehearsalMixes ?? [])}
              revealIndex={2}
            />
          </div>

          {/* The tags, after the pills and as quiet lowercase links (design pass
              E, 2026-10-22): a reader opens a song for its title, key and tempo,
              and reaches the tags only to browse sideways. */}
          {post?.tags && post.tags.length > 0 && (
            <div {...revealProps(3)} className="mt-5 flex flex-wrap gap-x-3.5 gap-y-1.5">
              {post.tags.map((tag) => (
                <Link
                  key={tag._id}
                  href={`/biblioteca?tag=${encodeURIComponent(tag.slug.current)}`}
                  className="py-1 font-label text-[13px] font-semibold lowercase text-accent/70 transition-colors duration-fast ease-out-brand hover:text-accent"
                >
                  #{tag.name}
                </Link>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* ── Section nav ──────────────────────────────────────────────────── */}
      {sections.length > 1 && (
        <SectionNav sections={sections} practice={{ title: post.title, bpm, track: firstTrack }} />
      )}

      {/* ── Content ──────────────────────────────────────────────────────── */}
      <div
        className={
          hasLyrics
            ? "mx-auto max-w-7xl px-6 pb-8 pt-10 lg:grid lg:grid-cols-[minmax(0,34rem)_minmax(0,1fr)] lg:items-start lg:gap-x-24"
            : "mx-auto max-w-7xl px-6 pb-8 pt-10 lg:[&>*]:max-w-3xl"
        }
      >

        {/* `sections` is already the list of what will paint, so it answers this
            exactly. A song with no audio, tutorials, references, lyrics or
            history used to render the hero over an empty box — the page looked
            half-loaded rather than empty, and ~15 songs have no lyrics source in
            the catalogue at all, so this is a real state, not a hypothetical. */}
        {sections.length === 0 && (
          <div className="flex flex-col items-center gap-3 py-16 text-ink-muted">
            <svg width="44" height="44" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M9 18V5l12-2v13" />
              <circle cx="6" cy="18" r="3" /><circle cx="18" cy="16" r="3" />
            </svg>
            <p className="text-center font-body text-[17px] font-semibold text-ink">Esta canción aún no tiene contenido</p>
            <p className="max-w-sm text-center font-body text-sm text-ink-muted">
              Todavía no hay audio, tutoriales, referencias, letra ni historial para mostrar.
            </p>
          </div>
        )}

        {/* Ensayo */}
        {hasRehearsal && (
          <section id="ensayo" className={side}>
            <SectionHeader>Ensayo</SectionHeader>
            <RehearsalPlayer
              mixes={post.rehearsalMixes!}
              songId={post._id}
              songTitle={post.title}
              songSlug={post.slug.current}
              preselect={myInstruments}
            />
          </section>
        )}

        {/* Audio */}
        {hasAudio && (
          <section id="audio" className={side}>
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
          <section id="tutoriales" className={side}>
            <SectionHeader>Tutoriales</SectionHeader>
            <div className="grid grid-cols-1 gap-6 sm:grid-cols-2">
              {post.tutorials2!.filter((tutorial) => tutorial.url).map((tutorial, i) => (
                <div key={i} {...revealProps(i)}>
                  <div className="aspect-video overflow-hidden rounded-xl">
                    <TutorialPoster url={tutorial.url} title={tutorial.title} />
                  </div>
                  {tutorial.title && (
                    <p className="mt-2 font-body text-[17px] font-semibold leading-snug text-ink">{tutorial.title}</p>
                  )}
                </div>
              ))}
            </div>
          </section>
        )}

        {/* Reference Links */}
        {hasRefLinks && (
          <section id="referencia" className={side}>
            <SectionHeader>Referencia</SectionHeader>
            <ul className="divide-y divide-ink/[0.10] border-y border-ink/[0.10]">
              {(post.musicalReferenceUrl || (post.referenceLinks?.[0]?.url)) && (
                <li>
                  <a href={post.musicalReferenceUrl || post.referenceLinks![0].url}
                    target="_blank" rel="noopener noreferrer"
                    className="group flex items-center gap-3.5 py-3 text-ink">
                    <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-accent/[0.12] text-accent">
                      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M9 18V5l12-2v13" /><circle cx="6" cy="18" r="3" /><circle cx="18" cy="16" r="3" /></svg>
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block font-body text-[17px] font-semibold leading-snug transition-colors group-hover:text-accent">Referencia musical</span>
                      <span className="block font-body text-sm text-ink-muted">Para ensayar · músicos</span>
                    </span>
                    <ExternalLinkIcon size={18} className="shrink-0 text-ink-muted" />
                  </a>
                </li>
              )}
              {post.lyricsVideoUrl && (
                <li>
                  <a href={post.lyricsVideoUrl}
                    target="_blank" rel="noopener noreferrer"
                    className="group flex items-center gap-3.5 py-3 text-ink">
                    <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-accent/[0.12] text-accent">
                      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3z" /><path d="M19 10v2a7 7 0 0 1-14 0v-2" /><line x1="12" y1="19" x2="12" y2="22" /></svg>
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block font-body text-[17px] font-semibold leading-snug transition-colors group-hover:text-accent">Versión con letra</span>
                      <span className="block font-body text-sm text-ink-muted">Letra en español</span>
                    </span>
                    <ExternalLinkIcon size={18} className="shrink-0 text-ink-muted" />
                  </a>
                </li>
              )}
            </ul>
          </section>
        )}

        {/* Letra / Body — 17 px on the page itself, no panel: it is what a
            member reads mid-rehearsal with one hand busy. */}
        {hasLyrics && (
          <section id="letra" className={LYRIC}>
            <SectionHeader action={<LyricsAutoscroll targetId="letra" bpm={bpm} lines={lyricLines} />}>Letra</SectionHeader>
            {hasInlineChords ? (
              <ChordChart charts={post.chords!} />
            ) : (
              <div className="max-w-[62ch] font-body text-[17px] leading-relaxed text-ink [&>div:first-child>div:first-child]:!mt-0">
                {groupBySections(post.body).map((group, i) => (
                  <div key={i}>
                    <PortableText value={group} components={myPortableTextComponents} />
                  </div>
                ))}
              </div>
            )}
          </section>
        )}

        {/* Historial — one row per play: the day, the set it shared, the key. */}
        {hasHistory && (
          <section id="historial" className={side}>
            <SectionHeader>Última vez tocada</SectionHeader>
            <ol className="divide-y divide-ink/[0.10] border-y border-ink/[0.10]">
              {history.map((entry, i) => (
                <li key={i} {...revealProps(i)} className="flex items-center gap-4 py-3.5">
                  <div className="min-w-0 flex-1">
                    <p className="font-body text-[17px] font-semibold leading-snug text-ink">
                      {entry._type === "featuredSongs" ? "Domingo" : "Sábado"}{" "}
                      {formatHistoryDate(entry.week)}
                    </p>
                    {entry.pairedSongs?.length > 0 && (
                      <p className="mt-0.5 font-body text-sm leading-snug text-ink-muted">
                        Con{" "}
                        {entry.pairedSongs.map((song, j) => (
                          <Fragment key={j}>
                            {j > 0 && (j === entry.pairedSongs.length - 1 ? " y " : ", ")}
                            <Link href={`/posts/${song.slug.current}`} className="font-semibold transition-colors hover:text-accent">
                              {song.title}
                            </Link>
                          </Fragment>
                        ))}
                      </p>
                    )}
                  </div>
                  {entry.play_key && (
                    <span className="shrink-0 rounded-full border border-ink/[0.18] px-2.5 py-1 font-label text-sm font-semibold text-key-fg">
                      {formatKey(entry.play_key)}
                    </span>
                  )}
                </li>
              ))}
            </ol>
          </section>
        )}

      </div>

      </TransposeProvider>
    </div>
  );
};

export default Page;

const myPortableTextComponents: PortableTextComponents = {
  block: {
    // Section names render as an EYEBROW, not a heading: they label blocks of a
    // lyric, while the page's outline is its SHEET_TITLE section headings.
    // No label is added — these are the headings the lyric sheet already carries.
    //
    // A `div`, because the wrapper's `[&>div:first-child>div:first-child]:!mt-0`
    // finds the first group's eyebrow by that shape. See LYRIC_EYEBROW_BLOCK.
    h1: ({ children }) => <div className={LYRIC_EYEBROW_BLOCK}>{children}</div>,
    h2: ({ children }) => <div className={LYRIC_EYEBROW_BLOCK}>{children}</div>,
    h3: ({ children }) => <div className={LYRIC_EYEBROW_BLOCK}>{children}</div>,
    h4: ({ children }) => <div className={LYRIC_EYEBROW_BLOCK}>{children}</div>,
    normal: ({ children }) => <p>{dimRepeatMarkers(children)}</p>,
  },
  types: {
    image: ({ value }) => (
      <Image
        src={urlFor(value).width(1400).fit("max").auto("format").url()}
        alt={typeof value?.alt === "string" ? value.alt : ""}
        width={700}
        height={700}
        className="rounded-xl"
      />
    ),
  },
};
