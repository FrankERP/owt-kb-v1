// Ministry membership/management on the two super-admin member routes.
//
// The property under test is NOT "the field round-trips". It is that a PATCH
// which never mentions a ministry field leaves the stored value alone, and that
// no writer can store an explicitly empty `ministries`.
//
// Both failures are silent privilege changes rather than errors:
//   - a clobbering PATCH (an admin fixing a typo in an alias) would set
//     `ministries: []`, which `normalizeMinistries` reads back as `["worship"]`
//     — a kids-only volunteer handed the entire worship catalog, and a Kids
//     leader's `managesMinistries` wiped, with nothing in any log to show it;
//   - `[].every(isMinistryId)` is vacuously true, so a naive validator accepts
//     the empty array the "remove them from Kids" gesture produces.

import { beforeEach, describe, expect, it, vi } from "vitest";
import type { NextRequest } from "next/server";

const h = vi.hoisted(() => ({
  requireActiveManager: vi.fn(),
  // Every `.set()` payload, in order.
  sets: [] as Record<string, unknown>[],
  commit: vi.fn(),
  create: vi.fn(),
  operationalFetch: vi.fn(),
  revalidateServiceViews: vi.fn(),
  revalidatePath: vi.fn(),
}));

vi.mock("@/app/utils/authGuards", () => ({
  requireActiveManager: () => h.requireActiveManager(),
}));

vi.mock("@/sanity/lib/serverClient", () => {
  const chain: Record<string, unknown> = {};
  chain.setIfMissing = () => chain;
  chain.set = (v: Record<string, unknown>) => { h.sets.push(v); return chain; };
  chain.commit = () => h.commit();
  return {
    serverClient: { fetch: vi.fn() },
    writeClient: {
      patch: () => chain,
      create: (doc: Record<string, unknown>) => h.create(doc),
    },
  };
});

vi.mock("@/sanity/lib/operationalClient", () => ({
  operationalClient: { fetch: (q: string) => h.operationalFetch(q) },
}));

vi.mock("@/app/utils/revalidate", () => ({
  revalidateServiceViews: (...a: unknown[]) => h.revalidateServiceViews(...a),
}));
vi.mock("next/cache", () => ({
  revalidatePath: (...a: unknown[]) => h.revalidatePath(...a),
}));

import { GET, POST } from "@/app/api/admin/members/route";
import { PATCH } from "@/app/api/admin/members/[id]/route";

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
  h.requireActiveManager.mockResolvedValue({ user: { sanityId: "boss", role: "super-admin" } });
  h.commit.mockResolvedValue({ _id: "member-1", notifPrefs: {} });
  h.create.mockResolvedValue({ _id: "member-new" });
  h.operationalFetch.mockResolvedValue([]);
});

describe("PATCH /api/admin/members/[id] — ministries", () => {
  it("rejects an unknown ministry id", async () => {
    const res = await PATCH(req({ ministries: ["kids", "youth"] }), { params });
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "Invalid ministry" });
    expect(h.commit).not.toHaveBeenCalled();
  });

  it("rejects `worship` in managesMinistries — no guard reads it, so storing it would be a lie", async () => {
    const res = await PATCH(req({ managesMinistries: ["worship"] }), { params });
    expect(res.status).toBe(400);
    expect(h.commit).not.toHaveBeenCalled();
  });

  it("rejects an explicitly EMPTY ministries array", async () => {
    // Unticking every box is the natural "take them out of Kids" gesture; stored,
    // it reads back as ["worship"] and grants the whole worship catalog.
    const res = await PATCH(req({ ministries: [] }), { params });
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "Elige al menos un ministerio." });
    expect(h.commit).not.toHaveBeenCalled();
  });

  it("accepts an EMPTY managesMinistries — the only way to revoke management", async () => {
    const res = await PATCH(req({ managesMinistries: [] }), { params });
    expect(res.status).toBe(200);
    expect(patchSet()).toMatchObject({ managesMinistries: [] });
  });

  it("stores both arrays verbatim for a super-admin", async () => {
    const res = await PATCH(req({ ministries: ["kids"], managesMinistries: ["kids"] }), { params });
    expect(res.status).toBe(200);
    expect(patchSet()).toMatchObject({ ministries: ["kids"], managesMinistries: ["kids"] });
  });

  it("REGRESSION: a PATCH with no ministry keys touches NEITHER stored array", async () => {
    const res = await PATCH(req({ member_name: "Nuevo nombre" }), { params });
    expect(res.status).toBe(200);
    const set = patchSet();
    expect(set).toMatchObject({ member_name: "Nuevo nombre" });
    expect(set).not.toHaveProperty("ministries");
    expect(set).not.toHaveProperty("managesMinistries");
  });

  it("treats a ministries-only body as a real update, not `Nothing to update`", async () => {
    const res = await PATCH(req({ ministries: ["worship", "kids"] }), { params });
    expect(res.status).toBe(200);
  });

  it("stays super-admin only", async () => {
    h.requireActiveManager.mockResolvedValue({ user: { sanityId: "a", role: "admin" } });
    const res = await PATCH(req({ ministries: ["kids"] }), { params });
    expect(res.status).toBe(403);
    expect(h.commit).not.toHaveBeenCalled();
  });
});

describe("GET /api/admin/members — ministries", () => {
  it("projects both ministry fields, and keeps the existing projection intact", async () => {
    await GET();
    const query = h.operationalFetch.mock.calls[0][0] as string;
    expect(query).toContain("ministries");
    expect(query).toContain("managesMinistries");
    // The admin form seeds its checkboxes from this response; dropping any of
    // these breaks the Disponibilidad or Miembros panels.
    for (const field of ["unavailableDates", "unavailabilityNotes", "hasPassword", "photoUrl", "notifPrefs"]) {
      expect(query).toContain(field);
    }
  });
});

describe("POST /api/admin/members — ministries", () => {
  const base = { member_name: "Nuevo", email: "n@example.com" };

  it("creates a kids-only volunteer as kids-only, not worship-then-fix", async () => {
    const res = await POST(req({ ...base, ministries: ["kids"], managesMinistries: ["kids"] }));
    expect(res.status).toBe(201);
    expect(h.create.mock.calls[0][0]).toMatchObject({
      ministries: ["kids"],
      managesMinistries: ["kids"],
    });
  });

  it("rejects an empty ministries array with the same validator PATCH uses", async () => {
    const res = await POST(req({ ...base, ministries: [] }));
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "Elige al menos un ministerio." });
    expect(h.create).not.toHaveBeenCalled();
  });

  it("rejects an unknown ministry id", async () => {
    const res = await POST(req({ ...base, ministries: ["youth"] }));
    expect(res.status).toBe(400);
    expect(h.create).not.toHaveBeenCalled();
  });

  it("omits the fields entirely when the body does not carry them", async () => {
    // Absent ⇒ worship by the storage contract; writing `[]` here would be a lie.
    const res = await POST(req(base));
    expect(res.status).toBe(201);
    const doc = h.create.mock.calls[0][0] as Record<string, unknown>;
    expect(doc).not.toHaveProperty("ministries");
    expect(doc).not.toHaveProperty("managesMinistries");
  });

  it("stays super-admin only", async () => {
    h.requireActiveManager.mockResolvedValue({ user: { sanityId: "a", role: "admin" } });
    const res = await POST(req({ ...base, ministries: ["kids"] }));
    expect(res.status).toBe(403);
    expect(h.create).not.toHaveBeenCalled();
  });
});
