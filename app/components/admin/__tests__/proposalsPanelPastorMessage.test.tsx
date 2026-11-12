/** @vitest-environment jsdom */
// The leads' «Mensaje del pastor» on a proposal card, and what the approval did
// with it (ADR-0088): the route answers the copy's outcome in its body, and the
// toast says it when the service kept another message or the copy failed.

import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { TODAY } = vi.hoisted(() => ({ TODAY: "2026-09-02" }));
vi.mock("../serviceReadiness", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../serviceReadiness")>()),
  serviceTodayIso: () => TODAY,
}));

import ProposalsPanel from "../ProposalsPanel";
import { ToastProvider } from "../../ui/Toast";

const ROW = {
  _id: "p-1",
  _rev: "rev-1",
  service_type: "sunday",
  service_date: "2026-09-06",
  status: "pending",
  lead_name: "Lucía",
  lead_id: "lead-1",
  pastor_message: "  Vida en lugar de muerte  ",
  team_notes: "Hola equipo",
  songs: [{ _key: "s1", play_key: "G", song_id: "song-1", title: "Cuán grande es Él", author: "", key: "G" }],
};

function stubApi(approveBody: Record<string, unknown>) {
  const fetchMock = vi.fn(async (_url: string, init?: { method?: string }) =>
    init?.method === "PATCH"
      ? { ok: true, status: 200, json: async () => approveBody }
      : { ok: true, status: 200, json: async () => [{ ...ROW }] },
  );
  vi.stubGlobal("fetch", fetchMock);
}

beforeEach(() => {
  vi.unstubAllGlobals();
  Element.prototype.scrollIntoView = vi.fn();
});
afterEach(cleanup);

describe("ProposalsPanel — the leads' pastor's message", () => {
  it("shows it on the card, above the team message, saying where it goes", async () => {
    stubApi({ ok: true, status: "approved" });
    render(<ToastProvider><ProposalsPanel /></ToastProvider>);
    await waitFor(() => expect(screen.queryByText("Vida en lugar de muerte")).not.toBeNull());
    expect(screen.getByText(/Al aprobar pasa al mensaje del pastor del servicio/)).toBeTruthy();
    const pastor = screen.getByText("Vida en lugar de muerte");
    const team = screen.getByText("Hola equipo");
    expect(pastor.compareDocumentPosition(team) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it.each([
    ["kept_existing", /ya tenía otro mensaje del pastor; no se cambió/],
    ["failed", /no se pudo pasar el mensaje del pastor/],
    ["copied", /El mensaje del pastor quedó en el servicio/],
  ])("toasts the copy's outcome %s after an approval", async (outcome, text) => {
    stubApi({ ok: true, status: "approved", pastorMessage: outcome });
    render(<ToastProvider><ProposalsPanel /></ToastProvider>);
    await waitFor(() => expect(screen.queryByText("Lucía")).not.toBeNull());
    fireEvent.click(screen.getByRole("button", { name: "Aprobar" }));
    await waitFor(() => expect(screen.queryAllByText(text).length).toBeGreaterThan(0));
  });
});
