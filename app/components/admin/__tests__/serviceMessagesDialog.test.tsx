/** @vitest-environment jsdom */
//
// «Mensajes» from a service card (ADR-0065): the dialog reads one service's whole
// conversation when it opens (never before), shows the service thread and the
// proposal's own thread together, and a post replaces ONLY the service thread —
// the proposal's messages stay as loaded.

import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { CueDialogProvider } from "../../ui/CueDialogProvider";
import ServiceMessagesDialog from "../ServiceMessagesDialog";

const ROLE_ID = "role-sun-1";
const URL = `/api/admin/service-threads/${ROLE_ID}/messages`;

function conversation(over: Record<string, unknown> = {}) {
  return {
    service: {
      _id: ROLE_ID,
      service_date: "2099-03-08",
      published: true,
      leads: [{ id: "lead-1", name: "Ana" }, { id: "lead-2", name: "Beto" }],
    },
    messages: [
      { _key: "m1", author: "adm-1", author_name: "Frank", author_role: "admin", kind: "pastor_note", body: "Efesios 2", at: "2099-03-01T15:00:00.000Z" },
    ],
    proposal: null,
    ...over,
  };
}

let getBody: unknown;
let getOk: boolean;
let postReply: { ok: boolean; body: unknown };
const fetchMock = vi.fn();

