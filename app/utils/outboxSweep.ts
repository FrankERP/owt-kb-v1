// app/utils/outboxSweep.ts
//
// THE sweep (spec §1, "One pipeline, stated once"). One control flow, eight
// stages, in this order and nowhere else:
//
//   1. gate      — refuse before touching the outbox when delivery is blocked
//   2. select    — due notices, bounded by the UNION of their recipients
//   3. claim     — one revision-asserting Patch.commit() per notice
//   4. classify  — the queue-time snapshot against live state
//   5. filter    — each line by the preference for its own kind
//   6. group     — one email per recipient, covering every line they own
//   7. send      — bounded by wall clock
//   8. consume   — every claimed notice, whatever each send returned
//
// Reads go through `operationalClient` (published perspective, read token);
// outbox writes go through `writeClient`. Nothing here mutates protected
// content — the sweep only reads role/setlist/proposal state.
//
// TWO PROPERTIES THAT LOOK LIKE DETAILS AND ARE NOT:
//
//   · Selection bounds the union of RECIPIENTS, not a count of notices. That is
//     what makes stage 8 safe: every claimed notice is fully discharged by
//     stage 7, so there is no partial state to represent and no per-recipient
//     progress to track. A notice whose own recipients exceed the budget is
//     taken ALONE rather than split, because splitting would reintroduce the
//     per-recipient ledger that "Claim and delete" shows is incompatible with
//     one document per subject.
//
//   · Consumption is UNCONDITIONAL on send outcome, and on classification
//     outcome, and on a throw. Delivery is best-effort with no retry (§1);
//     retrying would need delivery receipts, an attempt counter and a
//     dead-letter path, and half-building that is worse than not building it. A
//     member with a permanently-undeliverable address must never be able to hold
//     the outbox — and therefore the liveness alarm — red forever.

import "server-only";

import { operationalClient } from "@/sanity/lib/operationalClient";
import { writeClient } from "@/sanity/lib/serverClient";

import { getAllowlist, isEmailAllowed, rolesForMember } from "./assignmentEmail";
import { isDeliveryBlocked } from "./deliveryFirewall";
import { SEND_CONCURRENCY, SEND_TIMEOUT_MS, sendEmail } from "./email";
import { buildGroupedEmail } from "./notificationEmail";
import { wantsNotification } from "./notifyPrefs";
import { assignedMemberRefsQuery } from "./notifyTargets";
import {
  LINE_PREF,
  classifyLeadNotes,
  classifyRole,
  classifySetlist,
  type Line,
} from "./outboxClassify";
// A generic "positive number, or the fallback" env parser whose name records its
// first caller. Reused rather than re-implemented: it already rejects `""`,
// non-numeric and non-positive values, and has its own tests.
import {
  isDue,
  parseMinutesEnv as parsePositiveEnv,
  songRowsFrom,
  type NoticeKind,
  type OutboxSongRow,
} from "./outboxNotice";
import { normalizeStoredSeats, storedRoleDate } from "./roleWriteRequest";

const TIMEZONE = "America/Mexico_City";

/** Max DISTINCT RECIPIENTS per sweep — see §1: it must exceed the largest
 * per-service seat count, which for a Sunday on this team is 12–20. */
export const EMAIL_LIMIT = parsePositiveEnv(process.env.NOTIFY_FLUSH_EMAIL_LIMIT, 40);

/**
 * Wall-clock bound on the SEND STAGE, inside the hosting route's maxDuration.
 *
 * "Send stage" is literal: the clock starts immediately before the first
 * `sendEmail`, not at the top of the sweep. §1 states the budget as
 * `ms_per_send × EMAIL_LIMIT < SEND_BUDGET_MS`, and charging the read phase
 * (the due-notices fetch, one recipient round trip per candidate, one
 * `Patch.commit()` per claim, 2–3 reads per classification, the members read and
 * the titles read) against it would silently turn that into
 * `ms_per_send × EMAIL_LIMIT < SEND_BUDGET_MS − read_time`.
 */
export const SEND_BUDGET_MS = parsePositiveEnv(process.env.NOTIFY_SEND_BUDGET_MS, 40_000);

