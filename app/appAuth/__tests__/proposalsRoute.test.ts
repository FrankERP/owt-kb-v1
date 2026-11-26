// app/appAuth/__tests__/proposalsRoute.test.ts — the native app's proposal endpoints (ADR-0091 W1):
//
//  - `POST /api/app/v1/proposals`: the app's door to the ONE proposal writer. No token 401; outside
//    Alabanza 403; a FRESH access read that finds the member inactive answers 401 `account_disabled`
//    with no write, and a failed fresh read 503; a body that is not JSON is the web's
//    `invalid_request`; a throw from the writer is the door's 503, logged, never a bare 500; the
//    writer's own answers (403 non-Lead, 409, 200) pass through; the token's subject is the `leadId`;
//  - `GET /api/app/v1/proposals/[roleId]`: 404 for a malformed id (no read), a non-Lead or a draft
//    service; `observed` is the proposal it returns; a Sanity failure is a retry;
//  - `GET /api/app/v1/songs/previous-keys`: at most 50 canonical ids, else 400.
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

const saveProposal = vi.fn();
vi.mock("@/app/utils/proposalSaveCommit", () => ({ saveProposal: (...a: unknown[]) => saveProposal(...a) }));

const operationalFetch = vi.fn();
vi.mock("@/sanity/lib/operationalClient", () => ({ operationalClient: { fetch: (...a: unknown[]) => operationalFetch(...a) } }));

import { POST } from "@/app/api/app/v1/proposals/route";
import { GET as GET_EDITOR } from "@/app/api/app/v1/proposals/[roleId]/route";
import { GET as GET_PREVIOUS_KEYS } from "@/app/api/app/v1/songs/previous-keys/route";
import { signAppAccessToken } from "../tokens";

const SECRET = "s".repeat(40);
const KEY = new TextEncoder().encode(SECRET);
const ORIGIN = "http://localhost:3000";
const GRANT_ID = "appAuthGrant.3b241101-e2bb-4255-8caf-4136c566a962";
const WORSHIP = { active: true, role: "member", ministries: ["worship"], managesMinistries: [], ministryRoles: [] };

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
  saveProposal.mockReset();
  operationalFetch.mockReset();
  consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
});

async function bearer(): Promise<Record<string, string>> {
  const { token } = await signAppAccessToken({ key: KEY, origin: ORIGIN, sub: "m1", grantId: GRANT_ID });
  return { host: "localhost:3000", authorization: `Bearer ${token}` };
}

const BODY = {
  roleId: "sun-1",
  observed: { state: "none" },
  songs: [{ songId: "song-1", play_key: "G", medley_tag: null }],
  teamNotes: "",
  pastorMessage: "",
  status: "draft",
};

async function post(body: string = JSON.stringify(BODY), headers?: Record<string, string>): Promise<Response> {
  return POST(new Request(`${ORIGIN}/api/app/v1/proposals`, {
    method: "POST",
    headers: { ...(headers ?? (await bearer())), "content-type": "application/json" },
    body,
  }));
}

