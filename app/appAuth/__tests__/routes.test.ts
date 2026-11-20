// app/appAuth/__tests__/routes.test.ts — the app door's routes end to end over a
// mocked store and member read (spec §3): the token matrix (code exchange,
// refresh, rotation outcomes), RFC 7009 revoke with no oracle, the guard behind
// `/api/app/v1/me`, and the two cookie-session revocations of «Apps conectadas».
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { s256Challenge } from "@/app/mcp/oauth/pkce";

vi.mock("server-only", () => ({}));

const store = vi.hoisted(() => ({
  createAppGrant: vi.fn(),
  loadAppGrant: vi.fn(),
  rotateAppRefresh: vi.fn(),
  revokeAppGrant: vi.fn(),
  redeemAppCode: vi.fn(),
  listLiveAppGrants: vi.fn(),
  revokeAllAppGrants: vi.fn(),
}));
vi.mock("@/app/appAuth/grantStore", () => ({
  APP_REVOKE_REASON: { signOut: "app_sign_out", member: "member_revoked", admin: "admin_revoked" },
  ...store,
}));

const getMemberAccess = vi.fn();
const fetchMemberAccessFresh = vi.fn();
vi.mock("@/app/utils/memberAccess", () => ({
  getMemberAccess: (...a: unknown[]) => getMemberAccess(...a),
  fetchMemberAccessFresh: (...a: unknown[]) => fetchMemberAccessFresh(...a),
}));

const serverFetch = vi.fn();
vi.mock("@/sanity/lib/serverClient", () => ({ serverClient: { fetch: (...a: unknown[]) => serverFetch(...a) } }));

const requireActiveSession = vi.fn();
vi.mock("@/app/utils/authGuards", () => ({ requireActiveSession: () => requireActiveSession() }));

import { POST as tokenPOST } from "@/app/api/app/v1/auth/token/route";
import { POST as revokePOST } from "@/app/api/app/v1/auth/revoke/route";
import { GET as meGET } from "@/app/api/app/v1/me/route";
import { POST as meRevokePOST } from "@/app/api/me/app-sessions/[grantId]/revoke/route";
import { POST as adminRevokePOST } from "@/app/api/admin/members/[id]/app-sessions/revoke/route";
import { signAppAccessToken, signAppCode, signAppRefreshToken } from "../tokens";

const SECRET = "s".repeat(40);
const KEY = new TextEncoder().encode(SECRET);
const ORIGIN = "http://localhost:3000";
const HOST = "localhost:3000";
const REDIRECT = `${ORIGIN}/app/callback/ios`;
const VERIFIER = "v".repeat(43);
const GRANT_ID = "appAuthGrant.3b241101-e2bb-4255-8caf-4136c566a962";
const ACTIVE = { active: true, role: "member", ministries: ["worship"], managesMinistries: [], ministryRoles: [] };

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

function grant(over: Record<string, unknown> = {}) {
  return {
    _id: GRANT_ID,
    _rev: "r1",
    sub: "m1",
    clientId: "backstage-ios",
    platform: "ios",
    origin: ORIGIN,
    createdAt: "2026-11-01T00:00:00.000Z",
    lastRefreshAt: null,
    currentRefreshJti: "rjti-1",
    revoked: false,
    ...over,
  };
}

beforeEach(() => {
  for (const fn of Object.values(store)) fn.mockReset();
  getMemberAccess.mockReset().mockResolvedValue(ACTIVE);
  fetchMemberAccessFresh.mockReset();
  serverFetch.mockReset();
  requireActiveSession.mockReset();
  store.redeemAppCode.mockResolvedValue({ ok: true });
  store.createAppGrant.mockResolvedValue({ ok: true, grantId: GRANT_ID, refreshJti: "rjti-1" });
  store.loadAppGrant.mockResolvedValue({ ok: true, grant: grant() });
  store.rotateAppRefresh.mockResolvedValue({ ok: true, refreshJti: "rjti-2" });
  store.revokeAppGrant.mockResolvedValue({ ok: true });
  vi.spyOn(console, "error").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
});

