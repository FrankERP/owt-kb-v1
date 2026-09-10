"use client";
// app/components/LibraryFilters.tsx — the drawer (spec §12.2, F3): Tipo as four
// segmented tiles, themes and artists as searchable chip clouds, Tonalidad a
// Select. Tipo and themes are all tags; the tiles just toggle their own slug in
// `tags`.
//
// Temas and Artista are SEARCHABLE (F3) because both clouds outgrew a dropdown:
// 43 themes and 80-odd artists are not a list anyone scans. Tonalidad keeps its
// `Select` — 15 options is a list.
import { useMemo, useState } from "react";
import type { Tag, Author } from "@/app/utils/interface";
import { TIPO_SLUGS, type LibraryFilters as F } from "@/app/utils/libraryIndex";
import { normalizeText } from "@/app/utils/normalizeText";
import CueDialog from "./ui/CueDialog";
import SegmentedControl from "./ui/SegmentedControl";
import Select from "./ui/Select";
import Button from "./ui/Button";

type Tipo = (typeof TIPO_SLUGS)[number];
const TIPO_LABEL: Record<Tipo, string> = { "up-beat": "Up beat", "down-beat": "Down beat", transition: "Transición" };

/** Artists shown before anyone types. The busiest few are the useful default; the
 *  rest are reachable by name, which is how a search box earns its place. */
const ARTIST_PREVIEW = 12;

const EYEBROW = "mb-2 font-label text-[11px] uppercase tracking-widest text-ink-dim";
// Chip size follows count, in three steps — the same scale for themes and artists.
const chipSize = (w: number) => (w > 0.66 ? "text-sm px-3 py-1.5" : w > 0.33 ? "text-xs px-2.5 py-1" : "text-[11px] px-2 py-0.5");

/** The shared search box over a chip cloud. `brand-search-console` chrome, same
 *  as the page's own console, so the drawer reads as part of the same surface. */
