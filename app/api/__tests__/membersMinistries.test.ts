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
  // Every `.unset()` path list and `.ifRevisionId()` revision, in order.
  unsets: [] as string[][],
  revisions: [] as string[],
  // The PATCH's read of the stored member (role rule, access plan §3.4).
  storedFetch: vi.fn(),
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
  chain.unset = (paths: string[]) => { h.unsets.push(paths); return chain; };
  chain.ifRevisionId = (rev: string) => { h.revisions.push(rev); return chain; };
  chain.commit = () => h.commit();
  return {
    serverClient: { fetch: (q: string, p: unknown) => h.storedFetch(q, p) },
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
  h.unsets.length = 0;
  h.revisions.length = 0;
  h.storedFetch.mockResolvedValue({ _rev: "rev-1", role: "member" }); // a legacy worship member
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

  // ADR-0075: jovenes became writable only after the release that READS it was in
  // production (code older than that reads a stored ["jovenes"] as worship).
  for (const ministries of [["jovenes"], ["worship", "jovenes"]]) {
    it(`stores ${JSON.stringify(ministries)} now that jovenes is assignable`, async () => {
      const res = await PATCH(req({ ministries }), { params });
      expect(res.status).toBe(200);
      expect(patchSet()).toMatchObject({ ministries });
    });
  }

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

describe("adminMembersQuery — ministryRoles rides the super-admin arm only", () => {
  it("a worship admin's list never carries another ministry's levels", async () => {
    const { adminMembersQuery } = await import("@/app/utils/serviceReadQueries");
    const { evaluate, parse } = await import("groq-js");
    const dataset = [{
      _id: "m1", _type: "teamMembers", member_name: "Noemí", ministries: ["worship", "jovenes"],
      ministryRoles: [{ _key: "jovenes", ministry: "jovenes", level: "admin", groups: [] }],
    }];
    const run = async (all: boolean) => {
      const q = adminMembersQuery(all);
      return (await (await evaluate(parse(q.query), { dataset, params: q.params })).get()) as Record<string, unknown>[];
    };
    expect((await run(true))[0].ministryRoles).toEqual(dataset[0].ministryRoles);
    const worshipAdmin = await run(false);
    expect(worshipAdmin).toHaveLength(1);
    expect(worshipAdmin[0]).not.toHaveProperty("ministryRoles");
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

  for (const ministries of [["jovenes"], ["worship", "jovenes"]]) {
    it(`creates ${JSON.stringify(ministries)} now that jovenes is assignable (ADR-0075)`, async () => {
      const res = await POST(req({ ...base, ministries }));
      expect(res.status).toBe(201);
      expect(h.create.mock.calls[0][0]).toMatchObject({ ministries });
    });
  }

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

// ADR-0075, access plan §3.4 and §5: the write side of a LEVELED ministry
// (Jóvenes) and the rule that keeps a Jóvenes admin from becoming a worship admin.
describe("members routes — ministryRoles (Jóvenes level and groups)", () => {
  const admin = { ministry: "jovenes", level: "admin", groups: [] };
  const leader = { ministry: "jovenes", level: "leader", groups: ["otro-nivel", "invencibles"] };
  const stored = (p: Record<string, unknown>) => h.storedFetch.mockResolvedValue({ _rev: "rev-1", ...p });

  it("PATCH stores the items keyed by ministry, with the Studio's _type", async () => {
    const res = await PATCH(req({ ministries: ["worship", "jovenes"], ministryRoles: [leader] }), { params });
    expect(res.status).toBe(200);
    expect(patchSet().ministryRoles).toEqual([{ _key: "jovenes", _type: "ministryRole", ...leader }]);
    expect(h.unsets).toEqual([]); // set and unset never touch one path in one patch
  });

  it("PATCH refuses ministryRoles without ministries in the SAME request (the absent = worship trap)", async () => {
    const res = await PATCH(req({ ministryRoles: [admin] }), { params });
    expect(res.status).toBe(400);
    expect(h.commit).not.toHaveBeenCalled();
  });

  it("PATCH refuses a level in a ministry the request does not name", async () => {
    const res = await PATCH(req({ ministries: ["worship"], ministryRoles: [admin] }), { params });
    expect(res.status).toBe(400);
    expect(h.commit).not.toHaveBeenCalled();
  });

  it("PATCH that drops jovenes without ministryRoles unsets its stale level", async () => {
    stored({ role: "member", ministries: ["worship", "jovenes"] });
    const res = await PATCH(req({ ministries: ["worship"] }), { params });
    expect(res.status).toBe(200);
    expect(h.unsets).toEqual([['ministryRoles[_key=="jovenes"]']]);
    expect(patchSet()).not.toHaveProperty("ministryRoles");
  });

  it("PATCH that keeps jovenes without ministryRoles unsets nothing", async () => {
    const res = await PATCH(req({ ministries: ["worship", "jovenes"] }), { params });
    expect(res.status).toBe(200);
    expect(h.unsets).toEqual([]);
  });

  describe("a worship role needs worship, judged on the resulting state", () => {
    it("role-only PATCH: admin on a stored Jóvenes-only person → 400", async () => {
      stored({ role: "member", ministries: ["jovenes"] });
      const res = await PATCH(req({ role: "admin" }), { params });
      expect(res.status).toBe(400);
      expect(await res.json()).toEqual({ error: "Un rol de Alabanza (admin o editor) requiere ser de Alabanza." });
      expect(h.commit).not.toHaveBeenCalled();
    });

    it("ministries-only PATCH: Jóvenes-only on a stored content-editor → 400", async () => {
      stored({ role: "content-editor" });
      const res = await PATCH(req({ ministries: ["jovenes"], ministryRoles: [admin] }), { params });
      expect(res.status).toBe(400);
      expect(h.commit).not.toHaveBeenCalled();
    });

    it("re-sending an UNCHANGED role and ministries on an already-inconsistent person still saves", async () => {
      // The form always sends `role`; refusing here would lock them out of every edit.
      stored({ role: "admin", ministries: ["jovenes"] });
      const res = await PATCH(req({ role: "admin", alias: "Goma" }), { params });
      expect(res.status).toBe(200);
      const again = await PATCH(req({ role: "admin", ministries: ["jovenes"] }), { params });
      expect(again.status).toBe(200);
    });

    it("a super-admin may be Jóvenes-only; a member always may", async () => {
      stored({ role: "member" });
      expect((await PATCH(req({ role: "super-admin", ministries: ["jovenes"] }), { params })).status).toBe(200);
      expect((await PATCH(req({ role: "member", ministries: ["jovenes"] }), { params })).status).toBe(200);
    });

    it("promoting a legacy member (absent ministries = worship) to admin is fine", async () => {
      stored({ role: "member" });
      expect((await PATCH(req({ role: "admin" }), { params })).status).toBe(200);
    });

    it("pins the write to the revision it judged; a concurrent change answers 409", async () => {
      stored({ _rev: "rev-7", role: "member" });
      h.commit.mockRejectedValueOnce({
        statusCode: 409,
        details: { type: "mutationError", items: [{ error: { type: "documentRevisionIDDoesNotMatchError" } }] },
      });
      const res = await PATCH(req({ role: "admin" }), { params });
      expect(h.revisions).toEqual(["rev-7"]);
      expect(res.status).toBe(409);
      expect(await res.json()).toEqual({ error: "Alguien más cambió a esta persona; recarga." });
    });

    it("a PATCH without role or ministries reads nothing and pins nothing — as before", async () => {
      const res = await PATCH(req({ alias: "Ani" }), { params });
      expect(res.status).toBe(200);
      expect(h.storedFetch).not.toHaveBeenCalled();
      expect(h.revisions).toEqual([]);
    });

    it("a member that does not exist answers 404, not a write", async () => {
      h.storedFetch.mockResolvedValue(null);
      const res = await PATCH(req({ role: "admin" }), { params });
      expect(res.status).toBe(404);
      expect(h.commit).not.toHaveBeenCalled();
    });
  });

  describe("POST", () => {
    const base = { member_name: "Noemí", email: "noemi@example.com" };

    it("creates a Jóvenes admin with the level keyed by ministry", async () => {
      const res = await POST(req({ ...base, ministries: ["jovenes"], ministryRoles: [admin] }));
      expect(res.status).toBe(201);
      expect(h.create.mock.calls[0][0]).toMatchObject({
        role: "member",
        ministries: ["jovenes"],
        ministryRoles: [{ _key: "jovenes", _type: "ministryRole", ...admin }],
      });
    });

    it("refuses ministryRoles without ministries", async () => {
      const res = await POST(req({ ...base, ministryRoles: [admin] }));
      expect(res.status).toBe(400);
      expect(h.create).not.toHaveBeenCalled();
    });

    it("refuses a worship admin outside worship", async () => {
      const res = await POST(req({ ...base, role: "admin", ministries: ["jovenes"] }));
      expect(res.status).toBe(400);
      expect(h.create).not.toHaveBeenCalled();
    });

    it("an admin created without ministries is a worship admin, as today", async () => {
      const res = await POST(req({ ...base, role: "admin" }));
      expect(res.status).toBe(201);
    });
  });
});
