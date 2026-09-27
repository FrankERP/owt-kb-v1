"use client";

// app/components/admin/useDerivedSolverHistory.ts
//
// The month planner's DISPLAY copy of the derived fairness history — what the
// «Historial» block and both `LeadPoolHistoryPanel` mounts show. Never what a
// solve sends: every Auto re-reads for its own month at solve time (R14), so a
// display copy that went stale under an edit to a prior month cannot reach the
// solver. Spec `docs/superpowers/specs/2026-09-23-solver-history-derivation-design.md`;
// plan `docs/superpowers/plans/2026-09-25-owt-mcp-p2-solver-history.md`, step 5.
//
// ─── Keyed by (year, month); a stale answer is discarded ─────────────────────
//
// Every read is for one `(year, month)`, and an answer only ever lands for the
// month that asked. Two locks, because either alone has a hole:
//  - the request's `AbortController` is aborted when the month changes (or on
//    reload, or unmount) — `fetchDerivedHistory` then resolves `{ ok: false }`
//    at once, and the callback below drops anything that settles after the
//    abort;
//  - a request counter: only the LATEST request may write, so an answer that
//    outruns its own abort (a transport that ignores the signal) still cannot.
// And the result is stored WITH its month and attempt, so the state returned
// for November is never October's, even for the one render between a month
// change and its effect.
//
// ─── Only a four-digit year is fetched ───────────────────────────────────────
//
// `YearInput` never commits a half-typed year today, but a `202` must not become
// a request for year 202 if that ever changes: an incomplete year fetches
// nothing and the hook keeps whatever it last showed (including a read still
// in flight for the last complete year).
//
// `loading` is DERIVED (no stored month, or one that is not the current
// target) rather than set in an effect, so a month switch reads as loading on
// the very render that switches.

import { useCallback, useEffect, useRef, useState } from "react";

import type { DerivedSolverHistory } from "@/app/utils/solverHistory";
import { fetchDerivedHistory, type DerivedHistoryFetchResult } from "./derivedHistoryClient";

export type DerivedHistoryState =
  /** The switch is `local`: nothing is fetched and nothing should read this. */
  | { status: "idle" }
  | { status: "loading" }
  | { status: "ready"; data: DerivedSolverHistory }
  /** The read failed. Never shown as an empty history (spec, Failure). */
  | { status: "error" };

export type DerivedHistoryHandle = DerivedHistoryState & {
  /** Re-read the current month — the «Reintentar» of both display sites. */
  reload: () => void;
};

interface Target {
  year: number;
  month: number;
}

interface Settled extends Target {
  attempt: number;
  result: DerivedHistoryFetchResult;
}

function isFetchable(year: number, month: number): boolean {
  return (
    Number.isInteger(year) && year >= 1000 && year <= 9999 &&
    Number.isInteger(month) && month >= 1 && month <= 12
  );
}

export function useDerivedSolverHistory(year: number, month: number, enabled: boolean): DerivedHistoryHandle {
  const fetchable = enabled && isFetchable(year, month);
  // The month being shown: the last fetchable `(year, month)`. Adjusted during
  // render (React's "storing information from previous renders"), so an
  // incomplete year leaves it — and any read in flight for it — alone.
  const [target, setTarget] = useState<Target | null>(fetchable ? { year, month } : null);
  if (fetchable && (target === null || target.year !== year || target.month !== month)) {
    setTarget({ year, month });
  }
  const [attempt, setAttempt] = useState(0);
  const [settled, setSettled] = useState<Settled | null>(null);
  const latestRequest = useRef(0);

  const targetYear = target?.year;
  const targetMonth = target?.month;
  useEffect(() => {
    if (!enabled || targetYear === undefined || targetMonth === undefined) return;
    const request = ++latestRequest.current;
    const controller = new AbortController();
    void fetchDerivedHistory(targetYear, targetMonth, controller.signal).then((result) => {
      if (controller.signal.aborted || request !== latestRequest.current) return;
      setSettled({ year: targetYear, month: targetMonth, attempt, result });
    });
    return () => controller.abort();
  }, [enabled, targetYear, targetMonth, attempt]);

  const reload = useCallback(() => setAttempt((n) => n + 1), []);

  let state: DerivedHistoryState;
  if (!enabled || target === null) {
    state = { status: "idle" };
  } else if (
    settled !== null &&
    settled.year === target.year &&
    settled.month === target.month &&
    settled.attempt === attempt
  ) {
    state = settled.result.ok ? { status: "ready", data: settled.result.data } : { status: "error" };
  } else {
    state = { status: "loading" };
  }
  return { ...state, reload };
}
