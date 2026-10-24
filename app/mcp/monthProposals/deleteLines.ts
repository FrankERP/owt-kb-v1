// The pure half of the MCP delete (admin parity phase 2:
// docs/superpowers/plans/2026-10-24-owt-mcp-admin-parity-f2-deletes.md, T2 and D7): which stored
// services a check offers to delete, the ONE line each one is shown with, and how a delete's outcome
// is classified.
//
// THE LINE is a function of the stored role alone (the canonical shape `loadRoleForWrite` reads: raw
// `_ref`s, `week` or `date`), so `check_service_deletes` and `delete_services` render it from the same
// kind of read and compare byte for byte (NFC). It says what the delete does: a draft is silent; a
// published service tells its people «Ya no participas», and the line counts them with the notice
// builder's own functions (`seatAssignees(normalizeStoredSeats(role))`, as `serviceParticipants`), so
// the number in the prompt and the notice audience are one set. «hasta»: at flush a member who turned
// that email off, or whose document is gone, is dropped (`outboxSweep.ts`).
//
// A draft is `published === false` ONLY; absent means visible (`clearMonthModel.ts` `isDraftRole`).

import { normalizeStoredSeats, seatAssignees, storedRoleDate } from "@/app/utils/roleWriteRequest";
import { validateRole } from "@/app/utils/serviceReadModel";
import type { DependencyRef } from "@/app/utils/serviceMutation";
import type { RoleDependencyInventory } from "@/app/utils/roleDependencies";
import type { StoredRole } from "@/app/utils/roleWriteOps";
import { byDateThenType, isDraftRole } from "@/app/components/admin/clearMonthModel";
import { V3_STORED_EDITOR_LINES } from "@/app/components/admin/v3Copy";
import { draftLabel } from "./labels";

const D = V3_STORED_EDITOR_LINES.delete;

/** At most this many services in one delete (as `MAX_CHANGES`). */
export const MAX_DELETES = 31;

export interface DeleteEntry {
  service: string;
  baseRev: string;
  line: string;
}

export interface KeptService {
  label: string;
  reason: string;
}

/** A role with its stored service date (`week` for a weekend role, `date` for a special). */
export interface DatedRole {
  role: StoredRole;
  date: string;
}

const nfc = (s: string) => s.normalize("NFC");

export function datedRole(role: StoredRole): DatedRole | null {
  const date = storedRoleDate(role);
  return date ? { role, date } : null;
}

const sortKey = (d: DatedRole) => ({ date: d.date, _type: d.role._type, service_name: d.role.service_name });
export const byDatedRole = (a: DatedRole, b: DatedRole) => byDateThenType(sortKey(a), sortKey(b));

/** The service's name in words («sábado 7 nov», «Noche de alabanza 18 nov»). */
export function deleteLabel(d: DatedRole): string {
  return draftLabel({ _type: d.role._type, date: d.date, service_name: d.role.service_name });
}

/** How many people a published delete notifies at most: the notice builder's own audience. */
export function noticeAudience(role: StoredRole): string[] {
  return seatAssignees(normalizeStoredSeats(role));
}

/** The line a check shows and a save re-renders. Null when the role has no usable date. */
export function deleteLine(role: StoredRole): string | null {
  const d = datedRole(role);
  if (!d) return null;
  const special = role._type === "special_role" ? D.special : "";
  const state = isDraftRole(role) ? D.draft : D.published(noticeAudience(role).length);
  return nfc(`${deleteLabel(d)}${special}${state}`);
}

export const sameLine = (given: string, expected: string) => nfc(given) === nfc(expected);

/** The list a token is minted over: each line NFC, only the three fields, in the check's order. */
export function canonicalDeleteList(deletes: readonly DeleteEntry[]): DeleteEntry[] {
  return deletes.map((d) => ({ service: d.service, baseRev: d.baseRev, line: nfc(d.line) }));
}

// ── Selection (the check) ────────────────────────────────────────────────────

export interface ScreenInput {
  /** The ids asked about: the month's (admin read) or the `services` the call named. */
  ids: readonly string[];
  /** `loadRolesForDelete`'s canonical rows for `ids`. */
  roles: readonly StoredRole[];
  /** `loadRolesForDelete`'s raw `drafts.` overlay ids. */
  overlayIds: readonly string[];
  month: string;
  todayIso: string;
  /** Drafts only, or every service. Ignored when `explicit` (a named service is selected). */
  include: "drafts" | "all";
  explicit: boolean;
}

export interface ScreenResult {
  /** Services that pass every check but the dependency inventory, date order. */
  candidates: DatedRole[];
  kept: Array<KeptService & { order: DatedRole | null }>;
  /** Drafts-only mode: the month's published services, counted, not listed. */
  publishedSkipped: number;
}

/**
 * Everything a check decides before the dependency inventory: a role the writer would refuse
 * (`loadRoleForWrite`: duplicated, under a Studio draft, invalid, dateless) is kept with its reason,
 * as is a past one (D5, `/admin` only) and one of another month.
 */