/**
 * Wall clock measured from the TOP of the sweep, past which stage 7 refuses to
 * start another send — the reserve that keeps stage 8 reachable.
 *
 * `SEND_BUDGET_MS` deliberately does not charge for the read phase, which is the
 * right call for the inequality in §1 and the wrong one for staying alive: reads
 * plus a full send budget can already reach the hosting route's `maxDuration = 60`
 * on their own, and a sweep killed there never consumes what it claimed. The
 * claims then outlive the process, the 5-minute lease re-offers exactly the same
 * batch, and the next sweep dies in the same place — the outbox stops making
 * progress permanently, which is how one slow evening on 2026-08-06 cost the team
 * a day of notifications.
 *
 * So this is not a second send budget; it is the promise that stage 8 runs. 15 s
 * of the route's 60 is what stage 8 needs for one `Patch.commit()` per claimed
 * notice at `EMAIL_LIMIT`-scale batches, plus the response.
 */
const SWEEP_DEADLINE_MS = 45_000;

/**
 * How many candidate notices one sweep looks at. `deferred` counts the due
 * notices left behind INSIDE this window; nothing accumulates in normal
 * operation, and §3's liveness alarm is what notices a backlog that does.
 */
const SCAN_LIMIT = 200;

export interface SweepReport {
  claimed: number;
  emailed: number;
  consumed: number;
  deferred: number;
  unserved: number;
}

export interface SweepOptions {
  emailLimit?: number;
  sendBudgetMs?: number;
}

type RoleTypeName = "sunday_role" | "saturday_role" | "special_role";

interface StoredNotice {
  _id: string;
  _rev: string;
  kind: NoticeKind;
  subjectKey: string;
  memberId: string | null;
  roleId: string | null;
  proposalId: string | null;
  serviceDate: string;
  roleType: RoleTypeName | null;
  before?: { beforeRoles?: string[]; beforeSongs?: OutboxSongRow[]; beforeNotes?: string } | null;
  knownRecipients?: string[] | null;
  firstQueuedAt: string;
  notifyAfter: string;
  deadline: string;
  status: "pending" | "sending";
  claimedAt: string | null;
}

interface ClaimedNotice {
  notice: StoredNotice;
  /** The revision the CLAIM returned — the one stage 8 asserts. */
  claimRev: string;
}

interface StoredMember {
  _id: string;
  email?: string;
  alias?: string;
  member_name?: string;
  notifPrefs?: unknown;
}

interface Pair {
  recipientId: string;
  line: Line;
}

// ── Queries ─────────────────────────────────────────────────────────────────

/**
 * A SUPERSET of due-ness, narrowed by `isDue` in memory. `status == "sending"`
 * is included wholesale because the lease clause is a time comparison against
 * `claimedAt + CLAIM_TTL`, and `isDue` is the single authority on it.
 */
const DUE_NOTICES_QUERY = `*[_type == "notificationOutbox" && (status == "sending" || notifyAfter <= $now || deadline <= $now)] | order(firstQueuedAt asc) [0...${SCAN_LIMIT}] {
  _id, _rev, kind, subjectKey, memberId, roleId, proposalId, serviceDate, roleType,
  before, knownRecipients, firstQueuedAt, notifyAfter, deadline, status, claimedAt
}`;

/**
 * §4: participants of THAT service, across all five member-referencing seats,
 * scoped to the notice's role type. `published != false` is carried at the
 * query per the member-facing-read invariant — not left to a later drop rule.
 */
const SETLIST_RECIPIENTS_QUERY = assignedMemberRefsQuery(
  "_type == $roleType && _id == $roleId && published != false",
);

/** The admin audience `proposalNotify.ts` already uses — deliberately identical. */
const ADMIN_RECIPIENTS_QUERY = `*[_type == "teamMembers" && role in ["super-admin","admin"]]._id`;

/** One projection for both role-shaped notices: seats for `role`, songs for a
 * special-service `setlist`, and the publication/date state both classify on. */
const ROLE_QUERY = `*[_type == $roleType && _id == $roleId][0]{
  _id, _type, published, week, date, Lead, BGVs, Chorus, instruments, foh_team, songs
}`;

const WEEKEND_SONGS_QUERY = `*[_type == $setlistType && week == $week][0].songs`;

