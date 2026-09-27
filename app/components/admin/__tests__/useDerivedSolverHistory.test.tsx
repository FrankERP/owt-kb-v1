/** @vitest-environment jsdom */
// `useDerivedSolverHistory` — the display copy of the derived history. What is
// pinned here is the part `MonthGenerator`'s own suite cannot reach: a
// half-typed year fetches nothing (the planner's `YearInput` never commits one),
// each lock that keeps one month's answer out of another month's display, and
// that dormancy under the `local` switch really means no request.
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { DerivedHistoryFetchResult } from "../derivedHistoryClient";
import { useDerivedSolverHistory } from "../useDerivedSolverHistory";
import { historyWindow, type DerivedSolverHistory } from "@/app/utils/solverHistory";

/**
 * The real client, unless a test swaps in a read that IGNORES its abort — the
 * client's own abort race would otherwise mask the hook's locks, and each lock
 * has to be seen holding on its own.
 */
const client = vi.hoisted(() => ({
  override: null as null | ((year: number, month: number, signal?: AbortSignal) => Promise<DerivedHistoryFetchResult>),
}));
vi.mock("../derivedHistoryClient", async (importOriginal) => {
  const real = await importOriginal<typeof import("../derivedHistoryClient")>();
  return {
    ...real,
    fetchDerivedHistory: (year: number, month: number, signal?: AbortSignal) =>
      (client.override ?? real.fetchDerivedHistory)(year, month, signal),
  };
});

function body(year: number, month: number, services = 4) {
  const window = historyWindow({ year, month });
  return {
    target: { year, month },
    entries: window.map((w) => ({ key: w.key, year: w.year, month: w.month, total_counts: {}, role_counts: {} })),
    months: window.map((w) => ({ ...w, services })),
    diagnostics: { duplicateTargets: [], danglingSeats: [], unnamedMembers: [], duplicateNames: [] },
  };
}

const ok = (payload: unknown) => ({ ok: true, status: 200, json: async () => payload });
const monthOf = (url: string) => new URLSearchParams(url.slice(url.indexOf("?") + 1)).get("month");

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  client.override = null;
});

const data = (year: number, month: number) => {
  const { entries, months, diagnostics } = body(year, month);
  return { entries, months, diagnostics } as DerivedSolverHistory;
};

describe("useDerivedSolverHistory", () => {
  it("is idle and fetches nothing while the switch is local", () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const { result } = renderHook(() => useDerivedSolverHistory(2026, 11, false));

    expect(result.current.status).toBe("idle");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("loads the month it is given", async () => {
    vi.stubGlobal("fetch", vi.fn(async (url: string) => ok(body(2026, Number(monthOf(url)?.slice(5))))));

    const { result } = renderHook(() => useDerivedSolverHistory(2026, 11, true));

    expect(result.current.status).toBe("loading");
    await waitFor(() => expect(result.current.status).toBe("ready"));
    expect(result.current.status === "ready" && result.current.data.months.map((m) => m.key)).toEqual([
      "2026-8",
      "2026-9",
      "2026-10",
    ]);
  });

  it("a year that is not four digits fetches nothing and keeps what it showed", async () => {
    const fetchMock = vi.fn(async (url: string) => ok(body(2026, Number(monthOf(url)?.slice(5)))));
    vi.stubGlobal("fetch", fetchMock);
    const { result, rerender } = renderHook(({ year }) => useDerivedSolverHistory(year, 11, true), {
      initialProps: { year: 2026 },
    });
    await waitFor(() => expect(result.current.status).toBe("ready"));

    rerender({ year: 202 });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(result.current.status).toBe("ready");
    expect(result.current.status === "ready" && result.current.data.months[2].key).toBe("2026-10");
  });

  it("a month switch reads as loading at once, and the previous month's late answer is never shown", async () => {
    // A transport that ignores the abort, so the stale answer really arrives.
    let answerOctober: () => void = () => {};
    const signals: AbortSignal[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn((url: string, init?: RequestInit) => {
        signals.push(init!.signal!);
        if (monthOf(url) === "2026-10") {
          return new Promise((resolve) => {
            answerOctober = () => resolve(ok(body(2026, 10)));
          });
        }
        return Promise.resolve(ok(body(2026, 11)));
      }),
    );
    const { result, rerender } = renderHook(({ month }) => useDerivedSolverHistory(2026, month, true), {
      initialProps: { month: 10 },
    });
    expect(result.current.status).toBe("loading");

    rerender({ month: 11 });
    expect(result.current.status).toBe("loading");
    expect(signals[0].aborted).toBe(true);
    await waitFor(() => expect(result.current.status).toBe("ready"));

    await act(async () => {
      answerOctober();
    });
    expect(result.current.status === "ready" && result.current.data.months[2].key).toBe("2026-10");
    expect(result.current.status === "ready" && result.current.data.months[0].key).toBe("2026-8");
  });

  it("a month switch after the previous month SETTLED reads as loading, never as the previous month's ready", async () => {
    const november: { answer: () => void } = { answer: () => {} };
    client.override = (year, month) =>
      month === 10
        ? Promise.resolve({ ok: true, data: data(year, month) })
        : new Promise((resolve) => {
            november.answer = () => resolve({ ok: true, data: data(year, month) });
          });
    const { result, rerender } = renderHook(({ month }) => useDerivedSolverHistory(2026, month, true), {
      initialProps: { month: 10 },
    });
    await waitFor(() => expect(result.current.status).toBe("ready"));

    rerender({ month: 11 });
    expect(result.current.status).toBe("loading");

    await act(async () => november.answer());
    expect(result.current.status === "ready" && result.current.data.months[2].key).toBe("2026-10");
  });

  it("an answer that outruns its own abort still cannot land: only the latest request writes", async () => {
    // The read ignores the signal entirely, so the ONLY thing standing between
    // October's late answer and November's display is the hook's own guard.
    const october: { answer: () => void } = { answer: () => {} };
    client.override = (year, month) =>
      month === 10
        ? new Promise((resolve) => {
            october.answer = () => resolve({ ok: true, data: data(year, month) });
          })
        : Promise.resolve({ ok: true, data: data(year, month) });
    const { result, rerender } = renderHook(({ month }) => useDerivedSolverHistory(2026, month, true), {
      initialProps: { month: 10 },
    });

    rerender({ month: 11 });
    await waitFor(() => expect(result.current.status).toBe("ready"));
    await act(async () => october.answer());

    expect(result.current.status).toBe("ready");
    expect(result.current.status === "ready" && result.current.data.months[2].key).toBe("2026-10");
  });

  it("a failed read is an error, and reload re-reads it", async () => {
    const server = { fail: true };
    const fetchMock = vi.fn(async () => (server.fail ? { ok: false, status: 500, json: async () => ({}) } : ok(body(2026, 11))));
    vi.stubGlobal("fetch", fetchMock);
    const { result } = renderHook(() => useDerivedSolverHistory(2026, 11, true));
    await waitFor(() => expect(result.current.status).toBe("error"));

    server.fail = false;
    act(() => result.current.reload());

    expect(result.current.status).toBe("loading");
    await waitFor(() => expect(result.current.status).toBe("ready"));
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("an unmount aborts the read in flight", () => {
    const signals: AbortSignal[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn((_url: string, init?: RequestInit) => {
        signals.push(init!.signal!);
        return new Promise(() => {});
      }),
    );
    const { unmount } = renderHook(() => useDerivedSolverHistory(2026, 11, true));

    unmount();

    expect(signals).toHaveLength(1);
    expect(signals[0].aborted).toBe(true);
  });
});
