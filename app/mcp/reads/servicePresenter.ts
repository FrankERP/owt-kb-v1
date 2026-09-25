// What `get_service` and `list_services` say about a service (P1 step 4), built
// from ONE service snapshot (`loadServiceSnapshot`) plus two content lookups
// (member names, song titles). No I/O here: every function is a pure reading of
// the snapshot it is handed, so readiness, seats, setlist rows and every
// revision in a payload come from the same load (spec I4, I7).
//
// The rules this module follows, and where each one comes from:
//
//  - SERVICES are the canonical role rows — `drafts.*` records are integrity
//    issues, never services. A service's date is its stored `week` (weekend) or
//    `date` (special) via `storedRoleDate`: a Saturday's is the Saturday's own
//    calendar day, the same `week` its Saturday setlist is stored under.
//    Order is /admin's: date, then `compareServiceTime`; ties by id, so it is
//    deterministic.
//  - PUBLICATION is `derivePublishState` (absent = published, spec I3).
//  - READINESS is `assembleService` over the snapshot's own readiness sources,
//    classified by `publishRefusalFor` (D2) — never re-derived.
//  - THE SETLIST OBSERVATION is the setlist WRITER's rule, read over the
//    snapshot's rows: a weekend target is `_type + week`, an overlay is any raw
//    `drafts.*` setlist on that target (by target, not by id — see
//    `observeServiceSetlist`), and a special's setlist is its own role row.
//    `setlistObservationParity.test.ts` runs the real writer loaders against it.
//
// Role types are never spelled here (spec I2): kinds come from `ROLE_TYPES` and
// setlist types from `setlistTypeForKind`.
//
// Server-side: `assembleService` lives in the server-only readiness bundle.

import {
  derivePublishState,
  type AvailabilityConflict,
  type ServiceIntegrityIssue,
  type ServiceSourceKey,
} from "@/app/components/admin/serviceReadiness";
import type { PublishBlockers, PublishHardBlocker, PublishWorkflowBlocker } from "@/app/components/admin/publishSelection";
import { PUBLISH_SKIP_COPY } from "@/app/components/admin/serviceCardModel";
import { buildRuns } from "@/app/utils/medley";
import { normalizeServiceName } from "@/app/utils/normalizeLabel";
import { assembleService } from "@/app/utils/publishReadyBundle";
import { isCanonicalDocumentId, storedRoleDate } from "@/app/utils/roleWriteRequest";
import { isWorshipNight } from "@/app/utils/serviceFormat";
import { ROLE_TYPES, isValidServiceDate, validateRole } from "@/app/utils/serviceReadModel";
import { compareServiceTime } from "@/app/utils/serviceTime";
import { SETLIST_SERVICE_KINDS, setlistTypeForKind, type SetlistServiceKind } from "@/app/utils/setlistWriteRequest";
import { songItemLeadIds } from "@/app/utils/songLeads";
import { publishRefusalFor, type PublishRefusalCode } from "./publishRefusal";
import type { MemberNameLookup, ServiceSnapshot, SnapshotRow } from "./serviceSnapshot";
import type { SongTitleLookup } from "./songTitles";

function isObj(v: unknown): v is Record<string, unknown> {
  return !!v && typeof v === "object";
}

function nonEmptyString(v: unknown): v is string {
  return typeof v === "string" && v.length > 0;
}

function stringOrNull(v: unknown): string | null {
  return typeof v === "string" ? v : null;
}

// ── Kinds ───────────────────────────────────────────────────────────────────

export type ServiceKind = SetlistServiceKind;

/**
 * `sunday` / `saturday` / `special` for a role `_type`, null for anything else.
 * `ROLE_TYPES` and `SETLIST_SERVICE_KINDS` are declared in the same order
 * (Sunday, Saturday, special); the presenter test pins the mapping.
 */
export function serviceKindOf(type: unknown): ServiceKind | null {
  const index = (ROLE_TYPES as readonly unknown[]).indexOf(type);
  return index < 0 ? null : (SETLIST_SERVICE_KINDS[index] ?? null);
}

// ── Selector (spec I13: exactly one selector) ───────────────────────────────