describe("POST /api/app/v1/proposals", () => {
  it("401s without a token, before any read or write", async () => {
    const res = await post(JSON.stringify(BODY), { host: "localhost:3000" });
    expect(res.status).toBe(401);
    expect(fetchMemberAccessFresh).not.toHaveBeenCalled();
    expect(saveProposal).not.toHaveBeenCalled();
  });

  it("refuses someone outside Alabanza (403) with no write", async () => {
    getMemberAccess.mockResolvedValueOnce({ ...WORSHIP, ministries: ["jovenes"] });
    expect((await post()).status).toBe(403);
    expect(saveProposal).not.toHaveBeenCalled();
  });

  it("re-reads access fresh: inactive → 401 account_disabled, no write", async () => {
    fetchMemberAccessFresh.mockResolvedValueOnce({ ...WORSHIP, active: false });
    const res = await post();
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: "account_disabled" });
    expect(fetchMemberAccessFresh).toHaveBeenCalledWith("m1");
    expect(saveProposal).not.toHaveBeenCalled();
  });

  it("re-reads access fresh: no longer in Alabanza → 403, no write", async () => {
    fetchMemberAccessFresh.mockResolvedValueOnce({ ...WORSHIP, ministries: ["kids"] });
    expect((await post()).status).toBe(403);
    expect(saveProposal).not.toHaveBeenCalled();
  });

  it("a failed fresh read answers 503, never a write", async () => {
    fetchMemberAccessFresh.mockRejectedValueOnce(new Error("down"));
    const res = await post();
    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({ error: "temporarily_unavailable" });
    expect(saveProposal).not.toHaveBeenCalled();
  });

  it("a body that is not JSON is the web's invalid_request, no write", async () => {
    const res = await post("{not json");
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ error: "invalid_request", details: { issues: ["json"] } });
    expect(saveProposal).not.toHaveBeenCalled();
  });

  it("delegates with the token's subject as leadId and passes the writer's answer through, no-store", async () => {
    saveProposal.mockResolvedValueOnce({ status: 200, body: { _id: "setlistProposal.sun-1", _rev: "r2", status: "draft", messages: [] } });
    const res = await post();
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toContain("no-store");
    expect(await res.json()).toEqual({ _id: "setlistProposal.sun-1", _rev: "r2", status: "draft", messages: [] });
    expect(saveProposal).toHaveBeenCalledWith({ leadId: "m1", raw: BODY });
  });

  it("maps a success's thread rows like the editor read: names and mine, never a member id", async () => {
    saveProposal.mockResolvedValueOnce({ status: 200, body: {
      _id: "setlistProposal.sun-1", _rev: "r3", status: "pending",
      messages: [
        { _key: "k1", author: "m1", author_name: "Frank", author_role: "lead", kind: "lead_note", body: "Va", at: "2026-11-26T10:00:00Z" },
        { author: "m9", author_name: "Ana", body: "Sin clave", at: "2026-11-26T11:00:00Z" },
      ],
    } });
    const res = await post();
    expect(res.status).toBe(200);
    const text = await res.text();
    expect(text).not.toContain("m9");
    expect(JSON.parse(text)).toEqual({
      _id: "setlistProposal.sun-1", _rev: "r3", status: "pending",
      messages: [
        { key: "k1", authorName: "Frank", authorRole: "lead", kind: "lead_note", body: "Va", at: "2026-11-26T10:00:00Z", editedAt: null, mine: true },
        { key: "p1", authorName: "Ana", authorRole: null, kind: null, body: "Sin clave", at: "2026-11-26T11:00:00Z", editedAt: null, mine: false },
      ],
    });
  });

  it("keeps a success's messages: null (the read-back failed), never an empty thread", async () => {
    saveProposal.mockResolvedValueOnce({ status: 200, body: { _id: "setlistProposal.sun-1", _rev: null, status: "draft", messages: null } });
    expect(await (await post()).json()).toEqual({ _id: "setlistProposal.sun-1", _rev: null, status: "draft", messages: null });
  });

  it("passes the writer's 403 (not a Lead) and 409 (stale) through unchanged", async () => {
    saveProposal.mockResolvedValueOnce({ status: 403, body: { error: "Not a Lead on this service" } });
    expect((await post()).status).toBe(403);
    saveProposal.mockResolvedValueOnce({ status: 409, body: { error: "stale_revision", conflict: true } });
    const res = await post();
    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({ error: "stale_revision" });
  });

  it("a throw from the writer answers the door's 503 and is logged", async () => {
    saveProposal.mockRejectedValueOnce(new Error("commit failed"));
    const res = await post();
    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({ error: "temporarily_unavailable" });
    expect(consoleError).toHaveBeenCalled();
  });
});

async function getEditor(roleId: string): Promise<Response> {
  return GET_EDITOR(new Request(`${ORIGIN}/api/app/v1/proposals/${roleId}`, { headers: await bearer() }), {
    params: Promise.resolve({ roleId }),
  });
}

