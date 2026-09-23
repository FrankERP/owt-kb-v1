"use client";

import { useState, useEffect, useCallback } from "react";
import type { PortableTextBody } from "@/app/utils/interface";
import {
  SongForm,
  SongTag,
  FormState,
  songToForm,
  buildPayload,
} from "./SongFormModal";
import Button from "../ui/Button";
import CueDialog from "../ui/CueDialog";
import CueDialogStatus from "../ui/CueDialogStatus";
import Skeleton, { SkeletonGroup } from "../ui/Skeleton";
import { useToast } from "../ui/Toast";
import { writeErrorMessage } from "@/app/utils/writeError";

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
  body?: PortableTextBody;
  chords?: Array<{ _key?: string; key: string; content: string }>;
  referenceLinks?: Array<{ label: string; url: string }>;
  tags?: SongTag[];
  authors?: Array<{ _id: string; name: string }>;
}

/**
 * Which song dialog the panel is showing. The KIND and its song are held apart
 * from the open flag on purpose (the shape R5 Tasks 3-4 established): `CueDialog`
 * stays mounted for the whole exit, so a body read out of a state that closing
 * sets to `null` blanks itself on the way out — the admin watches the song's
 * title vanish before the sheet does. Closing flips `modalOpen` only; the next
 * open overwrites the payload, and `modalSeq` (part of each body's key) makes a
 * REOPEN a fresh form rather than the text left in the last one.
 */
type ModalKind = "add" | "edit" | "delete";

// ─── Main panel ───────────────────────────────────────────────────────────────