function form(fields: Record<string, string | string[]>, headers: Record<string, string> = {}, host = HOST): Request {
  const body = new URLSearchParams();
  for (const [k, v] of Object.entries(fields)) for (const one of Array.isArray(v) ? v : [v]) body.append(k, one);
  return new Request(`${ORIGIN}/api/app/v1/auth/token`, {
    method: "POST",
    headers: { host, "content-type": "application/x-www-form-urlencoded", ...headers },
    body: body.toString(),
  });
}

const code = (over: Partial<{ sub: string; clientId: "backstage-ios" | "backstage-android"; redirectUri: string }> = {}) =>
  signAppCode({ key: KEY, origin: ORIGIN, sub: "m1", clientId: "backstage-ios", redirectUri: REDIRECT, codeChallenge: s256Challenge(VERIFIER), ...over });

async function exchange(over: Record<string, string> = {}, headers: Record<string, string> = {}) {
  return tokenPOST(
    form({ grant_type: "authorization_code", code: await code(), redirect_uri: REDIRECT, client_id: "backstage-ios", code_verifier: VERIFIER, ...over }, headers),
  );
}

const refreshToken = (jti = "rjti-1", sub = "m1") => signAppRefreshToken({ key: KEY, origin: ORIGIN, sub, grantId: GRANT_ID, jti });

describe("POST /api/app/v1/auth/token — authorization_code", () => {
  it("issues an access and a refresh token, no-store", async () => {
    const res = await exchange();
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toContain("no-store");
    const body = await res.json();
    expect(body).toMatchObject({ token_type: "Bearer", expires_in: 3600 });
    expect(typeof body.access_token).toBe("string");
    expect(typeof body.refresh_token).toBe("string");
    expect(store.createAppGrant).toHaveBeenCalledWith({ sub: "m1", clientId: "backstage-ios", origin: ORIGIN });
  });

  it("refuses a replayed code", async () => {
    store.redeemAppCode.mockResolvedValueOnce({ ok: false, reason: "replay" });
    const res = await exchange();
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe("invalid_grant");
    expect(store.createAppGrant).not.toHaveBeenCalled();
  });

  it("binds the client, the redirect and the verifier", async () => {
    for (const over of [{ client_id: "backstage-android" } as Record<string, string>, { redirect_uri: `${ORIGIN}/app/callback/android` }, { code_verifier: "w".repeat(43) }]) {
      const res = await exchange(over);
      expect(res.status).toBe(400);
      expect((await res.json()).error).toBe("invalid_grant");
    }
    expect(store.redeemAppCode).not.toHaveBeenCalled();
  });

  it("refuses a disabled member with account_disabled and redeems nothing", async () => {
    getMemberAccess.mockResolvedValueOnce({ ...ACTIVE, active: false });
    const res = await exchange();
    expect(await res.json()).toEqual({ error: "invalid_grant", error_description: "account_disabled" });
    expect(store.redeemAppCode).not.toHaveBeenCalled();
  });

  it("answers 503 temporarily_unavailable on a Sanity failure, at any stage", async () => {
    getMemberAccess.mockRejectedValueOnce(new Error("down"));
    expect((await exchange()).status).toBe(503);
    store.redeemAppCode.mockResolvedValueOnce({ ok: false, reason: "server_error", cause: new Error("x") });
    expect((await exchange()).status).toBe(503);
    store.createAppGrant.mockResolvedValueOnce({ ok: false, reason: "server_error", cause: new Error("x") });
    const res = await exchange();
    expect(res.status).toBe(503);
    expect(res.headers.get("retry-after")).toBe("1");
  });

  it("refuses client authentication, repeated parameters, unknown clients and grant types", async () => {
    expect((await (await exchange({}, { authorization: "Basic eDp5" })).json()).error).toBe("invalid_client");
    expect((await (await exchange({ client_secret: "x" })).json()).error).toBe("invalid_client");
    expect((await (await exchange({ client_id: "evil" })).json()).error).toBe("invalid_client");
    const dup = await tokenPOST(form({ grant_type: "authorization_code", code: [await code(), await code()], redirect_uri: REDIRECT, client_id: "backstage-ios", code_verifier: VERIFIER }));
    expect((await dup.json()).error).toBe("invalid_request");
    expect((await (await tokenPOST(form({ grant_type: "password" }))).json()).error).toBe("unsupported_grant_type");
    expect((await (await tokenPOST(form({}))).json()).error).toBe("invalid_request");
  });

  it("refuses a foreign host (404), the kill switch and a missing secret (503)", async () => {
    expect((await tokenPOST(form({ grant_type: "x" }, {}, "evil.example"))).status).toBe(404);
    process.env.APP_AUTH_DISABLED = "1";
    try {
      expect((await tokenPOST(form({ grant_type: "x" }))).status).toBe(503);
    } finally {
      delete process.env.APP_AUTH_DISABLED;
    }
  });

  it("refuses a body that is not a form", async () => {
    const res = await tokenPOST(new Request(`${ORIGIN}/x`, { method: "POST", headers: { host: HOST, "content-type": "application/json" }, body: "{}" }));
    expect((await res.json()).error).toBe("invalid_request");
  });
});

