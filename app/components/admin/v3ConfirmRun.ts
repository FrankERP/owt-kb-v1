// app/components/admin/v3ConfirmRun.ts — solver v3 C6 §5.11 (CRITICAL), ONE confirm attempt.
//
// Transports are injected (the component passes `fetch`-based ones; tests pass fakes); no global
// `fetch` is called here. Each attempt, in order:
//   1. the guard (CF-1, A40, HZ-9) on the client's CDMX month AT THIS ATTEMPT — a horizon month that
//      became past, or one past C2's ceiling, refuses before anything is written; no «Reintentar»; so
//      does a draft outside the horizon months;
//   2. the records (CF-4): every month's frozen entry in ONE `PUT /api/admin/fairness/months`
//      (all-or-nothing, C2 WR-9), resent byte-identical until it lands, never after (CF-7). A replay
//      of a PUT that did land answers `unchanged` by C2's decision order (WR-8 row 1);
//   3. the drafts (CF-5): oldest first, month by month, each with its stable `creationRequestId`
//      through today's `runDraftCreateBatch`; a month starts only if every creatable draft of the
//      earlier months was created;
//   4. the report (CF-6): one line per month; nothing is deleted or rewritten to compensate.
// Only confirmed successes enter `createdLocalIds` (today's invariant, CF-6).

import type { FairnessMonthsPut } from "@/app/utils/fairnessVocabulary";
import { runDraftCreateBatch, type CreatableDraft, type DraftPostOutcome, type draftCreateBody } from "@/app/utils/monthDraftCreate";
import {
  classifyRecordPut, confirmGuard, draftsByMonth, guardLine, monthReportLines, recordRetryOffered, recordVerdictLine,
  type MonthProgress, type PutAnswer, type V3ConfirmEntry,
} from "./v3Confirm";
import { V3_LINES } from "./v3Copy";

export interface V3ConfirmState {
  /** The PUT landed (an expected outcome for every month) — it is never sent again in this confirm. */
  recordsDone: boolean;
  /** Drafts this confirm's attempts confirmed created (HTTP ok, replays included). */
  createdLocalIds: ReadonlySet<string>;
}

export const INITIAL_V3_CONFIRM_STATE: V3ConfirmState = Object.freeze({ recordsDone: false, createdLocalIds: new Set<string>() });

export type V3ConfirmResult =
  | { kind: "refused_guard"; lines: string[]; state: V3ConfirmState; retry: false }
  | { kind: "record_failed"; lines: string[]; state: V3ConfirmState; retry: boolean }
  | { kind: "drafts"; complete: boolean; lines: string[]; state: V3ConfirmState; progress: MonthProgress[]; retry: boolean; createdNow: string[] };

/** «Reintentar ({n} pendientes)»: the drafts not yet created. */
export function pendingCount(drafts: readonly CreatableDraft[], state: V3ConfirmState): number {
  return drafts.filter((d) => !state.createdLocalIds.has(d.localId)).length;
}

/** Where a confirm's CONFIRMED creations leave each month (unknown outcomes count as not created, today's rule): a month after an incomplete one was never attempted. */
export function progressFrom(drafts: readonly CreatableDraft[], months: readonly string[], created: ReadonlySet<string>): MonthProgress[] {
  let blocked = false;
  return draftsByMonth(drafts, months)
    .filter((g) => g.drafts.length > 0)
    .map((g) => {
      const done = g.drafts.filter((d) => created.has(d.localId)).length;
      const entry = { month: g.month, total: g.drafts.length, created: done, failed: blocked ? 0 : g.drafts.length - done, attempted: !blocked, conflict: false };
      if (done < g.drafts.length) blocked = true;
      return entry;
    });
}

export async function runV3ConfirmAttempt(input: {
  entries: readonly V3ConfirmEntry[];
  months: readonly string[];
  drafts: readonly CreatableDraft[];
  published: boolean;
  state: V3ConfirmState;
  currentMonth: string;
  putRecords: (body: FairnessMonthsPut) => Promise<{ status: number; body: unknown }>;
  postDraft: (body: ReturnType<typeof draftCreateBody>) => Promise<DraftPostOutcome>;
}): Promise<V3ConfirmResult> {
  // 1. The guard, every attempt (CF-1). The entry set is never shrunk to drop a past month. Once the
  //    records landed, CF-6's per-month lines follow the past line (spec §5.11 failure table) — also
  //    when every draft failed; the «nada más» variant is for a confirm that already created drafts.
  const guard = confirmGuard(input.months, input.currentMonth);
  if (guard) {
    const createdBefore = input.state.createdLocalIds.size > 0;
    return {
      kind: "refused_guard",
      lines: [guardLine(guard, createdBefore), ...(input.state.recordsDone ? monthReportLines(progressFrom(input.drafts, input.months, input.state.createdLocalIds)) : [])],
      state: input.state,
      retry: false,
    };
  }
  // Every draft belongs to a horizon month, or nothing is written: a draft outside `months` would be
  // skipped by `draftsByMonth`, and a confirm that wrote the records and created none of its drafts
  // would report success (review fix: a stale run's drafts can outlive a horizon change).
  if (input.drafts.some((d) => !input.months.includes(d.date.slice(0, 7)))) {
    return { kind: "refused_guard", lines: [V3_LINES.draftsOutsideHorizon(input.months)], state: input.state, retry: false };
  }

  // 2. Records first, atomically, until they land (CF-4, CF-7).
  let state = input.state;
  if (!state.recordsDone) {
    let answer: PutAnswer;
    try {
      const res = await input.putRecords({ months: input.entries.map((e) => e.write) });
      answer = { kind: "http", status: res.status, body: res.body };
    } catch {
      answer = { kind: "threw" };
    }
    const verdict = classifyRecordPut(input.entries, answer);
    if (!verdict.ok) return { kind: "record_failed", lines: [recordVerdictLine(verdict)], state, retry: recordRetryOffered(verdict) };
    state = { ...state, recordsDone: true };
  }

  // 3. Drafts oldest first, month by month (CF-5).
  const created = new Set(state.createdLocalIds);
  const createdNow: string[] = [];
  const progress: MonthProgress[] = [];
  let blocked = false;
  for (const { month, drafts } of draftsByMonth(input.drafts, input.months)) {
    if (drafts.length === 0) continue;
    const pending = drafts.filter((d) => !created.has(d.localId));
    if (blocked) {
      progress.push({ month, total: drafts.length, created: drafts.length - pending.length, failed: 0, attempted: false, conflict: false });
      continue;
    }
    const batch = await runDraftCreateBatch({ drafts: pending, published: input.published, post: input.postDraft });
    for (const id of batch.createdLocalIds) {
      created.add(id);
      createdNow.push(id);
    }
    const done = drafts.filter((d) => created.has(d.localId)).length;
    progress.push({
      month, total: drafts.length, created: done, failed: batch.failed.length, attempted: true,
      conflict: batch.failed.some((f) => f.status === 409),
    });
    if (done < drafts.length) blocked = true;
  }
  state = { ...state, createdLocalIds: created };
  const complete = progress.every((p) => p.created === p.total);
  return { kind: "drafts", complete, lines: complete ? [] : monthReportLines(progress), state, progress, retry: !complete, createdNow };
}
