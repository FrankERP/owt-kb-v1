"use client";

import { useState, useEffect, useRef, Fragment } from "react";
import { SongForm, SongTag, FormState, buildPayload } from "./SongFormModal";
import { normalizeMedleyTags } from "../../utils/medley";
import { ChainLinkIcon } from "../ChainLinkIcon";
import CueDialog from "../ui/CueDialog";
import CueDialogStatus from "../ui/CueDialogStatus";
import { canEditSetlistResponse, SETLIST_READ_ISSUE_COPY } from "../../utils/setlistReadContract";
import { serviceDayOffset, serviceTodayIso } from "./serviceReadiness";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface SongResult   { _id: string; title: string; author: string; key: string; slug: string; }
export interface SetlistEntry { localId: string; play_key: string; medley_tag?: string; song: SongResult; }

/** A1's observed state, carried UNCHANGED from the GET into the PUT (A2 §5). */
type ObservedTarget = { state: "none" } | { state: "single"; id: string; rev: string };

const SAVE_CONFLICT_COPY =
  "Alguien más cambió este setlist mientras lo editabas. Recarga para ver el estado actual antes de guardar.";

// ─── Helpers ──────────────────────────────────────────────────────────────────

const uid2 = () => Math.random().toString(36).slice(2, 9);

/**
 * What the badge should say about a song's most recent appearance.
 *
 * Two things were wrong. The GROQ behind `recentSongs` is `week >= $cutoff`
 * with no upper bound, and the route keeps the LATEST week per song — so a song
 * already booked three months out arrived here as a NEGATIVE age, which passed
 * the `> 4` filter, landed in the `<= 2` red class and rendered "esta sem.".
 * A lead building a setlist saw a red "played this week" warning on songs that
 * had not been played at all, which buries the real recency signal.
 *
 * Suppressing negatives would be the wrong fix: a song on tomorrow's Sunday
 * while you edit Saturday is a genuine same-weekend repeat, and the most
 * actionable warning of the lot. It gets its own label instead.
 *
 * The age is also a CALENDAR-day diff at local noon now, not elapsed hours,
 * which is the repo's rule for anything that becomes a day/week LABEL: the old
 * arithmetic flipped "esta sem." to "hace 1 sem." depending on the time of day.
 */
export function repeatBadgeFor(
  lastUsed: string,
  todayIso: string = serviceTodayIso(),
): { label: string; tone: "upcoming" | "recent" | "older" } | null {
  const offset = serviceDayOffset(lastUsed, todayIso);
  if (offset === null) return null;
  if (offset > 0) return { label: "ya programada", tone: "upcoming" };
  const days = -offset;
  const weeks = Math.floor(days / 7);
  if (weeks > 4) return null;
  return {
    label: weeks <= 0 ? "esta sem." : `hace ${weeks} sem.`,
    tone: weeks <= 2 ? "recent" : "older",
  };
}

const REPEAT_TONE_CLASS: Record<"upcoming" | "recent" | "older", string> = {
  // A booking still ahead is at least as loud as one two weeks past.
  upcoming: "bg-negative-strong/20 text-negative-fg border-negative-strong/30",
  recent: "bg-negative-strong/20 text-negative-fg border-negative-strong/30",
  older: "bg-recency-fg/20 text-recency-strong border-recency-fg/30",
};

function RepeatBadge({ lastUsed }: { lastUsed: string }) {
  const badge = repeatBadgeFor(lastUsed);
  if (!badge) return null;
  return (
    <span className={`font-label text-[10px] uppercase tracking-widest px-1.5 py-0.5 rounded-full border ${REPEAT_TONE_CLASS[badge.tone]}`}>
      {badge.label}
    </span>
  );
}

function GripIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 12 12" fill="currentColor">
      <circle cx="4" cy="2.5" r="1" /><circle cx="8" cy="2.5" r="1" />
      <circle cx="4" cy="6"   r="1" /><circle cx="8" cy="6"   r="1" />
      <circle cx="4" cy="9.5" r="1" /><circle cx="8" cy="9.5" r="1" />
    </svg>
  );
}