describe("POST /api/app/v1/auth/token — refresh_token", () => {
  const refresh = async (over: Record<string, string> = {}) =>
    tokenPOST(form({ grant_type: "refresh_token", refresh_token: await refreshToken(), client_id: "backstage-ios", ...over }));

  it("rotates on a FRESH read and returns the new pair", async () => {
    const res = await refresh();
    expect(res.status).toBe(200);
    expect(store.loadAppGrant).toHaveBeenCalledWith(GRANT_ID, { fresh: true });
    expect(store.rotateAppRefresh).toHaveBeenCalledWith(expect.objectContaining({ _id: GRANT_ID }), "rjti-1", ORIGIN);
  });

  it("maps every rotation outcome", async () => {
    store.rotateAppRefresh.mockResolvedValueOnce({ ok: false, reason: "conflict" });
    let res = await refresh();
    expect(res.status).toBe(503);
    expect((await res.json()).error).toBe("temporarily_unavailable");

    store.rotateAppRefresh.mockResolvedValueOnce({ ok: false, reason: "reuse_revoked" });
    res = await refresh();
    expect((await res.json()).error).toBe("invalid_grant");
    expect(console.warn).toHaveBeenCalled();

    store.rotateAppRefresh.mockResolvedValueOnce({ ok: false, reason: "wrong_origin" });
    expect((await (await refresh()).json()).error).toBe("invalid_grant");

    store.rotateAppRefresh.mockResolvedValueOnce({ ok: false, reason: "server_error", cause: new Error("x") });
    expect((await refresh()).status).toBe(503);
  });

  it("refuses a revoked grant, another client's grant and a disabled member", async () => {
    store.loadAppGrant.mockResolvedValueOnce({ ok: false, reason: "revoked" });
    expect((await (await refresh()).json()).error).toBe("invalid_grant");
    expect((await (await refresh({ client_id: "backstage-android" })).json()).error).toBe("invalid_grant");
    getMemberAccess.mockResolvedValueOnce({ ...ACTIVE, active: false });
    expect(await (await refresh()).json()).toEqual({ error: "invalid_grant", error_description: "account_disabled" });
    expect(store.rotateAppRefresh).not.toHaveBeenCalled();
  });

  it("answers 503 when the grant read fails — never a sign-out", async () => {
    store.loadAppGrant.mockResolvedValueOnce({ ok: false, reason: "server_error", cause: new Error("x") });
    expect((await refresh()).status).toBe(503);
  });

  it("refuses an access token presented as a refresh token", async () => {
    const { token } = await signAppAccessToken({ key: KEY, origin: ORIGIN, sub: "m1", grantId: GRANT_ID });
    expect((await (await refresh({ refresh_token: token })).json()).error).toBe("invalid_grant");
  });
});