export type ServiceSelector =
  | { by: "next" }
  | { by: "id"; serviceId: string }
  | { by: "date"; date: string; kind: ServiceKind | null; name: string | null };

export type SelectorParse = { ok: true; selector: ServiceSelector } | { ok: false; message: string };

export const SELECTOR_HELP =
  'Usa un solo selector: { serviceId }, { date, kind: "sunday" | "saturday" }, ' +
  '{ date, kind: "special", name? }, { date } o {} para el próximo servicio.';

const refuse = (message: string): SelectorParse => ({ ok: false, message });

/**
 * Validates the selector's shape. The zod schema only types each field; which
 * combinations make ONE selector is decided here, with a Spanish refusal.
 */
export function parseServiceSelector(input: {
  serviceId?: unknown;
  date?: unknown;
  kind?: unknown;
  name?: unknown;
}): SelectorParse {
  const { serviceId, date, kind, name } = input;
  const given = (v: unknown) => v !== undefined;

  if (given(serviceId)) {
    if (given(date) || given(kind) || given(name)) return refuse(`serviceId no se combina con otros campos. ${SELECTOR_HELP}`);
    if (typeof serviceId === "string" && serviceId.startsWith("drafts.")) {
      return refuse(
        "Ese id es una copia de borrador de Sanity (drafts.*), no un servicio. " +
          "Usa el serviceId canónico, sin el prefijo «drafts.».",
      );
    }
    if (!isCanonicalDocumentId(serviceId)) return refuse("serviceId no es un id de documento válido.");
    return { ok: true, selector: { by: "id", serviceId } };
  }

  if (!given(date)) {
    if (given(kind) || given(name)) return refuse(`kind y name necesitan una fecha (date). ${SELECTOR_HELP}`);
    return { ok: true, selector: { by: "next" } };
  }
  if (!isValidServiceDate(date)) return refuse("date no es un día válido (YYYY-MM-DD).");
  if (given(kind) && !(SETLIST_SERVICE_KINDS as readonly unknown[]).includes(kind)) {
    return refuse('kind debe ser "sunday", "saturday" o "special".');
  }
  if (given(name) && kind !== "special") return refuse('name solo se usa con kind "special".');
  if (given(name) && typeof name !== "string") return refuse("name debe ser texto.");
  return {
    ok: true,
    selector: {
      by: "date",
      date,
      kind: given(kind) ? (kind as ServiceKind) : null,
      name: given(name) ? (name as string) : null,
    },
  };
}

// ── The catalogue ───────────────────────────────────────────────────────────

/** A service as a refusal or a same-day note names it. */
export type ServiceCandidate = {
  serviceId: string;
  kind: ServiceKind;
  date: string | null;
  /** A special's `service_name`; null for a weekend service. */
  name: string | null;
  /** A special's `time` ("HH:mm"); null when absent, and for a weekend service. */
  time: string | null;
};

interface CatalogueEntry {
  row: SnapshotRow;
  candidate: ServiceCandidate;
}

/** True when the roles read failed: there is no catalogue, and "no services" would be a lie. */
export function catalogueUnreadable(snapshot: ServiceSnapshot): boolean {
  return snapshot.readiness.sources.roles !== "ready";
}

export const CATALOGUE_UNREADABLE_MESSAGE =
  "No se pudo leer el catálogo de servicios, así que no se puede decir qué servicios hay. Intenta de nuevo en un momento.";

