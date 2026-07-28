// Pure helpers for the notification outbox (spec §1). No I/O: the callers own
// the Sanity client and may only act on values produced here. Exception: the
// timing constants below read `process.env` once at import, so `buildUpsert`'s
// default output depends on ambient config, not solely on its arguments — use
// its third argument to pin an exact window in tests.

import { createHash } from "node:crypto";
import { buildRuns } from "./medley";

export const NOTICE_KINDS = ["role", "setlist", "leadNotes"] as const;
export type NoticeKind = (typeof NOTICE_KINDS)[number];

export interface OutboxSongRow {
  _key: string;
  ref: string;
  key: string;
  /** Index of the contiguous medley run, or null for a standalone song. */
  group: number | null;
}

/**
 * Deterministic AND length-bounded. `${memberId}__${roleId}` composes two ids
 * that `isCanonicalDocumentId` allows at 200 chars each, which would overflow
 * Sanity's id ceiling — so the subject is digested (truncated `base64url`
 * `sha256`) to keep the id deterministic while bounding its length, following
 * this repo's existing precedent of digesting composed ids (e.g.
 * `receiptIdForRequestId`, which digests a different shape in full hex).
 */
export function outboxId(kind: NoticeKind, subjectKey: string): string {
  const digest = createHash("sha256").update(`${kind}:${subjectKey}`).digest("base64url").slice(0, 32);
  return `outbox.${kind.toLowerCase()}.${digest}`;
}

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object";

/**
 * Snapshot a stored `songs` array as ordered rows carrying the medley
 * PARTITION, never the tag values: `normalizeMedleyTags` mints a fresh tag for
 * every group on every editor write, so tag equality would report a change
 * whenever any unrelated song was touched. A one-song run normalizes to `null`
 * so the comparison agrees with the renderer, which draws it as a plain single.
 */
export function songRowsFrom(songs: unknown): OutboxSongRow[] {
  if (!Array.isArray(songs)) return [];
  const items = songs
    .filter(isObj)
    .map((s) => ({
      ref: isObj(s.song) && typeof s.song._ref === "string" ? s.song._ref : "",
      key: typeof s.play_key === "string" ? s.play_key : "",
      medley_tag: typeof s.medley_tag === "string" ? s.medley_tag : undefined,
    }))
    .filter((s) => s.ref);

  const rows: OutboxSongRow[] = [];
  let groupIndex = 0;
  for (const run of buildRuns(items)) {
    if (run.kind === "medley" && run.songs.length >= 2) {
      const g = groupIndex++;
      for (const { song } of run.songs) {
        rows.push({ _key: `s${rows.length}`, ref: song.ref, key: song.key, group: g });
      }
    } else {
      const song = run.kind === "single" ? run.song : run.songs[0].song;
      rows.push({ _key: `s${rows.length}`, ref: song.ref, key: song.key, group: null });
    }
  }
  return rows;
}

export interface UpsertInput {
  kind: NoticeKind;
  subjectKey: string;
  memberId: string | null;
  roleId: string | null;
  proposalId: string | null;
  serviceDate: string;
  roleType: "sunday_role" | "saturday_role" | "special_role" | null;
  before: { beforeRoles?: string[]; beforeSongs?: OutboxSongRow[]; beforeNotes?: string };
  knownRecipients: string[];
}

/**
 * Parses an env var as a positive number of minutes, falling back to
 * `fallbackMinutes` when the value is absent, empty, non-numeric, zero, or
 * negative. `??` alone doesn't catch `""` (an env var present but blank),
 * which would otherwise coerce to `Number("") === 0` and silently zero out a
 * timing window; a non-numeric value would coerce to `NaN` and propagate into
 * `new Date(...).toISOString()`, throwing at the first call site.
 */
export function parseMinutesEnv(raw: string | undefined, fallbackMinutes: number): number {
  if (raw === undefined || raw === "") return fallbackMinutes;
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0) return fallbackMinutes;
  return n;
}

export const DEBOUNCE_MS = parseMinutesEnv(process.env.NOTIFY_DEBOUNCE_MINUTES, 15) * 60_000;
export const MAX_WINDOW_MS = parseMinutesEnv(process.env.NOTIFY_MAX_WINDOW_MINUTES, 60) * 60_000;
export const CLAIM_TTL_MS = parseMinutesEnv(process.env.NOTIFY_CLAIM_TTL_MINUTES, 5) * 60_000;

export interface UpsertWindowOverrides {
  debounceMs?: number;
  maxWindowMs?: number;
}

/**
 * `createIfNotExists` writes the identity, the snapshot and the CEILING once —
 * they survive a whole burst of edits. The patch slides only `notifyAfter` and
 * re-pends. `deadline` is deliberately absent from the patch: writing it twice
 * would either kill the starvation ceiling or make a re-pended notice instantly
 * due, and Sanity cannot express "set only if unset" on one `.set()`.
 *
 * `windows` mirrors `isDue`'s injectable-override shape so the debounce/window
 * arithmetic can be tested against a non-default configuration; omit it to use
 * the env-derived module constants.
 */
export function buildUpsert(
  input: UpsertInput,
  now: Date,
  windows: UpsertWindowOverrides = {},
) {
  const debounceMs = windows.debounceMs ?? DEBOUNCE_MS;
  const maxWindowMs = windows.maxWindowMs ?? MAX_WINDOW_MS;
  const _id = outboxId(input.kind, input.subjectKey);
  return {
    createIfNotExists: {
      _id,
      _type: "notificationOutbox",
      kind: input.kind,
      subjectKey: input.subjectKey,
      memberId: input.memberId,
      roleId: input.roleId,
      proposalId: input.proposalId,
      serviceDate: input.serviceDate,
      roleType: input.roleType,
      before: input.before,
      knownRecipients: input.knownRecipients,
      firstQueuedAt: now.toISOString(),
      notifyAfter: new Date(now.getTime() + debounceMs).toISOString(),
      deadline: new Date(now.getTime() + maxWindowMs).toISOString(),
      status: "pending",
      claimedAt: null,
    } as Record<string, unknown>,
    patchSet: {
      notifyAfter: new Date(now.getTime() + debounceMs).toISOString(),
      status: "pending",
    } as Record<string, unknown>,
  };
}

export interface NoticeLifecycle {
  status: "pending" | "sending";
  notifyAfter: string;
  deadline: string;
  claimedAt: string | null;
}

/** Due on debounce elapsed, on the ceiling, or on an EXPIRED LEASE. */
export function isDue(n: NoticeLifecycle, now: Date, claimTtlMs = CLAIM_TTL_MS): boolean {
  const t = now.getTime();
  if (n.status === "pending") {
    return Math.min(Date.parse(n.notifyAfter), Date.parse(n.deadline)) <= t;
  }
  if (!n.claimedAt) return true;
  return Date.parse(n.claimedAt) + claimTtlMs <= t;
}
