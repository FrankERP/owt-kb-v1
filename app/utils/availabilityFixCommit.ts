// The availability proposals' writer (ADR-0079; plan
// docs/superpowers/plans/2026-10-29-availability-conflict-resolver.md §5–§6).
//
// PROPOSALS ONLY. A sweep finds every person seated on a day they marked unavailable, proposes a
// replacement (`availabilityConflicts.ts`), records it in an `availabilityConflict` document and
// emails the worship admins once per event. It NEVER writes a role — drafts included (Frank's
// choice, 2026-10-30). The one role write here is «Aplicar» (`applyAvailabilityFix`), a person's
// click, through `/admin`'s own edit writer (`editRole`, unchanged).
//
// THE RECORD. `availabilityConflict.<sha256(roleId|memberId|date), 32 hex>` (dotted → private: every
// read carries the read token or this module refuses). Statuses `proposed | none | applied | kept |
// gone`; `eventSeq`/`notifiedSeq` make the email per event. Every write is guarded: a new record by
// `create` (a concurrent creation fails, never `createIfNotExists`), an existing one under the
// revision this run read. A lost guard means another run got there first: the step is dropped and
// the next run re-reads. This module is the type's ONE reader and writer.
//
// THE READS, in order: the records FIRST, then the plan sources. «Aplicar» writes the role before
// its record, so a record read before the roles is never newer than the roles it is judged with,
// and a record «Aplicar» wrote meanwhile fails this run's guard (no spurious «back» event).
//
// ONLY PRODUCTION ACTS ON ITS OWN. Elsewhere (Preview shares the real dataset) a sweep is DRY: it
// answers what it would do and writes and sends nothing. «Aplicar» and «Mantener» are clicks and
// work anywhere, on the real data. `AVAILABILITY_SWEEP_DISABLED=1` stops both automatic triggers
// and makes «Revisar ahora» dry (docs/SECRETS.md).
//
// LOGGING: fixed tags and counts only — never a name, an id or a rule key.

import "server-only";

import { createHash } from "node:crypto";

import { operationalClient } from "@/sanity/lib/operationalClient";
import { writeClient } from "@/sanity/lib/serverClient";
import { WORSHIP_AUDIENCE_GROQ_FILTER } from "@/app/ministries";
import { serviceTodayIso } from "@/app/components/admin/serviceReadiness";
import type { ServiceRole } from "@/app/components/admin/serviceCardModel";
import { storedMonthBoard, storedColumn, type StoredMonthBoard } from "@/app/mcp/monthProposals/storedMonthBoard";
import type { EditorMember } from "@/app/mcp/monthProposals/revise";
import { editRole } from "./roleEditCommit";
import { parseEditRequest, sanityConflictKind } from "./roleWriteRequest";
import { fairnessRecordEnvironment, resolveSolverEngine } from "./solverDeployment";
import { loadV3Ledger, loadV3PlanSources, type V3PlanSources } from "./v3MonthPlanReads";
import type { FairnessLedgerResponse } from "./fairnessVocabulary";
import { assignedSeatsByRoleQuery } from "./notifyTargets";
import { isDeliveryBlocked } from "./deliveryFirewall";
import { sendEmail } from "./email";
import { getAllowlist, isEmailAllowed } from "./assignmentEmail";
import { wantsNotification } from "./notifyPrefs";
import { serviceLabel } from "./emailServiceLabel";
import { buildConflictEmail, type ConflictEmailLine } from "./availabilityConflictEmail";
import {
  findRoleConflicts,
  horizonMonths,
  proposeReplacement,
  type NoneReason,
  type Proposal,
  type RoleConflict,
} from "./availabilityConflicts";

export const CONFLICT_TYPE = "availabilityConflict";

/** A sweep's window: no deadline is later than this after its invocation began (`maxDuration = 60`). */
export const SWEEP_WINDOW_MS = 50_000;
/** No new judgement starts with less than this left before the deadline. */
export const JUDGE_CUTOFF_MS = 15_000;
/** The email step starts only with at least this left (a claimed email has room to send). */
export const EMAIL_CUTOFF_MS = 10_000;
/** A `proposed`/`none` record is re-judged (and `checkedAt` refreshed) at most this often. */
export const RECHECK_MS = 6 * 60 * 60 * 1000;
/** The tick: every third 5-minute bucket, with at least this left of its window. */
export const TICK_BUCKET_MS = 300_000;
export const TICK_MIN_LEFT_MS = 40_000;
/** Applied conflicts listed this long. */
const APPLIED_LIST_MS = 30 * 24 * 60 * 60 * 1000;
/** The panel's GET judges inside this much of its 60 s function; then alternatives, then picks, stop. */
const PANEL_BUDGET_MS = 30_000;

export type ConflictStatus = "proposed" | "none" | "applied" | "kept" | "gone";
export type SweepTrigger = "member" | "cron" | "manual";
export type BlockedReason = "no_token" | "sources" | "incoherent" | "engine";

export interface ConflictSeat {
  _key: string;
  rowId: string;
  from: string;
  to?: string;
}

