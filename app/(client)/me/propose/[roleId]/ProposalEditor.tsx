"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { useRouter } from "next/navigation";
import { ProposalStatus } from "@/app/utils/interface";

interface SongResult {
  _id: string;
  title: string;
  author: string;
  key: string;
}

interface ProposalSong {
  songId: string;
  title: string;
  author: string;
  key: string;
  play_key: string;
}

interface ExistingProposal {
  _id: string;
  status: ProposalStatus;
  lead_notes?: string;
  admin_notes?: string;
  songs?: Array<{
    song_id: string;
    title: string;
    author: string;
    key: string;
    play_key: string;
  }>;
}

interface RoleDoc {
  _id: string;
  _type: string;
  week?: string;
  date?: string;
  service_name?: string;
  service_type: "sunday" | "saturday" | "special";
  service_date: string;
}

interface Props {
  roleDoc: RoleDoc;
  existingProposal: ExistingProposal | null;
}

// ─── Key options ─────────────────────────────────────────────────────────────

const KEY_OPTIONS = [
  "A", "Am", "Bb", "Bbm", "B", "Bm", "C", "Cm", "C#", "C#m",
  "D", "Dm", "Eb", "Ebm", "E", "Em", "F", "Fm", "F#", "F#m",
  "G", "Gm", "Ab", "Abm",
];

// ─── Status badge ─────────────────────────────────────────────────────────────

const STATUS_LABEL: Record<ProposalStatus, string> = {
  draft: "Borrador",
  pending: "Pendiente de revisión",
  approved: "Aprobada",
  changes_requested: "Cambios solicitados",
};

