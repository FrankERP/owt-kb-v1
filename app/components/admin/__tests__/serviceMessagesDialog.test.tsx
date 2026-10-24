/** @vitest-environment jsdom */
//
// «Mensajes» from a service card (ADR-0065): the dialog reads one service's whole
// conversation when it opens (never before), shows the service thread and the
// proposal's own thread together, and a post replaces ONLY the service thread —
// the proposal's messages stay as loaded. Since 2026-10-24 it also edits the
// pastor's message and the team note, each against what it loaded.

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
/** Replies to PUT/PATCH/DELETE, by URL suffix; a status of 409 is a stale save. */
let writeReplies: Record<string, { status: number; body: unknown }>;
const fetchMock = vi.fn();

const BASE = `/api/admin/service-threads/${ROLE_ID}`;
const TEAM_TARGET = { text: "Hermanos, el pastor pide orar por Efesios 2", observed: { id: "featured-1", rev: "rev-1" } };
const PASTOR = { body: "Efesios 2 y Juan 3", at: "2099-03-01T15:00:00.000Z", edited_at: null, author: "adm-1", author_name: "Frank" };

function writesTo(suffix: string) {
  return fetchMock.mock.calls.filter(([url, init]) => url === `${BASE}${suffix}` && init?.method && init.method !== "POST");
}

