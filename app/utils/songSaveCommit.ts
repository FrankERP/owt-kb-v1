// The song writer, after authorization: create a song, edit one, and the authors route's idempotent
// «create or return» (admin parity phase 3, S3:
// docs/superpowers/plans/2026-10-27-owt-mcp-admin-parity-f3b-song-save.md). `POST /api/content/posts`,
// `PATCH /api/content/posts/[id]` and `POST /api/content/authors` check `requireActiveManager`, parse
// JSON and call these; the MCP song tools call `createSong` / `patchSong` (never `ensureAuthors`), so
// both surfaces validate, key and serialize through one code path (ADR-0043).
//
// WHOLE FIELDS. Every array this writer touches is written whole: `body` (re-derived from the lyrics
// text by `textToBody`), `chords`, `tags`, `authors`, `referenceLinks`, `tutorials2`. A caller that sends
// one element deletes the others; the chat builds its input from the fresh document by parts
// (`songEdits.ts`) for exactly that reason.
//
// TWO CALLERS, ONE BODY. Without `opts` (the routes) the statements are the routes' own: last writer
// wins, a random id on create. With `opts` (the chat) the writer takes a deterministic id or an
// `ifRevisionId`, and the authors the chat names that do not exist yet (`newAuthors`): those are
// created in the SAME transaction as the song (`createIfNotExists` each), because the writer's own
// author read cannot see an author the transaction is about to create, and a separate write first
// could orphan one.
//
// Nobody is notified by a song write; the library and the song pages are revalidated.

import { serverClient, writeClient } from "@/sanity/lib/serverClient";
import { textToBody } from "@/app/utils/lyrics";
import { revalidateSongViews } from "@/app/utils/revalidate";
import { normalizeChordCharts, type ChordChartWrite } from "@/app/utils/chordChartWrite";
import { isSafeHttpUrl, normalizeLinkRows, type LinkRowWrite } from "@/app/utils/linkRowWrite";
import { sanityConflictKind } from "@/app/utils/roleWriteRequest";
import { slugifyAuthor } from "@/app/utils/slugifyAuthor.mjs";
import type { CommitOutcome } from "@/app/utils/commitOutcome";

function rng() { return Math.random().toString(36).slice(2, 9); }

/** What both editors (and the chat) send. Untrusted JSON: the routes never validated the types. */
export interface SongWriteInput {
  title?: string;
  author?: string;
  key?: string;
  bpm?: string;
  timeSig?: string;
  lyrics?: string;
  chords?: Array<{ _key?: string; key: string; content: string }>;
  referenceLinks?: Array<{ label: string; url: string }>;
  musicalReferenceUrl?: string;
  lyricsVideoUrl?: string;
  tutorials?: Array<{ title: string; url: string }>;
  tagIds?: string[];
  authorIds?: string[];
}

/** An author the chat names that does not exist yet: created with the song, never before it. */
export interface NewAuthor {
  _id: string;
  name: string;
  slug: string;
}

export interface AuthorRow {
  _id: string;
  name: string;
}

type Ref = { _type: "reference"; _ref: string; _key: string };

export const SONG_ERROR = {
  forbidden: "No tienes permiso para editar canciones.",
  titleRequired: "El título es obligatorio.",
  unsafeUrl: "Las URLs de referencia deben empezar con http:// o https://",
  charts: "No se pudieron guardar los acordes.",
  notFound: "No se encontró la canción.",
  notASong: "Ese documento no es una canción.",
  staleRevision: "stale_revision",
  alreadyExists: "already_exists",
} as const;

type Refusal = { ok: false; status: number; body: Record<string, unknown> };

function refuse(status: number, body: Record<string, unknown>): Refusal {
  return { ok: false, status, body };
}

/** Untrusted JSON as an object whose fields may be read; anything else reads as `{}`. */
function fields(raw: unknown): SongWriteInput {
  return raw && typeof raw === "object" && !Array.isArray(raw) ? (raw as SongWriteInput) : {};
}

// ── Pure parts (the chat's before/after renders the same writes) ─────────────

/**
 * The song's authors as written: `authors[]` references in the order of `authorIds` (unknown ids
 * dropped) and the legacy `author` string rebuilt from their names. `found` is what the writer's
 * read returned; `newAuthors` count as found (the same transaction creates them).
 */
export function resolveSongAuthors(
  found: readonly AuthorRow[],
  newAuthors: readonly NewAuthor[],
  authorIds: readonly string[],
  mintKey: () => string = rng,
): { author: string; authors: Ref[] } {
  const byId = new Map<string, string>(found.map((n) => [n._id, n.name]));
  for (const a of newAuthors) if (!byId.has(a._id)) byId.set(a._id, a.name);
  return {
    author: authorIds.map((id) => byId.get(id)).filter(Boolean).join(", "),
    authors: authorIds.filter((id) => byId.has(id)).map((id) => ({ _type: "reference", _ref: id, _key: mintKey() })),
  };
}

