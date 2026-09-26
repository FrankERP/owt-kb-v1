import "server-only";

// app/utils/solverHistoryEvidence.ts
//
// R11's diff evidence for the derived solver history
// (spec `docs/superpowers/specs/2026-09-23-solver-history-derivation-design.md`,
// "R11 — the diff gate's evidence"; plan
// `docs/superpowers/plans/2026-09-25-owt-mcp-p2-solver-history.md`, step 3).
//
// Pure — no client, no I/O: `solverHistoryRead.ts` does the reads and hands the
// rows here. It is `server-only` because every fingerprint comparison runs on
// the SERVER, through `roleCreationReceipt.ts` (`node:crypto`): a second
// implementation anywhere else would drift (spec R11). Its result types live in
// the neutral `solverHistoryTypes.ts`, so the diff CLI can read them.
//
// What it proves, per window document:
//  - `unchangedAs`: the create payload rebuilt from the STORED fields reproduces
//    the creation fingerprint under `published` true or false (plan D7) — the
//    stored seats are what was created. The positive control in
//    `solverHistoryEvidence.test.ts` round-trips the real create path, so a
//    rebuild defect cannot read every document as changed.
//  - `emptySeatCreate`: the receipt records an all-empty create, stored mode's
//    «+ Nuevo servicio».
//  - `contributes`: what the document fed into `entries`, through the
//    derivation's own `roleSeatContributions` (ruling P2-R1) — so the evidence
//    and the entries cannot count by different rules.

import { payloadFingerprint, type RoleCreatePayload } from "./roleCreationReceipt";
import { storedRoleDate } from "./roleWriteRequest";
import { indexUniqueByKey, serviceDayKey } from "./serviceReadSelect";
import {
  historyWindow,
  indexMembersById,
  roleSeatContributions,
  type DerivedSolverHistory,
  type SolverHistoryMember,
  type SolverHistoryTarget,
  type WeekendRoleType,
} from "./solverHistory";
import type {
  SolverHistoryDocumentEvidence,
  SolverHistoryEvidence,
  SolverHistoryOutOfWindowReceipt,
  SolverHistoryReceiptLink,
  SolverHistoryReceiptState,
  SolverHistoryUnchangedAs,
} from "./solverHistoryTypes";

function isObj(v: unknown): v is Record<string, unknown> {
  return !!v && typeof v === "object";
}

function nonEmptyString(v: unknown): v is string {
  return typeof v === "string" && v.length > 0;
}

function stringOrNull(v: unknown): string | null {
  return typeof v === "string" ? v : null;
}

/** An explicit check, never a table lookup (`"constructor" in {}` is true). */
function isWeekendRoleType(v: unknown): v is WeekendRoleType {
  return v === "sunday_role" || v === "saturday_role";
}

