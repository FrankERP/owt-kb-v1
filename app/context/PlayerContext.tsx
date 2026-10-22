"use client";

import { createContext, useContext, useState, useRef, useCallback, useMemo, useEffect, ReactNode } from "react";
import type { PortableTextBody, RehearsalMix } from "@/app/utils/interface";

export interface AudioTrack {
  url: string;
  title: string;
  tone?: string;
  songTitle: string;
  songSlug: string;
}

export interface SongSheetData {
  _id: string;
  title: string;
  author: string;
  slug: string;
  key: string;
  bpm?: string;
  timeSig?: string;
  _createdAt?: string;
  body?: PortableTextBody;
  chords?: { key: string; content: string }[];
  audioTracks?: { title: string; tone?: string; audioFileURL: string }[];
  rehearsalMixes?: RehearsalMix[];
  /** The viewer's declared instruments (`teamMembers.instruments`), for preselection. */
  myInstruments?: string[];
  chordsPDF?: { title: string; key: string; chordsURL: string }[];
  lyricsURL?: string;
  history?: SongHistoryEntry[];
}

export interface SongHistoryEntry {
  week: string;
  _type: "featuredSongs" | "saturdarSongs";
  play_key?: string;
  leaders?: { name?: string; photo?: string }[];
  setlist?: { id: string; title?: string; slug?: string; play_key?: string }[];
}

interface PlayerState {
  track: AudioTrack | null;
  isPlaying: boolean;
}

/** A run of tracks played one after another («Ensayar el setlist»). `null` = one track. */
export interface PlayerQueue {
  tracks: AudioTrack[];
  index: number;
}

interface PlayerContextValue {
  player: PlayerState;
  playTrack: (track: AudioTrack) => void;
  queue: PlayerQueue | null;
  /** Start a run at `index`; it advances by itself when each track ends. */
  playQueue: (tracks: AudioTrack[], index?: number) => void;
  /** Next (+1) or previous (-1) track of the run. Previous restarts the current
   *  track when more than 3 s of it have played — the convention every player
   *  keeps, so one press goes back to the top of the song. */
  skip: (delta: 1 | -1) => void;
  togglePlay: () => void;
  closePlayer: (fallback?: HTMLElement | null) => void;
  seek: (fraction: number) => void;
  getAudio: () => HTMLAudioElement | null;
  audioReady: boolean;
  sheet: SongSheetData | null;
  sheetLoading: boolean;
  sheetError: boolean;
  sheetPlayKey: string | null;
  openSheet: (songId: string, playKey?: string) => void;
  closeSheet: () => void;
}

const PlayerContext = createContext<PlayerContextValue | null>(null);

export function usePlayer() {
  const ctx = useContext(PlayerContext);
  if (!ctx) throw new Error("usePlayer must be inside PlayerProvider");
  return ctx;
}

