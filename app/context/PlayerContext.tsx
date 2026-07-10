"use client";

import { createContext, useContext, useState, useRef, useCallback, useMemo, useEffect, ReactNode } from "react";

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
  body?: any[];
  chords?: { key: string; content: string }[];
  audioTracks?: { title: string; tone?: string; audioFileURL: string }[];
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

interface PlayerContextValue {
  player: PlayerState;
  playTrack: (track: AudioTrack) => void;
  togglePlay: () => void;
  closePlayer: () => void;
  seek: (fraction: number) => void;
  getAudio: () => HTMLAudioElement | null;
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
  const [player, setPlayer] = useState<PlayerState>({ track: null, isPlaying: false });
  const [sheet, setSheet] = useState<SongSheetData | null>(null);
  const [sheetLoading, setSheetLoading] = useState(false);
  const [sheetError, setSheetError] = useState(false);
  const [sheetPlayKey, setSheetPlayKey] = useState<string | null>(null);

  useEffect(() => {
    const el = new Audio();
    audioRef.current = el;
    const onEnd = () => setPlayer(p => ({ ...p, isPlaying: false }));
    el.addEventListener("ended", onEnd);
    return () => {
      el.removeEventListener("ended", onEnd);
      el.pause();
    };
  }, []);

  const getAudio = useCallback(() => audioRef.current, []);

  const playTrack = useCallback((track: AudioTrack) => {
    const el = audioRef.current;
    if (!el) return;
    el.src = track.url;
    el.play().catch(() => {});
    setPlayer({ track, isPlaying: true });
  }, []);

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

  const closePlayer = useCallback(() => {
    const el = audioRef.current;
    if (el) { el.pause(); el.src = ""; }
    setPlayer({ track: null, isPlaying: false });
  }, []);

  const seek = useCallback((fraction: number) => {
    const el = audioRef.current;
    if (!el || !el.duration) return;
    el.currentTime = fraction * el.duration;
  }, []);

  const openSheet = useCallback(async (songId: string, playKey?: string) => {
    setSheet(null);
    setSheetError(false);
    setSheetLoading(true);
    setSheetPlayKey(playKey ?? null);
    try {
      const res = await fetch(`/api/song/${encodeURIComponent(songId)}`);
      if (res.ok) setSheet(await res.json());
      else setSheetError(true);
    } catch {
      setSheetError(true);
    } finally {
      setSheetLoading(false);
    }
  }, []);

  const closeSheet = useCallback(() => {
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
    () => ({ player, playTrack, togglePlay, closePlayer, seek, getAudio, sheet, sheetLoading, sheetError, sheetPlayKey, openSheet, closeSheet }),
    [player, playTrack, togglePlay, closePlayer, seek, getAudio, sheet, sheetLoading, sheetError, sheetPlayKey, openSheet, closeSheet],
  );

  return (
    <PlayerContext.Provider value={value}>
      {children}
    </PlayerContext.Provider>
  );
}
