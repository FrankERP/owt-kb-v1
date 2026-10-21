// The pre-proposal conversation (ADR-0064) at the route level: the admin list of
// services without a proposal, and the writer that appends to
// `serviceThread.<roleId>`.
//
// The transaction is RECORDED IN ORDER, like the proposal message suite: an
// `append` on a mocked chain succeeds whether or not the document was created
// and `setIfMissing` ran first, and those two are what make the FIRST message
// on a service land at all.

import { beforeEach, describe, expect, it, vi } from "vitest";
import type { NextRequest } from "next/server";

vi.mock("server-only", () => ({}));

const requireActiveManagerMock = vi.fn();
const operationalFetch = vi.fn();
const sendPushMock = vi.fn();
const loadCanonicalRoleMock = vi.fn();

vi.mock("@/app/utils/push", () => ({ sendPush: (...a: unknown[]) => sendPushMock(...a) }));

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

vi.mock("@/app/utils/authGuards", () => ({
  requireActiveManager: () => requireActiveManagerMock(),
}));

vi.mock("@/sanity/lib/operationalClient", () => ({
  operationalClient: { fetch: (...a: unknown[]) => operationalFetch(...a) },
  rawIntegrityClient: { fetch: vi.fn(async () => []) },
}));

vi.mock("@/app/utils/roleWriteOps", async (orig) => ({
  ...(await orig<Record<string, unknown>>()),
  loadCanonicalRole: (...a: unknown[]) => loadCanonicalRoleMock(...a),
}));

interface RecordedTx {
  calls: string[];
  created: Record<string, unknown> | null;
  patchedId: string | null;
  setIfMissing: Record<string, unknown>;
  appended: unknown[];
  committed: boolean;
}
const txs: RecordedTx[] = [];
const commitOutcomes: (Error | undefined)[] = [];

function makeTx() {
  const rec: RecordedTx = {
    calls: [],
    created: null,
    patchedId: null,
    setIfMissing: {},
    appended: [],
    committed: false,
  };
  txs.push(rec);
  const patch = {
    setIfMissing(values: Record<string, unknown>) {
      rec.calls.push("setIfMissing");
      Object.assign(rec.setIfMissing, values);
      return patch;
    },
    append(field: string, items: unknown[]) {
      rec.calls.push(`append:${field}`);
      rec.appended.push(...items);
      return patch;
    },
    ifRevisionId() {
      rec.calls.push("ifRevisionId");
      return patch;
    },
  };
  const tx = {
    createIfNotExists(doc: Record<string, unknown>) {
      rec.calls.push("createIfNotExists");
      rec.created = doc;
      return tx;
    },
    patch(id: string, fn: (p: typeof patch) => unknown) {
      rec.calls.push("patch");
      rec.patchedId = id;
      fn(patch);
      return tx;
    },
    async commit() {
      const outcome = commitOutcomes.shift();
      if (outcome) throw outcome;
      rec.committed = true;
      return {};
    },
  };
  return tx;
}

vi.mock("@/sanity/lib/serverClient", () => ({
  serverClient: { fetch: vi.fn() },
  writeClient: { transaction: () => makeTx() },
}));

import { POST } from "@/app/api/admin/service-threads/[roleId]/messages/route";
import { GET } from "@/app/api/admin/service-threads/route";
import { PROPOSAL_MESSAGES_MAX } from "@/app/utils/proposalMessageWrite";
import { serviceTodayIso } from "@/app/components/admin/serviceReadiness";

// ── Fixtures ────────────────────────────────────────────────────────────────

const ROLE_ID = "role-sun-1";
const THREAD_ID = `serviceThread.${ROLE_ID}`;

function futureIso(days: number): string {
  const d = new Date(`${serviceTodayIso()}T12:00:00`);
  d.setDate(d.getDate() + days);
  return d.toLocaleDateString("sv");
}

function role(over: Record<string, unknown> = {}) {
  return {
    _id: ROLE_ID,
    _rev: "r1",
    _type: "sunday_role",
    week: futureIso(5),
    published: true,
    Lead: [
      { _key: "a", _type: "reference", _ref: "lead-1" },
      { _key: "b", _type: "reference", _ref: "lead-2" },
    ],
    ...over,
  };
}

let threadCount = 0;
let readBackFails = false;

function admin(role = "admin", sanityId = "admin-1") {
  return { user: { role, sanityId } };
}

function post(body: unknown, roleId = ROLE_ID) {
  const req = { json: async () => body } as unknown as NextRequest;
  return POST(req, { params: Promise.resolve({ roleId }) });
}

beforeEach(() => {
  vi.clearAllMocks();
  txs.length = 0;
  commitOutcomes.length = 0;
  afterCallbacks.length = 0;
  threadCount = 0;
  readBackFails = false;
  requireActiveManagerMock.mockResolvedValue(admin());
  loadCanonicalRoleMock.mockResolvedValue({ role: role(), state: "single", draftIds: [] });
  sendPushMock.mockResolvedValue({ sent: 0, pruned: 0 });
  operationalFetch.mockImplementation(async (query: string) => {
    if (query.includes('"count": count(messages)')) return { count: threadCount };
    if (query.includes("_id == $threadId")) {
      if (readBackFails) throw new Error("read failed");
      return { _id: THREAD_ID, _rev: "t2", messages: [{ _key: "m1", body: "Tema: gracia" }] };
    }
    return [];
  });
});

