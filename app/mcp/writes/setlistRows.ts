// app/mcp/writes/setlistRows.ts — `edit_setlist`'s row translation (P3 step
// 11). PURE and NEUTRAL: no client, no `server-only`, no I/O.
//
// It turns the tool's `rows` (stored rows named by their `_key`, new rows by a
// song id) into the `songs` of the setlist writer's own body, producing what
// `/admin`'s setlist editor would send for the same intent. The editor is a
// FULL-REPLACEMENT round trip (§ «Admin surface gates», E6): it loads every
// row's `play_key`, `medley_tag` and leaders and sends them all back, so an
// attribute the caller does not mention is KEPT, never cleared.
//
//   - A kept row (`rowKey`) starts from its stored `play_key`, `medley_tag` and
//     leaders (`songItemLeadIds`). An absent attribute is kept; an explicit
//     `null` clears `key` / `medleyTag`; `leads: []` clears the leaders.
//   - A new row (`songId`) starts empty.
//   - A stored row not listed is removed. A `rowKey` listed twice, or one the
//     stored setlist does not have, is refused and never guessed.
//
// DUPLICATE SONGS (E3, D14/Q7). A new row naming the song of any other
// resulting row is refused — the editor's «Ya está». Two KEPT rows that already
// name one song (a Studio duplicate) stay two rows: the editor loads such a
// setlist and saves it back as it is.
//
// MEDLEY (E5, D7). `normalizeMedleyTags` runs only on the editor's own trigger
// set — a stored row removed, the relative order of kept rows changed, a new row
// anywhere but the tail — or when any row sets `medleyTag` explicitly (`null`
// included). Otherwise the stored tags are carried byte-identical. After it,
// only adjacent runs of two or more carry a tag. An explicit link that
// normalization erases (a row that sent a non-null tag and comes out untagged)
// refuses the whole edit (`medley_not_adjacent`): an instruction is never
// dropped (I13). A stored tag orphaned by a removal or a reorder is untagged,
// exactly as the editor untags it.
//
// The fresh tags come from the CALLER's factory. The tool passes a local
// counter, never `nextKey`: the writer mints the rows' `_key`s from `nextKey`,
// and a tag drawn from the same sequence would shift every `_key` it writes.
//
// LEADERS (F6, I13). On a worship night every row carries `leadIds`: the stored
// leaders, or the explicit `leads`. On any other service a row carries
// `leadIds` only when it gives an explicit, NON-EMPTY `leads`, so the writer's
// own `validateSongLeads` refuses the whole request; `leads: []` there is a
// no-op, since the editor stores no leaders on such a service either.
//
// PLAY KEY (E-key, F11). The writer stores a `play_key` longer than 24
// normalized characters as BLANK, silently. So a kept row whose stored key is
// that long (only Studio writes one) is refused unless the row sends `key`, and
// the writer's own `parseSongRows` is run over the built rows: a key that is
// non-blank after trimming and comes back blank is refused. A body the parser
// rejects outright is left to the writer, which refuses it with the route's
// code.

import { normalizeMedleyTags } from "@/app/utils/medley";
import { songItemLeadIds } from "@/app/utils/songLeads";
import { parseSongRows } from "@/app/utils/setlistWriteRequest";

// ── Shapes ──────────────────────────────────────────────────────────────────

/** A stored row, named by its `_key`. */
export interface KeptRowInput {
  rowKey: string;
  key?: string | null;
  medleyTag?: string | null;
  leads?: string[];
}

/** A new row, named by its song. */
export interface NewRowInput {
  songId: string;
  key?: string;
  medleyTag?: string;
  leads?: string[];
}

export type SetlistRowInput = KeptRowInput | NewRowInput;

/** One row of the writer's body (`parseSetlistWriteRequest`'s `songs[i]`). */
export interface SetlistBodyRow {
  songId: string;
  /** Always a string; `""` when the row has no key (the writer stores none). */
  play_key: string;
  /** Present only when the row is in a medley. */
  medley_tag?: string;
  /** Present only under the leaders rule above. */
  leadIds?: string[];
}

