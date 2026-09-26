// app/components/admin/derivedHistoryClient.ts
//
// The planner's ONE read of the derived fairness history:
// `GET /api/admin/solver-history?month=YYYY-MM` (R8), checked and
// shape-validated. Both of its callers go through here — the display
// (`useDerivedSolverHistory`) and every Auto run (`MonthGenerator`'s
// `handleAuto`, which re-reads for its own month at solve time, R14).
//
// NEUTRAL (ADR-0028): no `"use client"`, no Sanity, no `server-only`.
//
// **Never throws, and never answers "empty" for "failed".** The spec's Failure
// clause (`docs/superpowers/specs/2026-09-23-solver-history-derivation-design.md`)
// is the same absent-vs-failed line ADR-0010 draws for the rule set: an empty
// window is three entries with empty counts and is VALID; a failed read is
// `{ ok: false }` and is never turned into `[]` by anyone downstream. So every
// way this can go wrong — the network, a non-2xx (the route's `500` carries no
// `entries` key on purpose), a body that is not JSON, a body of the wrong shape,
// an abort — lands on the one `{ ok: false }`.

import { historyWindow, type DerivedSolverHistory, type SolverHistoryWindowMonth } from "@/app/utils/solverHistory";

export type DerivedHistoryFetchResult = { ok: true; data: DerivedSolverHistory } | { ok: false };

const FAILED: DerivedHistoryFetchResult = { ok: false };

function isObj(v: unknown): v is Record<string, unknown> {
  return !!v && typeof v === "object" && !Array.isArray(v);
}

function isCount(v: unknown): v is number {
  return typeof v === "number" && Number.isInteger(v) && v >= 0;
}

/** Each of the three is its window month, in window order, carrying the maps the solver reads. */
function validEntries(v: unknown, window: SolverHistoryWindowMonth[]): boolean {
  if (!Array.isArray(v) || v.length !== window.length) return false;
  return v.every((entry, i) => {
    const w = window[i];
    return (
      isObj(entry) &&
      entry.key === w.key &&
      entry.year === w.year &&
      entry.month === w.month &&
      isObj(entry.total_counts) &&
      Object.values(entry.total_counts).every(isCount) &&
      isObj(entry.role_counts) &&
      Object.values(entry.role_counts).every(
        (byRole) => isObj(byRole) && Object.values(byRole).every(isCount),
      )
    );
  });
}

function validMonths(v: unknown, window: SolverHistoryWindowMonth[]): boolean {
  if (!Array.isArray(v) || v.length !== window.length) return false;
  return v.every((m, i) => isObj(m) && m.key === window[i].key && isCount(m.services));
}

function validDiagnostics(v: unknown): boolean {
  return (
    isObj(v) &&
    Array.isArray(v.duplicateTargets) &&
    Array.isArray(v.danglingSeats) &&
    Array.isArray(v.unnamedMembers) &&
    Array.isArray(v.duplicateNames)
  );
}

/**
 * Resolves `{ ok: false }` the moment `signal` aborts — even if the request
 * underneath never settles. `fetch` honours the signal itself in every browser,
 * so this is belt and braces: it is what makes "a hung route cannot keep Auto
 * pending" a property of this module rather than of the transport.
 */
function abortedResult(signal: AbortSignal): { promise: Promise<DerivedHistoryFetchResult>; dispose: () => void } {
  let onAbort: () => void = () => {};
  const promise = new Promise<DerivedHistoryFetchResult>((resolve) => {
    onAbort = () => resolve(FAILED);
    if (signal.aborted) resolve(FAILED);
    else signal.addEventListener("abort", onAbort, { once: true });
  });
  return { promise, dispose: () => signal.removeEventListener("abort", onAbort) };
}

async function read(year: number, month: number, signal: AbortSignal | undefined): Promise<DerivedHistoryFetchResult> {
  try {
    // Throws a RangeError on a month that is not a calendar month — caught below.
    const window = historyWindow({ year, month });
    // The route's `MONTH_RE` wants `YYYY-MM`, zero-padded; entry keys are not.
    const res = await fetch(`/api/admin/solver-history?month=${year}-${String(month).padStart(2, "0")}`, {
      cache: "no-store",
      signal,
    });
    if (!res.ok) return FAILED;
    const body: unknown = await res.json();
    if (!isObj(body)) return FAILED;
    if (!validEntries(body.entries, window) || !validMonths(body.months, window) || !validDiagnostics(body.diagnostics)) {
      return FAILED;
    }
    return {
      ok: true,
      data: {
        entries: body.entries as DerivedSolverHistory["entries"],
        months: body.months as DerivedSolverHistory["months"],
        diagnostics: body.diagnostics as DerivedSolverHistory["diagnostics"],
      },
    };
  } catch {
    return FAILED;
  }
}

/**
 * The derived history for the month being planned (`month` is 1–12), or
 * `{ ok: false }`. `signal` aborts it — a display that moved to another month,
 * an unmount, or Auto's 20 s ceiling — and an aborted read is a failed one.
 */
export async function fetchDerivedHistory(
  year: number,
  month: number,
  signal?: AbortSignal,
): Promise<DerivedHistoryFetchResult> {
  if (!signal) return read(year, month, undefined);
  const aborted = abortedResult(signal);
  try {
    const result = await Promise.race([read(year, month, signal), aborted.promise]);
    return signal.aborted ? FAILED : result;
  } finally {
    aborted.dispose();
  }
}