const PROPOSAL_QUERY = `*[_type == "setlistProposal" && _id == $proposalId][0]{
  _id, status, lead_notes, service_date
}`;

const SONG_TITLES_QUERY = `*[_type == "post" && _id in $ids]{ _id, title }`;

const MEMBERS_QUERY = `*[_type == "teamMembers" && _id in $ids]{ _id, email, alias, member_name, notifPrefs }`;

const WEEKEND_SETLIST_TYPE: Record<string, string> = {
  sunday_role: "featuredSongs",
  saturday_role: "saturdarSongs",
};

/** A proposal that is still reviewable. `draft`, `approved` and a deleted
 * proposal all drop (§1). */
const REVIEWABLE_STATUSES = new Set(["pending", "changes_requested"]);

// ── Small helpers ───────────────────────────────────────────────────────────

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object";

function log(event: string, fields: Record<string, unknown> = {}): void {
  console.log(JSON.stringify({ event, ...fields }));
}

function logError(event: string, fields: Record<string, unknown>, err?: unknown): void {
  console.error(JSON.stringify({ event, ...fields }), err ?? "");
}

/**
 * Stored `beforeSongs` rows carry no `group` at all for a standalone song
 * (the schema field is a plain number), while `songRowsFrom` produces an
 * explicit `null`. Normalising here keeps the two comparable — `undefined`
 * would never equal `null` and every snapshot would read as changed.
 */
function normalizeSnapshotRows(rows: unknown): OutboxSongRow[] {
  if (!Array.isArray(rows)) return [];
  return rows.filter(isObj).map((r, i) => ({
    _key: typeof r._key === "string" ? r._key : `s${i}`,
    ref: typeof r.ref === "string" ? r.ref : "",
    key: typeof r.key === "string" ? r.key : "",
    group: typeof r.group === "number" ? r.group : null,
  }));
}

function unique(values: string[]): string[] {
  return [...new Set(values.filter(Boolean))];
}

// ── Stage 2a: recipients (a COUNT, before anything is claimed) ──────────────

async function resolveRecipients(notice: StoredNotice): Promise<string[]> {
  if (notice.kind === "role") return notice.memberId ? [notice.memberId] : [];
  if (notice.kind === "leadNotes") {
    const rows = await operationalClient.fetch<string[] | null>(ADMIN_RECIPIENTS_QUERY, {});
    return unique(rows ?? []);
  }
  if (!notice.roleId || !notice.roleType) return [];
  const rows = await operationalClient.fetch<string[] | null>(SETLIST_RECIPIENTS_QUERY, {
    roleType: notice.roleType,
    roleId: notice.roleId,
  });
  return unique(rows ?? []);
}

// ── Stage 4: classification against live state ──────────────────────────────

/**
 * Per-sweep memo for the subject read, reset at the top of every sweep.
 *
 * Notices are one per (member, subject), so a batch is naturally MANY notices
 * over FEW subjects: the 2026-08-06 backlog was 28 role notices across exactly
 * two Sunday services. Unmemoized that is 28 sequential round trips for two
 * documents, and it was the read phase — not the sends — that pushed the sweep
 * past its deadline once the batch grew.
 *
 * Every notice in one sweep therefore classifies against the subject as of the
 * first read of it, which is if anything more coherent than each notice reading
 * its own moment. Two overlapping sweeps in one warm instance can reset each
 * other's memo; the cost is a repeated read, never a wrong one.
 */
let roleReadCache = new Map<string, Record<string, unknown> | null>();

async function fetchRole(notice: StoredNotice): Promise<Record<string, unknown> | null> {
  if (!notice.roleId || !notice.roleType) return null;
  const key = `${notice.roleType}:${notice.roleId}`;
  const memo = roleReadCache.get(key);
  if (memo !== undefined) return memo;
  const row = await operationalClient.fetch<Record<string, unknown> | null>(ROLE_QUERY, {
    roleType: notice.roleType,
    roleId: notice.roleId,
  });
  const value = isObj(row) ? row : null;
  roleReadCache.set(key, value);
  return value;
}

