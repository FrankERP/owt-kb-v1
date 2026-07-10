"use client";

import { useState, useRef, useEffect, useId } from "react";
import { bodyToLyrics } from "@/app/utils/lyrics";
import { useFocusTrap } from "@/app/utils/useFocusTrap";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface SongTag {
  _id: string;
  name: string;
  slug: { current: string };
}

export interface FormState {
  title: string;
  key: string;
  bpm: string;
  timeSig: string;
  lyrics: string;
  referenceLinks: Array<{ label: string; url: string }>;
  tagIds: string[];
  authorIds: string[];
}

interface SongForForm {
  title: string;
  author?: string;
  key?: string;
  bpm?: number;
  timeSig?: string;
  body?: any[];
  chords?: Array<{ key: string; content: string }>;
  referenceLinks?: Array<{ label: string; url: string }>;
  tags?: SongTag[];
  authors?: Array<{ _id: string }>;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

export const SECTION_LABELS = ["Intro", "Verso", "Pre-Coro", "Coro", "Puente", "Outro"];
export const CHORD_MARKER_RE = /\[[^\]]+\]/;

export const inputCls =
  "w-full px-3 py-2 rounded-lg border border-[#00bfff]/20 bg-transparent font-body text-sm focus:outline-none focus:border-[#00bfff] transition-colors";

export const selectCls =
  "w-full px-3 py-2 rounded-lg border border-[#00bfff]/20 bg-[#010b17] dark:bg-[#010b17] font-body text-sm focus:outline-none focus:border-[#00bfff] transition-colors";

export function blankForm(): FormState {
  return { title: "", key: "", bpm: "", timeSig: "", lyrics: "", referenceLinks: [], tagIds: [], authorIds: [] };
}

export function songToForm(song: SongForForm): FormState {
  return {
    title:          song.title ?? "",
    key:            song.key ?? "",
    bpm:            song.bpm?.toString() ?? "",
    timeSig:        song.timeSig ?? "",
    lyrics:         song.chords?.[0]?.content || bodyToLyrics(song.body),
    referenceLinks: song.referenceLinks ?? [],
    tagIds:         song.tags?.map((t) => t._id) ?? [],
    authorIds:      song.authors?.map((a) => a._id) ?? [],
  };
}

export function buildPayload(form: FormState) {
  const hasChords = CHORD_MARKER_RE.test(form.lyrics);
  return {
    title: form.title,
    authorIds: form.authorIds,
    key: form.key,
    bpm: form.bpm,
    timeSig: form.timeSig,
    lyrics: hasChords ? "" : form.lyrics,
    chords: hasChords ? [{ key: form.key, content: form.lyrics }] : [],
    referenceLinks: form.referenceLinks,
    tagIds: form.tagIds,
  };
}

// ─── Modal ────────────────────────────────────────────────────────────────────

export function Modal({
  title,
  onClose,
  children,
  zClass = "z-50",
}: {
  title: string;
  onClose: () => void;
  children: React.ReactNode;
  zClass?: string;
}) {
  // Close on Escape, like the song sheet — standard modal-dialog behavior.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  // Move focus into the dialog, trap it, and restore on close.
  const dialogRef = useFocusTrap<HTMLDivElement>(true);

  return (
    <div className={`fixed inset-0 ${zClass} flex items-start justify-center pt-4 px-4 pb-4`}>
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onClose} />
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        tabIndex={-1}
        className="relative z-10 w-full max-w-2xl bg-[#C8D8EB] dark:bg-[#0a1929] border border-[#003572]/20 dark:border-[#00bfff]/20 rounded-xl shadow-2xl flex flex-col max-h-[calc(100vh-2rem)] focus:outline-none"
      >
        <div className="flex items-center justify-between px-6 py-4 border-b border-[#003572]/15 dark:border-[#00bfff]/10 shrink-0">
          <h2 className="font-display text-lg uppercase tracking-wide">{title}</h2>
          <button onClick={onClose} aria-label="Cerrar" className="text-gray-400 hover:text-[#00bfff] transition-colors text-xl leading-none">×</button>
        </div>
        <div className="overflow-y-auto overflow-x-hidden p-6 space-y-5 flex-1">{children}</div>
      </div>
    </div>
  );
}

// ─── SongForm ─────────────────────────────────────────────────────────────────

