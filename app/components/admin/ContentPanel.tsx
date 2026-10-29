"use client";

import { PAGE_LEDE, PAGE_TITLE, SHEET_TITLE } from "@/app/utils/homeHero";
import { useState, useEffect, useCallback, useMemo } from "react";
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
import FiltersPill from "../ui/FiltersPill";
import Menu, { MenuItem } from "../ui/Menu";
import SearchLine from "../ui/SearchLine";
import Skeleton, { SkeletonGroup } from "../ui/Skeleton";
import { useToast } from "../ui/Toast";
import { writeErrorMessage } from "@/app/utils/writeError";
import { formatKey } from "@/app/utils/formatKey";
import { normalizeText } from "@/app/utils/normalizeText";
import { plural } from "@/app/utils/plural";
import { compareByTitle, groupRowsByLetter } from "@/app/utils/libraryIndex";
import { hasSongLyrics } from "@/app/utils/songSections";

/** Tags a row names before folding the rest into «+N»: two on a phone, four from `md`. */
const PHONE_TAGS = 2;
const DESKTOP_TAGS = 4;

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
  /** A deleted author still referenced projects as `null` (`authors[]->`). */
  authors?: Array<{ _id: string; name: string } | null>;
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

/** The artists a song names: its referenced authors, else the legacy free-text one. */
const artistNames = (s: Song): string[] => {
  const refs = (s.authors ?? []).flatMap((a) => (a?.name?.trim() ? [a.name.trim()] : []));
  if (refs.length > 0) return refs;
  return s.author?.trim() ? [s.author.trim()] : [];
};

/** «72 bpm · 4/4», or whichever half the song has. */
const tempoLine = (s: Song): string =>
  [s.bpm ? `${s.bpm} bpm` : "", s.timeSig ?? ""].filter(Boolean).join(" · ");

// ─── Main panel ───────────────────────────────────────────────────────────────

