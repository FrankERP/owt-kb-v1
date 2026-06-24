"use client";

import { useState } from "react";

// Opens a YouTube playlist of the setlist's songs for personal practice.
// Two modes: "musica" (musical reference) or "letras" (Spanish lyrics, falling
// back to the musical reference per song).
export default function PracticePlaylistButton({ songIds, accent }: { songIds: string[]; accent: string }) {
  const [state, setState] = useState<"idle" | "loading" | "empty">("idle");
  const [open, setOpen] = useState(false);

  async function go(mode: "musica" | "letras") {
    setOpen(false);
    if (state === "loading") return;
    setState("loading");
    try {
      const res = await fetch("/api/practice-playlist", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ids: songIds, mode }),
      });
      const { url } = (await res.json()) as { url: string | null };
      if (url) { window.open(url, "_blank", "noopener"); setState("idle"); }
      else { setState("empty"); setTimeout(() => setState("idle"), 2500); }
    } catch { setState("idle"); }
  }

  const label = state === "loading" ? "Abriendo…" : state === "empty" ? "Sin videos" : "Practicar";

  return (
    <div className="relative inline-block">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        disabled={state === "loading"}
        aria-haspopup="menu"
        aria-expanded={open}
        title="Practicar el set en YouTube"
        style={{ color: accent, borderColor: `${accent}55`, background: `${accent}14` }}
        className="flex items-center gap-1.5 px-2 py-1 rounded-full border font-label text-[10px] uppercase tracking-widest transition-opacity hover:opacity-80 disabled:opacity-50"
      >
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0z" />
          <polygon points="10 8 16 12 10 16 10 8" fill="currentColor" stroke="none" />
        </svg>
        {label}
        <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <polyline points="6 9 12 15 18 9" />
        </svg>
      </button>

      {open && (
        <div role="menu" className="absolute right-0 z-20 mt-2 min-w-[220px] rounded-xl border border-[#00bfff]/25 bg-[#00162e] overflow-hidden shadow-lg">
          <button role="menuitem" type="button" onClick={() => go("musica")}
            className="flex w-full items-center gap-3 px-4 py-3 text-left hover:bg-[#00bfff]/10 transition-colors border-b border-[#00bfff]/10">
            <span className="font-label text-sm text-white">🎵 Música</span>
            <span className="font-body text-[11px] text-[#C8D8EB]/60">referencia musical</span>
          </button>
          <button role="menuitem" type="button" onClick={() => go("letras")}
            className="flex w-full items-center gap-3 px-4 py-3 text-left hover:bg-[#00bfff]/10 transition-colors">
            <span className="font-label text-sm text-white">🎤 Letras</span>
            <span className="font-body text-[11px] text-[#C8D8EB]/60">letra en español</span>
          </button>
        </div>
      )}
    </div>
  );
}