/** The create slug: `${title}-${author}`, lowercased, spaces → `-`, everything outside `[a-z0-9-]` dropped, 96 chars. */
export function songSlug(title: string, authorStr: string): string {
  return `${title}-${authorStr}`.toLowerCase().replace(/\s+/g, "-").replace(/[^a-z0-9-]/g, "").slice(0, 96);
}

/** The create's refusals that come before any read, in the route's order. */
function createEarlyRefusal(body: SongWriteInput): Refusal | null {
  if (!body.title?.trim()) return refuse(400, { error: SONG_ERROR.titleRequired });
  for (const u of [body.musicalReferenceUrl, body.lyricsVideoUrl]) {
    if (u != null && u !== "" && !isSafeHttpUrl(u)) return refuse(400, { error: SONG_ERROR.unsafeUrl });
  }
  return null;
}

export type SongCreateDoc = {
  _type: "post";
  title: string;
  author: string;
  authors: Ref[];
  slug: { _type: "slug"; current: string };
  key: string;
  bpm: number | undefined;
  timeSig: string;
  body: ReturnType<typeof textToBody>;
  chords: ChordChartWrite[];
  referenceLinks: LinkRowWrite[];
  musicalReferenceUrl: string | undefined;
  lyricsVideoUrl: string | undefined;
  tags: Ref[];
  publishDate: string;
};

/** The document a create writes, or the refusal — pure; `authorRows` is the writer's author read. */
export function buildSongCreate(
  raw: unknown,
  authorRows: readonly AuthorRow[],
  newAuthors: readonly NewAuthor[],
  nowIso: string,
  mintKey: () => string = rng,
): { ok: true; doc: SongCreateDoc } | Refusal {
  const body = fields(raw);
  const early = createEarlyRefusal(body);
  if (early) return early;

  let authorStr = body.author?.trim() ?? "";
  let authorRefs: Ref[] = [];
  if (body.authorIds != null) {
    const resolved = resolveSongAuthors(authorRows, newAuthors, body.authorIds, mintKey);
    authorStr = resolved.author;
    authorRefs = resolved.authors;
  }

  const slugBase = songSlug(body.title!, authorStr);

  const chords = normalizeChordCharts(body.chords ?? [], mintKey);
  if (!chords.ok) {
    // `chords.error` is developer-shaped («chords[0] has a duplicate _key») and
    // the editor now shows what this route says, so it is summarised for the
    // person reading it. The precise text stays in the server log.
    return refuse(400, { error: SONG_ERROR.charts, detail: chords.error });
  }

  // Drops the blank «Agregar» row instead of 400ing the whole save over it —
  // see `linkRowWrite.ts`. A row with a label but no URL still fails, by name.
  const links = normalizeLinkRows(body.referenceLinks, {
    type: "referenceLink", labelField: "label", humanName: "Links de referencia", mintKey,
  });
  if (!links.ok) return refuse(400, { error: links.error });

  return {
    ok: true,
    doc: {
      _type: "post",
      title: body.title!.trim(),
      author: authorStr,
      authors: authorRefs,
      slug: { _type: "slug", current: slugBase },
      key: body.key?.trim() ?? "",
      bpm: body.bpm ? Number(body.bpm) : undefined,
      timeSig: body.timeSig?.trim() ?? "",
      body: body.lyrics ? textToBody(body.lyrics) : [],
      chords: chords.charts,
      referenceLinks: links.rows,
      musicalReferenceUrl: body.musicalReferenceUrl?.trim() || undefined,
      lyricsVideoUrl: body.lyricsVideoUrl?.trim() || undefined,
      tags: (body.tagIds ?? []).map((id) => ({ _type: "reference", _ref: id, _key: mintKey() })),
      publishDate: nowIso,
    },
  };
}

/** The edit's refusals that come before any read, in the route's order. */
function patchEarlyRefusal(body: SongWriteInput): Refusal | null {
  // Both lists drop their blank «Agregar» row rather than 400ing the whole
  // PATCH over it — see `linkRowWrite.ts`. A row with a label but no URL still
  // fails, and the error names it.
  const links = normalizeLinkRows(body.referenceLinks, {
    type: "referenceLink", labelField: "label", humanName: "Links de referencia", mintKey: rng,
  });
  if (!links.ok) return refuse(400, { error: links.error });
  const tutorials = normalizeLinkRows(body.tutorials, {
    type: "tutorial", labelField: "title", humanName: "Tutoriales", mintKey: rng,
  });
  if (!tutorials.ok) return refuse(400, { error: tutorials.error });
  for (const u of [body.musicalReferenceUrl, body.lyricsVideoUrl]) {
    if (u != null && u !== "" && !isSafeHttpUrl(u)) return refuse(400, { error: SONG_ERROR.unsafeUrl });
  }
  return null;
}