export interface ConflictRecord {
  _id: string;
  _rev: string;
  _type: typeof CONFLICT_TYPE;
  roleId: string;
  memberId: string;
  date: string;
  serviceKind: ServiceRole["_type"];
  published: boolean;
  status: ConflictStatus;
  seats: ConflictSeat[];
  reason?: NoneReason;
  eventSeq: number;
  notifiedSeq: number;
  firstSeenAt: string;
  updatedAt: string;
  checkedAt?: string;
  appliedBy?: string;
  trigger: SweepTrigger | "apply" | "keep";
}

export function conflictRecordId(roleId: string, memberId: string, date: string): string {
  return `${CONFLICT_TYPE}.${createHash("sha256").update(`${roleId}|${memberId}|${date}`).digest("hex").slice(0, 32)}`;
}

// ── Transitions (§5.2) ───────────────────────────────────────────────────────

/** What a judgeable read says about one identity. */
export type Observation =
  | { c: false }
  | { c: true; conflict: RoleConflict; e: false }
  | { c: true; conflict: RoleConflict; e: true; proposal: Proposal };

/** The fields a write sets (a create carries the rest). `null` = no write. */
export interface RecordChange {
  status: ConflictStatus;
  seats: ConflictSeat[];
  reason?: NoneReason;
  published?: boolean;
  event: boolean;
  checked: boolean;
}

const seatsOf = (p: Proposal | null, held: readonly string[], memberId: string): ConflictSeat[] =>
  p && p.kind === "replace"
    ? p.seats.map((s, i) => ({ _key: `s${i}`, rowId: s.rowId, from: s.from, to: s.to }))
    : held.map((rowId, i) => ({ _key: `s${i}`, rowId, from: memberId }));

const sameSeats = (a: readonly ConflictSeat[], b: readonly ConflictSeat[]) =>
  a.length === b.length && a.every((x, i) => x.rowId === b[i].rowId && x.from === b[i].from && (x.to ?? "") === (b[i].to ?? ""));

/**
 * The §5.2 table. `held` = the rows the person holds (for a `none`'s seats); `stale` = the record's
 * `checkedAt` is older than `RECHECK_MS` (refreshed with no event when nothing else changed).
 */
export function transition(record: ConflictRecord | null, obs: Observation, held: readonly string[], stale: boolean): RecordChange | null {
  const status = record?.status ?? null;
  if (!obs.c) {
    if (status === "proposed" || status === "none" || status === "kept") return { status: "gone", seats: record!.seats, event: false, checked: false };
    return null;
  }
  if (status === "kept") return null;
  const published = obs.conflict.published;
  const judged: { status: "proposed" | "none"; seats: ConflictSeat[]; reason?: NoneReason } = !obs.e
    ? { status: "none", seats: seatsOf(null, held, obs.conflict.memberId), reason: "unchecked" }
    : obs.proposal.kind === "replace"
      ? { status: "proposed", seats: seatsOf(obs.proposal, held, obs.conflict.memberId) }
      : { status: "none", seats: seatsOf(null, held, obs.conflict.memberId), reason: obs.proposal.reason };
  // No record, `gone`, or `applied` with the person seated again: a NEW event.
  // `checked` is true even when the service is not editable: that observation is the check, so an
  // unfixable conflict stops reopening the tick's pre-check until it is stale again.
  if (status === null || status === "gone" || status === "applied") return { ...judged, published, event: true, checked: true };
  // `proposed`/`none`.
  if (judged.status !== status) return { ...judged, published, event: true, checked: true };
  const changed = !sameSeats(judged.seats, record!.seats) || (judged.reason ?? null) !== (record!.reason ?? null) || published !== record!.published;
  if (changed) return { ...judged, published, event: false, checked: true };
  if (stale) return { ...judged, published, event: false, checked: true };
  return null;
}

// ── Dependencies (injected in tests) ─────────────────────────────────────────

export interface AudienceMember {
  _id: string;
  email?: string;
  notifPrefs?: unknown;
}

export interface AvailabilityDeps {
  hasToken: () => boolean;
  readRecords: (fromIso: string) => Promise<ConflictRecord[]>;
  reads: typeof loadV3PlanSources;
  readLedger: (months: readonly string[]) => Promise<FairnessLedgerResponse>;
  engine: () => string;
  acts: () => boolean;
  todayIso: () => string;
  now: () => number;
  create: (doc: Omit<ConflictRecord, "_rev">) => Promise<void>;
  /** `unset` names fields to remove (a JSON `undefined` would leave them stored). */
  patch: (id: string, rev: string, set: Partial<ConflictRecord>, unset?: string[]) => Promise<void>;
  readAudience: () => Promise<AudienceMember[]>;
  deliveryBlocked: () => boolean;
  send: (to: string, subject: string, html: string) => Promise<{ ok: boolean }>;
  editRole: typeof editRole;
  readSeats: (filter: string, params: Record<string, unknown>) => Promise<Array<{ _id: string; date: string; members: string[] }>>;
  readUnavailable: () => Promise<Array<{ _id: string; unavailableDates?: string[] }>>;
}

