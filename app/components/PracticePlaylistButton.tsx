"use client";

import { useCallback, useRef, useState } from "react";
import { ExternalLinkIcon, MicIcon, MusicNoteIcon, SlidersIcon } from "./ui/icons";
import { themeColour } from "@/app/utils/themeColour";
import Menu, { MenuItem, MenuSeparator } from "@/app/components/ui/Menu";
import Button from "@/app/components/ui/Button";
import { useToast } from "@/app/components/ui/Toast";
import { usePlayer } from "@/app/context/PlayerContext";
import { buildRehearsalQueue, type QueueMix, type QueueSong } from "@/app/utils/rehearsalQueue";
import { FAMILY_LABEL, SEAT_TO_FAMILY } from "@/app/utils/rehearsalMixes";

type PracticeMode = "musica" | "letras";
type Source = "mixes" | "youtube";
type PracticeState =
  | { kind: "idle" }
  | { kind: "loading" | "empty" | "error"; source: Source }
  | { kind: "blocked" };

const IDLE: PracticeState = { kind: "idle" };

// «Ensayar el setlist» (2026-10-22): the set's REHEARSAL MIXES, in setlist order,
// as one run in the app's player — the full band, or the member's own instrument
// «al frente» when they serve on one that day (`mySeat`). Each song plays in the
// set's key, or the nearest key that was rendered; a song with no mixes is
// skipped and named in a toast (`buildRehearsalQueue`). The mixes are read on
// the press (`/api/rehearsal-queue`), never with the page — and the read starts
// when the menu OPENS, so by the time a choice is tapped the run can start
// inside that tap: iOS only lets audio start from a gesture.
//
// Below a separator the YouTube playlist stays (until 2026-10-22 it was the
// whole menu): the lyrics video is what the voices rehearse with, and the mixes
// carry no lyrics. Opens in a new tab reserved inside the tap.
//
// `variant` is chrome only — the menu, the popup reservation and every failure
// state are shared. `inline` is the accent pill that sits on the Setlist rail;
// `hero` is the run sheet's one primary action (spec §12.1): the house Button's
// `cta` variant at `lg`, the card's full width under its header (2026-10-21).
// Only the IDLE label differs: "Practicar" reads as one affordance among several,
// "Ensayar el setlist" as the thing you came to do.
export default function PracticePlaylistButton({
  songs,
  mySeat,
  accentVar,
  variant = "inline",
}: {
  songs: QueueSong[];
  /** The viewer's instrument seat in THIS service (`EG`, `Keys`…), if any. */
  mySeat?: string | null;
  accentVar: string;
  variant?: "inline" | "hero";
}) {
  const { playQueue } = usePlayer();
  const { toast } = useToast();
  const triggerRef = useRef<HTMLButtonElement>(null);
  const pendingRef = useRef(false);
  const [state, setState] = useState<PracticeState>(IDLE);
  // The set's mixes, keyed by the ids they were read for — an edited setlist reads again.
  const mixesRef = useRef<{ key: string; mixes: Record<string, QueueMix[]> } | null>(null);
  const inflightRef = useRef<{ key: string; promise: Promise<Record<string, QueueMix[]>> } | null>(null);

  const songIds = songs.map((s) => s._id);
  const idsKey = songIds.join(",");
  const family = mySeat ? SEAT_TO_FAMILY[mySeat] ?? null : null;
  const pending = state.kind === "loading";

  const restoreTrigger = useCallback(() => {
    requestAnimationFrame(() => triggerRef.current?.focus({ preventScroll: true }));
  }, []);

  function guardPending(event?: React.SyntheticEvent) {
    if (!pendingRef.current) return false;
    event?.preventDefault();
    event?.stopPropagation();
    return true;
  }

  function loadMixes(): Promise<Record<string, QueueMix[]>> {
    if (mixesRef.current?.key === idsKey) return Promise.resolve(mixesRef.current.mixes);
    if (inflightRef.current?.key === idsKey) return inflightRef.current.promise;
    const key = idsKey;
    const promise = (async () => {
      const res = await fetch("/api/rehearsal-queue", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ids: songIds }),
      });
      if (!res.ok) throw new Error("rehearsal-queue");
      const { mixes } = (await res.json()) as { mixes?: Record<string, QueueMix[]> };
      mixesRef.current = { key, mixes: mixes ?? {} };
      return mixesRef.current.mixes;
    })();
    inflightRef.current = { key, promise };
    // A failed read is forgotten, so the next press tries again.
    promise.catch(() => {}).finally(() => {
      if (inflightRef.current?.promise === promise) inflightRef.current = null;
    });
    return promise;
  }

  function onTriggerClick(event: React.MouseEvent) {
    if (guardPending(event)) return;
    if (songIds.length > 0) loadMixes().catch(() => {});
  }

  function startRun(mixes: Record<string, QueueMix[]>, runFamily: string | null) {
    const { tracks, skipped } = buildRehearsalQueue(songs, mixes, runFamily);
    if (tracks.length === 0) {
      setState({ kind: "empty", source: "mixes" });
      return;
    }
    playQueue(tracks);
    setState(IDLE);
    if (skipped.length > 0) {
      toast({
        message: `Sin multitrack, ${skipped.length === 1 ? "se salta" : "se saltan"}: ${skipped.join(", ")}`,
        tone: "info",
        duration: 5000,
      });
    }
  }

  async function rehearse(runFamily: string | null) {
    if (pendingRef.current) return;
    if (mixesRef.current?.key === idsKey) {
      startRun(mixesRef.current.mixes, runFamily);
      return;
    }
    pendingRef.current = true;
    setState({ kind: "loading", source: "mixes" });
    try {
      startRun(await loadMixes(), runFamily);
    } catch {
      setState({ kind: "error", source: "mixes" });
    } finally {
      pendingRef.current = false;
      restoreTrigger();
    }
  }

  async function go(mode: PracticeMode) {
    if (pendingRef.current) return;

    const reserved = window.open("", "_blank");
    if (!reserved) {
      setState({ kind: "blocked" });
      restoreTrigger();
      return;
    }
    try {
      reserved.opener = null;
    } catch {
      // Some runtimes guard this property. Navigation still waits for a valid response.
    }

    pendingRef.current = true;
    setState({ kind: "loading", source: "youtube" });

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
        setState({ kind: "empty", source: "youtube" });
        return;
      }
      reserved.location.href = url;
      setState(IDLE);
    } catch {
      reserved.close();
      setState({ kind: "error", source: "youtube" });
    } finally {
      pendingRef.current = false;
      restoreTrigger();
    }
  }

  function onTriggerKeyDown(event: React.KeyboardEvent<HTMLButtonElement>) {
    if (event.key === "Enter" || event.key === " ") guardPending(event);
  }

  const label = state.kind === "loading"
    ? state.source === "mixes" ? "Cargando…" : "Abriendo…"
    : state.kind === "empty"
      ? state.source === "mixes" ? "Sin multitracks" : "Sin videos"
      : state.kind === "blocked"
        ? "Permitir popup"
        : state.kind === "error"
          ? "Reintentar"
          : variant === "hero" ? "Ensayar el setlist" : "Practicar";

  const status = state.kind === "blocked"
    ? "Tu navegador bloqueó la ventana."
    : state.kind === "empty"
      ? state.source === "mixes" ? "Ninguna canción del set tiene multitrack." : "No hay videos para este set."
      : state.kind === "error"
        ? state.source === "mixes" ? "No se pudieron cargar los multitracks." : "No se pudo crear la playlist."
        : null;

  return (
    <div className={variant === "hero" ? "relative block w-full" : "relative inline-block"}>
      <Menu
        label="Ensayar el set"
        align="end"
        className={variant === "hero" ? "block w-full" : undefined}
        trigger={
          variant === "hero" ? (
            // Manual label swap + `aria-disabled`, not `Button`'s `busy` prop:
            // `busy` sets the native `disabled` attribute, which yanks the
            // element out of the tab order and drops focus. `restoreTrigger()`
            // re-focuses THIS trigger once the fetch settles (success or
            // failure); a `disabled` button can't receive that focus back,
            // breaking restoration for the pending Ensayar trigger.
            <Button
              ref={triggerRef}
              variant="cta"
              size="lg"
              className="w-full"
              onClick={onTriggerClick}
              onKeyDown={onTriggerKeyDown}
              aria-disabled={pending ? "true" : undefined}
              title="Ensayar el set con los multitracks"
            >
              <svg width="11" height="11" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
                <polygon points="5 3 20 12 5 21" />
              </svg>
              {label}
            </Button>
          ) : (
            <button
              ref={triggerRef}
              type="button"
              onClick={onTriggerClick}
              onKeyDown={onTriggerKeyDown}
              aria-disabled={pending ? "true" : undefined}
              title="Ensayar el set con los multitracks"
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
          )
        }
      >
        <MenuItem onSelect={() => void rehearse(null)}>
          <span className="flex items-center gap-2 font-label text-sm text-ink"><MusicNoteIcon size={14} className="text-accent" />Banda completa</span>
          <span className="font-body text-xs text-ink-muted/70">multitracks en orden</span>
        </MenuItem>
        {family && (
          <MenuItem onSelect={() => void rehearse(family)}>
            <span className="flex items-center gap-2 font-label text-sm text-ink"><SlidersIcon size={14} className="text-accent" />{FAMILY_LABEL[family]}</span>
            <span className="font-body text-xs text-ink-muted/70">tu instrumento al frente</span>
          </MenuItem>
        )}
        <MenuSeparator />
        <MenuItem onSelect={() => void go("letras")}>
          <span className="flex items-center gap-2 font-label text-sm text-ink"><MicIcon size={14} className="text-accent" />Video con letra</span>
          <span className="font-body text-xs text-ink-muted/70">en YouTube</span>
        </MenuItem>
        <MenuItem onSelect={() => void go("musica")}>
          <span className="flex items-center gap-2 font-label text-sm text-ink"><ExternalLinkIcon size={14} className="text-accent" />Referencia</span>
          <span className="font-body text-xs text-ink-muted/70">en YouTube</span>
        </MenuItem>
      </Menu>

      {status && (
        <p role="status" className="absolute right-0 mt-1 w-48 text-right font-body text-xs text-ink-muted/70">
          {status}
        </p>
      )}
    </div>
  );
}
