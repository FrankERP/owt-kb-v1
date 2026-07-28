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
import { sendEmail } from "./email";
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

/** Wall-clock bound on the send stage, inside the hosting route's maxDuration. */
export const SEND_BUDGET_MS = parsePositiveEnv(process.env.NOTIFY_SEND_BUDGET_MS, 40_000);

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

async function fetchRole(notice: StoredNotice): Promise<Record<string, unknown> | null> {
  if (!notice.roleId || !notice.roleType) return null;
  const row = await operationalClient.fetch<Record<string, unknown> | null>(ROLE_QUERY, {
    roleType: notice.roleType,
    roleId: notice.roleId,
  });
  return isObj(row) ? row : null;
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
async function consume(claimed: ClaimedNotice[]): Promise<number> {
  let consumed = 0;
  for (const c of claimed) {
    try {
      await writeClient
        .transaction()
        .patch(c.notice._id, (p) => p.ifRevisionId(c.claimRev).set({ status: "sending" }))
        .delete(c.notice._id)
        .commit();
      consumed++;
    } catch (err) {
      logError("notify_sweep_consume_failed", { id: c.notice._id }, err);
    }
  }
  return consumed;
}

// ── The pipeline ────────────────────────────────────────────────────────────

export async function sweepOutbox(opts: SweepOptions = {}): Promise<SweepReport> {
  const emailLimit = opts.emailLimit ?? EMAIL_LIMIT;
  const sendBudgetMs = opts.sendBudgetMs ?? SEND_BUDGET_MS;
  const startedAt = Date.now();
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
  for (const notice of selected) {
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
        continue;
      }
      claimed.push({ notice, claimRev });
    } catch (err) {
      logError("notify_sweep_claim_lost", { id: notice._id }, err);
    }
  }
  report.claimed = claimed.length;
  if (!claimed.length) return report;

  // From here EVERY claimed notice is consumed on every path — including a
  // throw — which is what `finally` is for.
  try {
    // ── 4. Classify ─────────────────────────────────────────────────────────
    const pairs: Pair[] = [];
    for (const c of claimed) {
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
    for (let i = 0; i < entries.length; i++) {
      // Bounded by wall clock. Without this bound, a sweep killed mid-fan-out
      // re-sends from the top on every lease expiry, forever.
      if (Date.now() - startedAt >= sendBudgetMs) {
        report.unserved = entries.length - i;
        log("notify_sweep_send_budget_exhausted", {
          unserved: report.unserved,
          emailed: report.emailed,
          sendBudgetMs,
        });
        break;
      }
      const [recipientId, lines] = entries[i];
      const m = byId.get(recipientId);
      const email = m?.email?.trim().toLowerCase();
      if (!m || !email || !isEmailAllowed(email, allow)) continue;
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
    }
  } catch (err) {
    logError("notify_sweep_failed", { claimed: claimed.length }, err);
  } finally {
    // ── 8. Consume ────────────────────────────────────────────────────────────
    report.consumed = await consume(claimed);
  }

  return report;
}