/** The worship admins the email may reach (§6.2), system accounts left out. */
const AUDIENCE_QUERY = `*[_type == "teamMembers" && role in ["super-admin", "admin"] && disabled != true && ${WORSHIP_AUDIENCE_GROQ_FILTER} && !(string::startsWith(_id, "service-account-") || _id == "member-dev-verify")]{ _id, email, notifPrefs }`;

const RECORDS_QUERY = `*[_type == "${CONFLICT_TYPE}" && date >= $from]`;

export function sweepDisabled(env: Record<string, string | undefined> = process.env): boolean {
  return env.AVAILABILITY_SWEEP_DISABLED?.trim() === "1";
}

export function defaultAvailabilityDeps(): AvailabilityDeps {
  return {
    hasToken: () => !!process.env.SANITY_API_READ_TOKEN,
    readRecords: async (from) => {
      const rows: unknown = await operationalClient.fetch(RECORDS_QUERY, { from });
      if (!Array.isArray(rows)) throw new Error("records");
      return rows as ConflictRecord[];
    },
    reads: loadV3PlanSources,
    readLedger: loadV3Ledger,
    engine: () => resolveSolverEngine(process.env),
    acts: () => fairnessRecordEnvironment(process.env) === "production" && !sweepDisabled(),
    todayIso: serviceTodayIso,
    now: Date.now,
    create: async (doc) => {
      await writeClient.create(doc);
    },
    patch: async (id, rev, set, unset = []) => {
      const p = writeClient.patch(id).ifRevisionId(rev).set(set);
      await (unset.length ? p.unset(unset) : p).commit();
    },
    readAudience: async () => {
      const rows: unknown = await operationalClient.fetch(AUDIENCE_QUERY);
      if (!Array.isArray(rows)) throw new Error("audience");
      return rows as AudienceMember[];
    },
    deliveryBlocked: () => isDeliveryBlocked(),
    send: (to, subject, html) => sendEmail({ to, subject, html }),
    editRole,
    readSeats: async (filter, params) => {
      const rows: unknown = await operationalClient.fetch(assignedSeatsByRoleQuery(filter), params);
      if (!Array.isArray(rows)) throw new Error("seats");
      return rows as Array<{ _id: string; date: string; members: string[] }>;
    },
    readUnavailable: async () => {
      const rows: unknown = await operationalClient.fetch(`*[_type == "teamMembers" && count(unavailableDates) > 0]{ _id, unavailableDates }`);
      if (!Array.isArray(rows)) throw new Error("unavailable");
      return rows as Array<{ _id: string; unavailableDates?: string[] }>;
    },
  };
}

// ── The judgeable read ───────────────────────────────────────────────────────

interface Judgeable {
  records: ConflictRecord[];
  sources: V3PlanSources;
  todayIso: string;
  boards: Map<string, StoredMonthBoard>;
}

const ROLE_TYPES_FILTER = `_type in ["sunday_role", "saturday_role", "special_role"]`;

async function readJudgeable(deps: AvailabilityDeps): Promise<{ ok: true; value: Judgeable } | { ok: false; reason: BlockedReason }> {
  if (!deps.hasToken()) return { ok: false, reason: "no_token" };
  const todayIso = deps.todayIso();
  let records: ConflictRecord[];
  try {
    records = await deps.readRecords(todayIso);
  } catch {
    return { ok: false, reason: "sources" };
  }
  const read = await deps.reads();
  if (!read.ok) return { ok: false, reason: "sources" };
  const sources = read.value;
  const states = sources.snapshot.readiness.sources;
  if ((Object.keys(states) as (keyof typeof states)[]).some((k) => states[k] !== "ready")) return { ok: false, reason: "sources" };
  if (deps.engine() !== "v3") return { ok: false, reason: "engine" };
  const boards = new Map<string, StoredMonthBoard>();
  for (const month of horizonMonths(todayIso)) {
    const board = storedMonthBoard({ month, adminRoles: sources.adminRoles, summary: sources.snapshot.readiness.roleSummary, todayIso });
    if (!board.coherent) return { ok: false, reason: "incoherent" };
    boards.set(month, board);
  }
  return { ok: true, value: { records, sources, todayIso, boards } };
}

function blocked(reason: BlockedReason) {
  console.error(`[availability-sweep] blocked ${reason}`);
}

const snapshotRoleOf = (sources: V3PlanSources, roleId: string) =>
  sources.snapshot.roles.find((r) => (r as { _id?: string })._id === roleId) as { format?: unknown; songs?: Array<{ leads?: Array<{ _ref?: string }> }> } | undefined;

/** The rows a person holds on a service, in board order (none when the service is not on a board). */
function heldRows(board: StoredMonthBoard | undefined, roleId: string, memberId: string): string[] {
  if (!board) return [];
  return board.rows
    .filter((r) => board.cells.some((c) => c.columnId === roleId && c.rowId === r.id && c.occupants.some((o) => o.memberId === memberId)))
    .map((r) => r.id);
}

