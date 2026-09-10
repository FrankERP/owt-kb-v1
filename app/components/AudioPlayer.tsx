"use client";

import { useState, useEffect } from "react";
import { usePlayer } from "@/app/context/PlayerContext";
import AudioTransport from "./AudioTransport";
import Presence from "./ui/Presence";

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
    </Presence>
  );
}