export default function ContentPanel({ canDelete = false }: { canDelete?: boolean }) {
  const [songs, setSongs]       = useState<Song[]>([]);
  const [tags, setTags]         = useState<SongTag[]>([]);
  const [authors, setAuthors]   = useState<SongTag[]>([]);
  const [loading, setLoading]   = useState(true);
  const [error, setError]     = useState<string | null>(null);
  const [search, setSearch]   = useState("");
  const [modalKind, setModalKind] = useState<ModalKind>("add");
  const [modalSong, setModalSong] = useState<Song | null>(null);
  const [modalOpen, setModalOpen] = useState(false);
  const [modalSeq, setModalSeq]   = useState(0);
  const [modalError, setModalError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const { toast } = useToast();
  const showToast = useCallback((msg: string) => toast({ message: msg }), [toast]);

  const fetchAll = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [songsRes, tagsRes, authorsRes] = await Promise.all([
        fetch("/api/content/posts"),
        fetch("/api/content/tags"),
        fetch("/api/content/authors"),
      ]);
      if (!songsRes.ok || !tagsRes.ok || !authorsRes.ok) throw new Error();
      const [songsData, tagsData, authorsData] = await Promise.all([songsRes.json(), tagsRes.json(), authorsRes.json()]);
      setSongs(songsData);
      setTags(tagsData);
      setAuthors(authorsData);
    } catch {
      setError("Error al cargar canciones.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchAll(); }, [fetchAll]);

  const openModal = (kind: ModalKind, song: Song | null = null) => {
    setModalError(null);
    setModalKind(kind);
    setModalSong(song);
    setModalSeq((n) => n + 1);
    setModalOpen(true);
  };
  // The song and the kind stay: `CueDialog` is still on screen for its exit.
  const closeModal = () => {
    setModalError(null);
    setModalOpen(false);
  };

  const handleCreateTag = async (name: string): Promise<SongTag | null> => {
    try {
      const res = await fetch("/api/content/tags", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name }),
      });
      if (!res.ok) throw new Error();
      const tag = await res.json();
      setTags((prev) => [...prev, tag].sort((a, b) => a.name.localeCompare(b.name)));
      setModalError(null);
      return tag;
    } catch {
      setModalError("No se pudo crear el tag.");
      return null;
    }
  };

  const handleCreateAuthor = async (name: string): Promise<SongTag | null> => {
    try {
      const res = await fetch("/api/content/authors", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name }),
      });
      if (!res.ok) throw new Error();
      const author = await res.json();
      setAuthors((prev) => [...prev, author].sort((a, b) => a.name.localeCompare(b.name)));
      setModalError(null);
      return author;
    } catch {
      setModalError("No se pudo crear el artista.");
      return null;
    }
  };

  const handleAdd = async (form: FormState) => {
    setSubmitting(true);
    try {
      const res = await fetch("/api/content/posts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(buildPayload(form)),
      });
      if (res.ok) { closeModal(); fetchAll(); showToast("Canción creada."); }
      else setModalError(await writeErrorMessage(res) ?? "Error al crear canción.");
    } catch {
      setModalError("Error de conexión.");
    } finally {
      setSubmitting(false);
    }
  };

  const handleEdit = async (form: FormState) => {
    if (!modalSong) return;
    setSubmitting(true);
    try {
      const res = await fetch(`/api/content/posts/${modalSong._id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(buildPayload(form)),
      });
      if (res.ok) { closeModal(); fetchAll(); showToast("Canción actualizada."); }
      else setModalError(await writeErrorMessage(res) ?? "Error al actualizar.");
    } catch {
      setModalError("Error de conexión.");
    } finally {
      setSubmitting(false);
    }
  };

  const handleDelete = async () => {
    if (!modalSong) return;
    setSubmitting(true);
    try {
      const res = await fetch(`/api/content/posts/${modalSong._id}`, { method: "DELETE" });
      if (res.ok) { closeModal(); fetchAll(); showToast("Canción eliminada."); }
      else setModalError("Error al eliminar.");
    } catch {
      setModalError("Error de conexión.");
    } finally {
      setSubmitting(false);
    }
  };

  const filtered = songs.filter((s) =>
    s.title.toLowerCase().includes(search.toLowerCase()) ||
    (s.author ?? "").toLowerCase().includes(search.toLowerCase())
  );

  // For edit modal: convert Song to the partial form shape SongForm expects
  const songToFormInitial = (song: Song): Partial<FormState> => songToForm(song);

  // Derived from the KIND, which outlives the close — so the header does not
  // change wording halfway through the sheet's exit.
  const formTitle = modalKind === "edit" ? "Editar canción" : "Nueva canción";

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="font-display text-2xl uppercase tracking-wide">Canciones</h1>
          {!loading && (
            <p className="font-label text-xs uppercase tracking-widest text-mono-500 mt-0.5">
              {songs.length} {songs.length === 1 ? "canción" : "canciones"}
            </p>
          )}
        </div>
        <Button variant="primary" size="lg" onClick={() => openModal("add")}>
          <span className="text-base leading-none">+</span>
          Agregar
        </Button>
      </div>

      {/* Search — 16px on the phone, or iOS Safari zooms the page on focus and
          never zooms back (`inputFontSize.test.ts` excludes `admin/` by path). */}
      <input
        className="w-full px-4 py-2.5 rounded-xl border border-surface-accent-20 bg-transparent font-body text-[16px] sm:text-sm focus:outline-none focus:border-accent dark:focus:border-surface-accent-20 transition-colors"
        placeholder="Buscar canción o artista..."
        value={search}
        onChange={(e) => setSearch(e.target.value)}
      />

      {/* States */}
      {loading && (
        <SkeletonGroup label="Cargando canciones" className="space-y-3">
          {[...Array(5)].map((_, i) => (
            <Skeleton key={i} className="h-16 w-full" rounded="lg" />
          ))}
        </SkeletonGroup>
      )}

      {error && (
        <p className="text-sm text-negative-fg bg-negative-surface-deep/20 border border-negative-surface rounded-xl px-4 py-3">{error}</p>
      )}

      {/* Song list */}
      {!loading && !error && (
        <div className="space-y-2">
          {filtered.length === 0 && (
            <p className="font-body text-sm text-mono-500 text-center py-12">
              {search ? "Sin resultados." : "No hay canciones todavía."}
            </p>
          )}
          {filtered.map((song) => (
            <div
              key={song._id}
              className="flex items-center gap-4 px-4 py-3 rounded-xl border border-edge-accent-subtle bg-accent/5 hover:border-accent-deep/30 dark:hover:border-accent/20 transition-colors group"
            >
              {/* Icon */}
              <div className="w-9 h-9 rounded-lg bg-surface-accent-faint flex items-center justify-center shrink-0">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" className="text-accent">
                  <path d="M9 18V5l12-2v13" /><circle cx="6" cy="18" r="3" /><circle cx="18" cy="16" r="3" />
                </svg>
              </div>

              {/* Info */}
              <div className="flex-1 min-w-0">
                <p className="font-body text-sm font-semibold truncate">{song.title}</p>
                <div className="flex items-center gap-2 flex-wrap mt-0.5">
                  {song.author && (
                    <span className="font-body text-xs text-mono-500 truncate">{song.author}</span>
                  )}
                  {(song.tags ?? []).map((tag) => (
                    <span key={tag._id} className="font-label text-[10px] uppercase tracking-widest px-1.5 py-0.5 rounded-full bg-accent/10 text-mono-400 border border-accent/15">
                      #{tag.name}
                    </span>
                  ))}
                </div>
              </div>

              {/* Key badge */}
              {song.key && (
                <span className="font-label text-xs px-2.5 py-1 rounded-full border border-accent/40 text-accent shrink-0 hidden sm:inline">
                  {song.key}
                </span>
              )}

              {/*
                Actions. A hover-only affordance does not exist on a phone: there
                is no hover state to enter, so `opacity-0 group-hover:opacity-100`
                hid Editar and Eliminar from every touch admin permanently. They
                are visible by default and only fade behind hover FROM `sm` up —
                where `focus-within` brings them back for the keyboard, which the
                hover-only spelling excluded at every width.
              */}
              <div className="flex items-center gap-1 opacity-100 sm:opacity-0 sm:group-hover:opacity-100 sm:focus-within:opacity-100 transition-opacity duration-fast ease-out-brand">
                {/* `size="lg"` on the icon variant is the house 44px target — the
                    actions are reachable by touch now, so they have to be hittable. */}
                <Button variant="icon" size="lg" title="Editar" aria-label="Editar" onClick={() => openModal("edit", song)}>
                  <PencilIcon />
                </Button>
                {canDelete && (
                  <Button
                    variant="icon"
                    size="lg"
                    tone="danger"
                    title="Eliminar"
                    aria-label="Eliminar"
                    onClick={() => openModal("delete", song)}
                  >
                    <TrashIcon />
                  </Button>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* ── Modals — mounted always, opened by their own boolean ── */}
      <CueDialog
        open={modalOpen && modalKind !== "delete"}
        title={formTitle}
        label={formTitle}
        mode="sheet"
        size="lg"
        onDismiss={closeModal}
      >
        <div key={`form-${modalSeq}`} className="min-h-0 flex-1 space-y-5 overflow-y-auto p-6">
          {modalError && <CueDialogStatus tone="error">{modalError}</CueDialogStatus>}
          <SongForm
            initial={modalKind === "edit" && modalSong ? songToFormInitial(modalSong) : undefined}
            allTags={tags}
            allAuthors={authors}
            onSubmit={modalKind === "add" ? handleAdd : handleEdit}
            onClose={closeModal}
            loading={submitting}
            canCreateTag={handleCreateTag}
            canCreateAuthor={handleCreateAuthor}
          />
        </div>
      </CueDialog>

      <CueDialog
        open={modalOpen && modalKind === "delete"}
        title="Eliminar canción"
        label="Eliminar canción"
        mode="sheet"
        size="sm"
        onDismiss={closeModal}
      >
        <div key={`delete-${modalSeq}`} className="space-y-5 p-6">
          {modalError && <CueDialogStatus tone="error">{modalError}</CueDialogStatus>}
          <p className="font-body text-sm text-mono-400">
            ¿Eliminar <span className="text-negative-fg font-semibold">{modalSong?.title ?? ""}</span>? Esta acción no se puede deshacer.
          </p>
          <div className="flex gap-3 pt-1">
            <Button variant="secondary" className="flex-1" onClick={closeModal}>Cancelar</Button>
            <Button variant="danger" className="flex-1" busy={submitting} busyLabel="Eliminando..." onClick={handleDelete}>
              Eliminar
            </Button>
          </div>
        </div>
      </CueDialog>
    </div>
  );
}

// ─── Small helpers ────────────────────────────────────────────────────────────

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
