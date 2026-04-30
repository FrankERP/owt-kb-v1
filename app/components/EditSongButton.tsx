"use client";

import { useState, useRef, useCallback } from "react";
import { useRouter } from "next/navigation";
import { bodyToLyrics } from "@/app/utils/lyrics";
import { Post } from "@/app/utils/interface";

// ─── Types ────────────────────────────────────────────────────────────────────

interface SongTag { _id: string; name: string; slug: { current: string }; }

interface FormState {
  title: string; author: string; key: string; bpm: string; timeSig: string;
  lyrics: string;
  tutorials: { title: string; url: string }[];
  referenceLinks: { label: string; url: string }[];
  tagIds: string[];
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

const CHORD_MARKER_RE = /\[[^\]]+\]/;
const SECTION_LABELS  = ["Intro", "Verso", "Pre-Coro", "Coro", "Puente", "Outro"];

const inputCls =
  "w-full px-3 py-2 rounded-lg border border-[#00bfff]/20 bg-transparent font-body text-sm focus:outline-none focus:border-[#00bfff] transition-colors";

function postToForm(post: Post): FormState {
  return {
    title:          post.title ?? "",
    author:         post.author ?? "",
    key:            post.key ?? "",
    bpm:            post.bpm?.toString() ?? "",
    timeSig:        post.timeSig ?? "",
    lyrics:         post.chords?.[0]?.content || bodyToLyrics(post.body),
    tutorials:      (post.tutorials2 ?? []).map((t: any) => ({ title: t.title ?? "", url: t.url ?? "" })),
    referenceLinks: post.referenceLinks ?? [],
    tagIds:         post.tags?.map((t) => t._id) ?? [],
  };
}

function buildPayload(form: FormState) {
  const hasChords = CHORD_MARKER_RE.test(form.lyrics);
  return {
    title: form.title, author: form.author, key: form.key,
    bpm: form.bpm, timeSig: form.timeSig,
    lyrics: hasChords ? "" : form.lyrics,
    chords: hasChords ? [{ key: form.key, content: form.lyrics }] : [],
    tutorials: form.tutorials,
    referenceLinks: form.referenceLinks,
    tagIds: form.tagIds,
  };
}

// ─── Component ────────────────────────────────────────────────────────────────

