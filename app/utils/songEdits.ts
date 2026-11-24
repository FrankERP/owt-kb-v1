// Editing a song BY PARTS (admin parity phase 3, S3, D3/D4:
// docs/superpowers/plans/2026-10-27-owt-mcp-admin-parity-f3b-song-save.md). Pure: no client, no clock.
//
// The song writer (`songSaveCommit.ts`) writes every array WHOLE — lyrics, charts, tags, authors, links,
// tutorials. The chat therefore never sends an array of its own: `applySongEdits` starts from the FRESH
// document, applies small edits (a passage of the lyrics, one chart, one tag, one link…) and returns the
// writer's raw input with ONLY the fields an edit touched, every untouched item of a touched array
// carried over. The check and the save both call it on a fresh read, so what Frank saw is what is written.
//
// PASSAGES. A passage is matched on the stored text exactly, never normalized at match time. Lyrics
// repeat lines, so a passage found more than once is refused with its count unless the edit says which
// (`all`, or the 1-based `nth`, counted left to right without overlap as `split` finds them). Edits
// apply in order, each to the result of the previous one.
//
// LOSSLESS ONLY (D4). The editor's text form (`bodyToLyrics` / `textToBody`) keeps blocks of spans with
// bold and italic; it drops images, lists, links and inline objects, and turns h2 into h3. A lyrics edit
// is allowed only when the stored body survives that round trip unchanged (ignoring `_key`) and its
// text is already NFC, so a passage diff can never hide a loss elsewhere in the song.

import { bodyToLyrics, textToBody } from "@/app/utils/lyrics";
import { rootIndex } from "@/app/utils/transpose";
import { normalizeText } from "@/app/utils/normalizeText";
import { slugifyAuthor } from "@/app/utils/slugifyAuthor.mjs";
import { isSafeHttpUrl, normalizeLinkRows } from "@/app/utils/linkRowWrite";
import type { NewAuthor, SongWriteInput } from "@/app/utils/songSaveCommit";

// ── Shapes ───────────────────────────────────────────────────────────────────

export const SET_FIELDS = ["title", "key", "bpm", "timeSig", "musicalReferenceUrl", "lyricsVideoUrl"] as const;
export type SetField = (typeof SET_FIELDS)[number];

export type PassageEdit = { replace: string; with: string; all?: boolean; nth?: number };

export type SongEdit =
  | { op: "set"; field: SetField; value: string }
  | ({ op: "lyrics" } & PassageEdit)
  | { op: "lyricsAll"; text: string }
  | ({ op: "chart"; chartKey: string } & PassageEdit)
  | { op: "chartAll"; chartKey: string; content: string }
  | { op: "addChart"; key: string; content: string }
  | { op: "removeChart"; chartKey: string }
  | { op: "addTag"; name: string }
  | { op: "removeTag"; name: string }
  | { op: "authors"; names: string[] }
  | { op: "addLink"; label: string; url: string }
  | { op: "removeLink"; label: string }
  | { op: "addTutorial"; label: string; url: string }
  | { op: "removeTutorial"; label: string };

export interface NamedDoc {
  _id: string;
  name: string | null;
  slug: string | null;
}

/** The song as the chat's tools read it (published perspective). */
export interface StoredSong {
  _id: string;
  _rev: string;
  title: string | null;
  key: string | null;
  bpm: unknown;
  timeSig: string | null;
  body: unknown[] | null;
  chords: { _key: string | null; key: string | null; content: string | null }[] | null;
  /** The raw references, so a tag or author the read could not dereference is never dropped. */
  tagRefs: (string | null)[] | null;
  authorRefs: (string | null)[] | null;
  referenceLinks: { label: string | null; url: string | null }[] | null;
  tutorials2: { title: string | null; url: string | null }[] | null;
  musicalReferenceUrl: string | null;
  lyricsVideoUrl: string | null;
}

/** Every tag and author, to resolve names (published perspective). */
export interface SongCatalog {
  tags: readonly NamedDoc[];
  authors: readonly NamedDoc[];
}

export type ApplySongEditsResult =
  | {
      ok: true;
      /** The writer's raw input: ONLY the fields an edit touched. */
      raw: SongWriteInput;
      /** Authors to create in the save's own transaction (D1, D7). */
      newAuthors: NewAuthor[];
      /** The lyrics text before and after, when a lyrics edit touched it. */
      lyrics: { before: string; after: string } | null;
    }
  | { ok: false; message: string };