function ChipSearch({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  return (
    <div className="brand-search-console mb-2">
      <input
        type="search"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        aria-label={label}
        placeholder={label}
        className="w-full bg-transparent px-3 py-2 font-label text-xs text-ink placeholder:text-placeholder focus:outline-none"
      />
    </div>
  );
}

export default function LibraryFilters({ filters, onChange, tags, authors, keys }: { filters: F; onChange: (f: F) => void; tags: Tag[]; authors: Author[]; keys: string[] }) {
  const [open, setOpen] = useState(false);
  const [themeQ, setThemeQ] = useState("");
  const [artistQ, setArtistQ] = useState("");
  const tipo = (TIPO_SLUGS.find((s) => filters.tags.includes(s)) ?? null) as Tipo | null;
  const themes = useMemo(() => tags.filter((t) => !(TIPO_SLUGS as readonly string[]).includes(t.slug.current) && (t.postCount ?? 0) > 0), [tags]);
  const max = Math.max(1, ...themes.map((t) => t.postCount ?? 0));
  const count = filters.tags.length + (filters.author ? 1 : 0) + (filters.key ? 1 : 0);

  // A chosen theme must never vanish because the query moved on — an invisible
  // chip is an unremovable filter. Non-matching selections pin to the front.
  const shownThemes = useMemo(() => {
    const q = normalizeText(themeQ.trim());
    if (!q) return themes;
    const matches = themes.filter((t) => normalizeText(t.name).includes(q));
    const pinned = themes.filter((t) => filters.tags.includes(t.slug.current) && !matches.includes(t));
    return [...pinned, ...matches];
  }, [themes, themeQ, filters.tags]);

  const artistMax = Math.max(1, ...authors.map((a) => a.postCount ?? 0));
  const shownArtists = useMemo(() => {
    const q = normalizeText(artistQ.trim());
    const byCount = [...authors].sort((a, b) => (b.postCount ?? 0) - (a.postCount ?? 0));
    const pool = q ? byCount.filter((a) => normalizeText(a.name).includes(q)) : byCount.slice(0, ARTIST_PREVIEW);
    const selected = authors.find((a) => a.slug.current === filters.author);
    return selected ? [selected, ...pool.filter((a) => a._id !== selected._id)] : pool;
  }, [authors, artistQ, filters.author]);

  const toggleTag = (slug: string) => onChange({ ...filters, tags: filters.tags.includes(slug) ? filters.tags.filter((s) => s !== slug) : [...filters.tags, slug] });
  // Artista is single-select: a second tap on the chosen one clears it (unlike
  // SegmentedControl, a chip does fire on re-press, so no «Todos» tile is needed).
  const pickArtist = (slug: string) => onChange({ ...filters, author: filters.author === slug ? "" : slug });
  // SegmentedControl never fires onChange for the already-checked option
  // (spec note b), so "tap it again to clear" cannot exist; a fourth tile,
  // «Todos», is the clear. `tipo ?? ""` maps "no Tipo" onto it.
  const setTipo = (next: Tipo | "") =>
    onChange({ ...filters, tags: [...filters.tags.filter((s) => !(TIPO_SLUGS as readonly string[]).includes(s)), ...(next ? [next] : [])] });

  return (
    <>
      <Button variant="secondary" size="lg" aria-haspopup="dialog" aria-expanded={open} onClick={() => setOpen(true)} className="shrink-0">
        Filtros{count > 0 ? ` · ${count}` : ""}
      </Button>
      <CueDialog open={open} mode="sheet" size="md" title="Filtros" label="Filtros" onDismiss={() => setOpen(false)}>
        <div className="space-y-6 p-5">
          <section>
            <p className={EYEBROW}>Tipo</p>
            {/* Four tiles must fit a 390 px sheet: small size, full width, equal shares. No count badges — they read as alerts. */}
            <SegmentedControl label="Tipo de canción" tone="filled" size="sm" className="flex w-full [&>button]:flex-1 [&>button]:px-1" value={tipo ?? ""} onChange={setTipo}
              options={[{ value: "" as const, label: "Todos" }, ...TIPO_SLUGS.map((s) => ({ value: s, label: TIPO_LABEL[s] }))]} />
          </section>
          <section>
            <p className={EYEBROW}>Temas</p>
            <ChipSearch label="Buscar tema" value={themeQ} onChange={setThemeQ} />
            <div className="flex flex-wrap gap-1.5">
              {shownThemes.map((t) => (
                <Button key={t._id} variant="pill" size="sm" active={filters.tags.includes(t.slug.current)} onClick={() => toggleTag(t.slug.current)} className={`normal-case tracking-normal ${chipSize((t.postCount ?? 0) / max)}`}>#{t.name} <span className="text-ink-dim">{t.postCount}</span></Button>
              ))}
            </div>
            {shownThemes.length === 0 && <p className="font-label text-xs text-ink-dim">Sin temas que coincidan</p>}
          </section>
          <section>
            <p className={EYEBROW}>Artista</p>
            <ChipSearch label="Buscar artista" value={artistQ} onChange={setArtistQ} />
            <div className="flex flex-wrap gap-1.5">
              {shownArtists.map((a) => (
                <Button key={a._id} variant="pill" size="sm" active={filters.author === a.slug.current} onClick={() => pickArtist(a.slug.current)} className={`normal-case tracking-normal ${chipSize((a.postCount ?? 0) / artistMax)}`}>{a.name}{(a.postCount ?? 0) > 0 && <span className="text-ink-dim">{a.postCount}</span>}</Button>
              ))}
            </div>
            {shownArtists.length === 0 && <p className="font-label text-xs text-ink-dim">Sin artistas que coincidan</p>}
          </section>
          {/* The two-column grid survives with one child on purpose: Tonalidad
              keeps the half-width it had beside Artista, instead of stretching
              across the sheet now that Artista is a cloud above it. */}
          <div className="grid gap-4 sm:grid-cols-2">
            <Select id="filtro-tonalidad" label="Tonalidad" value={filters.key} onChange={(e) => onChange({ ...filters, key: e.target.value })}>
              <option value="">Todas</option>
              {keys.map((k) => <option key={k} value={k}>{k}</option>)}
            </Select>
          </div>
          <div className="flex justify-between">
            <Button variant="ghost" onClick={() => onChange({ ...filters, tags: [], author: "", key: "" })}>Limpiar filtros</Button>
            <Button variant="primary" onClick={() => setOpen(false)}>Listo</Button>
          </div>
        </div>
      </CueDialog>
    </>
  );
}