/** Codepoint order, never `localeCompare`: the output must not depend on the host's locale. */
function compareStrings(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

function receiptState(v: unknown): SolverHistoryReceiptState | null {
  return v === "committed" || v === "role_deleted" ? v : null;
}

/** A weekend receipt's immutable `targetIdentity` (`sunday_role:YYYY-MM-DD`) as type and day. */
function weekendTarget(targetIdentity: unknown): { type: WeekendRoleType; day: string } | null {
  if (typeof targetIdentity !== "string") return null;
  const colon = targetIdentity.indexOf(":");
  if (colon < 0) return null;
  const type = targetIdentity.slice(0, colon);
  const rest = targetIdentity.slice(colon + 1);
  const day = serviceDayKey(rest);
  return isWeekendRoleType(type) && day === rest ? { type, day } : null;
}

/** `true` when `day`'s calendar month is one of the target's three window months. */
function inWindow(windowKeys: ReadonlySet<string>, day: string): boolean {
  return windowKeys.has(`${Number(day.slice(0, 4))}-${Number(day.slice(5, 7))}`);
}

function windowKeysOf(target: SolverHistoryTarget): Set<string> {
  return new Set(historyWindow(target).map((w) => w.key));
}

// ─── The rebuild ─────────────────────────────────────────────────────────────

function seatRefs(seat: unknown): string[] {
  if (!Array.isArray(seat)) return [];
  const out: string[] = [];
  for (const item of seat) if (isObj(item) && nonEmptyString(item._ref)) out.push(item._ref);
  return out;
}

/** `instruments[]{instrument, person._ref}` / `foh_team[]{role, person._ref}` → the create body's `{label, personId}`. */
function labelledSeats(seat: unknown, label: "instrument" | "role"): Record<string, unknown>[] {
  if (!Array.isArray(seat)) return [];
  const out: Record<string, unknown>[] = [];
  for (const item of seat) {
    if (!isObj(item)) continue;
    out.push({ [label]: item[label], personId: isObj(item.person) ? item.person._ref : undefined });
  }
  return out;
}

const present = (v: unknown) => v !== undefined && v !== null;

/**
 * The create payload a stored role document corresponds to — the shape
 * `draftCreateBody` posts — rebuilt from a `ROLE_PROJECTION` row under the
 * given creation-time `published` value: `buildRoleDocument` read backwards.
 *
 * Stored order is kept (the fingerprint sorts), labels are passed through (the
 * fingerprint normalizes them, and they were stored normalized), and
 * `service_name`/`time`/`format` are carried only when present — a weekend role
 * never has them, and the fingerprint ignores them on one anyway.
 */
export function storedRoleCreatePayload(role: unknown, published: boolean): RoleCreatePayload {
  const r = isObj(role) ? role : {};
  const payload: RoleCreatePayload = {
    _type: r._type,
    date: storedRoleDate(r),
    leads: seatRefs(r.Lead),
    bgvs: seatRefs(r.BGVs),
    chorus: seatRefs(r.Chorus),
    instruments: labelledSeats(r.instruments, "instrument"),
    foh: labelledSeats(r.foh_team, "role"),
    published,
  };
  if (present(r.service_name)) payload.service_name = r.service_name;
  if (present(r.time)) payload.time = r.time;
  if (present(r.format)) payload.format = r.format;
  return payload;
}

/** Which creation-time `published` value, if either, reproduces `fingerprint` (plan D7). */
function unchangedAsFor(role: unknown, fingerprint: string | null): SolverHistoryUnchangedAs | null {
  if (!fingerprint) return null;
  if (payloadFingerprint(storedRoleCreatePayload(role, true)) === fingerprint) return "published";
  if (payloadFingerprint(storedRoleCreatePayload(role, false)) === fingerprint) return "draft";
  return null;
}

/** The receipt records an all-empty create for its own target, under either `published` value. */
function isEmptySeatCreate(receipt: Record<string, unknown>): boolean {
  const target = weekendTarget(receipt.targetIdentity);
  if (!target || !nonEmptyString(receipt.fingerprint)) return false;
  return [true, false].some(
    (published) =>
      payloadFingerprint({
        _type: target.type,
        date: target.day,
        leads: [],
        bgvs: [],
        chorus: [],
        instruments: [],
        foh: [],
        published,
      }) === receipt.fingerprint,
  );
}

// ─── One document ────────────────────────────────────────────────────────────

/**
 * R11's evidence for ONE weekend role document (a `ROLE_PROJECTION` row).
 *
 * `receipts` are the receipts whose own `roleId` names this role — the
 * authoritative reverse link. One of them is the document's receipt when it is
 * the id the document records (`creationReceiptId`), or when it is the only one
 * and the document records none. Anything else is ambiguous and matches none:
 * never an arbitrary pick.
 *
 * `duplicateTarget` comes from the derivation's own diagnostics. A duplicate
 * copy, or a document with no valid day, is `excluded` and `contributes`
 * nothing, because it fed nothing into `entries` — so for every month the
 * documents' `contributes` sum to exactly that month's entry.
 *
 * Returns null for a row that is not a weekend role document with an id.
 */
export function documentEvidence(
  role: unknown,
  receipts: readonly unknown[],
  context: { membersById: ReadonlyMap<string, SolverHistoryMember>; duplicateTarget: boolean },
): SolverHistoryDocumentEvidence | null {
  if (!isObj(role) || !isWeekendRoleType(role._type) || !nonEmptyString(role._id)) return null;
  const roleId = role._id;
  const day = serviceDayKey(role.week);
  const stampId = nonEmptyString(role.creationReceiptId) ? role.creationReceiptId : null;
  const stampFingerprint = nonEmptyString(role.creationFingerprint) ? role.creationFingerprint : null;

  const naming = receipts.filter(
    (r): r is Record<string, unknown> & { _id: string } => isObj(r) && r.roleId === roleId && nonEmptyString(r._id),
  );
  const found = stampId ? naming.find((r) => r._id === stampId) : naming.length === 1 ? naming[0] : undefined;

  let receipt: SolverHistoryReceiptLink;
  if (found) {
    receipt = {
      status: "found",
      receiptId: found._id,
      state: receiptState(found.state),
      targetDay: weekendTarget(found.targetIdentity)?.day ?? null,
      createdAt: stringOrNull(found.createdAt),
    };
  } else if (stampId || stampFingerprint || naming.length > 0) {
    receipt = { status: "not_found", receiptId: stampId };
  } else {
    receipt = { status: "unstamped" };
  }

  const excluded = context.duplicateTarget ? "duplicate_target" : day === null ? "invalid_date" : null;

  return {
    roleId,
    type: role._type,
    day,
    publishedRaw: typeof role.published === "boolean" ? role.published : null,
    receipt,
    unchangedAs: unchangedAsFor(role, found ? stringOrNull(found.fingerprint) : stampFingerprint),
    emptySeatCreate: found ? isEmptySeatCreate(found) : false,
    excluded,
    contributes: excluded ? {} : roleSeatContributions(role, context.membersById).role_counts,
  };
}

// ─── The window's documents and the receipts that left it ────────────────────

/**
 * The weekend role rows that are window documents: a real (non-`drafts.`) id,
 * and a day in one of the three window months — or no valid day at all, which
 * the bounded read can still return (`2026-09-31` sorts inside the range). The
 * derivation drops those; the evidence keeps them, `excluded`, so their
 * receipts link to them rather than reading as deleted.
 */
function windowDocuments(target: SolverHistoryTarget, roles: readonly unknown[]): Record<string, unknown>[] {
  const keys = windowKeysOf(target);
  return roles.filter((role): role is Record<string, unknown> => {
    if (!isObj(role) || !isWeekendRoleType(role._type)) return false;
    if (!nonEmptyString(role._id) || role._id.startsWith("drafts.")) return false;
    const day = serviceDayKey(role.week);
    return day === null || inWindow(keys, day);
  });
}

/** Receipts whose target day is in the window while their role is not a window document. */
function receiptsLeftWindow(
  target: SolverHistoryTarget,
  windowIds: ReadonlySet<string>,
  receipts: readonly unknown[],
): { receipt: Record<string, unknown> & { _id: string }; type: WeekendRoleType; day: string; roleId: string | null }[] {
  const keys = windowKeysOf(target);
  const out: { receipt: Record<string, unknown> & { _id: string }; type: WeekendRoleType; day: string; roleId: string | null }[] = [];
  for (const receipt of receipts) {
    if (!isObj(receipt) || !nonEmptyString(receipt._id)) continue;
    const t = weekendTarget(receipt.targetIdentity);
    if (!t || !inWindow(keys, t.day)) continue;
    const roleId = nonEmptyString(receipt.roleId) ? receipt.roleId : null;
    if (roleId && windowIds.has(roleId)) continue;
    out.push({ receipt: receipt as Record<string, unknown> & { _id: string }, type: t.type, day: t.day, roleId });
  }
  return out;
}

/**
 * The role ids whose CURRENT documents the loader must look up (with
 * `canonicalRolesByIdsQuery`) for the "moved out of the month" arm: the roles
 * of receipts that target the window but are not window documents. Sorted,
 * unique; empty when there is nothing to look up.
 */
export function outOfWindowReceiptRoleIds(input: {
  target: SolverHistoryTarget;
  roles: readonly unknown[];
  receipts: readonly unknown[];
}): string[] {
  const windowIds = new Set(windowDocuments(input.target, input.roles).map((r) => r._id as string));
  const ids = new Set<string>();
  for (const { roleId } of receiptsLeftWindow(input.target, windowIds, input.receipts)) if (roleId) ids.add(roleId);
  return [...ids].sort(compareStrings);
}

// ─── The whole evidence ──────────────────────────────────────────────────────

/**
 * The evidence `loadSolverHistory` returns with `{ evidence: true }`: every
 * window document's evidence, the in-window receipts whose role left the window
 * (or was deleted), every member's current name, and the positive control's
 * match rate. `lookedUpRoles` are the current documents read for
 * `outOfWindowReceiptRoleIds`; a role missing from them no longer exists.
 * Every list is sorted, so the output does not depend on input order.
 */
export function buildSolverHistoryEvidence(input: {
  target: SolverHistoryTarget;
  roles: readonly unknown[];
  members: readonly SolverHistoryMember[];
  receipts: readonly unknown[];
  lookedUpRoles: readonly unknown[];
  derived: DerivedSolverHistory;
}): SolverHistoryEvidence {
  const membersById = indexMembersById(input.members);
  const duplicateIds = new Set(input.derived.diagnostics.duplicateTargets.flatMap((d) => d.roleIds));

  const receiptsByRoleId = new Map<string, unknown[]>();
  for (const receipt of input.receipts) {
    if (!isObj(receipt) || !nonEmptyString(receipt.roleId)) continue;
    const list = receiptsByRoleId.get(receipt.roleId);
    if (list) list.push(receipt);
    else receiptsByRoleId.set(receipt.roleId, [receipt]);
  }

  const windowRows = windowDocuments(input.target, input.roles);
  const documents = windowRows
    .map((role) =>
      documentEvidence(role, receiptsByRoleId.get(role._id as string) ?? [], {
        membersById,
        duplicateTarget: duplicateIds.has(role._id as string),
      }),
    )
    .filter((d): d is SolverHistoryDocumentEvidence => d !== null)
    .sort(
      (a, b) =>
        compareStrings(a.day ?? "", b.day ?? "") || compareStrings(a.type, b.type) || compareStrings(a.roleId, b.roleId),
    );

  // Fail closed on the lookup too: an id answered twice is no answer.
  const current = indexUniqueByKey(
    input.lookedUpRoles.filter(isObj),
    (r) => (nonEmptyString(r._id) ? r._id : null),
  );
  const windowIds = new Set(windowRows.map((r) => r._id as string));
  const outOfWindowReceipts: SolverHistoryOutOfWindowReceipt[] = receiptsLeftWindow(
    input.target,
    windowIds,
    input.receipts,
  )
    .map(({ receipt, type, day, roleId }) => {
      const now = roleId ? current.get(roleId) : undefined;
      return {
        receiptId: receipt._id,
        state: receiptState(receipt.state),
        type,
        targetDay: day,
        createdAt: stringOrNull(receipt.createdAt),
        roleId,
        roleFound: now !== undefined,
        roleCurrentDay: now ? storedRoleDate(now) : null,
      };
    })
    .sort(
      (a, b) =>
        compareStrings(a.targetDay, b.targetDay) || compareStrings(a.type, b.type) || compareStrings(a.receiptId, b.receiptId),
    );

  const members = [...membersById.values()]
    .map((m) => ({ id: m._id, name: typeof m.member_name === "string" ? m.member_name : null }))
    .sort((a, b) => compareStrings(a.id, b.id));

  const withReceipt = documents.filter((d) => d.receipt.status === "found");
  return {
    documents,
    outOfWindowReceipts,
    members,
    control: {
      withReceipt: withReceipt.length,
      unchanged: withReceipt.filter((d) => d.unchangedAs !== null).length,
    },
  };
}
