/** @vitest-environment jsdom */
// The WIRING between the pure window (`proposalListView.ts`) and the panel.
//
// `proposalListView.test.ts` proves the rules; it cannot prove the panel calls
// them. Both assertions here failed silently before this file existed: deleting
// the `setWindowSteps(widenStepsForTargets(...))` line in `ProposalsPanel.tsx`
// left the whole 4100-test suite green while the handoff consumed its target,
// set the highlight, and rendered no card at all — a scroll to nothing.
//
// The two mutations each test is written to catch:
//   • the handoff widening the window (a target older than the current month is
//     revealed, not silently swallowed);
//   • an approve on a PAST-dated proposal widening it too — the status flips to
//     `approved`, the only windowed status the queue can reach, and without the
//     widen the card vanishes from under the admin right after the toast.
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// "Today" is pinned so every fixture date below is a literal rather than an
// offset. `vi.hoisted` because the mock factory runs before module scope.
const { TODAY } = vi.hoisted(() => ({ TODAY: "2026-09-02" }));
vi.mock("../serviceReadiness", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../serviceReadiness")>()),
  serviceTodayIso: () => TODAY,
}));

import ProposalsPanel from "../ProposalsPanel";
import type { ProposalReviewTarget } from "../proposalHandoff";

interface Row {
  _id: string;
  _rev: string;
  service_type: "sunday" | "saturday" | "special";
  service_date: string;
  status: "draft" | "pending" | "approved" | "changes_requested";
  lead_name: string;
  lead_id: string;
  songs: Array<{
    _key: string;
    play_key: string;
    song_id: string;
    title: string;
    author: string;
    key: string;
  }>;
}

function row(over: Partial<Row> & Pick<Row, "_id" | "service_date" | "status" | "lead_name">): Row {
  return {
    _rev: `rev-${over._id}`,
    service_type: "sunday",
    lead_id: `lead-${over._id}`,
    songs: [
      { _key: "s1", play_key: "G", song_id: "song-1", title: "Cuán grande es Él", author: "", key: "G" },
    ],
    ...over,
  } as Row;
}

/** `fetch` over a mutable list: the GET re-reads whatever the PATCH committed. */
function stubApi(rows: Row[]) {
  const list = rows.map((r) => ({ ...r }));
  const fetchMock = vi.fn(async (url: string, init?: { method?: string; body?: string }) => {
    if (init?.method === "PATCH") {
      const id = String(url).split("/").pop();
      const action = JSON.parse(init.body ?? "{}").action as string;
      const hit = list.find((r) => r._id === id);
      if (hit) hit.status = action === "approve" ? "approved" : "changes_requested";
      return { ok: true, status: 200, json: async () => ({ ok: true }) };
    }
    return { ok: true, status: 200, json: async () => list.map((r) => ({ ...r })) };
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

const tab = (label: string) => screen.getByRole("button", { name: label });

beforeEach(() => {
  vi.unstubAllGlobals();
  // jsdom implements neither; the scroll effect calls both on a focused card.
  Element.prototype.scrollIntoView = vi.fn();
});
afterEach(cleanup);

describe("ProposalsPanel — the archive window, mounted", () => {
  it("renders the card a handoff points at, even outside the default window", async () => {
    // 2026-01 is eight months behind `TODAY`: three widen steps out, and hidden
    // at every step the panel could be sitting on when the handoff arrives.
    const OLD = row({
      _id: "old-approved",
      service_date: "2026-01-04",
      status: "approved",
      lead_name: "Ana Archivo",
    });
    const NOW = row({
      _id: "next-pending",
      service_date: "2026-09-06",
      status: "pending",
      lead_name: "Beto Pendiente",
    });
    stubApi([OLD, NOW]);

    const target: ProposalReviewTarget = {
      kind: "proposal_review",
      serviceRef: "role-old",
      serviceDate: OLD.service_date,
      serviceType: "sunday_role",
      proposalIds: [OLD._id],
      conflict: null,
      status: "approved",
    };
    const onResolved = vi.fn();
    render(<ProposalsPanel target={target} onResolved={onResolved} />);

    await waitFor(() => expect(onResolved).toHaveBeenCalledWith("focus"));
    // The card itself — not just the filter switch the handoff also performs.
    await waitFor(() => expect(screen.queryByText("Ana Archivo")).not.toBeNull());
    // …and it is the highlighted one, so the scroll had a real node to reach.
    const card = screen.getByText("Ana Archivo").closest("[aria-current]");
    expect(card).not.toBeNull();
  });

  it("keeps a PAST-dated proposal on screen after it is approved", async () => {
    // Approved on 2026-09-02 for a service that already happened on 2026-08-30:
    // the new `approved` status is windowed and 2026-08 is behind the start.
    const PAST = row({
      _id: "past-pending",
      service_date: "2026-08-30",
      status: "pending",
      lead_name: "Ana Pasada",
    });
    stubApi([PAST]);

    render(<ProposalsPanel />);
    await waitFor(() => expect(screen.queryByText("Ana Pasada")).not.toBeNull());
    // The scenario is the Todas tab — the admin watching the whole list.
    fireEvent.click(tab("Todas"));

    fireEvent.click(screen.getByRole("button", { name: "Aprobar" }));

    await waitFor(() => expect(screen.queryByText("Aprobada")).not.toBeNull());
    expect(screen.queryByText("Ana Pasada")).not.toBeNull();
    expect(screen.queryByText(/propuesta.* oculta/)).toBeNull();
  });
});