/** The two URL fields: an empty value CLEARS the field (an `unset`), never a `set` of `undefined`. */
export const SONG_URL_FIELDS = ["musicalReferenceUrl", "lyricsVideoUrl"] as const;

/**
 * What an edit writes — `set` and `unset` — or the refusal; pure. A field is written only when its
 * raw value is present (`!= null`). `authorRows` is the writer's author read.
 */
export function buildSongPatch(
  raw: unknown,
  authorRows: readonly AuthorRow[],
  newAuthors: readonly NewAuthor[],
  mintKey: () => string = rng,
): { ok: true; set: Record<string, unknown>; unset: string[] } | Refusal {
  const body = fields(raw);
  const early = patchEarlyRefusal(body);
  if (early) return early;

  const patch: Record<string, unknown> = {};
  const unset: string[] = [];
  if (body.title?.trim()) patch.title = body.title.trim();
  if (body.authorIds != null) {
    const resolved = resolveSongAuthors(authorRows, newAuthors, body.authorIds, mintKey);
    patch.author = resolved.author;
    patch.authors = resolved.authors;
  } else if (body.author != null) {
    patch.author = body.author.trim();
  }
  if (body.key != null) patch.key = body.key.trim();
  if (body.bpm != null) patch.bpm = body.bpm ? Number(body.bpm) : null;
  if (body.timeSig != null) patch.timeSig = body.timeSig.trim();
  if (body.lyrics != null) patch.body = textToBody(body.lyrics);
  if (body.chords != null) {
    const normalized = normalizeChordCharts(body.chords, mintKey);
    if (!normalized.ok) {
      // `normalized.error` is developer-shaped («chords[0] has a duplicate _key») and
      // the editor now shows what this route says, so it is summarised for the
      // person reading it. The precise text stays in the server log.
      return refuse(400, { error: SONG_ERROR.charts, detail: normalized.error });
    }
    patch.chords = normalized.charts;
  }
  if (body.referenceLinks != null) {
    const links = normalizeLinkRows(body.referenceLinks, {
      type: "referenceLink", labelField: "label", humanName: "Links de referencia", mintKey,
    });
    if (links.ok) patch.referenceLinks = links.rows;
  }
  if (body.musicalReferenceUrl != null) patch.musicalReferenceUrl = body.musicalReferenceUrl || undefined;
  if (body.lyricsVideoUrl != null) patch.lyricsVideoUrl = body.lyricsVideoUrl || undefined;
  if (body.tutorials != null) {
    const tutorials = normalizeLinkRows(body.tutorials, {
      type: "tutorial", labelField: "title", humanName: "Tutoriales", mintKey,
    });
    if (tutorials.ok) patch.tutorials2 = tutorials.rows;
  }
  if (body.tagIds != null) {
    patch.tags = body.tagIds.map((id) => ({ _type: "reference", _ref: id, _key: mintKey() }));
  }
  return { ok: true, set: patch, unset };
}

// ── The writers ──────────────────────────────────────────────────────────────

/** The chat's create: a deterministic id (a retry never duplicates) and the authors it creates. */
export interface CreateSongOptions {
  id: string;
  newAuthors: readonly NewAuthor[];
}

/** The chat's edit: the revision it checked, and the authors it creates. */
export interface PatchSongOptions {
  ifRevisionId: string;
  newAuthors: readonly NewAuthor[];
}

export interface SongWriteEffects {
  id: string;
  /** The song's revision after the write, when the write's answer carried it. */
  rev: string | null;
  /** The chat's create only: `false` when the id already existed (nothing was written). */
  created?: boolean;
}

function authorDoc(a: NewAuthor) {
  return { _id: a._id, _type: "author" as const, name: a.name, slug: { _type: "slug" as const, current: a.slug } };
}

async function readAuthors(ids: readonly string[]): Promise<AuthorRow[]> {
  return writeClient.fetch(`*[_type=="author" && _id in $ids]{ _id, name }`, { ids });
}

/** `results[].operation` of a transaction answer, read defensively: never decides wording alone. */
function operationOf(result: unknown, id: string): string | null {
  if (!result || typeof result !== "object") return null;
  const rows = (result as { results?: unknown }).results;
  if (!Array.isArray(rows)) return null;
  const row = rows.find((r) => r && typeof r === "object" && (r as { id?: unknown }).id === id) as { operation?: unknown } | undefined;
  return typeof row?.operation === "string" ? row.operation : null;
}

