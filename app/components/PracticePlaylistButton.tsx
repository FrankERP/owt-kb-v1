"use client";

import { useState } from "react";

// Opens a YouTube playlist of the setlist's songs for personal practice.
export default function PracticePlaylistButton({ songIds, accent }: { songIds: string[]; accent: string }) {
  const [state, setState] = useState<"idle" | "loading" | "empty">("idle");

  async function open() {
    if (state === "loading") return;
    setState("loading");
    try {
      const res = await fetch("/api/practice-playlist", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ids: songIds }),
      });
      const { url } = (await res.json()) as { url: string | null };
      if (url) {
        window.open(url, "_blank", "noopener");
        setState("idle");
      } else {
        setState("empty");
        setTimeout(() => setState("idle"), 2500);
      }
    } catch {
      setState("idle");
    }
  }

  return (
    <button
      type="button"
      onClick={open}
      disabled={state === "loading"}
      title="Abrir las canciones del set en una playlist de YouTube para practicar"
      className="flex items-center gap-1 font-label text-[10px] uppercase tracking-widest text-gray-500 hover:text-[#00bfff] transition-colors disabled:opacity-50"
    >
      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0z" />
        <polygon points="10 8 16 12 10 16 10 8" fill="currentColor" stroke="none" />
      </svg>
      {state === "loading" ? "Abriendo…" : state === "empty" ? "Sin videos" : "Practicar"}
    </button>
  );
}
