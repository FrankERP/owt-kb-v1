"use client";

import { useState, useEffect, useRef, Fragment } from "react";
import { Modal, SongForm, SongTag, FormState, buildPayload } from "./SongFormModal";
import { normalizeMedleyTags } from "../../utils/medley";
import { ChainLinkIcon } from "../ChainLinkIcon";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface SongResult   { _id: string; title: string; author: string; key: string; slug: string; }
export interface SetlistEntry { localId: string; play_key: string; medley_tag?: string; song: SongResult; }

// ─── Helpers ──────────────────────────────────────────────────────────────────

const uid2 = () => Math.random().toString(36).slice(2, 9);

function weeksAgo(iso: string): number {
  return Math.floor((Date.now() - new Date(iso + "T12:00:00").getTime()) / (7 * 86400 * 1000));
}

function RepeatBadge({ lastUsed }: { lastUsed: string }) {
  const weeks = weeksAgo(lastUsed);
  if (weeks > 4) return null;
  const cls = weeks <= 2
    ? "bg-red-500/20 text-red-400 border-red-500/30"
    : "bg-yellow-500/20 text-yellow-400 border-yellow-500/30";
  return (
    <span className={`font-label text-[9px] uppercase tracking-widest px-1.5 py-0.5 rounded-full border ${cls}`}>
      {weeks <= 0 ? "esta sem." : `hace ${weeks} sem.`}
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

export function SetlistEditor({ week, type, roleId, onClose }: {
  week: string;
  type: "sunday" | "saturday" | "special";
  roleId?: string;
  onClose: () => void;
}) {
  const [entries, setEntries]           = useState<SetlistEntry[]>([]);
  const [recentSongs, setRecentSongs]   = useState<Record<string, string>>({});
  const [searchQ, setSearchQ]           = useState("");
  const [searchResults, setSearchResults] = useState<SongResult[]>([]);
  const [loading, setLoading]           = useState(true);
  const [saving, setSaving]             = useState(false);
  const [addKey, setAddKey]             = useState("");
  const [draggingIdx, setDraggingIdx]   = useState<number | null>(null);
  const [dragOverIdx, setDragOverIdx]   = useState<number | null>(null);
  const [allTags, setAllTags]           = useState<SongTag[]>([]);
  const [createOpen, setCreateOpen]     = useState(false);
  const [createSaving, setCreateSaving] = useState(false);
  const dragSrc     = useRef<number | null>(null);
  const searchTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    async function load() {
      setLoading(true);
      const params = new URLSearchParams({ type, week });
      if (roleId) params.set("roleId", roleId);
      const [setlistRes, tagsRes] = await Promise.all([
        fetch(`/api/admin/setlists?${params}`),
        fetch("/api/content/tags"),
      ]);
      if (setlistRes.ok) {
        const data = await setlistRes.json() as { songs: Array<{ play_key: string; medley_tag?: string; song: SongResult }>; recentSongs: Record<string, string> };
        setEntries((data.songs ?? []).map(s => ({ localId: uid2(), play_key: s.play_key, medley_tag: s.medley_tag, song: s.song })));
        setRecentSongs(data.recentSongs ?? {});
      }
      if (tagsRes.ok) setAllTags(await tagsRes.json());
      setLoading(false);
    }
    load();
  }, [week, type, roleId]);

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
    const res = await fetch("/api/content/posts", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(buildPayload(form)),
    });
    setCreateSaving(false);
    if (!res.ok) return;
    const doc = await res.json();
    addSong({
      _id:    doc._id,
      title:  doc.title,
      author: doc.author ?? "",
      key:    doc.key ?? "",
      slug:   doc.slug?.current ?? "",
    });
    setCreateOpen(false);
  }

  async function handleCreateTag(name: string): Promise<SongTag | null> {
    const res = await fetch("/api/content/tags", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name }),
    });
    if (!res.ok) return null;
    const tag = await res.json();
    setAllTags(prev => [...prev, tag].sort((a, b) => a.name.localeCompare(b.name)));
    return tag;
  }

  async function save() {
    setSaving(true);
    await fetch("/api/admin/setlists", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        week, type, roleId,
        songs: entries.map(e => ({ songId: e.song._id, play_key: e.play_key, medley_tag: e.medley_tag })),
      }),
    });
    setSaving(false);
    onClose();
  }

  if (loading) {
    return <div className="flex justify-center py-8"><span className="font-label text-xs uppercase tracking-widest text-gray-500 animate-pulse">Cargando...</span></div>;
  }

  return (
    <div className="space-y-4">
      {/* Current setlist */}
      <div>
        <p className="font-label text-[10px] uppercase tracking-widest text-gray-500 mb-2">
          Setlist ({entries.length})
        </p>
        {entries.length === 0 && (
          <p className="font-body text-xs text-gray-600 italic">Sin canciones todavía</p>
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
                      ? "opacity-30 border-[#00bfff]/10 bg-[#001830]/30"
                      : dragOverIdx === idx
                      ? "border-[#00bfff]/50 bg-[#00bfff]/5"
                      : e.medley_tag
                      ? "border-[#00bfff]/25 bg-[#001830]/50"
                      : "border-[#00bfff]/10 bg-[#001830]/30"
                  }`}
                >
                  <div className="cursor-grab active:cursor-grabbing text-gray-600 hover:text-gray-400 shrink-0 transition-colors">
                    <GripIcon />
                  </div>
                  <span className="font-label text-[10px] text-gray-600 shrink-0 w-4 text-center tabular-nums">{idx + 1}</span>
                  <div className="flex-1 min-w-0">
                    <p className="font-body text-xs truncate">{e.song.title}</p>
                    <div className="flex items-center gap-1.5 mt-0.5 flex-wrap">
                      <span className="font-label text-[9px] text-gray-600">{e.song.author}</span>
                      {e.song.key && <span className="font-label text-[9px] text-gray-600">· {e.song.key}</span>}
                      {lastUsed && <RepeatBadge lastUsed={lastUsed} />}
                    </div>
                  </div>
                  <input
                    className="w-14 px-1.5 py-1 rounded border border-[#00bfff]/15 bg-transparent font-body text-xs text-center focus:outline-none focus:border-[#00bfff]"
                    placeholder="Tono"
                    value={e.play_key}
                    onChange={ev => setEntries(prev => prev.map(x => x.localId === e.localId ? { ...x, play_key: ev.target.value } : x))}
                  />
                  <button type="button" onClick={() => remove(e.localId)} className="text-gray-600 hover:text-red-400 transition-colors shrink-0 text-sm leading-none">×</button>
                </div>
                {idx < entries.length - 1 && (
                  <div className="-my-0.5 flex items-center justify-center relative z-10">
                    <button
                      type="button"
                      onClick={() => toggleMedleyLink(idx, idx + 1)}
                      title={linked ? "Desagrupar medley" : "Agrupar en medley"}
                      className={`flex items-center gap-1 px-2 py-0.5 rounded-full border transition-all ${
                        linked
                          ? "border-[#00bfff]/30 bg-[#010b17] text-[#00bfff]/60"
                          : "border-dashed border-gray-700/30 bg-[#010b17] text-gray-700/40 hover:border-[#00bfff]/30 hover:text-[#00bfff]/40"
                      }`}
                    >
                      <ChainLinkIcon strokeWidth={linked ? 2.5 : 1.5} />
                      {linked && <span className="font-label text-[8px] uppercase tracking-widest ml-0.5">medley</span>}
                    </button>
                  </div>
                )}
              </Fragment>
            );
          })}
        </div>
      </div>

      {/* Search & add */}
      <div className="border-t border-[#00bfff]/10 pt-3 space-y-2">
        <p className="font-label text-[10px] uppercase tracking-widest text-gray-500">Agregar canción</p>
        <div className="flex gap-2">
          <input
            className="flex-1 px-3 py-1.5 rounded-lg border border-[#00bfff]/20 bg-transparent font-body text-sm focus:outline-none focus:border-[#00bfff] transition-colors placeholder-gray-600"
            placeholder="Buscar por título..."
            value={searchQ}
            onChange={e => setSearchQ(e.target.value)}
          />
          <input
            className="w-16 px-2 py-1.5 rounded-lg border border-[#00bfff]/20 bg-transparent font-body text-sm text-center focus:outline-none focus:border-[#00bfff] transition-colors placeholder-gray-600"
            placeholder="Tono"
            value={addKey}
            onChange={e => setAddKey(e.target.value)}
          />
        </div>
        {searchResults.length > 0 && (
          <div className="rounded-lg border border-[#00bfff]/20 divide-y divide-[#00bfff]/10 max-h-48 overflow-y-auto">
            {searchResults.map(song => {
              const lastUsed = recentSongs[song._id];
              const alreadyAdded = entries.some(e => e.song._id === song._id);
              return (
                <div key={song._id} className="flex items-center gap-3 px-3 py-2 hover:bg-[#00bfff]/5 transition-colors">
                  <div className="flex-1 min-w-0">
                    <p className="font-body text-xs truncate">{song.title}</p>
                    <div className="flex items-center gap-1.5 mt-0.5 flex-wrap">
                      <span className="font-label text-[9px] text-gray-600">{song.author}</span>
                      {song.key && <span className="font-label text-[9px] text-gray-600">· {song.key}</span>}
                      {lastUsed && <RepeatBadge lastUsed={lastUsed} />}
                    </div>
                  </div>
                  <button
                    type="button"
                    disabled={alreadyAdded}
                    onClick={() => addSong(song)}
                    className="font-label text-[9px] uppercase tracking-widest px-2 py-1 rounded-full border border-[#00bfff]/30 text-[#00bfff]/70 hover:text-[#00bfff] hover:border-[#00bfff] disabled:opacity-30 disabled:cursor-default transition-colors shrink-0"
                  >
                    {alreadyAdded ? "Ya está" : "+ Añadir"}
                  </button>
                </div>
              );
            })}
          </div>
        )}
        <div className="rounded-lg border border-[#00bfff]/20">
          <button
            type="button"
            onClick={() => setCreateOpen(true)}
            className="w-full flex items-center gap-3 px-3 py-2.5 hover:bg-[#00bfff]/5 transition-colors text-left"
          >
            <span className="font-label text-[10px] uppercase tracking-widest text-[#00bfff]">+ Crear</span>
            {searchQ.trim()
              ? <span className="font-body text-xs text-gray-400 truncate">"{searchQ}"</span>
              : <span className="font-body text-xs text-gray-400">nueva canción</span>}
          </button>
        </div>
      </div>

      {/* Footer */}
      <div className="flex gap-3 sticky bottom-0 bg-[#C8D8EB] dark:bg-[#0a1929] py-2">
        <button type="button" onClick={onClose} className="flex-1 py-2 rounded-lg border border-[#003572]/30 dark:border-[#00bfff]/20 font-label text-xs uppercase tracking-widest hover:border-[#00bfff] transition-colors">
          Cancelar
        </button>
        <button type="button" onClick={save} disabled={saving} className="flex-1 py-2 rounded-lg bg-[#003572] dark:bg-[#00bfff]/20 hover:bg-[#003572]/80 dark:hover:bg-[#00bfff]/30 font-label text-xs uppercase tracking-widest transition-colors disabled:opacity-50">
          {saving ? "Guardando..." : "Guardar setlist"}
        </button>
      </div>

      {/* Create song modal (nested above the ServicesPanel modal) */}
      {createOpen && (
        <Modal
          title="Nueva canción"
          onClose={() => setCreateOpen(false)}
          zClass="z-[60]"
        >
          <SongForm
            initial={{ title: searchQ }}
            allTags={allTags}
            onSubmit={handleCreateSong}
            onClose={() => setCreateOpen(false)}
            loading={createSaving}
            canCreateTag={handleCreateTag}
          />
        </Modal>
      )}
    </div>
  );
}
