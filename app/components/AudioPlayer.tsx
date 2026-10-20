"use client";

import { useState, useEffect, useRef } from "react";
import { usePlayer } from "@/app/context/PlayerContext";
import AudioTransport from "./AudioTransport";
import Presence from "./ui/Presence";

/** The transport's MEASURED height, published on <html> while it shows, so a fixed-bottom element
 *  that must sit above it (the assistant bubble) clears it the way everything clears the tab bar. */
export const AUDIO_H_VAR = "--audio-player-h";

export default function AudioPlayer() {
  const { player, togglePlay, closePlayer, seek, getAudio, audioReady, sheet, sheetLoading, sheetError } = usePlayer();
  const [progress, setProgress]     = useState(0);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration]     = useState(0);

  useEffect(() => {
    if (!audioReady) return;
    const el = getAudio();
    if (!el) return;
    const onTime = () => {
      if (el.duration) {
        const pct = el.currentTime / el.duration;
        setProgress(pct);
        setCurrentTime(el.currentTime);
        setDuration(el.duration);
      }
    };
    const onMeta = () => setDuration(el.duration || 0);
    el.addEventListener("timeupdate", onTime);
    el.addEventListener("loadedmetadata", onMeta);
    return () => {
      el.removeEventListener("timeupdate", onTime);
      el.removeEventListener("loadedmetadata", onMeta);
    };
  }, [audioReady, getAudio]);

  useEffect(() => {
    if (!player.track) { setProgress(0); setCurrentTime(0); setDuration(0); }
  }, [player.track]);

  const visible = !!player.track && !sheet && !sheetLoading && !sheetError;
  const bodyRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const root = document.documentElement;
    const body = bodyRef.current;
    if (!visible || !body) {
      root.style.removeProperty(AUDIO_H_VAR);
      return;
    }
    const publish = () => root.style.setProperty(AUDIO_H_VAR, `${body.offsetHeight}px`);
    publish();
    const ro = typeof ResizeObserver !== "undefined" ? new ResizeObserver(publish) : null;
    ro?.observe(body);
    return () => {
      ro?.disconnect();
      root.style.removeProperty(AUDIO_H_VAR);
    };
  }, [visible]);

  return (
    <Presence
      show={visible}
      appear
      variant="sheet"
      className="audio-player fixed inset-x-0 z-40 bg-surface-raised-alt/95 backdrop-blur-md border-t border-accent/20 shadow-lg"
      style={{ bottom: "var(--bottom-nav-h, 0px)" }}
    >
      {/* Presence keeps rendering this last-committed subtree while it exits, so
          `player.track` never goes null mid-fade — but guard anyway: it stays the
          cheapest way to satisfy the type checker without a stale-track ref. */}
      <div ref={bodyRef}>
      {player.track && (
        <AudioTransport
          track={player.track}
          isPlaying={player.isPlaying}
          currentTime={currentTime}
          duration={duration}
          progress={progress}
          onToggle={togglePlay}
          onSeek={seek}
          onClose={() => closePlayer()}
        />
      )}
      </div>
    </Presence>
  );
}
