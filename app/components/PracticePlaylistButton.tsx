"use client";

import { useCallback, useRef, useState } from "react";
import { themeColour } from "@/app/utils/themeColour";
import Menu, { MenuItem } from "@/app/components/ui/Menu";

type PracticeMode = "musica" | "letras";
type PracticeState = "idle" | "loading" | "empty" | "blocked" | "error";

// Opens a YouTube playlist of the setlist's songs for personal practice.
// Two modes: "musica" (musical reference) or "letras" (Spanish lyrics, falling
// back to the musical reference per song).
export default function PracticePlaylistButton({ songIds, accentVar }: { songIds: string[]; accentVar: string }) {
  const triggerRef = useRef<HTMLButtonElement>(null);
  const pendingRef = useRef(false);
  const [state, setState] = useState<PracticeState>("idle");

  const pending = state === "loading";

  const restoreTrigger = useCallback(() => {
    requestAnimationFrame(() => triggerRef.current?.focus({ preventScroll: true }));
  }, []);

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
      restoreTrigger();
      return;
    }
    try {
      reserved.opener = null;
    } catch {
      // Some runtimes guard this property. Navigation still waits for a valid response.
    }

    pendingRef.current = true;
    setState("loading");

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
    if (event.key === "Enter" || event.key === " ") guardPending(event);
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
    <div className="relative inline-block">
      <Menu
        label="Practicar el set en YouTube"
        align="end"
        trigger={
          <button
            ref={triggerRef}
            type="button"
            onClick={(event) => { guardPending(event); }}
            onKeyDown={onTriggerKeyDown}
            aria-disabled={pending ? "true" : undefined}
            title="Practicar el set en YouTube"
            style={{ color: themeColour(accentVar), borderColor: `${themeColour(accentVar, 0.3333)}`, background: `${themeColour(accentVar, 0.0784)}` }}
            className="flex items-center gap-1.5 px-2 py-1 rounded-full border font-label text-[11px] uppercase tracking-widest transition-opacity hover:opacity-80 aria-disabled:opacity-50"
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
        }
      >
        <MenuItem onSelect={() => void go("musica")}>
          <span className="font-label text-sm text-ink">🎵 Música</span>
          <span className="font-body text-xs text-ink-muted/70">referencia musical</span>
        </MenuItem>
        <MenuItem onSelect={() => void go("letras")}>
          <span className="font-label text-sm text-ink">🎤 Letras</span>
          <span className="font-body text-xs text-ink-muted/70">letra en español</span>
        </MenuItem>
      </Menu>

      {(state === "blocked" || state === "error" || state === "empty") && (
        <p role="status" className="absolute right-0 mt-1 w-48 text-right font-body text-xs text-ink-muted/70">
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
