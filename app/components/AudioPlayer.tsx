"use client";

import { useState, useEffect } from "react";
import { usePlayer } from "@/app/context/PlayerContext";
import AudioTransport from "./AudioTransport";

export default function AudioPlayer() {
  const { player, togglePlay, closePlayer, seek, getAudio, audioReady } = usePlayer();
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

  if (!player.track) return null;

  const { track, isPlaying } = player;

  return (
    <div
      className="fixed bottom-0 inset-x-0 z-40 bg-[#0a1929]/95 backdrop-blur-md border-t border-[#00bfff]/20 shadow-lg"
      style={{ paddingBottom: "env(safe-area-inset-bottom)" }}
    >
      <AudioTransport
        track={track}
        isPlaying={isPlaying}
        currentTime={currentTime}
        duration={duration}
        progress={progress}
        onToggle={togglePlay}
        onSeek={seek}
        onClose={() => closePlayer()}
      />
    </div>
  );
}
