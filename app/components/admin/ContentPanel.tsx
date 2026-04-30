"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { bodyToLyrics } from "@/app/utils/lyrics";

// ─── Types ────────────────────────────────────────────────────────────────────

interface SongTag {
  _id: string;
  name: string;
  slug: { current: string };
}

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

interface FormState {
  title: string;
  author: string;
  key: string;
  bpm: string;
  timeSig: string;
  lyrics: string;
  chords: Array<{ key: string; content: string }>;
  referenceLinks: Array<{ label: string; url: string }>;
  tagIds: string[];
}

type ModalState =
  | { type: "add" }
  | { type: "edit"; song: Song }
  | { type: "delete"; song: Song }
  | null;

// ─── Helpers ──────────────────────────────────────────────────────────────────

function blankForm(): FormState {
  return { title: "", author: "", key: "", bpm: "", timeSig: "", lyrics: "", chords: [], referenceLinks: [], tagIds: [] };
}

function songToForm(song: Song): FormState {
  return {
    title:          song.title ?? "",
    author:         song.author ?? "",
    key:            song.key ?? "",
    bpm:            song.bpm?.toString() ?? "",
    timeSig:        song.timeSig ?? "",
    lyrics:         bodyToLyrics(song.body),
    chords:         song.chords ?? [],
    referenceLinks: song.referenceLinks ?? [],
    tagIds:         song.tags?.map((t) => t._id) ?? [],
  };
}

// ─── Shared style ─────────────────────────────────────────────────────────────

const inputCls =
  "w-full px-3 py-2 rounded-lg border border-[#00bfff]/20 bg-transparent font-body text-sm focus:outline-none focus:border-[#00bfff] transition-colors";

const selectCls =
  "w-full px-3 py-2 rounded-lg border border-[#00bfff]/20 bg-[#010b17] dark:bg-[#010b17] font-body text-sm focus:outline-none focus:border-[#00bfff] transition-colors";

// ─── Modal wrapper ────────────────────────────────────────────────────────────