// ─── Component ────────────────────────────────────────────────────────────────

export function SetlistEditor({ week, type, roleId, onClose, onSaved }: {
  week: string;
  type: "sunday" | "saturday" | "special";
  roleId?: string;
  onClose: () => void;
  onSaved?: () => void;
}) {
  const [entries, setEntries]           = useState<SetlistEntry[]>([]);
  const [recentSongs, setRecentSongs]   = useState<Record<string, string>>({});
  const [searchQ, setSearchQ]           = useState("");
  const [searchResults, setSearchResults] = useState<SongResult[]>([]);
  const [loading, setLoading]           = useState(true);
  const [loadError, setLoadError]       = useState<string | null>(null);
  const [saving, setSaving]             = useState(false);
  const [saveError, setSaveError]       = useState<string | null>(null);
  // The observed target state is retained until a successful save or a reload —
  // never re-derived from a fresh server read, which would silently re-authorize
  // an overwrite of someone else's change.
  const [observed, setObserved]         = useState<ObservedTarget | null>(null);
  const [saveConflict, setSaveConflict] = useState(false);
  const [reloadToken, setReloadToken]   = useState(0);
  const [addKey, setAddKey]             = useState("");
  const [draggingIdx, setDraggingIdx]   = useState<number | null>(null);
  const [dragOverIdx, setDragOverIdx]   = useState<number | null>(null);
  const [allTags, setAllTags]           = useState<SongTag[]>([]);
  const [createOpen, setCreateOpen]     = useState(false);
  const [createSaving, setCreateSaving] = useState(false);
  const [createError, setCreateError]   = useState<string | null>(null);
  const dragSrc     = useRef<number | null>(null);
  const searchTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    let alive = true;
    async function load() {
      setLoading(true);
      setLoadError(null);
      setSaveConflict(false);
      setSaveError(null);
      setObserved(null);
      const params = new URLSearchParams({ type, week });
      if (roleId) params.set("roleId", roleId);
      try {
        const [setlistRes, tagsRes] = await Promise.all([
          fetch(`/api/admin/setlists?${params}`),
          fetch("/api/content/tags"),
        ]);
        if (!alive) return;
        if (!setlistRes.ok) {
          setLoadError(SETLIST_READ_ISSUE_COPY.http);
          return;
        }
        // Fail closed: only a canonical `none` target or a singleton with
        // empty/incomplete/ready content opens editable state. A duplicate,
        // draft conflict, invalid target/content or malformed payload must never
        // render as an ordinary empty setlist the admin could overwrite.
        const decision = canEditSetlistResponse(await setlistRes.json());
        if (!alive) return;
        if (!decision.editable) {
          setLoadError(SETLIST_READ_ISSUE_COPY[decision.issue]);
          return;
        }
        const data = decision.read as unknown as {
          songs: Array<{ play_key: string; medley_tag?: string; song: SongResult }>;
          recentSongs: Record<string, string>;
          observed: ObservedTarget;
        };
        setEntries(data.songs.map(s => ({ localId: uid2(), play_key: s.play_key, medley_tag: s.medley_tag, song: s.song })));
        setRecentSongs(data.recentSongs);
        setObserved(data.observed);
        if (tagsRes.ok) setAllTags(await tagsRes.json());
      } catch {
        if (alive) setLoadError(SETLIST_READ_ISSUE_COPY.http);
      } finally {
        if (alive) setLoading(false);
      }
    }
    load();
    return () => { alive = false; };
  }, [week, type, roleId, reloadToken]);

  useEffect(() => {
    if (searchTimer.current) clearTimeout(searchTimer.current);
    if (!searchQ.trim()) { setSearchResults([]); return; }
    searchTimer.current = setTimeout(async () => {
      const res = await fetch(`/api/admin/songs?q=${encodeURIComponent(searchQ)}`);
      if (res.ok) setSearchResults(await res.json());
    }, 250);
  }, [searchQ]);

  function addSong(song: SongResult) {
    setEntries(prev => [...prev, { localId: uid2(), play_key: addKey, song }]);
    setSearchQ(""); setSearchResults([]); setAddKey("");
  }

  function remove(localId: string) {
    // Removing a song can orphan its medley partner — re-normalize tags.
    setEntries(prev => normalizeMedleyTags(prev.filter(e => e.localId !== localId), uid2));
  }

  function handleDrop(toIdx: number) {
    const from = dragSrc.current;
    if (from === null || from === toIdx) return;
    setEntries(prev => {
      const next = [...prev];
      const [item] = next.splice(from, 1);
      next.splice(toIdx, 0, item);
      // Reordering can break a medley apart or interleave two — re-derive tags
      // from the new adjacency so stored tags always match what's shown.
      return normalizeMedleyTags(next, uid2);
    });
  }

  // Keyboard-accessible reorder (drag is mouse/touch only). Moves the row at
  // idx by one position; re-derives medley tags like handleDrop.
  function move(idx: number, dir: -1 | 1) {
    setEntries(prev => {
      const to = idx + dir;
      if (to < 0 || to >= prev.length) return prev;
      const next = [...prev];
      const [item] = next.splice(idx, 1);
      next.splice(to, 0, item);
      return normalizeMedleyTags(next, uid2);
    });
  }

  // Precondition: idxA and idxB are adjacent (idxB === idxA + 1). The only caller
  // is the toggle button rendered between consecutive rows, which guarantees this.
  function toggleMedleyLink(idxA: number, idxB: number) {
    setEntries(prev => {
      const next = prev.map(e => ({ ...e }));
      const a = next[idxA];
      const b = next[idxB];

      if (a.medley_tag && b.medley_tag && a.medley_tag === b.medley_tag) {
        // Already linked — split at this boundary
        const tag = a.medley_tag;
        const groupIndices = next.reduce<number[]>((acc, e, i) => e.medley_tag === tag ? [...acc, i] : acc, []);
        const splitPos = groupIndices.indexOf(idxB);
        const leftGroup  = groupIndices.slice(0, splitPos);
        const rightGroup = groupIndices.slice(splitPos);
        if (leftGroup.length < 2)  leftGroup.forEach(i  => { next[i].medley_tag = undefined; });
        if (rightGroup.length >= 2) {
          const newTag = uid2();
          rightGroup.forEach(i => { next[i].medley_tag = newTag; });
        } else {
          rightGroup.forEach(i => { next[i].medley_tag = undefined; });
        }
      } else {
        // Link them — merge groups or create new tag
        const aTag = a.medley_tag;
        const bTag = b.medley_tag;
        if (aTag && bTag) {
          next.forEach(e => { if (e.medley_tag === bTag) e.medley_tag = aTag; });
        } else if (aTag) {
          b.medley_tag = aTag;
        } else if (bTag) {
          a.medley_tag = bTag;
        } else {
          const newTag = uid2();
          a.medley_tag = newTag;
          b.medley_tag = newTag;
        }
      }
      return next;
    });
  }

  async function handleCreateSong(form: FormState) {
    setCreateSaving(true);
    setCreateError(null);
    try {
      const res = await fetch("/api/content/posts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(buildPayload(form)),
      });
      if (!res.ok) throw new Error();
      const doc = await res.json();
      addSong({
        _id:    doc._id,
        title:  doc.title,
        author: doc.author ?? "",
        key:    doc.key ?? "",
        slug:   doc.slug?.current ?? "",
      });
      setCreateOpen(false);
    } catch {
      setCreateError("No se pudo crear la canción.");
    } finally {
      setCreateSaving(false);
    }
  }

  async function handleCreateTag(name: string): Promise<SongTag | null> {
    try {
      const res = await fetch("/api/content/tags", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name }),
      });
      if (!res.ok) throw new Error();
      const tag = await res.json();
      setAllTags(prev => [...prev, tag].sort((a, b) => a.name.localeCompare(b.name)));
      setCreateError(null);
      return tag;
    } catch {
      setCreateError("No se pudo crear el tag.");
      return null;
    }
  }

  async function save() {
    // Without an observed state there is nothing to guard the write with; refuse
    // rather than send a blind overwrite.
    if (!observed) { setSaveError(SETLIST_READ_ISSUE_COPY.http); return; }
    setSaving(true);
    setSaveError(null);
    try {
      const res = await fetch("/api/admin/setlists", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          week, type, roleId,
          // A1's observed state, unchanged: the server rejects the save unless the
          // target is still exactly what this editor loaded.
          observed,
          songs: entries.map(e => ({ songId: e.song._id, play_key: e.play_key, medley_tag: e.medley_tag })),
        }),
      });
      // Only close on success — otherwise keep the editor open so the admin's
      // edits aren't silently discarded on a failed/rejected save.
      if (res.status === 409) {
        setSaveConflict(true);
        setSaveError(SAVE_CONFLICT_COPY);
        return;
      }
      if (!res.ok) { setSaveError("No se pudo guardar el setlist. Intenta de nuevo."); return; }
      if (onSaved) onSaved();
      else onClose();
    } catch {
      setSaveError("Error de conexión. Intenta de nuevo.");
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return <div className="flex justify-center py-8"><span className="font-label text-xs uppercase tracking-widest text-mono-500 animate-pulse">Cargando...</span></div>;
  }

  if (loadError) {
    return (
      <div className="space-y-4">
        <CueDialogStatus tone="error">{loadError}</CueDialogStatus>
        <button type="button" onClick={onClose} className="w-full rounded-lg border border-accent/20 py-2 font-label text-xs uppercase tracking-widest text-mono-400 transition-colors hover:border-accent hover:text-accent">
          Cerrar
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Current setlist */}
      <div>
        <p className="font-label text-[11px] uppercase tracking-widest text-mono-500 mb-2">
          Setlist ({entries.length})
        </p>
        {entries.length === 0 && (
          <p className="font-body text-xs text-mono-600 italic">Sin canciones todavía</p>
        )}
        <div>
          {entries.map((e, idx) => {
            const lastUsed = recentSongs[e.song._id];
            const isDragging = draggingIdx === idx;
            const nextEntry = entries[idx + 1];
            const linked = !!e.medley_tag && !!nextEntry?.medley_tag && e.medley_tag === nextEntry.medley_tag;
            return (
              <Fragment key={e.localId}>
                <div
                  draggable
                  onDragStart={ev => { ev.dataTransfer.effectAllowed = "move"; dragSrc.current = idx; setDraggingIdx(idx); }}
                  onDragOver={ev => { ev.preventDefault(); ev.dataTransfer.dropEffect = "move"; setDragOverIdx(idx); }}
                  onDragLeave={() => setDragOverIdx(null)}
                  onDrop={ev => { ev.preventDefault(); handleDrop(idx); setDragOverIdx(null); }}
                  onDragEnd={() => { dragSrc.current = null; setDraggingIdx(null); setDragOverIdx(null); }}
                  className={`flex items-center gap-2 rounded-lg border px-3 py-2 select-none transition-all ${idx > 0 ? "mt-1.5" : ""} ${
                    isDragging
                      ? "opacity-30 border-accent/10 bg-surface-sunken/30"
                      : dragOverIdx === idx
                      ? "border-accent/50 bg-accent/5"
                      : e.medley_tag
                      ? "border-accent/25 bg-surface-sunken/50"
                      : "border-accent/10 bg-surface-sunken/30"
                  }`}
                >
                  <div className="cursor-grab active:cursor-grabbing text-mono-600 hover:text-mono-400 shrink-0 transition-colors" aria-hidden="true">
                    <GripIcon />
                  </div>
                  {/* Keyboard-accessible reorder alternative to drag-and-drop */}
                  <div className="flex flex-col shrink-0 -my-1">
                    <button
                      type="button"
                      onClick={() => move(idx, -1)}
                      disabled={idx === 0}
                      aria-label={`Subir ${e.song.title}`}
                      className="text-mono-600 hover:text-accent disabled:opacity-25 disabled:hover:text-mono-600 leading-none text-[11px] transition-colors"
                    >▲</button>
                    <button
                      type="button"
                      onClick={() => move(idx, 1)}
                      disabled={idx === entries.length - 1}
                      aria-label={`Bajar ${e.song.title}`}
                      className="text-mono-600 hover:text-accent disabled:opacity-25 disabled:hover:text-mono-600 leading-none text-[11px] transition-colors"
                    >▼</button>
                  </div>
                  <span className="font-label text-[11px] text-mono-600 shrink-0 w-4 text-center tabular-nums">{idx + 1}</span>
                  <div className="flex-1 min-w-0">
                    <p className="font-body text-xs truncate">{e.song.title}</p>
                    <div className="flex items-center gap-1.5 mt-0.5 flex-wrap">
                      <span className="font-label text-[10px] text-mono-600">{e.song.author}</span>
                      {e.song.key && <span className="font-label text-[10px] text-mono-600">· {e.song.key}</span>}
                      {lastUsed && <RepeatBadge lastUsed={lastUsed} />}
                    </div>
                  </div>
                  <input
                    className="w-14 px-1.5 py-1 rounded border border-edge-control bg-transparent font-body text-xs text-center focus:outline-none focus:border-accent"
                    placeholder="Tono"
                    value={e.play_key}
                    onChange={ev => setEntries(prev => prev.map(x => x.localId === e.localId ? { ...x, play_key: ev.target.value } : x))}
                  />
                  <button type="button" onClick={() => remove(e.localId)} aria-label={`Quitar ${e.song.title}`} className="text-mono-600 hover:text-negative-fg transition-colors shrink-0 text-sm leading-none">×</button>
                </div>
                {idx < entries.length - 1 && (
                  <div className="-my-0.5 flex items-center justify-center relative z-10">
                    <button
                      type="button"
                      onClick={() => toggleMedleyLink(idx, idx + 1)}
                      title={linked ? "Desagrupar medley" : "Agrupar en medley"}
                      className={`flex items-center gap-1 px-2 py-0.5 rounded-full border transition-all ${
                        linked
                          ? "border-accent/30 bg-surface-base text-accent/70"
                          : "border-dashed border-mono-700/30 bg-surface-base text-mono-700/40 hover:border-accent/30 hover:text-accent/40"
                      }`}
                    >
                      <ChainLinkIcon strokeWidth={linked ? 2.5 : 1.5} />
                      {linked && <span className="font-label text-[10px] uppercase tracking-widest ml-0.5">medley</span>}
                    </button>
                  </div>
                )}
              </Fragment>
            );
          })}
        </div>
      </div>

      {/* Search & add */}
      <div className="border-t border-accent/10 pt-3 space-y-2">
        <p className="font-label text-[11px] uppercase tracking-widest text-mono-500">Agregar canción</p>
        <div className="flex gap-2">
          <input
            className="flex-1 px-3 py-1.5 rounded-lg border border-edge-control bg-transparent font-body text-sm focus:outline-none focus:border-accent transition-colors placeholder-mono-600"
            placeholder="Buscar por título..."
            value={searchQ}
            onChange={e => setSearchQ(e.target.value)}
          />
          <input
            className="w-16 px-2 py-1.5 rounded-lg border border-edge-control bg-transparent font-body text-sm text-center focus:outline-none focus:border-accent transition-colors placeholder-mono-600"
            placeholder="Tono"
            value={addKey}
            onChange={e => setAddKey(e.target.value)}
          />
        </div>
        {searchResults.length > 0 && (
          <div className="rounded-lg border border-accent/20 divide-y divide-accent/10 max-h-48 overflow-y-auto">
            {searchResults.map(song => {
              const lastUsed = recentSongs[song._id];
              const alreadyAdded = entries.some(e => e.song._id === song._id);
              return (
                <div key={song._id} className="flex items-center gap-3 px-3 py-2 hover:bg-accent/5 transition-colors">
                  <div className="flex-1 min-w-0">
                    <p className="font-body text-xs truncate">{song.title}</p>
                    <div className="flex items-center gap-1.5 mt-0.5 flex-wrap">
                      <span className="font-label text-[10px] text-mono-600">{song.author}</span>
                      {song.key && <span className="font-label text-[10px] text-mono-600">· {song.key}</span>}
                      {lastUsed && <RepeatBadge lastUsed={lastUsed} />}
                    </div>
                  </div>
                  <button
                    type="button"
                    disabled={alreadyAdded}
                    onClick={() => addSong(song)}
                    className="font-label text-[10px] uppercase tracking-widest px-2 py-1 rounded-full border border-accent/30 text-accent/70 hover:text-accent hover:border-accent disabled:opacity-30 disabled:cursor-default transition-colors shrink-0"
                  >
                    {alreadyAdded ? "Ya está" : "+ Añadir"}
                  </button>
                </div>
              );
            })}
          </div>
        )}
        <div className="rounded-lg border border-accent/20">
          <button
            type="button"
            onClick={() => setCreateOpen(true)}
            className="w-full flex items-center gap-3 px-3 py-2.5 hover:bg-accent/5 transition-colors text-left"
          >
            <span className="font-label text-[11px] uppercase tracking-widest text-accent">+ Crear</span>
            {searchQ.trim()
              ? <span className="font-body text-xs text-mono-400 truncate">&quot;{searchQ}&quot;</span>
              : <span className="font-body text-xs text-mono-400">nueva canción</span>}
          </button>
        </div>
      </div>

      {/* Footer */}
      {saveError && (
        <p className="text-negative-fg font-label text-xs uppercase tracking-widest text-center -mb-1">{saveError}</p>
      )}
      {/* A 409 keeps the editor (and the admin's edits) open and requires a
          reload: the observed state is only replaced by a fresh read. */}
      {saveConflict && (
        <button
          type="button"
          onClick={() => setReloadToken(t => t + 1)}
          className="w-full py-2 rounded-lg border border-recency-fg/40 font-label text-xs uppercase tracking-widest text-recency-soft hover:bg-recency-fg/10 transition-colors"
        >
          Recargar setlist
        </button>
      )}
      <div className="flex gap-3 sticky bottom-0 bg-surface-raised-alt py-2">
        <button type="button" onClick={onClose} className="flex-1 py-2 rounded-lg border border-surface-accent-30 font-label text-xs uppercase tracking-widest hover:border-accent dark:hover:border-surface-accent-30 transition-colors">
          Cancelar
        </button>
        <button type="button" onClick={save} disabled={saving || saveConflict || !observed} className="flex-1 py-2 rounded-lg bg-surface-accent-solid text-on-fill hover:bg-accent-deep/80 dark:hover:bg-accent/30 font-label text-xs uppercase tracking-widest transition-colors disabled:opacity-50">
          {saving ? "Guardando..." : "Guardar setlist"}
        </button>
      </div>

      {/* Create song modal (nested above the ServicesPanel modal) */}
      {createOpen && (
        <CueDialog
          open
          title="Nueva canción"
          label="Nueva canción"
          mode="sheet"
          size="lg"
          onDismiss={() => { setCreateError(null); setCreateOpen(false); }}
        >
          <div className="min-h-0 flex-1 space-y-5 overflow-y-auto p-6">
          {createError && <CueDialogStatus tone="error">{createError}</CueDialogStatus>}
          <SongForm
            initial={{ title: searchQ }}
            allTags={allTags}
            onSubmit={handleCreateSong}
            onClose={() => { setCreateError(null); setCreateOpen(false); }}
            loading={createSaving}
            canCreateTag={handleCreateTag}
          />
          </div>
        </CueDialog>
      )}
    </div>
  );
}
