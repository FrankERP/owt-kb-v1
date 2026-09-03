/** @vitest-environment jsdom */
//
// The availability panel must never answer "Todo bien" from a failed load.
//
// Its whole job is the question "is anyone assigned on a day they said they
// cannot serve?", and its empty state is the reassuring answer. It used to
// guard each response with `if (res.ok)` and nothing else: a 403 on a lapsed
// session, or a 500 from Sanity, left `members` empty, which made `conflicts`
// empty by construction and painted the green "Todo bien" panel over a request
// that never returned. A rejected fetch was worse — it skipped
// `setLoading(false)` and left the skeleton spinning with no retry.
//
// `serviceReadiness.ts` writes the rule this panel has to honour: a failure
// never means clear.

import { cleanup, render, screen, waitFor, fireEvent } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import AvailabilityPanel from "../AvailabilityPanel";

const ok = (body: unknown) => ({ ok: true, json: async () => body });

beforeEach(() => vi.unstubAllGlobals());
afterEach(cleanup);

/** The reassuring copy that must never appear on a failed load. */
const ALL_CLEAR = /Todo bien/i;

describe("AvailabilityPanel — a failed load never reads as 'no conflicts'", () => {
  it("reports the failure instead of an all-clear when a response is not ok", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: false, status: 403, json: async () => ({ error: "Forbidden" }) })));
    render(<AvailabilityPanel />);

    await waitFor(() => expect(screen.getByRole("alert")).not.toBeNull());
    expect(screen.queryByText(ALL_CLEAR)).toBeNull();
    expect(screen.getByRole("alert").textContent).toMatch(/No podemos confirmar si hay conflictos/i);
  });

  it("reports the failure when the fetch rejects, rather than spinning forever", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => { throw new Error("offline"); }));
    render(<AvailabilityPanel />);

    await waitFor(() => expect(screen.getByRole("alert")).not.toBeNull());
    expect(screen.queryByText(ALL_CLEAR)).toBeNull();
  });

  it("reports the failure when a response is ok but not the expected shape", async () => {
    // A route that answers 200 with `{error: ...}` would otherwise put a
    // non-array into `members` and crash the render on `.filter`.
    vi.stubGlobal("fetch", vi.fn(async () => ok({ error: "nope" })));
    render(<AvailabilityPanel />);

    await waitFor(() => expect(screen.getByRole("alert")).not.toBeNull());
    expect(screen.queryByText(ALL_CLEAR)).toBeNull();
  });

  it("recovers when the retry succeeds", async () => {
    const fetchMock = vi
      .fn()
      .mockImplementationOnce(async () => { throw new Error("offline"); })
      .mockImplementationOnce(async () => { throw new Error("offline"); })
      .mockImplementation(async () => ok([]));
    vi.stubGlobal("fetch", fetchMock);
    render(<AvailabilityPanel />);

    await waitFor(() => expect(screen.getByRole("alert")).not.toBeNull());
    fireEvent.click(screen.getByRole("button", { name: "Reintentar" }));

    await waitFor(() => expect(screen.queryByRole("alert")).toBeNull());
    expect(screen.getByText(ALL_CLEAR)).not.toBeNull();
  });

  it("still shows the all-clear when the load genuinely succeeds and finds nothing", async () => {
    // The guard must not have turned the honest empty case into an error.
    vi.stubGlobal("fetch", vi.fn(async () => ok([])));
    render(<AvailabilityPanel />);

    await waitFor(() => expect(screen.getByText(ALL_CLEAR)).not.toBeNull());
    expect(screen.queryByRole("alert")).toBeNull();
  });
});
