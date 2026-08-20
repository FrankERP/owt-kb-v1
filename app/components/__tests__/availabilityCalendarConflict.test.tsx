/** @vitest-environment jsdom */
// The member's side of the `unavailableDates` lost-update race, in the client.
//
// `app/api/__tests__/meAvailabilityConflict.test.ts` proves the route refuses a
// stale write. This file proves the calendar does the right thing with that
// refusal, which is where the data can still be lost:
//
//   * a real conflict DISCARDS the pending edits — re-sending a stale set
//     against a fresh revision is the very deletion the route just stopped —
//     and says so in a message that does not auto-dismiss;
//   * a conflict whose availability is byte-identical to the base is NOT the
//     race. It is `ProfilePanel` writing alias/photo/password/prefs on this same
//     page (one Sanity document, one revision), and throwing the member's
//     unrelated edits away for it would be a new bug shipped by the guard. Those
//     rebase onto the fresh revision exactly once.

import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import AvailabilityCalendar from "../AvailabilityCalendar";

// A marked cell carries an availability fill — `/30` normally, `/50` while its
// note popover is open (clicking a date opens it).
const MARKED = "bg-availability-fg/";

function reply(status: number, body: unknown) {
  return { ok: status >= 200 && status < 300, status, json: async () => body };
}

/** The day cell for e.g. ("Octubre 2026", 4) — month cards share day numbers. */
function cell(month: string, day: number): HTMLButtonElement {
  const card = screen.getByText(month).closest("div")!;
  const found = Array.from(card.querySelectorAll("button")).find(
    (b) => b.textContent?.trim() === String(day),
  );
  if (!found) throw new Error(`no cell ${day} in ${month}`);
  return found as HTMLButtonElement;
}

const marked = (month: string, day: number) => cell(month, day).className.includes(MARKED);

// "Guardar" / "Guardar •" / "Guardando..." / "Guardado ✓" — one button, four labels.
const saveButton = () => screen.getByRole("button", { name: /Guarda/ });

const fetchMock = vi.fn();

function bodyOf(call: number) {
  return JSON.parse((fetchMock.mock.calls[call][1] as RequestInit).body as string);
}

