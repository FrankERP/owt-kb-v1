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
import RehearsalPlayer from "@/app/components/song/RehearsalPlayer";
import SongAudioSection from "@/app/components/SongAudioSection";
import SongHeroPills from "@/app/components/song/SongHeroPills";
import { TransposeProvider } from "@/app/components/song/TransposeProvider";
import TutorialPoster from "@/app/components/song/TutorialPoster";
import { PlayerProvider } from "@/app/context/PlayerContext";
import { SHEET_TITLE } from "@/app/utils/homeHero";
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

/** Two rehearsal rows with a synthetic envelope: no network, no session. */
const PEAKS = Array.from({ length: 600 }, (_, i) => (i > 120 && i < 420 ? 40 + Math.round(200 * Math.abs(Math.sin(i / 9))) : 8));
// The player's play/download controls resolve to `/api/audio/gallery/…`, which
// answers 403 on the public gallery route (no session) — that's fine, this
// block is for LOOKING, not for playing, and the fixture stays hermetic.
const MIXES = [
  { _key: "g-full", kind: "full" as const, tone: "Sol", sourceHash: "gallery" },
  { _key: "g-eg1", kind: "up" as const, track: "EG 1", family: "electric", tone: "Sol", bpm: 120, peaks: PEAKS, active: [{ _key: "a0", s: 12, e: 42 }], sourceHash: "gallery" },
];

export function SongPracticeFixture() {
  return (
    <PlayerProvider>
      <TransposeProvider nativeKey="G">
        <div className="space-y-10">
          {/* The song page's hero since ADR-0070's Canción pass: a title on the
              plain page (no painted band, no centred stack), the original title
              and the authors on one muted line, the 48 px ring pills, then the
              tags as quiet lowercase links. */}
          <div id="song-hero">
            <h1 className="max-w-4xl text-balance break-words font-display text-[2.875rem] font-semibold leading-[0.98] tracking-tight text-ink md:text-[4.75rem]">
              Canción de muestra
            </h1>
            <p className="mt-4 font-body text-[17px] leading-snug text-ink-muted md:text-xl">Sample Song · Autor de muestra</p>
            <div className="mt-6">
              <SongHeroPills keyLabel="G" bpm={120} timeSig="4/4" transposable />
            </div>
            <div className="mt-5 flex flex-wrap gap-x-3.5 gap-y-1.5">
              {TAGS.map((tag) => (
                <span key={tag} className="py-1 font-label text-[13px] font-semibold lowercase text-accent/70">
                  #{tag}
                </span>
              ))}
            </div>
          </div>

          <ChordChart charts={[{ key: "G", content: CHART }]} />

          <SongAudioSection tracks={TRACKS} songTitle="Canción de muestra" songSlug="cancion-de-muestra" />

          <section className="space-y-4">
            <h2 className={SHEET_TITLE}>Ensayo</h2>
            <RehearsalPlayer mixes={MIXES} songId="gallery" songTitle="Santo" songSlug="santo" preselect={["EG"]} />
          </section>

          {/* R6: the tutorial poster (no PLAYER loads until the button is pressed) and
              the lyric block's two typographic rules — the eyebrow and the dimmed
              repeat marker — are verified here in both themes.

              THE POSTER IS THE ONE NON-HERMETIC THING IN THE WHOLE GALLERY, and it is
              worth knowing about: `TutorialPoster` renders YouTube's own still through
              `next/image`, so the SERVER fetches `i.ytimg.com` on render. Measured, that
              made the `dark/song` baseline differ from itself by 15% of all pixels
              between two consecutive runs — the poster had arrived in one and not the
              other. It cannot be fixed here: the poster URL is built inside the
              production component from the video id. So `e2e/theme-gallery/gallery.spec.ts`
              fulfils `/_next/image` and `i.ytimg.com` with a fixed tile, and the baseline
              stops being a race against a CDN. */}
          <div className="brand-surface overflow-hidden rounded-2xl">
            <div className="aspect-video">
              <TutorialPoster url="https://www.youtube.com/embed/dQw4w9WgXcQ" title="Tutorial de ejemplo" />
            </div>
          </div>

          {/* The wrapper class string is the song page's, character for character
              (17 px body, no `prose` since ADR-0070): the eyebrow sits on a `div`
              so the `[&>div:first-child>div:first-child]` clause can find it, and
              a fixture with a different wrapper would not reproduce that cascade. */}
          <div className="max-w-[62ch] font-body text-[17px] leading-relaxed text-ink [&>div:first-child>div:first-child]:!mt-0">
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