async function classifyRoleNotice(notice: StoredNotice, today: string): Promise<Pair[]> {
  const memberId = notice.memberId;
  if (!memberId) return [];
  const role = await fetchRole(notice);
  const roleExists = !!role;
  const line = classifyRole({
    before: notice.before?.beforeRoles ?? [],
    after: role ? rolesForMember(memberId, normalizeStoredSeats(role)) : [],
    // Live state wins whenever the subject document exists; the queue-time
    // snapshot is the fallback for a role that is gone (§1).
    serviceDate: (role ? storedRoleDate(role) : null) ?? notice.serviceDate,
    roleType: notice.roleType,
    today,
    roleExists,
    // `published` is only a real reading while the document is there.
    // `classifyRole`'s unpublish guard is gated on `roleExists` precisely so
    // this value cannot decide a deleted role's fate — a vanished role still
    // owes its assignees "Ya no participas".
    published: role ? role.published !== false : true,
  });
  return line ? [{ recipientId: memberId, line }] : [];
}

async function liveSetlistRows(
  notice: StoredNotice,
  role: Record<string, unknown>,
): Promise<OutboxSongRow[]> {
  if (notice.roleType === "special_role") return songRowsFrom(role.songs);
  const setlistType = WEEKEND_SETLIST_TYPE[notice.roleType ?? ""];
  const week = storedRoleDate(role);
  if (!setlistType || !week) return [];
  const songs = await operationalClient.fetch<unknown>(WEEKEND_SONGS_QUERY, { setlistType, week });
  return songRowsFrom(songs);
}

async function classifySetlistNotice(notice: StoredNotice, today: string): Promise<Pair[]> {
  const role = await fetchRole(notice);
  // §4: a `setlist` notice whose role is gone is dropped, silently. Stated
  // rather than left to converge by accident on an empty audience.
  if (!role) return [];

  const liveDate = storedRoleDate(role);
  const after = await liveSetlistRows(notice, role);
  const common = {
    after,
    serviceDate: liveDate ?? notice.serviceDate,
    roleType: notice.roleType,
    today,
    roleExists: true,
    published: role.published !== false,
    // A date move invalidates the snapshot: `before.songs` was captured against
    // another week's setlist, so there is nothing truthful to say.
    dateMatches: liveDate === notice.serviceDate,
  };

  const changed = classifySetlist({ ...common, before: normalizeSnapshotRows(notice.before?.beforeSongs) });
  // Nothing changed for the subject → nothing to introduce anybody to either.
  if (!changed) return [];
  // A recipient absent from `knownRecipients` is new to the subject and is
  // INTRODUCED ("Setlist listo") rather than sent a diff against a list they
  // never saw. The `role` kind needs no equivalent (its snapshot is that one
  // member's own seats) and `leadNotes` renders no diff at all.
  const introduced = classifySetlist({ ...common, before: [] });
  const known = new Set(notice.knownRecipients ?? []);
  // The AUTHORITATIVE recipient set, re-read after the claim: a member added
  // five minutes after the setlist changed still gets the email (§1). Stage 2's
  // read was only a count, taken before anything was claimed.
  const recipients = await resolveRecipients(notice);
  return recipients.map((recipientId) => ({
    recipientId,
    line: known.has(recipientId) ? changed : (introduced ?? changed),
  }));
}

async function classifyLeadNotesNotice(notice: StoredNotice, today: string): Promise<Pair[]> {
  if (!notice.proposalId) return [];
  const row = await operationalClient.fetch<Record<string, unknown> | null>(PROPOSAL_QUERY, {
    proposalId: notice.proposalId,
  });
  const proposal = isObj(row) ? row : null;
  const liveDate = typeof proposal?.service_date === "string" ? proposal.service_date.slice(0, 10) : null;
  const line = classifyLeadNotes({
    before: notice.before?.beforeNotes ?? "",
    after: typeof proposal?.lead_notes === "string" ? proposal.lead_notes : "",
    serviceDate: liveDate ?? notice.serviceDate,
    today,
    reviewable: !!proposal && REVIEWABLE_STATUSES.has(String(proposal.status ?? "")),
  });
  if (!line) return [];
  const recipients = await resolveRecipients(notice);
  return recipients.map((recipientId) => ({ recipientId, line }));
}

