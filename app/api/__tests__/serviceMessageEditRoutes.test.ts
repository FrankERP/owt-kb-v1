// The three EDIT writers of a service's messages (ADR-0065, amended 2026-10-24),
// at the route level:
//   • `PUT …/pastor-message` — the service's ONE pastor's message, checked
//     against the stamp the admin saw, notifying the leads only when it appears;
//   • `PUT …/team-notes`     — the live setlist's «Mensaje para el equipo»,
//     resolved like the setlist PUT and written under the observed `_rev`;
//   • `PATCH|DELETE …/messages/[key]` — an admin's OWN service-thread message.
//
// Every write is RECORDED (which document, which precondition, which fields), so
// a test fails when a precondition silently goes missing — a mocked chain
// succeeds either way.

import { beforeEach, describe, expect, it, vi } from "vitest";
import type { NextRequest } from "next/server";
import { evaluate, parse } from "groq-js";

vi.mock("server-only", () => ({}));

const requireActiveManagerMock = vi.fn();
const operationalFetch = vi.fn();
const loadCanonicalRoleMock = vi.fn();
const loadSpecialMock = vi.fn();
const loadWeekendMock = vi.fn();
const loadCoordinationMock = vi.fn();
const revalidateMock = vi.fn();
const notifyMock = vi.fn();

const afterCallbacks: (() => unknown)[] = [];
vi.mock("next/server", async (orig) => {
  const mod = await orig<typeof import("next/server")>();
  return { ...mod, after: (fn: () => unknown) => void afterCallbacks.push(fn) };
});
async function drainAfter(): Promise<void> {
  for (let guard = 0; guard < 10 && afterCallbacks.length; guard++) {
    const batch = afterCallbacks.splice(0);
    for (const cb of batch) await cb();
  }
}

vi.mock("@/app/utils/authGuards", () => ({ requireActiveManager: () => requireActiveManagerMock() }));
vi.mock("@/sanity/lib/operationalClient", () => ({
  operationalClient: { fetch: (...a: unknown[]) => operationalFetch(...a) },
  rawIntegrityClient: { fetch: vi.fn(async () => []) },
}));
vi.mock("@/app/utils/roleWriteOps", async (orig) => ({
  ...(await orig<Record<string, unknown>>()),
  loadCanonicalRole: (...a: unknown[]) => loadCanonicalRoleMock(...a),
}));
vi.mock("@/app/utils/serviceWriteTargets", () => ({
  loadSpecialSetlistTarget: (...a: unknown[]) => loadSpecialMock(...a),
  loadWeekendSetlistTarget: (...a: unknown[]) => loadWeekendMock(...a),
  loadWeekendCoordination: (...a: unknown[]) => loadCoordinationMock(...a),
}));
vi.mock("@/app/utils/revalidate", () => ({ revalidateServiceViews: () => revalidateMock() }));
vi.mock("@/app/utils/serviceThreadNotify", () => ({
  notifyLeadsAboutServiceMessage: (...a: unknown[]) => notifyMock(...a),
}));

/** One recorded write: a patch (with its precondition), a create, or a tx. */
interface Op {
  kind: "patch" | "create";
  id: string;
  ifRevisionId?: string;
  set?: Record<string, unknown>;
  unset?: string[];
  doc?: Record<string, unknown>;
}
let committed: Op[][] = [];
const commitOutcomes: (Error | undefined)[] = [];

function patchBuilder(id: string, ops: Op[]) {
  const op: Op = { kind: "patch", id };
  ops.push(op);
  const p = {
    ifRevisionId(rev: string) {
      op.ifRevisionId = rev;
      return p;
    },
    set(values: Record<string, unknown>) {
      op.set = { ...op.set, ...values };
      return p;
    },
    unset(paths: string[]) {
      op.unset = [...(op.unset ?? []), ...paths];
      return p;
    },
    async commit() {
      return commit(ops);
    },
  };
  return p;
}

async function commit(ops: Op[]) {
  const outcome = commitOutcomes.shift();
  if (outcome) throw outcome;
  committed.push(ops);
  return { transactionId: "tx-new" };
}

