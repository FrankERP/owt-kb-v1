// How `ProposalsPanel` ORDERS and WINDOWS its already-loaded proposals.
//
// Both decisions are pure and live here so the panel renders a list it does not
// compute, and so the rules are provable without a DOM. Release 1 is entirely
// client-side: `/api/admin/proposals` still returns the whole history and this
// module decides what the admin sees of it.
//
// Two rules, both deliberate:
//
//  - ORDER. The status buckets keep their existing order, but inside a bucket
//    `approved` reads NEWEST-FIRST (it is an archive; the useful row is the last
//    setlist published, not the first one ever) while every other status reads
//    SOONEST-FIRST (it is a work queue; the next service to review comes first).
//    The `_id` tie-break keeps the order stable for two proposals on one date.
//
//  - WINDOW. Only `approved` and `draft` are windowed by date. `pending` and
//    `changes_requested` are the actionable queue and are NEVER hidden — hiding
//    one would contradict the pending-count badge on the tab and strand the
//    reviewer in front of a list that says there is nothing to do.

import { isValidServiceDate } from "@/app/utils/serviceReadModel";

import { type ProposalReviewStatus } from "./proposalHandoff";
import { serviceTodayIso } from "./serviceReadiness";

/** The minimum a row needs for ordering and windowing. */
export interface ProposalListItem {
  _id: string;
  status: ProposalReviewStatus;
  service_date: string;
}

/** Bucket order of the status tabs — unchanged by Release 1. */
export const PROPOSAL_STATUS_ORDER: readonly ProposalReviewStatus[] = [
  "pending",
  "changes_requested",
  "approved",
  "draft",
];

/** Statuses that are history rather than queue, and therefore date-windowed. */
export const WINDOWED_STATUSES: readonly ProposalReviewStatus[] = ["approved", "draft"];

/** Months a single `Ver 3 meses más` press adds to the window. */
export const WIDEN_STEP_MONTHS = 3;

export function isWindowedStatus(status: string | null | undefined): boolean {
  return (WINDOWED_STATUSES as readonly string[]).includes(status ?? "");
}

// ── Order ────────────────────────────────────────────────────────────────────

function bucketIndex(status: ProposalReviewStatus): number {
  const i = PROPOSAL_STATUS_ORDER.indexOf(status);
  // An unknown status sorts last instead of first (`indexOf` returns -1).
  return i === -1 ? PROPOSAL_STATUS_ORDER.length : i;
}

/**
 * Bucket by status, then by `service_date` — DESCENDING inside `approved`,
 * ASCENDING everywhere else — then by `_id` so the order never depends on the
 * order the API happened to return.
 */
export function compareProposals(a: ProposalListItem, b: ProposalListItem): number {
  const bucket = bucketIndex(a.status) - bucketIndex(b.status);
  if (bucket !== 0) return bucket;
  const byDate = (a.service_date ?? "").localeCompare(b.service_date ?? "");
  if (byDate !== 0) return a.status === "approved" ? -byDate : byDate;
  // Codepoint order, NOT `localeCompare`: a collator is locale-sensitive and may
  // call two distinct ids equal, which would hand the tie back to API order —
  // the exact instability this tie-break exists to remove.
  const ida = a._id ?? "";
  const idb = b._id ?? "";
  return ida < idb ? -1 : ida > idb ? 1 : 0;
}

/** A sorted COPY — the caller's array (React state) is never mutated. */
export function sortProposals<T extends ProposalListItem>(items: readonly T[]): T[] {
  return [...items].sort(compareProposals);
}

// ── Window ───────────────────────────────────────────────────────────────────

/** Shift a `YYYY-MM` month by `delta` months, crossing years correctly. */
function shiftMonth(ym: string, delta: number): string {
  const [y, m] = ym.split("-").map(Number);
  const total = y * 12 + (m - 1) + delta;
  const year = Math.floor(total / 12);
  const month = total - year * 12 + 1;
  return `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}`;
}

/**
 * The oldest month the window shows, as `YYYY-MM`. Step 0 is the current month
 * in the app timezone; each step reaches back another `WIDEN_STEP_MONTHS`.
 */
export function windowStartMonth(todayIso: string, steps: number): string {
  const today = isValidServiceDate(todayIso?.slice(0, 10) ?? "")
    ? todayIso.slice(0, 10)
    : serviceTodayIso();
  const back = Math.max(0, Math.trunc(steps || 0)) * WIDEN_STEP_MONTHS;
  return shiftMonth(today.slice(0, 7), -back);
}

