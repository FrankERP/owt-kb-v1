// The additive admin setlist GET contract (A1 §4) plus the pure decision logic
// its only consumer needs. Kept free of `server-only` and of any Sanity client
// so the route (server) and `SetlistEditor` (client) share one definition of
// what a readable, editable setlist target is.
//
// Invariants held here:
//  - Every success branch preserves the pre-existing top-level `setlistId`,
//    `songs` and `recentSongs` fields, so nothing consuming them breaks.
//  - A conflict branch (duplicate / draft_conflict / invalid) returns
//    `setlistId: null` and `songs: []` — never an arbitrary pick from an
//    ambiguous group, and never a silently empty editable setlist.
//  - Malformed content is `invalid`, never ordinary `incomplete`.

import {
  canonicalGroupState,
  publicTargetState,
  setlistContentState,
  type SetlistContentState,
} from "./serviceReadModel";

function isObj(v: unknown): v is Record<string, unknown> {
  return !!v && typeof v === "object";
}

function nonEmptyString(v: unknown): v is string {
  return typeof v === "string" && v.length > 0;
}

// ── Response contract ───────────────────────────────────────────────────────

export type SetlistReadBase = {
  /** Preserved additive field: the canonical target's document id, when unambiguous. */
  setlistId: string | null;
  /** Preserved additive field: the editor-shaped song rows. */
  songs: unknown[];
  /** Preserved additive field: songId → most recent past use (repeat-song warnings). */
  recentSongs: Record<string, string>;
};

export type SetlistRead = SetlistReadBase &
  (
    | {
        targetState: "none";
        observed: { state: "none" };
        songs: [];
        setlistId: null;
      }
    | {
        targetState: "single";
        contentState: SetlistContentState;
        observed: { state: "single"; id: string; rev: string };
        songs: unknown[];
        setlistId: string;
      }
    | {
        targetState: "duplicate";
        conflictingIds: string[];
        draftIds: string[];
        setlistId: null;
        songs: [];
      }
    | {
        targetState: "draft_conflict";
        draftIds: string[];
        canonicalIds: string[];
        setlistId: null;
        songs: [];
      }
    | {
        targetState: "invalid";
        reason: string;
        recordIds: string[];
        setlistId: null;
        songs: [];
      }
  );

/** One canonical document observed at a setlist target (a weekend setlist doc, or a special role). */
export interface CanonicalSetlistRecord {
  id: string;
  rev: string;
  /** Editor-projected `songs` array; `[]` when the stored field is absent. */
  songs: unknown;
}

export const MALFORMED_RECORD_REASON = "malformed_canonical_record";

/**
 * Content state of an editor-projected `songs` array. Each row carries the
 * stored `_key` / `songRef` plus the dereferenced `song`; a `songRef` whose
 * `song` did not resolve is a dangling reference and therefore `invalid`.
 */
export function contentStateFromProjectedSongs(songs: unknown): SetlistContentState {
  if (!Array.isArray(songs)) return "invalid";
  const resolved = new Set<string>();
  const shaped = songs.map((raw) => {
    const row = isObj(raw) ? raw : {};
    const ref = nonEmptyString(row.songRef) ? row.songRef : null;
    const doc = isObj(row.song) ? row.song : null;
    if (ref && doc && nonEmptyString(doc._id)) resolved.add(ref);
    return {
      _key: row._key,
      play_key: row.play_key,
      ...(ref ? { song: { _ref: ref } } : {}),
    };
  });
  return setlistContentState(shaped, (id) => resolved.has(id));
}

/**
 * Assemble the additive response from an already-fetched canonical group and its
 * raw-draft evidence. Fail-closed: any ambiguity, overlay, or malformed identity
 * collapses to a non-editable branch with `setlistId: null` and `songs: []`.
 */