function propose(j: Judgeable, conflict: RoleConflict, ledger: FairnessLedgerResponse | null, extra: { exclude?: ReadonlySet<string>; only?: ReadonlyMap<string, string> } = {}): Proposal {
  const board = j.boards.get(conflict.date.slice(0, 7))!;
  return proposeReplacement({
    board,
    roleId: conflict.roleId,
    memberId: conflict.memberId,
    members: j.sources.members as EditorMember[],
    config: j.sources.rules.config,
    adminRoles: j.sources.adminRoles,
    todayIso: j.todayIso,
    ledger,
    snapshotRole: snapshotRoleOf(j.sources, conflict.roleId),
    ...extra,
  });
}

const isEditable = (j: Judgeable, c: RoleConflict) => {
  const board = j.boards.get(c.date.slice(0, 7));
  return !!board && board.editable.has(c.roleId) && c.date >= j.todayIso && !!storedColumn(board, c.roleId);
};

// ── The sweep (§5.3) ─────────────────────────────────────────────────────────

export interface SweepReport {
  ok: boolean;
  mode: "act" | "dry";
  reason?: BlockedReason;
  proposed: string[];
  none: string[];
  kept: string[];
  gone: string[];
  skipped: string[];
  emailed: number;
}

export async function sweepAvailabilityConflicts(
  options: { trigger: SweepTrigger; memberId?: string; deadlineMs: number; mode: "act" | "dry" },
  deps: AvailabilityDeps = defaultAvailabilityDeps(),
): Promise<SweepReport> {
  const report: SweepReport = { ok: true, mode: options.mode, proposed: [], none: [], kept: [], gone: [], skipped: [], emailed: 0 };
  const read = await readJudgeable(deps);
  if (!read.ok) {
    blocked(read.reason);
    return { ...report, ok: false, reason: read.reason };
  }
  const j = read.value;
  const act = options.mode === "act";
  const inScope = (memberId: string) => !options.memberId || memberId === options.memberId;

  const conflicts = findRoleConflicts({ adminRoles: j.sources.adminRoles, members: j.sources.members as EditorMember[], todayIso: j.todayIso, memberId: options.memberId });
  const byId = new Map(conflicts.map((c) => [conflictRecordId(c.roleId, c.memberId, c.date), c]));
  const recordById = new Map(j.records.map((r) => [r._id, r]));
  const horizon = new Set(horizonMonths(j.todayIso));
  // Identities: every conflict seen, plus every open or kept record in scope (its end is news too).
  const ids = new Set(byId.keys());
  for (const r of j.records) {
    if (!inScope(r.memberId) || !horizon.has(r.date.slice(0, 7))) continue;
    if (r.status === "proposed" || r.status === "none" || r.status === "kept") ids.add(r._id);
  }
  const ordered = [...ids].sort((a, b) => {
    const da = byId.get(a)?.date ?? recordById.get(a)?.date ?? "";
    const db = byId.get(b)?.date ?? recordById.get(b)?.date ?? "";
    return da.localeCompare(db) || a.localeCompare(b);
  });

  const ledgers = new Map<string, FairnessLedgerResponse | null | "failed">();
  const ledgerFor = async (month: string) => {
    if (!ledgers.has(month)) {
      try {
        ledgers.set(month, await deps.readLedger([month]));
      } catch {
        console.error("[availability-sweep] ledger read failed");
        ledgers.set(month, "failed");
      }
    }
    return ledgers.get(month)!;
  };

  for (const id of ordered) {
    if (deps.now() > options.deadlineMs - JUDGE_CUTOFF_MS) {
      report.skipped.push(id);
      continue;
    }
    const record = recordById.get(id) ?? null;
    const conflict = byId.get(id);
    let obs: Observation;
    if (!conflict) obs = { c: false };
    else if (!isEditable(j, conflict)) obs = { c: true, conflict, e: false };
    else {
      if (record?.status === "kept") continue;
      const stale = !record?.checkedAt || deps.now() - Date.parse(record.checkedAt) > RECHECK_MS;
      // On the tick, an unchanged open record is re-judged only when stale; a new one always. A
      // person's own trigger («Revisar ahora», the member's save) re-judges every one, and an
      // «unchecked» record is re-judged on any run (its service may have become editable).
      if (options.trigger === "cron" && record && (record.status === "proposed" || record.status === "none")
        && record.reason !== "unchecked" && !stale && record.published === conflict.published) {
        continue;
      }
      const ledger = await ledgerFor(conflict.date.slice(0, 7));
      if (ledger === "failed") {
        report.skipped.push(id);
        continue;
      }
      obs = { c: true, conflict, e: true, proposal: propose(j, conflict, ledger) };
    }
    const held = conflict ? heldRows(j.boards.get(conflict.date.slice(0, 7)), conflict.roleId, conflict.memberId) : [];
    const stale = !record?.checkedAt || deps.now() - Date.parse(record.checkedAt) > RECHECK_MS;
    const change = transition(record, obs, held, stale);
    if (!change) continue;
    const bucket = change.status === "proposed" ? report.proposed : change.status === "none" ? report.none : change.status === "gone" ? report.gone : report.kept;
    bucket.push(id);
    if (!act) continue;
    const nowIso = new Date(deps.now()).toISOString();
    try {
      if (!record) {
        await deps.create({
          _id: id,
          _type: CONFLICT_TYPE,
          roleId: conflict!.roleId,
          memberId: conflict!.memberId,
          date: conflict!.date,
          serviceKind: conflict!.roleType,
          published: conflict!.published,
          status: change.status,
          seats: change.seats,
          ...(change.reason ? { reason: change.reason } : {}),
          eventSeq: 1,
          notifiedSeq: 0,
          firstSeenAt: nowIso,
          updatedAt: nowIso,
          ...(change.checked ? { checkedAt: nowIso } : {}),
          trigger: options.trigger,
        });
      } else {
        await deps.patch(record._id, record._rev, {
          status: change.status,
          seats: change.seats,
          ...(change.reason ? { reason: change.reason } : {}),
          ...(change.published !== undefined ? { published: change.published } : {}),
          ...(change.event ? { eventSeq: record.eventSeq + 1 } : {}),
          updatedAt: nowIso,
          ...(change.checked ? { checkedAt: nowIso } : {}),
          trigger: options.trigger,
        }, change.reason ? ["appliedBy"] : ["reason", "appliedBy"]);
      }
    } catch (err) {
      // Another run moved it first (a lost guard): drop the step, the next run re-reads.
      if (!sanityConflictKind(err)) console.error("[availability-sweep] record write failed");
    }
  }

  report.emailed = await emailDue(j, options, deps);
  return report;
}

