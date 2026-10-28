// The before/after a song check shows (admin parity phase 3, S3, Task 4). Pure.
//
// Built from the NORMALIZED write — the writer's own `buildSongPatch` / `buildSongCreate` run on the
// raw input — so the writer's side effects show: the legacy artist rebuilt from the authors, an empty
// chart dropped, an untouched link row re-trimmed. Nothing is promised that the writer would not write.

import { bodyToLyrics } from "@/app/utils/lyrics";
import type { NewAuthor } from "@/app/utils/songSaveCommit";
import type { NamedDoc, SongCatalog, StoredSong } from "@/app/utils/songEdits";

// ── Line diff ────────────────────────────────────────────────────────────────

type Op = { kind: "same" | "del" | "add"; line: string };

/** A line diff (LCS). Lyrics and charts are tens of lines, so O(n·m) is fine. */
export function lineDiff(before: string, after: string): Op[] {
  const a = before === "" ? [] : before.split("\n");
  const b = after === "" ? [] : after.split("\n");
  const n = a.length;
  const m = b.length;
  const lcs: number[][] = Array.from({ length: n + 1 }, () => new Array<number>(m + 1).fill(0));
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      lcs[i]![j] = a[i] === b[j] ? lcs[i + 1]![j + 1]! + 1 : Math.max(lcs[i + 1]![j]!, lcs[i]![j + 1]!);
    }
  }
  const ops: Op[] = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (a[i] === b[j]) {
      ops.push({ kind: "same", line: a[i]! });
      i++;
      j++;
    } else if (lcs[i + 1]![j]! >= lcs[i]![j + 1]!) {
      ops.push({ kind: "del", line: a[i++]! });
    } else {
      ops.push({ kind: "add", line: b[j++]! });
    }
  }
  while (i < n) ops.push({ kind: "del", line: a[i++]! });
  while (j < m) ops.push({ kind: "add", line: b[j++]! });
  return ops;
}

const shown = (line: string) => (line === "" ? "(línea vacía)" : line);

/** The changed lines with one line of context around each change; «…» between separate changes. */
export function diffHunks(before: string, after: string, context = 1): string[] {
  const ops = lineDiff(before, after);
  const keep = new Set<number>();
  ops.forEach((op, k) => {
    if (op.kind === "same") return;
    for (let d = -context; d <= context; d++) if (k + d >= 0 && k + d < ops.length) keep.add(k + d);
  });
  const out: string[] = [];
  let last = -1;
  for (let k = 0; k < ops.length; k++) {
    if (!keep.has(k)) continue;
    if (last >= 0 && k > last + 1) out.push("  …");
    const op = ops[k]!;
    out.push(`${op.kind === "same" ? "  " : op.kind === "del" ? "− " : "+ "}${shown(op.line)}`);
    last = k;
  }
  return out;
}

// ── An edit ──────────────────────────────────────────────────────────────────

const text = (v: unknown) => (typeof v === "string" ? v : v == null ? "" : String(v));
const orEmpty = (v: string) => (v === "" ? "(vacío)" : v);

function nameOf(id: string, catalog: readonly NamedDoc[], created: readonly NewAuthor[]): string {
  return catalog.find((d) => d._id === id)?.name ?? created.find((a) => a._id === id)?.name ?? "(sin nombre)";
}

export interface SongChangeInput {
  song: StoredSong;
  catalog: SongCatalog;
  /** The writer's `buildSongPatch` result for the edit's raw input. */
  set: Record<string, unknown>;
  unset: readonly string[];
  newAuthors: readonly NewAuthor[];
  /** The legacy artist string as stored (the writer rebuilds it from the authors). */
  storedArtist: string | null;
}

const SCALAR_LABEL: Record<string, string> = { title: "Título", key: "Tono", bpm: "BPM", timeSig: "Compás" };
const URL_LABEL: Record<string, string> = { musicalReferenceUrl: "Referencia musical", lyricsVideoUrl: "Video de letra" };