// ── POST ────────────────────────────────────────────────────────────────────

describe("POST /api/admin/service-threads/[roleId]/messages", () => {
  it("refuses a missing session and a content-editor, writing nothing", async () => {
    requireActiveManagerMock.mockResolvedValueOnce(null);
    expect((await post({ body: "hola" })).status).toBe(403);
    requireActiveManagerMock.mockResolvedValueOnce(admin("content-editor"));
    expect((await post({ body: "hola" })).status).toBe(403);
    expect(txs).toHaveLength(0);
  });

  it("creates the thread if missing and appends, with no revision assertion", async () => {
    const res = await post({ body: "  El pastor compartió: el tema es la gracia.  " });
    expect(res.status).toBe(200);
    expect(txs).toHaveLength(1);
    const tx = txs[0];
    // Order is the contract: the document exists, the array exists, THEN the append.
    expect(tx.calls).toEqual(["createIfNotExists", "patch", "setIfMissing", "append:messages"]);
    expect(tx.created).toMatchObject({
      _id: THREAD_ID,
      _type: "serviceThread",
      // Weak, or the role could never be deleted while a message exists.
      service_ref: { _type: "reference", _ref: ROLE_ID, _weak: true },
      messages: [],
    });
    expect(tx.patchedId).toBe(THREAD_ID);
    expect(tx.setIfMissing).toEqual({ messages: [] });
    expect(tx.appended).toHaveLength(1);
    expect(tx.appended[0]).toMatchObject({
      _type: "proposal_message",
      author: { _ref: "admin-1", _type: "reference" },
      author_role: "admin",
      kind: "admin_change_request",
      body: "El pastor compartió: el tema es la gracia.",
    });
    expect(tx.committed).toBe(true);
    const data = await res.json();
    expect(data.messages).toEqual([{ _key: "m1", body: "Tema: gracia" }]);
  });

  it("pushes the service's leads (never the author) toward their proposal page", async () => {
    loadCanonicalRoleMock.mockResolvedValueOnce({
      role: role({
        Lead: [
          { _key: "a", _type: "reference", _ref: "lead-1" },
          { _key: "b", _type: "reference", _ref: "admin-1" },
        ],
      }),
      state: "single",
      draftIds: [],
    });
    await post({ body: "hola" });
    // Deferred, not sent inline.
    expect(sendPushMock).not.toHaveBeenCalled();
    await drainAfter();
    expect(sendPushMock).toHaveBeenCalledTimes(1);
    const [recipients, category, payload] = sendPushMock.mock.calls[0];
    expect(recipients).toEqual(["lead-1"]);
    expect(category).toBe("proposals");
    expect(payload).toMatchObject({ title: "Nuevo mensaje", path: `/me/propose/${ROLE_ID}` });
  });

  it("stores but does not push for an unpublished service", async () => {
    loadCanonicalRoleMock.mockResolvedValueOnce({
      role: role({ published: false }),
      state: "single",
      draftIds: [],
    });
    const res = await post({ body: "hola" });
    expect(res.status).toBe(200);
    expect(txs[0].committed).toBe(true);
    await drainAfter();
    expect(sendPushMock).not.toHaveBeenCalled();
  });

  it("refuses a service that already happened", async () => {
    loadCanonicalRoleMock.mockResolvedValueOnce({
      role: role({ week: futureIso(-1) }),
      state: "single",
      draftIds: [],
    });
    const res = await post({ body: "hola" });
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ details: { issues: ["thread_closed"] } });
    expect(txs).toHaveLength(0);
  });

  it("refuses a full thread", async () => {
    threadCount = PROPOSAL_MESSAGES_MAX;
    const res = await post({ body: "hola" });
    expect(res.status).toBe(400);
    expect(txs).toHaveLength(0);
  });

  it("refuses an empty body, a draft id and an unknown role", async () => {
    expect((await post({ body: "   " })).status).toBe(400);
    expect((await post({ body: "hola" }, "drafts.role-sun-1")).status).toBe(400);
    loadCanonicalRoleMock.mockResolvedValueOnce({ role: null, state: "none", draftIds: [] });
    expect((await post({ body: "hola" })).status).toBe(404);
    expect(txs).toHaveLength(0);
  });

  it("reports a landed message as landed when only the read-back fails", async () => {
    readBackFails = true;
    const res = await post({ body: "hola" });
    expect(res.status).toBe(200);
    expect((await res.json()).messages).toBeNull();
  });
});

// ── GET ─────────────────────────────────────────────────────────────────────

describe("GET /api/admin/service-threads", () => {
  it("is admin-only", async () => {
    requireActiveManagerMock.mockResolvedValueOnce(admin("content-editor"));
    expect((await GET()).status).toBe(403);
    expect(operationalFetch).not.toHaveBeenCalled();
  });

  it("asks for services from today with no proposal, and their thread", async () => {
    operationalFetch.mockResolvedValueOnce([{ _id: ROLE_ID }]);
    const res = await GET();
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual([{ _id: ROLE_ID }]);
    const [query, params] = operationalFetch.mock.calls[0];
    expect(params).toEqual({ today: serviceTodayIso() });
    expect(query).toContain('count(*[_type == "setlistProposal" && service_ref._ref == ^._id]) == 0');
    expect(query).toContain('_id == "serviceThread." + ^._id');
  });
});