export type SetlistRowRefusalDetail =
  | "unknown_row_key"
  | "duplicate_row_key"
  | "duplicate_song"
  | "stored_key_too_long"
  | "key_too_long"
  | "medley_not_adjacent";

export interface SetlistRowRefusal {
  detail: SetlistRowRefusalDetail;
  /** 1-based position of the offending row in `rows`. */
  position: number;
  /** The row's stored key, for a kept row. */
  rowKey?: string;
  /** The row's song, when it is known. */
  songId?: string;
}

export type SetlistRowsResult =
  | {
      ok: true;
      songs: SetlistBodyRow[];
      /** Whether `normalizeMedleyTags` ran (false: stored tags carried byte-identical). */
      normalized: boolean;
    }
  | { ok: false; refusal: SetlistRowRefusal };

export interface SetlistRowsInput {
  /** The stored rows, exactly as the writer's own target loader returned them (`record?.songs ?? []`). */
  stored: readonly unknown[];
  rows: readonly SetlistRowInput[];
  worshipNight: boolean;
  /** A fresh medley tag per call. Never `nextKey` (see the header). */
  newTag: () => string;
}

// ── Helpers ─────────────────────────────────────────────────────────────────

function isObj(v: unknown): v is Record<string, unknown> {
  return !!v && typeof v === "object" && !Array.isArray(v);
}

function nonEmptyString(v: unknown): v is string {
  return typeof v === "string" && v.length > 0;
}

export function isKeptRow(row: SetlistRowInput): row is KeptRowInput {
  return "rowKey" in row;
}

/**
 * Whether the writer would store `value` as a blank key: non-blank after
 * trimming, yet `parseSongRows` normalizes it to `""` (it is longer than 24
 * characters once NFC-normalized and whitespace-collapsed). Null when the
 * parser refuses the row outright — the writer then refuses it itself.
 */
function writerBlanksKey(songId: string, value: string): boolean | null {
  if (!value.trim()) return false;
  const parsed = parseSongRows([{ songId, play_key: value }]);
  if (!parsed.ok) return null;
  return parsed.value[0]?.playKey === "";
}

/** A row while it is being built. `medley_tag` is `undefined` for no tag (the `normalizeMedleyTags` shape). */
interface WorkingRow {
  kept: boolean;
  /** Index of the stored row, for a kept row. */
  storedIndex: number;
  rowKey?: string;
  songId: string;
  playKey: string | null;
  medley_tag?: string;
  leadIds: string[];
  /** The caller named a medley tag (a string): it must survive normalization. */
  explicitLink: boolean;
  /** The caller named `medleyTag` at all (`null` included). */
  explicitTag: boolean;
  /** The caller named `key` at all. */
  explicitKey: boolean;
  /** The caller named `leads`. */
  explicitLeads: boolean;
}

// ── The translation ─────────────────────────────────────────────────────────

/**
 * The writer's `songs` for the requested rows. Pure: the same input always
 * gives the same output (given the same `newTag` sequence).
 */