export default function ContentPanel({ canDelete = false }: { canDelete?: boolean }) {
  const [songs, setSongs]       = useState<Song[]>([]);
  const [tags, setTags]         = useState<SongTag[]>([]);
  const [authors, setAuthors]   = useState<SongTag[]>([]);
  const [loading, setLoading]   = useState(true);
  const [error, setError]     = useState<string | null>(null);
  const [search, setSearch]   = useState("");
  const [tagFilter, setTagFilter]       = useState<string[]>([]);
  const [artistFilter, setArtistFilter] = useState("");
  const [filtersOpen, setFiltersOpen]   = useState(false);
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

  // The lede's facts: every artist a song names (the Artista picker lists the
  // same names), and the songs with no lyrics at all — the catalog's known gap.
  const artistOptions = useMemo(
    () => [...new Set(songs.flatMap(artistNames))].sort((a, b) => a.localeCompare(b, "es")),
    [songs],
  );
  const withoutLyrics = useMemo(() => songs.filter((s) => !hasSongLyrics(s)).length, [songs]);

  // The sheet's filters first (a tag matches when the song carries ANY picked
  // one, as Biblioteca reads them), then the search on top: the sheet's primary
  // says what the FILTERS show, without the search box's own narrowing.
  const categoryFiltered = useMemo(
    () => songs.filter((s) =>
      (tagFilter.length === 0 || (s.tags ?? []).some((t) => tagFilter.includes(t.slug.current))) &&
      (!artistFilter || artistNames(s).includes(artistFilter))),
    [songs, tagFilter, artistFilter],
  );
  // Accent- and case-insensitive, like the song form's artist picker.
  const query = normalizeText(search.trim());
  const filtered = useMemo(
    () => categoryFiltered.filter((s) =>
      normalizeText(s.title).includes(query) ||
      normalizeText(s.author ?? "").includes(query) ||
      artistNames(s).some((a) => normalizeText(a).includes(query))),
    [categoryFiltered, query],
  );
  // By letter like Biblioteca and Miembros, alphabetical within a letter with
  // accents and case folded (the API's `order(title asc)` is code-point order,
  // which files «Él» after «eterno»); a query is a relevance list, so it renders
  // as one unlettered group in the API's order.
  const groups = useMemo(
    () => (query ? [{ letter: "", rows: filtered }] : groupRowsByLetter([...filtered].sort(compareByTitle), (s) => s.title)),
    [filtered, query],
  );
  const activeFilters = tagFilter.length + (artistFilter ? 1 : 0);
  const toggleTag = (slug: string) =>
    setTagFilter((prev) => (prev.includes(slug) ? prev.filter((t) => t !== slug) : [...prev, slug]));

  // For edit modal: convert Song to the partial form shape SongForm expects
  // A dangling author ref (`null`) is dropped here so the form never pre-selects nothing.
  const songToFormInitial = (song: Song): Partial<FormState> =>
    songToForm({ ...song, authors: (song.authors ?? []).flatMap((a) => (a ? [a] : [])) });

  // Derived from the KIND, which outlives the close — so the header does not
  // change wording halfway through the sheet's exit.
  const formTitle = modalKind === "edit" ? "Editar canción" : "Nueva canción";

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-end justify-between gap-4">
        <div className="min-w-0">
          <h1 className={PAGE_TITLE}>Canciones</h1>
          {!loading && !error && (
            <p className={`mt-2 ${PAGE_LEDE}`}>
              <span className="text-ink">{plural(songs.length, "canción", "canciones")}</span>
              {" · "}{plural(artistOptions.length, "artista", "artistas")}
              {withoutLyrics > 0 && <> · {withoutLyrics} sin letra</>}
            </p>
          )}
        </div>
        <Button variant="primary" size="lg" className="shrink-0" onClick={() => openModal("add")}>
          Agregar
        </Button>
      </div>

      {/* The search as a hairline beside the «Filtros» pill (ADR-0070's Biblioteca
          pattern, Miembros since the Admin pass): Tags and Artista live in the sheet. */}
      <div className="flex items-center gap-3">
        <SearchLine
          label="Buscar canciones"
          placeholder="Buscar canción o artista…"
          value={search}
          onChange={setSearch}
          className="flex-1"
        />
        <FiltersPill count={activeFilters} open={filtersOpen} onClick={() => setFiltersOpen(true)} />
      </div>

      <CueDialog open={filtersOpen} mode="sheet" size="md" title="Filtros" label="Filtros" onDismiss={() => setFiltersOpen(false)}>
        <div className="min-h-0 flex-1 space-y-8 overflow-y-auto p-5">
          <section>
            <p className={`mb-3 ${SHEET_TITLE}`}>Tags</p>
            <div className="flex flex-wrap gap-1.5" role="group" aria-label="Tags">
              {tags.map((t) => (
                <Button key={t._id} variant="pill" size="md" active={tagFilter.includes(t.slug.current)} onClick={() => toggleTag(t.slug.current)}>
                  #{t.name}
                </Button>
              ))}
              {tags.length === 0 && <p className="font-body text-sm text-ink-dim">Sin tags todavía.</p>}
            </div>
          </section>
          <section>
            <p className={`mb-3 ${SHEET_TITLE}`}>Artista</p>
            <div className="flex flex-wrap gap-1.5" role="group" aria-label="Artista">
              <Button variant="pill" size="md" active={artistFilter === ""} onClick={() => setArtistFilter("")}>Todos</Button>
              {artistOptions.map((a) => (
                <Button key={a} variant="pill" size="md" active={artistFilter === a} onClick={() => setArtistFilter(a)}>{a}</Button>
              ))}
            </div>
          </section>
          <div className="flex items-center justify-between gap-3 border-t border-ink/[0.10] pt-5">
            <Button variant="ghost" onClick={() => { setTagFilter([]); setArtistFilter(""); }}>Limpiar filtros</Button>
            <Button variant="cta" onClick={() => setFiltersOpen(false)}>
              {`Ver ${plural(categoryFiltered.length, "canción", "canciones")}`}
            </Button>
          </div>
        </div>
      </CueDialog>

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

      {/* Song list: hairline rows under a display-face letter (ADR-0070). */}
      {!loading && !error && (
        <div>
          {filtered.length === 0 && (
            <p className="py-12 text-center font-body text-base text-ink-muted">
              {search || activeFilters > 0 ? "Sin resultados." : "No hay canciones todavía."}
            </p>
          )}
          {groups.map((g) => (
            <section key={g.letter || "search"}>
              {g.letter && (
                <h2 className="pb-1.5 pt-7 font-display text-[28px] font-semibold leading-none text-ink-dim md:text-[34px]">
                  {g.letter}
                </h2>
              )}
              <div className="border-t border-ink/[0.10]">
                {g.rows.map((song) => {
                  const artists = artistNames(song).join(", ");
                  const songTags = song.tags ?? [];
                  const tempo = tempoLine(song);
                  return (
                    <div
                      key={song._id}
                      data-song-row=""
                      className="flex min-h-[68px] items-center gap-3.5 border-b border-ink/[0.10] py-2.5"
                    >
                      <div className="min-w-0 flex-1">
                        <p className="truncate font-body text-[17px] font-semibold leading-tight text-ink">{song.title}</p>
                        {/* Artist and tags as one quiet line: the first two tags on a phone,
                            four from `md`, the rest folded into «+N» — folded to `sr-only`, so a
                            reader still hears every tag. Pure CSS, so 147 rows cost no state. */}
                        {(artists || songTags.length > 0) && (
                          <p className="mt-1 truncate font-body text-sm leading-tight text-ink-muted">
                            {artists}
                            {artists && songTags.length > 0 && <span className="text-ink-dim"> · </span>}
                            {songTags.map((tag, i) => (
                              <span
                                key={tag._id}
                                className={`lowercase ${i >= DESKTOP_TAGS ? "sr-only" : i >= PHONE_TAGS ? "sr-only md:not-sr-only" : ""}`}
                              >
                                {i > 0 && " "}#{tag.name}
                              </span>
                            ))}
                            {songTags.length > PHONE_TAGS && (
                              <span className="text-ink-dim md:hidden" aria-hidden="true"> +{songTags.length - PHONE_TAGS}</span>
                            )}
                            {songTags.length > DESKTOP_TAGS && (
                              <span className="hidden text-ink-dim md:inline" aria-hidden="true"> +{songTags.length - DESKTOP_TAGS}</span>
                            )}
                          </p>
                        )}
                      </div>

                      {tempo && (
                        <span className="hidden shrink-0 font-body text-sm tabular-nums text-ink-muted md:inline">{tempo}</span>
                      )}

                      {/* The key in the display face and the KEY colour (ADR-0071): here the
                          song is the protagonist, as in Biblioteca. No `uppercase`: it would
                          turn «B♭» into «BB». */}
                      <span
                        aria-label={song.key ? `Tono ${formatKey(song.key)}` : "Sin tono"}
                        className={`flex w-9 shrink-0 justify-end font-display text-[22px] font-semibold leading-none ${song.key ? "text-key-fg" : "text-ink-dim"}`}
                      >
                        {formatKey(song.key) || "—"}
                      </span>

                      {/* ONE menu per row, like Miembros: nothing here depends on hover, so a
                          phone reaches every action the desktop does. */}
                      <Menu
                        label={`Acciones de ${song.title}`}
                        align="end"
                        trigger={
                          <Button variant="icon" size="lg" aria-label={`Acciones de ${song.title}`}>
                            <span aria-hidden="true" className="text-base leading-none">⋯</span>
                          </Button>
                        }
                      >
                        <MenuItem icon={<PencilIcon />} onSelect={() => openModal("edit", song)}>
                          Editar
                        </MenuItem>
                        {canDelete && (
                          <MenuItem icon={<TrashIcon />} danger onSelect={() => openModal("delete", song)}>
                            Eliminar
                          </MenuItem>
                        )}
                      </Menu>
                    </div>
                  );
                })}
              </div>
            </section>
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
