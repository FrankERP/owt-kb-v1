// app/components/admin/v3Confirm.ts — solver v3 C6 §5.11 (CRITICAL), the pure half of the confirm.
//
// What a v3 confirm writes (CF-1): ONE record entry for EVERY horizon month, in the shape its
// snapshot state calls for (§4), then the drafts. The entries are frozen from the run's snapshot
// (CF-2) and never change across retries; the set is never shrunk.
//   · bound            → the record's own content (IF2-3 without names), its rev, source "auto";
//                        the content hash excludes every stamp, so the decision is `unchanged`.
//   · recorded, unbound→ the frozen screen body under the record's rev as read; `replaced`/`unchanged`.
//   · unrecorded, anchored or not (A27) → a CREATE, expectedRev null; `created`/`unchanged`.
// Every attempt first runs the guard (CF-1): a horizon month before the client's CDMX month (A40) or
// past C2's ceiling (HZ-9) refuses before anything is written, with no «Reintentar».
// The PUT's answer (CF-4) lets the drafts start only on a 200 whose every month has an outcome its
// shape expects; any refusal or unexpected outcome creates no draft. Copy is keyed on IF2-6's union.

import {
  FAIRNESS_PUT_REFUSALS, type FairnessMonthWrite, type FairnessPutRefusal,
} from "@/app/utils/fairnessVocabulary";
import { horizonRefusal } from "./v3Horizon";
import { V3_CONFIRM_REFUSAL, V3_LINES } from "./v3Copy";
import type { MonthSource, MonthState } from "./v3MonthSources";

export type ConfirmOutcome = "created" | "replaced" | "unchanged";

export interface V3ConfirmEntry {
  month: string;
  state: MonthState;
  write: FairnessMonthWrite;
  expects: readonly ConfirmOutcome[];
}

function deepFreeze<T>(value: T): T {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const v of Object.values(value as Record<string, unknown>)) deepFreeze(v);
  }
  return value;
}

/** CF-2/CF-3: frozen once, from the snapshot's sources (or the no-Auto path's fresh read). */
export function freezeConfirmEntries(sources: readonly MonthSource[], source: "auto" | "manual"): V3ConfirmEntry[] {
  return sources.map((s) => {
    const body = structuredClone({ month: s.body.month, people: s.body.people, presence: s.body.presence });
    if (s.state === "bound") {
      return deepFreeze({ month: s.month, state: s.state, write: { ...body, source: "auto" as const, expectedRev: s.rev }, expects: ["unchanged"] as const });
    }
    if (s.state === "recorded_unbound") {
      return deepFreeze({ month: s.month, state: s.state, write: { ...body, source, expectedRev: s.rev }, expects: ["replaced", "unchanged"] as const });
    }
    return deepFreeze({ month: s.month, state: s.state, write: { ...body, source, expectedRev: null }, expects: ["created", "unchanged"] as const });
  });
}

export type V3ConfirmGuard = { kind: "past"; month: string } | { kind: "ceiling"; month: string; limit: string } | null;

/** CF-1: the same past/ceiling rule as Auto (HZ-7, HZ-9), on the client's clock at THIS attempt. */
export function confirmGuard(months: readonly string[], currentMonth: string): V3ConfirmGuard {
  return horizonRefusal(months, currentMonth);
}

export function guardLine(guard: NonNullable<V3ConfirmGuard>, draftsCreatedThisConfirm: boolean): string {
  if (guard.kind === "ceiling") return V3_LINES.horizonCeiling(guard.month, guard.limit);
  return draftsCreatedThisConfirm ? V3_LINES.pastAfterDrafts(guard.month) : V3_CONFIRM_REFUSAL.past_month(guard.month);
}

export type PutAnswer = { kind: "threw" } | { kind: "http"; status: number; body: unknown };

export type RecordVerdict =
  | { ok: true }
  | { ok: false; kind: "refusal"; detail: FairnessPutRefusal; month: string }
  | { ok: false; kind: "other" };

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

export function classifyRecordPut(entries: readonly V3ConfirmEntry[], answer: PutAnswer): RecordVerdict {
  if (answer.kind === "threw") return { ok: false, kind: "other" };
  const body = answer.body;
  if (answer.status === 200) {
    const months = isObject(body) && Array.isArray(body.months) ? body.months : null;
    if (!months) return { ok: false, kind: "other" };
    for (const entry of entries) {
      const got = months.find((m) => isObject(m) && m.month === entry.month);
      if (!isObject(got) || !(entry.expects as readonly unknown[]).includes(got.outcome)) return { ok: false, kind: "other" };
    }
    return { ok: true };
  }
  if (answer.status === 409 && isObject(body) && isObject(body.details)) {
    const detail = body.details.detail;
    if (typeof detail === "string" && (FAIRNESS_PUT_REFUSALS as readonly string[]).includes(detail)) {
      const verdicts = Array.isArray(body.details.months) ? body.details.months : [];
      const named = verdicts.find((m) => isObject(m) && m.verdict === detail);
      const month = isObject(named) && typeof named.month === "string" ? named.month : entries[0]?.month ?? "";
      return { ok: false, kind: "refusal", detail: detail as FairnessPutRefusal, month };
    }
  }
  return { ok: false, kind: "other" };
}

/** CF-4: a 400, a network error, a 5xx, an unparseable body or an unexpected outcome → «Reintentar»; a refusal never. */
export function recordRetryOffered(v: RecordVerdict): boolean {
  return !v.ok && v.kind === "other";
}

export function recordVerdictLine(v: Exclude<RecordVerdict, { ok: true }>): string {
  return v.kind === "other" ? V3_LINES.recordOtherFailure : V3_CONFIRM_REFUSAL[v.detail](v.month);
}

/** CF-5: drafts grouped by horizon month, oldest first within each. */
export function draftsByMonth<T extends { date: string }>(drafts: readonly T[], months: readonly string[]): Array<{ month: string; drafts: T[] }> {
  return months.map((month) => ({
    month,
    drafts: drafts.filter((d) => d.date.slice(0, 7) === month).sort((a, b) => a.date.localeCompare(b.date)),
  }));
}

export interface MonthProgress {
  month: string;
  total: number;
  created: number;
  failed: number;
  attempted: boolean;
  /** A draft of this month was refused 409 (its target was taken meanwhile). */
  conflict: boolean;
}

/** CF-6, §7.8: one line per month. */
export function monthReportLines(progress: readonly MonthProgress[]): string[] {
  return progress.map((p, i) => {
    if (!p.attempted) return V3_LINES.monthNotAttempted(p.month, progress[i - 1]?.month ?? p.month);
    const line = p.created < p.total
      ? V3_LINES.monthPartial(p.month, p.created, p.total, p.failed)
      : V3_LINES.monthComplete(p.month, p.created, p.total);
    return p.conflict ? `${line} ${V3_LINES.draftConflict}` : line;
  });
}

/** CF-8: «{Mes1}: {a} · {Mes2}: {b}. Se crean como borradores; publícalos después.» */
export function twoMonthSummaryLine(groups: ReadonlyArray<{ month: string; drafts: readonly unknown[] }>): string {
  return V3_LINES.twoMonthSummary(groups[0].month, groups[0].drafts.length, groups[1].month, groups[1].drafts.length);
}
