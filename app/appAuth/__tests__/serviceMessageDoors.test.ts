// app/appAuth/__tests__/serviceMessageDoors.test.ts — the native app's «Mensajes del servicio»
// doors (ADR-0091 A-W2, spec `2026-11-28-native-service-messages-design.md` D2–D3): the read and
// the four writes onto the web's `serviceThreadCommit` writers. Who may use them is the web's rule
// (an active manager who is not a content-editor); every door 404s a malformed id before the fresh
// access read, re-reads access fresh, answers a writer throw with 503, reduces a refusal to code +
// conflict + issues, and sends no member id.
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const loadAppGrant = vi.hoisted(() => vi.fn());
vi.mock("@/app/appAuth/grantStore", () => ({
  APP_REVOKE_REASON: { signOut: "app_sign_out", member: "member_revoked", admin: "admin_revoked" },
  loadAppGrant,
}));

const getMemberAccess = vi.fn();
const fetchMemberAccessFresh = vi.fn();
vi.mock("@/app/utils/memberAccess", () => ({
  getMemberAccess: (...a: unknown[]) => getMemberAccess(...a),
  fetchMemberAccessFresh: (...a: unknown[]) => fetchMemberAccessFresh(...a),
}));

const postServiceThreadMessage = vi.fn();
const editServiceThreadMessage = vi.fn();
const deleteServiceThreadMessage = vi.fn();
const setPastorMessage = vi.fn();
const saveTeamNotes = vi.fn();
vi.mock("@/app/utils/serviceThreadCommit", () => ({
  postServiceThreadMessage: (...a: unknown[]) => postServiceThreadMessage(...a),
  editServiceThreadMessage: (...a: unknown[]) => editServiceThreadMessage(...a),
  deleteServiceThreadMessage: (...a: unknown[]) => deleteServiceThreadMessage(...a),
  setPastorMessage: (...a: unknown[]) => setPastorMessage(...a),
  saveTeamNotes: (...a: unknown[]) => saveTeamNotes(...a),
}));

const loadActorName = vi.fn();
vi.mock("@/app/mcp/reads/serviceConversation", () => ({ loadActorName: (...a: unknown[]) => loadActorName(...a) }));

const fetchRead = vi.fn();
vi.mock("@/sanity/lib/operationalClient", () => ({ operationalClient: { fetch: (...a: unknown[]) => fetchRead(...a) } }));

import { GET } from "@/app/api/app/v1/admin/service-threads/[roleId]/route";
import { POST } from "@/app/api/app/v1/admin/service-threads/[roleId]/messages/route";
import { DELETE, PATCH } from "@/app/api/app/v1/admin/service-threads/[roleId]/messages/[key]/route";
import { PUT as PUT_PASTOR } from "@/app/api/app/v1/admin/service-threads/[roleId]/pastor-message/route";
import { PUT as PUT_NOTES } from "@/app/api/app/v1/admin/service-threads/[roleId]/team-notes/route";
import { signAppAccessToken } from "../tokens";

const SECRET = "s".repeat(40);
const KEY = new TextEncoder().encode(SECRET);
const ORIGIN = "http://localhost:3000";
const GRANT_ID = "appAuthGrant.3b241101-e2bb-4255-8caf-4136c566a962";
const ADMIN = { active: true, role: "admin", ministries: ["worship"], managesMinistries: [], ministryRoles: [] };
const ROLE = "sunday-role-1";