export function PlayerProvider({ children }: { children: ReactNode }) {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const audioOriginRef = useRef<HTMLElement | null>(null);
  const sheetRequestRef = useRef<{ id: number; controller: AbortController | null }>({ id: 0, controller: null });
  const [player, setPlayer] = useState<PlayerState>({ track: null, isPlaying: false });
  const [queue, setQueue] = useState<PlayerQueue | null>(null);
  // The `ended` listener is registered once, so it reads the run through a ref.
  const queueRef = useRef<PlayerQueue | null>(null);
  const [audioReady, setAudioReady] = useState(false);
  const [sheet, setSheet] = useState<SongSheetData | null>(null);
  const [sheetLoading, setSheetLoading] = useState(false);
  const [sheetError, setSheetError] = useState(false);
  const [sheetPlayKey, setSheetPlayKey] = useState<string | null>(null);

  // Load and start one track. A refused `play()` (iOS outside a user gesture, a
  // failed load) leaves the transport showing ▶, never a ‖ over silence.
  const load = useCallback((track: AudioTrack) => {
    const el = audioRef.current;
    if (!el) return;
    el.src = track.url;
    setPlayer({ track, isPlaying: true });
    startPlayback(el, () => setPlayer(p => (p.track === track ? { ...p, isPlaying: false } : p)));
  }, []);

  const setRun = useCallback((next: PlayerQueue | null) => {
    queueRef.current = next;
    setQueue(next);
  }, []);

  // Advancing reuses the SAME <audio> element: a locked phone keeps playing the
  // run, where a fresh element would need a new tap.
  const advance = useCallback((delta: 1 | -1) => {
    const run = queueRef.current;
    if (!run) return false;
    const index = run.index + delta;
    if (index < 0 || index >= run.tracks.length) return false;
    setRun({ tracks: run.tracks, index });
    load(run.tracks[index]);
    return true;
  }, [load, setRun]);

  useEffect(() => {
    const el = new Audio();
    audioRef.current = el;
    setAudioReady(true);
    const onEnd = () => {
      if (!advance(1)) setPlayer(p => ({ ...p, isPlaying: false }));
    };
    el.addEventListener("ended", onEnd);
    return () => {
      el.removeEventListener("ended", onEnd);
      el.pause();
      setAudioReady(false);
      audioRef.current = null;
    };
  }, [advance]);

  const getAudio = useCallback(() => audioRef.current, []);

  // One track from a song's own list: whatever run was playing ends here.
  const playTrack = useCallback((track: AudioTrack) => {
    if (!audioRef.current) return;
    audioOriginRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    setRun(null);
    load(track);
  }, [load, setRun]);

  const playQueue = useCallback((tracks: AudioTrack[], index = 0) => {
    if (!audioRef.current || tracks.length === 0) return;
    const start = Math.min(Math.max(0, index), tracks.length - 1);
    audioOriginRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    setRun({ tracks, index: start });
    load(tracks[start]);
  }, [load, setRun]);

  const skip = useCallback((delta: 1 | -1) => {
    const el = audioRef.current;
    if (delta === -1 && el && el.currentTime > 3) {
      el.currentTime = 0;
      return;
    }
    advance(delta);
  }, [advance]);

  // Lock-screen and headphone controls for a run: ⏭/⏮ move through the set while
  // the phone is in a pocket. Absent APIs (older WebViews, jsdom) are a no-op.
  const hasRun = queue !== null;
  useEffect(() => {
    if (!hasRun || typeof navigator === "undefined" || !("mediaSession" in navigator)) return;
    const session = navigator.mediaSession;
    const set = (action: MediaSessionAction, handler: MediaSessionActionHandler | null) => {
      try { session.setActionHandler(action, handler); } catch { /* unsupported action */ }
    };
    set("nexttrack", () => skip(1));
    set("previoustrack", () => skip(-1));
    return () => {
      set("nexttrack", null);
      set("previoustrack", null);
    };
  }, [hasRun, skip]);

  useEffect(() => {
    if (!player.track || typeof navigator === "undefined" || !("mediaSession" in navigator)) return;
    if (typeof MediaMetadata === "undefined") return;
    try {
      navigator.mediaSession.metadata = new MediaMetadata({
        title: player.track.songTitle,
        artist: [player.track.title, player.track.tone].filter(Boolean).join(" · "),
      });
    } catch { /* unsupported */ }
  }, [player.track]);

  const togglePlay = useCallback(() => {
    const el = audioRef.current;
    if (!el || !player.track) return;
    if (player.isPlaying) {
      el.pause();
      setPlayer(p => ({ ...p, isPlaying: false }));
    } else {
      el.play().catch(() => {});
      setPlayer(p => ({ ...p, isPlaying: true }));
    }
  }, [player.track, player.isPlaying]);

  const closePlayer = useCallback((fallback?: HTMLElement | null) => {
    const el = audioRef.current;
    if (el) { el.pause(); el.src = ""; }
    setRun(null);
    setPlayer({ track: null, isPlaying: false });
    const origin = audioOriginRef.current;
    audioOriginRef.current = null;
    const target =
      focusableTarget(origin) ??
      focusableTarget(fallback) ??
      focusableTarget(document.querySelector<HTMLElement>("main[data-route-main]"));
    target?.focus?.({ preventScroll: true });
  }, [setRun]);

  const seek = useCallback((fraction: number) => {
    const el = audioRef.current;
    if (!el || !el.duration) return;
    el.currentTime = fraction * el.duration;
  }, []);

  const openSheet = useCallback(async (songId: string, playKey?: string) => {
    sheetRequestRef.current.controller?.abort();
    const controller = new AbortController();
    const id = sheetRequestRef.current.id + 1;
    sheetRequestRef.current = { id, controller };
    setSheet(null);
    setSheetError(false);
    setSheetLoading(true);
    setSheetPlayKey(playKey ?? null);
    try {
      const res = await fetch(`/api/song/${encodeURIComponent(songId)}`, { signal: controller.signal });
      if (sheetRequestRef.current.id !== id) return;
      if (res.ok) setSheet(await res.json());
      else setSheetError(true);
    } catch {
      if (controller.signal.aborted || sheetRequestRef.current.id !== id) return;
      setSheetError(true);
    } finally {
      if (sheetRequestRef.current.id === id) {
        setSheetLoading(false);
        sheetRequestRef.current.controller = null;
      }
    }
  }, []);

  const closeSheet = useCallback(() => {
    sheetRequestRef.current.controller?.abort();
    sheetRequestRef.current = { id: sheetRequestRef.current.id + 1, controller: null };
    setSheet(null);
    setSheetLoading(false);
    setSheetError(false);
    setSheetPlayKey(null);
  }, []);

  // Memoize the context value so a new identity is produced only when actual
  // player/sheet state changes — not on every provider render. Without this,
  // every consumer (all ~140 song cards) re-renders on any parent render. The
  // callbacks are already stable (useCallback), so only the state values matter.
  const value = useMemo(
    () => ({ player, playTrack, queue, playQueue, skip, togglePlay, closePlayer, seek, getAudio, audioReady, sheet, sheetLoading, sheetError, sheetPlayKey, openSheet, closeSheet }),
    [player, playTrack, queue, playQueue, skip, togglePlay, closePlayer, seek, getAudio, audioReady, sheet, sheetLoading, sheetError, sheetPlayKey, openSheet, closeSheet],
  );

  return (
    <PlayerContext.Provider value={value}>
      {children}
    </PlayerContext.Provider>
  );
}

function startPlayback(el: HTMLAudioElement, onRefused: () => void) {
  try {
    const started = el.play();
    if (started && typeof started.catch === "function") started.catch(onRefused);
  } catch {
    onRefused();
  }
}

function focusableTarget(target: HTMLElement | null | undefined) {
  if (!target || !target.isConnected) return null;
  if (target.hasAttribute("disabled") || target.getAttribute("aria-disabled") === "true") return null;
  return target;
}
