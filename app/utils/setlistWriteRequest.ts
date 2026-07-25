// Request validation and stored shapes for the protected live-setlist writer
// (Service Readiness A2 §5). Pure: no Sanity client, no I/O, no framework types,
// so every prevalidation and staleness rule is exhaustively unit-testable.
//
// The observed-target contract and the song-row normalization below are shared
// with the proposal writer (§6): a proposal is a proposed setlist, so both carry
// the same client-observed singleton and the same song rows.
//
// Invariants held here:
//  - `saturdarSongs` is the deliberate stored typo for the Saturday setlist and
//    is never "corrected"; Sunday is `featuredSongs`.
//  - A deterministic id (`<setlistType>.<week>`) is the create mutex for an
//    observed-`none` weekend target: two writers that both saw "no setlist" race
//    on ONE id, and the loser is told (409) rather than silently overwriting.
//  - Every array-of-object item carries its own `_key`.

import { isValidServiceDate } from "./serviceReadModel";
import {
  isCanonicalDocumentId,
  isRevisionString,
  type KeyFactory,
  type ParseResult,
} from "./roleWriteRequest";

function isObj(v: unknown): v is Record<string, unknown> {
  return !!v && typeof v === "object";
}

function nonEmptyString(v: unknown): v is string {
  return typeof v === "string" && v.length > 0;
}

function fail(issues: string[]): { ok: false; issues: string[] } {
  return { ok: false, issues };
}

// ── Service kinds and setlist targets ───────────────────────────────────────

export const SETLIST_SERVICE_KINDS = ["sunday", "saturday", "special"] as const;
export type SetlistServiceKind = (typeof SETLIST_SERVICE_KINDS)[number];

export const WEEKEND_SETLIST_TYPES = ["featuredSongs", "saturdarSongs"] as const;
export type WeekendSetlistType = (typeof WEEKEND_SETLIST_TYPES)[number];

/**
 * Weekend setlist document type for a service kind. Sunday is `featuredSongs`;
 * Saturday is `saturdarSongs` — a deliberate stored typo that must never be
 * renamed. A special service stores its songs on the role document itself, so it
 * has no separate setlist type.
 */
export function setlistTypeForKind(kind: unknown): WeekendSetlistType | null {
  if (kind === "sunday") return "featuredSongs";
  if (kind === "saturday") return "saturdarSongs";
  return null;
}

/**
 * The ONE id an observed-`none` weekend save may create. Deterministic, so it is
 * itself the mutex: a concurrent creation makes the second `create` fail with
 * `documentAlreadyExistsError` instead of producing a duplicate target.
 */
export function deterministicSetlistId(setlistType: unknown, week: unknown): string | null {
  if (!(WEEKEND_SETLIST_TYPES as readonly unknown[]).includes(setlistType)) return null;
  if (!isValidServiceDate(week)) return null;
  return `${setlistType as string}.${week as string}`;
}

// ── Observed-target contract (shared with §6) ───────────────────────────────

/**
 * The state a client observed for a singleton write target, exactly as A1's read
 * contract reported it. `none` carries no identity at all — that is the whole
 * point: a writer may then ONLY create deterministically.
 */
export type ObservedTarget = { state: "none" } | { state: "single"; id: string; rev: string };

/** The same shape, resolved from canonical storage at write time. */
export type ServerTarget = ObservedTarget;

/**
 * Parse a client-observed target. A `none` that smuggles an id/revision, a
 * `single` without a canonical id and revision, and any other shape are rejected
 * before a single read — a writer must never guess which document was observed.
 */
export function parseObservedTarget(
  value: unknown,
  field = "observed",
): ParseResult<ObservedTarget> {
  if (!isObj(value)) return fail([field]);
  if (value.state === "none") {
    if (value.id != null || value.rev != null) return fail([`${field}.state`]);
    return { ok: true, value: { state: "none" } };
  }
  if (value.state === "single") {
    if (!isCanonicalDocumentId(value.id)) return fail([`${field}.id`]);
    if (!isRevisionString(value.rev)) return fail([`${field}.rev`]);
    return { ok: true, value: { state: "single", id: value.id, rev: value.rev } };
  }
  return fail([`${field}.state`]);
}

export type ObservedMismatch =
  /** Observed `none`, but a canonical target exists now: someone created it first. */
  | "concurrent_creation"
  /** Observed a singleton that no longer exists. */
  | "target_vanished"
  /** Observed a DIFFERENT document than the canonical singleton. */
  | "identity_mismatch"
  /** Same document, moved revision. */
  | "revision_mismatch";

/**
 * Compare a client-observed target with the canonically resolved one. Returns
 * null only when the client's view is exactly current; every mismatch is a `409`
 * (reload), never a merge and never a blind overwrite.
 */
export function compareObservedTarget(
  observed: ObservedTarget,
  server: ServerTarget,
): ObservedMismatch | null {
  if (observed.state === "none") {
    return server.state === "none" ? null : "concurrent_creation";
  }
  if (server.state === "none") return "target_vanished";
  if (server.id !== observed.id) return "identity_mismatch";
  if (server.rev !== observed.rev) return "revision_mismatch";
  return null;
}

// ── Song rows (shared with §6) ──────────────────────────────────────────────

export const SETLIST_SONGS_MAX = 60;

/** One requested song row, normalized. `playKey` may legitimately be blank. */
export interface NormalizedSongRow {
  songId: string;
  playKey: string;
  medleyTag: string | null;
}

