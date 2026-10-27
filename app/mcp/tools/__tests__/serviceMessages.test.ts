// Admin parity phase 3: the conversation tools (`get_service_messages` and its four writes) over
// fakes of `/admin`'s writers (`serviceThreadCommit.ts`, whose parity with the routes is the routes'
// own tests: `serviceThreadRoutes.test.ts`, `serviceMessageEditRoutes.test.ts`). What is proved here
// is the tool's own part: who writes, what it refuses before the writer, how it words the answer.
import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  loadServiceConversation: vi.fn(),
  loadActorName: vi.fn(),
  postServiceThreadMessage: vi.fn(),
  editServiceThreadMessage: vi.fn(),
  deleteServiceThreadMessage: vi.fn(),
  setPastorMessage: vi.fn(),
  saveTeamNotes: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("@/sanity/env", () => ({ apiVersion: "2024-07-23", dataset: "test", projectId: "test" }));
vi.mock("@/app/mcp/reads/serviceConversation", () => ({
  loadServiceConversation: h.loadServiceConversation,
  loadActorName: h.loadActorName,
}));
vi.mock("@/app/utils/serviceThreadCommit", () => ({
  postServiceThreadMessage: h.postServiceThreadMessage,
  editServiceThreadMessage: h.editServiceThreadMessage,
  deleteServiceThreadMessage: h.deleteServiceThreadMessage,
  setPastorMessage: h.setPastorMessage,
  saveTeamNotes: h.saveTeamNotes,
}));

import type { CallToolResult } from "@modelcontextprotocol/server";
import { PRINCIPAL, textOf } from "./monthToolFixtures";
import {
  EDIT_SERVICE_MESSAGE_INPUT,
  SEND_SERVICE_MESSAGE_DESCRIPTION,
  EDIT_SERVICE_MESSAGE_DESCRIPTION,
  SET_PASTOR_MESSAGE_DESCRIPTION,
  SET_TEAM_MESSAGE_DESCRIPTION,
  editServiceMessageResult,
  getServiceMessagesResult,
  sendServiceMessageResult,
  setPastorMessageResult,
  setTeamMessageResult,
} from "../serviceMessages";

const sc = (out: CallToolResult) => out.structuredContent as Record<string, unknown>;
const ROLE = "special-1";
const KEY = "k1a2b3c4d5e6";

function conversation(over: Record<string, unknown> = {}) {
  return {
    service: {
      _id: ROLE,
      _rev: "rev-role",
      _type: "special_role",
      service_name: "Noche de alabanza",
      time: "19:00",
      service_date: "2099-11-20",
      published: true,
      hasSongs: true,
      team_notes: "Llegar 18:00",
      leads: [{ id: "m-ana", name: "Ana" }, { id: "m-bruno", name: "Bruno" }],
      ...over,
    },
    messages: [
      { _key: KEY, author: PRINCIPAL.sub, author_name: "Frank", kind: "message", body: "Hola", at: "2026-10-27T10:00:00Z" },
      { _key: "k-other", author: "m-otro", author_name: "Otro", kind: "message", body: "Yo", at: "2026-10-27T11:00:00Z" },
    ],
    pastor_message: null,
    weekendSetlists: [],
    proposal: null,
  };
}

