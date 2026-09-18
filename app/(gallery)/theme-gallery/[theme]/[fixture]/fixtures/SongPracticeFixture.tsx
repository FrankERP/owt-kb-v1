"use client";

// Song-practice fixture — the hero pill row, the transposer drawer and the chord
// chart, on the surface dev-verify screenshots for R4. Hermetic: no session, no
// fetch, no Sanity, no env, and no network of any kind.
//
// The two audio cards are real `SongAudioSection` cards, so they need a
// `PlayerProvider` (`usePlayer()` throws without one) and a track URL that
// resolves with the network unplugged — hence the inline data-URL WAV below,
// which is ~0.1 s of digital silence and the only "asset" this route carries.

import ChordChart from "@/app/components/ChordChart";
import SongAudioSection from "@/app/components/SongAudioSection";
import SongHeroPills from "@/app/components/song/SongHeroPills";
import { TransposeProvider } from "@/app/components/song/TransposeProvider";
import TutorialPoster from "@/app/components/song/TutorialPoster";
import { PlayerProvider } from "@/app/context/PlayerContext";
import { dimRepeatMarkers, LYRIC_EYEBROW_BLOCK } from "@/app/utils/lyricMarkers";

/** 0.1 s of 8 kHz mono PCM silence. Inline because the gallery has no network. */
const SILENT_WAV =
  "data:audio/wav;base64,UklGRkQDAABXQVZFZm10IBAAAAABAAEAQB8AAEAfAAABAAgAZGF0YSADAACAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgA==";

const CHART = `# Coro
[G]Santo, san[D]to, santo es el Se[Em]ñor
[C]Toda la tie[G]rra está llena de su glo[D]ria
[G]Digno, dig[D]no, digno es el Cor[Em]dero
[C]Cantaré por [G]siempre de su a[D]mor
[Em]Aleluya, a[C]leluya
[G]Aleluya, a[D]mén`;

const TRACKS = [
  { title: "Pista guía", tone: "Sol", audioFileURL: SILENT_WAV },
  { title: "Referencia original", tone: "La", audioFileURL: SILENT_WAV },
];

const TAGS = ["adoración", "santidad", "congregacional"];

export function SongPracticeFixture() {
  return (
    <PlayerProvider>
      <TransposeProvider nativeKey="G">
        <div className="space-y-10">
          <div id="song-hero" className="brand-song-hero -mx-6">
            <div className="relative mx-auto flex max-w-7xl flex-col items-center px-6 pb-14 pt-12 text-center sm:pb-16 sm:pt-16">
              <div className="mb-6 flex flex-wrap justify-center gap-2">
                {TAGS.map((tag) => (
                  <span
                    key={tag}
                    className="rounded-md border border-accent/15 bg-accent/[0.055] px-2.5 py-1.5 font-label text-[10px] lowercase tracking-wider text-accent/70"
                  >
                    #{tag}
                  </span>
                ))}
              </div>

              <h1 className="max-w-4xl text-balance break-words font-display text-3xl font-semibold leading-[0.98] text-ink sm:text-5xl lg:text-6xl">
                Canción de muestra
              </h1>

              <p className="mb-9 mt-4 font-body text-lg text-ink-dim">Autor de muestra</p>

              <SongHeroPills keyLabel="G" bpm={120} timeSig="4/4" transposable />
            </div>
          </div>

          <ChordChart charts={[{ key: "G", content: CHART }]} />

          <SongAudioSection tracks={TRACKS} songTitle="Canción de muestra" songSlug="cancion-de-muestra" />

          {/* R6: the tutorial poster (nothing loads until the button is pressed) and
              the lyric block's two typographic rules — the eyebrow and the dimmed
              repeat marker — are verified here in both themes. The poster is a
              static image URL, which is not a fetch: the fixture stays hermetic. */}
          <div className="brand-surface overflow-hidden rounded-2xl">
            <div className="aspect-video">
              <TutorialPoster url="https://www.youtube.com/embed/dQw4w9WgXcQ" title="Tutorial de ejemplo" />
            </div>
          </div>

          {/* The wrapper class string is the song page's, character for character:
              the eyebrow's margins only survive because they sit on a `div` rather
              than a `p` the `prose-p:` variants would zero, and a fixture with a
              different wrapper would not reproduce that cascade at all. */}
          <div className="prose prose-sm sm:prose dark:prose-invert prose-p:leading-relaxed prose-p:!mt-0 prose-p:!mb-0 max-w-[62ch] mx-auto [&>div:first-child>div:first-child]:!mt-0">
            {/* Two GROUPS, because `groupBySections` produces one wrapper div per
                section and that nesting is exactly what the wrapper's
                `[&>div:first-child>div:first-child]` clause selects against: only
                the first group's eyebrow sits flush, the second keeps its margin. */}
            <div>
              <div className={LYRIC_EYEBROW_BLOCK}>Coro</div>
              <p>{dimRepeatMarkers("Santo, santo // es el Señor //")}</p>
            </div>
            <div>
              <div className={LYRIC_EYEBROW_BLOCK}>Verso</div>
              <p>{dimRepeatMarkers("Digno es el Cordero // amén //")}</p>
            </div>
          </div>
        </div>
      </TransposeProvider>
    </PlayerProvider>
  );
}
