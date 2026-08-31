// The two preference writers: `PATCH /api/me/notif-prefs` (a member editing
// their own prefs) and `PATCH /api/admin/members/[id]` (a super-admin editing
// someone else's).
//
// The property under test is not "the field round-trips" — it is that every
// value these routes hand back is the RESOLVED preference, computed by the same
// `wantsNotification` the senders use. There is no data migration, so a member
// who opted out of the legacy `notifPrefs.email` has all five per-type fields
// unset; an unset boolean renders as its `true` default, so a route that echoed
// the raw field would tell the panel to draw five switches ON for someone
// receiving nothing.

import { beforeEach, describe, expect, it, vi } from "vitest";
import type { NextRequest } from "next/server";

vi.mock("server-only", () => ({}));

const h = vi.hoisted(() => ({
  requireActiveSession: vi.fn(),
  requireActiveManager: vi.fn(),
  // Every `.set()` payload, in order, across both routes.
  sets: [] as Record<string, unknown>[],
  setIfMissing: vi.fn(),
  commit: vi.fn(),
  patchedIds: [] as string[],
  revalidateServiceViews: vi.fn(),
  revalidatePath: vi.fn(),
}));

vi.mock("@/app/utils/authGuards", () => ({
  requireActiveSession: () => h.requireActiveSession(),
  requireActiveManager: () => h.requireActiveManager(),
}));

vi.mock("@/sanity/lib/operationalClient", () => ({
  operationalClient: { fetch: vi.fn() },
}));

vi.mock("@/sanity/lib/serverClient", () => {
  const chain: Record<string, unknown> = {};
  chain.setIfMissing = (v: unknown) => { h.setIfMissing(v); return chain; };
  chain.set = (v: Record<string, unknown>) => { h.sets.push(v); return chain; };
  chain.commit = () => h.commit();
  return {
    serverClient: { fetch: vi.fn() },
    writeClient: {
      patch: (id: string) => { h.patchedIds.push(id); return chain; },
    },
  };
});

vi.mock("@/app/utils/revalidate", () => ({
  revalidateServiceViews: (...a: unknown[]) => h.revalidateServiceViews(...a),
}));
vi.mock("next/cache", () => ({
  revalidatePath: (...a: unknown[]) => h.revalidatePath(...a),
}));

import { PATCH } from "@/app/api/me/notif-prefs/route";
import { PATCH as ADMIN_PATCH } from "@/app/api/admin/members/[id]/route";

function req(body: unknown): NextRequest {
  return { json: async () => body } as unknown as NextRequest;
}

/** The merged `.set()` payload committed by the route under test. */
function patchSet(): Record<string, unknown> {
  return Object.assign({}, ...h.sets);
}

const params = Promise.resolve({ id: "member-1" });

beforeEach(() => {
  vi.clearAllMocks();
  h.sets.length = 0;
  h.patchedIds.length = 0;
  h.requireActiveSession.mockResolvedValue({ user: { sanityId: "member-1" } });
  h.requireActiveManager.mockResolvedValue({ user: { sanityId: "boss", role: "super-admin" } });
  h.commit.mockResolvedValue({ _id: "member-1", notifPrefs: {} });
});

describe("PATCH /api/me/notif-prefs", () => {
  it("accepts the five per-type fields", async () => {
    await PATCH(req({ emailSetlist: false, emailRemoved: true }));
    expect(patchSet()).toMatchObject({
      "notifPrefs.emailSetlist": false,
      "notifPrefs.emailRemoved": true,
    });
  });

  it("writes all five, and keeps them distinct from the push prefs of the same name", async () => {
    await PATCH(req({
      emailAssigned: false, emailRemoved: false, emailRoleChanged: false,
      emailSetlist: false, emailProposals: false,
      proposals: true, setlist: true,
    }));
    const set = patchSet();
    expect(set).toMatchObject({
      "notifPrefs.emailAssigned": false,
      "notifPrefs.emailRemoved": false,
      "notifPrefs.emailRoleChanged": false,
      "notifPrefs.emailSetlist": false,
      "notifPrefs.emailProposals": false,
      // Push prefs, untouched by the email toggles.
      "notifPrefs.proposals": true,
      "notifPrefs.setlist": "all",
    });
  });

  it("returns RESOLVED values, not raw fields", async () => {
    // A member with legacy email:false and the five unset resolves to "no mail".
    // Rendering unset booleans as their true default would show five switches ON
    // to someone receiving nothing.
    h.commit.mockResolvedValue({ notifPrefs: { email: false } });
    const body = await (await PATCH(req({ emailSetlist: false }))).json();
    expect(body.emailAssigned).toBe(false);
    expect(body.emailRemoved).toBe(false);
    expect(body.emailRoleChanged).toBe(false);
    expect(body.emailSetlist).toBe(false);
    expect(body.emailProposals).toBe(false);
  });

  it("lets an explicit per-type field win over the legacy fallback", async () => {
    h.commit.mockResolvedValue({ notifPrefs: { email: false, emailSetlist: true } });
    const body = await (await PATCH(req({ emailSetlist: true }))).json();
    expect(body.emailSetlist).toBe(true);
    expect(body.emailAssigned).toBe(false);
  });

  it("resolves an unset bag to all five on", async () => {
    h.commit.mockResolvedValue({ notifPrefs: {} });
    const body = await (await PATCH(req({ emailAssigned: true }))).json();
    expect(body.emailAssigned).toBe(true);
    expect(body.emailProposals).toBe(true);
  });

  it("still rejects a body with no recognised field", async () => {
    const res = await PATCH(req({ nope: true }));
    expect(res.status).toBe(400);
    expect(h.commit).not.toHaveBeenCalled();
  });
});

describe("PATCH /api/admin/members/[id]", () => {
  it("accepts the five per-type fields on their own", async () => {
    const res = await ADMIN_PATCH(req({ emailRoleChanged: false }), { params });
    expect(res.status).toBe(200);
    expect(patchSet()).toMatchObject({ "notifPrefs.emailRoleChanged": false });
  });

  it("returns RESOLVED values for the member being edited", async () => {
    h.commit.mockResolvedValue({ _id: "member-1", notifPrefs: { email: false } });
    const body = await (await ADMIN_PATCH(req({ emailRoleChanged: false }), { params })).json();
    expect(body.emailPrefs).toEqual({
      emailAssigned: false,
      emailRemoved: false,
      emailRoleChanged: false,
      emailSetlist: false,
      emailProposals: false,
    });
  });

  it("rejects a body with nothing to update", async () => {
    const res = await ADMIN_PATCH(req({}), { params });
    expect(res.status).toBe(400);
    expect(h.commit).not.toHaveBeenCalled();
  });

  it("stays super-admin only", async () => {
    h.requireActiveManager.mockResolvedValue({ user: { sanityId: "a", role: "admin" } });
    const res = await ADMIN_PATCH(req({ emailAssigned: false }), { params });
    expect(res.status).toBe(403);
    expect(h.commit).not.toHaveBeenCalled();
  });
});
