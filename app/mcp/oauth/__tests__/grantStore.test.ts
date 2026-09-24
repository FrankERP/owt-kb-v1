// app/mcp/oauth/__tests__/grantStore.test.ts
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createHash } from "node:crypto";

vi.mock("server-only", () => ({}));

// ── writeClient mock: records every chained patch, never reaches Sanity ─────
type PatchCall = { id: string; ifRevisionId?: string; set?: Record<string, unknown> };
const patchCalls: PatchCall[] = [];
const createMock = vi.fn();
const fetchMock = vi.fn();
const commitMock = vi.fn();

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
  return builder;
}

vi.mock("@/sanity/lib/serverClient", () => ({
  writeClient: {
    create: (...args: unknown[]) => createMock(...args),
    fetch: (...args: unknown[]) => fetchMock(...args),
    patch: (id: string) => makePatch(id),
  },
}));

import {
  GRANT_CACHE_TTL_MS,
  REVOKE_REASON_REFRESH_REUSE,
  __clearGrantCache,
  createGrant,
  loadGrant,
  redeemCode,
  revokeGrant,
  rotateRefresh,
  type FreshGrant,
  type StoredGrant,
} from "../grantStore";
import { GRANT_FIELDS } from "../grantDocument";

const sha = (s: string) => createHash("sha256").update(s, "utf8").digest("hex");
const NOW = new Date("2026-09-24T12:00:00.000Z");
const PROD = "https://owt-backstage.vercel.app";
const PREVIEW = "https://dev-owt-backstage.vercel.app";
const GRANT_ID = "mcpOauthGrant.3b241101-e2bb-4255-8caf-4136c566a962";

function storedDoc(over: Record<string, unknown> = {}) {
  return {
    _id: GRANT_ID,
    _rev: "rev-1",
    _type: "mcpOauthGrant",
    sub: "member-1",
    clientHash: sha("client"),
    origin: PROD,
    createdAt: "2026-09-20T00:00:00.000Z",
    currentRefreshJti: "rjti-1",
    revoked: false,
    ...over,
  };
}

function conflict(type: string) {
  return Object.assign(new Error("conflict"), {
    statusCode: 409,
    details: { type: "mutationError", description: "x", items: [{ error: { type } }] },
  });
}

async function freshGrant(over: Record<string, unknown> = {}): Promise<FreshGrant> {
  fetchMock.mockResolvedValueOnce(storedDoc(over));
  const res = await loadGrant(GRANT_ID, { fresh: true });
  if (!res.ok) throw new Error("setup: expected a live grant");
  return res.grant;
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
  __clearGrantCache();
  patchCalls.length = 0;
  createMock.mockReset();
  fetchMock.mockReset();
  commitMock.mockReset();
  commitMock.mockResolvedValue({});
});
afterEach(() => vi.useRealTimers());

describe("createGrant", () => {
  it("creates one grant document inside the declared field list", async () => {
    createMock.mockResolvedValue({});
    const res = await createGrant({ sub: "member-1", clientId: "client", origin: PROD });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(createMock).toHaveBeenCalledTimes(1);
    const doc = createMock.mock.calls[0][0] as Record<string, unknown>;
    const allowed = new Set<string>(["_id", "_type", ...GRANT_FIELDS]);
    for (const key of Object.keys(doc)) expect(allowed.has(key), key).toBe(true);
    expect(doc._id).toMatch(/^mcpOauthGrant\.[0-9a-f-]{36}$/);
    expect(doc).toMatchObject({
      _type: "mcpOauthGrant",
      sub: "member-1",
      clientHash: sha("client"),
      origin: PROD,
      createdAt: NOW.toISOString(),
      revoked: false,
    });
    expect(res.grantId).toBe(doc._id);
    expect(res.refreshJti).toBe(doc.currentRefreshJti);
    expect(res.refreshJti).toMatch(/^[0-9a-f-]{36}$/);
  });

  it("a Sanity failure is a typed server failure", async () => {
    const boom = new Error("network");
    createMock.mockRejectedValue(boom);
    expect(await createGrant({ sub: "m", clientId: "c", origin: PROD })).toEqual({
      ok: false,
      reason: "server_error",
      cause: boom,
    });
  });
});