function compareIds(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

function compareEntries(a: CatalogueEntry, b: CatalogueEntry): number {
  const da = a.candidate.date;
  const db = b.candidate.date;
  if (da !== db) {
    if (da === null) return 1;
    if (db === null) return -1;
    return da < db ? -1 : 1;
  }
  return (
    compareServiceTime(a.candidate.time, b.candidate.time) || compareIds(a.candidate.serviceId, b.candidate.serviceId)
  );
}

/** Every canonical role row, as a service, in /admin's order. */
function catalogue(snapshot: ServiceSnapshot): CatalogueEntry[] {
  const out: CatalogueEntry[] = [];
  for (const row of snapshot.roles) {
    const kind = serviceKindOf(row._type);
    if (!kind || !isCanonicalDocumentId(row._id)) continue;
    const special = kind === "special";
    out.push({
      row,
      candidate: {
        serviceId: row._id,
        kind,
        date: storedRoleDate(row),
        name: special ? stringOrNull(row.service_name) : null,
        time: special ? stringOrNull(row.time) : null,
      },
    });
  }
  return out.sort(compareEntries);
}

// ── Resolution (ledger A15: never an arbitrary pick) ────────────────────────

export type ServiceResolution =
  | { ok: true; role: SnapshotRow; sameDayOthers: ServiceCandidate[] | null }
  | { ok: false; message: string; candidates: ServiceCandidate[] };

function candidateLabel(c: ServiceCandidate): string {
  const label = c.kind === "special" ? `especial «${c.name ?? ""}»${c.time ? ` ${c.time}` : " sin hora"}` : c.kind === "sunday" ? "domingo" : "sábado";
  return `${c.serviceId} (${label}, ${c.date ?? "sin fecha"})`;
}

function refusal(message: string, candidates: CatalogueEntry[]): ServiceResolution {
  const list = candidates.map((e) => e.candidate);
  return {
    ok: false,
    message: list.length ? `${message} Candidatos: ${list.map(candidateLabel).join("; ")}.` : message,
    candidates: list,
  };
}

/**
 * The one service a selector names, or a refusal that lists the candidates.
 * `today` is `serviceTodayIso()` — the Mexico City calendar day.
 */
export function resolveService(snapshot: ServiceSnapshot, selector: ServiceSelector, today: string): ServiceResolution {
  const services = catalogue(snapshot);

  if (selector.by === "id") {
    const found = services.find((e) => e.candidate.serviceId === selector.serviceId);
    return found
      ? { ok: true, role: found.row, sameDayOthers: null }
      : refusal(`No existe un servicio con el id ${selector.serviceId}.`, []);
  }

  if (selector.by === "date") {
    const onDate = services.filter((e) => e.candidate.date === selector.date);
    const ofKind = selector.kind ? onDate.filter((e) => e.candidate.kind === selector.kind) : onDate;
    const wanted = selector.name === null ? null : normalizeServiceName(selector.name);
    const matches = wanted === null ? ofKind : ofKind.filter((e) => normalizeServiceName(e.row.service_name) === wanted);
    if (matches.length === 1) return { ok: true, role: matches[0]!.row, sameDayOthers: null };
    if (matches.length > 1) {
      return refusal(
        `Hay ${matches.length} servicios que coinciden el ${selector.date}; elige uno por serviceId` +
          (selector.kind === "special" && wanted === null ? " o por name." : "."),
        matches,
      );
    }
    return refusal(
      `No hay un servicio que coincida con ese selector el ${selector.date}.`,
      ofKind.length > 0 ? ofKind : onDate,
    );
  }

  // `{}`: the earliest service on or after today, drafts included (D5).
  const upcoming = services.filter((e) => e.candidate.date !== null && e.candidate.date >= today);
  const first = upcoming[0];
  if (!first) return refusal(`No hay servicios programados desde hoy (${today}).`, []);
  const sameDay = upcoming.filter((e) => e.candidate.date === first.candidate.date);
  // Any tie for first place is an arbitrary pick — two duplicate weekend roles,
  // a Sunday beside an untimed special, two specials at the same time — and the
  // `{ date, kind }` selectors refuse the same sets, so `{}` refuses too (A15).
  const tiedFirst = sameDay.filter((e) => compareServiceTime(e.candidate.time, first.candidate.time) === 0);
  if (tiedFirst.length > 1) {
    return refusal(
      `El ${first.candidate.date} tiene varios servicios que no se pueden ordenar por hora (sin hora o con la misma), ` +
        "así que no hay un «próximo» único; elige uno por serviceId.",
      sameDay,
    );
  }
  return {
    ok: true,
    role: first.row,
    sameDayOthers: sameDay.length > 1 ? sameDay.slice(1).map((e) => e.candidate) : null,
  };
}

// ── The setlist observation (spec I7) ───────────────────────────────────────

/**
 * What a later setlist write must hand back unchanged. `none` / `single` are
 * the writer's own `ObservedTarget` shapes (plus the row keys the connector
 * adds); `ambiguous` and `draft_overlay` are states the writer REFUSES
 * (`ambiguous_target`, `integrity_conflict` — `draftIds` are the raw drafts it
 * names as `rawDrafts`), and so is `invalid` (a malformed record).
 *
 * `unknown` means a read the decision depends on failed, so the target cannot
 * be observed — never `none`. That includes a COORDINATION read sharing the
 * same source state: a special reads `unknown` when the weekend-lock inventory
 * alone failed, because `roleTargets` covers both the raw role drafts and the
 * locks and the snapshot cannot tell which one failed. It errs safe.
 */
export type SetlistObservation =
  | { state: "none" }
  | { state: "single"; id: string; rev: string; rowKeys: (string | null)[] }
  | { state: "ambiguous"; ids: string[] }
  | { state: "draft_overlay"; draftIds: string[] }
  | { state: "invalid" }
  | { state: "unknown" };

export interface ObservedSetlist {
  observation: SetlistObservation;
  /**
   * The rows of the ONE document the setlist lives on — the same row the
   * observation's `rev` came from — or null when there is not exactly one (or
   * its reads failed). Present under an overlay too: members see this document.
   */
  songs: readonly unknown[] | null;
}

function rowKeysOf(songs: readonly unknown[]): (string | null)[] {
  return songs.map((item) => (isObj(item) && nonEmptyString(item._key) ? item._key : null));
}

/**
 * The setlist writer's target decision, over the snapshot:
 *
 * - SPECIAL (`loadSpecialSetlistTarget`): a raw `drafts.<roleId>` overlay is
 *   refused, then an ungroupable role, then `songs` as a list is `single` on the
 *   role itself (`{ id: roleId, rev: role._rev }`), anything else `none`.
 * - WEEKEND (`loadWeekendSetlistTarget`): the canonical setlists and the raw
 *   drafts whose `_type` + `week` are this target. Any draft is refused — found by
 *   TARGET, as the writer's `rawSetlistDraftsForWeekQuery` finds it, so a
 *   draft-only copy beside a legacy (non-deterministic) id still counts. The
 *   readiness bundle matches drafts by base id and would call that week clean.
 *   Then a malformed record, then more than one document (`ambiguous`), then
 *   `single` / `none`.
 */
export function observeServiceSetlist(snapshot: ServiceSnapshot, role: SnapshotRow): ObservedSetlist {
  const kind = serviceKindOf(role._type);
  const sources = snapshot.readiness.sources;
  const roleId = stringOrNull(role._id) ?? "";

  if (kind === "special") {
    // Its overlay check reads the raw role drafts, which share the `roleTargets`
    // source with the weekend locks: a failed lock read alone also lands here as
    // `unknown` (see `SetlistObservation`). Deliberately conservative.
    if (sources.roleTargets !== "ready") return { observation: { state: "unknown" }, songs: null };
    const songs = Array.isArray(role.songs) ? (role.songs as readonly unknown[]) : null;
    const roleDrafts = snapshot.roleDraftIds.filter((id) => id === `drafts.${roleId}`);
    if (roleDrafts.length > 0) return { observation: { state: "draft_overlay", draftIds: roleDrafts }, songs };
    if (!validateRole(role).groupable || !nonEmptyString(role._rev)) return { observation: { state: "invalid" }, songs };
    if (!songs) return { observation: { state: "none" }, songs: null };
    return { observation: { state: "single", id: roleId, rev: role._rev, rowKeys: rowKeysOf(songs) }, songs };
  }

  if (sources.setlistTargets !== "ready") return { observation: { state: "unknown" }, songs: null };
  const setlistType = setlistTypeForKind(kind);
  const week = storedRoleDate(role);
  if (!setlistType || !week) return { observation: { state: "invalid" }, songs: null };

  const canonical = snapshot.setlists.filter((row) => row._type === setlistType && row.week === week);
  const drafts = snapshot.setlistDrafts.filter((draft) => draft.type === setlistType && draft.week === week);
  const single = canonical.length === 1 ? canonical[0]! : null;
  const songs = single ? (Array.isArray(single.songs) ? (single.songs as readonly unknown[]) : []) : null;

  if (drafts.length > 0) {
    return { observation: { state: "draft_overlay", draftIds: drafts.map((d) => d.id).sort(compareIds) }, songs };
  }
  if (canonical.some((row) => !nonEmptyString(row._id) || !nonEmptyString(row._rev))) {
    return { observation: { state: "invalid" }, songs };
  }
  if (canonical.length > 1) {
    return { observation: { state: "ambiguous", ids: canonical.map((row) => row._id as string).sort(compareIds) }, songs: null };
  }
  if (!single) return { observation: { state: "none" }, songs: null };
  return {
    observation: { state: "single", id: single._id as string, rev: single._rev as string, rowKeys: rowKeysOf(songs ?? []) },
    songs,
  };
}

// ── Seats ───────────────────────────────────────────────────────────────────

/** The five seat paths, spelled as the swap writer takes them (`path`). */
export const SEAT_PATHS = ["Lead", "BGVs", "Chorus", "instruments", "foh_team"] as const;
export type SeatPath = (typeof SEAT_PATHS)[number];

type MemberName = { name: string | null; alias: string | null; missing?: true; unresolved?: true };

export type SeatItem = {
  itemKey: string | null;
  memberId: string | null;
  name: string | null;
  alias: string | null;
  /** On `instruments`. */
  instrument?: string | null;
  /** On `foh_team`. */
  role?: string | null;
  /** The reference names no member document (or no reference at all). */
  missing?: true;
  /** The member read failed: the name is unknown, which is not the same as missing. */
  unresolved?: true;
};

function seatRef(item: unknown, path: SeatPath): string | null {
  const holder = isObj(item) ? (path === "instruments" || path === "foh_team" ? item.person : item) : null;
  return isObj(holder) && nonEmptyString(holder._ref) ? holder._ref : null;
}

function memberName(id: string | null, members: MemberNameLookup): MemberName {
  if (id === null) return { name: null, alias: null, missing: true };
  const member = members.byId.get(id);
  if (member) return { name: stringOrNull(member.member_name), alias: stringOrNull(member.alias) };
  return members.ok ? { name: null, alias: null, missing: true } : { name: null, alias: null, unresolved: true };
}

function seatItems(value: unknown, path: SeatPath, members: MemberNameLookup): SeatItem[] | null {
  if (!Array.isArray(value)) return null;
  return value.map((item) => {
    const memberId = seatRef(item, path);
    const seat: SeatItem = {
      itemKey: isObj(item) && nonEmptyString(item._key) ? item._key : null,
      memberId,
      ...memberName(memberId, members),
    };
    if (path === "instruments") seat.instrument = isObj(item) ? stringOrNull(item.instrument) : null;
    if (path === "foh_team") seat.role = isObj(item) ? stringOrNull(item.role) : null;
    return seat;
  });
}

// ── Content ids ─────────────────────────────────────────────────────────────

/** Everyone the payload names (every seat, and a worship night's song leaders) and every song. */
export function serviceContentIds(snapshot: ServiceSnapshot, role: SnapshotRow): { memberIds: string[]; songIds: string[] } {
  const memberIds = new Set<string>();
  for (const path of SEAT_PATHS) {
    const value = role[path];
    if (!Array.isArray(value)) continue;
    for (const item of value) {
      const id = seatRef(item, path);
      if (id) memberIds.add(id);
    }
  }
  const { songs } = observeServiceSetlist(snapshot, role);
  const songIds = new Set<string>();
  for (const item of songs ?? []) {
    if (isObj(item) && isObj(item.song) && nonEmptyString(item.song._ref)) songIds.add(item.song._ref);
    if (isWorshipNight(role)) for (const id of songItemLeadIds(item)) memberIds.add(id);
  }
  return { memberIds: [...memberIds], songIds: [...songIds] };
}

// ── The setlist content ─────────────────────────────────────────────────────

/** A leader entry. `memberId: null` (with `missing: true`) is an entry that carries no reference at all. */
export type SetlistLead = { memberId: string | null } & MemberName;

export type SetlistRow = {
  rowKey: string | null;
  song: { id: string; title: string | null; author: string | null; missing?: true } | null;
  /** The key it is played in (`play_key`). */
  key: string | null;
  medleyTag: string | null;
  /** A worship night only: the row's leaders, by name. */
  leads?: SetlistLead[];
};

export type SetlistRun = { kind: "single" | "medley"; rowKeys: (string | null)[]; positions: number[] };

/**
 * A row's leader references in stored order, each named once — as
 * `songItemLeadIds` reads them — except that an entry with no `_ref` is kept as
 * `null` instead of dropped, so it is reported the way a ref-less seat is.
 */
function rowLeads(leads: unknown): (string | null)[] {
  if (!Array.isArray(leads)) return [];
  const out: (string | null)[] = [];
  for (const entry of leads) {
    const ref = isObj(entry) && nonEmptyString(entry._ref) ? entry._ref : null;
    if (ref === null || !out.includes(ref)) out.push(ref);
  }
  return out;
}

function setlistContent(
  songs: readonly unknown[],
  worshipNight: boolean,
  members: MemberNameLookup,
  titles: SongTitleLookup,
): { rows: SetlistRow[]; runs: SetlistRun[] } {
  const rows = songs.map((item): SetlistRow => {
    const obj = isObj(item) ? item : {};
    const songId = isObj(obj.song) && nonEmptyString(obj.song._ref) ? obj.song._ref : null;
    const title = songId ? titles.byId.get(songId) : undefined;
    const row: SetlistRow = {
      rowKey: nonEmptyString(obj._key) ? obj._key : null,
      song: songId
        ? title
          ? { id: songId, title: title.title, author: title.author }
          : titles.ok
            ? { id: songId, title: null, author: null, missing: true }
            : { id: songId, title: null, author: null }
        : null,
      key: stringOrNull(obj.play_key),
      medleyTag: stringOrNull(obj.medley_tag),
    };
    if (worshipNight) row.leads = rowLeads(obj.leads).map((memberId) => ({ memberId, ...memberName(memberId, members) }));
    return row;
  });

  const runs = buildRuns(rows.map((row) => ({ rowKey: row.rowKey, medley_tag: row.medleyTag ?? undefined }))).map(
    (run): SetlistRun =>
      run.kind === "single"
        ? { kind: "single", rowKeys: [run.song.rowKey], positions: [run.n] }
        : { kind: "medley", rowKeys: run.songs.map((s) => s.song.rowKey), positions: run.songs.map((s) => s.n) },
  );
  return { rows, runs };
}

// ── Readiness (spec I4, Decision D2) ────────────────────────────────────────

export type BlockerLine<C extends string> = { code: C; copy: string };
export type BlockerLines = { hard: BlockerLine<PublishHardBlocker>[]; workflow: BlockerLine<PublishWorkflowBlocker>[] };

function blockerLines(blockers: PublishBlockers | null): BlockerLines {
  return {
    hard: (blockers?.hard ?? []).map((code) => ({ code, copy: PUBLISH_SKIP_COPY[code] })),
    workflow: (blockers?.workflow ?? []).map((code) => ({ code, copy: PUBLISH_SKIP_COPY[code] })),
  };
}

export type PublishProblem = { code: Exclude<PublishRefusalCode, "already_published">; copy: string; blockers?: string[] };

export type ServiceReadinessView = {
  /** D2: every readiness gap, hard (never overridable) and workflow, in the admin's Spanish. */
  blockers: BlockerLines;
  /** The Servicios card's next step. */
  primaryAction: { kind: string; label: string };
  /** Members seated on a day they marked unavailable. */
  conflicts: AvailabilityConflict[];
  /** The integrity notes readiness reports (duplicates, overlays, locks, dangling seats…). */
  integrityIssues: ServiceIntegrityIssue[];
  /**
   * Whether the per-service publish check passes NOW — the publish-ready route's
   * own verdict. `refusals` is that verdict's codes, verbatim. A live service is
   * refused `already_published`: that is its state (`alreadyPublished`), so it is
   * left out of `problems`, which are the reasons that are actually problems.
   */
  publishCheck: {
    passesNow: boolean;
    refusals: PublishRefusalCode[];
    alreadyPublished: boolean;
    problems: PublishProblem[];
  };
};

function readinessView(snapshot: ServiceSnapshot, roleId: string): ServiceReadinessView {
  const assembled = assembleService(snapshot.readiness, roleId);
  // Unreachable for a canonical role row: the snapshot's `rolesById` holds it.
  if (!assembled) throw new Error("service not in its own snapshot");
  const verdict = publishRefusalFor(assembled);
  const detail = verdict.blockerCopy;
  const problems: PublishProblem[] = [];
  verdict.refusals.forEach((code, i) => {
    if (code === "already_published") return;
    const problem: PublishProblem = { code, copy: verdict.copy[i]! };
    if (code === "not_ready" && detail) problem.blockers = [...detail.workflow];
    if (code === "hard_integrity_blocker" && detail) problem.blockers = [...detail.hard];
    problems.push(problem);
  });
  return {
    blockers: blockerLines(verdict.blockers),
    primaryAction: { kind: assembled.readiness.primaryAction.kind, label: assembled.readiness.primaryAction.label },
    conflicts: assembled.readiness.conflicts.map((c) => ({ ...c })),
    integrityIssues: assembled.readiness.integrityIssues.map((issue) => ({ ...issue, ids: [...issue.ids] })),
    publishCheck: {
      passesNow: verdict.ready,
      refusals: [...verdict.refusals],
      alreadyPublished: verdict.refusals.includes("already_published"),
      problems,
    },
  };
}

// ── get_service ─────────────────────────────────────────────────────────────

export type SpecialIdentity = { name: string | null; time: string | null; format: string | null };

export type GetServicePayload = {
  serviceId: string;
  kind: ServiceKind;
  /** The service's own calendar day (a Saturday's is the Saturday). */
  date: string | null;
  /** Specials only. */
  name?: string | null;
  time?: string | null;
  format?: string | null;
  /** Spec I3: `derivePublishState` — a missing field is a pre-draft service, published. */
  published: "draft" | "published";
  /** The stored field as read: `true`, `false`, or null when absent. */
  publishedRaw: boolean | null;
  /** All five seat groups; null for a group that is not a list (an invalid record). */
  seats: Record<SeatPath, SeatItem[] | null>;
  /** The setlist's rows, from the same document the observation names; null when there is not exactly one. */
  setlist: { rows: SetlistRow[]; runs: SetlistRun[] } | null;
  readiness: ServiceReadinessView;
  /** Spec I7: pass these unchanged to a later write; never build them. */
  observations: {
    roleId: string;
    roleRev: string | null;
    seatItemKeys: Record<SeatPath, (string | null)[] | null>;
    setlist: SetlistObservation;
  };
  /** `{}` only: the other services on the same day, in order. */
  sameDayOthers?: ServiceCandidate[];
  /** Readiness domains whose read failed (readiness shows them as hard blockers). */
  failedSources?: ServiceSourceKey[];
  /** Spanish notes about content that could not be read. */
  notes?: string[];
};

export interface ContentLookups {
  members: MemberNameLookup;
  songs: SongTitleLookup;
}

function specialIdentity(role: SnapshotRow): SpecialIdentity {
  return { name: stringOrNull(role.service_name), time: stringOrNull(role.time), format: stringOrNull(role.format) };
}

function publication(role: SnapshotRow): { published: "draft" | "published"; publishedRaw: boolean | null } {
  return {
    published: derivePublishState(role.published),
    publishedRaw: typeof role.published === "boolean" ? role.published : null,
  };
}

function failedSourcesOf(snapshot: ServiceSnapshot): { failedSources?: ServiceSourceKey[] } {
  const failed = snapshot.readiness.failedSources;
  return failed.length ? { failedSources: [...failed] } : {};
}

/** One service, as `get_service` reports it. `role` must be a row of `snapshot.roles`. */
export function presentService(snapshot: ServiceSnapshot, role: SnapshotRow, lookups: ContentLookups): GetServicePayload {
  const kind = serviceKindOf(role._type);
  const serviceId = stringOrNull(role._id);
  if (!kind || !serviceId) throw new Error("not a service row");

  const seats = {} as Record<SeatPath, SeatItem[] | null>;
  const seatItemKeys = {} as Record<SeatPath, (string | null)[] | null>;
  for (const path of SEAT_PATHS) {
    seats[path] = seatItems(role[path], path, lookups.members);
    seatItemKeys[path] = seats[path] ? seats[path].map((seat) => seat.itemKey) : null;
  }

  const { observation, songs } = observeServiceSetlist(snapshot, role);
  const setlist = songs ? setlistContent(songs, isWorshipNight(role), lookups.members, lookups.songs) : null;

  const notes: string[] = [];
  if (!lookups.songs.ok && setlist && setlist.rows.some((row) => row.song)) {
    notes.push("No se pudieron leer los títulos de las canciones; se muestran solo sus ids.");
  }
  const people = [...Object.values(seats).flatMap((group) => group ?? []), ...(setlist?.rows ?? []).flatMap((row) => row.leads ?? [])];
  if (people.some((person) => person.unresolved)) {
    notes.push("No se pudieron leer los nombres de algunos miembros; aparecen con unresolved: true.");
  }

  const readiness = readinessView(snapshot, serviceId);
  // The writer finds a setlist overlay by target; readiness matches drafts by id
  // and misses one beside a legacy id. Say so — as a note, never as a readiness
  // blocker, which would part ways with the publish route (spec I4).
  if (observation.state === "draft_overlay") {
    const named = new Set(readiness.integrityIssues.flatMap((issue) => issue.ids));
    const unnamed = observation.draftIds.filter((id) => !named.has(id));
    if (unnamed.length > 0) {
      notes.push(
        `Hay un borrador sin publicar de este setlist en Studio (${unnamed.map((id) => `«${id}»`).join(", ")}). ` +
          "La verificación de publicación no lo detecta, pero el editor de setlist se negará a guardar " +
          "hasta que se descarte o publique en Studio.",
      );
    }
  }

  return {
    serviceId,
    kind,
    date: storedRoleDate(role),
    ...(kind === "special" ? specialIdentity(role) : {}),
    ...publication(role),
    seats,
    setlist,
    readiness,
    observations: {
      roleId: serviceId,
      roleRev: stringOrNull(role._rev),
      seatItemKeys,
      setlist: observation,
    },
    ...failedSourcesOf(snapshot),
    ...(notes.length ? { notes } : {}),
  };
}

// ── list_services ───────────────────────────────────────────────────────────

export type ServiceListEntry = {
  serviceId: string;
  /** Spec I7: pass unchanged to a later write; never build it. */
  roleRev: string | null;
  date: string | null;
  kind: ServiceKind;
  name?: string | null;
  time?: string | null;
  format?: string | null;
  published: "draft" | "published";
  publishedRaw: boolean | null;
  blockers: BlockerLines;
};

export type ListServicesPayload = {
  month: string;
  services: ServiceListEntry[];
  failedSources?: ServiceSourceKey[];
};

/** Every canonical service dated in `month` ("YYYY-MM"), in /admin's order. */
export function presentServiceList(snapshot: ServiceSnapshot, month: string): ListServicesPayload {
  const services = catalogue(snapshot)
    .filter((e) => e.candidate.date !== null && e.candidate.date.startsWith(`${month}-`))
    .map(({ row, candidate }): ServiceListEntry => {
      const assembled = assembleService(snapshot.readiness, candidate.serviceId);
      if (!assembled) throw new Error("service not in its own snapshot");
      return {
        serviceId: candidate.serviceId,
        roleRev: stringOrNull(row._rev),
        date: candidate.date,
        kind: candidate.kind,
        ...(candidate.kind === "special" ? specialIdentity(row) : {}),
        ...publication(row),
        blockers: blockerLines(publishRefusalFor(assembled).blockers),
      };
    });
  return { month, services, ...failedSourcesOf(snapshot) };
}
