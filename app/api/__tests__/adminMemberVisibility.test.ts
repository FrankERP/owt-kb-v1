// Ministry scoping of the two worship admin reads of `teamMembers`
// (`GET /api/admin/members`, `GET /api/admin/login-events`).
//
// The rule is ROLE-DEPENDENT and destructive when written backwards:
//   - admin / content-editor  → worship members only;
//   - super-admin             → EVERYONE, unfiltered. They are the only role
//     that can edit `ministries`, so filtering their view would make a
//     Kids-only member permanently uneditable through the UI.
//
// The query is not asserted as a string: it is PARSED AND EVALUATED with
// groq-js (the same engine Sanity runs) against a fixture dataset, so a filter
// written against the wrong default fails here instead of in production. The
// assertion that catches that is the LEGACY member — no `ministries` field at
// all, which is every member predating the kids feature. A bare
// `"worship" in ministries` hides all of them.

import { beforeEach, describe, expect, it, vi } from "vitest";
import { evaluate, parse } from "groq-js";

const h = vi.hoisted(() => ({ requireActiveManager: vi.fn() }));

vi.mock("@/app/utils/authGuards", () => ({
  requireActiveManager: () => h.requireActiveManager(),
}));

/** Runs the route's real GROQ against the fixture dataset. */
async function groq(query: string, params: Record<string, unknown> = {}) {
  const value = await evaluate(parse(query), { dataset: DATASET, params });
  return (await value.get()) as unknown;
}

vi.mock("@/sanity/lib/serverClient", () => ({
  serverClient: { fetch: (q: string, p?: Record<string, unknown>) => groq(q, p) },
  writeClient: { create: vi.fn(), patch: vi.fn() },
}));

vi.mock("@/sanity/lib/operationalClient", () => ({
  operationalClient: { fetch: (q: string, p?: Record<string, unknown>) => groq(q, p) },
}));

const DATASET = [
  // No `ministries` field: the legacy shape, which is every member who predates
  // the kids feature. Absent ⇒ worship.
  { _id: "m-legacy", _type: "teamMembers", member_name: "Ana Legado", email: "ana@example.com", role: "member" },
  { _id: "m-kids", _type: "teamMembers", member_name: "Beto Kids", email: "beto@example.com", role: "member", ministries: ["kids"] },
  { _id: "m-dual", _type: "teamMembers", member_name: "Carla Ambos", email: "carla@example.com", role: "member", ministries: ["worship", "kids"] },
  // Rejected at every write boundary, but a hand-edited document could hold it;
  // it reads as worship, so it must stay visible to a worship admin.
  { _id: "m-empty", _type: "teamMembers", member_name: "Dani Vacío", email: "dani@example.com", role: "member", ministries: [] },
  { _id: "ev-1", _type: "loginEvent", member: { _ref: "m-kids" }, email: "beto@example.com", provider: "google", timestamp: "2026-08-18T10:00:00Z" },
  { _id: "ev-2", _type: "loginEvent", member: { _ref: "m-legacy" }, email: "ana@example.com", provider: "google", timestamp: "2026-08-19T10:00:00Z" },
];

import { GET as membersGET } from "@/app/api/admin/members/route";
import { GET as loginEventsGET } from "@/app/api/admin/login-events/route";

function signedInAs(role: string) {
  h.requireActiveManager.mockResolvedValue({ user: { sanityId: "boss", role } });
}

async function idsFrom(res: Response): Promise<string[]> {
  const body = (await res.json()) as { _id: string }[];
  return body.map((m) => m._id).sort();
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("GET /api/admin/members — ministry scoping", () => {
  it("omits a Kids-only member from a worship admin's list", async () => {
    signedInAs("admin");
    expect(await idsFrom(await membersGET())).not.toContain("m-kids");
  });

  it("INCLUDES a member with no `ministries` field — absent means worship", async () => {
    // If this fails, every member who predates the kids feature has vanished
    // from the Miembros and Disponibilidad panels.
    signedInAs("admin");
    const ids = await idsFrom(await membersGET());
    expect(ids).toEqual(["m-dual", "m-empty", "m-legacy"]);
  });

  it("returns EVERYONE to a super-admin — the only role that can edit ministries", async () => {
    signedInAs("super-admin");
    expect(await idsFrom(await membersGET())).toEqual(["m-dual", "m-empty", "m-kids", "m-legacy"]);
  });

  it("keeps projecting the fields the admin panels need", async () => {
    signedInAs("super-admin");
    const body = (await (await membersGET()).json()) as Record<string, unknown>[];
    const kid = body.find((m) => m._id === "m-kids")!;
    expect(kid).toMatchObject({ member_name: "Beto Kids", ministries: ["kids"] });
    expect(kid).toHaveProperty("hasPassword");
    expect(kid).toHaveProperty("photoUrl");
  });
});

describe("GET /api/admin/login-events — ministry scoping", () => {
  it("omits a Kids-only member from a worship admin's list", async () => {
    signedInAs("admin");
    expect(await idsFrom(await loginEventsGET())).not.toContain("m-kids");
  });

  it("INCLUDES a member with no `ministries` field", async () => {
    signedInAs("admin");
    expect(await idsFrom(await loginEventsGET())).toEqual(["m-dual", "m-empty", "m-legacy"]);
  });

  it("returns EVERYONE to a super-admin", async () => {
    signedInAs("super-admin");
    expect(await idsFrom(await loginEventsGET())).toEqual(["m-dual", "m-empty", "m-kids", "m-legacy"]);
  });

  it("still joins login events onto the members it does return", async () => {
    signedInAs("admin");
    const body = (await (await loginEventsGET()).json()) as { _id: string; loginCount: number }[];
    expect(body.find((m) => m._id === "m-legacy")!.loginCount).toBe(1);
  });
});
