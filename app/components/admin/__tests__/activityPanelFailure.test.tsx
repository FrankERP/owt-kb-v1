/** @vitest-environment jsdom */
//
// A failed activity load must not take /admin down with it.
//
// The fetch ran `.then(r => r.json()).then(setActivity)` with no `res.ok`
// check. `GET /api/admin/login-events` answers a lapsed session with
// `{ error: "Forbidden" }` and status 403 — valid JSON, so `.catch` never
// fired, `activity` became that object, and `activity.filter(...)` threw
// during render. That unmounts the whole admin tree to the error boundary: a
// blank page instead of the error message the component already had.
//
// Reachable by a session expiring while the tab is open — `isMemberActive` has
// a 30s TTL — which is exactly when an admin is mid-task.

import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import ActivityPanel from "../ActivityPanel";

const ERROR_COPY = /Error al cargar actividad/i;

beforeEach(() => vi.unstubAllGlobals());
afterEach(cleanup);

describe("ActivityPanel — a failed load", () => {
  it("reports a 403 whose body is valid JSON, instead of throwing during render", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => ({
      ok: false,
      status: 403,
      json: async () => ({ error: "Forbidden" }),
    })));

    // The assertion is as much that this render does not throw as that the
    // message appears: the old code crashed here.
    render(<ActivityPanel />);
    await waitFor(() => expect(screen.getByText(ERROR_COPY)).not.toBeNull());
  });

  it("reports a 200 whose body is not the expected array", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, json: async () => ({ error: "nope" }) })));
    render(<ActivityPanel />);
    await waitFor(() => expect(screen.getByText(ERROR_COPY)).not.toBeNull());
  });

  it("reports a rejected fetch and stops loading", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => { throw new Error("offline"); }));
    render(<ActivityPanel />);
    await waitFor(() => expect(screen.getByText(ERROR_COPY)).not.toBeNull());
  });

  it("renders normally when the load succeeds", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, json: async () => [] })));
    render(<ActivityPanel />);
    await waitFor(() => expect(screen.queryByText(ERROR_COPY)).toBeNull());
  });

  it("gives every member's status a text label, not only a coloured dot", async () => {
    // The dot and the WORD travel together at every width since the Admin pass
    // (the Servicios pattern), so no `sr-only` stand-in is needed: the word is
    // simply there.
    vi.stubGlobal("fetch", vi.fn(async () => ({
      ok: true,
      json: async () => [
        { _id: "m1", member_name: "Ana", lastActive: null, lastLogin: null, loginCount: 0, lastSeen: null, providers: [], events: [] },
      ],
    })));
    const { container } = render(<ActivityPanel />);
    await waitFor(() => expect(screen.getByText("Ana")).not.toBeNull());
    const row = container.querySelector("[data-activity-row]") as HTMLElement;
    expect(row.textContent).toContain("Sin actividad");
    expect(row.querySelector(".sr-only")).toBeNull();
  });
});