describe("POST /api/app/v1/auth/revoke", () => {
  const revoke = async (fields: Record<string, string>) =>
    revokePOST(new Request(`${ORIGIN}/api/app/v1/auth/revoke`, {
      method: "POST",
      headers: { host: HOST, "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams(fields).toString(),
    }));

  it("revokes a valid token's grant as app_sign_out", async () => {
    const res = await revoke({ token: await refreshToken(), client_id: "backstage-ios" });
    expect(res.status).toBe(200);
    expect(store.revokeAppGrant).toHaveBeenCalledWith(GRANT_ID, "app_sign_out");
  });

  it("answers 200 to an invalid token or another client's grant, writing nothing (no oracle)", async () => {
    expect((await revoke({ token: "garbage", client_id: "backstage-ios" })).status).toBe(200);
    expect((await revoke({ token: await refreshToken(), client_id: "backstage-android" })).status).toBe(200);
    expect(store.revokeAppGrant).not.toHaveBeenCalled();
  });

  it("answers 503 only when a valid token's revocation write fails", async () => {
    store.revokeAppGrant.mockResolvedValueOnce({ ok: false, reason: "server_error", cause: new Error("x") });
    expect((await revoke({ token: await refreshToken(), client_id: "backstage-ios" })).status).toBe(503);
  });
});

describe("GET /api/app/v1/me (the guard)", () => {
  const me = (authorization?: string, host = HOST) =>
    meGET(new Request(`${ORIGIN}/api/app/v1/me`, { headers: { host, ...(authorization ? { authorization } : {}) } }));
  const bearer = async (sub = "m1") => `Bearer ${(await signAppAccessToken({ key: KEY, origin: ORIGIN, sub, grantId: GRANT_ID })).token}`;

  it("answers the person, with the platform of the grant", async () => {
    serverFetch.mockResolvedValueOnce({ _id: "m1", member_name: "Ana", alias: "Anita", photoUrl: null });
    const res = await me(await bearer());
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ id: "m1", name: "Ana", alias: "Anita", photoUrl: null, role: "member", ministries: ["worship"], platform: "ios" });
  });

  it("401s without a token, with a bad one, and with a revoked grant", async () => {
    expect((await me()).status).toBe(401);
    expect((await me("Bearer nope")).status).toBe(401);
    expect((await me("Basic abc")).status).toBe(401);
    store.loadAppGrant.mockResolvedValueOnce({ ok: false, reason: "revoked" });
    const res = await me(await bearer());
    expect(res.status).toBe(401);
    expect((await res.json()).error).toBe("invalid_token");
  });

  it("401s a token whose subject is not the grant's, or a grant of another deployment", async () => {
    expect((await me(await bearer("m2"))).status).toBe(401);
    store.loadAppGrant.mockResolvedValueOnce({ ok: true, grant: grant({ origin: "https://dev-owt-backstage.vercel.app" }) });
    expect((await me(await bearer())).status).toBe(401);
  });

  it("401s a disabled member as account_disabled", async () => {
    getMemberAccess.mockResolvedValueOnce({ ...ACTIVE, active: false });
    const res = await me(await bearer());
    expect(res.status).toBe(401);
    expect((await res.json()).error).toBe("account_disabled");
  });

  it("503s on a grant or member read failure", async () => {
    store.loadAppGrant.mockResolvedValueOnce({ ok: false, reason: "server_error", cause: new Error("x") });
    expect((await me(await bearer())).status).toBe(503);
    getMemberAccess.mockRejectedValueOnce(new Error("down"));
    expect((await me(await bearer())).status).toBe(503);
  });

  it("404s a foreign host before reading anything", async () => {
    expect((await me(await bearer(), "evil.example")).status).toBe(404);
    expect(store.loadAppGrant).not.toHaveBeenCalled();
  });
});

