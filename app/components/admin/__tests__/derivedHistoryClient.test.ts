// `fetchDerivedHistory` — the planner's one read of the derived fairness history.
// The property under test is the spec's Failure clause: every way the read can
// go wrong is `{ ok: false }`, never an empty history, and a genuinely empty
// window is a VALID answer. Names are fictitious.
import { afterEach, describe, expect, it, vi } from "vitest";

import { fetchDerivedHistory } from "../derivedHistoryClient";
import { historyWindow } from "@/app/utils/solverHistory";

function body(year: number, month: number) {
  const window = historyWindow({ year, month });
  return {
    target: { year, month },
    entries: window.map((w) => ({
      key: w.key,
      year: w.year,
      month: w.month,
      total_counts: { "Ana Ficticia": 1 } as Record<string, number>,
      role_counts: { "Ana Ficticia": { "Sun.Lead": 1 } } as Record<string, Record<string, number>>,
    })),
    months: window.map((w) => ({ ...w, services: 4 })),
    diagnostics: { duplicateTargets: [], danglingSeats: [], unnamedMembers: [], duplicateNames: [] },
  };
}

function stub(response: { ok: boolean; status?: number; json?: () => Promise<unknown> } | Error) {
  const fetchMock = vi.fn(async (_url: string, _init?: RequestInit) => {
    if (response instanceof Error) throw response;
    return { status: 200, json: async () => ({}), ...response };
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("fetchDerivedHistory", () => {
  it("asks for the zero-padded month, uncached, with the caller's signal, and returns the three maps", async () => {
    const fetchMock = stub({ ok: true, json: async () => body(2026, 1) });
    const controller = new AbortController();

    const result = await fetchDerivedHistory(2026, 1, controller.signal);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe("/api/admin/solver-history?month=2026-01");
    expect(init).toMatchObject({ cache: "no-store", signal: controller.signal });
    const expected = body(2026, 1);
    expect(result).toEqual({
      ok: true,
      data: { entries: expected.entries, months: expected.months, diagnostics: expected.diagnostics },
    });
    // January's window crosses the year: Oct, Nov, Dec of the year before.
    expect(result.ok && result.data.entries.map((e) => e.key)).toEqual(["2025-10", "2025-11", "2025-12"]);
  });

  it("an EMPTY window is a valid answer, not a failure", async () => {
    const empty = body(2026, 11);
    for (const entry of empty.entries) {
      entry.total_counts = {};
      entry.role_counts = {};
    }
    for (const m of empty.months) m.services = 0;
    stub({ ok: true, json: async () => empty });

    const result = await fetchDerivedHistory(2026, 11);

    expect(result.ok).toBe(true);
    expect(result.ok && result.data.entries.every((e) => Object.keys(e.role_counts).length === 0)).toBe(true);
  });

  it("a non-2xx is a failure, and its body is never read as a history", async () => {
    const json = vi.fn(async () => ({ entries: body(2026, 11).entries }));
    stub({ ok: false, status: 500, json });

    expect(await fetchDerivedHistory(2026, 11)).toEqual({ ok: false });
    expect(json).not.toHaveBeenCalled();
  });

  it.each([
    ["two entries", (b: ReturnType<typeof body>) => ({ ...b, entries: b.entries.slice(1) })],
    ["four entries", (b: ReturnType<typeof body>) => ({ ...b, entries: [...b.entries, b.entries[2]] })],
    ["another month's window", () => body(2026, 10)],
    ["the window out of order", (b: ReturnType<typeof body>) => ({ ...b, entries: [...b.entries].reverse() })],
    ["a zero-padded entry key", (b: ReturnType<typeof body>) => ({ ...b, entries: b.entries.map((e) => ({ ...e, key: `${e.year}-0${e.month}` })) })],
    ["a count that is not a number", (b: ReturnType<typeof body>) => ({ ...b, entries: b.entries.map((e) => ({ ...e, role_counts: { "Ana Ficticia": { "Sun.Lead": "1" } } })) })],
    ["no total_counts", (b: ReturnType<typeof body>) => ({ ...b, entries: b.entries.map(({ total_counts: _t, ...e }) => e) })],
    ["no months", (b: ReturnType<typeof body>) => ({ ...b, months: undefined })],
    ["months for another window", (b: ReturnType<typeof body>) => ({ ...b, months: body(2026, 12).months })],
    ["no diagnostics", (b: ReturnType<typeof body>) => ({ ...b, diagnostics: undefined })],
    ["an entries-less error body", () => ({ error: "history_unavailable" })],
    ["an array", () => []],
  ])("a 200 carrying %s is a failure", async (_label, mutate) => {
    stub({ ok: true, json: async () => mutate(body(2026, 11)) });
    expect(await fetchDerivedHistory(2026, 11)).toEqual({ ok: false });
  });

  it("a network throw and an unparseable body are failures — it never throws", async () => {
    stub(new TypeError("Failed to fetch"));
    await expect(fetchDerivedHistory(2026, 11)).resolves.toEqual({ ok: false });

    stub({ ok: true, json: async () => { throw new SyntaxError("Unexpected token"); } });
    await expect(fetchDerivedHistory(2026, 11)).resolves.toEqual({ ok: false });
  });

  it("a month that is not a calendar month fails without a request", async () => {
    const fetchMock = stub({ ok: true, json: async () => body(2026, 11) });
    await expect(fetchDerivedHistory(2026, 13)).resolves.toEqual({ ok: false });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("an abort answers `{ ok: false }` at once, even when the request underneath never settles", async () => {
    vi.stubGlobal("fetch", vi.fn(() => new Promise(() => {})));
    const controller = new AbortController();

    const pending = fetchDerivedHistory(2026, 11, controller.signal);
    controller.abort();

    await expect(pending).resolves.toEqual({ ok: false });
  });

  it("an answer that arrives after its abort is still a failure", async () => {
    let answer: (value: unknown) => void = () => {};
    vi.stubGlobal("fetch", vi.fn(() => new Promise((resolve) => { answer = resolve; })));
    const controller = new AbortController();
    const pending = fetchDerivedHistory(2026, 11, controller.signal);

    controller.abort();
    answer({ ok: true, status: 200, json: async () => body(2026, 11) });

    await expect(pending).resolves.toEqual({ ok: false });
  });
});