describe("loadGrant", () => {
  it("returns a live grant", async () => {
    fetchMock.mockResolvedValue(storedDoc());
    const res = await loadGrant(GRANT_ID);
    expect(res.ok).toBe(true);
    if (res.ok) expect(res.grant).toMatchObject({ _id: GRANT_ID, _rev: "rev-1", sub: "member-1", revoked: false });
    expect(fetchMock.mock.calls[0][1]).toEqual({ id: GRANT_ID, type: "mcpOauthGrant" });
  });

  it("a revoked grant is refused", async () => {
    fetchMock.mockResolvedValue(storedDoc({ revoked: true }));
    expect(await loadGrant(GRANT_ID)).toEqual({ ok: false, reason: "revoked" });
  });

  it("a missing grant document is treated as revoked", async () => {
    fetchMock.mockResolvedValue(null);
    expect(await loadGrant(GRANT_ID)).toEqual({ ok: false, reason: "revoked" });
  });

  it("a malformed document is treated as revoked", async () => {
    fetchMock.mockResolvedValue(storedDoc({ currentRefreshJti: undefined }));
    expect(await loadGrant(GRANT_ID)).toEqual({ ok: false, reason: "revoked" });
  });

  it("an id that is not a grant id is revoked without a read", async () => {
    expect(await loadGrant("teamMembers.x")).toEqual({ ok: false, reason: "revoked" });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("a read failure is a typed server failure and is not cached", async () => {
    const boom = new Error("503");
    fetchMock.mockRejectedValueOnce(boom).mockResolvedValueOnce(storedDoc());
    expect(await loadGrant(GRANT_ID)).toEqual({ ok: false, reason: "server_error", cause: boom });
    expect((await loadGrant(GRANT_ID)).ok).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("the cache serves within 30 s and re-reads after", async () => {
    expect(GRANT_CACHE_TTL_MS).toBe(30_000);
    fetchMock.mockResolvedValue(storedDoc());
    await loadGrant(GRANT_ID);
    vi.advanceTimersByTime(29_999);
    await loadGrant(GRANT_ID);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(1);
    await loadGrant(GRANT_ID);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("a cached revocation is served from the cache too", async () => {
    fetchMock.mockResolvedValue(null);
    await loadGrant(GRANT_ID);
    expect(await loadGrant(GRANT_ID)).toEqual({ ok: false, reason: "revoked" });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("fresh bypasses the cache and refreshes it", async () => {
    fetchMock.mockResolvedValueOnce(storedDoc()).mockResolvedValueOnce(storedDoc({ revoked: true }));
    expect((await loadGrant(GRANT_ID)).ok).toBe(true);
    expect(await loadGrant(GRANT_ID, { fresh: true })).toEqual({ ok: false, reason: "revoked" });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    // The fresh read replaced the cached entry.
    expect(await loadGrant(GRANT_ID)).toEqual({ ok: false, reason: "revoked" });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});

describe("revokeGrant", () => {
  it("sets revoked/revokedAt/revokedReason unconditionally", async () => {
    expect(await revokeGrant(GRANT_ID, "manual")).toEqual({ ok: true });
    expect(patchCalls).toEqual([
      { id: GRANT_ID, set: { revoked: true, revokedAt: NOW.toISOString(), revokedReason: "manual" } },
    ]);
  });

  it("refuses, without writing, an id that is not a grant id", async () => {
    const res = await revokeGrant("teamMembers.abc", "manual");
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.reason).toBe("server_error");
    expect(patchCalls).toHaveLength(0);
  });

  it("drops the cache entry", async () => {
    fetchMock.mockResolvedValueOnce(storedDoc()).mockResolvedValueOnce(storedDoc({ revoked: true }));
    expect((await loadGrant(GRANT_ID)).ok).toBe(true);
    await revokeGrant(GRANT_ID, "manual");
    expect(await loadGrant(GRANT_ID)).toEqual({ ok: false, reason: "revoked" });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("a write failure is a typed server failure (and the cache is still dropped)", async () => {
    fetchMock.mockResolvedValue(storedDoc());
    await loadGrant(GRANT_ID);
    const boom = new Error("500");
    commitMock.mockRejectedValueOnce(boom);
    expect(await revokeGrant(GRANT_ID, "manual")).toEqual({ ok: false, reason: "server_error", cause: boom });
    await loadGrant(GRANT_ID);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});

describe("rotateRefresh", () => {
  it("rotates under the grant's revision and returns a new jti", async () => {
    const grant = await freshGrant();
    const res = await rotateRefresh(grant, "rjti-1", PROD);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.refreshJti).toMatch(/^[0-9a-f-]{36}$/);
    expect(res.refreshJti).not.toBe("rjti-1");
    expect(patchCalls).toEqual([
      {
        id: GRANT_ID,
        ifRevisionId: "rev-1",
        set: { currentRefreshJti: res.refreshJti, lastRefreshAt: NOW.toISOString() },
      },
    ]);
    for (const key of Object.keys(patchCalls[0].set ?? {})) {
      expect((GRANT_FIELDS as readonly string[]).includes(key)).toBe(true);
    }
  });

  it("drops the cache entry after a rotation", async () => {
    const grant = await freshGrant();
    await rotateRefresh(grant, "rjti-1", PROD);
    fetchMock.mockResolvedValueOnce(storedDoc({ _rev: "rev-2" }));
    await loadGrant(GRANT_ID);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("a superseded refresh jti revokes the whole grant", async () => {
    const grant = await freshGrant({ currentRefreshJti: "rjti-2" });
    expect(await rotateRefresh(grant, "rjti-1", PROD)).toEqual({ ok: false, reason: "reuse_revoked" });
    expect(patchCalls).toEqual([
      {
        id: GRANT_ID,
        set: { revoked: true, revokedAt: NOW.toISOString(), revokedReason: REVOKE_REASON_REFRESH_REUSE },
      },
    ]);
    expect(REVOKE_REASON_REFRESH_REUSE).toBe("refresh_token_reuse");
  });

  it("a failed revocation on reuse is a server failure, never a silent success", async () => {
    const grant = await freshGrant({ currentRefreshJti: "rjti-2" });
    const boom = new Error("500");
    commitMock.mockRejectedValueOnce(boom);
    expect(await rotateRefresh(grant, "rjti-1", PROD)).toEqual({ ok: false, reason: "server_error", cause: boom });
  });

  it("a revision conflict is refused but NOT revoked", async () => {
    const grant = await freshGrant();
    commitMock.mockRejectedValueOnce(conflict("documentRevisionIDDoesNotMatchError"));
    expect(await rotateRefresh(grant, "rjti-1", PROD)).toEqual({ ok: false, reason: "conflict" });
    // The only write attempted was the guarded rotation; no revocation followed.
    expect(patchCalls).toHaveLength(1);
    expect(patchCalls[0].ifRevisionId).toBe("rev-1");
    expect(patchCalls[0].set).not.toHaveProperty("revoked");
  });

  it("any other write failure is a typed server failure", async () => {
    const grant = await freshGrant();
    const boom = Object.assign(new Error("forbidden"), { statusCode: 403 });
    commitMock.mockRejectedValueOnce(boom);
    expect(await rotateRefresh(grant, "rjti-1", PROD)).toEqual({ ok: false, reason: "server_error", cause: boom });
  });

  it("a revoked grant is refused with no write", async () => {
    const grant = { ...(await freshGrant()), revoked: true } as FreshGrant;
    expect(await rotateRefresh(grant, "rjti-1", PROD)).toEqual({ ok: false, reason: "revoked" });
    expect(patchCalls).toHaveLength(0);
  });

  it("a grant from another origin is refused, not revoked", async () => {
    const grant = await freshGrant({ origin: PREVIEW });
    expect(await rotateRefresh(grant, "rjti-1", PROD)).toEqual({ ok: false, reason: "wrong_origin" });
    // Even a superseded jti does not let a foreign origin revoke it.
    expect(await rotateRefresh(grant, "rjti-0", PROD)).toEqual({ ok: false, reason: "wrong_origin" });
    expect(patchCalls).toHaveLength(0);
  });

  it("only a FRESH grant can be rotated (compile-time guard)", async () => {
    fetchMock.mockResolvedValue(storedDoc());
    const cached = await loadGrant(GRANT_ID);
    if (!cached.ok) throw new Error("setup");
    const stale: StoredGrant = cached.grant;
    // @ts-expect-error: a cached grant may carry a superseded jti and must never be rotated
    const call = () => rotateRefresh(stale, "rjti-1", PROD);
    expect(typeof call).toBe("function");
  });
});

describe("redeemCode", () => {
  it("creates a redemption document keyed by the hashed jti", async () => {
    createMock.mockResolvedValue({});
    expect(await redeemCode("code-jti-1")).toEqual({ ok: true });
    expect(createMock).toHaveBeenCalledWith({
      _id: "mcpOauthCode." + sha("code-jti-1"),
      _type: "mcpOauthCodeRedemption",
      redeemedAt: NOW.toISOString(),
    });
  });

  it("a second redemption of one code is refused as a replay", async () => {
    createMock.mockResolvedValueOnce({}).mockRejectedValueOnce(conflict("documentAlreadyExistsError"));
    expect(await redeemCode("code-jti-1")).toEqual({ ok: true });
    expect(await redeemCode("code-jti-1")).toEqual({ ok: false, reason: "replay" });
  });

  it("any other failure is a typed server failure, not a replay and not a success", async () => {
    const network = new Error("ECONNRESET");
    createMock.mockRejectedValueOnce(network);
    expect(await redeemCode("j")).toEqual({ ok: false, reason: "server_error", cause: network });
    const otherConflict = conflict("documentRevisionIDDoesNotMatchError");
    createMock.mockRejectedValueOnce(otherConflict);
    expect(await redeemCode("j")).toEqual({ ok: false, reason: "server_error", cause: otherConflict });
  });
});