beforeEach(() => {
  getBody = conversation();
  getOk = true;
  postReply = { ok: true, body: { ok: true, messages: [] } };
  fetchMock.mockReset();
  fetchMock.mockImplementation(async (url: string, init?: RequestInit) => {
    if (init?.method === "POST") {
      return { ok: postReply.ok, json: async () => postReply.body };
    }
    return { ok: getOk, json: async () => getBody };
  });
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function dialog(open: boolean, roleId = ROLE_ID) {
  return (
    <CueDialogProvider>
      <ServiceMessagesDialog open={open} roleId={roleId} title="Mensajes · Domingo 8 mar" viewerId="adm-1" onClose={() => {}} />
    </CueDialogProvider>
  );
}

function renderDialog(open = true) {
  return render(dialog(open));
}

describe("ServiceMessagesDialog", () => {
  it("reads nothing while closed", () => {
    renderDialog(false);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("shows the leads and the service thread, with no proposal yet", async () => {
    renderDialog();
    await waitFor(() => expect(screen.getByText("Líderes: Ana, Beto")).toBeTruthy());
    expect(fetchMock).toHaveBeenCalledWith(URL);
    expect(screen.getByText("Mensaje del pastor · vía Frank")).toBeTruthy();
    expect(screen.getByText(/Aún no hay propuesta/)).toBeTruthy();
  });

  it("says nobody is told while the service is unpublished", async () => {
    getBody = conversation({ service: { ...conversation().service, published: false } });
    renderDialog();
    await waitFor(() => expect(screen.getByText(/Aún no está publicado: no se avisa a nadie/)).toBeTruthy());
  });

  it("shows the proposal's own thread with the service thread", async () => {
    getBody = conversation({
      proposal: {
        _id: "setlistProposal.role-sun-1",
        status: "draft",
        messages: [{ _key: "p1", author: "lead-1", author_name: "Ana", author_role: "lead", kind: "lead_note", body: "Ya la armé", at: "2099-03-02T15:00:00.000Z" }],
      },
    });
    renderDialog();
    await waitFor(() => expect(screen.getByText("Ya la armé")).toBeTruthy());
    expect(screen.getByText("Efesios 2")).toBeTruthy();
  });

  it("posts the pastor's message and replaces only the service thread", async () => {
    getBody = conversation({
      proposal: {
        _id: "setlistProposal.role-sun-1",
        messages: [{ _key: "p1", author: "lead-1", author_name: "Ana", author_role: "lead", kind: "lead_note", body: "Ya la armé", at: "2099-03-02T15:00:00.000Z" }],
      },
    });
    postReply = {
      ok: true,
      body: {
        ok: true,
        messages: [
          ...conversation().messages,
          { _key: "m2", author: "adm-1", author_name: "Frank", author_role: "admin", kind: "pastor_note", body: "Y Juan 3", at: "2099-03-03T15:00:00.000Z" },
        ],
      },
    };
    renderDialog();
    await waitFor(() => expect(screen.getByText("Ya la armé")).toBeTruthy());
    fireEvent.click(screen.getByLabelText("Es el mensaje del pastor"));
    fireEvent.change(screen.getByPlaceholderText("Pega aquí el mensaje del pastor…"), { target: { value: "Y Juan 3" } });
    fireEvent.click(screen.getByText("Enviar"));
    await waitFor(() => expect(screen.getByText("Y Juan 3")).toBeTruthy());
    const postCall = fetchMock.mock.calls.find(([, init]) => init?.method === "POST");
    expect(postCall?.[0]).toBe(URL);
    expect(JSON.parse(String(postCall?.[1]?.body))).toEqual({ body: "Y Juan 3", pastor: true });
    // The proposal's thread is still on screen.
    expect(screen.getByText("Ya la armé")).toBeTruthy();
  });

  it("keeps the text when the post fails", async () => {
    postReply = { ok: false, body: { error: "nope" } };
    renderDialog();
    await waitFor(() => expect(screen.getByText("Efesios 2")).toBeTruthy());
    const box = screen.getByPlaceholderText("Escribe un mensaje…") as HTMLTextAreaElement;
    fireEvent.change(box, { target: { value: "no se pierde" } });
    fireEvent.click(screen.getByText("Enviar"));
    await waitFor(() => expect(screen.getByText("Error al enviar el mensaje")).toBeTruthy());
    expect(box.value).toBe("no se pierde");
  });

  it("offers a retry when the read fails", async () => {
    getOk = false;
    renderDialog();
    await waitFor(() => expect(screen.getByText("No se pudo cargar la conversación.")).toBeTruthy());
    getOk = true;
    fireEvent.click(screen.getByText("Reintentar"));
    await waitFor(() => expect(screen.getByText("Líderes: Ana, Beto")).toBeTruthy());
  });

  it("shows a landed message even when the read-back failed, so nobody retypes it", async () => {
    postReply = {
      ok: true,
      body: {
        ok: true,
        messages: null,
        message: { _key: "m2", author: { _ref: "adm-1", _type: "reference" }, author_role: "admin", kind: "admin_change_request", body: "Llegó", at: "2099-03-03T15:00:00.000Z" },
      },
    };
    renderDialog();
    await waitFor(() => expect(screen.getByText("Efesios 2")).toBeTruthy());
    fireEvent.change(screen.getByPlaceholderText("Escribe un mensaje…"), { target: { value: "Llegó" } });
    fireEvent.click(screen.getByText("Enviar"));
    await waitFor(() => expect(screen.getByText("Llegó")).toBeTruthy());
    expect(screen.getByText("Efesios 2")).toBeTruthy();
  });

  it("never shows one service's conversation under another's", async () => {
    const { rerender } = render(dialog(true));
    await waitFor(() => expect(screen.getByText("Efesios 2")).toBeTruthy());
    let release: (v: unknown) => void = () => {};
    fetchMock.mockImplementationOnce(() => new Promise((r) => (release = r)));
    rerender(dialog(false));
    rerender(dialog(true, "role-sat-2"));
    // The previous service's thread is gone at once, before the new read answers.
    expect(screen.queryByText("Efesios 2")).toBeNull();
    release({ ok: true, json: async () => conversation({ service: { _id: "role-sat-2", service_date: "2099-03-07", leads: [] }, messages: [] }) });
    await waitFor(() => expect(screen.getByText("Este servicio aún no tiene líder.")).toBeTruthy());
  });
});