// ── The email step (§5.2 «per event», §6) ────────────────────────────────────

const ROW_LABEL: Record<string, string> = { lead: "Lead", bgv: "BGV", coro: "Coro" };
const seatLabel = (rowId: string) => ROW_LABEL[rowId] ?? rowId.replace(/^(instrumento|foh):/, "");

async function emailDue(j: Judgeable, options: { memberId?: string; deadlineMs: number; mode: "act" | "dry" }, deps: AvailabilityDeps): Promise<number> {
  if (options.mode !== "act" || deps.now() > options.deadlineMs - EMAIL_CUTOFF_MS) return 0;
  if (deps.deliveryBlocked()) return 0;
  let audience: AudienceMember[];
  let records: ConflictRecord[];
  try {
    audience = await deps.readAudience();
    records = await deps.readRecords(j.todayIso);
  } catch {
    console.error("[availability-sweep] email reads failed");
    return 0;
  }
  const due = records.filter((r) =>
    (r.status === "proposed" || r.status === "none") && r.notifiedSeq < r.eventSeq && (!options.memberId || r.memberId === options.memberId));
  const claimed: ConflictRecord[] = [];
  for (const r of due) {
    // A claim is a promise to send: stop claiming once the sends would not fit (the rest wait).
    if (deps.now() > options.deadlineMs - EMAIL_CUTOFF_MS) break;
    try {
      await deps.patch(r._id, r._rev, { notifiedSeq: r.eventSeq });
      claimed.push(r);
    } catch {
      // Claimed by another run, or moved: that run (or the next) emails it.
    }
  }
  if (!claimed.length) return 0;
  console.info(`[availability-sweep] claimed ${claimed.length}`);

  const members = new Map((j.sources.members as EditorMember[]).map((m) => [m._id, m.alias?.trim() || m.member_name]));
  const roles = new Map(j.sources.adminRoles.map((r) => [r._id, r]));
  const name = (id: string) => members.get(id) ?? "alguien que ya no está en la lista";
  const lines: ConflictEmailLine[] = claimed.map((r) => {
    const role = roles.get(r.roleId);
    return {
      person: name(r.memberId),
      service: serviceLabel({ date: r.date, roleType: r.serviceKind, serviceName: role?.service_name, serviceTime: role?.time ?? undefined }),
      published: r.published,
      seats: r.seats.map((s) => ({ seat: seatLabel(s.rowId), ...(s.to ? { to: name(s.to) } : {}) })),
      ...(r.status === "none" ? { reason: r.reason ?? "no_candidate" } : {}),
    };
  });
  const { subject, html } = buildConflictEmail(lines);
  const allow = getAllowlist();
  const redirectTo = process.env.EMAIL_REDIRECT_TO?.trim();
  let sent = 0;
  for (const m of audience) {
    const email = m.email?.trim().toLowerCase();
    if (!email || !isEmailAllowed(email, allow) || !wantsNotification(m.notifPrefs, "proposals")) continue;
    const res = await deps.send(redirectTo || email, redirectTo ? `[→ ${email}] ${subject}` : subject, html);
    if (res.ok) sent++;
    else console.error("[availability-sweep] email send failed");
  }
  return sent;
}

// ── Triggers (§5.4) ──────────────────────────────────────────────────────────