export default function EditSongButton({ post, inline }: { post: Post; inline?: boolean }) {
  const router   = useRouter();
  const [open, setOpen]       = useState(false);
  const [form, setForm]       = useState<FormState>(() => postToForm(post));
  const [tags, setTags]       = useState<SongTag[]>([]);
  const [tagSearch, setTagSearch] = useState("");
  const [tagsLoaded, setTagsLoaded] = useState(false);
  const [saving, setSaving]   = useState(false);
  const [toast, setToast]     = useState<string | null>(null);
  const lyricsRef             = useRef<HTMLTextAreaElement>(null);

  const showToast = (msg: string) => {
    setToast(msg);
    setTimeout(() => setToast(null), 3000);
  };

  const handleOpen = useCallback(async () => {
    setForm(postToForm(post));
    setOpen(true);
    if (!tagsLoaded) {
      const res = await fetch("/api/content/tags");
      if (res.ok) { setTags(await res.json()); setTagsLoaded(true); }
    }
  }, [post, tagsLoaded]);

  const set = (key: keyof FormState) =>
    (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
      setForm((f) => ({ ...f, [key]: e.target.value }));

  const toggleTag = (id: string) =>
    setForm((f) => ({
      ...f,
      tagIds: f.tagIds.includes(id) ? f.tagIds.filter((t) => t !== id) : [...f.tagIds, id],
    }));

  const addTutorial = () =>
    setForm((f) => ({ ...f, tutorials: [...f.tutorials, { title: "", url: "" }] }));

  const updateTutorial = (i: number, key: "title" | "url", val: string) =>
    setForm((f) => {
      const tutorials = [...f.tutorials];
      tutorials[i] = { ...tutorials[i], [key]: val };
      return { ...f, tutorials };
    });

  const removeTutorial = (i: number) =>
    setForm((f) => ({ ...f, tutorials: f.tutorials.filter((_, j) => j !== i) }));

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

  const insertLabel = (label: string) => {
    const ta = lyricsRef.current;
    if (!ta) return;
    const { selectionStart: pos } = ta;
    const text = form.lyrics;
    const before = text.slice(0, pos), after = text.slice(pos);
    const prefix = before.length > 0 && !before.endsWith("\n") ? "\n" : "";
    const suffix = after.length > 0 && !after.startsWith("\n") ? "\n" : "";
    const insert = `${prefix}# ${label}${suffix}`;
    setForm((f) => ({ ...f, lyrics: before + insert + after }));
    requestAnimationFrame(() => ta.setSelectionRange(pos + insert.length, pos + insert.length));
  };

  const wrapSelection = (marker: string) => {
    const ta = lyricsRef.current;
    if (!ta) return;
    const { selectionStart: start, selectionEnd: end } = ta;
    const text = form.lyrics, selected = text.slice(start, end);
    const wrapped = `${marker}${selected}${marker}`;
    setForm((f) => ({ ...f, lyrics: text.slice(0, start) + wrapped + text.slice(end) }));
    requestAnimationFrame(() =>
      selected
        ? ta.setSelectionRange(start, start + wrapped.length)
        : ta.setSelectionRange(start + marker.length, start + marker.length)
    );
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    const res = await fetch(`/api/content/posts/${post._id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(buildPayload(form)),
    });
    setSaving(false);
    if (res.ok) {
      setOpen(false);
      showToast("Canción actualizada.");
      router.refresh();
    } else {
      showToast("Error al guardar.");
    }
  };

  return (
    <>
      {/* Trigger — inline icon or floating FAB */}
      {inline ? (
        <button
          onClick={(e) => { e.stopPropagation(); handleOpen(); }}
          className="w-7 h-7 rounded-full flex items-center justify-center text-gray-500 hover:text-[#00bfff] hover:bg-[#00bfff]/10 transition-colors"
          title="Editar canción"
        >
          <PencilIcon />
        </button>
      ) : (
        <button
          onClick={handleOpen}
          className="fixed bottom-6 right-6 z-40 flex items-center gap-2 px-4 py-2.5 rounded-full bg-[#003572] dark:bg-[#00bfff]/20 border border-[#00bfff]/30 hover:bg-[#003572]/80 dark:hover:bg-[#00bfff]/30 font-label text-xs uppercase tracking-widest shadow-lg transition-colors"
        >
          <PencilIcon />
          <span>Editar</span>
        </button>
      )}

      {/* Modal */}
      {open && (
        <div className="fixed inset-0 z-50 flex items-start justify-center pt-4 px-4 pb-4">
          <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={() => setOpen(false)} />
          <div className="relative z-10 w-full max-w-2xl bg-[#C8D8EB] dark:bg-[#0a1929] border border-[#003572]/20 dark:border-[#00bfff]/20 rounded-xl shadow-2xl flex flex-col max-h-[calc(100vh-2rem)]">

            {/* Header */}
            <div className="flex items-center justify-between px-6 py-4 border-b border-[#003572]/15 dark:border-[#00bfff]/10 shrink-0">
              <h2 className="font-display text-lg uppercase tracking-wide">Editar canción</h2>
              <button onClick={() => setOpen(false)} className="text-gray-400 hover:text-[#00bfff] transition-colors text-xl leading-none">×</button>
            </div>

            {/* Scrollable form */}
            <div className="overflow-y-auto overflow-x-hidden p-6 flex-1">
              <form onSubmit={handleSubmit} className="space-y-5">

                {/* Title + Author */}
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1">
                    <label className="font-label text-xs uppercase tracking-widest text-gray-500">Título *</label>
                    <input className={inputCls} value={form.title} onChange={set("title")} required />
                  </div>
                  <div className="space-y-1">
                    <label className="font-label text-xs uppercase tracking-widest text-gray-500">Artista</label>
                    <input className={inputCls} value={form.author} onChange={set("author")} />
                  </div>
                </div>

                {/* Key + BPM + TimeSig */}
                <div className="grid grid-cols-3 gap-3">
                  <div className="space-y-1">
                    <label className="font-label text-xs uppercase tracking-widest text-gray-500">Tonalidad</label>
                    <input className={inputCls} value={form.key} onChange={set("key")} placeholder="C, Am…" />
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
                    <button type="button" onPointerDown={(e) => e.preventDefault()} onClick={() => wrapSelection("**")}
                      className="font-body text-sm font-bold w-7 h-7 flex items-center justify-center rounded border border-[#003572]/20 dark:border-[#00bfff]/15 text-gray-500 hover:text-[#00bfff] hover:border-[#00bfff]/40 transition-colors shrink-0">
                      B
                    </button>
                    <button type="button" onPointerDown={(e) => e.preventDefault()} onClick={() => wrapSelection("*")}
                      className="font-body text-sm italic w-7 h-7 flex items-center justify-center rounded border border-[#003572]/20 dark:border-[#00bfff]/15 text-gray-500 hover:text-[#00bfff] hover:border-[#00bfff]/40 transition-colors shrink-0">
                      I
                    </button>
                  </div>
                  <textarea
                    ref={lyricsRef}
                    className="w-full px-3 py-2 rounded-b-lg border border-[#00bfff]/20 bg-transparent font-mono text-xs leading-relaxed resize-none focus:outline-none focus:border-[#00bfff] transition-colors"
                    rows={14}
                    value={form.lyrics}
                    onChange={set("lyrics")}
                    placeholder={"# Verso 1\n[Am]Ante Ti [F]Postrado estoy\n\n# Coro\nLínea 1"}
                    spellCheck={false}
                  />
                  <p className="font-label text-[10px] text-gray-600 uppercase tracking-wide mt-1">
                    # Sección · [Acorde]palabra · **negrita** · *cursiva*
                  </p>
                </div>

                {/* Tutorials */}
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <label className="font-label text-xs uppercase tracking-widest text-gray-500">Tutoriales</label>
                    <button type="button" onClick={addTutorial}
                      className="font-label text-[10px] uppercase tracking-widest text-[#00bfff] hover:text-[#00bfff]/70 transition-colors">
                      + Agregar
                    </button>
                  </div>
                  {form.tutorials.length === 0 ? (
                    <p className="font-body text-xs text-gray-600">Sin tutoriales todavía.</p>
                  ) : (
                    <div className="rounded-lg border border-[#003572]/20 dark:border-[#00bfff]/15 overflow-hidden">
                      <div className="grid grid-cols-[1fr_2fr_2rem] gap-3 px-3 py-1.5 bg-[#003572]/5 dark:bg-[#00bfff]/5 border-b border-[#003572]/10 dark:border-[#00bfff]/10">
                        <span className="font-label text-[9px] uppercase tracking-widest text-gray-500">Título</span>
                        <span className="font-label text-[9px] uppercase tracking-widest text-gray-500">URL embed</span>
                      </div>
                      {form.tutorials.map((tut, i) => (
                        <div key={i} className={`group grid grid-cols-[1fr_2fr_2rem] gap-3 items-center px-3 py-2 hover:bg-[#00bfff]/5 transition-colors ${i > 0 ? "border-t border-[#003572]/10 dark:border-[#00bfff]/10" : ""}`}>
                          <input
                            className="bg-transparent font-body text-sm focus:outline-none placeholder:text-gray-600 min-w-0 w-full"
                            value={tut.title}
                            onChange={(e) => updateTutorial(i, "title", e.target.value)}
                            placeholder="Título"
                          />
                          <input
                            className="bg-transparent font-body text-sm focus:outline-none placeholder:text-gray-600 min-w-0 w-full"
                            value={tut.url}
                            onChange={(e) => updateTutorial(i, "url", e.target.value)}
                            placeholder="https://youtube.com/embed/…"
                          />
                          <button type="button" onClick={() => removeTutorial(i)}
                            className="opacity-0 group-hover:opacity-100 text-gray-500 hover:text-red-400 transition-all text-base leading-none justify-self-center">
                            ×
                          </button>
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                {/* Reference Links */}
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <label className="font-label text-xs uppercase tracking-widest text-gray-500">Links de referencia</label>
                    <button type="button" onClick={addRefLink}
                      className="font-label text-[10px] uppercase tracking-widest text-[#00bfff] hover:text-[#00bfff]/70 transition-colors">
                      + Agregar
                    </button>
                  </div>
                  {form.referenceLinks.length === 0 ? (
                    <p className="font-body text-xs text-gray-600">Sin links todavía.</p>
                  ) : (
                    <div className="rounded-lg border border-[#003572]/20 dark:border-[#00bfff]/15 overflow-hidden">
                      <div className="grid grid-cols-[1fr_2fr_2rem] gap-3 px-3 py-1.5 bg-[#003572]/5 dark:bg-[#00bfff]/5 border-b border-[#003572]/10 dark:border-[#00bfff]/10">
                        <span className="font-label text-[9px] uppercase tracking-widest text-gray-500">Etiqueta</span>
                        <span className="font-label text-[9px] uppercase tracking-widest text-gray-500">URL</span>
                      </div>
                      {form.referenceLinks.map((link, i) => (
                        <div key={i} className={`group grid grid-cols-[1fr_2fr_2rem] gap-3 items-center px-3 py-2 hover:bg-[#00bfff]/5 transition-colors ${i > 0 ? "border-t border-[#003572]/10 dark:border-[#00bfff]/10" : ""}`}>
                          <input
                            className="bg-transparent font-body text-sm focus:outline-none placeholder:text-gray-600 min-w-0 w-full"
                            value={link.label}
                            onChange={(e) => updateRefLink(i, "label", e.target.value)}
                            placeholder="Spotify"
                          />
                          <input
                            className="bg-transparent font-body text-sm focus:outline-none placeholder:text-gray-600 min-w-0 w-full"
                            value={link.url}
                            onChange={(e) => updateRefLink(i, "url", e.target.value)}
                            placeholder="https://…"
                          />
                          <button type="button" onClick={() => removeRefLink(i)}
                            className="opacity-0 group-hover:opacity-100 text-gray-500 hover:text-red-400 transition-all text-base leading-none justify-self-center">
                            ×
                          </button>
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                {/* Tags */}
                <div className="space-y-2">
                  <label className="font-label text-xs uppercase tracking-widest text-gray-500">Tags</label>
                  <input className={inputCls} value={tagSearch}
                    onChange={(e) => setTagSearch(e.target.value)} placeholder="Filtrar tags…" />
                  <div className="flex flex-wrap gap-1.5">
                    {tags
                      .filter((t) => t.name.toLowerCase().includes(tagSearch.toLowerCase()))
                      .map((tag) => {
                        const active = form.tagIds.includes(tag._id);
                        return (
                          <button key={tag._id} type="button" onClick={() => toggleTag(tag._id)}
                            className={`font-label text-[10px] uppercase tracking-widest px-2.5 py-1 rounded-full border transition-colors ${
                              active
                                ? "border-[#00bfff] bg-[#00bfff]/15 text-[#00bfff]"
                                : "border-[#00bfff]/20 text-gray-500 hover:border-[#00bfff]/50"
                            }`}>
                            #{tag.name}
                          </button>
                        );
                      })}
                  </div>
                </div>

                {/* Actions */}
                <div className="flex gap-3 pt-1 border-t border-[#003572]/15 dark:border-[#00bfff]/10">
                  <button type="button" onClick={() => setOpen(false)}
                    className="flex-1 py-2.5 rounded-lg border border-[#003572]/30 dark:border-[#00bfff]/20 font-label text-xs uppercase tracking-widest hover:border-[#00bfff] transition-colors">
                    Cancelar
                  </button>
                  <button type="submit" disabled={saving}
                    className="flex-1 py-2.5 rounded-lg bg-[#003572] dark:bg-[#00bfff]/20 hover:bg-[#003572]/80 dark:hover:bg-[#00bfff]/30 font-label text-xs uppercase tracking-widest transition-colors disabled:opacity-50">
                    {saving ? "Guardando…" : "Guardar"}
                  </button>
                </div>

              </form>
            </div>
          </div>
        </div>
      )}

      {/* Toast */}
      {toast && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50 px-5 py-3 rounded-xl bg-[#003572] dark:bg-[#0a1929] border border-[#00bfff]/30 font-label text-xs uppercase tracking-widest shadow-xl whitespace-nowrap">
          {toast}
        </div>
      )}
    </>
  );
}

function PencilIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
      <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" />
    </svg>
  );
}
