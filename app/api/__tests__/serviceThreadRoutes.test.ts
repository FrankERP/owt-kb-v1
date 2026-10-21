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
const sendEmailMock = vi.fn();

vi.mock("@/app/utils/push", () => ({ sendPush: (...a: unknown[]) => sendPushMock(...a) }));
vi.mock("@/app/utils/email", () => ({ sendEmail: (...a: unknown[]) => sendEmailMock(...a) }));

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
import { evaluate, parse } from "groq-js";
import { documentsReferencingRoleQuery, servicesWithoutProposalQuery } from "@/app/utils/serviceReadQueries";

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
  return { user: { role, sanityId, alias: "Frank" } };
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
  sendEmailMock.mockResolvedValue({ ok: true });
  vi.unstubAllEnvs();
  vi.stubEnv("EMAIL_ALLOWLIST", "*");
  vi.stubEnv("EMAIL_REDIRECT_TO", "");
  operationalFetch.mockImplementation(async (query: string, params?: { ids?: string[] }) => {
    if (query.includes('"count": count(messages)')) return { count: threadCount };
    if (query.includes('_type == "teamMembers"')) {
      return [
        { _id: "lead-1", email: "Ana@Example.com" },
        { _id: "lead-2", email: "beto@example.com", notifPrefs: { emailProposals: false } },
        { _id: "admin-1", email: "frank@example.com" },
      ].filter((m) => (params?.ids ?? []).includes(m._id));
    }
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
      // A string, never a reference: `references()` would make it a role dependency.
      role_id: ROLE_ID,
      messages: [],
    });
    expect(JSON.stringify(tx.created)).not.toContain("_ref");
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

  it("writes nothing the role-dependency scan sees, so the role stays deletable and movable", async () => {
    // The first version stored a WEAK reference; GROQ's `references()` matches
    // those too, and `roleDependencies` reported the thread as a dependency.
    await post({ body: "hola" });
    const created = txs[0].created as Record<string, unknown>;
    const dataset = [{ _id: ROLE_ID, _type: "sunday_role", week: futureIso(5) }, { ...created, messages: txs[0].appended }];
    const q = documentsReferencingRoleQuery(ROLE_ID);
    const hits = await (await evaluate(parse(q.query), { dataset, params: q.params })).get();
    expect(hits).toEqual([]);
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

  it("emails the leads who want proposal mail, never the author, with the message", async () => {
    loadCanonicalRoleMock.mockResolvedValueOnce({
      role: role({
        Lead: [
          { _key: "a", _type: "reference", _ref: "lead-1" },
          { _key: "b", _type: "reference", _ref: "lead-2" },
          { _key: "c", _type: "reference", _ref: "admin-1" },
        ],
      }),
      state: "single",
      draftIds: [],
    });
    await post({ body: "El pastor predica sobre <gracia>." });
    expect(sendEmailMock).not.toHaveBeenCalled();
    await drainAfter();
    // lead-2 opted out of proposal mail; admin-1 is the author.
    expect(sendEmailMock).toHaveBeenCalledTimes(1);
    const [{ to, subject, html }] = sendEmailMock.mock.calls[0];
    expect(to).toBe("ana@example.com");
    expect(subject).toMatch(/^Mensaje para tu servicio — /);
    expect(html).toContain("El pastor predica sobre &lt;gracia&gt;.");
    expect(html).toContain("Frank");
    expect(html).toContain(`/me/propose/${ROLE_ID}`);
    // The member read asked only for the leads, not the author.
    const memberRead = operationalFetch.mock.calls.find(([q]) => String(q).includes('_type == "teamMembers"'));
    expect(memberRead?.[1]).toEqual({ ids: ["lead-1", "lead-2"] });
  });

  it("redirects the email on Preview, like every app email", async () => {
    vi.stubEnv("EMAIL_REDIRECT_TO", "frank@example.com");
    await post({ body: "hola" });
    await drainAfter();
    const [{ to, subject }] = sendEmailMock.mock.calls[0];
    expect(to).toBe("frank@example.com");
    expect(subject).toMatch(/^\[→ ana@example\.com\] /);
  });

  it("still emails when the push fails, and still answers 200", async () => {
    sendPushMock.mockRejectedValueOnce(new Error("fcm down"));
    const res = await post({ body: "hola" });
    expect(res.status).toBe(200);
    await drainAfter();
    expect(sendEmailMock).toHaveBeenCalledTimes(1);
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
    expect(sendEmailMock).not.toHaveBeenCalled();
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

describe("servicesWithoutProposalQuery, evaluated", () => {
  it("lists upcoming services with no proposal, drafts flagged, with their thread", async () => {
    const today = "2099-03-01";
    const dataset = [
      { _id: "past", _type: "sunday_role", week: "2099-02-22" },
      { _id: "proposed", _type: "sunday_role", week: "2099-03-08" },
      { _id: "setlistProposal.proposed", _type: "setlistProposal", service_ref: { _type: "reference", _ref: "proposed" } },
      { _id: "open", _type: "saturday_role", week: "2099-03-07", published: false, Lead: [{ _ref: "lead-1" }] },
      { _id: "lead-1", _type: "teamMembers", alias: "Ana" },
      { _id: "special", _type: "special_role", date: "2099-03-10", service_name: "Noche" },
      { _id: "serviceThread.open", _type: "serviceThread", role_id: "open", messages: [{ _key: "m1", body: "Tema: gracia", author_role: "admin" }] },
    ];
    const q = servicesWithoutProposalQuery(today);
    const rows = (await (await evaluate(parse(q.query), { dataset, params: q.params })).get()) as Array<Record<string, unknown>>;
    expect(rows.map((r) => r._id)).toEqual(["open", "special"]);
    expect(rows[0]).toMatchObject({
      service_date: "2099-03-07",
      published: false,
      leads: [{ id: "lead-1", name: "Ana" }],
      messages: [{ _key: "m1", body: "Tema: gracia" }],
    });
    expect(rows[1]).toMatchObject({ published: true, messages: null });
  });
});

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
