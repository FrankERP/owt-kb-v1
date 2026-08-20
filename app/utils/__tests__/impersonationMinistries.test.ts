/**
 * Impersonation must carry the TARGET's ministries, not the admin's.
 *
 * Frank impersonated Niza — a member whose `managesMinistries` is `["kids"]` —
 * and the nav offered no "Planear Kids". The cause: the jwt callback's
 * impersonation branch sets `role`/`sanityId`/`name`/`alias` and then RETURNS
 * EARLY, skipping the refresh block that assigns `ministries` and
 * `managesMinistries`. The token therefore described the admin's ministries
 * beside the target's `sanityId`, and `NavMenu` (which reads the session, not
 * the database) rendered the admin's links.
 *
 * The server guards were never wrong — `requireMinistryManager` re-reads
 * `getMemberAccess` by `sanityId`, so `/kids/admin` was reachable by URL the
 * whole time. Only the way in disappeared. That is the precise shape of the
 * "render-only, therefore tolerable" claim this file now pins: it is tolerable
 * ONLY while the session copy and the sanityId describe the same person.
 *
 * These tests exercise the jwt callback directly, because that is where the
 * defect lived and where a future edit would reintroduce it.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const fetchMock = vi.fn();
const getMemberAccessMock = vi.fn();

vi.mock("@/sanity/lib/serverClient", () => ({
  serverClient: { fetch: (...a: unknown[]) => fetchMock(...a) },
  writeClient: { patch: vi.fn(), create: vi.fn() },
}));
vi.mock("@/app/utils/memberAccess", () => ({
  isMemberActive: vi.fn(async () => true),
  getMemberAccess: (...a: unknown[]) => getMemberAccessMock(...a),
}));
vi.mock("@/app/utils/googleIdToken", () => ({ verifyGoogleIdToken: vi.fn() }));
vi.mock("@/app/utils/srVerificationLoginEvent", () => ({
  createLoginEvent: vi.fn(),
  resolveVerificationOwnership: vi.fn(),
}));

const ADMIN = "admin-frank";
const NIZA = "member-niza";

async function jwtCallback() {
  const { authOptions } = await import("@/auth");
  const cb = authOptions.callbacks?.jwt;
  if (!cb) throw new Error("no jwt callback");
  return cb as (args: Record<string, unknown>) => Promise<Record<string, unknown>>;
}

/** A super-admin's token, mid-session, before any impersonation. */
const adminToken = () => ({
  sub: "sub-frank",
  role: "super-admin",
  sanityId: ADMIN,
  name: "Frank",
  alias: "Frank",
  ministries: ["worship"],
  managesMinistries: [] as string[],
});

beforeEach(() => {
  fetchMock.mockReset();
  getMemberAccessMock.mockReset();
  getMemberAccessMock.mockResolvedValue({
    active: true, role: "super-admin", ministries: ["worship"], managesMinistries: [],
  });
});

describe("impersonation carries the target's ministries", () => {
  it("adopts the target's managesMinistries, so the Kids link renders", async () => {
    const jwt = await jwtCallback();
    fetchMock.mockResolvedValueOnce({
      _id: NIZA,
      member_name: "Nitzaya Castillejos",
      alias: "Niza",
      role: "member",
      ministries: ["worship", "kids"],
      managesMinistries: ["kids"],
    });

    const token = await jwt({
      token: adminToken(),
      trigger: "update",
      session: { impersonating: NIZA },
    });

    expect(token.sanityId).toBe(NIZA);
    // The regression: these two used to stay the ADMIN's.
    expect(token.managesMinistries).toEqual(["kids"]);
    expect(token.ministries).toEqual(["worship", "kids"]);
  });

  it("normalizes an absent ministries field on the target to worship", async () => {
    const jwt = await jwtCallback();
    fetchMock.mockResolvedValueOnce({
      _id: "legacy-1", member_name: "Legacy", alias: null, role: "member",
      ministries: null, managesMinistries: null,
    });

    const token = await jwt({
      // The admin fixture here MUST differ from the normalized result, or the
      // assertions cannot fail: with an admin of ["worship"]/[] — which is what
      // normalizeMinistries(null) and the [] fallback produce — "normalized the
      // target's null" and "left the admin's values untouched" are the same
      // bytes, and the test passes with the fix reverted.
      token: { ...adminToken(), ministries: ["worship", "kids"], managesMinistries: ["kids"] },
      trigger: "update",
      session: { impersonating: "legacy-1" },
    });

    expect(token.ministries).toEqual(["worship"]);
    expect(token.managesMinistries).toEqual([]);
  });

  it("does not clobber the admin's snapshot when switching targets", async () => {
    const jwt = await jwtCallback();
    const admin = { ...adminToken(), ministries: ["worship", "kids"], managesMinistries: ["kids"] };

    fetchMock.mockResolvedValueOnce({
      _id: "t1", member_name: "Target One", alias: null, role: "member",
      ministries: ["kids"], managesMinistries: ["kids"],
    });
    const first = await jwt({ token: admin, trigger: "update", session: { impersonating: "t1" } });
    expect(first.managesMinistries).toEqual(["kids"]);

    fetchMock.mockResolvedValueOnce({
      _id: "t2", member_name: "Target Two", alias: null, role: "member",
      ministries: ["worship"], managesMinistries: null,
    });
    const second = await jwt({ token: first, trigger: "update", session: { impersonating: "t2" } });
    expect(second.ministries).toEqual(["worship"]);
    expect(second.managesMinistries).toEqual([]);

    // The snapshot must still hold the ADMIN's own values, not target one's.
    // Move the snapshot assignment outside `if (!token.__realAdmin)` and this is
    // the assertion that catches it — the admin would otherwise walk away from a
    // two-target session wearing target one's Kids rights.
    const stopped = await jwt({
      token: second, trigger: "update", session: { stopImpersonating: true },
    });
    expect(stopped.sanityId).toBe(ADMIN);
    expect(stopped.role).toBe("super-admin");
    expect(stopped.ministries).toEqual(["worship", "kids"]);
    expect(stopped.managesMinistries).toEqual(["kids"]);
  });

  it("restores the admin's OWN ministries when impersonation stops", async () => {
    const jwt = await jwtCallback();
    fetchMock.mockResolvedValueOnce({
      _id: NIZA, member_name: "Nitzaya Castillejos", alias: "Niza", role: "member",
      ministries: ["worship", "kids"], managesMinistries: ["kids"],
    });

    const impersonating = await jwt({
      token: adminToken(), trigger: "update", session: { impersonating: NIZA },
    });
    expect(impersonating.managesMinistries).toEqual(["kids"]);

    const stopped = await jwt({
      token: impersonating, trigger: "update", session: { stopImpersonating: true },
    });

    expect(stopped.sanityId).toBe(ADMIN);
    // Without the __realAdmin snapshot the admin would keep the target's Kids
    // rights in their nav after stopping.
    expect(stopped.managesMinistries).toEqual([]);
    expect(stopped.ministries).toEqual(["worship"]);
  });

  it("refuses to impersonate for a non-super-admin, ministries untouched", async () => {
    const jwt = await jwtCallback();
    const token = await jwt({
      token: { ...adminToken(), role: "admin" },
      trigger: "update",
      session: { impersonating: NIZA },
    });

    expect(token.sanityId).toBe(ADMIN);
    expect(token.managesMinistries).toEqual([]);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