vi.mock("@/sanity/lib/serverClient", () => ({
  serverClient: { fetch: vi.fn() },
  writeClient: {
    patch: (id: string) => patchBuilder(id, []),
    async create(doc: Record<string, unknown>) {
      return commit([{ kind: "create", id: String(doc._id), doc }]);
    },
    transaction() {
      const ops: Op[] = [];
      const tx = {
        patch(id: string, fn: (p: ReturnType<typeof patchBuilder>) => unknown) {
          fn(patchBuilder(id, ops));
          return tx;
        },
        commit: () => commit(ops),
      };
      return tx;
    },
  },
}));

import { PUT as pastorPut } from "@/app/api/admin/service-threads/[roleId]/pastor-message/route";
import { PUT as teamNotesPut } from "@/app/api/admin/service-threads/[roleId]/team-notes/route";
import { DELETE as messageDelete, PATCH as messagePatch } from "@/app/api/admin/service-threads/[roleId]/messages/[key]/route";
import { GET as conversationGet } from "@/app/api/admin/service-threads/[roleId]/messages/route";
import { serviceConversationQuery } from "@/app/utils/serviceReadQueries";
import { pastorMessageBodyOf } from "@/app/utils/serviceThread";

// ── Fixtures ────────────────────────────────────────────────────────────────

const ROLE_ID = "role-sun-1";
const THREAD_ID = `serviceThread.${ROLE_ID}`;

function role(over: Record<string, unknown> = {}) {
  return {
    _id: ROLE_ID,
    _rev: "r1",
    _type: "sunday_role",
    week: "2099-03-08",
    published: true,
    Lead: [{ _key: "a", _type: "reference", _ref: "lead-1" }],
    ...over,
  };
}

function admin(r = "admin", sanityId = "admin-1") {
  return { user: { role: r, sanityId, alias: "Frank" } };
}

function req(body: unknown) {
  return { json: async () => body } as unknown as NextRequest;
}
const params = (extra: Record<string, string> = {}) => ({ params: Promise.resolve({ roleId: ROLE_ID, ...extra }) });

function conflict(type = "documentRevisionIDDoesNotMatchError") {
  return Object.assign(new Error("conflict"), {
    statusCode: 409,
    details: { type: "mutationError", items: [{ error: { type } }] },
  });
}

/** What the thread read answers, per test. */
let storedThread: Record<string, unknown> | null;
let messageAuthor: string | null;
/** The team note stored at the asserted revision; `undefined` = the doc moved (no row). */
let notesAtRev: string | null | undefined;

beforeEach(() => {
  vi.clearAllMocks();
  committed = [];
  commitOutcomes.length = 0;
  afterCallbacks.length = 0;
  storedThread = null;
  messageAuthor = "admin-1";
  notesAtRev = "Nota anterior";
  requireActiveManagerMock.mockResolvedValue(admin());
  loadCanonicalRoleMock.mockResolvedValue({ role: role(), state: "single", draftIds: [] });
  notifyMock.mockResolvedValue(undefined);
  operationalFetch.mockImplementation(async (query: string) => {
    if (query.includes(".messages[_key == $key][0]")) return messageAuthor ? { author: messageAuthor } : null;
    if (query.includes("{ _id, _rev, pastor_message }")) return storedThread;
    if (query.includes('"notes": team_notes')) return notesAtRev === undefined ? null : { notes: notesAtRev };
    if (query.includes(".pastor_message{")) return { body: "leído", at: "2099-03-01T15:00:00.000Z", author: "admin-1", author_name: "Frank" };
    if (query.includes("_id == $threadId")) return { _id: THREAD_ID, _rev: "t9", messages: [{ _key: "m1", body: "fresco" }] };
    return null;
  });
});

// ── PUT …/pastor-message ────────────────────────────────────────────────────