const ROLE = { _id: "sun-1", _type: "sunday_role", week: "2099-01-04" };
const PROPOSAL = {
  _id: "setlistProposal.sun-1",
  _rev: "rev-7",
  status: "draft",
  team_notes: "Llegar 8:30",
  pastor_message: "",
  contributors: [{ id: "m1", name: "Ana" }, { id: "m2", name: "Beto" }],
  messages: [{ _key: "k1", author: "m2", author_name: "Beto", author_role: "lead", kind: "lead_note", body: "Hola", at: "2099-01-01T10:00:00Z" }],
  songs: [{ _key: "s1", song_id: "song-1", title: "Santo", author: "X", key: "G", play_key: "A", medley_tag: null }],
};

describe("GET /api/app/v1/proposals/[roleId]", () => {
  it("404s a malformed role id before any read", async () => {
    const res = await getEditor("drafts.sun-1");
    expect(res.status).toBe(404);
    expect(operationalFetch).not.toHaveBeenCalled();
  });

  it("404s a non-Lead or a draft service (the role read comes back empty)", async () => {
    operationalFetch.mockResolvedValueOnce([]);
    expect((await getEditor("sun-1")).status).toBe(404);
    const [query, params] = operationalFetch.mock.calls[0]!;
    expect(query).toContain("$leadId in Lead[]._ref");
    expect(query).toContain("published != false");
    expect(params).toEqual({ id: "sun-1", leadId: "m1" });
  });

  it("answers the proposal with the observed revision it was read at, previous keys and no member ids", async () => {
    operationalFetch
      .mockResolvedValueOnce([ROLE])
      .mockResolvedValueOnce(PROPOSAL)
      .mockResolvedValueOnce({ messages: [], pastor_message: { body: "Oremos" } })
      .mockResolvedValueOnce([{ _id: "f1", _type: "featuredSongs", week: "2098-12-01", songs: [{ songId: "song-1", play_key: "B" }] }]);
    const res = await getEditor("sun-1");
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toContain("no-store");
    const body = await res.json();
    expect(body.role).toEqual({ id: "sun-1", kind: "sunday", date: "2099-01-04", title: "Domingo" });
    expect(body.observed).toEqual({ state: "single", id: "setlistProposal.sun-1", rev: "rev-7" });
    expect(body.proposal.songs).toEqual([
      { songId: "song-1", title: "Santo", author: "X", key: "G", play_key: "A", medley_tag: null, previous_keys: ["B"] },
    ]);
    expect(body.proposal.contributors).toEqual([{ name: "Ana", mine: true }, { name: "Beto", mine: false }]);
    expect(body.proposal.messages[0]).toMatchObject({ authorName: "Beto", mine: false, body: "Hola" });
    expect(body.serviceThread.pastorMessage).toBe("Oremos");
    expect(JSON.stringify(body)).not.toContain("m2");
  });

  it("answers observed none and no proposal when the service has none", async () => {
    operationalFetch.mockResolvedValueOnce([ROLE]).mockResolvedValueOnce(null).mockResolvedValueOnce(null);
    const body = await (await getEditor("sun-1")).json();
    expect(body.observed).toEqual({ state: "none" });
    expect(body.proposal).toBeNull();
  });

  it("answers 503 when Sanity fails", async () => {
    operationalFetch.mockRejectedValueOnce(new Error("down"));
    expect((await getEditor("sun-1")).status).toBe(503);
  });
});

describe("GET /api/app/v1/songs/previous-keys", () => {
  async function getKeys(query: string): Promise<Response> {
    return GET_PREVIOUS_KEYS(new Request(`${ORIGIN}/api/app/v1/songs/previous-keys${query}`, { headers: await bearer() }));
  }

  it("answers every asked id, an empty list for a song never played", async () => {
    operationalFetch.mockResolvedValueOnce([{ _id: "f1", _type: "featuredSongs", week: "2098-12-01", songs: [{ songId: "a", play_key: "C" }] }]);
    const res = await getKeys("?ids=a,b,a");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ a: ["C"], b: [] });
  });

  it("400s no ids, a malformed id or more than 50, before any read", async () => {
    expect((await getKeys("")).status).toBe(400);
    expect((await getKeys("?ids=drafts.a")).status).toBe(400);
    const many = Array.from({ length: 51 }, (_, i) => `s${i}`).join(",");
    expect((await getKeys(`?ids=${many}`)).status).toBe(400);
    expect(operationalFetch).not.toHaveBeenCalled();
  });
});