/** After a member's own availability save: sweep that member only when a date they serve on moved. */
export async function memberTick(
  input: { memberId: string; addedDates: readonly string[]; removedDates: readonly string[]; startedAt: number },
  deps: AvailabilityDeps = defaultAvailabilityDeps(),
): Promise<SweepReport | null> {
  if (sweepDisabled()) return null;
  const dates = [...new Set([...input.addedDates, ...input.removedDates])];
  if (!dates.length || !deps.hasToken()) return null;
  try {
    const seats = await deps.readSeats(`${ROLE_TYPES_FILTER} && coalesce(week, date) in $dates`, { dates });
    const records = (await deps.readRecords(deps.todayIso())).filter((r) => r.memberId === input.memberId);
    const added = new Set(input.addedDates);
    const removed = new Set(input.removedDates);
    const open = seats.some((s) => {
      if (!s.members.includes(input.memberId)) return false;
      const r = records.find((x) => x.roleId === s._id && x.date === s.date);
      if (added.has(s.date)) return !r || r.status === "gone" || r.status === "applied";
      if (removed.has(s.date)) return !!r && (r.status === "kept" || r.status === "proposed" || r.status === "none");
      return false;
    });
    if (!open) return null;
  } catch {
    console.error("[availability-sweep] member pre-check failed");
    return null;
  }
  return sweepAvailabilityConflicts(
    { trigger: "member", memberId: input.memberId, deadlineMs: input.startedAt + SWEEP_WINDOW_MS, mode: deps.acts() ? "act" : "dry" },
    deps,
  );
}

/** Whether the tick's cheap pre-check sees anything the full sweep would act on (§5.4). */
export function precheckOpens(input: {
  seats: ReadonlyArray<{ _id: string; date: string; members: string[] }>;
  unavailable: ReadonlyMap<string, ReadonlySet<string>>;
  records: readonly ConflictRecord[];
  nowMs: number;
}): boolean {
  const seen = new Set<string>();
  for (const s of input.seats) {
    for (const m of s.members) if (input.unavailable.get(m)?.has(s.date)) seen.add(conflictRecordId(s._id, m, s.date));
  }
  const byId = new Map(input.records.map((r) => [r._id, r]));
  for (const id of seen) {
    const r = byId.get(id);
    if (!r || r.status === "gone" || r.status === "applied") return true;
  }
  for (const r of input.records) {
    const open = r.status === "proposed" || r.status === "none";
    if ((open || r.status === "kept") && !seen.has(r._id)) return true;
    if (open && (!r.checkedAt || input.nowMs - Date.parse(r.checkedAt) > RECHECK_MS)) return true;
    if (open && r.notifiedSeq < r.eventSeq) return true;
  }
  return false;
}

/** Rides layer 1's 5-minute tick (`/api/cron/flush-notifications`), every third bucket. */
export async function availabilityTick(input: { startedAt: number }, deps: AvailabilityDeps = defaultAvailabilityDeps()): Promise<"disabled" | "skipped" | "clear" | "swept"> {
  if (sweepDisabled()) return "disabled";
  const now = deps.now();
  const deadlineMs = input.startedAt + SWEEP_WINDOW_MS;
  if (Math.floor(now / TICK_BUCKET_MS) % 3 !== 0 || deadlineMs - now < TICK_MIN_LEFT_MS || !deps.hasToken()) {
    console.info("[availability-sweep] tick skipped");
    return "skipped";
  }
  const todayIso = deps.todayIso();
  const months = horizonMonths(todayIso);
  const end = `${months[2]}-31`;
  try {
    const [seats, unavailable, records] = await Promise.all([
      deps.readSeats(`${ROLE_TYPES_FILTER} && coalesce(week, date) >= $today && coalesce(week, date) <= $end`, { today: todayIso, end }),
      deps.readUnavailable(),
      deps.readRecords(todayIso),
    ]);
    const opens = precheckOpens({
      seats,
      unavailable: new Map(unavailable.map((m) => [m._id, new Set(m.unavailableDates ?? [])])),
      records,
      nowMs: deps.now(),
    });
    if (!opens) {
      console.info("[availability-sweep] tick clear");
      return "clear";
    }
  } catch {
    console.error("[availability-sweep] tick pre-check failed");
    return "skipped";
  }
  await sweepAvailabilityConflicts({ trigger: "cron", deadlineMs, mode: deps.acts() ? "act" : "dry" }, deps);
  console.info("[availability-sweep] tick swept");
  return "swept";
}

// ── «Aplicar», «Mantener», «Deshacer» and the panel's read (§5.5, §7) ─────────

export type ClickOutcome = { ok: true; status: number; body: Record<string, unknown> } | { ok: false; status: number; body: Record<string, unknown> };

const refuse = (status: number, error: string, extra: Record<string, unknown> = {}): ClickOutcome => ({ ok: false, status, body: { error, ...extra } });