/** The before/after of ONLY what changes, in the person's words. Empty = nothing would change. */
export function songChangeLines(input: SongChangeInput): string[] {
  const { song, catalog, set, unset, newAuthors } = input;
  const lines: string[] = [];

  for (const field of ["title", "key", "bpm", "timeSig"] as const) {
    if (!(field in set)) continue;
    const before = text(song[field]);
    const after = text(set[field]);
    if (before !== after) lines.push(`${SCALAR_LABEL[field]}: ${orEmpty(before)} → ${orEmpty(after)}`);
  }
  for (const field of ["musicalReferenceUrl", "lyricsVideoUrl"] as const) {
    const before = text(song[field]);
    if (unset.includes(field)) {
      if (before) lines.push(`${URL_LABEL[field]}: ${before} → (se borra)`);
    } else if (field in set && text(set[field]) !== before) {
      lines.push(`${URL_LABEL[field]}: ${orEmpty(before)} → ${text(set[field])}`);
    }
  }

  if ("authors" in set) {
    const ids = (set.authors as { _ref: string }[]).map((r) => r._ref);
    const before = (song.authorRefs ?? []).filter((id): id is string => !!id);
    if (ids.join("|") !== before.join("|")) {
      const named = ids.map((id) => {
        const made = newAuthors.find((a) => a._id === id);
        return made ? `${made.name} (se crearía el artista)` : nameOf(id, catalog.authors, newAuthors);
      });
      lines.push(`Artistas: ${before.map((id) => nameOf(id, catalog.authors, newAuthors)).join(", ") || "(ninguno)"} → ${named.join(", ") || "(ninguno)"}`);
    }
    const artist = text(set.author);
    if (artist !== text(input.storedArtist)) lines.push(`Artista (texto): ${orEmpty(text(input.storedArtist))} → ${orEmpty(artist)}`);
  }

  if ("tags" in set) {
    const after = (set.tags as { _ref: string }[]).map((r) => r._ref);
    const before = (song.tagRefs ?? []).filter((id): id is string => !!id);
    const added = after.filter((id) => !before.includes(id)).map((id) => `+ ${nameOf(id, catalog.tags, [])}`);
    const removed = before.filter((id) => !after.includes(id)).map((id) => `− ${nameOf(id, catalog.tags, [])}`);
    if (added.length || removed.length) lines.push(`Etiquetas: ${[...added, ...removed].join(", ")}`);
  }

  const storedChartCount = (song.chords ?? []).filter((c) => (c?.content ?? "").trim()).length;
  if ("body" in set) {
    const before = bodyToLyrics((song.body ?? []) as never);
    const after = bodyToLyrics(set.body as never);
    if (after === "" && before !== "") lines.push("Letra: se borra completa.");
    else if (before !== after) lines.push("Letra:", ...diffHunks(before, after));
    const chartsAfter = "chords" in set ? (set.chords as unknown[]).length : storedChartCount;
    if (before !== after && chartsAfter > 0) {
      lines.push("Ojo: esta canción tiene acorde, así que los miembros no ven la letra mientras exista (ADR-0018).");
    }
  }

  if ("chords" in set) {
    const after = set.chords as { _key: string; key: string; content: string }[];
    const before = (song.chords ?? []).filter((c) => c && c._key);
    for (const chart of before) {
      const now = after.find((c) => c._key === chart._key);
      const label = `Acorde en ${chart.key || "sin tono"}`;
      if (!now) lines.push(`${label}: se elimina el acorde.`);
      else if (now.content !== (chart.content ?? "")) lines.push(`${label}:`, ...diffHunks(chart.content ?? "", now.content));
    }
    for (const chart of after.filter((c) => !before.some((b) => b._key === c._key))) {
      lines.push(`Acorde nuevo en ${chart.key}:`, ...chart.content.split("\n").map((l) => `+ ${shown(l)}`));
    }
    const hasLyrics = (song.body ?? []).length > 0;
    if (hasLyrics && storedChartCount === 0 && after.length > 0) {
      lines.push("Al agregar el acorde, los miembros dejan de ver la letra (ADR-0018).");
    }
    if (hasLyrics && storedChartCount > 0 && after.length === 0) {
      lines.push("Al quitar el último acorde, los miembros vuelven a ver la letra (ADR-0018).");
    }
  }

  const rowsDiff = (label: string, before: { l: string; u: string }[], after: { l: string; u: string }[]) => {
    const key = (r: { l: string; u: string }) => `${r.l}\u0000${r.u}`;
    const added = after.filter((r) => !before.some((b) => key(b) === key(r))).map((r) => `+ ${r.l} (${r.u})`);
    const removed = before.filter((r) => !after.some((a) => key(a) === key(r))).map((r) => `− ${r.l} (${r.u})`);
    if (added.length || removed.length) lines.push(`${label}: ${[...added, ...removed].join("; ")}`);
  };
  if ("referenceLinks" in set) {
    rowsDiff(
      "Links de referencia",
      (song.referenceLinks ?? []).map((r) => ({ l: text(r?.label), u: text(r?.url) })),
      (set.referenceLinks as { label: string; url: string }[]).map((r) => ({ l: r.label, u: r.url })),
    );
  }
  if ("tutorials2" in set) {
    rowsDiff(
      "Tutoriales",
      (song.tutorials2 ?? []).map((r) => ({ l: text(r?.title), u: text(r?.url) })),
      (set.tutorials2 as { title: string; url: string }[]).map((r) => ({ l: r.title, u: r.url })),
    );
  }

  return lines;
}