export function buildSetlistRead(
  records: CanonicalSetlistRecord[],
  draftIds: string[],
  recentSongs: Record<string, string>,
): SetlistRead {
  const ids = records.map((r) => r.id || "(unknown)");
  const malformed = records.some((r) => !nonEmptyString(r.id) || !nonEmptyString(r.rev));
  const canonicalState = malformed ? "invalid" : canonicalGroupState(records.length);
  const state = publicTargetState(canonicalState, draftIds);

  if (state === "draft_conflict") {
    return {
      targetState: "draft_conflict",
      draftIds,
      canonicalIds: ids,
      setlistId: null,
      songs: [],
      recentSongs,
    };
  }
  if (state === "invalid") {
    return {
      targetState: "invalid",
      reason: MALFORMED_RECORD_REASON,
      recordIds: ids,
      setlistId: null,
      songs: [],
      recentSongs,
    };
  }
  if (state === "duplicate") {
    return {
      targetState: "duplicate",
      conflictingIds: ids,
      draftIds,
      setlistId: null,
      songs: [],
      recentSongs,
    };
  }
  if (state === "none") {
    return {
      targetState: "none",
      observed: { state: "none" },
      setlistId: null,
      songs: [],
      recentSongs,
    };
  }

  const record = records[0];
  return {
    targetState: "single",
    contentState: contentStateFromProjectedSongs(record.songs),
    observed: { state: "single", id: record.id, rev: record.rev },
    setlistId: record.id,
    songs: Array.isArray(record.songs) ? record.songs : [],
    recentSongs,
  };
}

// ── Consumer decision logic ─────────────────────────────────────────────────

export type SetlistReadIssue =
  | "duplicate"
  | "draft_conflict"
  | "invalid_target"
  | "invalid_content"
  | "malformed";

export type SetlistReadDecision =
  | { editable: true; read: SetlistRead }
  | { editable: false; issue: SetlistReadIssue };

const EDITABLE_CONTENT: SetlistContentState[] = ["empty", "incomplete", "ready"];

/**
 * Fail-closed gate for the setlist editor: only a canonical `none` target or a
 * singleton with `empty | incomplete | ready` content opens editable state.
 * Duplicate, draft conflict, invalid target/content and any structurally
 * unexpected payload stay non-editable — a failure is never rendered as an
 * ordinary empty setlist the admin could overwrite.
 */
export function canEditSetlistResponse(body: unknown): SetlistReadDecision {
  if (!isObj(body)) return { editable: false, issue: "malformed" };
  if (!Array.isArray(body.songs)) return { editable: false, issue: "malformed" };
  if (!isObj(body.recentSongs) || Array.isArray(body.recentSongs)) {
    return { editable: false, issue: "malformed" };
  }
  if (!("setlistId" in body)) return { editable: false, issue: "malformed" };
  const setlistId = body.setlistId;
  if (setlistId !== null && !nonEmptyString(setlistId)) {
    return { editable: false, issue: "malformed" };
  }

  switch (body.targetState) {
    case "none": {
      const observed = body.observed;
      if (!isObj(observed) || observed.state !== "none") {
        return { editable: false, issue: "malformed" };
      }
      if (setlistId !== null || body.songs.length > 0) {
        return { editable: false, issue: "malformed" };
      }
      return { editable: true, read: body as unknown as SetlistRead };
    }
    case "single": {
      const observed = body.observed;
      if (
        !isObj(observed) ||
        observed.state !== "single" ||
        !nonEmptyString(observed.id) ||
        !nonEmptyString(observed.rev) ||
        !nonEmptyString(setlistId)
      ) {
        return { editable: false, issue: "malformed" };
      }
      const contentState = body.contentState;
      if (contentState === "invalid") return { editable: false, issue: "invalid_content" };
      if (!EDITABLE_CONTENT.includes(contentState as SetlistContentState)) {
        return { editable: false, issue: "malformed" };
      }
      return { editable: true, read: body as unknown as SetlistRead };
    }
    case "duplicate":
      return { editable: false, issue: "duplicate" };
    case "draft_conflict":
      return { editable: false, issue: "draft_conflict" };
    case "invalid":
      return { editable: false, issue: "invalid_target" };
    default:
      return { editable: false, issue: "malformed" };
  }
}

/** Spanish, admin-facing copy for each non-editable outcome. */
export const SETLIST_READ_ISSUE_COPY: Record<SetlistReadIssue | "http", string> = {
  duplicate:
    "Este servicio tiene más de un setlist guardado. No se puede editar hasta resolver el duplicado en Studio.",
  draft_conflict:
    "Hay un borrador sin publicar de este setlist. Publícalo o descártalo en Studio antes de editar.",
  invalid_target:
    "El setlist de este servicio tiene datos inconsistentes. Revísalo en Studio antes de editar.",
  invalid_content:
    "El setlist guardado tiene canciones inválidas. Revísalo en Studio antes de editar.",
  malformed: "Respuesta inválida del servidor. Intenta de nuevo.",
  http: "No se pudo cargar el setlist. Intenta de nuevo.",
};