const saved: Record<string, string | undefined> = {};
beforeAll(() => {
  for (const k of ["APP_AUTH_SECRET", "APP_AUTH_DISABLED", "VERCEL_ENV"]) saved[k] = process.env[k];
  process.env.APP_AUTH_SECRET = SECRET;
  delete process.env.APP_AUTH_DISABLED;
  delete process.env.VERCEL_ENV;
});
afterAll(() => {
  for (const [k, v] of Object.entries(saved)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
});

let consoleError: ReturnType<typeof vi.spyOn>;
beforeEach(() => {
  loadAppGrant.mockReset().mockResolvedValue({
    ok: true,
    grant: { _id: GRANT_ID, _rev: "r1", sub: "m1", clientId: "backstage-ios", platform: "ios", origin: ORIGIN, revoked: false },
  });
  getMemberAccess.mockReset().mockResolvedValue(ADMIN);
  fetchMemberAccessFresh.mockReset().mockResolvedValue(ADMIN);
  for (const w of [postServiceThreadMessage, editServiceThreadMessage, deleteServiceThreadMessage, setPastorMessage, saveTeamNotes]) {
    w.mockReset();
  }
  loadActorName.mockReset().mockResolvedValue("Frank");
  fetchRead.mockReset();
  consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
});

async function bearer(): Promise<Record<string, string>> {
  const { token } = await signAppAccessToken({ key: KEY, origin: ORIGIN, sub: "m1", grantId: GRANT_ID });
  return { host: "localhost:3000", authorization: `Bearer ${token}` };
}

type CallOpts = { id?: string; key?: string; body?: string; headers?: Record<string, string> };
const base = (id: string) => `${ORIGIN}/api/app/v1/admin/service-threads/${encodeURIComponent(id)}`;

async function req(url: string, method: string, opts: CallOpts, fallback: unknown): Promise<Request> {
  const withBody = method !== "GET" && method !== "DELETE";
  return new Request(url, {
    method,
    headers: { ...(opts.headers ?? (await bearer())), "content-type": "application/json" },
    ...(withBody ? { body: opts.body ?? JSON.stringify(fallback) } : {}),
  });
}

const read = async (o: CallOpts = {}) =>
  GET(await req(base(o.id ?? ROLE), "GET", o, null), { params: Promise.resolve({ roleId: o.id ?? ROLE }) });
const post = async (o: CallOpts = {}) =>
  POST(await req(`${base(o.id ?? ROLE)}/messages`, "POST", o, { body: "Hola" }), { params: Promise.resolve({ roleId: o.id ?? ROLE }) });
const patch = async (o: CallOpts = {}) =>
  PATCH(await req(`${base(o.id ?? ROLE)}/messages/${o.key ?? "k1"}`, "PATCH", o, { body: "Hola de nuevo" }), {
    params: Promise.resolve({ roleId: o.id ?? ROLE, key: o.key ?? "k1" }),
  });
const del = async (o: CallOpts = {}) =>
  DELETE(await req(`${base(o.id ?? ROLE)}/messages/${o.key ?? "k1"}`, "DELETE", o, null), {
    params: Promise.resolve({ roleId: o.id ?? ROLE, key: o.key ?? "k1" }),
  });
const pastor = async (o: CallOpts = {}) =>
  PUT_PASTOR(await req(`${base(o.id ?? ROLE)}/pastor-message`, "PUT", o, { body: "Dios les bendiga", observed: null }), {
    params: Promise.resolve({ roleId: o.id ?? ROLE }),
  });
const notes = async (o: CallOpts = {}) =>
  PUT_NOTES(await req(`${base(o.id ?? ROLE)}/team-notes`, "PUT", o, { teamNotes: "Ensayo 9:30", observed: { id: "featuredSongs.x", rev: "r1" } }), {
    params: Promise.resolve({ roleId: o.id ?? ROLE }),
  });

const ROWS = [
  { _key: "k1", author: "m1", author_name: "Frank", author_role: "admin", kind: "admin_change_request", body: "Va", at: "2099-01-01T18:05:00Z" },
  { _key: "k2", author: "m7", author_name: "Luis", author_role: "admin", kind: "admin_change_request", body: "Ok", at: "2099-01-01T18:06:00Z" },
];

const doors = [
  { name: "GET read", call: read, writer: () => fetchRead, json: false },
  { name: "POST message", call: post, writer: () => postServiceThreadMessage, json: true },
  { name: "PATCH message", call: patch, writer: () => editServiceThreadMessage, json: true },
  { name: "DELETE message", call: del, writer: () => deleteServiceThreadMessage, json: false },
  { name: "PUT pastor message", call: pastor, writer: () => setPastorMessage, json: true },
  { name: "PUT team notes", call: notes, writer: () => saveTeamNotes, json: true },
] as const;

describe.each(doors)("$name", ({ call, writer, json }) => {
  it("401s without a token and 403s a member or a content-editor, before any read or write", async () => {
    expect((await call({ headers: { host: "localhost:3000" } })).status).toBe(401);
    getMemberAccess.mockResolvedValueOnce({ ...ADMIN, role: "member" });
    expect((await call()).status).toBe(403);
    getMemberAccess.mockResolvedValueOnce({ ...ADMIN, role: "content-editor" });
    expect((await call()).status).toBe(403);
    expect(fetchMemberAccessFresh).not.toHaveBeenCalled();
    expect(writer()).not.toHaveBeenCalled();
  });

  it("404s a malformed id before the fresh access read", async () => {
    expect((await call({ id: "drafts.sunday-role-1" })).status).toBe(404);
    expect(fetchMemberAccessFresh).not.toHaveBeenCalled();
    expect(writer()).not.toHaveBeenCalled();
  });

  it("re-reads access fresh: inactive 401, demoted 403, failed 503 — no read or write after", async () => {
    fetchMemberAccessFresh.mockResolvedValueOnce({ ...ADMIN, active: false });
    const res = await call();
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: "account_disabled" });
    expect(fetchMemberAccessFresh).toHaveBeenCalledWith("m1");
    fetchMemberAccessFresh.mockResolvedValueOnce({ ...ADMIN, role: "member" });
    expect((await call()).status).toBe(403);
    fetchMemberAccessFresh.mockResolvedValueOnce({ ...ADMIN, role: "content-editor" });
    expect((await call()).status).toBe(403);
    fetchMemberAccessFresh.mockRejectedValueOnce(new Error("sanity down"));
    expect((await call()).status).toBe(503);
    expect(writer()).not.toHaveBeenCalled();
  });

  it("lets a worship-less admin and a super-admin in (the web's rule, no ministry check)", async () => {
    fetchRead.mockResolvedValue(null);
    for (const w of [postServiceThreadMessage, editServiceThreadMessage, deleteServiceThreadMessage, setPastorMessage, saveTeamNotes]) {
      w.mockResolvedValue({ ok: false, status: 404, body: { error: "not_found", conflict: false } });
    }
    getMemberAccess.mockResolvedValueOnce({ ...ADMIN, ministries: ["kids"] });
    fetchMemberAccessFresh.mockResolvedValueOnce({ ...ADMIN, ministries: ["kids"] });
    expect((await call()).status).toBe(404);
    getMemberAccess.mockResolvedValueOnce({ ...ADMIN, role: "super-admin", ministries: [] });
    fetchMemberAccessFresh.mockResolvedValueOnce({ ...ADMIN, role: "super-admin", ministries: [] });
    expect((await call()).status).toBe(404);
    expect(writer()).toHaveBeenCalledTimes(2);
  });

  it("a throw from the read or the writer is 503", async () => {
    writer().mockRejectedValueOnce(new Error("boom"));
    expect((await call()).status).toBe(503);
  });

  if (json) {
    it("answers a body that is not JSON as the web does, with no write", async () => {
      const res = await call({ body: "{nope" });
      expect(res.status).toBe(400);
      expect(await res.json()).toEqual({ error: "invalid_request", conflict: false, details: { issues: ["json"] } });
      expect(writer()).not.toHaveBeenCalled();
    });
  }

  if (writer() !== fetchRead) {
    it("reduces a refusal to code, conflict and string issues (no member id, no detail)", async () => {
      writer().mockResolvedValueOnce({
        ok: false,
        status: 409,
        body: { error: "stale_revision", conflict: true, details: { id: "serviceThread.x", detail: "pastor_message_moved", by: "m9" } },
      });
      let res = await call();
      expect(res.status).toBe(409);
      expect(await res.json()).toEqual({ error: "stale_revision", conflict: true });

      writer().mockResolvedValueOnce({ ok: false, status: 400, body: { error: "invalid_request", conflict: false, details: { issues: ["thread_closed"], extra: "m9" } } });
      res = await call();
      expect(res.status).toBe(400);
      expect(await res.json()).toEqual({ error: "invalid_request", conflict: false, details: { issues: ["thread_closed"] } });
    });
  }
});