/**
 * Is this row inside the window? Queue statuses always are; a row with an
 * unusable date always is too (a bad date is an integrity issue to be seen, not
 * hidden), and history is in when its month is not older than the window start.
 */
export function isWithinWindow(
  item: ProposalListItem,
  todayIso: string,
  steps: number,
): boolean {
  if (!isWindowedStatus(item?.status)) return true;
  const day = typeof item?.service_date === "string" ? item.service_date.slice(0, 10) : "";
  if (!isValidServiceDate(day)) return true;
  return day.slice(0, 7) >= windowStartMonth(todayIso, steps);
}

export interface ProposalWindow<T extends ProposalListItem> {
  /** The rows to render, in the caller's incoming order. */
  visible: T[];
  /** How many rows the window is hiding right now. */
  hiddenCount: number;
  /** True when there is older history left to reveal. */
  canWiden: boolean;
  /**
   * The step count the widen button must jump to so the press REVEALS AT LEAST
   * ONE ROW — the smallest window containing the newest hidden row.
   *
   * A fixed `steps + 1` reads as a broken button whenever history has a gap
   * bigger than one step: today `2027-06-15` with one hidden row on
   * `2026-07-05` leaves presses 1, 2 and 3 changing nothing at all — same
   * label, same count, same list. In the common case (the newest hidden row is
   * inside the next step) this IS `steps + 1`, so the 3-month feel is unchanged.
   * Equal to `steps` when nothing is hidden, where the button is not rendered.
   */
  stepsToShowMore: number;
}

/** Split an already-sorted, already-filtered list into shown and hidden. */
export function applyProposalWindow<T extends ProposalListItem>(
  items: readonly T[],
  todayIso: string,
  steps: number,
): ProposalWindow<T> {
  const current = Math.max(0, Math.trunc(steps || 0));
  const visible: T[] = [];
  let hiddenCount = 0;
  let stepsToShowMore = current;
  for (const item of items ?? []) {
    if (isWithinWindow(item, todayIso, current)) {
      visible.push(item);
      continue;
    }
    hiddenCount += 1;
    // A hidden row always needs at least one more step (see `stepsToReveal`),
    // so the smallest of them is the nearest window that shows something new.
    const needed = stepsToReveal(todayIso, current, item.service_date);
    if (hiddenCount === 1 || needed < stepsToShowMore) stepsToShowMore = needed;
  }
  return { visible, hiddenCount, canWiden: hiddenCount > 0, stepsToShowMore };
}

// ── Widening to include a handoff target ─────────────────────────────────────

/**
 * Smallest step count whose window contains `dateIso`, never below `steps`.
 * Shared with `applyProposalWindow` above, which uses it to size a widen press.
 */
function stepsToReveal(todayIso: string, steps: number, dateIso: string): number {
  const current = Math.max(0, Math.trunc(steps || 0));
  const day = typeof dateIso === "string" ? dateIso.slice(0, 10) : "";
  if (!isValidServiceDate(day)) return current;
  const start = windowStartMonth(todayIso, current);
  if (day.slice(0, 7) >= start) return current;
  const [sy, sm] = start.split("-").map(Number);
  const [ty, tm] = day.slice(0, 7).split("-").map(Number);
  const monthsBack = sy * 12 + sm - (ty * 12 + tm);
  return current + Math.ceil(monthsBack / WIDEN_STEP_MONTHS);
}

/**
 * Widen the window far enough to render every handoff target.
 *
 * A service card hands the admin a specific proposal id; the handoff only
 * adjusts the STATUS filter, so an approved/draft target older than the window
 * would be consumed while its card was never rendered — a silent no-op with a
 * highlight nobody can see. The panel calls this on every focus.
 */
export function widenStepsForTargets(
  todayIso: string,
  steps: number,
  items: readonly ProposalListItem[],
  targetIds: readonly string[],
): number {
  const wanted = new Set((targetIds ?? []).filter(Boolean));
  let next = Math.max(0, Math.trunc(steps || 0));
  if (wanted.size === 0) return next;
  for (const item of items ?? []) {
    if (!wanted.has(item?._id)) continue;
    if (!isWindowedStatus(item?.status)) continue;
    next = Math.max(next, stepsToReveal(todayIso, next, item.service_date));
  }
  return next;
}
