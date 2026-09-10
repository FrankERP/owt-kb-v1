// Declared-instruments acceptance/validation/projection on the two
// super-admin member routes.
//
// The property under test is the same shape as `membersMinistries.test.ts`:
// absent ⇒ untouched, `[]` ⇒ stored, unknown ⇒ 400 naming the offender.

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

describe("PATCH /api/admin/members/[id] — instruments", () => {
  it("leaves the stored value alone when the body never mentions the field", async () => {
    const res = await PATCH(req({ alias: "A" }), { params });
    expect(res.status).toBe(200);
    expect("instruments" in patchSet()).toBe(false);
  });

  it("normalizes spelling and drops duplicates", async () => {
    const res = await PATCH(req({ instruments: [" keys", "Keys", "DRUMS"] }), { params });
    expect(res.status).toBe(200);
    expect(patchSet().instruments).toEqual(["Keys", "Drums"]);
  });

  it("stores an explicit empty array — 'declares nothing' is a legitimate value (D6)", async () => {
    const res = await PATCH(req({ instruments: [] }), { params });
    expect(res.status).toBe(200);
    expect(patchSet().instruments).toEqual([]);
  });

  it("rejects a name outside the seat vocabulary, naming it", async () => {
    const res = await PATCH(req({ instruments: ["Keys", "Piano"] }), { params });
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "Instrumento no reconocido: Piano" });
    expect(h.sets).toHaveLength(0);
  });

  it("rejects a FOH seat even though normalizeSeatName knows it", async () => {
    const res = await PATCH(req({ instruments: ["console"] }), { params });
    expect(res.status).toBe(400);
  });

  it("rejects a non-array", async () => {
    const res = await PATCH(req({ instruments: "Keys" }), { params });
    expect(res.status).toBe(400);
  });
});

describe("POST /api/admin/members — instruments", () => {
  const base = { member_name: "Nuevo Músico", email: "n@example.com" };

  it("creates without the field when the body omits it", async () => {
    await POST(req(base));
    const doc = h.create.mock.calls[0][0] as Record<string, unknown>;
    expect("instruments" in doc).toBe(false);
  });

  it("creates with the normalized list when sent", async () => {
    await POST(req({ ...base, instruments: ["drums"] }));
    const doc = h.create.mock.calls[0][0] as Record<string, unknown>;
    expect(doc.instruments).toEqual(["Drums"]);
  });

  it("rejects an unknown name", async () => {
    const res = await POST(req({ ...base, instruments: ["Guitarra"] }));
    expect(res.status).toBe(400);
    expect(h.create).not.toHaveBeenCalled();
  });
});

describe("GET /api/admin/members — projection", () => {
  it("selects instruments alongside memberType", async () => {
    await GET();
    const query = h.operationalFetch.mock.calls[0][0] as string;
    expect(query).toMatch(/memberType,[\s\S]*instruments/);
  });
});