function classifyNotice(notice: StoredNotice, today: string): Promise<Pair[]> {
  if (notice.kind === "role") return classifyRoleNotice(notice, today);
  if (notice.kind === "leadNotes") return classifyLeadNotesNotice(notice, today);
  return classifySetlistNotice(notice, today);
}

// ── Stage 8: consume ────────────────────────────────────────────────────────

/**
 * `delete()` takes no revision precondition — `ifRevisionId` is a `Patch`
 * method only — so the guard is a revision-asserting NO-OP patch in the same
 * transaction, asserting the revision the CLAIM returned. Same shape as the
 * guarded role delete (`app/api/admin/roles/[id]/route.ts:458`). A notice
 * re-pended by a writer during the send therefore fails to delete and survives
 * to be re-classified, which is the correct outcome.
 *
 * One transaction PER NOTICE: a batched transaction would roll the whole batch
 * back on one conflict.
 */
/**
 * How many consumes are in flight at once.
 *
 * Still one transaction per notice — each asserts its OWN claim revision, and a
 * batched transaction would abort the whole set on one conflict — but they no
 * longer wait in line. Sequentially, an `EMAIL_LIMIT`-scale batch is that many
 * round trips at the very end of the sweep, which is the least affordable moment
 * it could ask for them: on 2026-08-07 a 29-notice batch reached stage 8 with
 * ~12 s left and the function was killed partway through, leaving claims behind
 * for the lease to re-offer. Bounded rather than unbounded so a large batch
 * cannot open an arbitrary number of connections at once.
 */
const CONSUME_CONCURRENCY = 8;

/**
 * How many claims are in flight at once. Same shape and same reason as
 * `CONSUME_CONCURRENCY`, at the other end of the sweep — stage 3 pays one round
 * trip per notice too, and it pays them BEFORE any email is sent, so a serial
 * claim of a large batch consumes the budget that batch needed.
 */
const CLAIM_CONCURRENCY = 8;

async function consume(claimed: ClaimedNotice[]): Promise<number> {
  let consumed = 0;
  const consumeOne = async (c: ClaimedNotice): Promise<void> => {
    try {
      await writeClient
        .transaction()
        .patch(c.notice._id, (p) => p.ifRevisionId(c.claimRev).set({ status: "sending" }))
        .delete(c.notice._id)
        .commit();
      consumed++;
    } catch (err) {
      // Unchanged contract: one failed consume costs only its own notice, which
      // the lease re-offers. It must never abort the rest of the batch.
      logError("notify_sweep_consume_failed", { id: c.notice._id }, err);
    }
  };
  for (let i = 0; i < claimed.length; i += CONSUME_CONCURRENCY) {
    await Promise.all(claimed.slice(i, i + CONSUME_CONCURRENCY).map(consumeOne));
  }
  return consumed;
}

// ── The pipeline ────────────────────────────────────────────────────────────

