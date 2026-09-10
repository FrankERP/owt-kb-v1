"use client";
// app/components/LibraryFilters.tsx — the drawer (spec §12.2): Tipo as three
// segmented tiles, themes as chips sized by count, Artista and Tonalidad selects.
// Tipo and themes are all tags; the tiles just toggle their own slug in `tags`.
import { useMemo, useState } from "react";
import type { Tag, Author } from "@/app/utils/interface";
import { TIPO_SLUGS, type LibraryFilters as F } from "@/app/utils/libraryIndex";
import CueDialog from "./ui/CueDialog";
import SegmentedControl from "./ui/SegmentedControl";
import Select from "./ui/Select";
import Button from "./ui/Button";

type Tipo = (typeof TIPO_SLUGS)[number];
const TIPO_LABEL: Record<Tipo, string> = { "up-beat": "Up beat", "down-beat": "Down beat", transition: "Transición" };

export default function LibraryFilters({ filters, onChange, tags, authors, keys }: { filters: F; onChange: (f: F) => void; tags: Tag[]; authors: Author[]; keys: string[] }) {
  const [open, setOpen] = useState(false);
  const tipo = (TIPO_SLUGS.find((s) => filters.tags.includes(s)) ?? null) as Tipo | null;
  const themes = useMemo(() => tags.filter((t) => !(TIPO_SLUGS as readonly string[]).includes(t.slug.current) && (t.postCount ?? 0) > 0), [tags]);
  const max = Math.max(1, ...themes.map((t) => t.postCount ?? 0));
  const count = filters.tags.length + (filters.author ? 1 : 0) + (filters.key ? 1 : 0);

  const toggleTag = (slug: string) => onChange({ ...filters, tags: filters.tags.includes(slug) ? filters.tags.filter((s) => s !== slug) : [...filters.tags, slug] });
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
            <p className="mb-2 font-label text-[11px] uppercase tracking-widest text-ink-dim">Tipo</p>
            <SegmentedControl label="Tipo de canción" tone="filled" value={tipo ?? ""} onChange={setTipo}
              options={[{ value: "" as const, label: "Todos" }, ...TIPO_SLUGS.map((s) => ({ value: s, label: TIPO_LABEL[s], badge: tags.find((t) => t.slug.current === s)?.postCount }))]} />
          </section>
          <section>
            <p className="mb-2 font-label text-[11px] uppercase tracking-widest text-ink-dim">Temas</p>
            <div className="flex flex-wrap gap-1.5">
              {themes.map((t) => {
                const w = (t.postCount ?? 0) / max;           // chip size follows count (three steps)
                const size = w > 0.66 ? "text-sm px-3 py-1.5" : w > 0.33 ? "text-xs px-2.5 py-1" : "text-[11px] px-2 py-0.5";
                return <Button key={t._id} variant="pill" size="sm" active={filters.tags.includes(t.slug.current)} onClick={() => toggleTag(t.slug.current)} className={`normal-case tracking-normal ${size}`}>#{t.name} <span className="text-ink-dim">{t.postCount}</span></Button>;
              })}
            </div>
          </section>
          <div className="grid gap-4 sm:grid-cols-2">
            <Select id="filtro-artista" label="Artista" value={filters.author} onChange={(e) => onChange({ ...filters, author: e.target.value })}>
              <option value="">Todos</option>
              {authors.map((a) => <option key={a._id} value={a.slug.current}>{a.name}</option>)}
            </Select>
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
