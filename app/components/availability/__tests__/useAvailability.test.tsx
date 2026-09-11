/** @vitest-environment jsdom */
//
// The availability machinery, away from the grid that used to own it.
//
// `app/components/__tests__/availabilityCalendarConflict.test.tsx` proves the
// same revision contract THROUGH the UI and still does — it is the binding test
// for this refactor. This file covers the hook directly, so the next surface to
// read availability (the «Mi semana» weekend list) can be built against a unit
// that is already pinned: the two-attempt loop, which `_rev` each attempt
// carries, what a real conflict adopts, and the recurring expansion, none of
// which need a calendar rendered to be wrong.

import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useAvailability } from "../useAvailability";

function reply(status: number, body: unknown) {
  return { ok: status >= 200 && status < 300, status, json: async () => body };
}

const fetchMock = vi.fn();

function bodyOf(call: number) {
  return JSON.parse((fetchMock.mock.calls[call][1] as RequestInit).body as string);
}

beforeEach(() => {
  // Tuesday 15 September 2026, pinned: `todayIso`, the recurring expansion's
  // first Sunday and its 12-month horizon are all read off the clock.
  vi.useFakeTimers({ shouldAdvanceTime: true });
  vi.setSystemTime(new Date("2026-09-15T12:00:00-06:00"));
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

const onAdopt = vi.fn();

function setup(initialDates: string[] = ["2026-09-20"]) {
  onAdopt.mockReset();
  return renderHook(() =>
    useAvailability({ initialRev: "r1", initialDates, initialNotes: [], onAdopt }),
  );
}

describe("useAvailability", () => {
  it("toggles a date on and back off", () => {
    const { result } = setup([]);
    expect(result.current.todayIso).toBe("2026-09-15");

    act(() => result.current.toggle("2026-10-04"));
    expect(result.current.dates.has("2026-10-04")).toBe(true);
    expect(result.current.upcomingCount).toBe(1);

    act(() => result.current.toggle("2026-10-04"));
    expect(result.current.dates.has("2026-10-04")).toBe(false);
    expect(result.current.upcomingCount).toBe(0);
  });

  it("flips dirty, clears it on a 200, and saves against the revision the reply reported", async () => {
    const { result } = setup();
    expect(result.current.dirty).toBe(false);

    act(() => result.current.mark("2026-10-04"));
    expect(result.current.dirty).toBe(true);

    fetchMock.mockResolvedValueOnce(
      reply(200, { _rev: "r2", unavailableDates: ["2026-09-20", "2026-10-04"], unavailabilityNotes: [] }),
    );
    await act(async () => { await result.current.save(); });

    expect(bodyOf(0)).toEqual({
      _rev: "r1",
      unavailableDates: ["2026-09-20", "2026-10-04"],
      unavailabilityNotes: [],
    });
    expect(result.current.dirty).toBe(false);
    expect(result.current.saved).toBe(true);
    expect(result.current.saveError).toBeNull();

    // The second save carries r2, not the revision the hook was mounted with.
    fetchMock.mockResolvedValueOnce(reply(200, { _rev: "r3", unavailableDates: [], unavailabilityNotes: [] }));
    act(() => result.current.setNote("2026-10-04", "viaje"));
    await act(async () => { await result.current.save(); });
    expect(bodyOf(1)).toEqual({
      _rev: "r2",
      unavailableDates: ["2026-09-20", "2026-10-04"],
      unavailabilityNotes: [{ date: "2026-10-04", note: "viaje" }],
    });
  });

  it("adopts the server state and HOLDS the conflict when the arrays really diverged", async () => {
    const { result } = setup();
    fetchMock.mockResolvedValueOnce(
      reply(409, {
        error: "stale_revision",
        _rev: "r9",
        unavailableDates: ["2026-09-20", "2026-11-01"],
        unavailabilityNotes: [],
      }),
    );

    act(() => result.current.mark("2026-10-04"));
    await act(async () => { await result.current.save(); });

    // One attempt only: re-sending the stale set IS the deletion the 409 stopped.
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(Array.from(result.current.dates).sort()).toEqual(["2026-09-20", "2026-11-01"]);
    expect(result.current.dirty).toBe(false);
    expect(result.current.conflict).toContain("NO se guardaron");
    // The grid is told, so the popover it may have open over a date that is now
    // gone closes in the same update.
    expect(onAdopt).toHaveBeenCalledTimes(1);

    // Held, not flashed — it reports a write that never landed.
    await act(async () => { await vi.advanceTimersByTimeAsync(30_000); });
    expect(result.current.conflict).toContain("NO se guardaron");

    // And the redo goes out against the revision that won.
    fetchMock.mockResolvedValueOnce(reply(200, { _rev: "r10", unavailableDates: [], unavailabilityNotes: [] }));
    act(() => result.current.mark("2026-10-04"));
    await act(async () => { await result.current.save(); });
    expect(bodyOf(1)._rev).toBe("r9");
    expect(result.current.conflict).toBeNull();
  });

  it("rebases exactly once when the conflict is a sibling write to the same document", async () => {
    const { result } = setup();
    fetchMock
      .mockResolvedValueOnce(
        reply(409, {
          error: "stale_revision",
          _rev: "r4",
          unavailableDates: ["2026-09-20"],
          unavailabilityNotes: [],
        }),
      )
      .mockResolvedValueOnce(
        reply(200, { _rev: "r5", unavailableDates: ["2026-09-20", "2026-10-04"], unavailabilityNotes: [] }),
      );

    act(() => result.current.mark("2026-10-04"));
    await act(async () => { await result.current.save(); });

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(bodyOf(0)._rev).toBe("r1");
    expect(bodyOf(1)).toEqual({
      _rev: "r4",
      unavailableDates: ["2026-09-20", "2026-10-04"],
      unavailabilityNotes: [],
    });
    // The member's edit survived and nothing alarming was shown for a field
    // they changed themselves.
    expect(result.current.dates.has("2026-10-04")).toBe(true);
    expect(result.current.conflict).toBeNull();
    expect(result.current.dirty).toBe(false);
    expect(result.current.saved).toBe(true);
    expect(onAdopt).not.toHaveBeenCalled();
  });

  it("expands a weekly Sunday pattern over the next 12 months, and clears it again", () => {
    const { result } = setup([]);
    act(() => result.current.applyRecurring(0, 1, true));

    const added = Array.from(result.current.dates).sort();
    expect(added).toHaveLength(52);
    expect(added[0]).toBe("2026-09-20"); // the next Sunday, never a past one
    expect(added[added.length - 1]).toBe("2027-09-12");
    expect(added.every(iso => new Date(iso + "T12:00:00").getDay() === 0)).toBe(true);

    act(() => result.current.applyRecurring(0, 1, false));
    expect(result.current.dates.size).toBe(0);
  });

  it("reports a non-conflict failure and stays dirty", async () => {
    const { result } = setup();
    fetchMock.mockResolvedValueOnce(reply(500, {}));

    act(() => result.current.mark("2026-10-04"));
    await act(async () => { await result.current.save(); });

    expect(result.current.saveError).toContain("500");
    expect(result.current.dirty).toBe(true);
    expect(result.current.saving).toBe(false);
    expect(result.current.dates.has("2026-10-04")).toBe(true);
  });
});