describe("PUT /api/admin/service-threads/[roleId]/pastor-message", () => {
  it("is admin-only and validates before reading", async () => {
    requireActiveManagerMock.mockResolvedValueOnce(null);
    expect((await pastorPut(req({ body: "x", observed: null }), params())).status).toBe(403);
    requireActiveManagerMock.mockResolvedValueOnce(admin("content-editor"));
    expect((await pastorPut(req({ body: "x", observed: null }), params())).status).toBe(403);
    expect((await pastorPut(req({ body: 3, observed: null }), params())).status).toBe(400);
    expect((await pastorPut(req({ body: "x", observed: 5 }), params())).status).toBe(400);
    expect((await pastorPut(req({ body: "x", observed: null }), { params: Promise.resolve({ roleId: "drafts.x" }) })).status).toBe(400);
    expect(committed).toHaveLength(0);
  });

  it("creates the thread with the message when there is none, and notifies the leads once", async () => {
    const res = await pastorPut(req({ body: "  Efesios 2  ", observed: null }), params());
    expect(res.status).toBe(200);
    expect(committed).toHaveLength(1);
    const [op] = committed[0];
    expect(op).toMatchObject({
      kind: "create",
      id: THREAD_ID,
      doc: {
        _type: "serviceThread",
        role_id: ROLE_ID,
        messages: [],
        pastor_message: { _type: "pastor_message", body: "Efesios 2", author: { _ref: "admin-1", _type: "reference" } },
      },
    });
    // First set: no `edited_at`.
    expect((op.doc!.pastor_message as Record<string, unknown>).edited_at).toBeUndefined();
    expect(revalidateMock).toHaveBeenCalledTimes(1);
    await drainAfter();
    expect(notifyMock).toHaveBeenCalledTimes(1);
    expect(notifyMock.mock.calls[0][0]).toMatchObject({ leadIds: ["lead-1"], pastor: true, body: "Efesios 2", roleId: ROLE_ID });
    expect((await res.json()).pastor_message).toMatchObject({ body: "leído" });
  });

  it("adds one to an EXISTING thread under its `_rev`", async () => {
    storedThread = { _id: THREAD_ID, _rev: "t1", pastor_message: null };
    await pastorPut(req({ body: "Efesios 2", observed: null }), params());
    expect(committed[0][0]).toMatchObject({ kind: "patch", id: THREAD_ID, ifRevisionId: "t1" });
    expect(committed[0][0].set?.pastor_message).toMatchObject({ body: "Efesios 2" });
    await drainAfter();
    expect(notifyMock).toHaveBeenCalledTimes(1);
  });

  it("edits against the stamp, keeps the first `at`, stamps `edited_at` and sends nothing", async () => {
    storedThread = { _id: THREAD_ID, _rev: "t1", pastor_message: { body: "Efesios", at: "2099-03-01T15:00:00.000Z" } };
    const res = await pastorPut(req({ body: "Efesios 2", observed: "2099-03-01T15:00:00.000Z" }), params());
    expect(res.status).toBe(200);
    const set = committed[0][0].set?.pastor_message as Record<string, unknown>;
    expect(set).toMatchObject({ body: "Efesios 2", at: "2099-03-01T15:00:00.000Z" });
    expect(typeof set.edited_at).toBe("string");
    await drainAfter();
    expect(notifyMock).not.toHaveBeenCalled();
  });

  it("refuses with 409 when the stored stamp is not the one observed, writing nothing", async () => {
    storedThread = {
      _id: THREAD_ID,
      _rev: "t1",
      pastor_message: { body: "Efesios", at: "2099-03-01T15:00:00.000Z", edited_at: "2099-03-02T15:00:00.000Z" },
    };
    for (const observed of [null, "2099-03-01T15:00:00.000Z"]) {
      const res = await pastorPut(req({ body: "otro", observed }), params());
      expect(res.status).toBe(409);
    }
    expect(committed).toHaveLength(0);
  });

  it("refuses an add when one appeared meanwhile (observed null, stored present)", async () => {
    storedThread = { _id: THREAD_ID, _rev: "t1", pastor_message: { body: "Ya", at: "2099-03-01T15:00:00.000Z" } };
    expect((await pastorPut(req({ body: "otro", observed: null }), params())).status).toBe(409);
    expect(committed).toHaveLength(0);
  });

  it("clears with an empty body, sending nothing; clearing nothing writes nothing", async () => {
    storedThread = { _id: THREAD_ID, _rev: "t1", pastor_message: { body: "Efesios", at: "2099-03-01T15:00:00.000Z" } };
    const res = await pastorPut(req({ body: "  ", observed: "2099-03-01T15:00:00.000Z" }), params());
    expect(res.status).toBe(200);
    expect(committed[0][0]).toMatchObject({ kind: "patch", ifRevisionId: "t1", unset: ["pastor_message"] });
    expect(committed[0][0].set).toBeUndefined();

    committed = [];
    storedThread = { _id: THREAD_ID, _rev: "t2" };
    const none = await pastorPut(req({ body: "", observed: null }), params());
    expect(none.status).toBe(200);
    expect(committed).toHaveLength(0);
    await drainAfter();
    expect(notifyMock).not.toHaveBeenCalled();
  });

  it("maps a revision conflict or a concurrent create to 409", async () => {
    storedThread = { _id: THREAD_ID, _rev: "t1", pastor_message: null };
    commitOutcomes.push(conflict());
    expect((await pastorPut(req({ body: "x", observed: null }), params())).status).toBe(409);
    storedThread = null;
    commitOutcomes.push(conflict("documentAlreadyExistsError"));
    expect((await pastorPut(req({ body: "x", observed: null }), params())).status).toBe(409);
    await drainAfter();
    expect(notifyMock).not.toHaveBeenCalled();
  });

  it("stores but does not notify on an unpublished service", async () => {
    loadCanonicalRoleMock.mockResolvedValue({ role: role({ published: false }), state: "single", draftIds: [] });
    expect((await pastorPut(req({ body: "Efesios 2", observed: null }), params())).status).toBe(200);
    expect(committed).toHaveLength(1);
    await drainAfter();
    expect(notifyMock).not.toHaveBeenCalled();
  });

  it("answers 404 for an unknown service", async () => {
    loadCanonicalRoleMock.mockResolvedValue({ role: null, state: "none", draftIds: [] });
    expect((await pastorPut(req({ body: "x", observed: null }), params())).status).toBe(404);
  });
});

