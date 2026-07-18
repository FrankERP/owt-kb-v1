"use client";

import { useCallback, useId, useRef, useState } from "react";
import type React from "react";
import { useRouter } from "next/navigation";
import { useSession } from "next-auth/react";
import CueDialog from "@/app/components/ui/CueDialog";
import CueDialogStatus from "@/app/components/ui/CueDialogStatus";
import { bodyToLyrics } from "@/app/utils/lyrics";
import { Post } from "@/app/utils/interface";

interface SongTag { _id: string; name: string; slug: { current: string }; }
interface SongAuthor { _id: string; name: string; }

interface FormState {
  title: string;
  authorIds: string[];
  key: string;
  bpm: string;
  timeSig: string;
  lyrics: string;
  tutorials: { title: string; url: string }[];
  referenceLinks: { label: string; url: string }[];
  musicalReferenceUrl: string;
  lyricsVideoUrl: string;
  tagIds: string[];
}

type LoadState = "idle" | "loading" | "ready" | "error";

const CHORD_MARKER_RE = /\[[^\]]+\]/;
const SECTION_LABELS = ["Intro", "Verso", "Pre-Coro", "Coro", "Puente", "Outro"];

const inputCls =
  "w-full rounded-lg border border-brand-beam/20 bg-transparent px-3 py-2 font-body text-sm text-brand-frost transition-colors placeholder:text-brand-steel/45 focus:border-brand-beam focus:outline-none";

function postToForm(post: Post): FormState {
  return {
    title: post.title ?? "",
    authorIds: post.authors?.map((a) => a._id) ?? [],
    key: post.key ?? "",
    bpm: post.bpm?.toString() ?? "",
    timeSig: post.timeSig ?? "",
    lyrics: post.chords?.[0]?.content || bodyToLyrics(post.body),
    tutorials: (post.tutorials2 ?? []).map((t: any) => ({ title: t.title ?? "", url: t.url ?? "" })),
    referenceLinks: post.referenceLinks ?? [],
    musicalReferenceUrl: post.musicalReferenceUrl ?? "",
    lyricsVideoUrl: post.lyricsVideoUrl ?? "",
    tagIds: post.tags?.map((t) => t._id) ?? [],
  };
}

export function buildEditSongPayload(form: FormState) {
  const hasChords = CHORD_MARKER_RE.test(form.lyrics);
  return {
    title: form.title,
    authorIds: form.authorIds,
    key: form.key,
    bpm: form.bpm,
    timeSig: form.timeSig,
    lyrics: hasChords ? "" : form.lyrics,
    chords: hasChords ? [{ key: form.key, content: form.lyrics }] : [],
    tutorials: form.tutorials,
    referenceLinks: form.referenceLinks,
    musicalReferenceUrl: form.musicalReferenceUrl.trim(),
    lyricsVideoUrl: form.lyricsVideoUrl.trim(),
    tagIds: form.tagIds,
  };
}