const STATUS_STYLE: Record<ProposalStatus, string> = {
  draft: "bg-gray-500/15 text-gray-400 border border-gray-500/30",
  pending: "bg-yellow-500/15 text-yellow-400 border border-yellow-500/30",
  approved: "bg-green-500/15 text-green-400 border border-green-500/30",
  changes_requested: "bg-red-500/15 text-red-400 border border-red-500/30",
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

function formatServiceDate(dateStr: string): string {
  const [y, m, d] = dateStr.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString("es-MX", {
    weekday: "long", year: "numeric", month: "long", day: "numeric", timeZone: "UTC",
  });
}

function capitalize(s: string) {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

// ─── Component ────────────────────────────────────────────────────────────────

export default function ProposalEditor({ roleDoc, existingProposal }: Props) {
  const router = useRouter();

  const [songs, setSongs] = useState<ProposalSong[]>(() => {
    if (!existingProposal?.songs?.length) return [];
    return existingProposal.songs.map(s => ({
      songId: s.song_id,
      title: s.title,
      author: s.author,
      key: s.key,
      play_key: s.play_key || s.key,
    }));
  });

  const [leadNotes, setLeadNotes] = useState(existingProposal?.lead_notes ?? "");
  const [status, setStatus] = useState<ProposalStatus>(existingProposal?.status ?? "draft");
  const [saving, setSaving] = useState(false);
  const [toast, setToast] = useState<{ msg: string; ok: boolean } | null>(null);

  // Drag-and-drop state
  const dragIdx = useRef<number | null>(null);
  const [dragOverIdx, setDragOverIdx] = useState<number | null>(null);

  const onDragStart = (idx: number) => { dragIdx.current = idx; };
  const onDragOver = (e: React.DragEvent, idx: number) => {
    e.preventDefault();
    setDragOverIdx(idx);
  };
  const onDrop = (targetIdx: number) => {
    const from = dragIdx.current;
    if (from === null || from === targetIdx) { setDragOverIdx(null); return; }
    setSongs(prev => {
      const next = [...prev];
      const [item] = next.splice(from, 1);
      next.splice(targetIdx, 0, item);
      return next;
    });
    dragIdx.current = null;
    setDragOverIdx(null);
  };
  const onDragEnd = () => { dragIdx.current = null; setDragOverIdx(null); };

  // Song search state
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState<SongResult[]>([]);
  const [searching, setSearching] = useState(false);
  const [showSearch, setShowSearch] = useState(false);
  const searchRef = useRef<HTMLDivElement>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const showToast = (msg: string, ok = true) => {
    setToast({ msg, ok });
    setTimeout(() => setToast(null), 3000);
  };

  // Close search dropdown on outside click
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (searchRef.current && !searchRef.current.contains(e.target as Node)) {
        setShowSearch(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  // Debounced song search
  const search = useCallback((q: string) => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(async () => {
      setSearching(true);
      try {
        const res = await fetch(`/api/me/songs?q=${encodeURIComponent(q)}`);
        const data: SongResult[] = await res.json();
        setSearchResults(data);
      } finally {
        setSearching(false);
      }
    }, 300);
  }, []);

  useEffect(() => {
    search(searchQuery);
  }, [searchQuery, search]);

  useEffect(() => {
    if (!showSearch && searchResults.length === 0) {
      search("");
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showSearch]);

  const addSong = (song: SongResult) => {
    if (songs.some(s => s.songId === song._id)) return;
    setSongs(prev => [...prev, {
      songId: song._id,
      title: song.title,
      author: song.author,
      key: song.key,
      play_key: song.key,
    }]);
    setShowSearch(false);
    setSearchQuery("");
  };

  const removeSong = (idx: number) => {
    setSongs(prev => prev.filter((_, i) => i !== idx));
  };

  const setPlayKey = (idx: number, play_key: string) => {
    setSongs(prev => prev.map((s, i) => i === idx ? { ...s, play_key } : s));
  };

  const save = async (submitStatus: "draft" | "pending") => {
    setSaving(true);
    try {
      const res = await fetch("/api/me/proposals", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          roleId: roleDoc._id,
          serviceType: roleDoc.service_type,
          serviceDate: roleDoc.service_date,
          songs: songs.map(s => ({ songId: s.songId, play_key: s.play_key })),
          leadNotes,
          status: submitStatus,
        }),
      });

      if (!res.ok) throw new Error();
      const data: { status: ProposalStatus } = await res.json();
      setStatus(data.status);
      showToast(submitStatus === "pending" ? "Propuesta enviada" : "Borrador guardado");
      router.refresh();
    } catch {
      showToast("Error al guardar", false);
    } finally {
      setSaving(false);
    }
  };

  const isApproved = status === "approved";
  const serviceLabel =
    roleDoc.service_type === "sunday" ? "Domingo" :
    roleDoc.service_type === "saturday" ? "Sábado" :
    (roleDoc.service_name ?? "Servicio Especial");

  // ─── Input styles ────────────────────────────────────────────────────────────
  const inputCls = "w-full px-3 py-2 rounded-lg border border-[#00bfff]/20 bg-transparent font-body text-sm focus:outline-none focus:border-[#00bfff] transition-colors placeholder:text-gray-600";
  const selectCls = "px-2 py-1 rounded-lg border border-[#00bfff]/20 bg-[#010b17] dark:bg-[#010b17] font-body text-sm focus:outline-none focus:border-[#00bfff] transition-colors";

  return (
    <div className="space-y-8">

      {/* Header */}
      <div>
        <button
          onClick={() => router.push("/me")}
          className="flex items-center gap-1.5 font-label text-xs uppercase tracking-widest text-gray-500 hover:text-[#00bfff] transition-colors mb-5"
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M19 12H5M12 5l-7 7 7 7" />
          </svg>
          Volver
        </button>

        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div>
            <h1 className="font-display text-2xl md:text-3xl font-bold">Propuesta de Setlist</h1>
            <p className="font-body text-sm text-gray-400 mt-1">
              {serviceLabel} · {capitalize(formatServiceDate(roleDoc.service_date))}
            </p>
          </div>
          <span className={`font-label text-xs uppercase tracking-widest px-3 py-1.5 rounded-full shrink-0 ${STATUS_STYLE[status]}`}>
            {STATUS_LABEL[status]}
          </span>
        </div>
      </div>

      {/* Admin notes banner (when changes requested) */}
      {status === "changes_requested" && existingProposal?.admin_notes && (
        <div className="rounded-xl border border-red-500/30 bg-red-500/10 p-4 space-y-1">
          <p className="font-label text-xs uppercase tracking-widest text-red-400">Comentarios del admin</p>
          <p className="font-body text-sm text-red-300 whitespace-pre-wrap">{existingProposal.admin_notes}</p>
        </div>
      )}

      {/* Song list */}
      <div className="space-y-3">
        <h2 className="font-label text-xs uppercase tracking-widest text-gray-500">Lista de canciones</h2>

        {songs.length === 0 && (
          <p className="font-body text-sm text-gray-500 py-4 text-center">
            Agrega canciones usando el buscador abajo.
          </p>
        )}

        {songs.map((song, idx) => (
          <div
            key={song.songId}
            draggable={!isApproved}
            onDragStart={() => onDragStart(idx)}
            onDragOver={e => onDragOver(e, idx)}
            onDrop={() => onDrop(idx)}
            onDragEnd={onDragEnd}
            className={`flex items-center gap-3 px-4 py-3 rounded-xl border transition-all ${
              dragOverIdx === idx && dragIdx.current !== idx
                ? "border-[#00bfff]/60 bg-[#00bfff]/10 scale-[1.01]"
                : "border-[#003572]/15 dark:border-[#00bfff]/10 bg-[#003572]/5 dark:bg-[#00bfff]/5"
            } ${!isApproved ? "cursor-grab active:cursor-grabbing" : ""}`}
          >
            {/* Drag handle */}
            {!isApproved && (
              <span className="text-gray-600 shrink-0 select-none">
                <GripIcon />
              </span>
            )}

            {/* Position */}
            <span className="font-label text-xs text-gray-500 w-5 text-center shrink-0">{idx + 1}</span>

            {/* Song info */}
            <div className="flex-1 min-w-0">
              <p className="font-body text-sm font-semibold truncate">{song.title}</p>
              <p className="font-body text-xs text-gray-400 truncate">{song.author}</p>
            </div>

            {/* Key select */}
            {!isApproved && (
              <select
                value={song.play_key}
                onChange={e => setPlayKey(idx, e.target.value)}
                className={selectCls}
                title="Tonalidad"
                onMouseDown={e => e.stopPropagation()}
              >
                {KEY_OPTIONS.map(k => (
                  <option key={k} value={k}>{k}</option>
                ))}
                {!KEY_OPTIONS.includes(song.play_key) && (
                  <option value={song.play_key}>{song.play_key}</option>
                )}
              </select>
            )}
            {isApproved && (
              <span className="font-label text-xs px-2 py-0.5 rounded-full border border-[#00bfff]/20 text-[#00bfff]">
                {song.play_key}
              </span>
            )}

            {/* Remove */}
            {!isApproved && (
              <button
                onClick={() => removeSong(idx)}
                className="p-1.5 rounded-lg text-gray-500 hover:text-red-400 hover:bg-red-500/10 transition-colors shrink-0"
                title="Quitar"
              >
                <XIcon />
              </button>
            )}
          </div>
        ))}

        {/* Song search */}
        {!isApproved && (
          <div ref={searchRef} className="relative">
            <div
              className="flex items-center gap-2 px-4 py-3 rounded-xl border border-dashed border-[#00bfff]/25 hover:border-[#00bfff]/50 transition-colors cursor-pointer"
              onClick={() => setShowSearch(true)}
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-[#00bfff] shrink-0">
                <line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" />
              </svg>
              <span className="font-label text-xs uppercase tracking-widest text-gray-500">Agregar canción</span>
            </div>

            {showSearch && (
              <div className="absolute top-full left-0 right-0 mt-1 z-20 rounded-xl border border-[#00bfff]/20 bg-[#020f1c] dark:bg-[#020f1c] shadow-2xl overflow-hidden">
                <div className="p-2 border-b border-[#00bfff]/10">
                  <input
                    autoFocus
                    className={inputCls}
                    placeholder="Buscar canción…"
                    value={searchQuery}
                    onChange={e => setSearchQuery(e.target.value)}
                  />
                </div>
                <div className="max-h-64 overflow-y-auto">
                  {searching && (
                    <p className="font-body text-sm text-gray-500 text-center py-4">Buscando…</p>
                  )}
                  {!searching && searchResults.length === 0 && (
                    <p className="font-body text-sm text-gray-500 text-center py-4">Sin resultados</p>
                  )}
                  {!searching && searchResults.map(song => {
                    const already = songs.some(s => s.songId === song._id);
                    return (
                      <button
                        key={song._id}
                        onClick={() => !already && addSong(song)}
                        disabled={already}
                        className={`w-full flex items-center gap-3 px-4 py-3 text-left transition-colors ${
                          already
                            ? "opacity-40 cursor-not-allowed"
                            : "hover:bg-[#00bfff]/5"
                        }`}
                      >
                        <div className="flex-1 min-w-0">
                          <p className="font-body text-sm font-semibold truncate">{song.title}</p>
                          <p className="font-body text-xs text-gray-400 truncate">{song.author}</p>
                        </div>
                        <span className="font-label text-xs text-gray-500 shrink-0">{song.key}</span>
                        {already && <span className="font-label text-[10px] text-gray-500">En lista</span>}
                      </button>
                    );
                  })}
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Lead notes */}
      {!isApproved && (
        <div className="space-y-2">
          <label className="font-label text-xs uppercase tracking-widest text-gray-500">
            Notas para revisión <span className="normal-case tracking-normal text-gray-600">(opcional)</span>
          </label>
          <textarea
            className={`${inputCls} resize-none`}
            rows={3}
            placeholder="Contexto, temas del mensaje, peticiones especiales…"
            value={leadNotes}
            onChange={e => setLeadNotes(e.target.value)}
          />
        </div>
      )}

      {isApproved && leadNotes && (
        <div className="space-y-1">
          <p className="font-label text-xs uppercase tracking-widest text-gray-500">Tus notas</p>
          <p className="font-body text-sm text-gray-300 whitespace-pre-wrap">{leadNotes}</p>
        </div>
      )}

      {/* Actions */}
      {!isApproved && (
        <div className="flex gap-3 pt-2">
          <button
            onClick={() => save("draft")}
            disabled={saving}
            className="flex-1 py-2.5 rounded-lg border border-[#003572]/30 dark:border-[#00bfff]/20 font-label text-xs uppercase tracking-widest hover:border-[#00bfff] transition-colors disabled:opacity-50"
          >
            {saving ? "Guardando…" : "Guardar borrador"}
          </button>
          <button
            onClick={() => save("pending")}
            disabled={saving || songs.length === 0}
            className="flex-1 py-2.5 rounded-lg bg-[#003572] dark:bg-[#00bfff]/20 hover:bg-[#003572]/80 dark:hover:bg-[#00bfff]/30 font-label text-xs uppercase tracking-widest transition-colors disabled:opacity-50"
          >
            {saving ? "Enviando…" : "Enviar propuesta"}
          </button>
        </div>
      )}

      {isApproved && (
        <div className="flex items-center gap-2 px-4 py-3 rounded-xl border border-green-500/20 bg-green-500/5">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-green-400 shrink-0">
            <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" />
            <polyline points="22 4 12 14.01 9 11.01" />
          </svg>
          <p className="font-label text-xs uppercase tracking-widest text-green-400">
            Propuesta aprobada — el setlist ha sido publicado
          </p>
        </div>
      )}

      {/* Toast */}
      {toast && (
        <div className={`fixed bottom-6 left-1/2 -translate-x-1/2 z-50 px-5 py-3 rounded-xl border font-label text-xs uppercase tracking-widest shadow-xl ${
          toast.ok
            ? "bg-[#003572] dark:bg-[#0a1929] border-[#00bfff]/30"
            : "bg-red-900/80 border-red-500/30"
        }`}>
          {toast.msg}
        </div>
      )}
    </div>
  );
}

// ─── Icon helpers ─────────────────────────────────────────────────────────────
function GripIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <line x1="8" y1="6" x2="21" y2="6" /><line x1="8" y1="12" x2="21" y2="12" /><line x1="8" y1="18" x2="21" y2="18" />
      <line x1="3" y1="6" x2="3.01" y2="6" /><line x1="3" y1="12" x2="3.01" y2="12" /><line x1="3" y1="18" x2="3.01" y2="18" />
    </svg>
  );
}

function XIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
    </svg>
  );
}