// ── PUT …/team-notes ────────────────────────────────────────────────────────

describe("PUT /api/admin/service-threads/[roleId]/team-notes", () => {
  const OBSERVED = { id: "featuredSongs.2099-03-08", rev: "s1" };
  const LOCK = { _id: "roleTargetLock.sunday.2099-03-08", _rev: "l1", _type: "roleTargetLock" };

  beforeEach(() => {
    loadWeekendMock.mockResolvedValue({ ok: true, target: { server: { state: "single", ...OBSERVED }, record: {} } });
    loadCoordinationMock.mockResolvedValue({ ok: true, coordination: { role: role(), lock: LOCK, bootstrapped: false } });
  });

  it("is admin-only and validates the body before reading", async () => {
    requireActiveManagerMock.mockResolvedValueOnce(admin("content-editor"));
    expect((await teamNotesPut(req({ teamNotes: "x", observed: OBSERVED }), params())).status).toBe(403);
    expect((await teamNotesPut(req({ teamNotes: "x" }), params())).status).toBe(400);
    expect((await teamNotesPut(req({ teamNotes: 1, observed: OBSERVED }), params())).status).toBe(400);
    expect(loadWeekendMock).not.toHaveBeenCalled();
  });

  it("writes ONE field under the observed `_rev` and heartbeats the weekend lock in the same tx", async () => {
    const res = await teamNotesPut(req({ teamNotes: " Lleguen 8:30 ", observed: OBSERVED }), params());
    expect(res.status).toBe(200);
    expect(loadWeekendMock).toHaveBeenCalledWith("featuredSongs", "2099-03-08");
    expect(loadCoordinationMock).toHaveBeenCalledWith({ roleType: "sunday_role", week: "2099-03-08" });
    expect(committed).toHaveLength(1);
    const [setlist, lock] = committed[0];
    expect(setlist).toEqual({ kind: "patch", id: OBSERVED.id, ifRevisionId: "s1", set: { team_notes: "Lleguen 8:30" } });
    expect(lock).toMatchObject({ kind: "patch", id: LOCK._id, ifRevisionId: "l1" });
    expect(Object.keys(lock.set ?? {})).toEqual(["updatedAt"]);
    expect(revalidateMock).toHaveBeenCalledTimes(1);
    // The new revision is the transaction id, so the dialog can save again.
    expect(await res.json()).toEqual({ ok: true, teamNotes: "Lleguen 8:30", observed: { id: OBSERVED.id, rev: "tx-new" } });
  });

  it("writes nothing for an unchanged note and hands back the observed target", async () => {
    notesAtRev = "Igual";
    const res = await teamNotesPut(req({ teamNotes: " Igual ", observed: OBSERVED }), params());
    expect(await res.json()).toEqual({ ok: true, teamNotes: "Igual", observed: OBSERVED });
    // The stored note is read pinned to the revision just compared.
    const read = operationalFetch.mock.calls.find(([q]) => String(q).includes('"notes": team_notes'));
    expect(read?.[1]).toEqual({ id: OBSERVED.id, rev: "s1" });
    // Empty stays empty too.
    notesAtRev = null;
    expect(await (await teamNotesPut(req({ teamNotes: "", observed: OBSERVED }), params())).json()).toMatchObject({ observed: OBSERVED });
    expect(committed).toHaveLength(0);
  });

  it("clears a note even though the loaders' projections carry no `team_notes` (dev, 2026-10-24)", async () => {
    // The regression: the "unchanged" check read the loader's record, whose
    // projection has no `team_notes`, so every note looked empty and clearing
    // one was skipped as a no-op.
    loadWeekendMock.mockResolvedValueOnce({ ok: true, target: { server: { state: "single", ...OBSERVED }, record: { _id: OBSERVED.id } } });
    notesAtRev = "La plática es de la Justicia";
    await teamNotesPut(req({ teamNotes: "", observed: OBSERVED }), params());
    expect(committed[0][0]).toEqual({ kind: "patch", id: OBSERVED.id, ifRevisionId: "s1", unset: ["team_notes"] });
  });

  it("writes (and lets the precondition answer) when the document moved since the compare", async () => {
    notesAtRev = undefined;
    commitOutcomes.push(conflict());
    expect((await teamNotesPut(req({ teamNotes: "Nota anterior", observed: OBSERVED }), params())).status).toBe(409);
  });

  it("reads a Saturday's setlist as `saturdarSongs`", async () => {
    loadCanonicalRoleMock.mockResolvedValue({ role: role({ _type: "saturday_role", week: "2099-03-07" }), state: "single", draftIds: [] });
    await teamNotesPut(req({ teamNotes: "x", observed: OBSERVED }), params());
    expect(loadWeekendMock).toHaveBeenCalledWith("saturdarSongs", "2099-03-07");
    expect(loadCoordinationMock).toHaveBeenCalledWith({ roleType: "saturday_role", week: "2099-03-07" });
  });

  it("unsets the note when it is empty", async () => {
    await teamNotesPut(req({ teamNotes: "", observed: OBSERVED }), params());
    expect(committed[0][0]).toEqual({ kind: "patch", id: OBSERVED.id, ifRevisionId: "s1", unset: ["team_notes"] });
  });

  it("writes a special's note on its role, with no lock", async () => {
    loadCanonicalRoleMock.mockResolvedValue({
      role: role({ _type: "special_role", date: "2099-03-10", week: undefined }),
      state: "single",
      draftIds: [],
    });
    loadSpecialMock.mockResolvedValue({ ok: true, target: { server: { state: "single", id: ROLE_ID, rev: "r1" } } });
    const res = await teamNotesPut(req({ teamNotes: "Noche", observed: { id: ROLE_ID, rev: "r1" } }), params());
    expect(res.status).toBe(200);
    expect(loadSpecialMock).toHaveBeenCalledWith(ROLE_ID, "2099-03-10");
    expect(loadCoordinationMock).not.toHaveBeenCalled();
    expect(committed[0]).toEqual([{ kind: "patch", id: ROLE_ID, ifRevisionId: "r1", set: { team_notes: "Noche" } }]);
  });

  it("refuses with 409 when there is no setlist, or it is not the one observed", async () => {
    loadWeekendMock.mockResolvedValueOnce({ ok: true, target: { server: { state: "none" }, record: null } });
    const none = await teamNotesPut(req({ teamNotes: "x", observed: OBSERVED }), params());
    expect(none.status).toBe(409);
    expect(await none.json()).toMatchObject({ details: { detail: "no_setlist" } });
    for (const server of [
      { state: "single", id: OBSERVED.id, rev: "s2" },
      { state: "single", id: "featuredSongs.other", rev: "s1" },
    ]) {
      loadWeekendMock.mockResolvedValueOnce({ ok: true, target: { server, record: {} } });
      expect((await teamNotesPut(req({ teamNotes: "x", observed: OBSERVED }), params())).status).toBe(409);
    }
    expect(committed).toHaveLength(0);
  });

  it("passes on a loader's fail-closed refusal (duplicates, raw drafts)", async () => {
    loadWeekendMock.mockResolvedValueOnce({ ok: false, failure: { code: "ambiguous_target", details: {} } });
    expect((await teamNotesPut(req({ teamNotes: "x", observed: OBSERVED }), params())).status).toBe(409);
    expect(committed).toHaveLength(0);
  });

  it("maps a revision conflict at commit to 409", async () => {
    commitOutcomes.push(conflict());
    expect((await teamNotesPut(req({ teamNotes: "x", observed: OBSERVED }), params())).status).toBe(409);
    expect(revalidateMock).not.toHaveBeenCalled();
  });
});

