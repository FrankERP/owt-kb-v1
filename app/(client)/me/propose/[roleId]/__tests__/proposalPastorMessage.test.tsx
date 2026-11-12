/** @vitest-environment jsdom */
// The lead's «Mensaje del pastor» on the proposal (ADR-0088): offered while the
// service has none, never hidden from the proposal that holds one, honest about
// not replacing the service's, and re-sent on every save — so the page's own
// read (`getSharedProposal`) must carry it, or a save would blank it.

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn(), push: vi.fn(), replace: vi.fn() }),
}));

import ProposalEditor from "../ProposalEditor";
import { CueDialogProvider } from "@/app/components/ui/CueDialogProvider";
import { ToastProvider } from "@/app/components/ui/Toast";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

const roleDoc = {
  _id: "role-1",
  _type: "sunday_role",
  week: "2099-08-16",
  service_type: "sunday" as const,
  service_date: "2099-08-16",
};

const base = {
  _id: "proposal-1",
  _rev: "rev-1",
  status: "draft" as const,
  team_notes: "",
  songs: [{ song_id: "song-1", title: "Sublime gracia", author: "Newton", key: "G", play_key: "G" }],
};

type Props = Parameters<typeof ProposalEditor>[0];

function mount(proposal: Props["proposal"], pastorMessage: string | null = null) {
  render(
    <ToastProvider>
      <CueDialogProvider>
        <ProposalEditor roleDoc={roleDoc} proposal={proposal} currentUserId="lead-1" pastorMessage={pastorMessage} />
      </CueDialogProvider>
    </ToastProvider>,
  );
}

function mockSave() {
  return vi.spyOn(globalThis, "fetch").mockImplementation(async (input: RequestInfo | URL) => {
    const url = String(input);
    const body = url.startsWith("/api/me/proposals") ? { _id: "proposal-1", status: "draft", _rev: "rev-2" } : [];
    return new Response(JSON.stringify(body), { status: 200, headers: { "Content-Type": "application/json" } });
  });
}

const field = () => screen.queryByLabelText(/mensaje del pastor/i);

describe("ProposalEditor — the lead's pastor's message", () => {
  it("offers the field while the service has none, promising the team will see it on approval", () => {
    mount(base);
    expect(field()).not.toBeNull();
    expect(screen.getByText(/Lo verá todo el equipo en la tarjeta del servicio cuando se apruebe/)).toBeTruthy();
    expect(screen.getByText(/Para el mensaje del pastor usa el campo de arriba/)).toBeTruthy();
  });

  it("offers no field when the service already has one and the proposal holds none", () => {
    mount(base, "El del admin");
    expect(field()).toBeNull();
    expect(screen.getByText("El del admin")).toBeTruthy();
  });

  it("keeps the proposal's own text visible, and says it does not replace the service's", () => {
    mount({ ...base, pastor_message: "El de los líderes" }, "El del admin");
    expect((field() as HTMLTextAreaElement).value).toBe("El de los líderes");
    expect(screen.getByText(/este no lo reemplaza/)).toBeTruthy();
  });

  it("re-sends the STORED text on a save that did not touch it, so nothing is blanked", async () => {
    const fetchSpy = mockSave();
    mount({ ...base, pastor_message: "Vida en lugar de muerte" });
    fireEvent.change(screen.getByLabelText(/mensaje para el equipo/i), { target: { value: "Hola equipo" } });
    fireEvent.click(screen.getByRole("button", { name: /guardar borrador/i }));
    await waitFor(() => expect(fetchSpy.mock.calls.some(([u]) => String(u).startsWith("/api/me/proposals"))).toBe(true));
    const call = fetchSpy.mock.calls.find(([u]) => String(u).startsWith("/api/me/proposals"))!;
    expect(JSON.parse(String((call[1] as RequestInit).body))).toMatchObject({
      teamNotes: "Hola equipo",
      pastorMessage: "Vida en lugar de muerte",
    });
  });

  it("counts an edit to it as unsaved work, and sends the edit", async () => {
    const fetchSpy = mockSave();
    mount(base);
    expect(screen.queryByText(/cambios sin guardar/i)).toBeNull();
    fireEvent.change(field()!, { target: { value: "Efesios 2" } });
    expect(screen.queryByText(/cambios sin guardar/i)).not.toBeNull();
    fireEvent.click(screen.getByRole("button", { name: /guardar borrador/i }));
    await waitFor(() => expect(screen.queryByText(/cambios sin guardar/i)).toBeNull());
    const call = fetchSpy.mock.calls.find(([u]) => String(u).startsWith("/api/me/proposals"))!;
    expect(JSON.parse(String((call[1] as RequestInit).body)).pastorMessage).toBe("Efesios 2");
  });

  it("approved: shows it read-only, but not twice when it IS the service's message", () => {
    mount({ ...base, status: "approved", pastor_message: "Otro texto" }, "El del servicio");
    expect(screen.getByText("Mensaje del pastor que mandaron")).toBeTruthy();
    expect(field()).toBeNull();
    cleanup();
    mount({ ...base, status: "approved", pastor_message: "El del servicio" }, "El del servicio");
    expect(screen.queryByText("Mensaje del pastor que mandaron")).toBeNull();
  });

  it("the page's own proposal read carries the field the editor re-sends", () => {
    const page = readFileSync(join(__dirname, "..", "page.tsx"), "utf8");
    const read = page.slice(page.indexOf("async function getSharedProposal"), page.indexOf("async function getServiceThread"));
    expect(read).toMatch(/\bpastor_message\b/);
  });
});