export async function applyAvailabilityFix(
  input: { roleId: string; rev: string; memberId: string; replacements: ReadonlyArray<{ rowId: string; to: string }>; actor: string },
  deps: AvailabilityDeps = defaultAvailabilityDeps(),
): Promise<ClickOutcome> {
  const read = await readJudgeable(deps);
  if (!read.ok) return refuse(409, "unjudgeable", { reason: read.reason });
  const j = read.value;
  const conflict = findRoleConflicts({ adminRoles: j.sources.adminRoles, members: j.sources.members as EditorMember[], todayIso: j.todayIso, memberId: input.memberId })
    .find((c) => c.roleId === input.roleId);
  if (!conflict) return refuse(409, "no_conflict");
  if (!isEditable(j, conflict)) return refuse(409, "not_editable");
  if (conflict.roleRev !== input.rev) return refuse(409, "stale_revision");
  const board = j.boards.get(conflict.date.slice(0, 7))!;
  const held = heldRows(board, input.roleId, input.memberId);
  const wanted = new Map(input.replacements.map((r) => [r.rowId, r.to]));
  if (wanted.size !== input.replacements.length || held.length !== wanted.size || !held.every((r) => wanted.has(r))) return refuse(400, "seats");
  let ledger: FairnessLedgerResponse;
  try {
    ledger = await deps.readLedger([conflict.date.slice(0, 7)]);
  } catch {
    return refuse(409, "unjudgeable", { reason: "sources" });
  }
  const proposal = propose(j, conflict, ledger, { only: wanted });
  if (proposal.kind !== "replace") return refuse(409, "refused", { reason: proposal.reason });
  const parsed = parseEditRequest({ ...proposal.target, rev: input.rev });
  if (!parsed.ok) return refuse(409, "refused", { reason: "parse" });
  const outcome = await deps.editRole(input.roleId, parsed.value, { notices: "deferred" });
  if (!outcome.ok) return { ok: false, status: outcome.status, body: outcome.body as Record<string, unknown> };

  // Bookkeeping only (§5.5 step 3): a lost write leaves the conflict to end as `gone` next sweep.
  const id = conflictRecordId(conflict.roleId, conflict.memberId, conflict.date);
  const record = j.records.find((r) => r._id === id) ?? null;
  const nowIso = new Date(deps.now()).toISOString();
  const seats = proposal.seats.map((s, i) => ({ _key: `s${i}`, rowId: s.rowId, from: s.from, to: s.to }));
  let recorded = true;
  try {
    if (record) await deps.patch(id, record._rev, { status: "applied", seats, appliedBy: input.actor, updatedAt: nowIso, trigger: "apply" }, ["reason"]);
    else {
      await deps.create({
        _id: id, _type: CONFLICT_TYPE, roleId: conflict.roleId, memberId: conflict.memberId, date: conflict.date, serviceKind: conflict.roleType,
        published: conflict.published, status: "applied", seats, eventSeq: 0, notifiedSeq: 0, firstSeenAt: nowIso, updatedAt: nowIso,
        appliedBy: input.actor, trigger: "apply",
      });
    }
  } catch {
    recorded = false;
    console.error("[availability-apply] record write failed");
  }
  return { ok: true, status: 200, body: { ok: true, recorded } };
}

/** «Mantener» (`kept`) or «Deshacer» (back to `none`, no event: the next sweep re-judges it). */
export async function setConflictKept(
  input: { roleId: string; memberId: string; date: string; serviceKind: ServiceRole["_type"]; published: boolean; rev?: string; kept: boolean; actor: string },
  deps: AvailabilityDeps = defaultAvailabilityDeps(),
): Promise<ClickOutcome> {
  if (!deps.hasToken()) return refuse(409, "unjudgeable", { reason: "no_token" });
  const id = conflictRecordId(input.roleId, input.memberId, input.date);
  let record: ConflictRecord | null;
  try {
    record = (await deps.readRecords(input.date)).find((r) => r._id === id) ?? null;
  } catch {
    return refuse(409, "unjudgeable", { reason: "sources" });
  }
  const nowIso = new Date(deps.now()).toISOString();
  try {
    if (!record) {
      if (!input.kept) return refuse(409, "no_record");
      await deps.create({
        _id: id, _type: CONFLICT_TYPE, roleId: input.roleId, memberId: input.memberId, date: input.date, serviceKind: input.serviceKind,
        published: input.published, status: "kept", seats: [], eventSeq: 0, notifiedSeq: 0, firstSeenAt: nowIso, updatedAt: nowIso, trigger: "keep",
      });
    } else {
      if (input.rev && input.rev !== record._rev) return refuse(409, "stale_revision");
      if (!input.kept && record.status !== "kept") return refuse(409, "not_kept");
      // «Deshacer» empties the old judgement (seats, reason) so nothing stale is ever mailed; the
      // epoch `checkedAt` makes the next sweep re-judge it.
      await deps.patch(id, record._rev, {
        status: input.kept ? "kept" : "none",
        updatedAt: nowIso,
        trigger: "keep",
        ...(input.kept ? {} : { seats: [], checkedAt: new Date(0).toISOString() }),
      }, input.kept ? [] : ["reason"]);
    }
  } catch (err) {
    if (sanityConflictKind(err)) return refuse(409, "stale_revision");
    throw err;
  }
  return { ok: true, status: 200, body: { ok: true } };
}

