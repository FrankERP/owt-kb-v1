"use client";

import { createContext, useContext, useState, useRef, useCallback, useEffect, ReactNode } from "react";

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
  audioTracks?: { title: string; tone?: string; audioFileURL: string }[];
  chordsPDF?: { title: string; key: string; chordsURL: string }[];
  lyricsURL?: string;
}

interface PlayerState {
  track: AudioTrack | null;
  isPlaying: boolean;
  progress: number;
}

interface PlayerContextValue {
  player: PlayerState;
  playTrack: (track: AudioTrack) => void;
  togglePlay: () => void;
  closePlayer: () => void;
  seek: (fraction: number) => void;
  sheet: SongSheetData | null;
  sheetLoading: boolean;
  openSheet: (songId: string) => void;
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
  const [player, setPlayer] = useState<PlayerState>({ track: null, isPlaying: false, progress: 0 });
  const [sheet, setSheet] = useState<SongSheetData | null>(null);
  const [sheetLoading, setSheetLoading] = useState(false);

  useEffect(() => {
    const el = new Audio();
    audioRef.current = el;
    const onTime = () => {
      if (el.duration) setPlayer(p => ({ ...p, progress: el.currentTime / el.duration }));
    };
    const onEnd = () => setPlayer(p => ({ ...p, isPlaying: false, progress: 0 }));
    el.addEventListener("timeupdate", onTime);
    el.addEventListener("ended", onEnd);
    return () => {
      el.removeEventListener("timeupdate", onTime);
      el.removeEventListener("ended", onEnd);
      el.pause();
    };
  }, []);

  const playTrack = useCallback((track: AudioTrack) => {
    const el = audioRef.current;
    if (!el) return;
    el.src = track.url;
    el.play().catch(() => {});
    setPlayer({ track, isPlaying: true, progress: 0 });
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
    setPlayer({ track: null, isPlaying: false, progress: 0 });
  }, []);

  const seek = useCallback((fraction: number) => {
    const el = audioRef.current;
    if (!el || !el.duration) return;
    el.currentTime = fraction * el.duration;
    setPlayer(p => ({ ...p, progress: fraction }));
  }, []);

  const openSheet = useCallback(async (songId: string) => {
    setSheet(null);
    setSheetLoading(true);
    try {
      const res = await fetch(`/api/song/${encodeURIComponent(songId)}`);
      if (res.ok) setSheet(await res.json());
    } finally {
      setSheetLoading(false);
    }
  }, []);

  const closeSheet = useCallback(() => {
    setSheet(null);
    setSheetLoading(false);
  }, []);

  return (
    <PlayerContext.Provider value={{ player, playTrack, togglePlay, closePlayer, seek, sheet, sheetLoading, openSheet, closeSheet }}>
      {children}
    </PlayerContext.Provider>
  );
}
