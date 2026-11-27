// app/appAuth/__tests__/adminProposalDoors.test.ts — the native app's three admin proposal doors
// (ADR-0091 A-W1): the list read, the decision and the thread message. Who may use them is the
// web's rule exactly (an active manager who is not a content-editor); the two writes re-read access
// fresh, 404 a malformed id before that read, refuse a body that is not JSON, answer a writer throw
// with 503, reduce a refusal to code + conflict + issues, and send no member id on success. The
// decision door lets only `/admin`'s three actions reach the writer.
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

const reviewProposal = vi.fn();
vi.mock("@/app/utils/proposalReviewCommit", () => ({ reviewProposal: (...a: unknown[]) => reviewProposal(...a) }));
const postAdminProposalMessage = vi.fn();
vi.mock("@/app/utils/proposalMessageCommit", () => ({
  postAdminProposalMessage: (...a: unknown[]) => postAdminProposalMessage(...a),
}));
const readAdminProposalsForApp = vi.fn();
vi.mock("@/app/utils/adminProposalsRead", () => ({
  readAdminProposalsForApp: (...a: unknown[]) => readAdminProposalsForApp(...a),
}));

import { GET } from "@/app/api/app/v1/admin/proposals/route";
import { PATCH } from "@/app/api/app/v1/admin/proposals/[proposalId]/route";
import { POST } from "@/app/api/app/v1/admin/proposal-messages/[proposalId]/route";
import { signAppAccessToken } from "../tokens";

const SECRET = "s".repeat(40);
const KEY = new TextEncoder().encode(SECRET);
const ORIGIN = "http://localhost:3000";
const GRANT_ID = "appAuthGrant.3b241101-e2bb-4255-8caf-4136c566a962";
const ADMIN = { active: true, role: "admin", ministries: ["worship"], managesMinistries: [], ministryRoles: [] };
const PROPOSAL = "setlistProposal.sun-1";

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
  reviewProposal.mockReset();
  postAdminProposalMessage.mockReset();
  readAdminProposalsForApp.mockReset().mockResolvedValue([]);
  consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
});

async function bearer(): Promise<Record<string, string>> {
  const { token } = await signAppAccessToken({ key: KEY, origin: ORIGIN, sub: "m1", grantId: GRANT_ID });
  return { host: "localhost:3000", authorization: `Bearer ${token}` };
}

async function list(headers?: Record<string, string>): Promise<Response> {
  return GET(new Request(`${ORIGIN}/api/app/v1/admin/proposals`, { headers: headers ?? (await bearer()) }));
}

async function decide(opts: { id?: string; body?: string; headers?: Record<string, string> } = {}): Promise<Response> {
  const id = opts.id ?? PROPOSAL;
  return PATCH(
    new Request(`${ORIGIN}/api/app/v1/admin/proposals/${encodeURIComponent(id)}`, {
      method: "PATCH",
      headers: { ...(opts.headers ?? (await bearer())), "content-type": "application/json" },
      body: opts.body ?? JSON.stringify({ action: "approve", rev: "r1" }),
    }),
    { params: Promise.resolve({ proposalId: id }) },
  );
}

async function message(opts: { id?: string; body?: string; headers?: Record<string, string> } = {}): Promise<Response> {
  const id = opts.id ?? PROPOSAL;
  return POST(
    new Request(`${ORIGIN}/api/app/v1/admin/proposal-messages/${encodeURIComponent(id)}`, {
      method: "POST",
      headers: { ...(opts.headers ?? (await bearer())), "content-type": "application/json" },
      body: opts.body ?? JSON.stringify({ body: "¿Cambiamos el tono?" }),
    }),
    { params: Promise.resolve({ proposalId: id }) },
  );
}

const ROWS = [
  { _key: "a1", author: "m7", author_name: "Luis", author_role: "lead", kind: "lead_note", body: "Primero", at: "2026-11-27T18:00:00Z" },
  { _key: "a2", author: "m1", author_name: "Frank", author_role: "admin", kind: "admin_change_request", body: "Va", at: "2026-11-27T18:05:00Z" },
];