beforeEach(() => {
  for (const fn of Object.values(h)) fn.mockReset();
  h.loadServiceConversation.mockResolvedValue(conversation());
  h.loadActorName.mockResolvedValue("Frank");
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("get_service_messages", () => {
  it("reads the conversation: mine marks only the bearer's messages, the team message carries its observation", async () => {
    const out = await getServiceMessagesResult({ serviceId: ROLE }, PRINCIPAL);
    expect(out.isError).toBeFalsy();
    const body = sc(out);
    expect(body.leads).toEqual(["Ana", "Bruno"]);
    expect(body.threadOpen).toBe(true);
    expect((body.messages as { key: string; mine: boolean }[]).map((m) => [m.key, m.mine])).toEqual([
      [KEY, true],
      ["k-other", false],
    ]);
    expect(body.teamMessage).toEqual({ text: "Llegar 18:00", observed: { id: ROLE, rev: "rev-role" } });
    expect(body.pastorMessage).toBeNull();
  });

  it("answers no team message before the special has a setlist, and says so for an unknown service", async () => {
    h.loadServiceConversation.mockResolvedValueOnce(conversation({ hasSongs: false }));
    expect(sc(await getServiceMessagesResult({ serviceId: ROLE }, PRINCIPAL)).teamMessage).toBeNull();
    h.loadServiceConversation.mockResolvedValueOnce(null);
    const missing = await getServiceMessagesResult({ serviceId: ROLE }, PRINCIPAL);
    expect(textOf(missing)).toContain("No existe un servicio");
  });
});

describe("send_service_message", () => {
  it("refuses before any read when the bearer names nobody", async () => {
    const out = await sendServiceMessageResult({ serviceId: ROLE, body: "Hola" }, null);
    expect(out.isError).toBe(true);
    expect(textOf(out)).toContain("No se escribió nada");
    expect(h.loadServiceConversation).not.toHaveBeenCalled();
    expect(h.postServiceThreadMessage).not.toHaveBeenCalled();
  });

  it("writes as the bearer's member, with the name the leads' email shows, and names who is told", async () => {
    h.postServiceThreadMessage.mockResolvedValue({
      ok: true,
      status: 200,
      body: { ok: true },
      effects: { message: { _key: "k-new" }, notified: true, leadIds: ["m-ana", "m-bruno"] },
    });
    const out = await sendServiceMessageResult({ serviceId: ROLE, body: "Hola equipo" }, PRINCIPAL);
    expect(h.postServiceThreadMessage).toHaveBeenCalledWith(ROLE, { body: "Hola equipo" }, { id: PRINCIPAL.sub, name: "Frank" });
    expect(textOf(out)).toContain("Ana y Bruno");
    expect(sc(out)).toMatchObject({ ok: true, key: "k-new", notified: true });
  });

  it("never names the writer among the leads told (the writers never notify the author)", async () => {
    h.loadServiceConversation.mockResolvedValue(conversation({ leads: [{ id: PRINCIPAL.sub, name: "Frank" }, { id: "m-ana", name: "Ana" }] }));
    h.postServiceThreadMessage.mockResolvedValue({
      ok: true,
      status: 200,
      body: { ok: true },
      effects: { message: { _key: "k-new" }, notified: true, leadIds: [PRINCIPAL.sub, "m-ana"] },
    });
    const out = await sendServiceMessageResult({ serviceId: ROLE, body: "Hola" }, PRINCIPAL);
    expect(textOf(out)).toContain("en camino a Ana (");
    expect(textOf(out)).not.toContain("Frank");
  });

  it("says nobody is told on a draft", async () => {
    h.postServiceThreadMessage.mockResolvedValue({
      ok: true,
      status: 200,
      body: { ok: true },
      effects: { message: { _key: "k-new" }, notified: false, leadIds: [] },
    });
    const out = await sendServiceMessageResult({ serviceId: ROLE, body: "Hola" }, PRINCIPAL);
    expect(textOf(out)).toContain("borrador: nadie recibe aviso");
  });

  it("a thrown writer is an unknown outcome pointing at this conversation's read, never «No se escribió nada»", async () => {
    h.postServiceThreadMessage.mockRejectedValue(new Error("boom"));
    const out = await sendServiceMessageResult({ serviceId: ROLE, body: "Hola" }, PRINCIPAL);
    expect(out.isError).toBe(true);
    expect(textOf(out)).toContain("No se pudo confirmar");
    expect(textOf(out)).toContain("get_service_messages");
    expect(textOf(out)).not.toContain("No se escribió nada");
  });

  it("passes the writer's refusal through", async () => {
    h.postServiceThreadMessage.mockResolvedValue({ ok: false, status: 409, body: { error: "thread_closed" } });
    const out = await sendServiceMessageResult({ serviceId: ROLE, body: "Hola" }, PRINCIPAL);
    expect(out.isError).toBe(true);
  });
});

describe("edit_service_message", () => {
  it("takes body or delete, never both and never neither", async () => {
    const both = await editServiceMessageResult({ serviceId: ROLE, key: KEY, body: "x", delete: true }, PRINCIPAL);
    const neither = await editServiceMessageResult({ serviceId: ROLE, key: KEY }, PRINCIPAL);
    for (const out of [both, neither]) {
      expect(out.isError).toBe(true);
      expect(textOf(out)).toContain("no los dos");
    }
    expect(h.editServiceThreadMessage).not.toHaveBeenCalled();
    expect(h.deleteServiceThreadMessage).not.toHaveBeenCalled();
  });

  it("deletes or edits as the bearer's member", async () => {
    h.deleteServiceThreadMessage.mockResolvedValue({ ok: true, status: 200, body: { ok: true }, effects: {} });
    const del = await editServiceMessageResult({ serviceId: ROLE, key: KEY, delete: true }, PRINCIPAL);
    expect(h.deleteServiceThreadMessage).toHaveBeenCalledWith(ROLE, KEY, { id: PRINCIPAL.sub });
    expect(textOf(del)).toContain("Mensaje borrado");
    h.editServiceThreadMessage.mockResolvedValue({ ok: true, status: 200, body: { ok: true }, effects: {} });
    const edit = await editServiceMessageResult({ serviceId: ROLE, key: KEY, body: "Nuevo" }, PRINCIPAL);
    expect(h.editServiceThreadMessage).toHaveBeenCalledWith(ROLE, KEY, { body: "Nuevo" }, { id: PRINCIPAL.sub });
    expect(textOf(edit)).toContain("No se avisó a nadie");
  });

  it("words the writer's not_author as «solo tus propios mensajes»", async () => {
    h.editServiceThreadMessage.mockResolvedValue({ ok: false, status: 403, body: { error: "Forbidden", code: "not_author" } });
    const out = await editServiceMessageResult({ serviceId: ROLE, key: "k-other1", body: "x" }, PRINCIPAL);
    expect(out.isError).toBe(true);
    expect(textOf(out)).toContain("tus propios mensajes");
  });

  it("refuses a malformed key by schema", () => {
    expect(EDIT_SERVICE_MESSAGE_INPUT.safeParse({ serviceId: ROLE, key: "no es una clave!", body: "x" }).success).toBe(false);
  });
});

describe("set_pastor_message", () => {
  it("the first appearance names the leads told; an edit tells nobody", async () => {
    h.setPastorMessage.mockResolvedValueOnce({ ok: true, status: 200, body: { ok: true }, effects: { change: "set", notified: true } });
    const set = await setPastorMessageResult({ serviceId: ROLE, body: "Oremos", observed: null }, PRINCIPAL);
    expect(h.setPastorMessage).toHaveBeenCalledWith(ROLE, { body: "Oremos", observed: null }, { id: PRINCIPAL.sub, name: "Frank" });
    expect(textOf(set)).toContain("Ana y Bruno");
    h.setPastorMessage.mockResolvedValueOnce({ ok: true, status: 200, body: { ok: true }, effects: { change: "edit", notified: false } });
    const edit = await setPastorMessageResult({ serviceId: ROLE, body: "Oremos más", observed: "stamp" }, PRINCIPAL);
    expect(textOf(edit)).toContain("No se avisó a nadie");
  });
});

describe("set_team_message", () => {
  it("passes the observation through unchanged and says when nothing changed", async () => {
    h.saveTeamNotes.mockResolvedValue({
      ok: true,
      status: 200,
      body: { ok: true, observed: { id: ROLE, rev: "rev-2" } },
      effects: { written: false, teamNotes: "Llegar 18:00" },
    });
    const observed = { id: ROLE, rev: "rev-role" };
    const out = await setTeamMessageResult({ serviceId: ROLE, text: "Llegar 18:00", observed }, PRINCIPAL);
    expect(h.saveTeamNotes).toHaveBeenCalledWith(ROLE, { teamNotes: "Llegar 18:00", observed });
    expect(textOf(out)).toContain("no se escribió nada");
  });

  it("refuses without a principal before the writer", async () => {
    const out = await setTeamMessageResult({ serviceId: ROLE, text: "x", observed: { id: ROLE, rev: "r" } }, null);
    expect(out.isError).toBe(true);
    expect(h.saveTeamNotes).not.toHaveBeenCalled();
  });
});

describe("descriptions", () => {
  it("every write asks for the person's word on the exact text and a re-read after a refusal", () => {
    for (const d of [SEND_SERVICE_MESSAGE_DESCRIPTION, EDIT_SERVICE_MESSAGE_DESCRIPTION, SET_PASTOR_MESSAGE_DESCRIPTION, SET_TEAM_MESSAGE_DESCRIPTION]) {
      expect(d).toContain("texto EXACTO");
      expect(d).toContain("vuelve a leer con get_service_messages");
    }
  });
});