export interface PanelConflict {
  recordId: string;
  recordRev: string | null;
  roleId: string;
  roleRev: string;
  memberId: string;
  date: string;
  serviceKind: ServiceRole["_type"];
  published: boolean;
  service: string;
  person: string;
  /** The proposal on this read, then up to three alternatives (all or nothing each). */
  options: Array<{ seats: Array<{ rowId: string; seat: string; to: string; toName: string }> }>;
  /** When there is no proposal: why, and the seats the person holds. */
  none?: { reason: NoneReason; seats: Array<{ rowId: string; seat: string }> };
}

export interface PanelRead {
  ok: true;
  blocked: BlockedReason | null;
  open: PanelConflict[];
  applied: Array<{ recordId: string; date: string; person: string; service: string; seats: Array<{ seat: string; from: string; to: string }> }>;
  kept: Array<{ recordId: string; recordRev: string; roleId: string; memberId: string; date: string; serviceKind: ServiceRole["_type"]; published: boolean; person: string; service: string }>;
}

/** The panel's read (§7): open conflicts with proposals recomputed on THIS read. */
export async function readConflictPanel(deps: AvailabilityDeps = defaultAvailabilityDeps()): Promise<PanelRead | { ok: false; reason: BlockedReason }> {
  const read = await readJudgeable(deps);
  if (!read.ok) {
    if (read.reason === "no_token" || read.reason === "sources") return { ok: false, reason: read.reason };
    return { ok: true, blocked: read.reason, open: [], applied: [], kept: [] };
  }
  const j = read.value;
  // Many open voice conflicts can cost many month-check builds; past the budget the panel shows
  // first proposals only, then «sin revisar», rather than time out into «No se pudo revisar».
  const budgetEnd = deps.now() + PANEL_BUDGET_MS;
  const members = new Map((j.sources.members as EditorMember[]).map((m) => [m._id, m.alias?.trim() || m.member_name]));
  const name = (id: string) => members.get(id) ?? "alguien que ya no está en la lista";
  const roles = new Map(j.sources.adminRoles.map((r) => [r._id, r]));
  const label = (roleId: string, date: string, kind?: string) => {
    const role = roles.get(roleId);
    return serviceLabel({ date, roleType: role?._type ?? kind, serviceName: role?.service_name, serviceTime: role?.time ?? undefined });
  };
  const recordById = new Map(j.records.map((r) => [r._id, r]));
  const open: PanelConflict[] = [];
  const kept: PanelRead["kept"] = [];
  const ledgers = new Map<string, FairnessLedgerResponse | null>();
  for (const c of findRoleConflicts({ adminRoles: j.sources.adminRoles, members: j.sources.members as EditorMember[], todayIso: j.todayIso })) {
    const id = conflictRecordId(c.roleId, c.memberId, c.date);
    const record = recordById.get(id) ?? null;
    if (record?.status === "kept") {
      kept.push({
        recordId: id, recordRev: record._rev, roleId: c.roleId, memberId: c.memberId, date: c.date, serviceKind: c.roleType, published: c.published,
        person: name(c.memberId), service: label(c.roleId, c.date),
      });
      continue;
    }
    const board = j.boards.get(c.date.slice(0, 7));
    const held = heldRows(board, c.roleId, c.memberId);
    const base = {
      recordId: id, recordRev: record?._rev ?? null, roleId: c.roleId, roleRev: c.roleRev, memberId: c.memberId, date: c.date,
      serviceKind: c.roleType, published: c.published, service: label(c.roleId, c.date), person: name(c.memberId),
    };
    if (!isEditable(j, c) || deps.now() > budgetEnd) {
      open.push({ ...base, options: [], none: { reason: "unchecked", seats: held.map((rowId) => ({ rowId, seat: seatLabel(rowId) })) } });
      continue;
    }
    const month = c.date.slice(0, 7);
    if (!ledgers.has(month)) ledgers.set(month, await deps.readLedger([month]).catch(() => null));
    const ledger = ledgers.get(month)!;
    const options: PanelConflict["options"] = [];
    const exclude = new Set<string>();
    let first: Proposal | null = null;
    for (let k = 0; k < 4; k++) {
      if (k > 0 && deps.now() > budgetEnd) break;
      const p = propose(j, c, ledger, { exclude });
      first ??= p;
      if (p.kind !== "replace") break;
      options.push({ seats: p.seats.map((s) => ({ rowId: s.rowId, seat: seatLabel(s.rowId), to: s.to, toName: name(s.to) })) });
      for (const s of p.seats) exclude.add(s.to);
    }
    open.push({
      ...base,
      options,
      ...(first && first.kind === "none" ? { none: { reason: first.reason, seats: held.map((rowId) => ({ rowId, seat: seatLabel(rowId) })) } } : {}),
    });
  }
  const since = deps.now() - APPLIED_LIST_MS;
  const applied = j.records
    .filter((r) => r.status === "applied" && Date.parse(r.updatedAt) >= since)
    .map((r) => ({
      recordId: r._id, date: r.date, person: name(r.memberId), service: label(r.roleId, r.date, r.serviceKind),
      seats: r.seats.map((s) => ({ seat: seatLabel(s.rowId), from: name(s.from), to: s.to ? name(s.to) : "" })),
    }));
  return { ok: true, blocked: null, open, applied, kept };
}