const writes = [
  { name: "PATCH decision", call: decide, writer: () => reviewProposal },
  { name: "POST message", call: message, writer: () => postAdminProposalMessage },
] as const;

describe("GET /api/app/v1/admin/proposals", () => {
  it("401s without a token and 403s a member or a content-editor, with no read", async () => {
    expect((await list({ host: "localhost:3000" })).status).toBe(401);
    getMemberAccess.mockResolvedValueOnce({ ...ADMIN, role: "member" });
    expect((await list()).status).toBe(403);
    getMemberAccess.mockResolvedValueOnce({ ...ADMIN, role: "content-editor" });
    expect((await list()).status).toBe(403);
    expect(readAdminProposalsForApp).not.toHaveBeenCalled();
  });

  it("lets a worship-less admin and a super-admin in (the web's rule, no ministry check)", async () => {
    getMemberAccess.mockResolvedValueOnce({ ...ADMIN, ministries: ["kids"] });
    expect((await list()).status).toBe(200);
    getMemberAccess.mockResolvedValueOnce({ ...ADMIN, role: "super-admin", ministries: [] });
    expect((await list()).status).toBe(200);
  });

  it("reads with the CDMX date and answers names, never member ids", async () => {
    readAdminProposalsForApp.mockResolvedValueOnce([
      {
        _id: PROPOSAL, _rev: "r1", service_type: "sunday", service_date: "2099-01-04", status: "pending",
        lead_id: "m7", lead_name: "Luis", contributors: [{ id: "m7", name: "Luis" }, { id: "m8", name: "Sara" }],
        messages: ROWS, earlier_messages: null, songs: [],
      },
    ]);
    const res = await list();
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toContain("no-store");
    expect(readAdminProposalsForApp.mock.calls[0][0]).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    const body = await res.json();
    expect(body.proposals[0]).toMatchObject({ id: PROPOSAL, leadName: "Luis", coLeads: ["Sara"] });
    expect(body.proposals[0].messages.map((m: { mine: boolean }) => m.mine)).toEqual([false, true]);
    const text = JSON.stringify(body);
    for (const id of ["m1", "m7", "m8"]) expect(text).not.toContain(`"${id}"`);
  });

  it("a failed read is 503", async () => {
    readAdminProposalsForApp.mockRejectedValueOnce(new Error("sanity down"));
    expect((await list()).status).toBe(503);
  });
});

describe.each(writes)("$name", ({ call, writer }) => {
  it("401s without a token and 403s a content-editor, before any read or write", async () => {
    expect((await call({ headers: { host: "localhost:3000" } })).status).toBe(401);
    getMemberAccess.mockResolvedValueOnce({ ...ADMIN, role: "content-editor" });
    expect((await call()).status).toBe(403);
    expect(fetchMemberAccessFresh).not.toHaveBeenCalled();
    expect(writer()).not.toHaveBeenCalled();
  });

  it("404s a malformed id before the fresh access read", async () => {
    expect((await call({ id: "drafts.setlistProposal.sun-1" })).status).toBe(404);
    expect(fetchMemberAccessFresh).not.toHaveBeenCalled();
    expect(writer()).not.toHaveBeenCalled();
  });

  it("re-reads access fresh: inactive 401, demoted 403 (member or content-editor), failed 503 — no write", async () => {
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

  it("answers a body that is not JSON as the web does, with no write", async () => {
    const res = await call({ body: "{nope" });
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "invalid_request", conflict: false, details: { issues: ["json"] } });
    expect(writer()).not.toHaveBeenCalled();
  });

  it("a throw from the writer is 503, logged", async () => {
    writer().mockRejectedValueOnce(new Error("boom"));
    expect((await call()).status).toBe(503);
    expect(consoleError).toHaveBeenCalled();
  });

  it("reduces a refusal to code, conflict and string issues", async () => {
    writer().mockResolvedValueOnce({
      ok: false,
      status: 409,
      body: { error: "stale_revision", message: "Someone else changed this first.", conflict: true, details: { id: PROPOSAL, storedRev: "r2", observedRev: "r1", by: "m9" } },
    });
    let res = await call();
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ error: "stale_revision", conflict: true });

    writer().mockResolvedValueOnce({ status: 400, body: { error: "invalid_request", conflict: false, details: { issues: ["thread_closed"], extra: "m9" } } });
    res = await call();
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "invalid_request", conflict: false, details: { issues: ["thread_closed"] } });
  });
});