describe("GET /api/app/v1/admin/service-threads/[roleId]", () => {
  it("reads the conversation and answers names only, the two threads apart", async () => {
    fetchRead.mockResolvedValueOnce({
      service: {
        _id: ROLE, _rev: "rr", _type: "sunday_role", service_date: "2099-01-04", published: true, hasSongs: false,
        leads: [{ id: "m7", name: "Luis" }],
      },
      messages: [ROWS[0]],
      pastor_message: { body: "Bendiciones", at: "2099-01-01T10:00:00Z", edited_at: null, author: "m1", author_name: "Frank" },
      weekendSetlists: [{ _id: "featuredSongs.x", _rev: "s1", _type: "featuredSongs", team_notes: "Llegar 9" }],
      proposal: { _id: "setlistProposal.p", status: "pending", pastor_message: "Otro texto", messages: [ROWS[1]] },
    });
    const res = await read();
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toContain("no-store");
    const body = await res.json();
    expect(body.service).toEqual({ id: ROLE, kind: "sunday", date: "2099-01-04", title: "Domingo", published: true, leads: ["Luis"] });
    expect(body.open).toBe(true);
    expect(body.pastorMessage).toEqual({ body: "Bendiciones", authorName: "Frank", at: "2099-01-01T10:00:00Z", editedAt: null, stamp: "2099-01-01T10:00:00Z" });
    expect(body.teamNotes).toEqual({ text: "Llegar 9", observed: { id: "featuredSongs.x", rev: "s1" } });
    expect(body.proposal).toEqual({ status: "pending", offeredPastorMessage: "Otro texto" });
    expect(body.serviceMessages.map((m: { key: string; editable: boolean }) => [m.key, m.editable])).toEqual([["k1", true]]);
    expect(body.proposalMessages.map((m: { key: string; editable: boolean }) => [m.key, m.editable])).toEqual([["k2", false]]);
    const text = JSON.stringify(body);
    for (const id of ["m1", "m7"]) expect(text).not.toContain(`"${id}"`);
  });

  it("no such service is 404", async () => {
    fetchRead.mockResolvedValueOnce({ service: null });
    expect((await read()).status).toBe(404);
  });
});