export async function sweepOutbox(opts: SweepOptions = {}): Promise<SweepReport> {
  const emailLimit = opts.emailLimit ?? EMAIL_LIMIT;
  const sendBudgetMs = opts.sendBudgetMs ?? SEND_BUDGET_MS;
  /** Whole-sweep wall clock — for the completion log only, never for the budget. */
  const sweepStartedAt = Date.now();
  /** Stage-7 wall clock, set where stage 7 begins; `null` if it never ran. */
  let sendMs: number | null = null;
  // Scoped to THIS sweep: stage 4 must classify against state read now, not
  // against whatever a previous invocation of this warm instance saw.
  roleReadCache = new Map();
  const report: SweepReport = { claimed: 0, emailed: 0, consumed: 0, deferred: 0, unserved: 0 };

  // ── 1. Gate ───────────────────────────────────────────────────────────────
  // BEFORE anything is claimed, and before the outbox is even read. A
  // verification run must not mail the team, and `sendEmail` returns the same
  // `{ok:false}` for a firewall block, missing configuration and a genuine SMTP
  // failure alike — so it is useless for deciding whether to consume.
  if (isDeliveryBlocked()) {
    log("notify_sweep_blocked", { reason: "delivery_blocked" });
    return report;
  }

  const now = new Date();
  // Server "today" as a CALENDAR day in America/Mexico_City. A naive UTC
  // comparison would drop every notice for today's service from 18:00 local on.
  const today = now.toLocaleDateString("sv", { timeZone: TIMEZONE });

  // ── 2. Select ─────────────────────────────────────────────────────────────
  const candidates = await operationalClient.fetch<StoredNotice[] | null>(DUE_NOTICES_QUERY, {
    now: now.toISOString(),
  });
  const due = (candidates ?? []).filter((n) => isDue(n, now));

  const selected: StoredNotice[] = [];
  const union = new Set<string>();
  for (let i = 0; i < due.length; i++) {
    // The sweep clock reaches stage 2 as well. `resolveRecipients` is one serial
    // round trip per candidate for setlist and leadNotes notices, up to
    // SCAN_LIMIT of them, and nothing here was bounded: a large batch of those
    // could spend the whole sweep SELECTING and leave stage 8 to be killed —
    // the original wedge, through a path stage 7's two clocks never see.
    // Breaking here is entirely safe: nothing has been claimed yet, so the
    // remainder simply stays pending for the next sweep.
    if (Date.now() - sweepStartedAt >= SWEEP_DEADLINE_MS) {
      report.deferred = due.length - i;
      log("notify_sweep_select_deadline", { deferred: report.deferred, selected: selected.length });
      break;
    }
    const notice = due[i];
    const recipients = await resolveRecipients(notice);
    if (!selected.length && recipients.length > emailLimit) {
      // Oversized: taken ALONE, deliberately exceeding the budget. Splitting one
      // notice's recipients across sweeps would reintroduce per-recipient
      // progress, which one document per subject cannot represent.
      selected.push(notice);
      report.deferred = due.length - 1;
      break;
    }
    const next = new Set(union);
    for (const r of recipients) next.add(r);
    if (next.size > emailLimit) {
      report.deferred = due.length - i;
      break;
    }
    selected.push(notice);
    for (const r of recipients) union.add(r);
  }
  if (report.deferred > 0) {
    // Silent truncation is not acceptable (§1).
    log("notify_sweep_deferred", {
      deferred: report.deferred,
      selected: selected.length,
      emailLimit,
    });
  }
  if (!selected.length) return report;

  // ── 3. Claim ──────────────────────────────────────────────────────────────
  // A patch commit, NOT a transaction: `Transaction.commit()` resolves to a
  // MultipleMutationResult carrying no `_rev`, while `Patch.commit()` returns
  // the patched document — and stage 8 asserts the revision this returns.
  // One commit per notice, because a batched transaction would abort the whole
  // sweep on one conflict; the intended behaviour is that a failed claim drops
  // only that notice (another sweeper has it, or a writer just re-pended it).
  const claimed: ClaimedNotice[] = [];
  // IN WAVES, for the same reason stage 8 is: one round trip per notice, taken
  // serially, is a cost that scales with the batch and is paid BEFORE a single
  // email is sent. A monthly role publish is the large-batch case by design —
  // and on 2026-08-08 a 27-notice claim took 27.7 s of a 45 s sweep, so stage 7
  // was refused its first wave and the whole batch was consumed with
  // `emailed: 0`. The sweep spent its life taking ownership of work it then had
  // no time to do.
  //
  // Still one `Patch.commit()` per notice, each asserting its OWN revision: a
  // batched transaction would abort every claim on one conflict, and a lost
  // claim is supposed to cost only its own notice.
  const claimOne = async (notice: StoredNotice): Promise<ClaimedNotice | null> => {
    try {
      const patched = await writeClient
        .patch(notice._id)
        .ifRevisionId(notice._rev)
        .set({ status: "sending", claimedAt: now.toISOString() })
        .commit();
      const claimRev = typeof patched?._rev === "string" ? patched._rev : null;
      if (!claimRev) {
        // Nothing to assert later, so this notice cannot be consumed safely.
        // Drop it and let the lease expiry re-offer it.
        logError("notify_sweep_claim_unrevisioned", { id: notice._id });
        return null;
      }
      return { notice, claimRev };
    } catch (err) {
      logError("notify_sweep_claim_lost", { id: notice._id }, err);
      return null;
    }
  };
  const claimStartedAt = Date.now();
  for (let i = 0; i < selected.length; i += CLAIM_CONCURRENCY) {
    const wave = await Promise.all(selected.slice(i, i + CLAIM_CONCURRENCY).map(claimOne));
    // `map` preserves order, so classification and therefore the line order
    // inside each grouped email are unchanged by the waves.
    for (const c of wave) if (c) claimed.push(c);
  }
  const claimMs = Date.now() - claimStartedAt;
  report.claimed = claimed.length;
  if (!claimed.length) return report;

  // From here EVERY claimed notice is consumed on every path — including a
  // throw — which is what `finally` is for.
  try {
    // ── 4. Classify ─────────────────────────────────────────────────────────
    const pairs: Pair[] = [];
    for (const c of claimed) {
      // Bounded for the same reason stage 2 is, and it matters MORE here because
      // these notices are already claimed: overrunning means the function dies
      // before stage 8 and the lease has to re-offer them. Stopping early only
      // costs the tail its classification — those notices are still consumed
      // below, which is the standing best-effort contract, not a new loss.
      if (Date.now() - sweepStartedAt >= SWEEP_DEADLINE_MS) {
        log("notify_sweep_classify_deadline", { classified: pairs.length, claimed: claimed.length });
        break;
      }
      try {
        pairs.push(...(await classifyNotice(c.notice, today)));
      } catch (err) {
        // One unreadable subject must not cost the rest of the batch its email.
        logError("notify_sweep_classify_failed", { id: c.notice._id }, err);
      }
    }
    if (!pairs.length) return report;

    const memberIds = unique(pairs.map((p) => p.recipientId));
    const memberRows = await operationalClient.fetch<StoredMember[] | null>(MEMBERS_QUERY, {
      ids: memberIds,
    });
    const byId = new Map((memberRows ?? []).map((m) => [m._id, m]));

    // ── 5. Filter, ── 6. Group ──────────────────────────────────────────────
    const grouped = new Map<string, Line[]>();
    for (const { recipientId, line } of pairs) {
      const m = byId.get(recipientId);
      if (!m) continue;
      // The single per-type resolver — nothing reads `notifPrefs` directly.
      if (!wantsNotification(m.notifPrefs, LINE_PREF[line.kind])) continue;
      const lines = grouped.get(recipientId);
      if (lines) lines.push(line);
      else grouped.set(recipientId, [line]);
    }
    if (!grouped.size) return report;

    // Departed songs' refs exist only in `before`, so titles come from the
    // UNION of before- and after-refs, in one query. A song deleted in the
    // interim simply yields no title and its row renders with the ref.
    const refs = unique(
      [...grouped.values()].flat().flatMap((l) => [
        ...(l.songs ?? []).map((s) => s.ref),
        ...(l.beforeSongs ?? []).map((s) => s.ref),
      ]),
    );
    const titles = new Map<string, string>();
    if (refs.length) {
      const rows = await operationalClient.fetch<{ _id: string; title?: string }[] | null>(
        SONG_TITLES_QUERY,
        { ids: refs },
      );
      for (const row of rows ?? []) if (row?._id && row.title) titles.set(row._id, row.title);
    }

    // ── 7. Send ─────────────────────────────────────────────────────────────
    const allow = getAllowlist();
    const redirectTo = process.env.EMAIL_REDIRECT_TO?.trim();
    const entries = [...grouped.entries()];
    // THE BUDGET CLOCK STARTS HERE, not at the top of the sweep. Everything
    // above this line is read time, and stage 8 consumes UNCONDITIONALLY: a
    // batch that overran a budget already half-spent on reads would lose the
    // tail of its recipient list permanently and silently — on exactly the
    // 12–20-seat Sunday services `EMAIL_LIMIT = 40` exists to protect. With the
    // clock here, §1's inequality means what §1 says it means.
    const sendStartedAt = Date.now();
    // IN FLIGHT TOGETHER, in waves of SEND_CONCURRENCY. The probe on 2026-08-07
    // measured setup at ~0.4 s against ~13 s for a whole send, so the cost is in
    // the message and serial sends simply cannot serve a Sunday inside a 60 s
    // function: one email went out and sixteen people were dropped, because
    // stage 8 consumes whether or not stage 7 reached them. The clocks are checked
    // per WAVE rather than per recipient — a wave is the smallest unit that can
    // now be abandoned, and checking mid-wave would abandon sends already sent.
    const sendOne = async (recipientId: string, lines: Line[]): Promise<void> => {
      const m = byId.get(recipientId);
      const email = m?.email?.trim().toLowerCase();
      if (!m || !email || !isEmailAllowed(email, allow)) return;
      const { subject, html } = buildGroupedEmail(
        { name: m.alias || m.member_name || "", lines },
        titles,
      );
      const res = await sendEmail({
        to: redirectTo || email,
        subject: redirectTo ? `[→ ${email}] ${subject}` : subject,
        html,
      });
      if (res.ok) report.emailed++;
      else logError("notify_sweep_send_failed", { memberId: recipientId, error: res.error });
    };

    for (let i = 0; i < entries.length; i += SEND_CONCURRENCY) {
      // Bounded by wall clock, on TWO clocks. The stage clock is §1's budget;
      // the sweep clock is the reserve that keeps stage 8 reachable no matter how
      // long the read phase took. Whichever trips first ends the stage — and
      // stopping early costs one batch its tail, while overrunning costs the
      // outbox its ability to make progress at all.
      //
      // ADMISSION, not just expiry: a wave is admitted only if its WORST CASE
      // fits in what is left. Testing `elapsed >= deadline` asks whether the
      // deadline has already passed, which lets a wave start at 44 s and run to
      // 59 s — measured at 57 888 ms on 2026-08-07, past the 45 s reserve and
      // into the platform's kill, so stage 8 never ran and the batch was
      // re-offered to the next sweep. Every send is bounded by SEND_TIMEOUT_MS,
      // so that IS the worst case and the reserve can actually be reserved.
      const budgetSpent = Date.now() - sendStartedAt + SEND_TIMEOUT_MS > sendBudgetMs;
      const deadlineHit = Date.now() - sweepStartedAt + SEND_TIMEOUT_MS > SWEEP_DEADLINE_MS;
      if (budgetSpent || deadlineHit) {
        report.unserved = entries.length - i;
        log("notify_sweep_send_budget_exhausted", {
          unserved: report.unserved,
          emailed: report.emailed,
          sendBudgetMs,
          // WHICH bound stopped the stage. `sweep_deadline` means the read phase
          // is crowding out the sends and the budget is no longer the real limit.
          stoppedBy: budgetSpent ? "send_budget" : "sweep_deadline",
          elapsedMs: Date.now() - sweepStartedAt,
        });
        break;
      }
      // `sendEmail` never rejects, so one bad recipient cannot reject the wave
      // and cost its siblings their sends.
      await Promise.all(
        entries.slice(i, i + SEND_CONCURRENCY).map(([recipientId, lines]) => sendOne(recipientId, lines)),
      );
    }
    sendMs = Date.now() - sendStartedAt;
  } catch (err) {
    logError("notify_sweep_failed", { claimed: claimed.length }, err);
  } finally {
    // ── 8. Consume ────────────────────────────────────────────────────────────
    report.consumed = await consume(claimed);
    // §1's inequality rests on `ms_per_send`, and nobody has ever measured one.
    // This line is what turns it from an assumption into an observed production
    // number: `sendMs` is stage 7 alone, so `msPerSend` is exactly the quantity
    // the release gate asks for, while `elapsedMs − sendMs` is the read time the
    // budget deliberately no longer charges for. It is the smallest change that
    // gives silent notification loss a number someone can look at.
    log("notify_sweep_done", {
      ...report,
      elapsedMs: Date.now() - sweepStartedAt,
      sendMs,
      // Stage 3's own cost, broken out because it is the one phase that scales
      // with the batch and is paid before anything is sent. A sweep that reports
      // `emailed: 0` with a large `claimMs` did not fail to send — it never got
      // to try, which reads identically in every other field.
      claimMs,
      msPerSend: sendMs !== null && report.emailed > 0 ? Math.round(sendMs / report.emailed) : null,
      emailLimit,
      sendBudgetMs,
    });
  }

  return report;
}