// ── Lyrics: the lossless gate ────────────────────────────────────────────────

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);
const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
const isNfc = (t: string) => t === t.normalize("NFC");

function sameBlock(stored: unknown, rebuilt: Record<string, unknown>): boolean {
  if (!isObj(stored) || stored._type !== "block") return false;
  if (stored.style !== rebuilt.style) return false;
  if ((stored.listItem ?? undefined) !== undefined || (stored.level ?? undefined) !== undefined) return false;
  if (arr(stored.markDefs).length !== 0) return false;
  const a = arr(stored.children);
  const b = arr(rebuilt.children);
  if (a.length !== b.length) return false;
  return a.every((child, i) => {
    const other = b[i] as Record<string, unknown>;
    if (!isObj(child) || child._type !== "span") return false;
    const marks = arr(child.marks);
    const otherMarks = arr(other.marks);
    return child.text === other.text && marks.length === otherMarks.length && marks.every((m, j) => m === otherMarks[j]);
  });
}

/**
 * The stored lyrics as the editor's text, and whether a lyrics edit may touch them: `structural` when
 * the WHOLE body equals `textToBody(bodyToLyrics(body))` ignoring `_key` (every entry a block, the same
 * style, no list, no mark definitions, the same spans with the same marks); `nfc` when that text is
 * already NFC. Passage edits need both; replacing the whole text needs `structural` (A2).
 */
export function lyricsGate(body: unknown[] | null | undefined): { text: string; structural: boolean; nfc: boolean } {
  const entries = arr(body);
  const text = bodyToLyrics(entries as never);
  const rebuilt = textToBody(text) as unknown as Record<string, unknown>[];
  const structural = entries.length === rebuilt.length && entries.every((e, i) => sameBlock(e, rebuilt[i]!));
  return { text, structural, nfc: isNfc(text) };
}

/** Whether a NEW lyrics text survives the editor's own round trip (A1: the markers are formatting). */
export function lyricsRoundTrips(text: string): boolean {
  return bodyToLyrics(textToBody(text) as never) === text;
}

// ── Passages ─────────────────────────────────────────────────────────────────

/** Occurrences of `passage` in `text`, left to right without overlap — as `split` finds them. */
export function countOccurrences(text: string, passage: string): number {
  return passage ? text.split(passage).length - 1 : 0;
}

function applyPassage(text: string, edit: PassageEdit, what: string): { ok: true; text: string } | { ok: false; message: string } {
  if (!edit.replace) return { ok: false, message: `${what}: el texto a reemplazar está vacío.` };
  if (edit.all && edit.nth != null) return { ok: false, message: `${what}: usa all o nth, no ambos.` };
  const parts = text.split(edit.replace);
  const count = parts.length - 1;
  if (count === 0) return { ok: false, message: `${what}: no se encontró «${edit.replace}».` };
  if (edit.all) return { ok: true, text: parts.join(edit.with) };
  if (edit.nth != null) {
    if (!Number.isInteger(edit.nth) || edit.nth < 1 || edit.nth > count) {
      return { ok: false, message: `${what}: «${edit.replace}» aparece ${count} ${count === 1 ? "vez" : "veces"}; nth debe estar entre 1 y ${count}.` };
    }
    const head = parts.slice(0, edit.nth).join(edit.replace);
    const tail = parts.slice(edit.nth).join(edit.replace);
    return { ok: true, text: `${head}${edit.with}${tail}` };
  }
  if (count > 1) {
    return {
      ok: false,
      message: `${what}: «${edit.replace}» aparece ${count} veces; di cuál con nth (1 a ${count}) o todas con all: true.`,
    };
  }
  return { ok: true, text: parts.join(edit.with) };
}

// ── Names ────────────────────────────────────────────────────────────────────

const same = (a: string | null | undefined, b: string | null | undefined) => normalizeText(a?.trim()) === normalizeText(b?.trim());

/** A tag by name or slug (accents and case ignored); several with that name are ambiguous. */
function resolveTag(name: string, tags: readonly NamedDoc[]): { ok: true; tag: NamedDoc } | { ok: false; message: string } {
  const byName = tags.filter((t) => same(t.name, name));
  if (byName.length > 1) return { ok: false, message: `Hay ${byName.length} etiquetas llamadas «${name}»; arréglalo en Studio.` };
  const hit = byName[0] ?? tags.find((t) => t.slug && t.slug === name.trim());
  if (hit) return { ok: true, tag: hit };
  const names = tags.map((t) => t.name).filter(Boolean).sort((a, b) => a!.localeCompare(b!, "es"));
  return { ok: false, message: `No existe la etiqueta «${name}» (desde el chat no se crean). Las que hay: ${names.join(", ")}.` };
}

