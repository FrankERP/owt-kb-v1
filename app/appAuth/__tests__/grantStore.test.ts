// app/appAuth/__tests__/grantStore.test.ts — the app family's instance of the
// shared grant-store protocol (spec D6): the documents it writes, the fail-closed
// missing token (§10 A5), the live list (sub AND origin AND 90 days) and the
// all-or-none revoke.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createHash } from "node:crypto";

vi.mock("server-only", () => ({}));

type PatchCall = { id: string; ifRevisionId?: string; set?: Record<string, unknown> };
const patchCalls: PatchCall[] = [];
const createMock = vi.fn();
const fetchMock = vi.fn();
const commitMock = vi.fn();
const txCommitMock = vi.fn();
const txPatches: PatchCall[] = [];

function makePatch(id: string) {
  const call: PatchCall = { id };
  const builder = {
    ifRevisionId(rev: string) {
      call.ifRevisionId = rev;
      return builder;
    },
    set(fields: Record<string, unknown>) {
      call.set = fields;
      return builder;
    },
    commit() {
      patchCalls.push(call);
      return commitMock(call);
    },
  };
  return { builder, call };
}

vi.mock("@/sanity/lib/serverClient", () => ({
  writeClient: {
    create: (...args: unknown[]) => createMock(...args),
    fetch: (...args: unknown[]) => fetchMock(...args),
    patch: (id: string) => makePatch(id).builder,
    transaction: () => {
      const tx = {
        patch(id: string, ops: (p: ReturnType<typeof makePatch>["builder"]) => unknown) {
          const { builder, call } = makePatch(id);
          ops(builder);
          txPatches.push(call);
          return tx;
        },
        commit: () => txCommitMock(),
      };
      return tx;
    },
  },
}));

import {
  APP_REVOKE_REASON,
  __clearAppGrantCache,
  createAppGrant,
  listLiveAppGrants,
  loadAppGrant,
  redeemAppCode,
  revokeAllAppGrants,
  revokeAppGrant,
  rotateAppRefresh,
} from "../grantStore";

const ORIGIN = "https://owt-backstage.vercel.app";
const GRANT_ID = "appAuthGrant.3b241101-e2bb-4255-8caf-4136c566a962";
const GRANT_ID_2 = "appAuthGrant.9b241101-e2bb-4255-8caf-4136c566a962";
const NOW = new Date("2026-11-20T12:00:00.000Z");

