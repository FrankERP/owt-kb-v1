// app/appAuth/__tests__/proposalMessagesRoute.test.ts — `POST /api/app/v1/proposal-messages/[proposalId]`
// (ADR-0091 W1b): the app's door to the ONE lead-thread writer. No token 401; a malformed id 404
// before any read; outside Alabanza 403; a FRESH access read that finds the member inactive is 401
// `account_disabled` and a failed one 503, both with no write; a body that is not JSON is the web's
// `invalid_request`; the author's name reaches the writer, and a failed name read still posts with
// `""`; a throw from the writer is 503; the writer's refusals pass through; a success carries the
// thread as names and `mine` and the two revisions, never `message`, `ok` or a member id.
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

const postProposalMessage = vi.fn();
vi.mock("@/app/utils/proposalMessageCommit", () => ({
  postProposalMessage: (...a: unknown[]) => postProposalMessage(...a),
}));

const serverFetch = vi.fn();
vi.mock("@/sanity/lib/serverClient", () => ({ serverClient: { fetch: (...a: unknown[]) => serverFetch(...a) } }));

import { POST } from "@/app/api/app/v1/proposal-messages/[proposalId]/route";
import { signAppAccessToken } from "../tokens";

const SECRET = "s".repeat(40);
const KEY = new TextEncoder().encode(SECRET);
const ORIGIN = "http://localhost:3000";
const GRANT_ID = "appAuthGrant.3b241101-e2bb-4255-8caf-4136c566a962";
const WORSHIP = { active: true, role: "member", ministries: ["worship"], managesMinistries: [], ministryRoles: [] };
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
  getMemberAccess.mockReset().mockResolvedValue(WORSHIP);
  fetchMemberAccessFresh.mockReset().mockResolvedValue(WORSHIP);
  postProposalMessage.mockReset();
  serverFetch.mockReset().mockResolvedValue({ name: "Frank" });
  consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
});

async function bearer(): Promise<Record<string, string>> {
  const { token } = await signAppAccessToken({ key: KEY, origin: ORIGIN, sub: "m1", grantId: GRANT_ID });
  return { host: "localhost:3000", authorization: `Bearer ${token}` };
}

async function post(opts: { id?: string; body?: string; headers?: Record<string, string> } = {}): Promise<Response> {
  const id = opts.id ?? PROPOSAL;
  return POST(
    new Request(`${ORIGIN}/api/app/v1/proposal-messages/${encodeURIComponent(id)}`, {
      method: "POST",
      headers: { ...(opts.headers ?? (await bearer())), "content-type": "application/json" },
      body: opts.body ?? JSON.stringify({ body: "¿Podemos cambiar el tono?" }),
    }),
    { params: Promise.resolve({ proposalId: id }) },
  );
}

const ROWS = [
  { _key: "a1", author: "m1", author_name: "Frank", author_role: "lead", kind: "lead_note", body: "Primero", at: "2026-11-27T18:00:00Z" },
  { _key: "a2", author: "m9", author_name: "Ana", author_role: "admin", kind: "admin_note", body: "Va", at: "2026-11-27T18:05:00Z" },
];