export type ResolvedAuthor = { kind: "existing"; id: string; name: string } | { kind: "new"; author: NewAuthor };

/**
 * An author by name (A4, D7): first among the song's current authors, then among all, by name with
 * accents and case ignored; then by `slugifyAuthor(name)` against `slug.current`. Unmatched → a new
 * author `author-<slug>`, created only in the save's own transaction. An empty slug is refused.
 */
export function resolveAuthor(
  name: string,
  current: readonly NamedDoc[],
  all: readonly NamedDoc[],
): { ok: true; author: ResolvedAuthor } | { ok: false; message: string } {
  const clean = name.trim();
  if (!clean) return { ok: false, message: "Un artista no puede ir vacío." };
  const own = current.filter((a) => same(a.name, clean));
  if (own.length === 1) return { ok: true, author: { kind: "existing", id: own[0]!._id, name: own[0]!.name ?? clean } };
  const byName = all.filter((a) => same(a.name, clean));
  if (byName.length > 1) return { ok: false, message: `Hay ${byName.length} artistas llamados «${clean}»; arréglalo en Studio.` };
  if (byName.length === 1) return { ok: true, author: { kind: "existing", id: byName[0]!._id, name: byName[0]!.name ?? clean } };
  const slug = slugifyAuthor(clean);
  if (!slug) return { ok: false, message: `«${clean}» no da un identificador válido (usa letras latinas).` };
  const bySlug = all.find((a) => a.slug === slug);
  if (bySlug) return { ok: true, author: { kind: "existing", id: bySlug._id, name: bySlug.name ?? clean } };
  // The id the new author would take is already used (an author renamed in Studio): `createIfNotExists`
  // would write nothing and the song would point at that author, so the check must say so instead.
  const taken = all.find((a) => a._id === `author-${slug}`);
  if (taken) {
    return { ok: false, message: `«${clean}» chocaría con el artista «${taken.name ?? "sin nombre"}»; usa ese nombre o arréglalo en Studio.` };
  }
  return { ok: true, author: { kind: "new", author: { _id: `author-${slug}`, name: clean, slug } } };
}

/** Resolve a whole artist list; the same artist twice is refused. */
export function resolveAuthors(
  names: readonly string[],
  current: readonly NamedDoc[],
  all: readonly NamedDoc[],
): { ok: true; ids: string[]; newAuthors: NewAuthor[]; resolved: ResolvedAuthor[] } | { ok: false; message: string } {
  const ids: string[] = [];
  const newAuthors: NewAuthor[] = [];
  const resolved: ResolvedAuthor[] = [];
  for (const name of names) {
    const r = resolveAuthor(name, current, all);
    if (!r.ok) return r;
    const id = r.author.kind === "existing" ? r.author.id : r.author.author._id;
    if (ids.includes(id)) return { ok: false, message: `«${name.trim()}» está dos veces en la lista de artistas.` };
    ids.push(id);
    resolved.push(r.author);
    if (r.author.kind === "new") newAuthors.push(r.author.author);
  }
  return { ok: true, ids, newAuthors, resolved };
}

/** A key the app can transpose: English letter notation («G», «Bb», «F#m»). */
export function parsesAsKey(key: string): boolean {
  return rootIndex(key.trim()) >= 0;
}

export const KEY_HINT = "Los tonos van en notación inglesa: Do = C, Re = D, Mi = E, Fa = F, Sol = G, La = A, Si = B (por ejemplo «G», «Bb», «F#m»).";

export function validBpm(value: string): boolean {
  if (value === "") return true;
  const n = Number(value);
  return /^\d{1,3}(\.\d+)?$/.test(value) && n > 0 && n <= 400;
}

// ── Apply ────────────────────────────────────────────────────────────────────

type ChartRow = { _key?: string; key: string; content: string };
type LinkRow = { label: string; url: string };
type TutorialRow = { title: string; url: string };

const FIELD_LABEL: Record<SetField, string> = {
  title: "título",
  key: "tono",
  bpm: "bpm",
  timeSig: "compás",
  musicalReferenceUrl: "referencia musical",
  lyricsVideoUrl: "video de letra",
};