export function buildSetlistBodyRows(input: SetlistRowsInput): SetlistRowsResult {
  const { stored, rows, worshipNight, newTag } = input;

  const storedIndexByKey = new Map<string, number>();
  stored.forEach((item, index) => {
    if (isObj(item) && nonEmptyString(item._key) && !storedIndexByKey.has(item._key)) {
      storedIndexByKey.set(item._key, index);
    }
  });

  // ── Resolve every row (kept rows from their stored attributes) ──────────
  const seenKeys = new Set<string>();
  const working: WorkingRow[] = [];
  for (const [index, row] of rows.entries()) {
    const position = index + 1;
    if (isKeptRow(row)) {
      if (seenKeys.has(row.rowKey)) {
        return { ok: false, refusal: { detail: "duplicate_row_key", position, rowKey: row.rowKey } };
      }
      seenKeys.add(row.rowKey);
      const storedIndex = storedIndexByKey.get(row.rowKey);
      if (storedIndex === undefined) {
        return { ok: false, refusal: { detail: "unknown_row_key", position, rowKey: row.rowKey } };
      }
      const item = stored[storedIndex] as Record<string, unknown>;
      const song = isObj(item.song) ? item.song : {};
      const storedTag = nonEmptyString(item.medley_tag) ? item.medley_tag : undefined;
      working.push({
        kept: true,
        storedIndex,
        rowKey: row.rowKey,
        songId: typeof song._ref === "string" ? song._ref : "",
        playKey:
          row.key !== undefined ? row.key : typeof item.play_key === "string" ? item.play_key : null,
        medley_tag: row.medleyTag !== undefined ? (row.medleyTag ?? undefined) : storedTag,
        leadIds: row.leads !== undefined ? [...row.leads] : songItemLeadIds(item),
        explicitLink: typeof row.medleyTag === "string",
        explicitTag: row.medleyTag !== undefined,
        explicitKey: row.key !== undefined,
        explicitLeads: row.leads !== undefined,
      });
    } else {
      working.push({
        kept: false,
        storedIndex: -1,
        songId: row.songId,
        playKey: row.key ?? null,
        medley_tag: row.medleyTag,
        leadIds: row.leads ? [...row.leads] : [],
        explicitLink: typeof row.medleyTag === "string",
        explicitTag: row.medleyTag !== undefined,
        explicitKey: row.key !== undefined,
        explicitLeads: row.leads !== undefined,
      });
    }
  }

  // ── E3: a new row may not repeat any other resulting row's song ──────────
  const songCount = new Map<string, number>();
  for (const row of working) songCount.set(row.songId, (songCount.get(row.songId) ?? 0) + 1);
  for (const [index, row] of working.entries()) {
    if (!row.kept && (songCount.get(row.songId) ?? 0) > 1) {
      return { ok: false, refusal: { detail: "duplicate_song", position: index + 1, songId: row.songId } };
    }
  }

  // ── E-key: a carried key the writer would blank ──────────────────────────
  for (const [index, row] of working.entries()) {
    if (!row.kept || row.explicitKey || row.playKey === null) continue;
    if (writerBlanksKey(row.songId, row.playKey) === true) {
      return {
        ok: false,
        refusal: { detail: "stored_key_too_long", position: index + 1, rowKey: row.rowKey, songId: row.songId },
      };
    }
  }

  // ── Medley (the editor's trigger set, plus an explicit tag) ──────────────
  const keptOrder = working.filter((row) => row.kept).map((row) => row.storedIndex);
  const removed = keptOrder.length < stored.length;
  const reordered = keptOrder.some((storedIndex, i) => i > 0 && storedIndex < keptOrder[i - 1]!);
  const lastKept = working.map((row) => row.kept).lastIndexOf(true);
  const nonTailInsert = working.some((row, i) => !row.kept && i < lastKept);
  const explicit = working.some((row) => row.explicitTag);
  const normalized = removed || reordered || nonTailInsert || explicit;

  const tagged: WorkingRow[] = normalized ? normalizeMedleyTags(working, newTag) : working;
  if (normalized) {
    for (const [index, row] of tagged.entries()) {
      if (row.explicitLink && !row.medley_tag) {
        return {
          ok: false,
          refusal: {
            detail: "medley_not_adjacent",
            position: index + 1,
            songId: row.songId,
            ...(row.rowKey ? { rowKey: row.rowKey } : {}),
          },
        };
      }
    }
  }

  // ── The writer's rows ────────────────────────────────────────────────────
  const songs: SetlistBodyRow[] = tagged.map((row) => {
    const carryLeads = worshipNight || (row.explicitLeads && row.leadIds.length > 0);
    return {
      songId: row.songId,
      play_key: row.playKey ?? "",
      ...(row.medley_tag ? { medley_tag: row.medley_tag } : {}),
      ...(carryLeads ? { leadIds: [...row.leadIds] } : {}),
    };
  });

  // ── E-key: never send a key the writer would store blank ────────────────
  const parsed = parseSongRows(songs);
  if (parsed.ok) {
    for (const [index, row] of songs.entries()) {
      if (row.play_key.trim() && parsed.value[index]?.playKey === "") {
        const source = tagged[index]!;
        return {
          ok: false,
          refusal: {
            detail: "key_too_long",
            position: index + 1,
            songId: row.songId,
            ...(source.rowKey ? { rowKey: source.rowKey } : {}),
          },
        };
      }
    }
  }

  return { ok: true, songs, normalized };
}