// ── PATCH|DELETE …/messages/[key] ───────────────────────────────────────────

describe("PATCH|DELETE /api/admin/service-threads/[roleId]/messages/[key]", () => {
  const p = (key = "m1") => ({ params: Promise.resolve({ roleId: ROLE_ID, key }) });

  it("edits the author's own message on ONE path, with no revision precondition", async () => {
    const res = await messagePatch(req({ body: "  Ensayo 10 " }), p());
    expect(res.status).toBe(200);
    const [op] = committed[0];
    expect(op.id).toBe(THREAD_ID);
    expect(op.ifRevisionId).toBeUndefined();
    expect(op.set).toMatchObject({ 'messages[_key=="m1"].body': "Ensayo 10" });
    expect(typeof op.set?.['messages[_key=="m1"].edited_at']).toBe("string");
    expect(await res.json()).toEqual({ ok: true, messages: [{ _key: "m1", body: "fresco" }] });
  });

  it("deletes the author's own message", async () => {
    const res = await messageDelete(req(undefined), p());
    expect(res.status).toBe(200);
    expect(committed[0][0]).toMatchObject({ id: THREAD_ID, unset: ['messages[_key=="m1"]'] });
  });

  it("refuses another admin's message (403), a missing one (404) and a bad key (400)", async () => {
    messageAuthor = "admin-2";
    const other = await messagePatch(req({ body: "x" }), p());
    expect(other.status).toBe(403);
    expect(await other.json()).toMatchObject({ code: "not_author" });
    expect((await messageDelete(req(undefined), p())).status).toBe(403);
    messageAuthor = null;
    expect((await messagePatch(req({ body: "x" }), p())).status).toBe(404);
    expect((await messagePatch(req({ body: "x" }), p('a"]'))).status).toBe(400);
    expect(committed).toHaveLength(0);
  });

  it("refuses both once the service has passed, like the POST", async () => {
    loadCanonicalRoleMock.mockResolvedValue({ role: role({ week: "2020-03-08" }), state: "single", draftIds: [] });
    const res = await messagePatch(req({ body: "x" }), p());
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ details: { issues: ["thread_closed"] } });
    expect((await messageDelete(req(undefined), p())).status).toBe(400);
    expect(committed).toHaveLength(0);
  });

  it("refuses an empty edit and a content-editor", async () => {
    expect((await messagePatch(req({ body: "  " }), p())).status).toBe(400);
    requireActiveManagerMock.mockResolvedValueOnce(admin("content-editor"));
    expect((await messageDelete(req(undefined), p())).status).toBe(403);
    expect(committed).toHaveLength(0);
  });
});