/** Rows with a label: the ONE row with that label (accents and case ignored), or why not. */
function rowIndexByLabel<T>(rows: readonly T[], label: string, labelOf: (row: T) => string, what: string): { ok: true; index: number } | { ok: false; message: string } {
  const hits = rows.map((r, i) => (same(labelOf(r), label) ? i : -1)).filter((i) => i >= 0);
  if (hits.length === 0) return { ok: false, message: `No hay ${what} «${label}».` };
  if (hits.length > 1) return { ok: false, message: `Hay ${hits.length} ${what}s «${label}»: no se puede saber cuál; arréglalo en /admin.` };
  return { ok: true, index: hits[0]! };
}

/**
 * Apply `edits` in order to the fresh `song`. Returns the writer's raw input with only the touched
 * fields, the authors to create, and the lyrics before/after — or the first refusal, naming the edit.
 */
export function applySongEdits(song: StoredSong, edits: readonly SongEdit[], catalog: SongCatalog): ApplySongEditsResult {
  const raw: SongWriteInput = {};
  let newAuthors: NewAuthor[] = [];

  const gate = lyricsGate(song.body);
  let lyrics: string | null = null; // the working text, once a lyrics edit touched it

  let charts: ChartRow[] | null = null;
  const chartsNow = (): ChartRow[] =>
    (charts ??= (song.chords ?? [])
      .filter((c) => isObj(c))
      .map((c) => ({ ...(c._key ? { _key: c._key } : {}), key: c.key ?? "", content: c.content ?? "" })));

  let tagIds: string[] | null = null;
  const tagsNow = (): string[] => (tagIds ??= (song.tagRefs ?? []).filter((id): id is string => typeof id === "string" && !!id));

  let links: LinkRow[] | null = null;
  const linksNow = (): LinkRow[] => (links ??= (song.referenceLinks ?? []).filter(isObj).map((l) => ({ label: l.label ?? "", url: l.url ?? "" })));
  let tutorials: TutorialRow[] | null = null;
  const tutorialsNow = (): TutorialRow[] =>
    (tutorials ??= (song.tutorials2 ?? []).filter(isObj).map((t) => ({ title: t.title ?? "", url: t.url ?? "" })));

  const currentAuthors = (song.authorRefs ?? [])
    .map((id) => catalog.authors.find((a) => a._id === id))
    .filter((a): a is NamedDoc => !!a);

  for (let i = 0; i < edits.length; i++) {
    const edit = edits[i]!;
    const n = `Cambio ${i + 1}`;
    const no = (message: string): ApplySongEditsResult => ({ ok: false, message: `${n}: ${message}` });

    switch (edit.op) {
      case "set": {
        const value = edit.value.trim();
        if (edit.field === "title") {
          if (!value) return no("el título no se puede borrar.");
          raw.title = value;
        } else if (edit.field === "key") {
          if (value && !parsesAsKey(value)) return no(`«${value}» no es un tono. ${KEY_HINT}`);
          raw.key = value;
        } else if (edit.field === "bpm") {
          if (!validBpm(value)) return no(`«${value}» no es un bpm (un número entre 1 y 400, o vacío para borrarlo).`);
          raw.bpm = value;
        } else if (edit.field === "timeSig") {
          raw.timeSig = value;
        } else {
          if (value && !isSafeHttpUrl(value)) return no(`la ${FIELD_LABEL[edit.field]} debe empezar con http:// o https://.`);
          raw[edit.field] = value;
        }
        break;
      }
      case "lyrics":
      case "lyricsAll": {
        if (!gate.structural) return no("esta letra tiene formato que el editor no conserva (imagen, lista, enlace u otro); edítala en Studio.");
        if (edit.op === "lyrics") {
          if (!gate.nfc) return no("esta letra tiene caracteres sin normalizar; cámbiala completa (lyricsAll) o en Studio.");
          const r = applyPassage(lyrics ?? gate.text, edit, "letra");
          if (!r.ok) return no(r.message);
          lyrics = r.text;
        } else {
          lyrics = edit.text;
        }
        if (!lyricsRoundTrips(lyrics)) {
          return no("el resultado tiene marcas que el editor no puede guardar tal cual (asteriscos sueltos o «# » a medias); revisa el texto.");
        }
        break;
      }
      case "chart":
      case "chartAll":
      case "removeChart": {
        const list = chartsNow();
        const index = list.findIndex((c) => c._key === edit.chartKey);
        if (index < 0) return no(`no hay un acorde con chartKey «${edit.chartKey}» (míralos con get_song full: true).`);
        if (edit.op === "removeChart") {
          list.splice(index, 1);
        } else if (edit.op === "chartAll") {
          list[index] = { ...list[index]!, content: edit.content };
        } else {
          if (!isNfc(list[index]!.content)) return no("este acorde tiene caracteres sin normalizar; cámbialo completo (chartAll).");
          const r = applyPassage(list[index]!.content, edit, `acorde en ${list[index]!.key || "sin tono"}`);
          if (!r.ok) return no(r.message);
          list[index] = { ...list[index]!, content: r.text };
        }
        break;
      }
      case "addChart": {
        const key = edit.key.trim();
        if (!parsesAsKey(key)) return no(`«${key}» no es un tono. ${KEY_HINT}`);
        if (!edit.content.trim()) return no("el acorde nuevo no tiene contenido.");
        const list = chartsNow();
        if (list.some((c) => c.key.trim().toLowerCase() === key.toLowerCase())) {
          return no(`ya hay un acorde en ${key}: cámbialo con chart o chartAll.`);
        }
        list.push({ key, content: edit.content });
        break;
      }
      case "addTag":
      case "removeTag": {
        const r = resolveTag(edit.name, catalog.tags);
        if (!r.ok) return no(r.message);
        const list = tagsNow();
        const has = list.includes(r.tag._id);
        if (edit.op === "addTag") {
          if (has) return no(`ya tiene la etiqueta «${r.tag.name}».`);
          list.push(r.tag._id);
        } else {
          if (!has) return no(`no tiene la etiqueta «${r.tag.name}».`);
          tagIds = list.filter((id) => id !== r.tag._id);
        }
        break;
      }
      case "authors": {
        const r = resolveAuthors(edit.names, currentAuthors, catalog.authors);
        if (!r.ok) return no(r.message);
        raw.authorIds = r.ids;
        newAuthors = r.newAuthors;
        break;
      }
      case "addLink": {
        if (!edit.label.trim()) return no("el link necesita una etiqueta.");
        if (!isSafeHttpUrl(edit.url.trim())) return no("la URL del link debe empezar con http:// o https://.");
        linksNow().push({ label: edit.label.trim(), url: edit.url.trim() });
        break;
      }
      case "removeLink": {
        const list = linksNow();
        const r = rowIndexByLabel(list, edit.label, (l) => l.label, "link");
        if (!r.ok) return no(r.message);
        list.splice(r.index, 1);
        break;
      }
      case "addTutorial": {
        if (!edit.label.trim()) return no("el tutorial necesita un título.");
        if (!isSafeHttpUrl(edit.url.trim())) return no("la URL del tutorial debe empezar con http:// o https://.");
        tutorialsNow().push({ title: edit.label.trim(), url: edit.url.trim() });
        break;
      }
      case "removeTutorial": {
        const list = tutorialsNow();
        const r = rowIndexByLabel(list, edit.label, (t) => t.title, "tutorial");
        if (!r.ok) return no(r.message);
        list.splice(r.index, 1);
        break;
      }
    }
  }

  if (lyrics !== null) raw.lyrics = lyrics;
  if (charts !== null) raw.chords = charts;
  if (tagIds !== null) raw.tagIds = tagIds;
  // A list with a stored row the writer refuses (a label with a broken URL) is refused here, naming
  // the row, unless the same call removed it: the writer would otherwise refuse the whole save.
  if (links !== null) {
    const check = normalizeLinkRows(links, { type: "referenceLink", labelField: "label", humanName: "Links de referencia", mintKey: () => "k" });
    if (!check.ok) return { ok: false, message: `${check.error}. Quítalo en la misma llamada (removeLink) o arréglalo en /admin.` };
    raw.referenceLinks = links;
  }
  if (tutorials !== null) {
    const check = normalizeLinkRows(tutorials, { type: "tutorial", labelField: "title", humanName: "Tutoriales", mintKey: () => "k" });
    if (!check.ok) return { ok: false, message: `${check.error}. Quítalo en la misma llamada (removeTutorial) o arréglalo en /admin.` };
    raw.tutorials = tutorials;
  }

  return { ok: true, raw, newAuthors, lyrics: lyrics !== null ? { before: gate.text, after: lyrics } : null };
}