describe("the write doors' answers", () => {
  it("POST hands the writer the path id, the raw body and the live name; answers the service thread only", async () => {
    postServiceThreadMessage.mockResolvedValueOnce({ ok: true, status: 200, body: { ok: true, message: { author: { _ref: "m1" } }, messages: ROWS } });
    const res = await post();
    expect(postServiceThreadMessage).toHaveBeenCalledWith(ROLE, { body: "Hola" }, { id: "m1", name: "Frank" });
    const body = await res.json();
    expect(Object.keys(body)).toEqual(["serviceMessages"]);
    expect(body.serviceMessages.map((m: { mine: boolean; editable: boolean }) => [m.mine, m.editable])).toEqual([[true, true], [false, false]]);
    expect(JSON.stringify(body)).not.toContain('"m1"');
  });

  it("a failed name read still writes, with no name (the mail says «Un admin»)", async () => {
    loadActorName.mockRejectedValueOnce(new Error("down"));
    postServiceThreadMessage.mockResolvedValueOnce({ ok: true, status: 200, body: { ok: true, messages: null } });
    const res = await post();
    expect(postServiceThreadMessage).toHaveBeenCalledWith(ROLE, { body: "Hola" }, { id: "m1", name: "" });
    expect(await res.json()).toEqual({ serviceMessages: null });
  });

  it("PATCH and DELETE pass the key and the caller; a malformed key is 404 before any read", async () => {
    editServiceThreadMessage.mockResolvedValueOnce({ ok: true, status: 200, body: { ok: true, messages: [] } });
    await patch();
    expect(editServiceThreadMessage).toHaveBeenCalledWith(ROLE, "k1", { body: "Hola de nuevo" }, { id: "m1" });
    deleteServiceThreadMessage.mockResolvedValueOnce({ ok: true, status: 200, body: { ok: true, messages: null } });
    expect(await (await del()).json()).toEqual({ serviceMessages: null });
    expect(deleteServiceThreadMessage).toHaveBeenCalledWith(ROLE, "k1", { id: "m1" });

    fetchMemberAccessFresh.mockClear();
    expect((await patch({ key: "a.b" })).status).toBe(404);
    expect((await del({ key: "a]b" })).status).toBe(404);
    expect(fetchMemberAccessFresh).not.toHaveBeenCalled();
  });

  it("the pastor PUT answers no member id, even from the writer's fallback row", async () => {
    setPastorMessage.mockResolvedValueOnce({
      ok: true,
      status: 200,
      body: { ok: true, pastor_message: { _type: "pastor_message", body: "Dios les bendiga", author: "m1", at: "2099-01-01T10:00:00Z" } },
    });
    const res = await pastor();
    expect(setPastorMessage).toHaveBeenCalledWith(ROLE, { body: "Dios les bendiga", observed: null }, { id: "m1", name: "Frank" });
    const body = await res.json();
    expect(body).toEqual({
      pastorMessage: { body: "Dios les bendiga", authorName: "Frank", at: "2099-01-01T10:00:00Z", editedAt: null, stamp: "2099-01-01T10:00:00Z" },
    });
    setPastorMessage.mockResolvedValueOnce({ ok: true, status: 200, body: { ok: true, pastor_message: null } });
    expect(await (await pastor()).json()).toEqual({ pastorMessage: null });
  });

  it("the team-notes PUT answers the note and the observed target verbatim", async () => {
    saveTeamNotes.mockResolvedValueOnce({ ok: true, status: 200, body: { ok: true, teamNotes: "Ensayo 9:30", observed: { id: "featuredSongs.x", rev: "tx2" } } });
    const res = await notes();
    expect(saveTeamNotes).toHaveBeenCalledWith(ROLE, { teamNotes: "Ensayo 9:30", observed: { id: "featuredSongs.x", rev: "r1" } });
    expect(await res.json()).toEqual({ teamNotes: "Ensayo 9:30", observed: { id: "featuredSongs.x", rev: "tx2" } });
  });
});