describe("PATCH /api/app/v1/admin/proposals/[proposalId]", () => {
  it("lets only /admin's three actions reach the writer", async () => {
    for (const action of ["reconcile_target", "delete", 7, undefined]) {
      const res = await decide({ body: JSON.stringify({ action, rev: "r1" }) });
      expect(res.status).toBe(400);
      expect(await res.json()).toEqual({ error: "invalid_request", conflict: false, details: { issues: ["action"] } });
    }
    expect((await decide({ body: "null" })).status).toBe(400);
    expect(reviewProposal).not.toHaveBeenCalled();
  });

  it("hands the writer the path id, the raw body and the session's member as reviewer", async () => {
    reviewProposal.mockResolvedValueOnce({ ok: true, status: 200, body: { ok: true, status: "changes_requested" }, effects: {} });
    const raw = { action: "request_changes", rev: "r1", adminNotes: "Otro tono" };
    await decide({ body: JSON.stringify(raw) });
    expect(reviewProposal).toHaveBeenCalledWith(PROPOSAL, raw, { reviewerId: "m1" });
  });

  it("a success keeps status, idempotent and the pastor's-message outcome only", async () => {
    reviewProposal.mockResolvedValueOnce({
      ok: true,
      status: 200,
      body: { ok: true, status: "approved", setlistId: "featuredSongs.x", pastorMessage: "copied" },
      effects: { pushRecipients: ["m7"] },
    });
    let body = await (await decide()).json();
    expect(body).toEqual({ status: "approved", idempotent: false, pastorMessage: "copied" });

    reviewProposal.mockResolvedValueOnce({ ok: true, status: 200, body: { ok: true, status: "approved", idempotent: true }, effects: {} });
    body = await (await decide()).json();
    expect(body).toEqual({ status: "approved", idempotent: true, pastorMessage: null });
  });
});

describe("POST /api/app/v1/admin/proposal-messages/[proposalId]", () => {
  it("hands the writer the session's member, the path id and the raw body", async () => {
    postAdminProposalMessage.mockResolvedValueOnce({ status: 200, body: { ok: true, messages: [], rev: "r2", observedRev: "r1" } });
    await message();
    expect(postAdminProposalMessage).toHaveBeenCalledWith({ adminId: "m1", proposalId: PROPOSAL, raw: { body: "¿Cambiamos el tono?" } });
  });

  it("a success carries the thread as names and `mine`, the revisions, and no member id, `message` or `ok`", async () => {
    postAdminProposalMessage.mockResolvedValueOnce({
      status: 200,
      body: { ok: true, message: { _key: "a3", author: "m1", body: "x" }, messages: ROWS, rev: "r2", observedRev: "r1" },
    });
    const body = await (await message()).json();
    expect(Object.keys(body).sort()).toEqual(["messages", "observedRev", "rev"]);
    expect(body.messages.map((m: { key: string; mine: boolean }) => [m.key, m.mine])).toEqual([["a1", false], ["a2", true]]);
    const text = JSON.stringify(body);
    expect(text).not.toContain('"m1"');
    expect(text).not.toContain('"m7"');
    expect(text).not.toContain('"author"');
  });

  it("keeps `messages: null` when the writer's read-back failed", async () => {
    postAdminProposalMessage.mockResolvedValueOnce({ status: 200, body: { ok: true, messages: null, rev: null, observedRev: "r1" } });
    expect(await (await message()).json()).toEqual({ messages: null, rev: null, observedRev: "r1" });
  });
});
