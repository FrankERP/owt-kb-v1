"use client";

// The rehearsal player (spec 2026-09-20-rehearsal-mixes §8.2). Presentational:
// mixes and the viewer's instruments arrive as props, so the song page (a
// Server Component) can render it and the theme-gallery fixture can host it
// with inline data. ONE <audio>, the app's, through PlayerContext — the fixed
// AudioTransport keeps working unchanged. Every URL on the page is the
// session-gated route, never cdn.sanity.io (decision D2).
import { useEffect, useMemo, useRef, useState } from "react";
import { usePlayer, type AudioTrack } from "@/app/context/PlayerContext";
import Equalizer from "@/app/components/ui/Equalizer";
import PlayPauseGlyph from "@/app/components/ui/PlayPauseGlyph";
import Button, { buttonClass } from "@/app/components/ui/Button";
import type { RehearsalMix } from "@/app/utils/interface";
import { groupMixes, mixLabel, mixTones, mixesForKey, preselectMix } from "@/app/utils/rehearsalMixes";
import { useTransposeOptional } from "./TransposeProvider";
import Waveform from "./Waveform";

export default function RehearsalPlayer({
  mixes, songId, songTitle, songSlug, preselect,
}: {
  mixes: RehearsalMix[];
  songId: string;
  songTitle: string;
  songSlug: string;
  preselect?: string[] | null;
}) {
  const { player, playTrack, togglePlay, seek, getAudio } = usePlayer();
  // The KEY is the hero dial's (`SongHeroPills` is the one 12-key picker): the
  // rows are the mixes rendered in the sounding key, or the nearest key when
  // that one was never rendered — the caption says which. Outside a provider
  // (the gallery fixture) every key's rows show.
  const shared = useTransposeOptional();
  const tones = useMemo(() => mixTones(mixes), [mixes]);
  const selection = useMemo(
    () => (shared ? mixesForKey(mixes, shared.soundingKey) : { tone: null, exact: true, mixes }),
    [mixes, shared],
  );
  const shown = selection.mixes;
  const groups = useMemo(() => groupMixes(shown), [shown]);
  const highlighted = useMemo(() => preselectMix(shown, preselect)?._key ?? null, [shown, preselect]);
  const [time, setTime] = useState({ current: 0, duration: 0 });
  // The one in-flight "restore the position on the next loadedmetadata" — a
  // second switch before the first mix has loaded must cancel the first
  // restore, or both once-listeners fire on the THIRD track's loadedmetadata
  // and the stale (second) value wins over the real (first) position.
  const pendingRestore = useRef<(() => void) | null>(null);

  // Playhead: follow the app's <audio> while one of OUR tracks is loaded.
  useEffect(() => {
    const el = getAudio();
    if (!el) return;
    const tick = () => setTime({ current: el.currentTime || 0, duration: el.duration || 0 });
    el.addEventListener("timeupdate", tick);
    el.addEventListener("loadedmetadata", tick);
    return () => {
      el.removeEventListener("timeupdate", tick);
      el.removeEventListener("loadedmetadata", tick);
      if (pendingRestore.current) {
        el.removeEventListener("loadedmetadata", pendingRestore.current);
        pendingRestore.current = null;
      }
    };
  }, [getAudio]);

  const urlFor = (m: RehearsalMix) => `/api/audio/${encodeURIComponent(songId)}/${encodeURIComponent(m._key)}`;
  const isCurrent = (m: RehearsalMix) => player.track?.url === urlFor(m);
  const anyCurrent = mixes.some(isCurrent);

  const play = (m: RehearsalMix) => {
    if (isCurrent(m)) { togglePlay(); return; }
    // Switching keeps the position: read before the src changes, restore once
    // the new file knows its duration.
    const el = getAudio();
    const resumeAt = anyCurrent && el ? el.currentTime : 0;
    // Cancel a still-pending restore from an earlier switch before starting
    // this one — otherwise both once-listeners would fire on THIS track's
    // loadedmetadata (in registration order) and the stale one wins.
    if (el && pendingRestore.current) {
      el.removeEventListener("loadedmetadata", pendingRestore.current);
      pendingRestore.current = null;
    }
    const track: AudioTrack = { url: urlFor(m), title: mixLabel(m), tone: m.tone, songTitle, songSlug };
    playTrack(track);
    if (el && resumeAt > 0) {
      const restore = () => { el.currentTime = resumeAt; pendingRestore.current = null; };
      pendingRestore.current = restore;
      el.addEventListener("loadedmetadata", restore, { once: true });
    }
  };

  // Turning the dial while one of our rows plays carries THAT track into the
  // new key at the same position — `play` already keeps the position across a
  // switch. Nothing plays that was not playing: a paused row stays paused and
  // simply drops out of the list. It fires on a CHANGE of the selected key only,
  // never on mount: coming back to the song remounts the provider at 0
  // semitones while an Ab row may still be playing, and that is the member's
  // choice, not a dial turn. A ref of the last seen key (not a "mounted" flag)
  // so StrictMode's second effect run in dev is a no-op too.
  const currentKey = player.track?.url;
  const lastTone = useRef(selection.tone);
  useEffect(() => {
    if (lastTone.current === selection.tone) return;
    lastTone.current = selection.tone;
    if (!currentKey || !player.isPlaying) return;
    const current = mixes.find((m) => currentKey === urlFor(m));
    if (!current || shown.includes(current)) return;
    const twin = shown.find((m) => m.kind === current.kind && (m.kind === "full" || m.track === current.track));
    if (twin) play(twin);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- keyed on the selected tone only: a play-state change must not re-fire
  }, [selection.tone]);

  if (mixes.length === 0) return null;

  const progress = time.duration > 0 ? Math.min(1, time.current / time.duration) : 0;

  return (
    <div className="space-y-6">
      {tones.length > 1 && shared?.soundingKey && selection.tone && (
        <p className="font-label text-[11px] uppercase tracking-widest text-mono-500" aria-live="polite">
          {selection.exact
            ? <>Tono {selection.tone} · hay mixes en {tones.join(", ")}</>
            : <>No hay mix en {shared?.soundingKey} — se muestra {selection.tone} · hay mixes en {tones.join(", ")}</>}
        </p>
      )}
      {groups.map((g) => (
        <div key={g.family} className="space-y-2">
          <p className="font-label text-[11px] uppercase tracking-widest text-mono-500">{g.label}</p>
          <ul className="space-y-2">
            {g.mixes.map((m) => {
              const label = mixLabel(m);
              const current = isCurrent(m);
              const playing = current && player.isPlaying;
              return (
                <li
                  key={m._key}
                  aria-label={label}
                  aria-current={highlighted === m._key ? "true" : undefined}
                  className={`brand-library-module flex flex-col gap-2 px-4 py-3 ${
                    current ? "border-accent/50 bg-accent/10" : highlighted === m._key ? "border-accent/30" : "border-accent-deep/30"
                  }`}
                >
                  <div className="flex items-center gap-3">
                    <Button
                      variant="icon"
                      size="lg"
                      onClick={() => play(m)}
                      aria-label={`${playing ? "Pausar" : "Reproducir"} ${label}`}
                    >
                      <PlayPauseGlyph playing={playing} size={16} />
                    </Button>
                    <div className="min-w-0 flex-1">
                      <p className="font-body text-sm font-semibold truncate">{label}</p>
                      <p className="font-label text-[11px] uppercase tracking-widest text-mono-500">
                        {m.tone}{m.bpm ? ` · ${m.bpm} BPM` : ""}
                      </p>
                    </div>
                    <Equalizer playing={playing} />
                    {/* `download` is best-effort across the CDN redirect (cross-origin, so
                        the browser may ignore it); the route's `?download=1` → CDN `?dl=`
                        is what actually forces content-disposition and a saved file. */}
                    <a
                      href={`${urlFor(m)}?download=1`}
                      download
                      aria-label={`Descargar ${label}`}
                      className={buttonClass("ghost", "sm")}
                    >
                      Descargar
                    </a>
                  </div>
                  {m.kind === "up" && m.peaks && (
                    <Waveform
                      peaks={m.peaks}
                      active={m.active}
                      duration={current ? time.duration : 0}
                      progress={current ? progress : 0}
                      label={`Onda ${label}`}
                      onSeek={current ? seek : undefined}
                    />
                  )}
                </li>
              );
            })}
          </ul>
        </div>
      ))}
    </div>
  );
}
