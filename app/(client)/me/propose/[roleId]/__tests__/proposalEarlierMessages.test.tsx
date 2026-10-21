/** @vitest-environment jsdom */
// What admins wrote about a service before its proposal existed (ADR-0064) —
// typically what the pastor shared — as the lead sees it in the editor.
//
// Before the proposal exists the lead READS it (no composer: there is no
// document to post into) and is told to answer through «Notas privadas». Once
// the proposal exists it opens the proposal's own thread, oldest first.

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn(), push: vi.fn(), replace: vi.fn() }),
}));

import ProposalEditor from "../ProposalEditor";
import { CueDialogProvider } from "@/app/components/ui/CueDialogProvider";
import { ToastProvider } from "@/app/components/ui/Toast";

afterEach(cleanup);

const roleDoc = {
  _id: "role-1",
  _type: "sunday_role",
  week: "2099-08-16",
  service_type: "sunday" as const,
  service_date: "2099-08-16",
};

const earlier = [
  { _key: "e1", author: "admin-1", author_name: "Frank", author_role: "admin", body: "El pastor predica sobre la gracia.", at: "2099-08-01T15:00:00.000Z" },
];

function mount(proposal: Parameters<typeof ProposalEditor>[0]["proposal"]) {
  render(
    <ToastProvider>
      <CueDialogProvider>
        <ProposalEditor roleDoc={roleDoc} proposal={proposal} currentUserId="lead-1" earlierMessages={earlier} />
      </CueDialogProvider>
    </ToastProvider>,
  );
}

describe("ProposalEditor — messages from before the proposal", () => {
  it("shows them read-only while no proposal exists, pointing at «Notas privadas»", () => {
    mount(null);
    expect(screen.getByText("Mensajes de los admins")).toBeTruthy();
    expect(screen.getByText("El pastor predica sobre la gracia.")).toBeTruthy();
    expect(screen.getByText(/escribe en «Notas privadas para revisión»/)).toBeTruthy();
    expect(screen.queryByPlaceholderText("Escribe un mensaje…")).toBeNull();
  });

  it("opens the proposal's thread with them once the proposal exists", () => {
    mount({
      _id: "proposal-1",
      _rev: "rev-1",
      status: "draft",
      songs: [],
      messages: [
        { _key: "m1", author: "lead-1", author_name: "Ana", author_role: "lead", body: "Escogí canciones de gracia.", at: "2099-08-02T15:00:00.000Z" },
      ],
    });
    expect(screen.queryByText("Mensajes de los admins")).toBeNull();
    const first = screen.getByText("El pastor predica sobre la gracia.");
    const second = screen.getByText("Escogí canciones de gracia.");
    expect(first.compareDocumentPosition(second) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(screen.getByPlaceholderText("Escribe un mensaje…")).toBeTruthy();
  });
});