// ── GET …/messages: the team-note target ────────────────────────────────────

describe("GET …/messages — where the team note lives", () => {
  function get() {
    return conversationGet({} as NextRequest, params());
  }

  it("names the ONE weekend setlist of the service's type, and hides the raw fields", async () => {
    operationalFetch.mockResolvedValueOnce({
      service: { _id: ROLE_ID, _rev: "r1", _type: "sunday_role", team_notes: null, hasSongs: false, service_date: "2099-03-08" },
      messages: [],
      pastor_message: null,
      weekendSetlists: [
        { _id: "featuredSongs.2099-03-08", _rev: "s1", _type: "featuredSongs", team_notes: "Nota" },
        { _id: "saturdarSongs.2099-03-08", _rev: "x", _type: "saturdarSongs" },
      ],
      proposal: null,
    });
    const body = await (await get()).json();
    expect(body.teamNotes).toEqual({ text: "Nota", observed: { id: "featuredSongs.2099-03-08", rev: "s1" } });
    expect(body.weekendSetlists).toBeUndefined();
    expect(body.service).toEqual({ _id: ROLE_ID, _type: "sunday_role", service_date: "2099-03-08" });
  });

  it("is null with no setlist, and names a duplicate pair", async () => {
    const answer = async (weekendSetlists: unknown[]) => {
      operationalFetch.mockResolvedValueOnce({
        service: { _id: ROLE_ID, _rev: "r1", _type: "sunday_role", service_date: "2099-03-08" },
        weekendSetlists,
      });
      return (await (await get()).json()).teamNotes;
    };
    expect(await answer([])).toBeNull();
    expect(
      await answer([
        { _id: "a", _rev: "1", _type: "featuredSongs" },
        { _id: "b", _rev: "2", _type: "featuredSongs" },
      ]),
    ).toEqual({ unavailable: "ambiguous" });
  });

  it("uses a special's own role, only when it has songs", async () => {
    operationalFetch.mockResolvedValueOnce({
      service: { _id: ROLE_ID, _rev: "r7", _type: "special_role", team_notes: "Noche", hasSongs: true },
      weekendSetlists: [],
    });
    expect((await (await get()).json()).teamNotes).toEqual({ text: "Noche", observed: { id: ROLE_ID, rev: "r7" } });
    operationalFetch.mockResolvedValueOnce({
      service: { _id: ROLE_ID, _rev: "r7", _type: "special_role", hasSongs: false },
      weekendSetlists: [],
    });
    expect((await (await get()).json()).teamNotes).toBeNull();
  });
});