export function SongForm({
  initial,
  allTags,
  allAuthors = [],
  onSubmit,
  onClose,
  loading,
  canCreateTag,
  canCreateAuthor = async () => null,
}: {
  initial?: Partial<FormState>;
  allTags: SongTag[];
  allAuthors?: SongTag[];
  onSubmit: (form: FormState) => void;
  onClose: () => void;
  loading: boolean;
  canCreateTag: (name: string) => Promise<SongTag | null>;
  canCreateAuthor?: (name: string) => Promise<SongTag | null>;
}) {
  const [form, setForm]                   = useState<FormState>(() => initial ? { ...blankForm(), ...initial } : blankForm());
  const [creatingTag, setCreatingTag]     = useState(false);
  const [localTags, setLocalTags]         = useState<SongTag[]>(allTags);
  const [tagSearch, setTagSearch]         = useState("");
  const [localAuthors, setLocalAuthors]   = useState<SongTag[]>(allAuthors);
  const [authorSearch, setAuthorSearch]   = useState("");
  const [creatingAuthor, setCreatingAuthor] = useState(false);
  const lyricsRef                         = useRef<HTMLTextAreaElement>(null);
  const ids = useId();
  const fid = (name: string) => `${ids}-${name}`;

  const set = (key: keyof FormState) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
    setForm((f) => ({ ...f, [key]: e.target.value }));

  const toggleTag = (id: string) =>
    setForm((f) => ({
      ...f,
      tagIds: f.tagIds.includes(id) ? f.tagIds.filter((t) => t !== id) : [...f.tagIds, id],
    }));

  const toggleAuthor = (id: string) =>
    setForm((f) => ({
      ...f,
      authorIds: f.authorIds.includes(id) ? f.authorIds.filter((a) => a !== id) : [...f.authorIds, id],
    }));

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
    if (!tagSearch.trim() || creatingTag) return;
    setCreatingTag(true);
    const tag = await canCreateTag(tagSearch.trim());
    if (tag) {
      setLocalTags((prev) => [...prev, tag].sort((a, b) => a.name.localeCompare(b.name)));
      setForm((f) => ({ ...f, tagIds: [...f.tagIds, tag._id] }));
      setTagSearch("");
    }
    setCreatingTag(false);
  };

  const handleCreateAuthor = async () => {
    if (!authorSearch.trim() || creatingAuthor) return;
    setCreatingAuthor(true);
    const author = await canCreateAuthor(authorSearch.trim());
    if (author) {
      setLocalAuthors((prev) => [...prev, author].sort((a, b) => a.name.localeCompare(b.name)));
      setForm((f) => ({ ...f, authorIds: [...f.authorIds, author._id] }));
      setAuthorSearch("");
    }
    setCreatingAuthor(false);
  };

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
      {/* Title */}
      <div className="space-y-1">
        <label htmlFor={fid("title")} className="font-label text-xs uppercase tracking-widest text-gray-500">Título *</label>
        <input id={fid("title")} className={inputCls} value={form.title} onChange={set("title")} required placeholder="Nombre de la canción" />
      </div>

      {/* Artista (multi-select) */}
      <div className="space-y-2">
        <label htmlFor={fid("artist")} className="font-label text-xs uppercase tracking-widest text-gray-500">Artista</label>
        <input
          id={fid("artist")}
          className={inputCls}
          value={authorSearch}
          onChange={(e) => setAuthorSearch(e.target.value)}
          placeholder="Filtrar o crear artista..."
        />
        {authorSearch.trim() ? (
          <div className="rounded-lg border border-[#00bfff]/20 divide-y divide-[#00bfff]/10 max-h-48 overflow-y-auto">
            {localAuthors
              .filter((a) => a.name.toLowerCase().includes(authorSearch.toLowerCase()))
              .map((author) => {
                const active = form.authorIds.includes(author._id);
                return (
                  <div key={author._id} className="flex items-center gap-3 px-3 py-2 hover:bg-[#00bfff]/5 transition-colors">
                    <button type="button" onClick={() => toggleAuthor(author._id)} className="flex-1 flex items-center gap-2 text-left">
                      <span className={`font-label text-[10px] uppercase tracking-widest ${active ? "text-[#00bfff]" : "text-gray-400"}`}>
                        {author.name}
                      </span>
                    </button>
                    {active && <span className="font-label text-[9px] text-[#00bfff] shrink-0">✓</span>}
                  </div>
                );
              })}
            <div className="hover:bg-[#00bfff]/5 transition-colors">
              <button
                type="button"
                onClick={handleCreateAuthor}
                disabled={creatingAuthor}
                className="w-full flex items-center gap-3 px-3 py-2.5 text-left disabled:opacity-50"
              >
                <span className="font-label text-[10px] uppercase tracking-widest text-[#00bfff]">
                  {creatingAuthor ? "Creando..." : "+ Crear"}
                </span>
                <span className="font-body text-xs text-gray-400 truncate">"{authorSearch}"</span>
              </button>
            </div>
          </div>
        ) : (
          <div className="flex flex-wrap gap-1.5">
            {localAuthors.map((author) => {
              const active = form.authorIds.includes(author._id);
              return (
                <button
                  key={author._id}
                  type="button"
                  onClick={() => toggleAuthor(author._id)}
                  className={`font-label text-[10px] uppercase tracking-widest px-2.5 py-1 rounded-full border transition-colors ${
                    active
                      ? "border-[#00bfff] bg-[#00bfff]/15 text-[#00bfff]"
                      : "border-[#00bfff]/20 text-gray-500 hover:border-[#00bfff]/50"
                  }`}
                >
                  {author.name}
                </button>
              );
            })}
          </div>
        )}
      </div>

      {/* Key + BPM + Time Sig */}
      <div className="grid grid-cols-3 gap-3">
        <div className="space-y-1">
          <label htmlFor={fid("key")} className="font-label text-xs uppercase tracking-widest text-gray-500">Tonalidad</label>
          <input id={fid("key")} className={inputCls} value={form.key} onChange={set("key")} placeholder="Ej: C, Am" />
        </div>
        <div className="space-y-1">
          <label htmlFor={fid("bpm")} className="font-label text-xs uppercase tracking-widest text-gray-500">BPM</label>
          <input id={fid("bpm")} className={inputCls} type="number" value={form.bpm} onChange={set("bpm")} placeholder="120" />
        </div>
        <div className="space-y-1">
          <label htmlFor={fid("timesig")} className="font-label text-xs uppercase tracking-widest text-gray-500">Comp.</label>
          <input id={fid("timesig")} className={inputCls} value={form.timeSig} onChange={set("timeSig")} placeholder="4/4" />
        </div>
      </div>

      {/* Lyrics */}
      <div className="space-y-0">
        <label htmlFor={fid("lyrics")} className="font-label text-xs uppercase tracking-widest text-gray-500 block mb-1">Letra</label>
        <div className="flex items-center gap-1 flex-wrap px-2 py-1.5 rounded-t-lg border border-[#00bfff]/20 border-b-0 bg-[#003572]/5 dark:bg-[#00bfff]/5">
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
          <div className="w-px h-4 bg-[#003572]/20 dark:bg-[#00bfff]/20 mx-0.5 shrink-0" />
          <button
            type="button"
            onPointerDown={(e) => e.preventDefault()}
            onClick={() => wrapSelection("**")}
            title="Negrita — seleccionar texto y pulsar"
            className="font-body text-sm font-bold w-7 h-7 flex items-center justify-center rounded border border-[#003572]/20 dark:border-[#00bfff]/15 text-gray-500 hover:text-[#00bfff] hover:border-[#00bfff]/40 transition-colors shrink-0"
          >
            B
          </button>
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
        <textarea
          id={fid("lyrics")}
          ref={lyricsRef}
          className="w-full px-3 py-2 rounded-b-lg border border-[#00bfff]/20 bg-transparent font-mono text-xs leading-relaxed resize-none focus:outline-none focus:border-[#00bfff] transition-colors"
          rows={14}
          value={form.lyrics}
          onChange={set("lyrics")}
          placeholder={"# Verso 1\n[Am]Ante Ti [F]Postrado estoy\n[C]aquí me rindo\n\n# Coro\nLínea 1\nLínea 2"}
          spellCheck={false}
        />
        <p className="font-label text-[10px] text-gray-600 uppercase tracking-wide mt-1">
          # Sección · [Acorde]palabra · **negrita** · *cursiva*
        </p>
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
          <div key={i} className="grid grid-cols-[7rem_1fr_auto] gap-2 items-center">
            <input
              className={inputCls}
              value={link.label}
              onChange={(e) => updateRefLink(i, "label", e.target.value)}
              placeholder="Etiqueta"
            />
            <input
              className={inputCls}
              value={link.url}
              onChange={(e) => updateRefLink(i, "url", e.target.value)}
              placeholder="https://..."
              type="url"
            />
            <button
              type="button"
              onClick={() => removeRefLink(i)}
              className="text-gray-500 hover:text-red-400 transition-colors text-lg leading-none"
            >
              ×
            </button>
          </div>
        ))}
      </div>

      {/* Tags */}
      <div className="space-y-2">
        <label className="font-label text-xs uppercase tracking-widest text-gray-500">Tags</label>
        <input
          className={inputCls}
          value={tagSearch}
          onChange={(e) => setTagSearch(e.target.value)}
          placeholder="Filtrar o crear tag..."
        />
        {tagSearch.trim() ? (
          <div className="rounded-lg border border-[#00bfff]/20 divide-y divide-[#00bfff]/10 max-h-48 overflow-y-auto">
            {localTags
              .filter((t) => t.name.toLowerCase().includes(tagSearch.toLowerCase()))
              .map((tag) => {
                const active = form.tagIds.includes(tag._id);
                return (
                  <div key={tag._id} className="flex items-center gap-3 px-3 py-2 hover:bg-[#00bfff]/5 transition-colors">
                    <button type="button" onClick={() => toggleTag(tag._id)} className="flex-1 flex items-center gap-2 text-left">
                      <span className={`font-label text-[10px] uppercase tracking-widest ${active ? "text-[#00bfff]" : "text-gray-400"}`}>
                        #{tag.name}
                      </span>
                    </button>
                    {active && <span className="font-label text-[9px] text-[#00bfff] shrink-0">✓</span>}
                  </div>
                );
              })}
            <div className="hover:bg-[#00bfff]/5 transition-colors">
              <button
                type="button"
                onClick={handleCreateTag}
                disabled={creatingTag}
                className="w-full flex items-center gap-3 px-3 py-2.5 text-left disabled:opacity-50"
              >
                <span className="font-label text-[10px] uppercase tracking-widest text-[#00bfff]">
                  {creatingTag ? "Creando..." : "+ Crear"}
                </span>
                <span className="font-body text-xs text-gray-400 truncate">"{tagSearch}"</span>
              </button>
            </div>
          </div>
        ) : (
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
        )}
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