function storedDoc(over: Record<string, unknown> = {}) {
  return {
    _id: GRANT_ID,
    _rev: "rev-1",
    sub: "member-1",
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

const savedToken = process.env.SANITY_WRITE_TOKEN;
beforeEach(() => {
  process.env.SANITY_WRITE_TOKEN = "test-token";
  __clearAppGrantCache();
  patchCalls.length = 0;
  txPatches.length = 0;
  createMock.mockReset().mockResolvedValue({});
  fetchMock.mockReset();
  commitMock.mockReset().mockResolvedValue({});
  txCommitMock.mockReset().mockResolvedValue({});
});
afterEach(() => {
  if (savedToken === undefined) delete process.env.SANITY_WRITE_TOKEN;
  else process.env.SANITY_WRITE_TOKEN = savedToken;
});

describe("fail closed without the write token (§10 A5)", () => {
  it("answers server_error from every call and never touches Sanity", async () => {
    process.env.SANITY_WRITE_TOKEN = "";
    const results = [
      await createAppGrant({ sub: "m", clientId: "backstage-ios", origin: ORIGIN }),
      await loadAppGrant(GRANT_ID),
      await loadAppGrant(GRANT_ID, { fresh: true }),
      await revokeAppGrant(GRANT_ID, "x"),
      await redeemAppCode("j"),
      await listLiveAppGrants("m", ORIGIN, NOW),
      await revokeAllAppGrants("m", ORIGIN, "x", NOW),
    ];
    for (const r of results) expect(r).toMatchObject({ ok: false, reason: "server_error" });
    expect(fetchMock).not.toHaveBeenCalled();
    expect(createMock).not.toHaveBeenCalled();
  });
});

describe("documents", () => {
  it("creates an appAuthGrant with the platform derived from the client", async () => {
    const res = await createAppGrant({ sub: "member-1", clientId: "backstage-android", origin: ORIGIN });
    expect(res.ok).toBe(true);
    const doc = createMock.mock.calls[0]![0] as Record<string, unknown>;
    expect(doc).toMatchObject({ _type: "appAuthGrant", sub: "member-1", clientId: "backstage-android", platform: "android", origin: ORIGIN, revoked: false });
    expect(String(doc._id)).toMatch(/^appAuthGrant\.[0-9a-f-]{36}$/);
    if (res.ok) expect(res.refreshJti).toBe(doc.currentRefreshJti);
  });

  it("stores a code redemption under the sha256 of its jti", async () => {
    await redeemAppCode("jti-1");
    const doc = createMock.mock.calls[0]![0] as Record<string, unknown>;
    expect(doc._type).toBe("appAuthCodeRedemption");
    expect(doc._id).toBe("appAuthCode." + createHash("sha256").update("jti-1").digest("hex"));
  });

  it("reads only appAuthGrant documents and treats a platform mismatch as revoked", async () => {
    fetchMock.mockResolvedValueOnce(storedDoc({ platform: "android" }));
    expect(await loadAppGrant(GRANT_ID, { fresh: true })).toEqual({ ok: false, reason: "revoked" });
    expect(fetchMock.mock.calls[0]![1]).toMatchObject({ type: "appAuthGrant", id: GRANT_ID });
    fetchMock.mockResolvedValueOnce(storedDoc());
    expect(await loadAppGrant(GRANT_ID, { fresh: true })).toMatchObject({ ok: true, grant: { sub: "member-1", platform: "ios" } });
  });

  it("never reads an MCP grant id", async () => {
    expect(await loadAppGrant("mcpOauthGrant.3b241101-e2bb-4255-8caf-4136c566a962")).toEqual({ ok: false, reason: "revoked" });
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("rotation", () => {
  it("rotates under ifRevisionId and revokes the whole grant on reuse", async () => {
    fetchMock.mockResolvedValue(storedDoc());
    const fresh = await loadAppGrant(GRANT_ID, { fresh: true });
    if (!fresh.ok) throw new Error("expected live");
    const ok = await rotateAppRefresh(fresh.grant, "rjti-1", ORIGIN);
    expect(ok.ok).toBe(true);
    expect(patchCalls[0]).toMatchObject({ id: GRANT_ID, ifRevisionId: "rev-1" });
    const reuse = await rotateAppRefresh(fresh.grant, "old-jti", ORIGIN);
    expect(reuse).toEqual({ ok: false, reason: "reuse_revoked" });
    expect(patchCalls[1]!.set).toMatchObject({ revoked: true, revokedReason: "refresh_token_reuse" });
  });
});

describe("listLiveAppGrants", () => {
  it("filters by type, sub, origin, not revoked and the 90-day window, in GROQ", async () => {
    fetchMock.mockResolvedValueOnce([
      { _id: GRANT_ID, createdAt: "2026-11-01T00:00:00.000Z", lastRefreshAt: "2026-11-19T00:00:00.000Z", label: "ios" },
      { _id: "not-a-grant", createdAt: null, lastRefreshAt: null, label: "x" },
    ]);
    const res = await listLiveAppGrants("member-1", ORIGIN, NOW);
    expect(res).toEqual({
      ok: true,
      grants: [{ _id: GRANT_ID, createdAt: "2026-11-01T00:00:00.000Z", lastRefreshAt: "2026-11-19T00:00:00.000Z", label: "ios" }],
    });
    const [query, params] = fetchMock.mock.calls[0]! as [string, Record<string, unknown>];
    expect(query).toContain("sub == $sub && origin == $origin && revoked == false");
    expect(query).toContain("coalesce(lastRefreshAt, createdAt) > $since");
    expect(query).toContain('"label": platform');
    expect(params).toEqual({ type: "appAuthGrant", sub: "member-1", origin: ORIGIN, since: "2026-08-22T12:00:00.000Z" });
  });

  it("is a server_error on a failed read", async () => {
    fetchMock.mockRejectedValueOnce(new Error("down"));
    expect(await listLiveAppGrants("member-1", ORIGIN, NOW)).toMatchObject({ ok: false, reason: "server_error" });
  });
});

describe("revokeAllAppGrants", () => {
  it("revokes every live grant of that person on this origin in ONE transaction", async () => {
    fetchMock.mockResolvedValueOnce([GRANT_ID, GRANT_ID_2]);
    const res = await revokeAllAppGrants("member-1", ORIGIN, APP_REVOKE_REASON.admin, NOW);
    expect(res).toEqual({ ok: true, revoked: 2 });
    expect(txPatches.map((p) => p.id)).toEqual([GRANT_ID, GRANT_ID_2]);
    for (const p of txPatches) expect(p.set).toMatchObject({ revoked: true, revokedReason: "admin_revoked" });
    expect(txCommitMock).toHaveBeenCalledTimes(1);
    expect(commitMock).not.toHaveBeenCalled();
    expect(fetchMock.mock.calls[0]![1]).toMatchObject({ type: "appAuthGrant", sub: "member-1", origin: ORIGIN });
  });

  it("writes nothing when there is nothing live", async () => {
    fetchMock.mockResolvedValueOnce([]);
    expect(await revokeAllAppGrants("member-1", ORIGIN, "x", NOW)).toEqual({ ok: true, revoked: 0 });
    expect(txCommitMock).not.toHaveBeenCalled();
  });

  it("is all or none: a failed commit is a server_error and drops the cached grants", async () => {
    fetchMock.mockResolvedValueOnce(storedDoc());
    expect((await loadAppGrant(GRANT_ID)).ok).toBe(true);
    fetchMock.mockResolvedValueOnce([GRANT_ID]);
    txCommitMock.mockRejectedValueOnce(new Error("tx failed"));
    expect(await revokeAllAppGrants("member-1", ORIGIN, "x", NOW)).toMatchObject({ ok: false, reason: "server_error" });
    // The cache entry is gone, so the next read goes to Sanity.
    fetchMock.mockResolvedValueOnce(storedDoc({ revoked: true }));
    expect(await loadAppGrant(GRANT_ID)).toEqual({ ok: false, reason: "revoked" });
  });
});