function Modal({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) {
  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center pt-4 px-4 pb-4">
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onClose} />
      <div className="relative z-10 w-full max-w-2xl bg-[#C8D8EB] dark:bg-[#0a1929] border border-[#003572]/20 dark:border-[#00bfff]/20 rounded-xl shadow-2xl flex flex-col max-h-[calc(100vh-2rem)]">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-[#003572]/15 dark:border-[#00bfff]/10 shrink-0">
          <h2 className="font-display text-lg uppercase tracking-wide">{title}</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-[#00bfff] transition-colors text-xl leading-none">×</button>
        </div>
        {/* Scrollable body */}
        <div className="overflow-y-auto p-6 space-y-5 flex-1">{children}</div>
      </div>
    </div>
  );
}

const SECTION_LABELS = ["Intro", "Verso", "Pre-Coro", "Coro", "Puente", "Outro"];

// ─── Song form ────────────────────────────────────────────────────────────────

function SongForm({
  initial,
  allTags,
  onSubmit,
  onClose,
  loading,
  canCreateTag,
}: {
  initial?: Song;
  allTags: SongTag[];
  onSubmit: (form: FormState) => void;
  onClose: () => void;
  loading: boolean;
  canCreateTag: (name: string) => Promise<SongTag | null>;
}) {
  const [form, setForm]               = useState<FormState>(() => initial ? songToForm(initial) : blankForm());
  const [newTag, setNewTag]           = useState("");
  const [creatingTag, setCreatingTag] = useState(false);
  const [localTags, setLocalTags]     = useState<SongTag[]>(allTags);
  const lyricsRef                     = useRef<HTMLTextAreaElement>(null);

  const set = (key: keyof FormState) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
    setForm((f) => ({ ...f, [key]: e.target.value }));

  const toggleTag = (id: string) =>
    setForm((f) => ({
      ...f,
      tagIds: f.tagIds.includes(id) ? f.tagIds.filter((t) => t !== id) : [...f.tagIds, id],
    }));

  const addChordChart = () =>
    setForm((f) => ({ ...f, chords: [...f.chords, { key: "", content: "" }] }));

  const updateChord = (i: number, field: "key" | "content", val: string) =>
    setForm((f) => {
      const chords = [...f.chords];
      chords[i] = { ...chords[i], [field]: val };
      return { ...f, chords };
    });

  const removeChord = (i: number) =>
    setForm((f) => ({ ...f, chords: f.chords.filter((_, j) => j !== i) }));

  const addRefLink = () =>
    setForm((f) => ({ ...f, referenceLinks: [...f.referenceLinks, { label: "", url: "" }] }));

  const updateRefLink = (i: number, key: "label" | "url", val: string) =>
    setForm((f) => {
      const links = [...f.referenceLinks];
      links[i] = { ...links[i], [key]: val };
      return { ...f, referenceLinks: links };
    });

  const removeRefLink = (i: number) =>
    setForm((f) => ({ ...f, referenceLinks: f.referenceLinks.filter((_, j) => j !== i) }));

  const handleCreateTag = async () => {
    if (!newTag.trim()) return;
    setCreatingTag(true);
    const tag = await canCreateTag(newTag.trim());
    if (tag) {
      setLocalTags((prev) => [...prev, tag].sort((a, b) => a.name.localeCompare(b.name)));
      setForm((f) => ({ ...f, tagIds: [...f.tagIds, tag._id] }));
      setNewTag("");
    }
    setCreatingTag(false);
  };

  // Insert `# Label` at cursor, adding surrounding newlines as needed.
  // Focus is preserved via onPointerDown preventDefault on toolbar buttons.
  const insertLabel = (label: string) => {
    const ta = lyricsRef.current;
    if (!ta) return;
    const { selectionStart: pos } = ta;
    const text   = form.lyrics;
    const before = text.slice(0, pos);
    const after  = text.slice(pos);
    const prefix = before.length > 0 && !before.endsWith("\n") ? "\n" : "";
    const suffix = after.length > 0 && !after.startsWith("\n") ? "\n" : "";
    const insert = `${prefix}# ${label}${suffix}`;
    const newPos = before.length + insert.length;
    setForm((f) => ({ ...f, lyrics: before + insert + after }));
    requestAnimationFrame(() => ta.setSelectionRange(newPos, newPos));
  };

  // Wrap selected text with a marker (** or *), or place empty markers at cursor.
  const wrapSelection = (marker: string) => {
    const ta = lyricsRef.current;
    if (!ta) return;
    const { selectionStart: start, selectionEnd: end } = ta;
    const text     = form.lyrics;
    const selected = text.slice(start, end);
    const wrapped  = `${marker}${selected}${marker}`;
    setForm((f) => ({ ...f, lyrics: text.slice(0, start) + wrapped + text.slice(end) }));
    requestAnimationFrame(() =>
      selected
        ? ta.setSelectionRange(start, start + wrapped.length)
        : ta.setSelectionRange(start + marker.length, start + marker.length)
    );
  };

  return (
    <form onSubmit={(e) => { e.preventDefault(); onSubmit(form); }} className="space-y-5">
      {/* Title + Author */}
      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-1">
          <label className="font-label text-xs uppercase tracking-widest text-gray-500">Título *</label>
          <input className={inputCls} value={form.title} onChange={set("title")} required placeholder="Nombre de la canción" />
        </div>
        <div className="space-y-1">
          <label className="font-label text-xs uppercase tracking-widest text-gray-500">Artista</label>
          <input className={inputCls} value={form.author} onChange={set("author")} placeholder="Artista / Banda" />
        </div>
      </div>

      {/* Key + BPM + Time Sig */}
      <div className="grid grid-cols-3 gap-3">
        <div className="space-y-1">
          <label className="font-label text-xs uppercase tracking-widest text-gray-500">Tonalidad</label>
          <input className={inputCls} value={form.key} onChange={set("key")} placeholder="Ej: C, Am" />
        </div>
        <div className="space-y-1">
          <label className="font-label text-xs uppercase tracking-widest text-gray-500">BPM</label>
          <input className={inputCls} type="number" value={form.bpm} onChange={set("bpm")} placeholder="120" />
        </div>
        <div className="space-y-1">
          <label className="font-label text-xs uppercase tracking-widest text-gray-500">Comp.</label>
          <input className={inputCls} value={form.timeSig} onChange={set("timeSig")} placeholder="4/4" />
        </div>
      </div>

      {/* Lyrics */}
      <div className="space-y-0">
        <label className="font-label text-xs uppercase tracking-widest text-gray-500 block mb-1">Letra</label>

        {/* Toolbar */}
        <div className="flex items-center gap-1 flex-wrap px-2 py-1.5 rounded-t-lg border border-[#00bfff]/20 border-b-0 bg-[#003572]/5 dark:bg-[#00bfff]/5">
          {/* Section label buttons */}
          {SECTION_LABELS.map((label) => (
            <button
              key={label}
              type="button"
              onPointerDown={(e) => e.preventDefault()}
              onClick={() => insertLabel(label)}
              className="font-label text-[9px] uppercase tracking-widest px-2 py-1 rounded border border-[#003572]/20 dark:border-[#00bfff]/15 text-gray-500 hover:text-[#00bfff] hover:border-[#00bfff]/40 transition-colors whitespace-nowrap"
            >
              {label}
            </button>
          ))}
          {/* Divider */}
          <div className="w-px h-4 bg-[#003572]/20 dark:bg-[#00bfff]/20 mx-0.5 shrink-0" />
          {/* Bold */}
          <button
            type="button"
            onPointerDown={(e) => e.preventDefault()}
            onClick={() => wrapSelection("**")}
            title="Negrita — seleccionar texto y pulsar"
            className="font-body text-sm font-bold w-7 h-7 flex items-center justify-center rounded border border-[#003572]/20 dark:border-[#00bfff]/15 text-gray-500 hover:text-[#00bfff] hover:border-[#00bfff]/40 transition-colors shrink-0"
          >
            B
          </button>
          {/* Italic */}
          <button
            type="button"
            onPointerDown={(e) => e.preventDefault()}
            onClick={() => wrapSelection("*")}
            title="Cursiva — seleccionar texto y pulsar"
            className="font-body text-sm italic w-7 h-7 flex items-center justify-center rounded border border-[#003572]/20 dark:border-[#00bfff]/15 text-gray-500 hover:text-[#00bfff] hover:border-[#00bfff]/40 transition-colors shrink-0"
          >
            I
          </button>
        </div>

        {/* Textarea */}
        <textarea
          ref={lyricsRef}
          className="w-full px-3 py-2 rounded-b-lg border border-[#00bfff]/20 bg-transparent font-mono text-xs leading-relaxed resize-none focus:outline-none focus:border-[#00bfff] transition-colors"
          rows={14}
          value={form.lyrics}
          onChange={set("lyrics")}
          placeholder={"# Verso 1\nLínea 1\nLínea 2\n\n# Coro\nLínea 1\nLínea 2"}
          spellCheck={false}
        />
        <p className="font-label text-[10px] text-gray-600 uppercase tracking-wide mt-1">
          # Sección · **negrita** · *cursiva* · línea en blanco = nueva estrofa
        </p>
      </div>

      {/* Chord Charts */}
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <label className="font-label text-xs uppercase tracking-widest text-gray-500">Acordes</label>
          <button
            type="button"
            onClick={addChordChart}
            className="font-label text-[10px] uppercase tracking-widest text-[#00bfff] hover:text-[#00bfff]/70 transition-colors"
          >
            + Agregar tonalidad
          </button>
        </div>
        {form.chords.length === 0 && (
          <p className="font-body text-xs text-gray-600">Sin acordes todavía. Agrega una tonalidad para empezar.</p>
        )}
        {form.chords.map((chart, i) => (
          <div key={i} className="space-y-1.5 rounded-lg border border-[#00bfff]/15 p-3 bg-[#003572]/5 dark:bg-[#00bfff]/5">
            <div className="flex items-center gap-2">
              <input
                className={`${inputCls} w-28 shrink-0`}
                value={chart.key}
                onChange={(e) => updateChord(i, "key", e.target.value)}
                placeholder="Ej: C, Am, Bb"
              />
              <span className="font-label text-[10px] uppercase tracking-widest text-gray-500 flex-1">Tonalidad</span>
              <button
                type="button"
                onClick={() => removeChord(i)}
                className="text-gray-500 hover:text-red-400 transition-colors text-lg leading-none shrink-0"
              >
                ×
              </button>
            </div>
            <textarea
              className="w-full px-3 py-2 rounded-lg border border-[#00bfff]/20 bg-transparent font-mono text-xs leading-relaxed resize-none focus:outline-none focus:border-[#00bfff] transition-colors"
              rows={12}
              value={chart.content}
              onChange={(e) => updateChord(i, "content", e.target.value)}
              placeholder={"# Verso 1\nAm         G\nLínea con acorde\nC          F\nOtra línea"}
              spellCheck={false}
            />
          </div>
        ))}
      </div>

      {/* Reference Links */}
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <label className="font-label text-xs uppercase tracking-widest text-gray-500">Links de referencia</label>
          <button
            type="button"
            onClick={addRefLink}
            className="font-label text-[10px] uppercase tracking-widest text-[#00bfff] hover:text-[#00bfff]/70 transition-colors"
          >
            + Agregar
          </button>
        </div>
        {form.referenceLinks.length === 0 && (
          <p className="font-body text-xs text-gray-600">Sin links todavía.</p>
        )}
        {form.referenceLinks.map((link, i) => (
          <div key={i} className="flex gap-2 items-center">
            <input
              className={`${inputCls} flex-none w-28`}
              value={link.label}
              onChange={(e) => updateRefLink(i, "label", e.target.value)}
              placeholder="Spotify"
            />
            <input
              className={`${inputCls} flex-1`}
              value={link.url}
              onChange={(e) => updateRefLink(i, "url", e.target.value)}
              placeholder="https://..."
              type="url"
            />
            <button
              type="button"
              onClick={() => removeRefLink(i)}
              className="text-gray-500 hover:text-red-400 transition-colors text-lg leading-none shrink-0"
            >
              ×
            </button>
          </div>
        ))}
      </div>

      {/* Tags */}
      <div className="space-y-2">
        <label className="font-label text-xs uppercase tracking-widest text-gray-500">Tags</label>
        <div className="flex flex-wrap gap-1.5">
          {localTags.map((tag) => {
            const active = form.tagIds.includes(tag._id);
            return (
              <button
                key={tag._id}
                type="button"
                onClick={() => toggleTag(tag._id)}
                className={`font-label text-[10px] uppercase tracking-widest px-2.5 py-1 rounded-full border transition-colors ${
                  active
                    ? "border-[#00bfff] bg-[#00bfff]/15 text-[#00bfff]"
                    : "border-[#00bfff]/20 text-gray-500 hover:border-[#00bfff]/50"
                }`}
              >
                #{tag.name}
              </button>
            );
          })}
        </div>
        {/* Create new tag */}
        <div className="flex gap-2 pt-1">
          <input
            className={`${inputCls} flex-1`}
            value={newTag}
            onChange={(e) => setNewTag(e.target.value)}
            placeholder="Nuevo tag..."
            onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); handleCreateTag(); } }}
          />
          <button
            type="button"
            onClick={handleCreateTag}
            disabled={!newTag.trim() || creatingTag}
            className="px-4 py-2 rounded-lg border border-[#00bfff]/20 font-label text-xs uppercase tracking-widest text-[#00bfff] hover:bg-[#00bfff]/10 disabled:opacity-40 transition-colors shrink-0"
          >
            {creatingTag ? "..." : "Crear"}
          </button>
        </div>
      </div>

      {/* Actions */}
      <div className="flex gap-3 pt-1 border-t border-[#003572]/15 dark:border-[#00bfff]/10">
        <button
          type="button"
          onClick={onClose}
          className="flex-1 py-2.5 rounded-lg border border-[#003572]/30 dark:border-[#00bfff]/20 font-label text-xs uppercase tracking-widest hover:border-[#00bfff] transition-colors"
        >
          Cancelar
        </button>
        <button
          type="submit"
          disabled={loading}
          className="flex-1 py-2.5 rounded-lg bg-[#003572] dark:bg-[#00bfff]/20 hover:bg-[#003572]/80 dark:hover:bg-[#00bfff]/30 font-label text-xs uppercase tracking-widest transition-colors disabled:opacity-50"
        >
          {loading ? "Guardando..." : "Guardar"}
        </button>
      </div>
    </form>
  );
}

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
      body: JSON.stringify({
        title: form.title,
        author: form.author,
        key: form.key,
        bpm: form.bpm,
        timeSig: form.timeSig,
        lyrics: form.lyrics,
        chords: form.chords,
        referenceLinks: form.referenceLinks,
        tagIds: form.tagIds,
      }),
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
      body: JSON.stringify({
        title: form.title,
        author: form.author,
        key: form.key,
        bpm: form.bpm,
        timeSig: form.timeSig,
        lyrics: form.lyrics,
        chords: form.chords,
        referenceLinks: form.referenceLinks,
        tagIds: form.tagIds,
      }),
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
            initial={modal.type === "edit" ? modal.song : undefined}
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
