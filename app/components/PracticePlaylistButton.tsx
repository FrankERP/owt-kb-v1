"use client";

import { useCallback, useEffect, useId, useRef, useState } from "react";

type PracticeMode = "musica" | "letras";
type PracticeState = "idle" | "loading" | "empty" | "blocked" | "error";

// Opens a YouTube playlist of the setlist's songs for personal practice.
// Two modes: "musica" (musical reference) or "letras" (Spanish lyrics, falling
// back to the musical reference per song).
export default function PracticePlaylistButton({ songIds, accent }: { songIds: string[]; accent: string }) {
  const disclosureId = useId();
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const pendingRef = useRef(false);
  const [state, setState] = useState<PracticeState>("idle");
  const [open, setOpen] = useState(false);

  const pending = state === "loading";

  const restoreTrigger = useCallback(() => {
    requestAnimationFrame(() => triggerRef.current?.focus({ preventScroll: true }));
  }, []);

  const closeDisclosure = useCallback(() => {
    setOpen(false);
    restoreTrigger();
  }, [restoreTrigger]);

  useEffect(() => {
    if (!open) return;

    const onPointerDown = (event: PointerEvent) => {
      const root = rootRef.current;
      if (!root || root.contains(event.target as Node)) return;
      closeDisclosure();
    };

    document.addEventListener("pointerdown", onPointerDown);
    return () => document.removeEventListener("pointerdown", onPointerDown);
  }, [closeDisclosure, open]);

  function guardPending(event?: React.SyntheticEvent) {
    if (!pendingRef.current) return false;
    event?.preventDefault();
    event?.stopPropagation();
    return true;
  }

  async function go(mode: PracticeMode) {
    if (pendingRef.current) return;

    const reserved = window.open("", "_blank");
    if (!reserved) {
      setState("blocked");
      closeDisclosure();
      return;
    }
    try {
      reserved.opener = null;
    } catch {
      // Some runtimes guard this property. Navigation still waits for a valid response.
    }

    pendingRef.current = true;
    setState("loading");
    closeDisclosure();

    try {
      const res = await fetch("/api/practice-playlist", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ids: songIds, mode }),
      });
      if (!res.ok) throw new Error("playlist");
      const { url } = (await res.json()) as { url?: string | null };
      if (!url) {
        reserved.close();
        setState("empty");
        return;
      }
      reserved.location.href = url;
      setState("idle");
    } catch {
      reserved.close();
      setState("error");
    } finally {
      pendingRef.current = false;
      restoreTrigger();
    }
  }

  function onTriggerKeyDown(event: React.KeyboardEvent<HTMLButtonElement>) {
    if ((event.key === "Enter" || event.key === " ") && guardPending(event)) return;
    if (event.key === "Escape" && open) {
      event.preventDefault();
      event.stopPropagation();
      closeDisclosure();
    }
  }

  function onDisclosureKeyDown(event: React.KeyboardEvent<HTMLDivElement>) {
    if (event.key !== "Escape") return;
    event.preventDefault();
    event.stopPropagation();
    closeDisclosure();
  }

  const label = state === "loading"
    ? "Abriendo…"
    : state === "empty"
      ? "Sin videos"
      : state === "blocked"
        ? "Permitir popup"
        : state === "error"
          ? "Reintentar"
          : "Practicar";

  return (
    <div ref={rootRef} className="relative inline-block">
      <button
        ref={triggerRef}
        type="button"
        onClick={(event) => {
          if (guardPending(event)) return;
          setOpen((current) => !current);
        }}
        onKeyDown={onTriggerKeyDown}
        aria-controls={disclosureId}
        aria-expanded={open}
        aria-disabled={pending ? "true" : undefined}
        title="Practicar el set en YouTube"
        style={{ color: accent, borderColor: `${accent}55`, background: `${accent}14` }}
        className="flex items-center gap-1.5 px-2 py-1 rounded-full border font-label text-[10px] uppercase tracking-widest transition-opacity hover:opacity-80 aria-disabled:opacity-50"
      >
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
          <path d="M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0z" />
          <polygon points="10 8 16 12 10 16 10 8" fill="currentColor" stroke="none" />
        </svg>
        {label}
        <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
          <polyline points="6 9 12 15 18 9" />
        </svg>
      </button>

      {open && (
        <div
          id={disclosureId}
          onKeyDown={onDisclosureKeyDown}
          className="absolute right-0 z-20 mt-2 min-w-[220px] rounded-xl border border-[#00bfff]/25 bg-[#00162e] overflow-hidden shadow-lg"
        >
          <button type="button" onClick={() => void go("musica")}
            className="flex w-full items-center gap-3 px-4 py-3 text-left hover:bg-[#00bfff]/10 transition-colors border-b border-[#00bfff]/10">
            <span className="font-label text-sm text-white">🎵 Música</span>
            <span className="font-body text-[11px] text-[#C8D8EB]/60">referencia musical</span>
          </button>
          <button type="button" onClick={() => void go("letras")}
            className="flex w-full items-center gap-3 px-4 py-3 text-left hover:bg-[#00bfff]/10 transition-colors">
            <span className="font-label text-sm text-white">🎤 Letras</span>
            <span className="font-body text-[11px] text-[#C8D8EB]/60">letra en español</span>
          </button>
        </div>
      )}

      {(state === "blocked" || state === "error" || state === "empty") && (
        <p role="status" className="absolute right-0 mt-1 w-48 text-right font-body text-[11px] text-[#C8D8EB]/70">
          {state === "blocked"
            ? "Tu navegador bloqueó la ventana."
            : state === "empty"
              ? "No hay videos para este set."
              : "No se pudo crear la playlist."}
        </p>
      )}
    </div>
  );
}