function transactionIdOf(result: unknown): string | null {
  const id = result && typeof result === "object" ? (result as { transactionId?: unknown }).transactionId : null;
  return typeof id === "string" && id ? id : null;
}

/** Create a song. Answers 201 with the created document (the route) or the id (the chat). */
export async function createSong(raw: unknown, opts?: CreateSongOptions): Promise<CommitOutcome<SongWriteEffects, 201>> {
  const body = fields(raw);
  const early = createEarlyRefusal(body);
  if (early) return early;

  const authorRows = body.authorIds != null ? await readAuthors(body.authorIds) : [];
  const built = buildSongCreate(raw, authorRows, opts?.newAuthors ?? [], new Date().toISOString());
  if (!built.ok) return built;

  if (!opts) {
    const doc = await writeClient.create(built.doc);
    revalidateSongViews();
    return { ok: true, status: 201, body: doc as unknown as Record<string, unknown>, effects: { id: doc._id, rev: doc._rev ?? null } };
  }

  let tx = writeClient.transaction();
  for (const a of opts.newAuthors) tx = tx.createIfNotExists(authorDoc(a));
  tx = tx.createIfNotExists({ ...built.doc, _id: opts.id });
  const result = await tx.commit();
  revalidateSongViews();
  const operation = operationOf(result, opts.id);
  return {
    ok: true,
    status: 201,
    body: { _id: opts.id },
    effects: { id: opts.id, rev: transactionIdOf(result), created: operation === "create" ? true : operation === "none" ? false : undefined },
  };
}

/** Edit a song: only the fields the request carries. */
export async function patchSong(id: string, raw: unknown, opts?: PatchSongOptions): Promise<CommitOutcome<SongWriteEffects>> {
  const body = fields(raw);
  const early = patchEarlyRefusal(body);
  if (early) return early;

  // Ownership/type guard: this is the song-content editor endpoint, so the
  // target MUST be a `post`. Without this, a manager (incl. content-editor)
  // could PATCH any doc by _id — overwriting a teamMembers / role /
  // setlistProposal doc's title/author/body/tags.
  const target = await writeClient.fetch<{ _type: string } | null>(`*[_id == $id][0]{ _type }`, { id });
  if (!target) return refuse(404, { error: SONG_ERROR.notFound });
  if (target._type !== "post") return refuse(400, { error: SONG_ERROR.notASong });

  const authorRows = body.authorIds != null ? await readAuthors(body.authorIds) : [];
  const built = buildSongPatch(raw, authorRows, opts?.newAuthors ?? []);
  if (!built.ok) return built;

  if (!opts) {
    let patch = writeClient.patch(id).set(built.set);
    if (built.unset.length) patch = patch.unset(built.unset);
    const doc = await patch.commit();
    revalidateSongViews();
    return { ok: true, status: 200, body: doc as unknown as Record<string, unknown>, effects: { id, rev: (doc as { _rev?: string })._rev ?? null } };
  }

  let tx = writeClient.transaction();
  for (const a of opts.newAuthors) tx = tx.createIfNotExists(authorDoc(a));
  const rev = opts.ifRevisionId;
  tx = tx.patch(id, (p) => {
    let q = p.ifRevisionId(rev).set(built.set);
    if (built.unset.length) q = q.unset(built.unset);
    return q;
  });
  let result: unknown;
  try {
    result = await tx.commit();
  } catch (err) {
    // Only a genuine Content Lake 409 is a lost race; anything else surfaces as itself.
    if (!sanityConflictKind(err)) throw err;
    return refuse(409, { error: SONG_ERROR.staleRevision });
  }
  revalidateSongViews();
  return { ok: true, status: 200, body: { _id: id }, effects: { id, rev: transactionIdOf(result) } };
}

/**
 * `POST /api/content/authors`: idempotent by slug — the existing author, or a new one (201). Only the
 * route calls it: the chat creates authors inside the song's own transaction (`newAuthors`).
 */
export async function ensureAuthors(raw: unknown): Promise<CommitOutcome<{ id: string | null }, 200 | 201>> {
  const { name } = (raw && typeof raw === "object" ? raw : {}) as { name?: string };
  if (!name?.trim()) return refuse(400, { error: "name required" });
  const slug = slugifyAuthor(name.trim());
  // Idempotent by slug: return the existing author instead of creating a
  // duplicate (or slug-colliding) doc that would fragment the taxonomy.
  const existing = await serverClient.fetch(`*[_type == "author" && slug.current == $slug][0]{ _id, name, slug }`, { slug });
  if (existing) return { ok: true, status: 200, body: existing, effects: { id: existing._id ?? null } };

  const author = await writeClient.create({ _type: "author", name: name.trim(), slug: { _type: "slug", current: slug } });
  return { ok: true, status: 201, body: author as unknown as Record<string, unknown>, effects: { id: author._id } };
}