describe("POST /api/app/v1/proposal-messages/[proposalId]", () => {
  it("401s without a token, before any read or write", async () => {
    const res = await post({ headers: { host: "localhost:3000" } });
    expect(res.status).toBe(401);
    expect(fetchMemberAccessFresh).not.toHaveBeenCalled();
    expect(postProposalMessage).not.toHaveBeenCalled();
  });

  it("404s a malformed id before the fresh access read", async () => {
    const res = await post({ id: "drafts.setlistProposal.sun-1" });
    expect(res.status).toBe(404);
    expect(fetchMemberAccessFresh).not.toHaveBeenCalled();
    expect(postProposalMessage).not.toHaveBeenCalled();
  });

  it("refuses someone outside Alabanza (403) with no write", async () => {
    getMemberAccess.mockResolvedValueOnce({ ...WORSHIP, ministries: ["jovenes"] });
    expect((await post()).status).toBe(403);
    expect(postProposalMessage).not.toHaveBeenCalled();
  });

  it("re-reads access fresh: inactive → 401 account_disabled, no write", async () => {
    fetchMemberAccessFresh.mockResolvedValueOnce({ ...WORSHIP, active: false });
    const res = await post();
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: "account_disabled" });
    expect(fetchMemberAccessFresh).toHaveBeenCalledWith("m1");
    expect(postProposalMessage).not.toHaveBeenCalled();
  });

  it("re-reads access fresh: no longer in Alabanza → 403, a failed read → 503, no write", async () => {
    fetchMemberAccessFresh.mockResolvedValueOnce({ ...WORSHIP, ministries: ["kids"] });
    expect((await post()).status).toBe(403);
    fetchMemberAccessFresh.mockRejectedValueOnce(new Error("sanity down"));
    expect((await post()).status).toBe(503);
    expect(postProposalMessage).not.toHaveBeenCalled();
  });

  it("answers a body that is not JSON as the web does, with no write", async () => {
    const res = await post({ body: "{nope" });
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ error: "invalid_request", details: { issues: ["json"] } });
    expect(postProposalMessage).not.toHaveBeenCalled();
  });

  it("hands the writer the token's subject, the path id, the raw body and the live name", async () => {
    postProposalMessage.mockResolvedValueOnce({ status: 200, body: { ok: true, messages: [], rev: "r2", observedRev: "r1" } });
    await post();
    expect(serverFetch).toHaveBeenCalledWith(expect.stringContaining("coalesce(alias, member_name)"), { id: "m1" });
    expect(postProposalMessage).toHaveBeenCalledWith({
      leadId: "m1",
      authorName: "Frank",
      proposalId: PROPOSAL,
      raw: { body: "¿Podemos cambiar el tono?" },
    });
  });

  it("still posts, nameless, when the name read fails", async () => {
    serverFetch.mockRejectedValueOnce(new Error("sanity down"));
    postProposalMessage.mockResolvedValueOnce({ status: 200, body: { ok: true, messages: null, rev: null, observedRev: "r1" } });
    expect((await post()).status).toBe(200);
    expect(postProposalMessage.mock.calls[0][0]).toMatchObject({ authorName: "" });
  });

  it("a throw from the writer is the door's 503, logged", async () => {
    postProposalMessage.mockRejectedValueOnce(new Error("boom"));
    expect((await post()).status).toBe(503);
    expect(consoleError).toHaveBeenCalled();
  });

  it("passes the writer's refusals through as it shaped them", async () => {
    postProposalMessage.mockResolvedValueOnce({ status: 403, body: { error: "Not a Lead on this service" } });
    let res = await post();
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: "Not a Lead on this service" });

    const closed = { error: "invalid_request", details: { issues: ["thread_closed"] } };
    postProposalMessage.mockResolvedValueOnce({ status: 400, body: closed });
    res = await post();
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual(closed);
  });

  it("a success carries the thread as names and `mine`, the revisions, and no member id", async () => {
    postProposalMessage.mockResolvedValueOnce({
      status: 200,
      body: { ok: true, message: { _key: "a3", author: "m1", body: "x" }, messages: ROWS, rev: "r2", observedRev: "r1" },
    });
    const res = await post();
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toContain("no-store");
    const body = await res.json();
    expect(Object.keys(body).sort()).toEqual(["messages", "observedRev", "rev"]);
    expect(body.rev).toBe("r2");
    expect(body.observedRev).toBe("r1");
    expect(body.messages.map((m: { key: string; mine: boolean }) => [m.key, m.mine])).toEqual([["a1", true], ["a2", false]]);
    const text = JSON.stringify(body);
    expect(text).not.toContain("m1");
    expect(text).not.toContain("m9");
    expect(text).not.toContain('"author"');
  });

  it("keeps `messages: null` when the writer's read-back failed (not an empty thread)", async () => {
    postProposalMessage.mockResolvedValueOnce({ status: 200, body: { ok: true, messages: null, rev: null, observedRev: "r1" } });
    expect(await (await post()).json()).toEqual({ messages: null, rev: null, observedRev: "r1" });
  });
});