beforeEach(() => {
  // Pinned so the first visible page is always Septiembre–Noviembre 2026.
  // `shouldAdvanceTime` keeps `waitFor` and the hold/flash timers honest.
  vi.useFakeTimers({ shouldAdvanceTime: true });
  vi.setSystemTime(new Date("2026-09-15T12:00:00-06:00"));
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

function renderCalendar() {
  return render(
    <AvailabilityCalendar initialRev="rev-1" initialDates={["2026-09-20"]} initialNotes={[]} />,
  );
}

describe("AvailabilityCalendar — saving against a revision", () => {
  it("sends the revision it was rendered at, and the one the reply reports next time", async () => {
    renderCalendar();
    fetchMock.mockResolvedValueOnce(
      reply(200, { _rev: "rev-2", unavailableDates: ["2026-09-20", "2026-10-04"], unavailabilityNotes: [] }),
    );

    fireEvent.click(cell("Octubre 2026", 4));
    fireEvent.click(saveButton());
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    expect(bodyOf(0)).toEqual({
      _rev: "rev-1",
      unavailableDates: ["2026-09-20", "2026-10-04"],
      unavailabilityNotes: [],
    });

    fetchMock.mockResolvedValueOnce(
      reply(200, { _rev: "rev-3", unavailableDates: ["2026-09-20", "2026-10-04", "2026-10-11"], unavailabilityNotes: [] }),
    );
    fireEvent.click(cell("Octubre 2026", 11));
    fireEvent.click(saveButton());
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    // The new revision, not the stale one it was rendered with.
    expect(bodyOf(1)._rev).toBe("rev-2");
  });

  it("discards the pending edits on a real conflict and holds the warning", async () => {
    renderCalendar();
    // The Kids manager recorded 2026-11-01 while this tab sat open.
    fetchMock.mockResolvedValueOnce(
      reply(409, {
        error: "stale_revision",
        _rev: "rev-9",
        unavailableDates: ["2026-09-20", "2026-11-01"],
        unavailabilityNotes: [],
      }),
    );

    fireEvent.click(cell("Octubre 2026", 4));
    fireEvent.click(saveButton());
    await waitFor(() => expect(screen.getByRole("status")).toBeTruthy());

    // Exactly one attempt: retrying the stale set IS the deletion.
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const warning = screen.getByRole("status").textContent ?? "";
    expect(warning).toContain("NO se guardaron");
    expect(warning).toContain("vuelve a marcarlas");

    // The calendar now shows the winner's dates; the pending edit is gone.
    expect(marked("Noviembre 2026", 1)).toBe(true);
    expect(marked("Septiembre 2026", 20)).toBe(true);
    expect(marked("Octubre 2026", 4)).toBe(false);
    // Adopted state is the new baseline — nothing is left dirty.
    expect(screen.queryByText("Cambios sin guardar")).toBeNull();

    // And it does NOT auto-dismiss: it reports a write that never landed.
    // MUST be wrapped in act(): without it the re-render that useTransientValue's
    // timer schedules is never flushed before the assertion reads the DOM, so the
    // check below passes even when the notice is bound to the 2500ms `show`
    // channel instead of `hold` — i.e. the assertion silently guards nothing.
    // Verified by mutation: swapping the destructure to `show` fails only with act().
    await act(async () => {
      await vi.advanceTimersByTimeAsync(30_000);
    });
    expect(screen.getByRole("status").textContent).toContain("NO se guardaron");

    // Redoing the edit saves against the revision that won.
    fetchMock.mockResolvedValueOnce(
      reply(200, { _rev: "rev-10", unavailableDates: [], unavailabilityNotes: [] }),
    );
    fireEvent.click(cell("Octubre 2026", 4));
    fireEvent.click(saveButton());
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    expect(bodyOf(1)).toEqual({
      _rev: "rev-9",
      unavailableDates: ["2026-09-20", "2026-11-01", "2026-10-04"],
      unavailabilityNotes: [],
    });
    expect(screen.queryByRole("status")).toBeNull();
  });

  it("rebases once — and keeps the edits — when only a sibling field changed", async () => {
    renderCalendar();
    // `ProfilePanel` saved an alias seconds ago: same document, new revision,
    // availability untouched.
    fetchMock
      .mockResolvedValueOnce(
        reply(409, {
          error: "stale_revision",
          _rev: "rev-4",
          unavailableDates: ["2026-09-20"],
          unavailabilityNotes: [],
        }),
      )
      .mockResolvedValueOnce(
        reply(200, { _rev: "rev-5", unavailableDates: ["2026-09-20", "2026-10-04"], unavailabilityNotes: [] }),
      );

    fireEvent.click(cell("Octubre 2026", 4));
    fireEvent.click(saveButton());
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));

    expect(bodyOf(0)._rev).toBe("rev-1");
    expect(bodyOf(1)).toEqual({
      _rev: "rev-4",
      unavailableDates: ["2026-09-20", "2026-10-04"],
      unavailabilityNotes: [],
    });
    // The member's edit survived, the save is reported as done, and no alarming
    // message was shown for something they did themselves.
    expect(marked("Octubre 2026", 4)).toBe(true);
    expect(screen.queryByRole("status")).toBeNull();
    expect(screen.queryByText("Cambios sin guardar")).toBeNull();
    await waitFor(() => expect(saveButton().textContent).toContain("Guardado"));
  });

  it("gives up after ONE rebase, discarding rather than looping", async () => {
    renderCalendar();
    fetchMock.mockResolvedValue(
      reply(409, {
        error: "stale_revision",
        _rev: "rev-4",
        unavailableDates: ["2026-09-20"],
        unavailabilityNotes: [],
      }),
    );

    fireEvent.click(cell("Octubre 2026", 4));
    fireEvent.click(saveButton());
    await waitFor(() => expect(screen.getByRole("status")).toBeTruthy());
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(marked("Octubre 2026", 4)).toBe(false);
  });

  it("still reports a non-conflict failure as a failure, and stays dirty", async () => {
    renderCalendar();
    fetchMock.mockResolvedValueOnce(reply(500, {}));

    fireEvent.click(cell("Octubre 2026", 4));
    fireEvent.click(saveButton());

    await waitFor(() => expect(screen.getByText(/No se pudo guardar/)).toBeTruthy());
    expect(screen.getByText("Cambios sin guardar")).toBeTruthy();
    expect(marked("Octubre 2026", 4)).toBe(true);
    expect(saveButton().hasAttribute("disabled")).toBe(false);
  });
});
