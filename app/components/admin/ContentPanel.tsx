"use client";

import { useState, useEffect, useCallback } from "react";
import {
  Modal,
  SongForm,
  SongTag,
  FormState,
  blankForm,
  songToForm,
  buildPayload,
} from "./SongFormModal";

// ─── Types ────────────────────────────────────────────────────────────────────

interface Song {
  _id: string;
  title: string;
  author: string;
  slug: { current: string };
  key?: string;
  bpm?: number;
  timeSig?: string;
  publishDate?: string;
  body?: any[];
  chords?: Array<{ key: string; content: string }>;
  referenceLinks?: Array<{ label: string; url: string }>;
  tags?: SongTag[];
}

type ModalState =
  | { type: "add" }
  | { type: "edit"; song: Song }
  | { type: "delete"; song: Song }
  | null;

// ─── Main panel ───────────────────────────────────────────────────────────────

export default function ContentPanel({ canDelete = false }: { canDelete?: boolean }) {
  const [songs, setSongs]     = useState<Song[]>([]);
  const [tags, setTags]       = useState<SongTag[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError]     = useState<string | null>(null);
  const [search, setSearch]   = useState("");
  const [modal, setModal]     = useState<ModalState>(null);
  const [submitting, setSubmitting] = useState(false);
  const [toast, setToast]     = useState<string | null>(null);

  const showToast = (msg: string) => {
    setToast(msg);
    setTimeout(() => setToast(null), 3000);
  };

  const fetchAll = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [songsRes, tagsRes] = await Promise.all([
        fetch("/api/content/posts"),
        fetch("/api/content/tags"),
      ]);
      if (!songsRes.ok || !tagsRes.ok) throw new Error();
      const [songsData, tagsData] = await Promise.all([songsRes.json(), tagsRes.json()]);
      setSongs(songsData);
      setTags(tagsData);
    } catch {
      setError("Error al cargar canciones.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchAll(); }, [fetchAll]);

  const handleCreateTag = async (name: string): Promise<SongTag | null> => {
    const res = await fetch("/api/content/tags", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name }),
    });
    if (!res.ok) return null;
    const tag = await res.json();
    setTags((prev) => [...prev, tag].sort((a, b) => a.name.localeCompare(b.name)));
    return tag;
  };

  const handleAdd = async (form: FormState) => {
    setSubmitting(true);
    const res = await fetch("/api/content/posts", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(buildPayload(form)),
    });
    setSubmitting(false);
    if (res.ok) { setModal(null); fetchAll(); showToast("Canción creada."); }
    else showToast("Error al crear canción.");
  };

  const handleEdit = async (form: FormState) => {
    if (modal?.type !== "edit") return;
    setSubmitting(true);
    const res = await fetch(`/api/content/posts/${modal.song._id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(buildPayload(form)),
    });
    setSubmitting(false);
    if (res.ok) { setModal(null); fetchAll(); showToast("Canción actualizada."); }
    else showToast("Error al actualizar.");
  };

  const handleDelete = async () => {
    if (modal?.type !== "delete") return;
    setSubmitting(true);
    const res = await fetch(`/api/content/posts/${modal.song._id}`, { method: "DELETE" });
    setSubmitting(false);
    if (res.ok) { setModal(null); fetchAll(); showToast("Canción eliminada."); }
    else showToast("Error al eliminar.");
  };

  const filtered = songs.filter((s) =>
    s.title.toLowerCase().includes(search.toLowerCase()) ||
    (s.author ?? "").toLowerCase().includes(search.toLowerCase())
  );

  // For edit modal: convert Song to the partial form shape SongForm expects
  const songToFormInitial = (song: Song): Partial<FormState> => songToForm(song);

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="font-display text-2xl uppercase tracking-wide">Canciones</h1>
          {!loading && (
            <p className="font-label text-xs uppercase tracking-widest text-gray-500 mt-0.5">
              {songs.length} {songs.length === 1 ? "canción" : "canciones"}
            </p>
          )}
        </div>
        <button
          onClick={() => setModal({ type: "add" })}
          className="flex items-center gap-2 px-4 py-2 rounded-lg bg-[#003572] dark:bg-[#00bfff]/20 hover:bg-[#003572]/80 dark:hover:bg-[#00bfff]/30 font-label text-xs uppercase tracking-widest transition-colors"
        >
          <span className="text-base leading-none">+</span>
          Agregar
        </button>
      </div>

      {/* Search */}
      <input
        className="w-full px-4 py-2.5 rounded-xl border border-[#003572]/20 dark:border-[#00bfff]/15 bg-transparent font-body text-sm focus:outline-none focus:border-[#00bfff] transition-colors"
        placeholder="Buscar canción o artista..."
        value={search}
        onChange={(e) => setSearch(e.target.value)}
      />

      {/* States */}
      {loading && (
        <div className="space-y-3">
          {[...Array(5)].map((_, i) => (
            <div key={i} className="h-16 rounded-xl bg-[#003572]/10 dark:bg-[#00bfff]/5 animate-pulse" />
          ))}
        </div>
      )}

      {error && (
        <p className="text-sm text-red-400 bg-red-900/20 border border-red-800 rounded-xl px-4 py-3">{error}</p>
      )}

      {/* Song list */}
      {!loading && !error && (
        <div className="space-y-2">
          {filtered.length === 0 && (
            <p className="font-body text-sm text-gray-500 text-center py-12">
              {search ? "Sin resultados." : "No hay canciones todavía."}
            </p>
          )}
          {filtered.map((song) => (
            <div
              key={song._id}
              className="flex items-center gap-4 px-4 py-3 rounded-xl border border-[#003572]/15 dark:border-[#00bfff]/10 bg-[#003572]/5 dark:bg-[#00bfff]/5 hover:border-[#003572]/30 dark:hover:border-[#00bfff]/20 transition-colors group"
            >
              {/* Icon */}
              <div className="w-9 h-9 rounded-lg bg-[#003572]/20 dark:bg-[#00bfff]/10 flex items-center justify-center shrink-0">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" className="text-[#00bfff]">
                  <path d="M9 18V5l12-2v13" /><circle cx="6" cy="18" r="3" /><circle cx="18" cy="16" r="3" />
                </svg>
              </div>

              {/* Info */}
              <div className="flex-1 min-w-0">
                <p className="font-body text-sm font-semibold truncate">{song.title}</p>
                <div className="flex items-center gap-2 flex-wrap mt-0.5">
                  {song.author && (
                    <span className="font-body text-xs text-gray-500 truncate">{song.author}</span>
                  )}
                  {(song.tags ?? []).map((tag) => (
                    <span key={tag._id} className="font-label text-[9px] uppercase tracking-widest px-1.5 py-0.5 rounded-full bg-[#003572]/10 dark:bg-[#00bfff]/10 text-gray-400 border border-[#003572]/15 dark:border-[#00bfff]/15">
                      #{tag.name}
                    </span>
                  ))}
                </div>
              </div>

              {/* Key badge */}
              {song.key && (
                <span className="font-label text-xs px-2.5 py-1 rounded-full border border-[#00bfff]/40 text-[#00bfff] shrink-0 hidden sm:inline">
                  {song.key}
                </span>
              )}

              {/* Actions */}
              <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                <ActionBtn title="Editar" onClick={() => setModal({ type: "edit", song })}>
                  <PencilIcon />
                </ActionBtn>
                {canDelete && (
                  <ActionBtn title="Eliminar" onClick={() => setModal({ type: "delete", song })} danger>
                    <TrashIcon />
                  </ActionBtn>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Toast */}
      {toast && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50 px-5 py-3 rounded-xl bg-[#003572] dark:bg-[#0a1929] border border-[#00bfff]/30 font-label text-xs uppercase tracking-widest shadow-xl">
          {toast}
        </div>
      )}

      {/* ── Modals ── */}
      {(modal?.type === "add" || modal?.type === "edit") && (
        <Modal
          title={modal.type === "add" ? "Nueva canción" : "Editar canción"}
          onClose={() => setModal(null)}
        >
          <SongForm
            initial={modal.type === "edit" ? songToFormInitial(modal.song) : undefined}
            allTags={tags}
            onSubmit={modal.type === "add" ? handleAdd : handleEdit}
            onClose={() => setModal(null)}
            loading={submitting}
            canCreateTag={handleCreateTag}
          />
        </Modal>
      )}

      {modal?.type === "delete" && (
        <Modal title="Eliminar canción" onClose={() => setModal(null)}>
          <p className="font-body text-sm text-gray-400">
            ¿Eliminar <span className="text-red-400 font-semibold">{modal.song.title}</span>? Esta acción no se puede deshacer.
          </p>
          <div className="flex gap-3 pt-1">
            <button onClick={() => setModal(null)} className="flex-1 py-2 rounded-lg border border-[#003572]/30 dark:border-[#00bfff]/20 font-label text-xs uppercase tracking-widest hover:border-[#00bfff] transition-colors">
              Cancelar
            </button>
            <button onClick={handleDelete} disabled={submitting} className="flex-1 py-2 rounded-lg bg-red-800/60 hover:bg-red-700/60 font-label text-xs uppercase tracking-widest transition-colors disabled:opacity-50">
              {submitting ? "Eliminando..." : "Eliminar"}
            </button>
          </div>
        </Modal>
      )}
    </div>
  );
}

// ─── Small helpers ────────────────────────────────────────────────────────────

function ActionBtn({ onClick, title, danger, children }: { onClick: () => void; title: string; danger?: boolean; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      title={title}
      className={`p-1.5 rounded-lg transition-colors ${danger ? "hover:bg-red-500/20 hover:text-red-400 text-gray-500" : "hover:bg-[#00bfff]/10 hover:text-[#00bfff] text-gray-500"}`}
    >
      {children}
    </button>
  );
}

function PencilIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
      <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" />
    </svg>
  );
}

function TrashIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="3 6 5 6 21 6" />
      <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
      <path d="M10 11v6M14 11v6" />
      <path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2" />
    </svg>
  );
}