export function screenDeleteCandidates(input: ScreenInput): ScreenResult {
  const byId = new Map<string, StoredRole[]>();
  for (const r of input.roles) byId.set(r._id, [...(byId.get(r._id) ?? []), r]);
  const overlays = new Set(input.overlayIds);
  const candidates: DatedRole[] = [];
  const kept: ScreenResult["kept"] = [];
  let publishedSkipped = 0;
  const keep = (label: string, reason: string, order: DatedRole | null) => kept.push({ label, reason, order });

  for (const id of [...new Set(input.ids)]) {
    const rows = byId.get(id) ?? [];
    if (!rows.length) {
      keep(D.unknownService, D.kept.not_found, null);
      continue;
    }
    const d = datedRole(rows[0]);
    if (!d) {
      keep(D.unknownService, D.kept.invalid, null);
      continue;
    }
    const label = deleteLabel(d);
    if (d.date.slice(0, 7) !== input.month) {
      keep(label, D.kept.not_in_month, d);
      continue;
    }
    const past = d.date < input.todayIso;
    if (!input.explicit && input.include === "drafts" && !isDraftRole(d.role)) {
      // Counted only when asking for published ones too could delete it; a past one never can.
      if (!past) publishedSkipped += 1;
      continue;
    }
    const validation = validateRole(d.role);
    if (rows.length > 1) keep(label, D.kept.duplicate, d);
    else if (overlays.has(`drafts.${id}`)) keep(label, D.kept.studio_draft, d);
    else if (!validation.groupable || !validation.targetKey) keep(label, D.kept.invalid, d);
    else if (past) keep(label, D.kept.past, d);
    else candidates.push(d);
  }
  candidates.sort(byDatedRole);
  return { candidates, kept, publishedSkipped };
}

function dependencyWords(deps: readonly DependencyRef[]): string[] {
  const words = new Set<string>();
  for (const dep of deps) {
    if (dep.kind === "canonical_setlist" || dep.kind === "raw_setlist_draft") words.add(D.dependency.setlist);
    else if (dep.kind === "special_songs") words.add(D.dependency.songs);
    else if (dep.kind === "unknown_reference") words.add(D.dependency.reference);
    else words.add(D.dependency.proposal);
  }
  return [...words];
}

export interface SelectionResult {
  deletable: DeleteEntry[];
  kept: KeptService[];
  publishedSkipped: number;
  /** Deletable services past `MAX_DELETES`, left for the next check. */
  overflow: number;
}

/**
 * The check's answer from the screen and each candidate's inventory (`"failed"`: unreadable). A
 * dependency keeps the service, as the writer would refuse it (`role_has_dependencies`, never a
 * cascade); an unusable inventory keeps it too (the writer answers `integrity_conflict`).
 */
export function finishDeleteSelection(
  screen: ScreenResult,
  inventories: ReadonlyMap<string, RoleDependencyInventory | "failed">,
): SelectionResult {
  const kept = [...screen.kept];
  const deletable: Array<DeleteEntry & { order: DatedRole }> = [];
  for (const d of screen.candidates) {
    const label = deleteLabel(d);
    const inv = inventories.get(d.role._id) ?? "failed";
    if (inv === "failed" || !inv.usable) {
      kept.push({ label, reason: D.kept.inventory, order: d });
      continue;
    }
    if (inv.hasDependencies) {
      kept.push({ label, reason: D.hasDependencies(dependencyWords(inv.dependencies)), order: d });
      continue;
    }
    const line = deleteLine(d.role);
    if (!line) kept.push({ label, reason: D.kept.invalid, order: d });
    else deletable.push({ service: d.role._id, baseRev: d.role._rev, line, order: d });
  }
  deletable.sort((a, b) => byDatedRole(a.order, b.order));
  kept.sort((a, b) => (a.order && b.order ? byDatedRole(a.order, b.order) : a.order ? -1 : b.order ? 1 : 0));
  return {
    deletable: deletable.slice(0, MAX_DELETES).map(({ service, baseRev, line }) => ({ service, baseRev, line })),
    kept: kept.map(({ label, reason }) => ({ label, reason })),
    publishedSkipped: screen.publishedSkipped,
    overflow: Math.max(0, deletable.length - MAX_DELETES),
  };
}

// ── Outcomes (D7) ────────────────────────────────────────────────────────────

/**
 * Refusals the delete writer returns BEFORE its transaction: nothing was deleted. The planner's
 * `PROVEN_PREWRITE_FAILURES` (`plannerSaveModel.ts`) minus `not_found` (handled apart: a strict
 * re-read decides), plus the delete's own dependency code, plus `bootstrap_completed_reload` (a lock
 * maintenance write landed, the delete did not).
 */
const PROVEN_DELETE_REFUSALS: ReadonlySet<string> = new Set([
  "invalid_request",
  "forbidden",
  "integrity_conflict",
  "ambiguous_target",
  "dependency_conflict",
  "stale_revision",
  "role_has_dependencies",
  "bootstrap_completed_reload",
]);

export type DeleteOutcome =
  | { kind: "deleted" }
  | { kind: "notFound" }
  | { kind: "refused"; code: string }
  | { kind: "unknown" };

/** `null` = a throw or a lost race. A 5xx, `bootstrap_outcome_unknown` or any unlisted code is unknown. */
export function classifyDeleteOutcome(outcome: { ok: boolean; status: number; body: unknown } | null): DeleteOutcome {
  if (!outcome) return { kind: "unknown" };
  if (outcome.ok && outcome.status >= 200 && outcome.status < 300) return { kind: "deleted" };
  if (outcome.status >= 500) return { kind: "unknown" };
  const body = outcome.body;
  const code = body !== null && typeof body === "object" && typeof (body as { error?: unknown }).error === "string" ? (body as { error: string }).error : null;
  if (code === "not_found") return { kind: "notFound" };
  if (code && PROVEN_DELETE_REFUSALS.has(code)) return { kind: "refused", code };
  return { kind: "unknown" };
}