beforeEach(() => {
  getBody = conversation();
  getOk = true;
  postReply = { ok: true, body: { ok: true, messages: [] } };
  writeReplies = {};
  fetchMock.mockReset();
  fetchMock.mockImplementation(async (url: string, init?: RequestInit) => {
    if (init?.method === "POST") {
      return { ok: postReply.ok, status: postReply.ok ? 200 : 500, json: async () => postReply.body };
    }
    if (init?.method) {
      const reply = writeReplies[url.slice(BASE.length)] ?? { status: 500, body: {} };
      return { ok: reply.status < 300, status: reply.status, json: async () => reply.body };
    }
    return { ok: getOk, status: getOk ? 200 : 500, json: async () => getBody };
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

  it("posts a message and replaces only the service thread", async () => {
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
          { _key: "m2", author: "adm-1", author_name: "Frank", author_role: "admin", kind: "admin_change_request", body: "Y Juan 3", at: "2099-03-03T15:00:00.000Z" },
        ],
      },
    };
    renderDialog();
    await waitFor(() => expect(screen.getByText("Ya la armé")).toBeTruthy());
    // The pastor's message is its own box now, not a tick on the composer.
    expect(screen.queryByLabelText("Es el mensaje del pastor")).toBeNull();
    fireEvent.change(screen.getByPlaceholderText("Escribe un mensaje…"), { target: { value: "Y Juan 3" } });
    fireEvent.click(screen.getByText("Enviar"));
    await waitFor(() => expect(screen.getByText("Y Juan 3")).toBeTruthy());
    const postCall = fetchMock.mock.calls.find(([, init]) => init?.method === "POST");
    expect(postCall?.[0]).toBe(URL);
    expect(JSON.parse(String(postCall?.[1]?.body))).toEqual({ body: "Y Juan 3" });
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

  describe("Mensaje del pastor", () => {
    it("adds one with `observed: null` and shows what the server saved", async () => {
      writeReplies["/pastor-message"] = { status: 200, body: { ok: true, pastor_message: PASTOR } };
      renderDialog();
      await waitFor(() => expect(screen.getByText(/Aún no hay\. Al guardarlo/)).toBeTruthy());
      fireEvent.click(screen.getByText("Agregar"));
      fireEvent.change(screen.getByLabelText("Mensaje del pastor"), { target: { value: "  Efesios 2 y Juan 3 " } });
      fireEvent.click(screen.getByText("Guardar"));
      await waitFor(() => expect(screen.getByText("Efesios 2 y Juan 3")).toBeTruthy());
      const [call] = writesTo("/pastor-message");
      expect(call[1].method).toBe("PUT");
      expect(JSON.parse(String(call[1].body))).toEqual({ body: "Efesios 2 y Juan 3", observed: null });
      expect(screen.getByText("Lo guardó Frank")).toBeTruthy();
    });

    it("edits against the stamp it loaded", async () => {
      getBody = conversation({ pastor_message: PASTOR });
      writeReplies["/pastor-message"] = {
        status: 200,
        body: { ok: true, pastor_message: { ...PASTOR, body: "Efesios 2", edited_at: "2099-03-02T10:00:00.000Z" } },
      };
      renderDialog();
      await waitFor(() => expect(screen.getByText("Efesios 2 y Juan 3")).toBeTruthy());
      fireEvent.click(screen.getAllByText("Editar")[0]);
      fireEvent.change(screen.getByLabelText("Mensaje del pastor"), { target: { value: "Efesios 2" } });
      fireEvent.click(screen.getByText("Guardar"));
      await waitFor(() => expect(screen.getByText("Lo guardó Frank · editado")).toBeTruthy());
      expect(JSON.parse(String(writesTo("/pastor-message")[0][1].body))).toEqual({ body: "Efesios 2", observed: PASTOR.at });
    });

    it("asks before removing it, then sends an empty body", async () => {
      getBody = conversation({ pastor_message: PASTOR });
      writeReplies["/pastor-message"] = { status: 200, body: { ok: true, pastor_message: null } };
      renderDialog();
      await waitFor(() => expect(screen.getByText("Efesios 2 y Juan 3")).toBeTruthy());
      fireEvent.click(screen.getByText("Quitar"));
      expect(writesTo("/pastor-message")).toHaveLength(0);
      fireEvent.click(screen.getByText("Sí, quitar"));
      await waitFor(() => expect(screen.getByText(/Aún no hay\. Al guardarlo/)).toBeTruthy());
      expect(JSON.parse(String(writesTo("/pastor-message")[0][1].body))).toEqual({ body: "", observed: PASTOR.at });
    });

    it("on a 409 says another admin changed it and reloads on demand", async () => {
      getBody = conversation({ pastor_message: PASTOR });
      writeReplies["/pastor-message"] = { status: 409, body: { error: "stale" } };
      renderDialog();
      await waitFor(() => expect(screen.getByText("Efesios 2 y Juan 3")).toBeTruthy());
      fireEvent.click(screen.getAllByText("Editar")[0]);
      fireEvent.change(screen.getByLabelText("Mensaje del pastor"), { target: { value: "otro" } });
      fireEvent.click(screen.getByText("Guardar"));
      await waitFor(() => expect(screen.getByText(/Otro admin cambió este mensaje/)).toBeTruthy());
      const reads = fetchMock.mock.calls.filter(([, init]) => !init?.method).length;
      fireEvent.click(screen.getByText("Recargar"));
      await waitFor(() => expect(fetchMock.mock.calls.filter(([, init]) => !init?.method).length).toBe(reads + 1));
    });
  });

  describe("Mensaje para el equipo", () => {
    it("says it needs a setlist when there is none", async () => {
      renderDialog();
      await waitFor(() => expect(screen.getByText(/Este servicio aún no tiene setlist/)).toBeTruthy());
    });

    it("saves an edit against the loaded revision and adopts the new one", async () => {
      getBody = conversation({ teamNotes: TEAM_TARGET });
      writeReplies["/team-notes"] = { status: 200, body: { ok: true, teamNotes: "Lleguen 8:30", observed: { id: "featured-1", rev: "rev-2" } } };
      renderDialog();
      await waitFor(() => expect(screen.getByText(TEAM_TARGET.text)).toBeTruthy());
      fireEvent.click(screen.getAllByText("Editar")[0]);
      fireEvent.change(screen.getByLabelText("Mensaje para el equipo"), { target: { value: "Lleguen 8:30" } });
      fireEvent.click(screen.getByText("Guardar"));
      await waitFor(() => expect(screen.getByText("Lleguen 8:30")).toBeTruthy());
      expect(JSON.parse(String(writesTo("/team-notes")[0][1].body))).toEqual({ teamNotes: "Lleguen 8:30", observed: TEAM_TARGET.observed });
      // A second save asserts the revision the first one returned.
      fireEvent.click(screen.getAllByText("Editar")[0]);
      fireEvent.click(screen.getByText("Guardar"));
      await waitFor(() => expect(writesTo("/team-notes")).toHaveLength(2));
      expect(JSON.parse(String(writesTo("/team-notes")[1][1].body)).observed).toEqual({ id: "featured-1", rev: "rev-2" });
    });

    it("moves the note into the pastor's message: pastor first, then clears the note", async () => {
      getBody = conversation({ teamNotes: TEAM_TARGET });
      writeReplies["/pastor-message"] = { status: 200, body: { ok: true, pastor_message: { ...PASTOR, body: TEAM_TARGET.text } } };
      writeReplies["/team-notes"] = { status: 200, body: { ok: true, teamNotes: null, observed: { id: "featured-1", rev: "rev-2" } } };
      renderDialog();
      await waitFor(() => expect(screen.getByText(TEAM_TARGET.text)).toBeTruthy());
      fireEvent.click(screen.getByText("Mover a mensaje del pastor"));
      fireEvent.click(screen.getByText("Sí, mover"));
      await waitFor(() => expect(screen.getByText("Este setlist no tiene mensaje para el equipo.")).toBeTruthy());
      const order = fetchMock.mock.calls.filter(([, init]) => init?.method === "PUT").map(([url]) => url);
      expect(order).toEqual([`${BASE}/pastor-message`, `${BASE}/team-notes`]);
      expect(JSON.parse(String(writesTo("/pastor-message")[0][1].body))).toEqual({ body: TEAM_TARGET.text, observed: null });
      expect(JSON.parse(String(writesTo("/team-notes")[0][1].body))).toEqual({ teamNotes: "", observed: TEAM_TARGET.observed });
      // Now in the pastor's box.
      expect(screen.getByText(TEAM_TARGET.text)).toBeTruthy();
    });

    it("keeps the note when only the second write of a move fails, and says so", async () => {
      getBody = conversation({ teamNotes: TEAM_TARGET });
      writeReplies["/pastor-message"] = { status: 200, body: { ok: true, pastor_message: { ...PASTOR, body: TEAM_TARGET.text } } };
      writeReplies["/team-notes"] = { status: 500, body: {} };
      renderDialog();
      await waitFor(() => expect(screen.getByText(TEAM_TARGET.text)).toBeTruthy());
      fireEvent.click(screen.getByText("Mover a mensaje del pastor"));
      fireEvent.click(screen.getByText("Sí, mover"));
      await waitFor(() => expect(screen.getByText(/Ya es el mensaje del pastor, pero no se pudo quitar de aquí/)).toBeTruthy());
      // In both places: nothing lost.
      expect(screen.getAllByText(TEAM_TARGET.text)).toHaveLength(2);
    });

    it("offers no move when a pastor's message already exists", async () => {
      getBody = conversation({ teamNotes: TEAM_TARGET, pastor_message: PASTOR });
      renderDialog();
      await waitFor(() => expect(screen.getByText(TEAM_TARGET.text)).toBeTruthy());
      expect(screen.queryByText("Mover a mensaje del pastor")).toBeNull();
    });
  });

  describe("own messages", () => {
    it("edits an admin's own service-thread message, never a proposal message", async () => {
      getBody = conversation({
        messages: [{ _key: "m1", author: "adm-1", author_name: "Frank", author_role: "admin", kind: "admin_change_request", body: "Ensayo 9", at: "2099-03-01T15:00:00.000Z" }],
        proposal: {
          _id: "setlistProposal.role-sun-1",
          messages: [{ _key: "p1", author: "adm-1", author_name: "Frank", author_role: "admin", kind: "admin_change_request", body: "En la propuesta", at: "2099-03-02T15:00:00.000Z" }],
        },
      });
      writeReplies["/messages/m1"] = {
        status: 200,
        body: { ok: true, messages: [{ _key: "m1", author: "adm-1", author_name: "Frank", author_role: "admin", kind: "admin_change_request", body: "Ensayo 10", at: "2099-03-01T15:00:00.000Z", edited_at: "2099-03-01T16:00:00.000Z" }] },
      };
      renderDialog();
      await waitFor(() => expect(screen.getByText("En la propuesta")).toBeTruthy());
      // One «Editar» in the conversation: the service-thread message only.
      const thread = screen.getByText("Conversación con los líderes").closest("section")!;
      const edits = Array.from(thread.querySelectorAll("button")).filter((b) => b.textContent === "Editar");
      expect(edits).toHaveLength(1);
      fireEvent.click(edits[0]);
      fireEvent.change(screen.getByLabelText("Editar mensaje"), { target: { value: "Ensayo 10" } });
      fireEvent.click(screen.getByText("Guardar"));
      await waitFor(() => expect(screen.getByText("Ensayo 10")).toBeTruthy());
      const [call] = writesTo("/messages/m1");
      expect(call[1].method).toBe("PATCH");
      expect(JSON.parse(String(call[1].body))).toEqual({ body: "Ensayo 10" });
    });

    it("deletes one and removes it locally when the read-back fails", async () => {
      getBody = conversation({
        messages: [{ _key: "m1", author: "adm-1", author_name: "Frank", author_role: "admin", kind: "admin_change_request", body: "Borrarme", at: "2099-03-01T15:00:00.000Z" }],
      });
      writeReplies["/messages/m1"] = { status: 200, body: { ok: true, messages: null } };
      renderDialog();
      await waitFor(() => expect(screen.getByText("Borrarme")).toBeTruthy());
      fireEvent.click(screen.getByText("Borrar"));
      fireEvent.click(screen.getByText("Sí, borrar"));
      await waitFor(() => expect(screen.queryByText("Borrarme")).toBeNull());
      expect(writesTo("/messages/m1")[0][1].method).toBe("DELETE");
    });
  });
});