function normalizeShortText(value: unknown, max: number): string | null {
  if (typeof value !== "string") return null;
  const out = value.normalize("NFC").trim().replace(/\s+/g, " ");
  if (!out.length || out.length > max) return null;
  return out;
}

/**
 * Parse the requested song list. A missing/non-array `songs`, an oversized list,
 * a malformed row, or a non-canonical song id is rejected before any write — an
 * unusable row is never silently dropped from a setlist the team then plays.
 */
export function parseSongRows(value: unknown): ParseResult<NormalizedSongRow[]> {
  if (!Array.isArray(value)) return fail(["songs"]);
  if (value.length > SETLIST_SONGS_MAX) return fail(["songs_length"]);
  const out: NormalizedSongRow[] = [];
  for (const [index, raw] of value.entries()) {
    if (!isObj(raw)) return fail([`songs[${index}]`]);
    if (!isCanonicalDocumentId(raw.songId)) return fail([`songs[${index}].songId`]);
    if (raw.play_key != null && typeof raw.play_key !== "string") {
      return fail([`songs[${index}].play_key`]);
    }
    const playKey = normalizeShortText(raw.play_key, 24) ?? "";
    if (raw.medley_tag != null && typeof raw.medley_tag !== "string") {
      return fail([`songs[${index}].medley_tag`]);
    }
    const medleyTag = raw.medley_tag == null ? null : normalizeShortText(raw.medley_tag, 64);
    if (raw.medley_tag != null && !medleyTag) return fail([`songs[${index}].medley_tag`]);
    out.push({ songId: raw.songId, playKey, medleyTag });
  }
  return { ok: true, value: out };
}

function songDocs(
  rows: readonly NormalizedSongRow[],
  itemType: "setlist_song" | "proposal_song",
  nextKey: KeyFactory,
): Record<string, unknown>[] {
  return rows.map((row) => ({
    _type: itemType,
    _key: nextKey(),
    ...(row.playKey ? { play_key: row.playKey } : {}),
    ...(row.medleyTag ? { medley_tag: row.medleyTag } : {}),
    song: { _type: "reference", _ref: row.songId },
  }));
}

/** Stored `setlist_song` items, each with its own `_key`, in request order. */
export function buildSetlistSongDocs(
  rows: readonly NormalizedSongRow[],
  nextKey: KeyFactory,
): Record<string, unknown>[] {
  return songDocs(rows, "setlist_song", nextKey);
}

/** Stored `proposal_song` items, each with its own `_key`, in request order. */
export function buildProposalSongDocs(
  rows: readonly NormalizedSongRow[],
  nextKey: KeyFactory,
): Record<string, unknown>[] {
  return songDocs(rows, "proposal_song", nextKey);
}

/**
 * The complete weekend setlist document a deterministic create commits. `_type`
 * appears ONLY here (a create), never in a patch payload — it is immutable per
 * document id.
 */
export function buildWeekendSetlistDocument(input: {
  setlistType: WeekendSetlistType;
  week: string;
  songs: Record<string, unknown>[];
  teamNotes?: string | null;
}): ({ _id: string; _type: WeekendSetlistType } & Record<string, unknown>) | null {
  const id = deterministicSetlistId(input.setlistType, input.week);
  if (!id) return null;
  const extra: Record<string, unknown> =
    input.teamNotes == null ? {} : { team_notes: input.teamNotes };
  return {
    _id: id,
    _type: input.setlistType,
    week: input.week,
    songs: input.songs,
    ...extra,
  };
}

// ── PUT request ────────────────────────────────────────────────────────────

export interface ParsedSetlistWriteRequest {
  kind: SetlistServiceKind;
  week: string;
  /** Required for a special service (the role document IS the setlist target). */
  roleId: string | null;
  /** Weekend setlist document type; null for a special service. */
  setlistType: WeekendSetlistType | null;
  observed: ObservedTarget;
  songs: NormalizedSongRow[];
}

/**
 * Parse the exact §5 PUT contract:
 * `{ week, type, roleId?, observed, songs: [{ songId, play_key?, medley_tag? }] }`
 *
 * The unchanged `observed` state from A1's GET is REQUIRED: a save that cannot
 * say what it was editing is rejected before any read, so a blind overwrite is
 * not expressible.
 */
export function parseSetlistWriteRequest(body: unknown): ParseResult<ParsedSetlistWriteRequest> {
  if (!isObj(body)) return fail(["payload"]);
  if (!(SETLIST_SERVICE_KINDS as readonly unknown[]).includes(body.type)) return fail(["type"]);
  const kind = body.type as SetlistServiceKind;
  if (!isValidServiceDate(body.week)) return fail(["week"]);
  const week = body.week;

  const special = kind === "special";
  if (special && !isCanonicalDocumentId(body.roleId)) return fail(["roleId"]);
  if (!special && body.roleId != null && !isCanonicalDocumentId(body.roleId)) {
    return fail(["roleId"]);
  }

  const observed = parseObservedTarget(body.observed);
  if (!observed.ok) return observed;
  const songs = parseSongRows(body.songs);
  if (!songs.ok) return songs;

  return {
    ok: true,
    value: {
      kind,
      week,
      roleId: nonEmptyString(body.roleId) ? body.roleId : null,
      setlistType: setlistTypeForKind(kind),
      observed: observed.value,
      songs: songs.value,
    },
  };
}