describe("POST /api/me/app-sessions/[grantId]/revoke", () => {
  const call = (grantId = GRANT_ID) => meRevokePOST(new Request(`${ORIGIN}/x`, { method: "POST" }), { params: Promise.resolve({ grantId }) });

  it("closes the person's own session on this deployment", async () => {
    requireActiveSession.mockResolvedValue({ user: { sanityId: "m1" } });
    const res = await call();
    expect(res.status).toBe(200);
    expect(store.loadAppGrant).toHaveBeenCalledWith(GRANT_ID, { fresh: true });
    expect(store.revokeAppGrant).toHaveBeenCalledWith(GRANT_ID, "member_revoked");
  });

  it("answers the same 404 for someone else's, another deployment's, a revoked or a malformed id", async () => {
    requireActiveSession.mockResolvedValue({ user: { sanityId: "m2" } });
    expect((await call()).status).toBe(404);
    requireActiveSession.mockResolvedValue({ user: { sanityId: "m1" } });
    store.loadAppGrant.mockResolvedValueOnce({ ok: true, grant: grant({ origin: "https://dev-owt-backstage.vercel.app" }) });
    expect((await call()).status).toBe(404);
    store.loadAppGrant.mockResolvedValueOnce({ ok: false, reason: "revoked" });
    expect((await call()).status).toBe(404);
    expect((await call("teamMembers.abc")).status).toBe(404);
    expect(store.revokeAppGrant).not.toHaveBeenCalled();
  });

  it("refuses no session (401) and impersonation (403)", async () => {
    requireActiveSession.mockResolvedValue(null);
    expect((await call()).status).toBe(401);
    requireActiveSession.mockResolvedValue({ user: { sanityId: "m1", isImpersonating: true } });
    expect((await call()).status).toBe(403);
    expect(store.loadAppGrant).not.toHaveBeenCalled();
  });

  it("503s on a read or write failure", async () => {
    requireActiveSession.mockResolvedValue({ user: { sanityId: "m1" } });
    store.loadAppGrant.mockResolvedValueOnce({ ok: false, reason: "server_error", cause: new Error("x") });
    expect((await call()).status).toBe(503);
    store.revokeAppGrant.mockResolvedValueOnce({ ok: false, reason: "server_error", cause: new Error("x") });
    expect((await call()).status).toBe(503);
  });
});

describe("POST /api/admin/members/[id]/app-sessions/revoke", () => {
  const call = (id = "member-9") => adminRevokePOST(new Request(`${ORIGIN}/x`, { method: "POST" }), { params: Promise.resolve({ id }) });

  it("lets a LIVE super-admin close every session of a member on this deployment", async () => {
    requireActiveSession.mockResolvedValue({ user: { sanityId: "boss", role: "super-admin" } });
    fetchMemberAccessFresh.mockResolvedValue({ ...ACTIVE, role: "super-admin" });
    store.revokeAllAppGrants.mockResolvedValue({ ok: true, revoked: 2 });
    const res = await call();
    expect(await res.json()).toEqual({ ok: true, revoked: 2 });
    expect(store.revokeAllAppGrants).toHaveBeenCalledWith("member-9", ORIGIN, "admin_revoked");
  });

  it("refuses a session whose JWT says super-admin but whose live role is not", async () => {
    requireActiveSession.mockResolvedValue({ user: { sanityId: "boss", role: "super-admin" } });
    fetchMemberAccessFresh.mockResolvedValue({ ...ACTIVE, role: "admin" });
    expect((await call()).status).toBe(403);
    expect(store.revokeAllAppGrants).not.toHaveBeenCalled();
  });

  it("refuses while impersonating and without a session", async () => {
    requireActiveSession.mockResolvedValue({ user: { sanityId: "boss", role: "super-admin", isImpersonating: true } });
    fetchMemberAccessFresh.mockResolvedValue({ ...ACTIVE, role: "super-admin" });
    expect((await call()).status).toBe(403);
    requireActiveSession.mockResolvedValue(null);
    expect((await call()).status).toBe(403);
    expect(store.revokeAllAppGrants).not.toHaveBeenCalled();
  });

  it("503s when the all-or-none transaction fails", async () => {
    requireActiveSession.mockResolvedValue({ user: { sanityId: "boss" } });
    fetchMemberAccessFresh.mockResolvedValue({ ...ACTIVE, role: "super-admin" });
    store.revokeAllAppGrants.mockResolvedValue({ ok: false, reason: "server_error", cause: new Error("x") });
    const res = await call();
    expect(res.status).toBe(503);
    expect((await res.json()).error).toBe("No se pudo cerrar; intenta de nuevo.");
  });
});