export default function EditSongButton({ post, inline }: { post: Post; inline?: boolean }) {
  const router = useRouter();
  const { data: session } = useSession();
  const fieldId = useId();
  const triggerRef = useRef<HTMLButtonElement>(null);
  const lyricsRef = useRef<HTMLTextAreaElement>(null);
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState<FormState>(() => postToForm(post));
  const [tags, setTags] = useState<SongTag[]>([]);
  const [tagSearch, setTagSearch] = useState("");
  const [tagState, setTagState] = useState<LoadState>("idle");
  const [authors, setAuthors] = useState<SongAuthor[]>([]);
  const [authorSearch, setAuthorSearch] = useState("");
  const [authorState, setAuthorState] = useState<LoadState>("idle");
  const [saving, setSaving] = useState(false);
  const [formStatus, setFormStatus] = useState<{ tone: "error" | "pending"; message: string } | null>(null);
  const [toast, setToast] = useState<string | null>(null);

  const showToast = (msg: string) => {
    setToast(msg);
    setTimeout(() => setToast(null), 3000);
  };

  const loadTags = useCallback(async () => {
    if (tagState === "ready" || tagState === "loading") return;
    setTagState("loading");
    try {
      const res = await fetch("/api/content/tags");
      if (!res.ok) throw new Error("tags failed");
      setTags(await res.json());
      setTagState("ready");
    } catch {
      setTagState("error");
    }
  }, [tagState]);

  const loadAuthors = useCallback(async () => {
    if (authorState === "ready" || authorState === "loading") return;
    setAuthorState("loading");
    try {
      const res = await fetch("/api/content/authors");
      if (!res.ok) throw new Error("authors failed");
      setAuthors(await res.json());
      setAuthorState("ready");
    } catch {
      setAuthorState("error");
    }
  }, [authorState]);

  const handleOpen = useCallback(() => {
    setForm(postToForm(post));
    setFormStatus(null);
    setOpen(true);
    void loadTags();
    void loadAuthors();
  }, [loadAuthors, loadTags, post]);

  const set = (key: keyof FormState) =>
    (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
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

  const addTutorial = () => setForm((f) => ({ ...f, tutorials: [...f.tutorials, { title: "", url: "" }] }));
  const removeTutorial = (i: number) => setForm((f) => ({ ...f, tutorials: f.tutorials.filter((_, j) => j !== i) }));
  const updateTutorial = (i: number, key: "title" | "url", val: string) =>
    setForm((f) => {
      const tutorials = [...f.tutorials];
      tutorials[i] = { ...tutorials[i], [key]: val };
      return { ...f, tutorials };
    });

  const addRefLink = () => setForm((f) => ({ ...f, referenceLinks: [...f.referenceLinks, { label: "", url: "" }] }));
  const removeRefLink = (i: number) => setForm((f) => ({ ...f, referenceLinks: f.referenceLinks.filter((_, j) => j !== i) }));
  const updateRefLink = (i: number, key: "label" | "url", val: string) =>
    setForm((f) => {
      const links = [...f.referenceLinks];
      links[i] = { ...links[i], [key]: val };
      return { ...f, referenceLinks: links };
    });

  const insertLabel = (label: string) => {
    const ta = lyricsRef.current;
    if (!ta) return;
    const { selectionStart: pos } = ta;
    const before = form.lyrics.slice(0, pos);
    const after = form.lyrics.slice(pos);
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
    const selected = form.lyrics.slice(start, end);
    const wrapped = `${marker}${selected}${marker}`;
    setForm((f) => ({ ...f, lyrics: form.lyrics.slice(0, start) + wrapped + form.lyrics.slice(end) }));
    requestAnimationFrame(() =>
      selected
        ? ta.setSelectionRange(start, start + wrapped.length)
        : ta.setSelectionRange(start + marker.length, start + marker.length)
    );
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setFormStatus({ tone: "pending", message: "Guardando cambios…" });
    try {
      const res = await fetch(`/api/content/posts/${post._id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(buildEditSongPayload(form)),
      });
      if (!res.ok) throw new Error("save failed");
      setOpen(false);
      showToast("Canción actualizada.");
      router.refresh();
    } catch {
      setFormStatus({ tone: "error", message: "No se pudo guardar. Revisa la conexión e intenta otra vez." });
    } finally {
      setSaving(false);
    }
  };

  const canEdit = ["super-admin", "admin", "content-editor"].includes((session?.user?.role as string) ?? "");
  if (!canEdit) return null;

  const filteredAuthors = authors.filter((a) => a.name.toLowerCase().includes(authorSearch.toLowerCase()));
  const filteredTags = tags.filter((t) => t.name.toLowerCase().includes(tagSearch.toLowerCase()));

  return (
    <>
      {inline ? (
        <button
          ref={triggerRef}
          type="button"
          onClick={(e) => { e.stopPropagation(); handleOpen(); }}
          className="flex h-7 w-7 items-center justify-center rounded-full text-gray-500 transition-colors hover:bg-[#00bfff]/10 hover:text-[#00bfff] focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-beam/60"
          aria-label={`Editar canción ${post.title}`}
          title="Editar canción"
        >
          <PencilIcon />
        </button>
      ) : (
        <button
          ref={triggerRef}
          type="button"
          onClick={handleOpen}
          className="fixed bottom-6 right-6 z-40 flex items-center gap-2 rounded-full border border-[#00bfff]/30 bg-[#003572] px-4 py-2.5 font-label text-xs uppercase tracking-widest shadow-lg transition-colors hover:bg-[#003572]/80 dark:bg-[#00bfff]/20 dark:hover:bg-[#00bfff]/30"
          aria-label={`Editar canción ${post.title}`}
        >
          <PencilIcon />
          <span>Editar</span>
        </button>
      )}

      <CueDialog
        open={open}
        title="Editar canción"
        label={`Editar canción ${post.title}`}
        restoreFocusRef={triggerRef}
        mode="sheet"
        size="lg"
        onDismiss={() => setOpen(false)}
      >
        <form onSubmit={handleSubmit} className="flex min-h-0 flex-1 flex-col">
          <div className="min-h-0 flex-1 space-y-5 overflow-y-auto overflow-x-hidden px-5 py-5 sm:px-6">
            {formStatus && <CueDialogStatus tone={formStatus.tone}>{formStatus.message}</CueDialogStatus>}

            <Field label="Título *" id={`${fieldId}-title`}>
              <input id={`${fieldId}-title`} className={inputCls} value={form.title} onChange={set("title")} required />
            </Field>

            <div role="group" aria-labelledby={`${fieldId}-authors-label`} className="space-y-2">
              <div className="flex items-center justify-between gap-3">
                <label id={`${fieldId}-authors-label`} htmlFor={`${fieldId}-author-search`} className="font-label text-xs uppercase tracking-widest text-brand-steel">
                  Artistas
                </label>
                {authorState === "error" && (
                  <button type="button" onClick={loadAuthors} className="font-label text-[10px] uppercase tracking-widest text-brand-beam">
                    Reintentar
                  </button>
                )}
              </div>
              <input id={`${fieldId}-author-search`} className={inputCls} value={authorSearch} onChange={(e) => setAuthorSearch(e.target.value)} placeholder="Filtrar artistas…" />
              {authorState === "loading" && <CueDialogStatus tone="pending">Cargando artistas…</CueDialogStatus>}
              {authorState === "error" && <CueDialogStatus tone="error">No se pudieron cargar los artistas.</CueDialogStatus>}
              <div className="flex flex-wrap gap-1.5">
                {filteredAuthors.map((author) => {
                  const active = form.authorIds.includes(author._id);
                  return (
                    <button
                      key={author._id}
                      type="button"
                      onClick={() => toggleAuthor(author._id)}
                      aria-pressed={active}
                      className={`rounded-full border px-2.5 py-1 font-label text-[10px] uppercase tracking-widest transition-colors ${
                        active ? "border-[#00bfff] bg-[#00bfff]/15 text-[#00bfff]" : "border-[#00bfff]/20 text-gray-500 hover:border-[#00bfff]/50"
                      }`}
                    >
                      {author.name}
                    </button>
                  );
                })}
              </div>
            </div>

            <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
              <Field label="Tonalidad" id={`${fieldId}-key`}>
                <input id={`${fieldId}-key`} className={inputCls} value={form.key} onChange={set("key")} placeholder="C, Am…" />
              </Field>
              <Field label="BPM" id={`${fieldId}-bpm`}>
                <input id={`${fieldId}-bpm`} className={inputCls} type="number" value={form.bpm} onChange={set("bpm")} placeholder="120" />
              </Field>
              <Field label="Compás" id={`${fieldId}-time`}>
                <input id={`${fieldId}-time`} className={inputCls} value={form.timeSig} onChange={set("timeSig")} placeholder="4/4" />
              </Field>
            </div>

            <div className="space-y-0">
              <label htmlFor={`${fieldId}-lyrics`} className="mb-1 block font-label text-xs uppercase tracking-widest text-brand-steel">Letra</label>
              <div role="toolbar" aria-label="Secciones y formato de letra" className="flex flex-wrap items-center gap-1 rounded-t-lg border border-[#00bfff]/20 border-b-0 bg-[#00bfff]/5 px-2 py-1.5">
                {SECTION_LABELS.map((label) => (
                  <button key={label} type="button" onPointerDown={(e) => e.preventDefault()} onClick={() => insertLabel(label)}
                    className="whitespace-nowrap rounded border border-[#00bfff]/15 px-2 py-1 font-label text-[9px] uppercase tracking-widest text-gray-500 transition-colors hover:border-[#00bfff]/40 hover:text-[#00bfff]">
                    {label}
                  </button>
                ))}
                <span aria-hidden className="mx-0.5 h-4 w-px shrink-0 bg-[#00bfff]/20" />
                <button type="button" aria-label="Aplicar negrita" onPointerDown={(e) => e.preventDefault()} onClick={() => wrapSelection("**")}
                  className="flex h-7 w-7 shrink-0 items-center justify-center rounded border border-[#00bfff]/15 font-body text-sm font-bold text-gray-500 transition-colors hover:border-[#00bfff]/40 hover:text-[#00bfff]">
                  B
                </button>
                <button type="button" aria-label="Aplicar cursiva" onPointerDown={(e) => e.preventDefault()} onClick={() => wrapSelection("*")}
                  className="flex h-7 w-7 shrink-0 items-center justify-center rounded border border-[#00bfff]/15 font-body text-sm italic text-gray-500 transition-colors hover:border-[#00bfff]/40 hover:text-[#00bfff]">
                  I
                </button>
              </div>
              <textarea
                id={`${fieldId}-lyrics`}
                ref={lyricsRef}
                className="w-full resize-none rounded-b-lg border border-[#00bfff]/20 bg-transparent px-3 py-2 font-mono text-xs leading-relaxed text-brand-frost transition-colors placeholder:text-brand-steel/45 focus:border-[#00bfff] focus:outline-none"
                rows={14}
                value={form.lyrics}
                onChange={set("lyrics")}
                placeholder={"# Verso 1\n[Am]Ante Ti [F]Postrado estoy\n\n# Coro\nLínea 1"}
                spellCheck={false}
              />
              <p className="mt-1 font-label text-[10px] uppercase tracking-wide text-gray-600"># Sección · [Acorde]palabra · **negrita** · *cursiva*</p>
            </div>

            <RepeatRows
              title="Tutoriales"
              empty="Sin tutoriales todavía."
              addLabel="Agregar tutorial"
              onAdd={addTutorial}
              rows={form.tutorials.map((tut, i) => ({
                key: `tutorial-${i}`,
                titleLabel: `Título del tutorial ${i + 1}`,
                urlLabel: `URL del tutorial ${i + 1}`,
                title: tut.title,
                url: tut.url,
                onTitle: (value: string) => updateTutorial(i, "title", value),
                onUrl: (value: string) => updateTutorial(i, "url", value),
                onRemove: () => removeTutorial(i),
                removeLabel: `Eliminar tutorial ${i + 1}`,
              }))}
            />

            <RepeatRows
              title="Links de referencia"
              empty="Sin links todavía."
              addLabel="Agregar link de referencia"
              onAdd={addRefLink}
              firstHeader="Etiqueta"
              secondHeader="URL"
              rows={form.referenceLinks.map((link, i) => ({
                key: `link-${i}`,
                titleLabel: `Etiqueta del link de referencia ${i + 1}`,
                urlLabel: `URL del link de referencia ${i + 1}`,
                title: link.label,
                url: link.url,
                onTitle: (value: string) => updateRefLink(i, "label", value),
                onUrl: (value: string) => updateRefLink(i, "url", value),
                onRemove: () => removeRefLink(i),
                removeLabel: `Eliminar link de referencia ${i + 1}`,
              }))}
            />

            <Field label="Referencia musical (URL)" id={`${fieldId}-music-ref`}>
              <input id={`${fieldId}-music-ref`} className={inputCls} value={form.musicalReferenceUrl} onChange={(e) => setForm((f) => ({ ...f, musicalReferenceUrl: e.target.value }))} placeholder="https://youtu.be/…" />
            </Field>
            <Field label="Video con letra en español (URL)" id={`${fieldId}-lyrics-ref`}>
              <input id={`${fieldId}-lyrics-ref`} className={inputCls} value={form.lyricsVideoUrl} onChange={(e) => setForm((f) => ({ ...f, lyricsVideoUrl: e.target.value }))} placeholder="https://youtu.be/…" />
            </Field>

            <div role="group" aria-labelledby={`${fieldId}-tags-label`} className="space-y-2">
              <div className="flex items-center justify-between gap-3">
                <label id={`${fieldId}-tags-label`} htmlFor={`${fieldId}-tag-search`} className="font-label text-xs uppercase tracking-widest text-brand-steel">
                  Tags
                </label>
                {tagState === "error" && (
                  <button type="button" onClick={loadTags} className="font-label text-[10px] uppercase tracking-widest text-brand-beam">
                    Reintentar
                  </button>
                )}
              </div>
              <input id={`${fieldId}-tag-search`} className={inputCls} value={tagSearch} onChange={(e) => setTagSearch(e.target.value)} placeholder="Filtrar tags…" />
              {tagState === "loading" && <CueDialogStatus tone="pending">Cargando tags…</CueDialogStatus>}
              {tagState === "error" && <CueDialogStatus tone="error">No se pudieron cargar los tags.</CueDialogStatus>}
              <div className="flex flex-wrap gap-1.5">
                {filteredTags.map((tag) => {
                  const active = form.tagIds.includes(tag._id);
                  return (
                    <button
                      key={tag._id}
                      type="button"
                      onClick={() => toggleTag(tag._id)}
                      aria-pressed={active}
                      className={`rounded-full border px-2.5 py-1 font-label text-[10px] uppercase tracking-widest transition-colors ${
                        active ? "border-[#00bfff] bg-[#00bfff]/15 text-[#00bfff]" : "border-[#00bfff]/20 text-gray-500 hover:border-[#00bfff]/50"
                      }`}
                    >
                      #{tag.name}
                    </button>
                  );
                })}
              </div>
            </div>
          </div>

          <div className="flex shrink-0 gap-3 border-t border-[#00bfff]/10 bg-brand-blackout/35 px-5 py-4 sm:px-6">
            <button type="button" onClick={() => setOpen(false)} className="flex-1 rounded-lg border border-[#00bfff]/20 py-2.5 font-label text-xs uppercase tracking-widest transition-colors hover:border-[#00bfff]">
              Cancelar
            </button>
            <button type="submit" disabled={saving} className="flex-1 rounded-lg border border-[#00bfff]/35 bg-[#00bfff]/20 py-2.5 font-label text-xs uppercase tracking-widest text-brand-frost transition-colors hover:bg-[#00bfff]/30 disabled:opacity-50">
              {saving ? "Guardando…" : "Guardar"}
            </button>
          </div>
        </form>
      </CueDialog>

      {toast && (
        <div className="fixed bottom-6 left-1/2 z-[95] -translate-x-1/2 whitespace-nowrap rounded-xl border border-[#00bfff]/30 bg-[#0a1929] px-5 py-3 font-label text-xs uppercase tracking-widest shadow-xl">
          {toast}
        </div>
      )}
    </>
  );
}

function Field({ id, label, children }: { id: string; label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1">
      <label htmlFor={id} className="font-label text-xs uppercase tracking-widest text-brand-steel">
        {label}
      </label>
      {children}
    </div>
  );
}

function RepeatRows({
  title,
  empty,
  addLabel,
  onAdd,
  rows,
  firstHeader = "Título",
  secondHeader = "URL embed",
}: {
  title: string;
  empty: string;
  addLabel: string;
  onAdd: () => void;
  rows: Array<{
    key: string;
    titleLabel: string;
    urlLabel: string;
    title: string;
    url: string;
    onTitle: (value: string) => void;
    onUrl: (value: string) => void;
    onRemove: () => void;
    removeLabel: string;
  }>;
  firstHeader?: string;
  secondHeader?: string;
}) {
  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <p className="font-label text-xs uppercase tracking-widest text-brand-steel">{title}</p>
        <button type="button" onClick={onAdd} className="font-label text-[10px] uppercase tracking-widest text-[#00bfff] transition-colors hover:text-[#00bfff]/70">
          {addLabel}
        </button>
      </div>
      {rows.length === 0 ? (
        <p className="font-body text-xs text-gray-600">{empty}</p>
      ) : (
        <div className="overflow-hidden rounded-lg border border-[#00bfff]/15">
          <div className="grid grid-cols-[1fr_2fr_2rem] gap-3 border-b border-[#00bfff]/10 bg-[#00bfff]/5 px-3 py-1.5">
            <span className="font-label text-[9px] uppercase tracking-widest text-gray-500">{firstHeader}</span>
            <span className="font-label text-[9px] uppercase tracking-widest text-gray-500">{secondHeader}</span>
          </div>
          {rows.map((row, i) => (
            <div key={row.key} className={`group grid grid-cols-[1fr_2fr_2rem] items-center gap-3 px-3 py-2 transition-colors hover:bg-[#00bfff]/5 ${i > 0 ? "border-t border-[#00bfff]/10" : ""}`}>
              <input aria-label={row.titleLabel} className="min-w-0 bg-transparent font-body text-sm placeholder:text-gray-600 focus:outline-none" value={row.title} onChange={(e) => row.onTitle(e.target.value)} placeholder={firstHeader} />
              <input aria-label={row.urlLabel} className="min-w-0 bg-transparent font-body text-sm placeholder:text-gray-600 focus:outline-none" value={row.url} onChange={(e) => row.onUrl(e.target.value)} placeholder="https://…" />
              <button type="button" onClick={row.onRemove} aria-label={row.removeLabel} className="justify-self-center text-base leading-none text-gray-500 opacity-100 transition-colors hover:text-red-400 sm:opacity-0 sm:transition-all sm:group-hover:opacity-100">
                ×
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function PencilIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
      <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" />
    </svg>
  );
}