// ── The GROQ parts, evaluated ───────────────────────────────────────────────

describe("the new read parts, evaluated", () => {
  const dataset = [
    { _id: "sun", _type: "sunday_role", _rev: "r1", week: "2099-03-08" },
    { _id: "featuredSongs.2099-03-08", _type: "featuredSongs", _rev: "s1", week: "2099-03-08", team_notes: "Nota" },
    { _id: "saturdarSongs.2099-03-07", _type: "saturdarSongs", _rev: "s2", week: "2099-03-07" },
    { _id: "admin-1", _type: "teamMembers", alias: "Frank" },
    {
      _id: "serviceThread.sun",
      _type: "serviceThread",
      role_id: "sun",
      messages: [{ _key: "m1", body: "Hola", edited_at: "2099-03-02T00:00:00Z" }],
      pastor_message: { _type: "pastor_message", body: "Efesios 2", at: "2099-03-01T00:00:00Z", author: { _ref: "admin-1" } },
    },
    { _id: "special", _type: "special_role", _rev: "r3", date: "2099-03-10", songs: [] },
  ];

  it("serviceConversationQuery carries the pastor's message, `edited_at` and the week's setlists", async () => {
    const q = serviceConversationQuery("sun", "serviceThread.sun");
    const out = (await (await evaluate(parse(q.query), { dataset, params: q.params })).get()) as Record<string, unknown>;
    expect(out).toMatchObject({
      service: { _id: "sun", _rev: "r1", hasSongs: false },
      messages: [{ _key: "m1", edited_at: "2099-03-02T00:00:00Z" }],
      pastor_message: { body: "Efesios 2", at: "2099-03-01T00:00:00Z", author: "admin-1", author_name: "Frank" },
      weekendSetlists: [{ _id: "featuredSongs.2099-03-08", _rev: "s1", _type: "featuredSongs", team_notes: "Nota" }],
    });
  });

  it("a special has no weekend setlists and counts `songs: []` as a setlist", async () => {
    const q = serviceConversationQuery("special", "serviceThread.special");
    const out = (await (await evaluate(parse(q.query), { dataset, params: q.params })).get()) as Record<string, unknown>;
    expect(out).toMatchObject({ service: { hasSongs: true }, weekendSetlists: [], pastor_message: null });
  });

  it("pastorMessageBodyOf reads the body from inside a role projection", async () => {
    const query = `*[_type in ["sunday_role", "special_role"]] | order(_id) { _id, "pastor_message": ${pastorMessageBodyOf("^._id")} }`;
    const out = await (await evaluate(parse(query), { dataset })).get();
    expect(out).toEqual([
      { _id: "special", pastor_message: null },
      { _id: "sun", pastor_message: "Efesios 2" },
    ]);
  });
});
