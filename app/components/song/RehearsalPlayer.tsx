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
import { DownloadIcon } from "@/app/components/ui/icons";
import type { RehearsalMix } from "@/app/utils/interface";
import { groupMixes, mixLabel, mixTones, mixesForKey, preselectMix } from "@/app/utils/rehearsalMixes";
import { useTransposeOptional } from "./TransposeProvider";
import Waveform from "./Waveform";
import SeekBar from "./SeekBar";
import { formatKey } from "@/app/utils/formatKey";
import { semitonesBetween } from "@/app/utils/transpose";
import SegmentedControl from "@/app/components/ui/SegmentedControl";
import { formatClock } from "@/app/utils/formatClock";

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
  // ONE waveform on the page, the loaded row's (design pass E, 2026-10-22):
  // eight rows each with a 40px canvas made the list a wall and pushed the
  // second family below the fold. The canvas exists for the playhead and the
  // seek, and the accent «where my part sounds» spans need the track's
  // duration, which only the loaded file knows — an idle row's envelope would
  // be a picture with none of that, which is the cost the pass set out to cut.

  return (
    <div className="space-y-6">
      {/* The keys a song has mixes in, as the picker they already were in the
          hero (Frank, 2026-10-24: «no hay forma de cambiar de tono en la vista de
          ensayo»). It writes the SAME seat the hero dial writes, so the chart and
          the hero follow; pressed = the key whose rows are shown. */}
      {tones.length > 1 && shared?.soundingKey && shared.nativeKey && selection.tone && (
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
          <p className="font-body text-sm text-ink-muted" aria-live="polite">
            {selection.exact
              ? <>Tono {formatKey(selection.tone)} · mixes en</>
              : <>No hay mix en {formatKey(shared.soundingKey)} — se muestra {formatKey(selection.tone)} · mixes en</>}
          </p>
          <SegmentedControl
            size="sm"
            label="Tono del mix"
            value={selection.tone}
            onChange={(k) => shared.setSemitones(semitonesBetween(shared.nativeKey!, k))}
            options={tones.map((t) => ({
              value: t,
              label: <span className="normal-case">{formatKey(t)}</span>,
              ariaLabel: formatKey(t),
            }))}
          />
        </div>
      )}
      {groups.map((g) => (
        <div key={g.family} className="space-y-1.5">
          <p className="font-body text-sm text-ink-muted">{g.label}</p>
          {/* Rows on hairlines, not bordered modules (ADR-0070): the page is a
              sheet, and the one row that differs is the LOADED one — a filled
              play control, the clock after the key, and its seek control under
              the name. */}
          <ul className="divide-y divide-ink/[0.10] border-y border-ink/[0.10]">
            {g.mixes.map((m) => {
              const label = mixLabel(m);
              const current = isCurrent(m);
              const playing = current && player.isPlaying;
              const mine = highlighted === m._key;
              return (
                <li
                  key={m._key}
                  aria-label={label}
                  aria-current={mine ? "true" : undefined}
                  className="flex flex-col gap-1 py-2.5"
                >
                  <div className="flex items-center gap-3">
                    {/* Both controls keep the 44px hit box every playback control
                        has; the loaded row's play is FILLED (the house `cta`
                        fill, `roundCta`), an idle row's is a ring (`round`). */}
                    {current ? (
                      <Button
                        variant="roundCta"
                        onClick={() => play(m)}
                        aria-label={`${playing ? "Pausar" : "Reproducir"} ${label}`}
                      >
                        <PlayPauseGlyph playing={playing} size={14} />
                      </Button>
                    ) : (
                      <Button
                        variant="round"
                        onClick={() => play(m)}
                        aria-label={`Reproducir ${label}`}
                      >
                        <PlayPauseGlyph playing={false} size={14} />
                      </Button>
                    )}
                    <div className="min-w-0 flex-1">
                      <p className={`truncate font-body text-[17px] font-semibold leading-tight ${mine ? "text-accent" : "text-ink"}`}>{label}</p>
                      <p className="font-body text-sm text-ink-muted tabular-nums">
                        {formatKey(m.tone)}{m.bpm ? ` · ${m.bpm} BPM` : ""}
                        {current && time.duration > 0 ? ` · ${formatClock(time.current)} / ${formatClock(time.duration)}` : ""}
                      </p>
                    </div>
                    {playing && <Equalizer playing />}
                    {/* `download` is best-effort across the CDN redirect (cross-origin, so
                        the browser may ignore it); the route's `?download=1` → CDN `?dl=`
                        is what actually forces content-disposition and a saved file. */}
                    <a
                      href={`${urlFor(m)}?download=1`}
                      download
                      aria-label={`Descargar ${label}`}
                      title={`Descargar ${label}`}
                      className={buttonClass("icon", "lg")}
                    >
                      <DownloadIcon size={16} />
                    </a>
                  </div>
                  {/* ONE seek control on the page, the loaded row's: the envelope
                      when the mix has one (an isolated instrument, with the accent
                      spans where that part sounds), a plain seek bar when it does
                      not (the full-band mix carries no peaks). */}
                  {/* The indent lives on a wrapper, never on the seek control: the
                      control maps a click over its OWN box, so padding inside it
                      would seek ahead of the pointer. */}
                  {current && (
                    <div className="pl-14">
                      {m.kind === "up" && m.peaks ? (
                        <Waveform
                          peaks={m.peaks}
                          active={m.active}
                          duration={time.duration}
                          progress={progress}
                          label={`Onda ${label}`}
                          onSeek={seek}
                        />
                      ) : (
                        <SeekBar progress={progress} label={`Posición ${label}`} onSeek={seek} />
                      )}
                    </div>
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
